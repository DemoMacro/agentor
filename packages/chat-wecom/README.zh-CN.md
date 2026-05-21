# @agentor/chat-wecom

![npm version](https://img.shields.io/npm/v/@agentor/chat-wecom)
![npm downloads](https://img.shields.io/npm/dw/@agentor/chat-wecom)
![npm license](https://img.shields.io/npm/l/@agentor/chat-wecom)

[English](./README.md) | **[中文](./README.zh-CN.md)**

> [Chat SDK](https://github.com/DemoMacro/agentor) 适配器，用于 [企业微信 (WeCom)](https://developer.work.weixin.qq.com/) 消息集成。

## 功能特性

- **Webhook (群机器人)** — 通过 Webhook URL 推送消息到群聊
- **Bot (智能机器人)** — 支持回调 URL 和 WebSocket 长连接两种模式收发消息
- **App (应用)** — 发送应用消息、接收回调事件、管理 Access Token
- **富媒体支持** — 图片、语音、视频、文件的上传下载
- **卡片消息** — 将 Chat SDK 的 `CardElement` 转换为企业微信 Template Card
- **安全加密** — AES-256-CBC 加解密 + SHA1 签名校验

## 安装

```bash
# Install with npm
npm install @agentor/chat-wecom

# Install with yarn
yarn add @agentor/chat-wecom

# Install with pnpm
pnpm add @agentor/chat-wecom
```

## 快速开始

### Webhook (群机器人)

单向推送消息到群聊：

```typescript
import { createWeComWebhookAdapter } from "@agentor/chat-wecom";

const adapter = createWeComWebhookAdapter({
  key: process.env.WECOM_WEBHOOK_KEY!,
});

const threadId = adapter.encodeThreadId({ key: process.env.WECOM_WEBHOOK_KEY! });
const result = await adapter.postMessage(threadId, "Hello from @agentor/chat-wecom!");
```

### Bot — WebSocket 长连接模式 (智能机器人)

通过 WebSocket 直连企业微信服务，无需公网端点：

```typescript
import { createWeComBotAdapter } from "@agentor/chat-wecom";

const adapter = createWeComBotAdapter({
  botId: process.env.WECOM_BOT_WS_BOT_ID!,
  secret: process.env.WECOM_BOT_WS_SECRET!,
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

### Bot — 回调 URL 模式 (智能机器人)

通过 HTTP 回调接收和回复消息，需要公网可达的端点：

```typescript
import { createWeComBotAdapter } from "@agentor/chat-wecom";

const adapter = createWeComBotAdapter({
  mode: "callback",
  token: process.env.WECOM_BOT_TOKEN!,
  encodingAESKey: process.env.WECOM_BOT_ENCODING_AES_KEY!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    await adapter.postMessage(threadId, message.text);
  },
});

// 在 HTTP 服务器中处理回调
// adapter.handleWebhook(request) → Response
```

### App (应用)

发送应用消息并接收回调事件：

```typescript
import { createWeComAppAdapter } from "@agentor/chat-wecom";

const adapter = createWeComAppAdapter({
  corpId: process.env.WECOM_APP_CORP_ID!,
  corpSecret: process.env.WECOM_APP_CORP_SECRET!,
  agentId: Number(process.env.WECOM_APP_AGENT_ID!),
  token: process.env.WECOM_APP_TOKEN, // 接收回调时必填
  encodingAESKey: process.env.WECOM_APP_ENCODING_AES_KEY, // 接收回调时必填
});

// 发送消息
const threadId = adapter.encodeThreadId({
  corpId: process.env.WECOM_APP_CORP_ID!,
  userId: "user-id",
});
const result = await adapter.postMessage(threadId, "Hello from app!");

// 撤回消息
await adapter.deleteMessage(threadId, result.id);

// 获取 Access Token
const token = await adapter.getAccessToken();
```

## 环境变量

| 变量名                       | 必填       | 说明                         |
| ---------------------------- | ---------- | ---------------------------- |
| `WECOM_WEBHOOK_KEY`          | Webhook    | Webhook 群机器人 Key         |
| `WECOM_BOT_TOKEN`            | Bot (回调) | 回调 Token                   |
| `WECOM_BOT_ENCODING_AES_KEY` | Bot (回调) | 回调消息加解密 Key (43 字符) |
| `WECOM_BOT_WS_BOT_ID`        | Bot (WS)   | 智能机器人 ID                |
| `WECOM_BOT_WS_SECRET`        | Bot (WS)   | 智能机器人 Secret            |
| `WECOM_APP_CORP_ID`          | App        | 企业 ID                      |
| `WECOM_APP_CORP_SECRET`      | App        | 应用 Secret                  |
| `WECOM_APP_AGENT_ID`         | App        | 应用 AgentId                 |
| `WECOM_APP_TOKEN`            | App (回调) | 回调 Token                   |
| `WECOM_APP_ENCODING_AES_KEY` | App (回调) | 回调消息加解密 Key (43 字符) |

## 配置项

### Webhook (群机器人)

| 选项       | 类型           | 默认值             | 说明               |
| ---------- | -------------- | ------------------ | ------------------ |
| `key`      | `string`       | —                  | Webhook Key (必填) |
| `userName` | `string`       | `"WeCom Webhook"`  | 机器人显示名称     |
| `fetch`    | `typeof fetch` | `globalThis.fetch` | 自定义 fetch 函数  |

### Bot (智能机器人)

| 选项             | 类型                        | 默认值                 | 说明                               |
| ---------------- | --------------------------- | ---------------------- | ---------------------------------- |
| `mode`           | `"callback" \| "websocket"` | `"websocket"`          | 连接模式                           |
| `token`          | `string`                    | —                      | 回调 Token (callback 模式必填)     |
| `encodingAESKey` | `string`                    | —                      | 加解密 Key (callback 模式必填)     |
| `botId`          | `string`                    | —                      | 机器人 ID (websocket 模式必填)     |
| `secret`         | `string`                    | —                      | 机器人 Secret (websocket 模式必填) |
| `userName`       | `string`                    | `"WeCom Bot"`          | 机器人显示名称                     |
| `wsUrl`          | `string`                    | 企业微信默认           | WebSocket 服务地址                 |
| `WebSocket`      | `typeof WebSocket`          | `globalThis.WebSocket` | 自定义 WebSocket 类                |

### App (应用)

| 选项             | 类型           | 默认值             | 说明                        |
| ---------------- | -------------- | ------------------ | --------------------------- |
| `corpId`         | `string`       | —                  | 企业 ID (必填)              |
| `corpSecret`     | `string`       | —                  | 应用 Secret (必填)          |
| `agentId`        | `number`       | —                  | 应用 AgentId (必填)         |
| `token`          | `string`       | —                  | 回调 Token (接收回调时必填) |
| `encodingAESKey` | `string`       | —                  | 加解密 Key (接收回调时必填) |
| `userName`       | `string`       | `"WeCom App"`      | 应用显示名称                |
| `fetch`          | `typeof fetch` | `globalThis.fetch` | 自定义 fetch 函数           |

## 平台配置

### Webhook (群机器人)

1. 在企业微信群聊中添加「群机器人」
2. 选择「自定义机器人」并创建
3. 复制 Webhook 地址中的 `key` 参数

### Bot (智能机器人)

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 进入「应用管理」→「智能机器人」创建机器人
3. 回调模式：配置回调 URL 并填写 Token 和 EncodingAESKey
4. WebSocket 模式：获取 Bot ID 和 Secret

### App (应用)

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 进入「应用管理」→「自建」创建应用
3. 获取 CorpId、CorpSecret、AgentId
4. 如需接收回调：在应用详情中配置「接收消息」的 URL、Token、EncodingAESKey

## 消息类型支持

### 接收消息

| 消息类型        | Webhook | Bot (回调/WS) | App |
| --------------- | ------- | ------------- | --- |
| 文本 (text)     | —       | ✅            | ✅  |
| 图片 (image)    | —       | ✅            | ✅  |
| 语音 (voice)    | —       | ✅            | ✅  |
| 视频 (video)    | —       | ✅            | ✅  |
| 文件 (file)     | —       | ✅            | —   |
| 位置 (location) | —       | —             | ✅  |
| 链接 (link)     | —       | —             | ✅  |
| 混合 (mixed)    | —       | ✅            | —   |

> Webhook 为单向推送，不支持接收消息。App 不支持 file 类型回调（企业微信平台限制），视频和语音需通过企业微信内置录制功能发送。

### 发送消息

| 消息类型      | Webhook   | Bot (回调) | Bot (WS)    | App         |
| ------------- | --------- | ---------- | ----------- | ----------- |
| Markdown      | ✅        | ✅         | ✅          | ✅          |
| 图片 (image)  | ✅ base64 | —          | ✅ media_id | ✅ media_id |
| 语音 (voice)  | ✅        | —          | ✅          | ✅          |
| 视频 (video)  | —         | —          | ✅          | ✅          |
| 文件 (file)   | ✅        | —          | ✅          | ✅          |
| Template Card | ✅        | ✅         | ✅          | ✅          |

> Webhook 和 Bot (回调) 的 Template Card 仅支持 `text_notice` 和 `news_notice` 两种类型。Bot (WS) 和 App 支持全部 5 种卡片类型。Bot (WS) 的媒体消息通过 `respond_msg`（回复消息）发送，主动推送 (`send_msg`) 仅支持 Markdown 和 Template Card。

## 媒体文件处理

### 媒体上传

```typescript
import { uploadAppMedia, uploadWebhookMedia } from "@agentor/chat-wecom";

// 应用消息上传
const mediaId = await uploadAppMedia(accessToken, {
  data: imageBuffer,
  filename: "image.png",
  mimeType: "image/png",
});

// Webhook 上传
const mediaId = await uploadWebhookMedia(webhookKey, {
  data: fileBuffer,
  filename: "document.pdf",
});
```

### 媒体下载

```typescript
import { downloadAppMedia, fetchEncryptedMedia } from "@agentor/chat-wecom";

// 通过 mediaId 下载应用消息媒体
const { data, filename } = await downloadAppMedia(accessToken, mediaId);

// 下载并解密 Bot 加密媒体（需要 aeskey）
const { data, filename } = await fetchEncryptedMedia(url, aeskey);
```

`postMessage` 会自动处理媒体上传流程：传入 `FileUpload` 时，先上传获取 `media_id`，再发送对应类型的媒体消息。

## 卡片消息

支持将 Chat SDK 的 `CardElement` 自动转换为企业微信 Template Card（5 种卡片类型）：

| 卡片类型               | 说明     |
| ---------------------- | -------- |
| `text_notice`          | 文本通知 |
| `news_notice`          | 图文通知 |
| `button_interaction`   | 按钮交互 |
| `vote_interaction`     | 投票交互 |
| `multiple_interaction` | 多选交互 |

卡片类型根据 `CardElement` 内容自动推断：

- 包含多选/下拉 → `multiple_interaction`
- 包含单选 → `vote_interaction`
- 包含按钮 → `button_interaction`
- 包含图片 → `news_notice`
- 默认 → `text_notice`

```typescript
import type { CardElement } from "chat";

const card: CardElement = {
  type: "card",
  title: "审批通知",
  subtitle: "请审批以下申请",
  children: [
    {
      type: "fields",
      children: [{ type: "field", label: "申请人", value: "张三" }],
    },
    {
      type: "actions",
      children: [
        { type: "button", label: "同意", style: "primary", id: "approve" },
        { type: "button", label: "拒绝", style: "danger", id: "reject" },
      ],
    },
  ],
};

await adapter.postMessage(threadId, card);
```

## 加解密

所有回调通信使用 AES-256-CBC 加密和 SHA1 签名校验：

```typescript
import { encrypt, decrypt, calculateSignature, verifySignature } from "@agentor/chat-wecom";

const encrypted = await encrypt(encodingAESKey, "Hello", "receiveId");
const decrypted = await decrypt(encodingAESKey, encrypted, "receiveId");

const signature = await calculateSignature(token, timestamp, nonce, encrypted);
const valid = await verifySignature(token, timestamp, nonce, encrypted, signature);
```

## 不支持的操作

以下操作会抛出 `NotImplementedError`：

- `editMessage` — 所有适配器均不支持
- `deleteMessage` — 仅 App 适配器支持
- `fetchMessages` / `fetchThread` — 不支持
- `addReaction` / `removeReaction` — 不支持

## License

MIT © [Demo Macro](https://www.demomacro.com/)
