// https://developer.work.weixin.qq.com/document/path/101463
// 智能机器人: WebSocket 长连接模式

import { createHash, randomBytes } from "node:crypto";

import { extractCard, extractFiles, ValidationError } from "@chat-adapter/shared";
import {
  Message,
  NotImplementedError,
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";

import { cardToTemplateCard } from "../card";
import { WeComFormatConverter } from "../format";
import { inferMediaType } from "../media";
import type {
  WeComBotThreadId,
  WeComBotWebSocketConfig,
  WsBotCallbackBody,
  WsFrame,
} from "../types";

type BotRawMessage = WsBotCallbackBody;

// --- WebSocket 连接管理器 ---

const DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_INTERVAL = 30_000;
const MAX_MISSED_PONG = 3;
const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

type MessageHandler = (body: WsBotCallbackBody, reqId: string) => void;

function generateReqId(prefix: string): string {
  const hex = randomBytes(4).toString("hex");
  return `${prefix}_${Date.now()}_${hex}`;
}

class BotWebSocketManager {
  private readonly config: WeComBotWebSocketConfig;
  private readonly wsUrl: string;
  private readonly WebSocketCtor: typeof globalThis.WebSocket;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private reconnectAttempts = 0;
  private isManualClose = false;

  private messageHandler: MessageHandler | null = null;
  private readonly pendingRequests = new Map<
    string,
    { resolve: (frame: WsFrame) => void; reject: (err: Error) => void }
  >();

  constructor(config: WeComBotWebSocketConfig) {
    this.config = config;
    this.wsUrl = config.wsUrl ?? DEFAULT_WS_URL;
    this.WebSocketCtor = config.WebSocket ?? globalThis.WebSocket;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isManualClose = false;
      const ws = new this.WebSocketCtor(this.wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.sendFrame("aibot_subscribe", {
          bot_id: this.config.botId,
          secret: this.config.secret,
        });
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        const frame: WsFrame = JSON.parse(event.data as string);
        const reqId = frame.headers.req_id;

        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          this.pendingRequests.delete(reqId);
          if (frame.errcode === 0) {
            pending.resolve(frame);
          } else {
            pending.reject(new Error(`Request failed: ${frame.errcode} ${frame.errmsg}`));
          }
          return;
        }

        if (reqId.startsWith("aibot_subscribe_")) {
          if (frame.errcode === 0) {
            this.reconnectAttempts = 0;
            this.missedPongs = 0;
            this.startHeartbeat();
            resolve();
          } else {
            reject(new Error(`Auth failed: ${frame.errcode} ${frame.errmsg}`));
          }
          return;
        }

        if (reqId.startsWith("ping_")) {
          this.missedPongs = 0;
          return;
        }

        if (frame.cmd === "aibot_msg_callback" && frame.body) {
          this.messageHandler?.(frame.body as WsBotCallbackBody, reqId);
          return;
        }

        if (frame.cmd === "aibot_event_callback" && frame.body) {
          const body = frame.body as WsBotCallbackBody;
          if (body.event?.eventtype === "disconnected_event") {
            this.isManualClose = true;
            return;
          }
        }
      });

      ws.addEventListener("error", () => {
        reject(new Error("WebSocket connection error"));
      });

      ws.addEventListener("close", () => {
        this.stopHeartbeat();
        for (const [id, pending] of this.pendingRequests) {
          this.pendingRequests.delete(id);
          pending.reject(new Error("WebSocket closed"));
        }
        if (!this.isManualClose) {
          this.scheduleReconnect();
        }
      });
    });
  }

  disconnect(): void {
    this.isManualClose = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  // https://developer.work.weixin.qq.com/document/path/101138
  respondMessage(reqId: string, msgtype: string, content: unknown): void {
    this.sendFrame("aibot_respond_msg", { msgtype, [msgtype]: content }, reqId);
  }

  // https://developer.work.weixin.qq.com/document/path/101463
  async uploadMedia(type: string, filename: string, buffer: Buffer): Promise<string> {
    const md5 = createHash("md5").update(buffer).digest("hex");
    const CHUNK_SIZE = 512 * 1024;
    const totalSize = buffer.length;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    const initFrame = await this.sendAndReceive("aibot_upload_media_init", {
      type,
      filename,
      total_size: totalSize,
      total_chunks: totalChunks,
      md5,
    });
    const { upload_id } = initFrame.body as { upload_id: string };

    for (let i = 0; i < totalChunks; i++) {
      const chunk = buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await this.sendAndReceive("aibot_upload_media_chunk", {
        upload_id,
        chunk_index: String(i),
        base64_data: chunk.toString("base64"),
      });
    }

    const finishFrame = await this.sendAndReceive("aibot_upload_media_finish", { upload_id });
    const result = finishFrame.body as { media_id: string };
    return result.media_id;
  }

  // https://developer.work.weixin.qq.com/document/path/101138
  sendMessage(chatId: string, msgtype: string, content: unknown): void {
    const body: Record<string, unknown> = {
      chatid: chatId,
      msgtype,
      chat_type: chatId ? 2 : 1,
    };
    if (msgtype === "template_card") {
      body.template_card = content;
    } else {
      body[msgtype] = content;
    }
    this.sendFrame("aibot_send_msg", body);
  }

  private sendAndReceive(cmd: string, body: unknown): Promise<WsFrame> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const reqId = generateReqId(cmd);
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`${cmd} timed out`));
      }, 60_000);
      this.pendingRequests.set(reqId, {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.sendFrame(cmd, body, reqId);
    });
  }

  private sendFrame(cmd: string, body: unknown, reqId?: string): void {
    const frame: WsFrame = {
      cmd,
      headers: { req_id: reqId ?? generateReqId(cmd) },
      body,
    };
    this.ws?.send(JSON.stringify(frame));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;

    this.heartbeatTimer = setInterval(() => {
      if (this.missedPongs >= MAX_MISSED_PONG) {
        this.ws?.close();
        return;
      }
      this.missedPongs++;
      this.sendFrame("ping", undefined);
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

    const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }
}

// --- 适配器 ---

export class WeComBotWebSocketAdapter implements Adapter<WeComBotThreadId, BotRawMessage> {
  readonly name = "wecom-bot-websocket";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private readonly formatConverter = new WeComFormatConverter();
  private wsManager: BotWebSocketManager | null = null;
  private readonly reqIds = new Map<string, string>();

  constructor(private readonly config: WeComBotWebSocketConfig) {
    this.userName = config.userName ?? "WeCom Bot";
  }

  encodeThreadId(data: WeComBotThreadId): string {
    return `wecom-bot-websocket:${data.chatId}`;
  }

  decodeThreadId(threadId: string): WeComBotThreadId {
    return { chatId: threadId.slice("wecom-bot-websocket:".length) };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).chatId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    this.wsManager = new BotWebSocketManager(this.config);
    this.wsManager.onMessage((body, reqId) => {
      if (!this.chat) return;
      const threadId = this.encodeThreadId({
        chatId: body.chatid ?? body.from.userid,
      });

      this.reqIds.set(threadId, reqId);

      void this.chat.processMessage(this, threadId, async () => this.parseMessage(body));
    });

    await this.wsManager.connect();
  }

  async handleWebhook(_request: Request, _options?: WebhookOptions): Promise<Response> {
    return new Response("ok", { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    if (!this.wsManager) {
      throw new Error("wecom-bot-websocket: not initialized");
    }

    const card = extractCard(message);
    const { chatId } = this.decodeThreadId(threadId);

    const files = extractFiles(message);
    const reqId = this.reqIds.get(threadId);
    if (files.length > 0 && reqId) {
      const file = files[0];
      const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data as ArrayBuffer);
      const mediaType = inferMediaType(file.filename, file.mimeType);
      const mediaId = await this.wsManager.uploadMedia(mediaType, file.filename, buffer);
      this.wsManager.respondMessage(reqId, mediaType, { media_id: mediaId });
      return { id: String(Date.now()), raw: {} as BotRawMessage, threadId };
    }

    const text = this.formatConverter.renderPostable(message);
    if (card) {
      const templateCard = cardToTemplateCard(card);
      this.wsManager.sendMessage(chatId, "template_card", templateCard);
    } else {
      this.wsManager.sendMessage(chatId, "markdown", { content: text });
    }
    return {
      id: String(Date.now()),
      raw: {} as BotRawMessage,
      threadId,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    throw new NotImplementedError("wecom-bot-websocket: editMessage not supported");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-websocket: deleteMessage not supported");
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<BotRawMessage>> {
    throw new NotImplementedError("wecom-bot-websocket: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("wecom-bot-websocket: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-websocket: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-websocket: removeReaction not supported");
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {}

  parseMessage(raw: WsBotCallbackBody): Message<BotRawMessage> {
    const chatId = raw.chatid ?? raw.from.userid;
    // mixed 消息：提取文本子项
    let text = raw.text?.content ?? raw.voice?.content ?? "";
    if (!text && raw.mixed?.msg_item) {
      const textItem = raw.mixed.msg_item.find((i) => i.msgtype === "text");
      const textObj = textItem?.text as { content?: string } | undefined;
      text = textObj?.content ?? "";
    }
    return new Message({
      id: raw.msgid,
      threadId: this.encodeThreadId({ chatId }),
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId: raw.from.userid,
        userName: raw.from.userid,
        fullName: raw.from.userid,
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(), edited: false },
      attachments: parseBotAttachments(raw),
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async disconnect(): Promise<void> {
    this.wsManager?.disconnect();
  }
}

function parseBotAttachments(raw: WsBotCallbackBody): Attachment[] {
  const attachments: Attachment[] = [];
  if (raw.image) {
    attachments.push({
      type: "image",
      url: raw.image.url,
      ...(raw.image.aeskey ? { fetchMetadata: { aeskey: raw.image.aeskey } } : {}),
    });
  }
  // voice 只提供转录文本 (voice.content)，不含音频 URL，不创建 attachment
  if (raw.file) {
    attachments.push({
      type: "file",
      url: raw.file.url,
      ...(raw.file.aeskey ? { fetchMetadata: { aeskey: raw.file.aeskey } } : {}),
    });
  }
  if (raw.video) {
    attachments.push({
      type: "video",
      url: raw.video.url,
      ...(raw.video.aeskey ? { fetchMetadata: { aeskey: raw.video.aeskey } } : {}),
    });
  }
  // mixed 消息：从 msg_item 中提取图片子项
  if (raw.mixed?.msg_item) {
    for (const item of raw.mixed.msg_item) {
      if (item.msgtype === "image" && item.image) {
        const img = item.image as { url: string; aeskey?: string };
        attachments.push({
          type: "image",
          url: img.url,
          ...(img.aeskey ? { fetchMetadata: { aeskey: img.aeskey } } : {}),
        });
      }
    }
  }
  return attachments;
}

export function createWeComBotWebSocketAdapter(
  config?: Partial<WeComBotWebSocketConfig>,
): WeComBotWebSocketAdapter {
  const botId = config?.botId ?? process.env.WECOM_BOT_WS_BOT_ID;
  const secret = config?.secret ?? process.env.WECOM_BOT_WS_SECRET;

  if (!botId) {
    throw new ValidationError(
      "wecom-bot-websocket",
      "Bot ID is required. Pass it in config or set WECOM_BOT_WS_BOT_ID.",
    );
  }
  if (!secret) {
    throw new ValidationError(
      "wecom-bot-websocket",
      "Secret is required. Pass it in config or set WECOM_BOT_WS_SECRET.",
    );
  }

  return new WeComBotWebSocketAdapter({
    mode: "websocket",
    botId,
    secret,
    userName: config?.userName,
    wsUrl: config?.wsUrl,
    WebSocket: config?.WebSocket,
  });
}
