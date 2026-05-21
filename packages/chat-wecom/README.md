# @agentor/chat-wecom

![npm version](https://img.shields.io/npm/v/@agentor/chat-wecom)
![npm downloads](https://img.shields.io/npm/dw/@agentor/chat-wecom)
![npm license](https://img.shields.io/npm/l/@agentor/chat-wecom)

**[English](./README.md)** | [中文](./README.zh-CN.md)

> [Chat SDK](https://github.com/DemoMacro/agentor) adapter for [WeCom (企业微信)](https://developer.work.weixin.qq.com/) messaging integration.

## Features

- **Webhook (Group Bot)** — Push messages to group chats via Webhook URL
- **Bot (Smart Bot)** — Send and receive messages via callback URL or WebSocket long connection
- **App (Application)** — Send app messages, receive callback events, manage Access Token
- **Rich Media** — Upload and download images, voice, video, and files
- **Card Messages** — Convert Chat SDK `CardElement` to WeCom Template Card
- **Encryption** — AES-256-CBC encryption/decryption + SHA1 signature verification

## Environment Variables

| Variable                     | Required | Description                                |
| ---------------------------- | -------- | ------------------------------------------ |
| `WECOM_WEBHOOK_KEY`          | Webhook  | Webhook group bot Key                      |
| `WECOM_BOT_TOKEN`            | Bot (CB) | Callback Token                             |
| `WECOM_BOT_ENCODING_AES_KEY` | Bot (CB) | Callback message encryption Key (43 chars) |
| `WECOM_BOT_WS_BOT_ID`        | Bot (WS) | Smart bot ID                               |
| `WECOM_BOT_WS_SECRET`        | Bot (WS) | Smart bot Secret                           |
| `WECOM_APP_CORP_ID`          | App      | Corporation ID                             |
| `WECOM_APP_CORP_SECRET`      | App      | Application Secret                         |
| `WECOM_APP_AGENT_ID`         | App      | Application AgentId                        |
| `WECOM_APP_TOKEN`            | App (CB) | Callback Token                             |
| `WECOM_APP_ENCODING_AES_KEY` | App (CB) | Callback message encryption Key (43 chars) |

## Configuration

### Webhook (Group Bot)

| Option     | Type           | Default            | Description            |
| ---------- | -------------- | ------------------ | ---------------------- |
| `key`      | `string`       | —                  | Webhook Key (required) |
| `userName` | `string`       | `"WeCom Webhook"`  | Bot display name       |
| `fetch`    | `typeof fetch` | `globalThis.fetch` | Custom fetch function  |

### Bot (Smart Bot)

| Option           | Type                        | Default                | Description                            |
| ---------------- | --------------------------- | ---------------------- | -------------------------------------- |
| `mode`           | `"callback" \| "websocket"` | `"websocket"`          | Connection mode                        |
| `token`          | `string`                    | —                      | Callback Token (required for callback) |
| `encodingAESKey` | `string`                    | —                      | Encryption Key (required for callback) |
| `botId`          | `string`                    | —                      | Bot ID (required for websocket)        |
| `secret`         | `string`                    | —                      | Bot Secret (required for websocket)    |
| `userName`       | `string`                    | `"WeCom Bot"`          | Bot display name                       |
| `wsUrl`          | `string`                    | WeCom default          | WebSocket server URL                   |
| `WebSocket`      | `typeof WebSocket`          | `globalThis.WebSocket` | Custom WebSocket class                 |

### App (Application)

| Option           | Type           | Default            | Description                             |
| ---------------- | -------------- | ------------------ | --------------------------------------- |
| `corpId`         | `string`       | —                  | Corporation ID (required)               |
| `corpSecret`     | `string`       | —                  | Application Secret (required)           |
| `agentId`        | `number`       | —                  | Application AgentId (required)          |
| `token`          | `string`       | —                  | Callback Token (required for callbacks) |
| `encodingAESKey` | `string`       | —                  | Encryption Key (required for callbacks) |
| `userName`       | `string`       | `"WeCom App"`      | App display name                        |
| `fetch`          | `typeof fetch` | `globalThis.fetch` | Custom fetch function                   |

## Platform Setup

### Webhook (Group Bot)

1. Add a "Group Bot" in a WeCom group chat
2. Select "Custom Bot" and create it
3. Copy the `key` parameter from the Webhook URL

### Bot (Smart Bot)

1. Log in to [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. Navigate to "App Management" → "Smart Bot" to create a bot
3. Callback mode: configure the callback URL and provide Token and EncodingAESKey
4. WebSocket mode: obtain the Bot ID and Secret

### App (Application)

1. Log in to [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. Navigate to "App Management" → "Custom" to create an app
3. Obtain CorpId, CorpSecret, and AgentId
4. For receiving callbacks: configure the "Receive Messages" URL, Token, and EncodingAESKey in the app details

```bash
pnpm add @agentor/chat-wecom
```

## Quick Start

### Webhook (Group Bot)

One-way message push to group chats:

```typescript
import { createWeComWebhookAdapter } from "@agentor/chat-wecom";

const adapter = createWeComWebhookAdapter({
  key: process.env.WECOM_WEBHOOK_KEY!,
});

const threadId = adapter.encodeThreadId({ key: process.env.WECOM_WEBHOOK_KEY! });
const result = await adapter.postMessage(threadId, "Hello from @agentor/chat-wecom!");
```

### Bot — WebSocket Mode (Smart Bot)

Connect directly to WeCom via WebSocket, no public endpoint required:

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

// Disconnect
await adapter.disconnect();
```

### Bot — Callback URL Mode (Smart Bot)

Receive and reply to messages via HTTP callback, requires a publicly accessible endpoint:

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

// Handle callback in HTTP server
// adapter.handleWebhook(request) → Response
```

### App (Application)

Send app messages and receive callback events:

```typescript
import { createWeComAppAdapter } from "@agentor/chat-wecom";

const adapter = createWeComAppAdapter({
  corpId: process.env.WECOM_APP_CORP_ID!,
  corpSecret: process.env.WECOM_APP_CORP_SECRET!,
  agentId: Number(process.env.WECOM_APP_AGENT_ID!),
  token: process.env.WECOM_APP_TOKEN, // Required for receiving callbacks
  encodingAESKey: process.env.WECOM_APP_ENCODING_AES_KEY, // Required for receiving callbacks
});

// Send message
const threadId = adapter.encodeThreadId({
  corpId: process.env.WECOM_APP_CORP_ID!,
  userId: "user-id",
});
const result = await adapter.postMessage(threadId, "Hello from app!");

// Recall message
await adapter.deleteMessage(threadId, result.id);

// Get Access Token
const token = await adapter.getAccessToken();
```

## Message Type Support

### Receiving Messages

| Message Type | Webhook | Bot (CB/WS) | App |
| ------------ | ------- | ----------- | --- |
| Text         | —       | ✅          | ✅  |
| Image        | —       | ✅          | ✅  |
| Voice        | —       | ✅          | ✅  |
| Video        | —       | ✅          | ✅  |
| File         | —       | ✅          | —   |
| Location     | —       | —           | ✅  |
| Link         | —       | —           | ✅  |
| Mixed        | —       | ✅          | —   |

> Webhook is one-way push only. App does not support file type callbacks (WeCom platform limitation). Video and voice must be sent through WeCom's built-in recording feature.

### Sending Messages

| Message Type  | Webhook   | Bot (CB) | Bot (WS)    | App         |
| ------------- | --------- | -------- | ----------- | ----------- |
| Markdown      | ✅        | ✅       | ✅          | ✅          |
| Image         | ✅ base64 | —        | ✅ media_id | ✅ media_id |
| Voice         | ✅        | —        | ✅          | ✅          |
| Video         | —         | —        | ✅          | ✅          |
| File          | ✅        | —        | ✅          | ✅          |
| Template Card | ✅        | ✅       | ✅          | ✅          |

> Webhook and Bot (CB) Template Cards only support `text_notice` and `news_notice` types. Bot (WS) and App support all 5 card types. Bot (WS) media messages are sent via `respond_msg` (reply); proactive push (`send_msg`) only supports Markdown and Template Card.

## Media File Handling

### Media Upload

```typescript
import { uploadAppMedia, uploadWebhookMedia } from "@agentor/chat-wecom";

// App message upload
const mediaId = await uploadAppMedia(accessToken, {
  data: imageBuffer,
  filename: "image.png",
  mimeType: "image/png",
});

// Webhook upload
const mediaId = await uploadWebhookMedia(webhookKey, {
  data: fileBuffer,
  filename: "document.pdf",
});
```

### Media Download

```typescript
import { downloadAppMedia, fetchEncryptedMedia } from "@agentor/chat-wecom";

// Download app message media via mediaId
const { data, filename } = await downloadAppMedia(accessToken, mediaId);

// Download and decrypt Bot encrypted media (requires aeskey)
const { data, filename } = await fetchEncryptedMedia(url, aeskey);
```

`postMessage` handles media upload automatically: when a `FileUpload` is provided, it uploads first to obtain a `media_id`, then sends the corresponding media message type.

## Card Messages

Supports automatic conversion from Chat SDK `CardElement` to WeCom Template Card (5 card types):

| Card Type              | Description        |
| ---------------------- | ------------------ |
| `text_notice`          | Text notification  |
| `news_notice`          | News notification  |
| `button_interaction`   | Button interaction |
| `vote_interaction`     | Vote interaction   |
| `multiple_interaction` | Multiple choice    |

Card type is automatically inferred from `CardElement` content:

- Contains multi-select/dropdown → `multiple_interaction`
- Contains single-select → `vote_interaction`
- Contains buttons → `button_interaction`
- Contains image → `news_notice`
- Default → `text_notice`

```typescript
import type { CardElement } from "chat";

const card: CardElement = {
  type: "card",
  title: "Approval Notice",
  subtitle: "Please review the following request",
  children: [
    {
      type: "fields",
      children: [{ type: "field", label: "Applicant", value: "John" }],
    },
    {
      type: "actions",
      children: [
        { type: "button", label: "Approve", style: "primary", id: "approve" },
        { type: "button", label: "Reject", style: "danger", id: "reject" },
      ],
    },
  ],
};

await adapter.postMessage(threadId, card);
```

## Encryption

All callback communication uses AES-256-CBC encryption and SHA1 signature verification:

```typescript
import { encrypt, decrypt, calculateSignature, verifySignature } from "@agentor/chat-wecom";

const encrypted = await encrypt(encodingAESKey, "Hello", "receiveId");
const decrypted = await decrypt(encodingAESKey, encrypted, "receiveId");

const signature = await calculateSignature(token, timestamp, nonce, encrypted);
const valid = await verifySignature(token, timestamp, nonce, encrypted, signature);
```

## Unsupported Operations

The following operations throw `NotImplementedError`:

- `editMessage` — Not supported by any adapter
- `deleteMessage` — Only supported by the App adapter
- `fetchMessages` / `fetchThread` — Not supported
- `addReaction` / `removeReaction` — Not supported

## License

MIT © [Demo Macro](https://www.demomacro.com/)
