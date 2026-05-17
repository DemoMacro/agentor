// https://developer.work.weixin.qq.com/document/path/91770
// 群机器人 Webhook: 单向推送消息到群聊

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
import { WeComFormatConverter } from "../format";
import type { WeComBaseResponse, WeComWebhookConfig, WeComWebhookMessage } from "../types";
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
    const text = this.formatConverter.renderPostable(message);

    const result = await wecomRequest<WeComBaseResponse>({
      method: "POST",
      url: "/cgi-bin/webhook/send",
      params: { key },
      body: {
        msgtype: "markdown",
        markdown: { content: text },
      } as WeComWebhookMessage,
      fetch: this.config.fetch,
    });

    return { id: String(Date.now()), raw: result, threadId };
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

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Webhook 不支持输入状态指示
  }

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
