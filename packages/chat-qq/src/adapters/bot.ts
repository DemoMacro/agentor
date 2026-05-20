// https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html
// QQ Bot: 支持 Webhook 回调和 WebSocket 长连接两种模式

import { extractFiles, extractPostableAttachments } from "@chat-adapter/shared";
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

import { signCallbackValidation, verifyEventSignature } from "../crypto";
import { QQBotFormatConverter } from "../format";
import type {
  QQBotBaseResponse,
  QQBotCallbackConfig,
  QQBotConfig,
  QQBotSendMessageResponse,
  QQC2CMessageEvent,
  QQChannelMessageEvent,
  QQGroupMessageEvent,
  QQMessageEvent,
  QQMessageScene,
} from "../types";
import { QQBotOpCode } from "../types";
import { getAppAccessToken, qqBotRequest, uploadRichMedia } from "../utils";
import { QQBotWebSocketManager } from "./bot-ws";

export interface QQBotThreadId {
  scene: QQMessageScene;
  id: string;
}

type BotRawMessage = QQMessageEvent;

export function isCallbackConfig(config: QQBotConfig): config is QQBotCallbackConfig {
  return config.mode !== "websocket";
}

export class QQBotAdapter implements Adapter<QQBotThreadId, BotRawMessage> {
  readonly name = "qq-bot";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private readonly formatConverter = new QQBotFormatConverter();
  private wsManager: QQBotWebSocketManager | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  // 存储最近收到的消息 ID，用于被动回复
  private readonly lastMsgIds = new Map<string, string>();
  private readonly msgSeqCounters = new Map<string, number>();

  constructor(private readonly config: QQBotConfig) {
    this.userName = config.userName ?? "QQ Bot";
  }

  encodeThreadId(data: QQBotThreadId): string {
    return `qq-bot:${data.scene}:${data.id}`;
  }

  decodeThreadId(threadId: string): QQBotThreadId {
    const parts = threadId.split(":");
    return { scene: parts[1] as QQMessageScene, id: parts.slice(2).join(":") };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).id;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (isCallbackConfig(this.config)) return;

    this.wsManager = new QQBotWebSocketManager(this.config, () => this.getAccessToken());
    this.wsManager.onMessage((eventType, data) => {
      if (!this.chat) return;

      const result = parseEventType(eventType, data);
      if (!result) return;

      const { threadId, event } = result;
      this.lastMsgIds.set(threadId, event.id);

      void this.chat.processMessage(this, threadId, async () => this.parseMessage(event));
    });

    await this.wsManager.connect();
  }

  // https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html
  // Webhook 回调模式: 支持 OpCode 13 (验证) 和 OpCode 0 (事件推送)
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    if (!isCallbackConfig(this.config)) {
      return new Response("ok", { status: 200 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await request.text();

    // 验证 Ed25519 签名
    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (signature && timestamp) {
      const valid = verifyEventSignature(this.config.clientSecret, signature, timestamp, body);
      if (!valid) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const payload = JSON.parse(body) as { op?: number; t?: string; d?: unknown; id?: string };

    // OpCode 13: 回调地址验证
    if (payload.op === QQBotOpCode.CALLBACK_VERIFICATION) {
      const d = payload.d as { plain_token: string; event_ts: string };
      const sig = signCallbackValidation(this.config.clientSecret, d.plain_token, d.event_ts);
      return new Response(JSON.stringify({ plain_token: d.plain_token, signature: sig }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // OpCode 0: 事件推送
    const eventType = payload.t ?? "";
    const eventData = payload.d;

    if (this.chat && eventData && eventType) {
      const result = parseEventType(eventType, eventData);
      if (result) {
        const { threadId, event } = result;
        this.lastMsgIds.set(threadId, event.id);

        void this.chat.processMessage(
          this,
          threadId,
          async () => this.parseMessage(event),
          options,
        );
      }
    }

    // OpCode 12: HTTP Callback ACK
    return new Response(JSON.stringify({ op: QQBotOpCode.HTTP_CALLBACK_ACK, d: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    const { scene, id } = this.decodeThreadId(threadId);
    const token = await this.getAccessToken();

    const text = this.formatConverter.renderPostable(message);
    const msgId = this.lastMsgIds.get(threadId);
    const msgSeq = this.getNextMsgSeq(threadId);
    const sandbox = !isCallbackConfig(this.config) && this.config.sandbox;
    const fetchFn = this.config.fetch;

    // 优先处理 FileUpload (带二进制数据)
    const files = extractFiles(message);
    if (files.length > 0) {
      const fileType = inferFileType(files[0].filename, files[0].mimeType);
      if (!isSupportedMedia(scene, fileType)) {
        return this.sendTextMessage(
          threadId,
          text || `${scene} 场景不支持发送该类型文件`,
          token,
          msgId,
          msgSeq,
          sandbox,
          fetchFn,
        );
      }
      return this.sendFileMessage(
        threadId,
        scene,
        id,
        text,
        files[0],
        fileType,
        token,
        msgId,
        msgSeq,
        sandbox,
        fetchFn,
      );
    }

    // 其次处理 URL 附件 (收到的图片/视频/语音/文件，只有 URL)
    const attachments = extractPostableAttachments(message);
    const mediaAtt = attachments.find((a) => a.url);
    if (mediaAtt) {
      const fileType = attachmentTypeToFileType(mediaAtt);
      if (!isSupportedMedia(scene, fileType)) {
        return this.sendTextMessage(
          threadId,
          text || `${scene} 场景不支持发送该类型文件`,
          token,
          msgId,
          msgSeq,
          sandbox,
          fetchFn,
        );
      }
      return this.sendUrlMediaMessage(
        threadId,
        scene,
        id,
        text,
        mediaAtt.url!,
        fileType,
        token,
        msgId,
        msgSeq,
        sandbox,
        fetchFn,
      );
    }

    // 纯文本消息
    return this.sendTextMessage(threadId, text, token, msgId, msgSeq, sandbox, fetchFn);
  }

  // 通过 base64 上传并发送本地文件
  private async sendFileMessage(
    threadId: string,
    scene: QQMessageScene,
    id: string,
    text: string,
    file: { data: Buffer | Blob | ArrayBuffer; filename: string; mimeType?: string },
    fileType: number,
    token: string,
    msgId: string | undefined,
    msgSeq: number,
    sandbox: boolean | undefined,
    fetchFn: typeof globalThis.fetch | undefined,
  ): Promise<RawMessage<BotRawMessage>> {
    const uploadUrl = this.getUploadUrl(scene, id);
    if (!uploadUrl) {
      return this.sendTextMessage(
        threadId,
        text || "不支持发送文件",
        token,
        msgId,
        msgSeq,
        sandbox,
        fetchFn,
      );
    }

    const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data as ArrayBuffer);
    const uploadResult = await uploadRichMedia(
      { url: uploadUrl, file_type: fileType, file_data: buffer.toString("base64") },
      token,
      sandbox,
      fetchFn,
    );

    return this.sendMediaMessage(
      threadId,
      scene,
      id,
      text,
      uploadResult.file_info,
      token,
      msgId,
      msgSeq,
      sandbox,
      fetchFn,
    );
  }

  // 通过 URL 上传并发送远程媒体
  private async sendUrlMediaMessage(
    threadId: string,
    scene: QQMessageScene,
    id: string,
    text: string,
    mediaUrl: string,
    fileType: number,
    token: string,
    msgId: string | undefined,
    msgSeq: number,
    sandbox: boolean | undefined,
    fetchFn: typeof globalThis.fetch | undefined,
  ): Promise<RawMessage<BotRawMessage>> {
    const uploadUrl = this.getUploadUrl(scene, id);
    if (!uploadUrl) {
      return this.sendTextMessage(
        threadId,
        text || "不支持发送媒体",
        token,
        msgId,
        msgSeq,
        sandbox,
        fetchFn,
      );
    }

    // 附件 url 可能是相对路径，需要拼接 CDN 域名
    const resolvedUrl = resolveMediaUrl(mediaUrl);
    const uploadResult = await uploadRichMedia(
      { url: uploadUrl, file_type: fileType, media_url: resolvedUrl },
      token,
      sandbox,
      fetchFn,
    );

    return this.sendMediaMessage(
      threadId,
      scene,
      id,
      text,
      uploadResult.file_info,
      token,
      msgId,
      msgSeq,
      sandbox,
      fetchFn,
    );
  }

  // 用 file_info 发送富媒体消息
  private async sendMediaMessage(
    threadId: string,
    scene: QQMessageScene,
    id: string,
    text: string,
    fileInfo: string | undefined,
    token: string,
    msgId: string | undefined,
    msgSeq: number,
    sandbox: boolean | undefined,
    fetchFn: typeof globalThis.fetch | undefined,
  ): Promise<RawMessage<BotRawMessage>> {
    if (!fileInfo) {
      return this.sendTextMessage(
        threadId,
        text || "文件上传失败",
        token,
        msgId,
        msgSeq,
        sandbox,
        fetchFn,
      );
    }

    const sendBody: Record<string, unknown> = {
      content: text || " ",
      msg_type: 7,
      media: { file_info: fileInfo },
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq } : {}),
    };

    const sendUrl = this.getSendUrl(scene, id);
    const result = await qqBotRequest<QQBotSendMessageResponse & QQBotBaseResponse>({
      method: "POST",
      url: sendUrl,
      body: sendBody,
      token,
      sandbox,
      fetch: fetchFn,
    });

    return { id: result.id ?? String(Date.now()), raw: {} as BotRawMessage, threadId };
  }

  private async sendTextMessage(
    threadId: string,
    text: string,
    token: string,
    msgId: string | undefined,
    msgSeq: number,
    sandbox: boolean | undefined,
    fetchFn: typeof globalThis.fetch | undefined,
  ): Promise<RawMessage<BotRawMessage>> {
    if (!text) {
      return { id: String(Date.now()), raw: {} as BotRawMessage, threadId };
    }

    const { scene, id } = this.decodeThreadId(threadId);
    const sendBody: Record<string, unknown> = {
      content: text,
      msg_type: 0,
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq } : {}),
    };

    const url = this.getSendUrl(scene, id);
    const result = await qqBotRequest<QQBotSendMessageResponse & QQBotBaseResponse>({
      method: "POST",
      url,
      body: sendBody,
      token,
      sandbox,
      fetch: fetchFn,
    });

    return { id: result.id ?? String(Date.now()), raw: {} as BotRawMessage, threadId };
  }

  private getSendUrl(scene: QQMessageScene, id: string): string {
    switch (scene) {
      case "c2c":
        return `/v2/users/${id}/messages`;
      case "group":
        return `/v2/groups/${id}/messages`;
      case "channel":
        return `/channels/${id}/messages`;
      case "direct":
        return `/dms/${id}/messages`;
      default:
        throw new Error("qq-bot: unknown scene");
    }
  }

  private getUploadUrl(scene: QQMessageScene, id: string): string | null {
    switch (scene) {
      case "c2c":
        return `/v2/users/${id}/files`;
      case "group":
        return `/v2/groups/${id}/files`;
      default:
        return null;
    }
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    throw new NotImplementedError("qq-bot: editMessage not supported");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("qq-bot: deleteMessage not supported");
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<BotRawMessage>> {
    throw new NotImplementedError("qq-bot: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("qq-bot: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("qq-bot: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("qq-bot: removeReaction not supported");
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {}

  parseMessage(raw: QQMessageEvent): Message<BotRawMessage> {
    const { threadId, userId, userName } = extractMessageMeta(raw);
    const text = raw.content ?? "";

    return new Message({
      id: raw.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId,
        userName,
        fullName: userName,
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(raw.timestamp), edited: false },
      attachments: parseAttachments(raw),
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const result = await getAppAccessToken(
      this.config.appId,
      this.config.clientSecret,
      this.config.fetch,
    );

    this.accessToken = result.access_token;
    this.tokenExpiresAt = Date.now() + result.expires_in * 1000 - 300_000;
    return this.accessToken;
  }

  private getNextMsgSeq(threadId: string): number {
    const current = this.msgSeqCounters.get(threadId) ?? 0;
    const next = current + 1;
    this.msgSeqCounters.set(threadId, next);
    return next;
  }

  async disconnect(): Promise<void> {
    this.wsManager?.disconnect();
  }
}

// --- 事件解析 ---

function encodeThreadId(scene: QQMessageScene, id: string): string {
  return `qq-bot:${scene}:${id}`;
}

function parseEventType(
  eventType: string,
  data: unknown,
): { threadId: string; event: QQMessageEvent } | null {
  const event = data as QQMessageEvent;

  switch (eventType) {
    case "C2C_MESSAGE_CREATE": {
      const e = event as QQC2CMessageEvent;
      return { threadId: encodeThreadId("c2c", e.author.user_openid), event };
    }
    case "GROUP_AT_MESSAGE_CREATE": {
      const e = event as QQGroupMessageEvent;
      return { threadId: encodeThreadId("group", e.group_openid), event };
    }
    case "AT_MESSAGE_CREATE":
    case "MESSAGE_CREATE": {
      const e = event as QQChannelMessageEvent;
      return { threadId: encodeThreadId("channel", e.channel_id), event };
    }
    case "DIRECT_MESSAGE_CREATE": {
      const e = event as QQChannelMessageEvent;
      return { threadId: encodeThreadId("direct", e.channel_id), event };
    }
    default:
      return null;
  }
}

function extractMessageMeta(raw: QQMessageEvent): {
  threadId: string;
  userId: string;
  userName: string;
} {
  // 群聊: 顶层有 group_openid
  if ("group_openid" in raw) {
    const e = raw as QQGroupMessageEvent;
    const id = e.author.member_openid;
    return { threadId: encodeThreadId("group", e.group_openid), userId: id, userName: id };
  }
  // 频道/私信: 顶层有 channel_id 和 guild_id
  if ("channel_id" in raw) {
    const e = raw as QQChannelMessageEvent;
    const userId = e.author.id ?? e.author.user_openid ?? "";
    return {
      threadId: encodeThreadId("channel", e.channel_id),
      userId,
      userName: e.author.username ?? userId,
    };
  }
  // C2C: author 中只有 user_openid
  const id = (raw as QQC2CMessageEvent).author.user_openid;
  return { threadId: encodeThreadId("c2c", id), userId: id, userName: id };
}

function parseAttachments(raw: QQMessageEvent): Attachment[] {
  if (!raw.attachments || raw.attachments.length === 0) return [];

  return raw.attachments.map((att) => {
    // content_type: "image/jpeg"|"image/png"|"image/gif"|"file"|"video/mp4"|"voice"
    const ct = att.content_type ?? "";
    let type: Attachment["type"];
    if (ct.startsWith("image/")) type = "image";
    else if (ct.startsWith("video/")) type = "video";
    else if (ct === "voice") type = "audio";
    else type = "file";

    return {
      type,
      ...(att.url ? { url: att.url } : {}),
      ...(att.filename ? { name: att.filename } : {}),
      ...(att.size ? { size: att.size } : {}),
    } as Attachment;
  });
}

// --- 文件类型推断 ---

// QQ Bot file_type: 1=图片, 2=视频, 3=语音, 4=文件
function inferFileType(filename: string, mimeType?: string): number {
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(filename)) return 1;
  if (mimeType?.startsWith("video/") || /\.(mp4|mov|avi)$/i.test(filename)) return 2;
  if (mimeType?.startsWith("audio/") || /\.(silk|wav|mp3|flac)$/i.test(filename)) return 3;
  return 4;
}

// Attachment.type → QQ Bot file_type
function attachmentTypeToFileType(att: Attachment): number {
  switch (att.type) {
    case "image":
      return 1;
    case "video":
      return 2;
    case "audio":
      return 3;
    default:
      return 4;
  }
}

// https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/media.html
// 各场景支持的 file_type:
//   C2C:     1(图片), 2(视频), 3(语音), 4(文件)
//   Group:   1(图片), 2(视频), 3(语音)          — 4(文件)暂不开放
//   Channel: 1(图片), 2(视频)                   — 无上传接口
//   Direct:  1(图片), 2(视频)                   — 无上传接口
function isSupportedMedia(scene: QQMessageScene, fileType: number): boolean {
  switch (scene) {
    case "c2c":
      return fileType >= 1 && fileType <= 4;
    case "group":
      return fileType >= 1 && fileType <= 3;
    case "channel":
    case "direct":
      return fileType === 1 || fileType === 2;
    default:
      return false;
  }
}

// QQ Bot 附件 url 可能是相对路径（如 /download/xxx），需拼接 CDN 域名
// 如果已经是绝对 URL（http:// 或 https://），直接返回
const QQ_MEDIA_CDN = "https://multimedia.nt.qq.com";

function resolveMediaUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${QQ_MEDIA_CDN}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function createQQBotAdapter(config: QQBotConfig) {
  return new QQBotAdapter(config);
}
