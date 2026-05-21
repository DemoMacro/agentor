// https://developer.work.weixin.qq.com/document/path/101039
// 智能机器人: 回调 URL 模式

import { extractCard, ValidationError } from "@chat-adapter/shared";
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
import type {
  WeComBaseResponse,
  WeComBotCallbackConfig,
  WeComBotThreadId,
  WeComCallbackQuery,
  WeComEncryptedBody,
  WsBotCallbackBody,
} from "../types";

type BotRawMessage = WsBotCallbackBody;

export class WeComBotCallbackAdapter implements Adapter<WeComBotThreadId, BotRawMessage> {
  readonly name = "wecom-bot-callback";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private readonly formatConverter = new WeComFormatConverter();
  private readonly responseUrls = new Map<string, string>();

  constructor(private readonly config: WeComBotCallbackConfig) {
    this.userName = config.userName ?? "WeCom Bot";
  }

  encodeThreadId(data: WeComBotThreadId): string {
    return `wecom-bot-callback:${data.chatId}`;
  }

  decodeThreadId(threadId: string): WeComBotThreadId {
    return { chatId: threadId.slice("wecom-bot-callback:".length) };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).chatId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  // https://developer.work.weixin.qq.com/document/path/100719
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

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<BotRawMessage>> {
    const card = extractCard(message);
    const text = this.formatConverter.renderPostable(message);

    const responseUrl = this.responseUrls.get(threadId);
    if (!responseUrl) {
      throw new Error("wecom-bot-callback: no response_url available for this thread");
    }

    const fetchFn = this.config.fetch ?? globalThis.fetch;
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
    throw new NotImplementedError("wecom-bot-callback: editMessage not supported");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-callback: deleteMessage not supported");
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<BotRawMessage>> {
    throw new NotImplementedError("wecom-bot-callback: fetchMessages not supported");
  }

  async fetchThread(_threadId: string): Promise<ThreadInfo> {
    throw new NotImplementedError("wecom-bot-callback: fetchThread not supported");
  }

  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-callback: addReaction not supported");
  }

  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    throw new NotImplementedError("wecom-bot-callback: removeReaction not supported");
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
      attachments: parseBotAttachments(raw, this.config.encodingAESKey),
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async disconnect(): Promise<void> {}
}

function parseBotAttachments(raw: WsBotCallbackBody, encodingAESKey?: string): Attachment[] {
  const attachments: Attachment[] = [];
  if (raw.image) {
    const aeskey = raw.image.aeskey ?? encodingAESKey;
    attachments.push({
      type: "image",
      url: raw.image.url,
      ...(aeskey ? { fetchMetadata: { aeskey } } : {}),
    });
  }
  // voice 只提供转录文本 (voice.content)，不含音频 URL，不创建 attachment
  if (raw.file) {
    const aeskey = raw.file.aeskey ?? encodingAESKey;
    attachments.push({
      type: "file",
      url: raw.file.url,
      ...(aeskey ? { fetchMetadata: { aeskey } } : {}),
    });
  }
  if (raw.video) {
    const aeskey = raw.video.aeskey ?? encodingAESKey;
    attachments.push({
      type: "video",
      url: raw.video.url,
      ...(aeskey ? { fetchMetadata: { aeskey } } : {}),
    });
  }
  // mixed 消息：从 msg_item 中提取图片子项
  if (raw.mixed?.msg_item) {
    for (const item of raw.mixed.msg_item) {
      if (item.msgtype === "image" && item.image) {
        const img = item.image as { url: string; aeskey?: string };
        const aeskey = img.aeskey ?? encodingAESKey;
        attachments.push({
          type: "image",
          url: img.url,
          ...(aeskey ? { fetchMetadata: { aeskey } } : {}),
        });
      }
    }
  }
  return attachments;
}

export function createWeComBotCallbackAdapter(
  config?: Partial<WeComBotCallbackConfig>,
): WeComBotCallbackAdapter {
  const token = config?.token ?? process.env.WECOM_BOT_TOKEN;
  const encodingAESKey = config?.encodingAESKey ?? process.env.WECOM_BOT_ENCODING_AES_KEY;

  if (!token) {
    throw new ValidationError(
      "wecom-bot-callback",
      "Token is required. Pass it in config or set WECOM_BOT_TOKEN.",
    );
  }
  if (!encodingAESKey) {
    throw new ValidationError(
      "wecom-bot-callback",
      "EncodingAESKey is required. Pass it in config or set WECOM_BOT_ENCODING_AES_KEY.",
    );
  }

  return new WeComBotCallbackAdapter({
    token,
    encodingAESKey,
    userName: config?.userName,
    fetch: config?.fetch,
  });
}
