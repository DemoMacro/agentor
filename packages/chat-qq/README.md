# @agentor/chat-qq

![npm version](https://img.shields.io/npm/v/@agentor/chat-qq)
![npm downloads](https://img.shields.io/npm/dw/@agentor/chat-qq)
![npm license](https://img.shields.io/npm/l/@agentor/chat-qq)

**[English](./README.md)** | [中文](./README.zh-CN.md)

> [Chat SDK](https://github.com/DemoMacro/agentor) adapter for [QQ Bot (QQ Robot)](https://bot.q.qq.com/) messaging integration.

## Features

- **WebSocket Long Connection** — Direct connection to QQ Bot Gateway, no public endpoint required
- **Webhook (Callback URL)** — Receive events via HTTP callback with Ed25519 signature verification
- **Multi-scene Support** — QQ DM (C2C), QQ Group, Text Channel, Channel DM
- **Rich Media** — Upload and send images, videos, voice, and files
- **Auto Reconnect** — Exponential backoff reconnection + Session Resume

> **Note:** Once an HTTPS callback URL is configured, WebSocket mode will no longer be available — the two are mutually exclusive.

## Installation

```bash
# Install with npm
npm install @agentor/chat-qq

# Install with yarn
yarn add @agentor/chat-qq

# Install with pnpm
pnpm add @agentor/chat-qq
```

## Quick Start

### WebSocket Mode

Connect directly to QQ Bot service via WebSocket, no public endpoint required:

```typescript
import { createQQBotAdapter } from "@agentor/chat-qq";

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

// Disconnect
await adapter.disconnect();
```

### Webhook Callback Mode

Receive and reply to messages via HTTP callback, requires a publicly accessible endpoint:

```typescript
import { createQQBotAdapter } from "@agentor/chat-qq";
import { H3, fromWebHandler, serve } from "h3";

const adapter = createQQBotAdapter({
  mode: "callback",
  appId: process.env.QQ_BOT_APP_ID!,
  clientSecret: process.env.QQ_BOT_CLIENT_SECRET!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    await adapter.postMessage(threadId, message.text);
  },
});

// Handle callback in HTTP server
const app = new H3();
app.all(
  "/webhook",
  fromWebHandler((req) => adapter.handleWebhook(req)),
);
serve(app, { port: 3000 });
```

## Environment Variables

| Variable               | Required | Description           |
| ---------------------- | -------- | --------------------- |
| `QQ_BOT_APP_ID`        | Yes      | QQ Bot application ID |
| `QQ_BOT_CLIENT_SECRET` | Yes      | QQ Bot client secret  |

## Configuration

| Option         | Type                        | Default                                        | Description                         |
| -------------- | --------------------------- | ---------------------------------------------- | ----------------------------------- |
| `mode`         | `"callback" \| "websocket"` | `"websocket"`                                  | Connection mode                     |
| `appId`        | `string`                    | —                                              | Application ID (required)           |
| `clientSecret` | `string`                    | —                                              | Client secret (required)            |
| `intents`      | `number`                    | `PUBLIC_GUILD_MESSAGES \| GROUP_AND_C2C_EVENT` | Event intent bitmask                |
| `sandbox`      | `boolean`                   | `false`                                        | Use sandbox environment (websocket) |
| `userName`     | `string`                    | `"QQ Bot"`                                     | Bot display name                    |
| `wsUrl`        | `string`                    | QQ Bot default                                 | WebSocket gateway URL               |
| `WebSocket`    | `typeof WebSocket`          | `globalThis.WebSocket`                         | Custom WebSocket class              |
| `fetch`        | `typeof fetch`              | `globalThis.fetch`                             | Custom fetch function               |

## Platform Setup

1. Log in to [QQ Open Platform](https://q.qq.com/)
2. Create a bot application and obtain App ID and Client Secret
3. WebSocket mode: no extra configuration needed, connect directly
4. Webhook mode: configure an HTTPS callback URL in the app details
   - Once configured, WebSocket mode becomes unavailable (mutually exclusive)

## Message Type Support

### Receiving Messages

| Message Type | WebSocket | Webhook |
| ------------ | --------- | ------- |
| Text         | ✅        | ✅      |
| Image        | ✅        | ✅      |
| Video        | ✅        | ✅      |
| Voice        | ✅        | ✅      |
| File         | ✅        | ✅      |

### Sending Messages

| Message Type     | C2C DM | Group | Text Channel | Channel DM |
| ---------------- | ------ | ----- | ------------ | ---------- |
| Text             | ✅     | ✅    | ✅           | ✅         |
| Image            | ✅     | ✅    | ✅           | ✅         |
| Video            | ✅     | ✅    | ✅           | ✅         |
| Voice            | ✅     | ✅    | —            | —          |
| File             | ✅     | —     | —            | —          |
| Markdown         | ✅     | ✅    | ✅           | ✅         |
| Rich Media (URL) | ✅     | ✅    | ✅           | ✅         |

> File upload (file_type=4) in group chats is not currently available. Text channels and channel DMs do not have a standalone upload API, but support sending images and videos via `msg_type: 7` + `media`.

## Media File Handling

`postMessage` handles media upload automatically:

- **Local files** (`FileUpload`): convert to base64, upload to obtain `file_info`, then send as rich media message
- **URL attachments** (`Attachment` with URL): upload via URL to obtain `file_info`, then send as rich media message
- Unsupported scenarios automatically fall back to text messages

```typescript
// Send a local file
await adapter.postMessage(threadId, {
  text: "Document",
  files: [{ data: buffer, filename: "report.xlsx", mimeType: "application/vnd.ms-excel" }],
});

// Forward a received image
await adapter.postMessage(threadId, {
  markdown: message.text || " ",
  attachments: message.attachments,
});
```

## Security

Webhook mode uses Ed25519 signature verification:

- **Callback URL verification** (OpCode 13): sign `event_ts + plain_token` with private key
- **Event push verification** (OpCode 0): verify `X-Signature-Ed25519` request header with public key

```typescript
import { signCallbackValidation, verifyEventSignature } from "@agentor/chat-qq";

// Callback URL validation
const signature = signCallbackValidation(clientSecret, plainToken, eventTs);

// Event signature verification
const valid = verifyEventSignature(clientSecret, signatureHex, timestamp, body);
```

## Unsupported Operations

The following operations throw `NotImplementedError`:

- `editMessage` — Not supported
- `deleteMessage` — Not supported
- `fetchMessages` / `fetchThread` — Not supported
- `addReaction` / `removeReaction` — Not supported

## License

MIT © [Demo Macro](https://www.demomacro.com/)
