// https://developer.work.weixin.qq.com/document/path/101039
// 智能机器人: 支持回调 URL 和 WebSocket 长连接两种模式

import { extractCard, extractFiles } from "@chat-adapter/shared";
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
import { decryptCallback, encryptReply, verifyUrl } from "../crypto";
import { WeComFormatConverter } from "../format";
import { inferMediaType } from "../media";
import type {
  WeComBaseResponse,
  WeComBotCallbackConfig,
  WeComBotConfig,
  WeComCallbackQuery,
  WeComEncryptedBody,
  WsBotCallbackBody,
} from "../types";
import { BotWebSocketManager } from "./bot-ws";

export interface WeComBotThreadId {
  chatId: string;
}

type BotRawMessage = WsBotCallbackBody;

export function isCallbackConfig(config: WeComBotConfig): config is WeComBotCallbackConfig {
  return config.mode !== "websocket";
}

export class WeComBotAdapter implements Adapter<WeComBotThreadId, BotRawMessage> {
  readonly name = "wecom-bot";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private readonly formatConverter = new WeComFormatConverter();
  private wsManager: BotWebSocketManager | null = null;
  private readonly responseUrls = new Map<string, string>();
  private readonly reqIds = new Map<string, string>();

  constructor(private readonly config: WeComBotConfig) {
    this.userName = config.userName ?? "WeCom Bot";
  }

  encodeThreadId(data: WeComBotThreadId): string {
    if (isCallbackConfig(this.config)) {
      return `wecom-bot:${data.chatId}`;
    }
    return `wecom-bot-ws:${data.chatId}`;
  }

  decodeThreadId(threadId: string): WeComBotThreadId {
    if (threadId.startsWith("wecom-bot-ws:")) {
      return { chatId: threadId.slice("wecom-bot-ws:".length) };
    }
    return { chatId: threadId.slice("wecom-bot:".length) };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).chatId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (isCallbackConfig(this.config)) return;

    this.wsManager = new BotWebSocketManager(this.config);
    this.wsManager.onMessage((body, reqId) => {
      if (!this.chat) return;
      const threadId = this.encodeThreadId({
        chatId: body.chatid ?? body.from.userid,
      });

      this.reqIds.set(threadId, reqId);

      if (body.response_url) {
        this.responseUrls.set(threadId, body.response_url);
      }

      void this.chat.processMessage(this, threadId, async () => this.parseMessage(body));
    });

    await this.wsManager.connect();
  }

  // https://developer.work.weixin.qq.com/document/path/100719
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (!isCallbackConfig(this.config)) {
      return new Response("ok", { status: 200 });
    }

    const url = new URL(request.url);
    const query: WeComCallbackQuery = {
      msg_signature: url.searchParams.get("msg_signature") ?? "",
      timestamp: url.searchParams.get("timestamp") ?? "",
      nonce: url.searchParams.get("nonce") ?? "",
      echostr: url.searchParams.get("echostr") ?? undefined,
    };

    // GET: 验证 URL
    if (request.method === "GET") {
      if (!query.echostr) {
        return new Response("Bad Request", { status: 400 });
      }
      const echo = await verifyUrl(this.config.token, this.config.encodingAESKey, query);
      return new Response(echo, { status: 200 });
    }

    // POST: 回调事件 (JSON body)
    const body = (await request.json()) as WeComEncryptedBody;
    const decrypted = await decryptCallback(
      this.config.token,
      this.config.encodingAESKey,
      body,
      query,
    );

    const callbackBody = JSON.parse(decrypted) as WsBotCallbackBody;

    if (this.chat && callbackBody.msgtype !== "event") {
      const chatId = callbackBody.chatid ?? callbackBody.from.userid;
      const threadId = this.encodeThreadId({ chatId });

      if (callbackBody.response_url) {
        this.responseUrls.set(threadId, callbackBody.response_url);
      }

      void this.chat.processMessage(
        this,
        threadId,
        async () => this.parseMessage(callbackBody),
        options,
      );
    }

    const encryptedReply = await encryptReply(
      this.config.token,
      this.config.encodingAESKey,
      "success",
    );
    return new Response(JSON.stringify(encryptedReply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 回调模式通过 response_url 回复，WS 模式通过 aibot_send_msg 或 aibot_respond_msg 发送
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    const card = extractCard(message);
    const text = this.formatConverter.renderPostable(message);

    if (this.wsManager) {
      const { chatId } = this.decodeThreadId(threadId);

      // WS 模式: 分块上传媒体文件，通过 respond_msg 回复
      const files = extractFiles(message);
      const reqId = this.reqIds.get(threadId);
      if (files.length > 0 && reqId) {
        const file = files[0];
        const buffer = Buffer.isBuffer(file.data)
          ? file.data
          : Buffer.from(file.data as ArrayBuffer);
        const mediaType = inferMediaType(file.filename, file.mimeType);
        const mediaId = await this.wsManager.uploadMedia(mediaType, file.filename, buffer);
        this.wsManager.respondMessage(reqId, mediaType, { media_id: mediaId });
        return { id: String(Date.now()), raw: {} as BotRawMessage, threadId };
      }

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

    // 回调模式：卡片或 markdown
    const responseUrl = this.responseUrls.get(threadId);
    if (!responseUrl) {
      throw new Error("wecom-bot: no response_url available for this thread");
    }

    const fetchFn = (this.config as WeComBotCallbackConfig).fetch ?? globalThis.fetch;
    const replyBody = card
      ? { msgtype: "template_card", template_card: cardToTemplateCard(card) }
      : { msgtype: "markdown", markdown: { content: text } };

    const response = await fetchFn(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replyBody),
    });

    const result = (await response.json()) as WeComBaseResponse;
    return {
      id: String(Date.now()),
      raw: result as unknown as BotRawMessage,
      threadId,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    throw new NotImplementedError("wecom-bot: editMessage not supported");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("wecom-bot: deleteMessage not supported");
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<BotRawMessage>> {
    throw new NotImplementedError("wecom-bot: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("wecom-bot: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot: removeReaction not supported");
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {}

  parseMessage(raw: WsBotCallbackBody): Message<BotRawMessage> {
    const chatId = raw.chatid ?? raw.from.userid;
    return new Message({
      id: raw.msgid,
      threadId: this.encodeThreadId({ chatId }),
      text: raw.text?.content ?? "",
      formatted: this.formatConverter.toAst(raw.text?.content ?? ""),
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
      fetchMetadata: { aeskey: raw.image.aeskey },
    });
  }
  if (raw.voice) {
    attachments.push({
      type: "audio",
      url: raw.voice.url,
      fetchMetadata: { aeskey: raw.voice.aeskey },
    });
  }
  if (raw.file) {
    attachments.push({
      type: "file",
      url: raw.file.url,
      name: raw.file.filename,
      size: raw.file.filesize,
      fetchMetadata: { aeskey: raw.file.aeskey },
    });
  }
  if (raw.video) {
    attachments.push({
      type: "video",
      url: raw.video.url,
      fetchMetadata: { aeskey: raw.video.aeskey },
    });
  }
  return attachments;
}

export function createWeComBotAdapter(config: WeComBotConfig) {
  return new WeComBotAdapter(config);
}
