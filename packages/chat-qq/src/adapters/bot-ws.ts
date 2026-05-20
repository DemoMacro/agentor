// https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/ws.html
// QQ Bot WebSocket 长连接管理器

import type { QQBotReadyData, QQBotWebSocketConfig, QQBotWsFrame } from "../types";
import { QQBotOpCode, DEFAULT_INTENTS } from "../types";

const DEFAULT_WS_URL = "wss://api.sgroup.qq.com/websocket/";
const MAX_MISSED_ACK = 3;
const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

type MessageHandler = (event: string, data: unknown) => void;

export class QQBotWebSocketManager {
  private readonly config: QQBotWebSocketConfig;
  private readonly wsUrl: string;
  private readonly WebSocketCtor: typeof globalThis.WebSocket;
  private readonly getToken: () => Promise<string>;

  private ws: WebSocket | null = null;
  private heartbeatInterval = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedAcks = 0;
  private reconnectAttempts = 0;
  private isManualClose = false;

  private sessionId: string | null = null;
  private lastSeq: number | null = null;

  private messageHandler: MessageHandler | null = null;

  constructor(config: QQBotWebSocketConfig, getToken: () => Promise<string>) {
    this.config = config;
    this.getToken = getToken;
    this.wsUrl = config.wsUrl ?? DEFAULT_WS_URL;
    this.WebSocketCtor = config.WebSocket ?? globalThis.WebSocket;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isManualClose = false;
      const ws = new this.WebSocketCtor(this.wsUrl);
      this.ws = ws;

      ws.addEventListener("message", (event: MessageEvent) => {
        const frame: QQBotWsFrame = JSON.parse(event.data as string);

        // 记录最新序列号
        if (frame.s != null) {
          this.lastSeq = frame.s;
        }

        switch (frame.op) {
          // HELLO: 连接成功，开始鉴权
          case QQBotOpCode.HELLO: {
            const d = frame.d as { heartbeat_interval: number };
            this.heartbeatInterval = d.heartbeat_interval;
            // 有 sessionId 和 lastSeq 时优先尝试 Resume
            if (this.sessionId && this.lastSeq != null) {
              void this.sendResume();
            } else {
              void this.sendIdentify();
            }
            break;
          }

          // DISPATCH: 事件推送
          case QQBotOpCode.DISPATCH: {
            if (frame.t === "READY") {
              const ready = frame.d as QQBotReadyData;
              this.sessionId = ready.session_id;
              this.reconnectAttempts = 0;
              this.missedAcks = 0;
              this.startHeartbeat();
              resolve();
            } else if (frame.t === "RESUMED") {
              this.reconnectAttempts = 0;
              this.missedAcks = 0;
              this.startHeartbeat();
            } else if (frame.t) {
              this.messageHandler?.(frame.t, frame.d);
            }
            break;
          }

          // HEARTBEAT_ACK: 心跳响应
          case QQBotOpCode.HEARTBEAT_ACK: {
            this.missedAcks = 0;
            break;
          }

          // RECONNECT: 服务端要求重连
          case QQBotOpCode.RECONNECT: {
            this.ws?.close();
            break;
          }

          // INVALID_SESSION: 鉴权失败，清除 session 重新连接
          case QQBotOpCode.INVALID_SESSION: {
            this.sessionId = null;
            this.lastSeq = null;
            this.ws?.close();
            break;
          }
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

  private async sendIdentify(): Promise<void> {
    const token = await this.getToken();
    const intents = this.config.intents ?? DEFAULT_INTENTS;
    this.sendFrame({
      op: QQBotOpCode.IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents,
        shard: [0, 1],
      },
    });
  }

  private async sendResume(): Promise<void> {
    if (!this.sessionId || this.lastSeq == null) return;
    const token = await this.getToken();
    this.sendFrame({
      op: QQBotOpCode.RESUME,
      d: {
        token: `QQBot ${token}`,
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    });
  }

  private sendFrame(frame: QQBotWsFrame): void {
    this.ws?.send(JSON.stringify(frame));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedAcks = 0;

    if (!this.heartbeatInterval) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.missedAcks >= MAX_MISSED_ACK) {
        this.ws?.close();
        return;
      }
      this.missedAcks++;
      this.sendFrame({
        op: QQBotOpCode.HEARTBEAT,
        d: this.lastSeq,
      });
    }, this.heartbeatInterval);
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
