# @agentor/chat-wecom

![npm version](https://img.shields.io/npm/v/@agentor/chat-wecom)
![npm downloads](https://img.shields.io/npm/dw/@agentor/chat-wecom)
![npm license](https://img.shields.io/npm/l/@agentor/chat-wecom)

> [Chat SDK](https://github.com/DemoMacro/agentor) adapter for [WeChat Work (企业微信)](https://developer.work.weixin.qq.com/) integration.

## Features

- **Webhook (群机器人)** - Push messages to group chats via webhook URL
- **Bot (智能机器人)** - Receive and reply messages with callback URL or WebSocket long connection
- **App (应用)** - Send application messages, receive callback events, and manage access tokens
- **Dual Bot Modes** - Callback URL (public endpoint) and WebSocket (internal/development)
- **Encryption** - AES-256-CBC + SHA1 signature verification via Node.js crypto
- **TypeScript-First** - Full type safety with comprehensive TypeScript support

## Installation

```bash
# Install with npm
$ npm install @agentor/chat-wecom

# Install with yarn
$ yarn add @agentor/chat-wecom

# Install with pnpm
$ pnpm add @agentor/chat-wecom
```

## Quick Start

### Webhook (群机器人)

Push messages to a group chat via webhook key:

```typescript
import { createWeComWebhookAdapter } from "@agentor/chat-wecom";

const adapter = createWeComWebhookAdapter({
  key: process.env.WECOM_WEBHOOK_KEY!,
});

const threadId = adapter.encodeThreadId({ key: process.env.WECOM_WEBHOOK_KEY! });

const result = await adapter.postMessage(threadId, "Hello from @agentor/chat-wecom!");
console.log("Message sent:", result.id);
```

### Bot - Callback URL Mode (智能机器人)

Receive and reply messages via HTTP callback:

```typescript
import { createWeComBotAdapter } from "@agentor/chat-wecom";

const adapter = createWeComBotAdapter({
  token: process.env.WECOM_BOT_TOKEN!,
  encodingAESKey: process.env.WECOM_BOT_ENCODING_AES_KEY!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    console.log(`[${message.author.userName}]: ${message.text}`);
    await adapter.postMessage(threadId, message.text);
  },
});

// Handle webhook in your HTTP server
// adapter.handleWebhook(request) → Response
```

### Bot - WebSocket Mode (智能机器人)

Receive and reply messages via WebSocket long connection:

```typescript
import { createWeComBotAdapter } from "@agentor/chat-wecom";

const adapter = createWeComBotAdapter({
  mode: "websocket",
  botId: process.env.WECOM_BOT_WS_BOT_ID!,
  secret: process.env.WECOM_BOT_WS_SECRET!,
});

await adapter.initialize({
  processMessage: async (_adapter, threadId, factory) => {
    const message = await factory();
    await adapter.postMessage(threadId, message.text);
  },
});

// Disconnect when done
await adapter.disconnect();
```

### App (应用)

Send application messages and receive callback events:

```typescript
import { createWeComAppAdapter } from "@agentor/chat-wecom";

const adapter = createWeComAppAdapter({
  corpId: process.env.WECOM_APP_CORP_ID!,
  corpSecret: process.env.WECOM_APP_CORP_SECRET!,
  agentId: Number(process.env.WECOM_APP_AGENT_ID!),
});

// Send message to user
const threadId = adapter.encodeThreadId({
  corpId: process.env.WECOM_APP_CORP_ID!,
  userId: "user-id",
});

const result = await adapter.postMessage(threadId, "Hello from app!");
console.log("Message ID:", result.id);

// Recall message
await adapter.deleteMessage(threadId, result.id);

// Get access token
const token = await adapter.getAccessToken();
```

## Adapter Configuration

### Webhook Config

```typescript
interface WeComWebhookConfig {
  key: string; // Webhook key
  userName?: string; // Bot display name
  fetch?: typeof fetch; // Custom fetch function
}
```

### Bot Config

```typescript
// Callback URL mode
interface WeComBotCallbackConfig {
  mode?: "callback"; // Default
  token: string; // Callback verification token
  encodingAESKey: string; // AES encryption key
  userName?: string;
  fetch?: typeof fetch;
}

// WebSocket mode
interface WeComBotWebSocketConfig {
  mode: "websocket";
  botId: string;
  secret: string;
  userName?: string;
  wsUrl?: string; // Default: wss://openws.work.weixin.qq.com
  WebSocket?: typeof WebSocket; // Inject custom WebSocket implementation
}
```

### App Config

```typescript
interface WeComAppConfig {
  corpId: string;
  corpSecret: string;
  agentId: number;
  token?: string; // Required for receiving callbacks
  encodingAESKey?: string; // Required for receiving callbacks
  userName?: string;
  fetch?: typeof fetch;
}
```

## Thread ID Format

| Adapter | Mode      | Format                        |
| ------- | --------- | ----------------------------- |
| Webhook | -         | `wecom-webhook:{key}`         |
| Bot     | Callback  | `wecom-bot:{chatId}`          |
| Bot     | WebSocket | `wecom-bot-ws:{chatId}`       |
| App     | -         | `wecom-app:{corpId}:{userId}` |

## Message Format

Bot and App adapters support receiving text messages. Unsupported operations throw `NotImplementedError`:

- `editMessage` - Not supported by any adapter
- `deleteMessage` - Supported by App adapter only
- `fetchMessages` - Not supported
- `addReaction` / `removeReaction` - Not supported

## Encryption

All callback communication is encrypted using AES-256-CBC with SHA1 signature verification:

```typescript
import { encrypt, decrypt, calculateSignature, verifySignature } from "@agentor/chat-wecom";

// Encrypt a message
const encrypted = await encrypt(encodingAESKey, "Hello", "receiveId");

// Decrypt
const decrypted = await decrypt(encodingAESKey, encrypted, "receiveId");

// Calculate and verify signature
const signature = await calculateSignature(token, timestamp, nonce, encrypted);
const valid = await verifySignature(token, timestamp, nonce, encrypted, signature);
```

## Available Exports

```typescript
// Adapters
export {
  createWeComWebhookAdapter,
  createWeComBotAdapter,
  createWeComAppAdapter,
} from "@agentor/chat-wecom";

// Crypto utilities
export {
  encrypt,
  decrypt,
  calculateSignature,
  verifySignature,
  verifyUrl,
  decryptCallback,
  encryptReply,
} from "@agentor/chat-wecom";

// Format converter
export { WeComFormatConverter } from "@agentor/chat-wecom";

// XML parsing
export { extractXmlField } from "@agentor/chat-wecom";
```

## License

MIT © [Demo Macro](https://www.demomacro.com/)
