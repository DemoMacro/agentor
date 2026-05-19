# @agentor/server

![npm version](https://img.shields.io/npm/v/@agentor/server)
![npm downloads](https://img.shields.io/npm/dw/@agentor/server)
![npm license](https://img.shields.io/npm/l/@agentor/server)

> AI API compatibility layer that exposes [AI SDK](https://ai-sdk.dev/) providers as OpenAI / Anthropic compatible endpoints.

## Features

- **OpenAI Compatible** - Chat Completions, Responses, Completions, Embeddings, Images, Image Edits, Speech, Transcriptions, Rerank, Models
- **Anthropic Compatible** - Messages, Models
- **Streaming Support** - SSE streaming for both OpenAI and Anthropic formats
- **Tool Calling** - Function calling support for chat completions, messages, and responses
- **Multi-Provider** - Works with any AI SDK provider via `createProviderRegistry`
- **Handler Pattern** - Pluggable handler architecture (like unstorage drivers)
- **TypeScript-First** - Full type safety with official SDK types from `openai` and `@anthropic-ai/sdk`

## Installation

```bash
# Install with npm
$ npm install @agentor/server

# Install with yarn
$ yarn add @agentor/server

# Install with pnpm
$ pnpm add @agentor/server
```

## Quick Start

### Setup

```typescript
import { createServer, openaiHandler, anthropicHandler } from "@agentor/server";
import { createProviderRegistry } from "ai";
import { createDashScope } from "@agentor/dashscope";

const dashscope = createDashScope({ apiKey: process.env.DASHSCOPE_API_KEY });

const server = createServer({
  registry: createProviderRegistry({ dashscope }),
  handlers: [openaiHandler(), anthropicHandler()],
  models: [
    {
      id: "dashscope:qwen3.5-flash",
      display_name: "Qwen 3.5 Flash",
      created: 1747526400,
      owned_by: "aliyun",
    },
  ],
});

server.listen(3000);
```

### OpenAI Client

```typescript
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: "any" });

// Chat completion
const response = await client.chat.completions.create({
  model: "dashscope:qwen3.5-flash",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: "dashscope:qwen3.5-flash",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### Anthropic Client

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ baseURL: "http://localhost:3000", apiKey: "any" });

// Message
const message = await client.messages.create({
  model: "dashscope:qwen3.5-flash",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

console.log(message.content[0].text);

// Streaming
const stream = client.messages.stream({
  model: "dashscope:qwen3.5-flash",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
```

## Endpoints

### OpenAI Handler

| Endpoint                   | Method | Description                           |
| -------------------------- | ------ | ------------------------------------- |
| `/v1/chat/completions`     | POST   | Chat completion (stream + non-stream) |
| `/v1/responses`            | POST   | Responses API (stream + non-stream)   |
| `/v1/completions`          | POST   | Legacy completions                    |
| `/v1/embeddings`           | POST   | Text embeddings                       |
| `/v1/images/generations`   | POST   | Image generation                      |
| `/v1/images/edits`         | POST   | Image editing                         |
| `/v1/audio/speech`         | POST   | Text-to-speech                        |
| `/v1/audio/transcriptions` | POST   | Speech-to-text                        |
| `/v1/audio/translations`   | POST   | Audio translation                     |
| `/v1/rerank`               | POST   | Document reranking                    |
| `/v1/models`               | GET    | List available models                 |

### Anthropic Handler

| Endpoint       | Method | Description                            |
| -------------- | ------ | -------------------------------------- |
| `/v1/messages` | POST   | Message creation (stream + non-stream) |
| `/v1/models`   | GET    | List available models                  |

## Models Configuration

The `models` option accepts string shortcuts or full objects:

```typescript
createServer({
  // ...
  models: [
    // String shortcut — minimal defaults
    "dashscope:qwen3.5-flash",
    // Full object — control all fields
    {
      id: "dashscope:qwen-plus",
      display_name: "Qwen Plus",
      created: 1704067200,
      owned_by: "aliyun",
    },
  ],
});
```

## Handler Options

Both handlers are mounted at `/v1` by default:

```typescript
import { openaiHandler, anthropicHandler } from "@agentor/server";

createServer({
  registry: createProviderRegistry({ dashscope }),
  handlers: [openaiHandler(), anthropicHandler()],
});
```

## Programmatic Usage

Use `app.fetch()` for testing without starting a real HTTP server:

```typescript
import { createServer, openaiHandler } from "@agentor/server";

const { app } = createServer({
  registry: createProviderRegistry({ dashscope }),
  handlers: [openaiHandler()],
});

const response = await app.fetch(
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "dashscope:qwen3.5-flash",
      messages: [{ role: "user", content: "Hello" }],
    }),
  }),
);

console.log(await response.json());
```

## Supported Parameters

### OpenAI → AI SDK

| OpenAI Parameter | AI SDK Parameter |
| ---------------- | ---------------- |
| `temperature`    | `temperature`    |
| `top_p`          | `topP`           |
| `max_tokens`     | `maxTokens`      |
| `stop`           | `stopSequences`  |
| `stream`         | `streamText`     |
| `tools`          | `tools`          |

### Anthropic → AI SDK

| Anthropic Parameter | AI SDK Parameter |
| ------------------- | ---------------- |
| `system`            | `system`         |
| `max_tokens`        | `maxTokens`      |
| `temperature`       | `temperature`    |
| `top_p`             | `topP`           |
| `stream`            | `streamText`     |
| `tools`             | `tools`          |
| `stop_sequences`    | `stopSequences`  |

## License

MIT © [Demo Macro](https://www.demomacro.com/)
