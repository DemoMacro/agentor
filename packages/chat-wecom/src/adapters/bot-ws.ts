// https://developer.work.weixin.qq.com/document/path/101463
// 智能机器人 WebSocket 长连接管理器

import { randomBytes } from "node:crypto";
import type { WeComBotWebSocketConfig, WsBotCallbackBody, WsFrame } from "../types";

const DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_INTERVAL = 30_000;
const MAX_MISSED_PONG = 3;
const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

type MessageHandler = (body: WsBotCallbackBody, reqId: string) => void;
type EventHandler = (body: WsBotCallbackBody, reqId: string) => void;

export function generateReqId(prefix: string): string {
  const hex = randomBytes(4).toString("hex");
  return `${prefix}_${Date.now()}_${hex}`;
}

export class BotWebSocketManager {
  private readonly config: WeComBotWebSocketConfig;
  private readonly wsUrl: string;
  private readonly WebSocketCtor: typeof globalThis.WebSocket;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private reconnectAttempts = 0;
  private isManualClose = false;

  private messageHandler: MessageHandler | null = null;
  private eventHandler: EventHandler | null = null;

  constructor(config: WeComBotWebSocketConfig) {
    this.config = config;
    this.wsUrl = config.wsUrl ?? DEFAULT_WS_URL;
    this.WebSocketCtor = config.WebSocket ?? globalThis.WebSocket;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onEvent(handler: EventHandler): void {
    this.eventHandler = handler;
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

        // 认证响应
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

        // 心跳响应
        if (reqId.startsWith("ping_")) {
          this.missedPongs = 0;
          return;
        }

        // 消息回调
        if (frame.cmd === "aibot_msg_callback" && frame.body) {
          this.messageHandler?.(frame.body as WsBotCallbackBody, reqId);
          return;
        }

        // 事件回调
        if (frame.cmd === "aibot_event_callback" && frame.body) {
          const body = frame.body as WsBotCallbackBody;

          // disconnected_event 表示被新连接踢出，不触发重连
          if (body.event?.eventtype === "disconnected_event") {
            this.isManualClose = true;
            return;
          }

          this.eventHandler?.(body, reqId);
        }
      });

      ws.addEventListener("error", () => {
        reject(new Error("WebSocket connection error"));
      });

      ws.addEventListener("close", () => {
        this.stopHeartbeat();
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

  // https://developer.work.weixin.qq.com/document/path/101138
  sendMessage(chatId: string, msgtype: string, content: unknown): void {
    this.sendFrame("aibot_send_msg", {
      chatid: chatId,
      msgtype,
      [msgtype]: content,
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
