// 企业微信共享类型定义
// 涵盖三种集成模式: Webhook (群机器人)、Bot (智能机器人)、App (应用)

// --- 基础响应 ---

export interface WeComBaseResponse {
  errcode: number;
  errmsg: string;
}

// --- Webhook (群机器人) message types ---

export interface WeComWebhookTextMessage {
  msgtype: "text";
  text: {
    content: string;
    mentioned_list?: string[];
    mentioned_mobile_list?: string[];
  };
}

export interface WeComWebhookMarkdownMessage {
  msgtype: "markdown";
  markdown: { content: string };
}

export interface WeComWebhookImageMessage {
  msgtype: "image";
  image: { base64: string; md5: string };
}

export interface WeComWebhookNewsMessage {
  msgtype: "news";
  news: {
    articles: Array<{
      title: string;
      description?: string;
      url: string;
      picurl?: string;
    }>;
  };
}

export interface WeComWebhookFileMessage {
  msgtype: "file";
  file: { media_id: string };
}

export interface WeComWebhookVoiceMessage {
  msgtype: "voice";
  voice: { media_id: string };
}

export interface WeComWebhookTemplateCardMessage {
  msgtype: "template_card";
  template_card: Record<string, unknown>;
}

export type WeComWebhookMessage =
  | WeComWebhookTextMessage
  | WeComWebhookMarkdownMessage
  | WeComWebhookImageMessage
  | WeComWebhookNewsMessage
  | WeComWebhookFileMessage
  | WeComWebhookVoiceMessage
  | WeComWebhookTemplateCardMessage;

// --- Bot (智能机器人) callback types (回调URL模式) ---

export interface WeComCallbackQuery {
  msg_signature: string;
  timestamp: string;
  nonce: string;
  echostr?: string;
}

export interface WeComEncryptedBody {
  encrypt: string;
}

export interface WeComEncryptedReply {
  encrypt: string;
  msgsignature: string;
  timestamp: number;
  nonce: string;
}

// --- Bot (智能机器人) WebSocket 长连接类型 ---
// https://developer.work.weixin.qq.com/document/path/101463

export interface WsFrame<T = unknown> {
  cmd?: string;
  headers: { req_id: string };
  body?: T;
  errcode?: number;
  errmsg?: string;
}

export interface WsBotCallbackBody {
  msgid: string;
  aibotid: string;
  chatid?: string;
  chattype: "single" | "group";
  from: { userid: string; corpid?: string };
  create_time?: number;
  response_url?: string;
  msgtype: "text" | "image" | "mixed" | "voice" | "file" | "video" | "event";
  text?: { content: string };
  image?: { url: string; aeskey: string };
  event?: { eventtype: string };
}

// --- App (应用) message types ---

export interface WeComAppMessageBase {
  touser?: string;
  toparty?: string;
  totag?: string;
  safe?: 0 | 1;
  enable_id_trans?: 0 | 1;
  enable_duplicate_check?: 0 | 1;
  duplicate_check_interval?: number;
}

export type WeComAppMessage = WeComAppMessageBase & {
  agentid: number;
} & (
    | { msgtype: "text"; text: { content: string } }
    | { msgtype: "markdown"; markdown: { content: string } }
    | { msgtype: "image"; image: { media_id: string } }
    | { msgtype: "voice"; voice: { media_id: string } }
    | {
        msgtype: "video";
        video: { media_id: string; title?: string; description?: string };
      }
    | { msgtype: "file"; file: { media_id: string } }
    | {
        msgtype: "textcard";
        textcard: {
          title: string;
          description: string;
          url: string;
          btntxt?: string;
        };
      }
    | {
        msgtype: "news";
        news: {
          articles: Array<{
            title: string;
            description?: string;
            url: string;
            picurl?: string;
          }>;
        };
      }
    | {
        msgtype: "mpnews";
        mpnews: {
          articles: Array<{
            title: string;
            thumb_media_id: string;
            author?: string;
            content_source_url?: string;
            content: string;
            digest?: string;
          }>;
        };
      }
    | { msgtype: "miniprogram_notice"; miniprogram_notice: Record<string, unknown> }
    | { msgtype: "template_card"; template_card: Record<string, unknown> }
  );

// --- App (应用) 回调 XML 消息 ---
// https://developer.work.weixin.qq.com/document/path/90930
// 解密后的 XML 消息结构

export interface WeComAppCallbackMessage {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: string;
  content?: string;
  msgId?: string;
  picUrl?: string;
  mediaId?: string;
  event?: string;
  agentId?: string;
}

export interface WeComAppSendResponse extends WeComBaseResponse {
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
  unlicenseduser?: string;
  msgid?: string;
  response_code?: string;
}

export interface WeComAccessTokenResponse extends WeComBaseResponse {
  access_token?: string;
  expires_in?: number;
}

// --- Config types ---

export interface WeComWebhookConfig {
  key: string;
  userName?: string;
  fetch?: typeof globalThis.fetch;
}

// https://developer.work.weixin.qq.com/document/path/100719
export interface WeComBotCallbackConfig {
  mode?: "callback";
  token: string;
  encodingAESKey: string;
  userName?: string;
  fetch?: typeof globalThis.fetch;
}

// https://developer.work.weixin.qq.com/document/path/101463
export interface WeComBotWebSocketConfig {
  mode: "websocket";
  botId: string;
  secret: string;
  userName?: string;
  wsUrl?: string;
  WebSocket?: typeof globalThis.WebSocket;
}

export type WeComBotConfig = WeComBotCallbackConfig | WeComBotWebSocketConfig;

export interface WeComAppConfig {
  corpId: string;
  corpSecret: string;
  agentId: number;
  token?: string;
  encodingAESKey?: string;
  userName?: string;
  fetch?: typeof globalThis.fetch;
}
