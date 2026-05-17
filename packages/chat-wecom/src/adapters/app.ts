// https://developer.work.weixin.qq.com/document/path/90236
// 企业微信应用: 发送应用消息、接收回调事件、Token 管理
// 回调消息全程使用 XML 格式

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
import { decryptCallback, encryptReply, verifyUrl } from "../crypto";
import { WeComFormatConverter } from "../format";
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

    if (this.chat && callbackMessage.msgType === "text") {
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
    const text = this.formatConverter.renderPostable(message);
    const accessToken = await this.getAccessToken();

    const appMessage: WeComAppMessage = {
      touser: userId,
      agentid: this.config.agentId,
      msgtype: "text",
      text: { content: text },
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
    return new Message({
      id: raw.msgId ?? String(Date.now()),
      threadId: this.encodeThreadId({
        corpId: this.config.corpId,
        userId: raw.fromUserName,
      }),
      text: raw.content ?? "",
      formatted: this.formatConverter.toAst(raw.content ?? ""),
      raw,
      author: {
        userId: raw.fromUserName,
        userName: raw.fromUserName,
        fullName: raw.fromUserName,
        isBot: false,
        isMe: false,
      },
      metadata: { dateSent: new Date(raw.createTime * 1000), edited: false },
      attachments: [],
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

export function createWeComAppAdapter(config: WeComAppConfig) {
  return new WeComAppAdapter(config);
}
