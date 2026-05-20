// QQ Bot 共享类型定义
// 涵盖两种集成模式: Webhook (回调) 和 WebSocket (长连接)

// --- 基础响应 ---

export interface QQBotBaseResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface QQBotSendMessageResponse {
  id: string;
  timestamp: number;
}

// --- WebSocket 帧 ---

export interface QQBotWsFrame {
  id?: string;
  op: number;
  s?: number;
  t?: string;
  d?: unknown;
}

// OpCode 枚举
export const QQBotOpCode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
  HTTP_CALLBACK_ACK: 12,
  CALLBACK_VERIFICATION: 13,
} as const;

// --- Intents ---

// https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/intents.html
export const QQBotIntent = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25,
  INTERACTION: 1 << 26,
  MESSAGE_AUDIT: 1 << 27,
  FORUMS_EVENT: 1 << 28,
  AUDIO_ACTION: 1 << 29,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
} as const;

// 默认订阅: 频道公开消息 + C2C/群聊消息
export const DEFAULT_INTENTS = QQBotIntent.PUBLIC_GUILD_MESSAGES | QQBotIntent.GROUP_AND_C2C_EVENT;

// --- 消息事件 ---

export type QQMessageScene = "c2c" | "group" | "channel" | "direct";

export interface QQMessageAttachment {
  content_type?: string; // "image/jpeg", "image/png", "image/gif", "file", "video/mp4", "voice"
  filename?: string; // 文件名
  url?: string; // 文件链接
  height?: number;
  width?: number;
  size?: number;
  voice_wav_url?: string; // 语音 wav 格式链接
  asr_refer_text?: string; // 语音识别结果
}

// 单聊消息事件 (C2C_MESSAGE_CREATE)
export interface QQC2CMessageEvent {
  id: string;
  author: {
    user_openid: string;
  };
  content: string;
  timestamp: string;
  attachments?: QQMessageAttachment[];
}

// 群聊 @消息事件 (GROUP_AT_MESSAGE_CREATE)
export interface QQGroupMessageEvent {
  id: string;
  author: {
    member_openid: string;
  };
  content: string;
  group_openid: string;
  timestamp: string;
  attachments?: QQMessageAttachment[];
}

// 频道 @消息事件 (AT_MESSAGE_CREATE)
export interface QQChannelMessageEvent {
  id: string;
  author: {
    user_openid?: string;
    id?: string;
    username?: string;
  };
  content: string;
  channel_id: string;
  guild_id: string;
  timestamp: string;
  attachments?: QQMessageAttachment[];
  mentions?: Array<{ id: string; username: string }>;
}

// 频道私信事件 (DIRECT_MESSAGE_CREATE)
export interface QQDirectMessageEvent {
  id: string;
  author: {
    id: string;
    username?: string;
  };
  content: string;
  channel_id: string;
  guild_id: string;
  timestamp: string;
  attachments?: QQMessageAttachment[];
}

// 统一消息事件
export type QQMessageEvent =
  | QQC2CMessageEvent
  | QQGroupMessageEvent
  | QQChannelMessageEvent
  | QQDirectMessageEvent;

// --- 发送消息 ---

export interface QQBotSendMessage {
  content?: string;
  msg_type: number;
  markdown?: unknown;
  keyboard?: unknown;
  ark?: unknown;
  embed?: unknown;
  media?: unknown;
  image?: string;
  message_reference?: unknown;
  msg_id?: string;
  msg_seq?: number;
  event_id?: string;
}

// --- 富媒体上传响应 ---

export interface QQBotUploadMediaResponse {
  file_uuid?: string;
  file_info?: string;
  ttl?: number;
  id?: string;
  code?: number;
  message?: string;
}

// --- Token 响应 ---

export interface QQBotTokenResponse {
  access_token: string;
  expires_in: number;
}

// --- Ready 事件 ---

export interface QQBotReadyData {
  version: number;
  session_id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
  shard: [number, number];
}

// --- Config types ---

export interface QQBotCallbackConfig {
  mode?: "callback";
  appId: string;
  clientSecret: string;
  userName?: string;
  fetch?: typeof globalThis.fetch;
}

export interface QQBotWebSocketConfig {
  mode: "websocket";
  appId: string;
  clientSecret: string;
  intents?: number;
  sandbox?: boolean;
  userName?: string;
  wsUrl?: string;
  WebSocket?: typeof globalThis.WebSocket;
  fetch?: typeof globalThis.fetch;
}

export type QQBotConfig = QQBotCallbackConfig | QQBotWebSocketConfig;
