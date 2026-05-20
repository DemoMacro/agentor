# @agentor/chat-qq

![npm version](https://img.shields.io/npm/v/@agentor/chat-qq)
![npm downloads](https://img.shields.io/npm/dw/@agentor/chat-qq)
![npm license](https://img.shields.io/npm/l/@agentor/chat-qq)

> [Chat SDK](https://github.com/DemoMacro/agentor) 适配器，用于 [QQ Bot (QQ机器人)](https://bot.q.qq.com/) 消息集成。

## 功能特性

- **WebSocket 长连接** — 直连 QQ Bot Gateway，无需公网端点
- **Webhook (回调 URL)** — 通过 HTTP 回调接收事件，支持 Ed25519 签名验证
- **多场景支持** — QQ 单聊 (C2C)、QQ 群聊、文字子频道、频道私信
- **富媒体支持** — 图片、视频、语音、文件的上传与发送
- **自动重连** — 指数退避重连 + Session 恢复 (Resume)

> **注意：** 成功配置 HTTPS 回调地址之后，WebSocket 长连接模式将不再支持，两者互斥。

## 安装

```bash
pnpm add @agentor/chat-qq
```

## 快速开始

### WebSocket 长连接模式

通过 WebSocket 直连 QQ Bot 服务，无需公网端点：

```typescript
import { createQQBotAdapter } from "@agentor/chat-qq";

const adapter = createQQBotAdapter({
  mode: "websocket",
  appId: process.env.QQ_BOT_APP_ID!,
  clientSecret: process.env.QQ_BOT_CLIENT_SECRET!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    await adapter.postMessage(threadId, message.text);
  },
});

// 断开连接
await adapter.disconnect();
```

### Webhook 回调模式

通过 HTTP 回调接收和回复消息，需要公网可达的端点：

```typescript
import { createQQBotAdapter } from "@agentor/chat-qq";
import { H3, fromWebHandler, serve } from "h3";

const adapter = createQQBotAdapter({
  appId: process.env.QQ_BOT_APP_ID!,
  clientSecret: process.env.QQ_BOT_CLIENT_SECRET!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    await adapter.postMessage(threadId, message.text);
  },
});

// 在 HTTP 服务器中处理回调
const app = new H3();
app.all(
  "/webhook",
  fromWebHandler((req) => adapter.handleWebhook(req)),
);
serve(app, { port: 3000 });
```

## 消息类型支持

### 接收消息

| 消息类型 | WebSocket | Webhook |
| -------- | --------- | ------- |
| 文本     | ✅        | ✅      |
| 图片     | ✅        | ✅      |
| 视频     | ✅        | ✅      |
| 语音     | ✅        | ✅      |
| 文件     | ✅        | ✅      |

### 发送消息

| 消息类型     | C2C 单聊 | 群聊 | 文字子频道 | 频道私信 |
| ------------ | -------- | ---- | ---------- | -------- |
| 文本         | ✅       | ✅   | ✅         | ✅       |
| 图片         | ✅       | ✅   | ✅         | ✅       |
| 视频         | ✅       | ✅   | ✅         | ✅       |
| 语音         | ✅       | ✅   | —          | —        |
| 文件         | ✅       | —    | —          | —        |
| Markdown     | ✅       | ✅   | ✅         | ✅       |
| 富媒体 (URL) | ✅       | ✅   | ✅         | ✅       |

> 群聊场景的文件上传 (file_type=4) 暂不开放。文字子频道和频道私信无独立的上传接口，但支持通过 `msg_type: 7` + `media` 发送图片和视频。

## 媒体文件处理

`postMessage` 会自动处理媒体上传流程：

- **本地文件** (`FileUpload`)：先转 base64 上传获取 `file_info`，再发送富媒体消息
- **URL 附件** (`Attachment` with URL)：先通过 URL 上传获取 `file_info`，再发送富媒体消息
- 不支持的场景会自动降级为文本消息

```typescript
// 发送本地文件
await adapter.postMessage(threadId, {
  text: "文档",
  files: [{ data: buffer, filename: "report.xlsx", mimeType: "application/vnd.ms-excel" }],
});

// 转发收到的图片
await adapter.postMessage(threadId, {
  markdown: message.text || " ",
  attachments: message.attachments,
});
```

## 安全

Webhook 模式使用 Ed25519 签名验证：

- **回调地址验证** (OpCode 13)：用私钥签名 `event_ts + plain_token`
- **事件推送验证** (OpCode 0)：用公钥验证 `X-Signature-Ed25519` 请求头

```typescript
import { signCallbackValidation, verifyEventSignature } from "@agentor/chat-qq";

// 回调地址验证
const signature = signCallbackValidation(clientSecret, plainToken, eventTs);

// 事件签名验证
const valid = verifyEventSignature(clientSecret, signatureHex, timestamp, body);
```

## 不支持的操作

以下操作会抛出 `NotImplementedError`：

- `editMessage` — 不支持
- `deleteMessage` — 不支持
- `fetchMessages` / `fetchThread` — 不支持
- `addReaction` / `removeReaction` — 不支持

## License

MIT © [Demo Macro](https://www.demomacro.com/)
