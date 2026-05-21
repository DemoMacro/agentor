// https://developer.work.weixin.qq.com/document/path/90236
// 企业微信应用: 发送应用消息、接收回调事件、Token 管理
// 回调消息全程使用 XML 格式

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
import { decryptCallback, encryptReply, verifyUrl } from "../crypto";
import { WeComFormatConverter } from "../format";
import { inferMediaType, uploadAppMedia } from "../media";
import type {
  WeComAccessTokenResponse,
  WeComAppCallbackMessage,
  WeComAppConfig,
  WeComAppMessage,
  WeComAppSendResponse,
  WeComCallbackQuery,
} from "../types";
import { wecomRequest, extractXmlField } from "../utils";

export function parseCallbackXml(xml: string): WeComAppCallbackMessage {
  return {
    toUserName: extractXmlField(xml, "ToUserName") ?? "",
    fromUserName: extractXmlField(xml, "FromUserName") ?? "",
    createTime: Number(extractXmlField(xml, "CreateTime") ?? "0"),
    msgType: extractXmlField(xml, "MsgType") ?? "",
    content: extractXmlField(xml, "Content") ?? undefined,
    msgId: extractXmlField(xml, "MsgId") ?? undefined,
    picUrl: extractXmlField(xml, "PicUrl") ?? undefined,
    mediaId: extractXmlField(xml, "MediaId") ?? undefined,
    format: extractXmlField(xml, "Format") ?? undefined,
    recognition: extractXmlField(xml, "Recognition") ?? undefined,
    thumbMediaId: extractXmlField(xml, "ThumbMediaId") ?? undefined,
    fileName: extractXmlField(xml, "FileName") ?? undefined,
    fileSize: extractXmlField(xml, "FileSize")
      ? Number(extractXmlField(xml, "FileSize"))
      : undefined,
    locationX: extractXmlField(xml, "Location_X")
      ? Number(extractXmlField(xml, "Location_X"))
      : undefined,
    locationY: extractXmlField(xml, "Location_Y")
      ? Number(extractXmlField(xml, "Location_Y"))
      : undefined,
    scale: extractXmlField(xml, "Scale") ? Number(extractXmlField(xml, "Scale")) : undefined,
    label: extractXmlField(xml, "Label") ?? undefined,
    title: extractXmlField(xml, "Title") ?? undefined,
    description: extractXmlField(xml, "Description") ?? undefined,
    url: extractXmlField(xml, "Url") ?? undefined,
    event: extractXmlField(xml, "Event") ?? undefined,
    agentId: extractXmlField(xml, "AgentID") ?? undefined,
  };
}

export interface WeComAppThreadId {
  corpId: string;
  userId: string;
}

export class WeComAppAdapter implements Adapter<WeComAppThreadId, WeComAppCallbackMessage> {
  readonly name = "wecom-app";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private readonly formatConverter = new WeComFormatConverter();
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: WeComAppConfig) {
    this.userName = config.userName ?? "WeCom App";
  }

  encodeThreadId(data: WeComAppThreadId): string {
    return `wecom-app:${data.corpId}:${data.userId}`;
  }

  decodeThreadId(threadId: string): WeComAppThreadId {
    const parts = threadId.split(":");
    return { corpId: parts[1], userId: parts.slice(2).join(":") };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).userId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  // https://developer.work.weixin.qq.com/document/path/90930
  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
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
      const echo = await verifyUrl(
        this.config.token ?? "",
        this.config.encodingAESKey ?? "",
        query,
        this.config.corpId,
      );
      return new Response(echo, { status: 200 });
    }

    // POST: 回调事件 (XML body → 解密 → XML 消息)
    const outerXml = await request.text();
    const encrypt = extractXmlField(outerXml, "Encrypt");
    if (!encrypt) {
      return new Response("Bad Request", { status: 400 });
    }

    const decryptedXml = await decryptCallback(
      this.config.token ?? "",
      this.config.encodingAESKey ?? "",
      { encrypt },
      query,
      this.config.corpId,
    );

    const callbackMessage = parseCallbackXml(decryptedXml);

    if (this.chat && callbackMessage.msgType !== "event" && callbackMessage.msgType !== "") {
      const threadId = this.encodeThreadId({
        corpId: this.config.corpId,
        userId: callbackMessage.fromUserName,
      });
      void this.chat.processMessage(
        this,
        threadId,
        async () => this.parseMessage(callbackMessage),
        options,
      );
    }

    const encryptedReply = await encryptReply(
      this.config.token ?? "",
      this.config.encodingAESKey ?? "",
      "success",
      this.config.corpId,
    );

    return new Response(JSON.stringify(encryptedReply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // https://developer.work.weixin.qq.com/document/path/90236
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComAppCallbackMessage>> {
    const { userId } = this.decodeThreadId(threadId);
    const accessToken = await this.getAccessToken();

    // 卡片 → template_card
    const card = extractCard(message);
    if (card) {
      return this.sendTemplateCard(accessToken, userId, card);
    }

    // 文件 → 上传 → 媒体消息
    const files = extractFiles(message);
    if (files.length > 0) {
      const file = files[0];
      const mediaType = inferMediaType(file.filename, file.mimeType);
      const mediaId = await uploadAppMedia(accessToken, file, this.config.fetch);
      return this.sendMedia(accessToken, userId, mediaType, mediaId);
    }

    // 默认: markdown
    const text = this.formatConverter.renderPostable(message);
    return this.sendMarkdown(accessToken, userId, text);
  }

  private async sendMarkdown(
    accessToken: string,
    userId: string,
    content: string,
  ): Promise<RawMessage<WeComAppCallbackMessage>> {
    const appMessage: WeComAppMessage = {
      touser: userId,
      agentid: this.config.agentId,
      msgtype: "markdown",
      markdown: { content },
    };

    const result = await wecomRequest<WeComAppSendResponse>({
      method: "POST",
      url: "/cgi-bin/message/send",
      params: { access_token: accessToken },
      body: appMessage,
      fetch: this.config.fetch,
    });

    return {
      id: result.msgid ?? String(Date.now()),
      raw: {} as WeComAppCallbackMessage,
      threadId: `wecom-app:${this.config.corpId}:${userId}`,
    };
  }

  private async sendTemplateCard(
    accessToken: string,
    userId: string,
    card: Parameters<typeof cardToTemplateCard>[0],
  ): Promise<RawMessage<WeComAppCallbackMessage>> {
    const templateCard = cardToTemplateCard(card);
    const appMessage: WeComAppMessage = {
      touser: userId,
      agentid: this.config.agentId,
      msgtype: "template_card",
      template_card: templateCard,
    };

    const result = await wecomRequest<WeComAppSendResponse>({
      method: "POST",
      url: "/cgi-bin/message/send",
      params: { access_token: accessToken },
      body: appMessage,
      fetch: this.config.fetch,
    });

    return {
      id: result.msgid ?? String(Date.now()),
      raw: {} as WeComAppCallbackMessage,
      threadId: `wecom-app:${this.config.corpId}:${userId}`,
    };
  }

  private async sendMedia(
    accessToken: string,
    userId: string,
    mediaType: "image" | "voice" | "video" | "file",
    mediaId: string,
  ): Promise<RawMessage<WeComAppCallbackMessage>> {
    const threadId = `wecom-app:${this.config.corpId}:${userId}`;

    let appMessage: WeComAppMessage;
    switch (mediaType) {
      case "image":
        appMessage = {
          touser: userId,
          agentid: this.config.agentId,
          msgtype: "image",
          image: { media_id: mediaId },
        };
        break;
      case "voice":
        appMessage = {
          touser: userId,
          agentid: this.config.agentId,
          msgtype: "voice",
          voice: { media_id: mediaId },
        };
        break;
      case "video":
        appMessage = {
          touser: userId,
          agentid: this.config.agentId,
          msgtype: "video",
          video: { media_id: mediaId },
        };
        break;
      default:
        appMessage = {
          touser: userId,
          agentid: this.config.agentId,
          msgtype: "file",
          file: { media_id: mediaId },
        };
    }

    const result = await wecomRequest<WeComAppSendResponse>({
      method: "POST",
      url: "/cgi-bin/message/send",
      params: { access_token: accessToken },
      body: appMessage,
      fetch: this.config.fetch,
    });

    return {
      id: result.msgid ?? String(Date.now()),
      raw: {} as WeComAppCallbackMessage,
      threadId,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComAppCallbackMessage>> {
    throw new NotImplementedError("wecom-app: editMessage not supported");
  }

  // https://developer.work.weixin.qq.com/document/path/94867
  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    await wecomRequest({
      method: "POST",
      url: "/cgi-bin/message/recall",
      params: { access_token: accessToken },
      body: { msgid: messageId },
      fetch: this.config.fetch,
    });
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WeComAppCallbackMessage>> {
    throw new NotImplementedError("wecom-app: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("wecom-app: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-app: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-app: removeReaction not supported");
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {}

  parseMessage(raw: WeComAppCallbackMessage): Message<WeComAppCallbackMessage> {
    const text = extractMessageText(raw);
    return new Message({
      id: raw.msgId ?? String(Date.now()),
      threadId: this.encodeThreadId({
        corpId: this.config.corpId,
        userId: raw.fromUserName,
      }),
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId: raw.fromUserName,
        userName: raw.fromUserName,
        fullName: raw.fromUserName,
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(raw.createTime * 1000), edited: false },
      attachments: parseAppAttachments(raw),
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // https://developer.work.weixin.qq.com/document/path/91039
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const result = await wecomRequest<WeComAccessTokenResponse>({
      url: "/cgi-bin/gettoken",
      params: {
        corpid: this.config.corpId,
        corpsecret: this.config.corpSecret,
      },
      fetch: this.config.fetch,
    });

    this.accessToken = result.access_token!;
    this.tokenExpiresAt = Date.now() + (result.expires_in ?? 7200) * 1000 - 300_000;
    return this.accessToken;
  }
}

function extractMessageText(raw: WeComAppCallbackMessage): string {
  // 文本消息
  if (raw.content) return raw.content;
  // 语音识别结果
  if (raw.recognition) return raw.recognition;
  // 位置消息
  if (raw.msgType === "location" && raw.locationX != null && raw.locationY != null) {
    const parts = [raw.label ?? "位置分享"];
    parts.push(`${raw.locationX}, ${raw.locationY}`);
    if (raw.scale) parts.push(`缩放: ${raw.scale}`);
    return parts.join("\n");
  }
  // 链接消息
  if (raw.msgType === "link" && raw.title) {
    const parts = [raw.title];
    if (raw.description) parts.push(raw.description);
    if (raw.url) parts.push(raw.url);
    return parts.join("\n");
  }
  return "";
}

function parseAppAttachments(raw: WeComAppCallbackMessage): Attachment[] {
  const attachments: Attachment[] = [];

  if (raw.msgType === "image") {
    attachments.push({
      type: "image",
      ...(raw.picUrl ? { url: raw.picUrl } : {}),
      ...(raw.mediaId ? { fetchMetadata: { mediaId: raw.mediaId } } : {}),
    });
  }

  if (raw.msgType === "voice" && raw.mediaId) {
    const meta: Record<string, string> = { mediaId: raw.mediaId };
    if (raw.format) meta.format = raw.format;
    attachments.push({
      type: "audio",
      fetchMetadata: meta,
    });
  }

  if (raw.msgType === "video" && raw.mediaId) {
    attachments.push({
      type: "video",
      ...(raw.thumbMediaId
        ? { fetchMetadata: { mediaId: raw.mediaId, thumbMediaId: raw.thumbMediaId } }
        : { fetchMetadata: { mediaId: raw.mediaId } }),
    });
  }

  if (raw.msgType === "file" && raw.mediaId) {
    attachments.push({
      type: "file",
      fetchMetadata: { mediaId: raw.mediaId },
      ...(raw.fileName ? { name: raw.fileName } : {}),
      ...(raw.fileSize ? { size: raw.fileSize } : {}),
    });
  }

  // 链接消息附带缩略图
  if (raw.msgType === "link" && raw.picUrl) {
    attachments.push({ type: "image", url: raw.picUrl });
  }

  return attachments;
}

export function createWeComAppAdapter(config?: Partial<WeComAppConfig>): WeComAppAdapter {
  const corpId = config?.corpId ?? process.env.WECOM_APP_CORP_ID;
  const corpSecret = config?.corpSecret ?? process.env.WECOM_APP_CORP_SECRET;
  const agentId =
    config?.agentId ??
    (process.env.WECOM_APP_AGENT_ID ? Number(process.env.WECOM_APP_AGENT_ID) : undefined);

  if (!corpId) {
    throw new ValidationError(
      "wecom-app",
      "corpId is required. Pass it in config or set WECOM_APP_CORP_ID.",
    );
  }
  if (!corpSecret) {
    throw new ValidationError(
      "wecom-app",
      "corpSecret is required. Pass it in config or set WECOM_APP_CORP_SECRET.",
    );
  }
  if (!agentId) {
    throw new ValidationError(
      "wecom-app",
      "agentId is required. Pass it in config or set WECOM_APP_AGENT_ID.",
    );
  }

  return new WeComAppAdapter({
    corpId,
    corpSecret,
    agentId,
    token: config?.token ?? process.env.WECOM_APP_TOKEN,
    encodingAESKey: config?.encodingAESKey ?? process.env.WECOM_APP_ENCODING_AES_KEY,
    userName: config?.userName,
    fetch: config?.fetch,
  });
}
