// https://developer.work.weixin.qq.com/document/path/91770
// 群机器人 Webhook: 单向推送消息到群聊

import { createHash } from "node:crypto";

import { extractCard, extractFiles, toBufferSync } from "@chat-adapter/shared";
import {
  Message,
  NotImplementedError,
  type Adapter,
  type AdapterPostableMessage,
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
import { inferMediaType, uploadWebhookMedia } from "../media";
import type { WeComBaseResponse, WeComTemplateCard, WeComWebhookConfig } from "../types";
import { wecomRequest } from "../utils";

export interface WeComWebhookThreadId {
  key: string;
}

export class WeComWebhookAdapter implements Adapter<WeComWebhookThreadId, WeComBaseResponse> {
  readonly name = "wecom-webhook";
  readonly userName: string;

  private readonly formatConverter = new WeComFormatConverter();

  constructor(private readonly config: WeComWebhookConfig) {
    this.userName = config.userName ?? "WeCom Webhook";
  }

  encodeThreadId(data: WeComWebhookThreadId): string {
    return `wecom-webhook:${data.key}`;
  }

  decodeThreadId(threadId: string): WeComWebhookThreadId {
    return { key: threadId.split(":").slice(1).join(":") };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).key;
  }

  async initialize(_chat: ChatInstance): Promise<void> {}

  // Webhook 为单向推送，不支持接收回调
  async handleWebhook(_request: Request, _options?: WebhookOptions): Promise<Response> {
    return new Response("OK", { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComBaseResponse>> {
    const { key } = this.decodeThreadId(threadId);

    // 卡片 → template_card
    const card = extractCard(message);
    if (card) {
      const templateCard = cardToTemplateCard(card);
      return this.sendTemplateCard(key, templateCard);
    }

    // 文件 → 媒体消息
    const files = extractFiles(message);
    if (files.length > 0) {
      const file = files[0];
      const mediaType = inferMediaType(file.filename, file.mimeType);

      if (mediaType === "image") {
        const buffer = toBufferSync(file.data, { platform: "wecom" as never });
        if (buffer) return this.sendImage(key, buffer);
      }

      const mediaId = await uploadWebhookMedia(key, file, this.config.fetch);
      // webhook 仅支持发送 voice 和 file，其余统一用 file
      const sendType = mediaType === "voice" ? "voice" : "file";
      return this.sendMedia(key, sendType, mediaId);
    }

    // 默认: markdown
    const text = this.formatConverter.renderPostable(message);
    return this.sendMarkdown(key, text);
  }

  private async sendMarkdown(key: string, content: string): Promise<RawMessage<WeComBaseResponse>> {
    const result = await wecomRequest<WeComBaseResponse>({
      method: "POST",
      url: "/cgi-bin/webhook/send",
      params: { key },
      body: { msgtype: "markdown", markdown: { content } },
      fetch: this.config.fetch,
    });
    return { id: String(Date.now()), raw: result, threadId: `wecom-webhook:${key}` };
  }

  private async sendTemplateCard(
    key: string,
    templateCard: WeComTemplateCard,
  ): Promise<RawMessage<WeComBaseResponse>> {
    const result = await wecomRequest<WeComBaseResponse>({
      method: "POST",
      url: "/cgi-bin/webhook/send",
      params: { key },
      body: { msgtype: "template_card", template_card: templateCard },
      fetch: this.config.fetch,
    });
    return { id: String(Date.now()), raw: result, threadId: `wecom-webhook:${key}` };
  }

  private async sendImage(key: string, buffer: Buffer): Promise<RawMessage<WeComBaseResponse>> {
    const base64 = buffer.toString("base64");
    const md5 = createHash("md5").update(buffer).digest("hex");
    const result = await wecomRequest<WeComBaseResponse>({
      method: "POST",
      url: "/cgi-bin/webhook/send",
      params: { key },
      body: { msgtype: "image", image: { base64, md5 } },
      fetch: this.config.fetch,
    });
    return { id: String(Date.now()), raw: result, threadId: `wecom-webhook:${key}` };
  }

  private async sendMedia(
    key: string,
    mediaType: "voice" | "file",
    mediaId: string,
  ): Promise<RawMessage<WeComBaseResponse>> {
    const body =
      mediaType === "voice"
        ? { msgtype: "voice", voice: { media_id: mediaId } }
        : { msgtype: "file", file: { media_id: mediaId } };

    const result = await wecomRequest<WeComBaseResponse>({
      method: "POST",
      url: "/cgi-bin/webhook/send",
      params: { key },
      body,
      fetch: this.config.fetch,
    });
    return { id: String(Date.now()), raw: result, threadId: `wecom-webhook:${key}` };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<WeComBaseResponse>> {
    throw new NotImplementedError("wecom-webhook: editMessage not supported");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("wecom-webhook: deleteMessage not supported");
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<WeComBaseResponse>> {
    throw new NotImplementedError("wecom-webhook: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("wecom-webhook: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-webhook: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-webhook: removeReaction not supported");
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {}

  parseMessage(raw: WeComBaseResponse): Message<WeComBaseResponse> {
    return new Message({
      id: String(Date.now()),
      threadId: "",
      text: raw.errmsg,
      formatted: { type: "root", children: [] },
      raw,
      author: {
        userId: "webhook",
        userName: "WeCom Webhook",
        fullName: "WeCom Webhook",
        isBot: true,
        isMe: true,
      },
      metadata: { dateSent: new Date(), edited: false },
      attachments: [],
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

export function createWeComWebhookAdapter(config: WeComWebhookConfig) {
  return new WeComWebhookAdapter(config);
}
