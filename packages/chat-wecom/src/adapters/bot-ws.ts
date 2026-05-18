// https://developer.work.weixin.qq.com/document/path/101463
// 智能机器人 WebSocket 长连接管理器

import { createHash, randomBytes } from "node:crypto";

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
  private readonly pendingRequests = new Map<
    string,
    { resolve: (frame: WsFrame) => void; reject: (err: Error) => void }
  >();

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

        // 请求-响应模式: 上传等需要等待响应的操作
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          this.pendingRequests.delete(reqId);
          if (frame.errcode === 0) {
            pending.resolve(frame);
          } else {
            pending.reject(new Error(`Request failed: ${frame.errcode} ${frame.errmsg}`));
          }
          return;
        }

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
        for (const [id, pending] of this.pendingRequests) {
          this.pendingRequests.delete(id);
          pending.reject(new Error("WebSocket closed"));
        }
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

  // https://developer.work.weixin.qq.com/document/path/101463
  // 分块上传: init → chunk(s) → finish → media_id
  async uploadMedia(type: string, filename: string, buffer: Buffer): Promise<string> {
    const md5 = createHash("md5").update(buffer).digest("hex");
    const CHUNK_SIZE = 512 * 1024;
    const totalSize = buffer.length;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    const initFrame = await this.sendAndReceive("aibot_upload_media_init", {
      type,
      filename,
      total_size: totalSize,
      total_chunks: totalChunks,
      md5,
    });
    const { upload_id } = initFrame.body as { upload_id: string };

    for (let i = 0; i < totalChunks; i++) {
      const chunk = buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await this.sendAndReceive("aibot_upload_media_chunk", {
        upload_id,
        chunk_index: i,
        base64_data: chunk.toString("base64"),
      });
    }

    const finishFrame = await this.sendAndReceive("aibot_upload_media_finish", { upload_id });
    const result = finishFrame.body as { media_id: string };
    return result.media_id;
  }

  private sendAndReceive(cmd: string, body: unknown): Promise<WsFrame> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const reqId = generateReqId(cmd);
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`${cmd} timed out`));
      }, 60_000);
      this.pendingRequests.set(reqId, {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.sendFrame(cmd, body, reqId);
    });
  }

  // https://developer.work.weixin.qq.com/document/path/101138
  sendMessage(chatId: string, msgtype: string, content: unknown): void {
    const body: Record<string, unknown> = {
      chatid: chatId,
      msgtype,
    };
    // template_card 的结构是 { template_card: {...} }，其他是 { markdown: { content } }
    if (msgtype === "template_card") {
      body.template_card = content;
    } else {
      body[msgtype] = content;
    }
    this.sendFrame("aibot_send_msg", body);
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
