# @agentor/dashscope

![npm version](https://img.shields.io/npm/v/@agentor/dashscope)
![npm downloads](https://img.shields.io/npm/dw/@agentor/dashscope)
![npm license](https://img.shields.io/npm/l/@agentor/dashscope)

> [AI SDK](https://ai-sdk.dev/) provider for [Alibaba Cloud DashScope (Bailian)](https://help.aliyun.com/en/model-studio/) API.

## Features

- **Chat Completions API** - Standard `/chat/completions` with function calling, streaming, and reasoning
- **Responses API** - `/responses` endpoint with built-in tools support
- **Built-in Tools** - Web search, code interpreter, web extractor, file search, image search, MCP integration
- **Thinking Mode** - Enable reasoning/thinking with configurable budget
- **Multi-region** - Beijing, Singapore, US, Germany regions
- **TypeScript-First** - Full type safety with comprehensive TypeScript support

## Installation

```bash
# Install with npm
$ npm install @agentor/dashscope

# Install with yarn
$ yarn add @agentor/dashscope

# Install with pnpm
$ pnpm add @agentor/dashscope
```

## Quick Start

### Setup

```typescript
import { createDashScope } from "@agentor/dashscope";

const dashscope = createDashScope({
  apiKey: process.env.DASHSCOPE_API_KEY,
});
```

Or use the default instance (reads `DASHSCOPE_API_KEY` from environment):

```typescript
import { dashscope } from "@agentor/dashscope";
```

### Basic Chat

```typescript
import { dashscope } from "@agentor/dashscope";
import { generateText } from "ai";

const result = await generateText({
  model: dashscope("qwen3.5-flash"),
  prompt: "Introduce yourself in one sentence.",
});

console.log(result.text);
```

### Streaming

```typescript
import { streamText } from "ai";

const result = streamText({
  model: dashscope("qwen3.5-flash"),
  prompt: "Explain the Vercel AI SDK in three sentences.",
});

for await (const part of result.textStream) {
  process.stdout.write(part);
}
```

### Function Calling

```typescript
import { generateText, hasToolCall, tool } from "ai";
import { z } from "zod/v4";

const result = await generateText({
  model: dashscope("qwen3.5-flash"),
  tools: {
    weather: tool({
      description: "Get weather information for a city",
      inputSchema: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => {
        return `${city}: Sunny, 25°C`;
      },
    }),
  },
  prompt: "What's the weather in Beijing?",
  stopWhen: hasToolCall("weather"),
});
```

## Chat Completions API

### Web Search

Enable web search via `providerOptions`:

```typescript
await generateText({
  model: dashscope("qwen3.5-flash"),
  providerOptions: {
    dashscope: {
      enableSearch: true,
    },
  },
  prompt: "What are the latest tech news today?",
});
```

### Code Interpreter

Enable code interpreter (requires thinking mode):

```typescript
await generateText({
  model: dashscope("qwen3.5-flash"),
  providerOptions: {
    dashscope: {
      enableCodeInterpreter: true,
      enableThinking: true,
    },
  },
  prompt: "Calculate the sum of the first 20 Fibonacci numbers.",
});
```

### Thinking Mode

Enable reasoning with configurable budget:

```typescript
await generateText({
  model: dashscope("qwen3.5-flash"),
  providerOptions: {
    dashscope: {
      enableThinking: true,
      thinkingBudget: 5000,
    },
  },
  prompt: "Which is larger, 9.11 or 9.9?",
});
```

## Responses API

Use the `responses` namespace for the Responses API with built-in tools:

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  prompt: "Search the web for the latest news.",
});
```

### Built-in Tools

#### Web Search

```typescript
import { dashscope } from "@agentor/dashscope";
import { generateText } from "ai";

const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.webSearch()],
  prompt: "What are the latest tech news today?",
});
```

#### Code Interpreter

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.codeInterpreter()],
  prompt: "Calculate the sum of the first 20 Fibonacci numbers.",
});
```

#### Web Extractor

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.webExtractor()],
  prompt: "Extract the main content from https://example.com",
});
```

#### File Search

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [
    dashscope.responses.tools.fileSearch({
      vectorStoreIds: ["vs-xxx"],
    }),
  ],
  prompt: "Find documents about machine learning.",
});
```

#### MCP Integration

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [
    dashscope.responses.tools.mcp({
      serverProtocol: "sse",
      serverLabel: "my-mcp-server",
      serverUrl: "https://example.com/mcp/sse",
    }),
  ],
  prompt: "Use the MCP tool to get data.",
});
```

### Multi-turn Conversation

Use `previousResponseId` for multi-turn conversations:

```typescript
const first = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  providerOptions: {
    dashscope: {
      previousResponseId: first.response.id,
    },
  },
  prompt: "Follow up question...",
});
```

## Provider Configuration

```typescript
import { createDashScope } from "@agentor/dashscope";

const dashscope = createDashScope({
  apiKey: "sk-xxx",                       // or set DASHSCOPE_API_KEY env var
  region: "beijing",                       // beijing | singapore | us | germany
  workspaceId: "ws-xxx",                   // required for germany region
  baseURL: "https://custom-endpoint.com",  // override default base URL
  headers: { "X-Custom-Header": "value" }, // custom headers
});
```

## License

MIT © [Demo Macro](https://www.demomacro.com/)
