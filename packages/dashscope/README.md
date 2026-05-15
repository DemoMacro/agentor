# @agentor/dashscope

![npm version](https://img.shields.io/npm/v/@agentor/dashscope)
![npm downloads](https://img.shields.io/npm/dw/@agentor/dashscope)
![npm license](https://img.shields.io/npm/l/@agentor/dashscope)

> [AI SDK](https://ai-sdk.dev/) provider for [Alibaba Cloud DashScope (Bailian)](https://help.aliyun.com/en/model-studio/) API.

## Features

- **Chat Completions** - `/chat/completions` with function calling, streaming, reasoning, and vision
- **Completions (FIM)** - `/completions` for code completion with Qwen Coder models
- **Responses** - `/responses` endpoint with built-in tools (web search, code interpreter, MCP, etc.)
- **Embedding** - Text vectorization via `/embeddings` endpoint
- **Reranking** - Document reranking via `/reranks` endpoint
- **Image Generation** - Text-to-image via multimodal generation endpoint
- **Video Generation** - Text-to-video and image-to-video with async polling
- **Speech Synthesis** - Text-to-speech for CosyVoice and Qwen-TTS models
- **Transcription** - Speech-to-text for short and long audio
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

## Context Cache

DashScope supports explicit caching to reduce cost and latency for repeated prefixes. Add `cacheControl` via `providerOptions` on messages or content parts:

```typescript
import { generateText } from "ai";

// Cache a long system prompt (minimum 1024 tokens)
const first = await generateText({
  model: dashscope("qwen3.5-flash"),
  messages: [
    {
      role: "system",
      content: longText, // must be >= 1024 tokens
      providerOptions: {
        dashscope: { cacheControl: { type: "ephemeral" } },
      },
    },
    { role: "user", content: "What does this code do?" },
  ],
});

// Second request with same system prompt hits the cache
const second = await generateText({
  model: dashscope("qwen3.5-flash"),
  messages: [
    {
      role: "system",
      content: longText,
      providerOptions: {
        dashscope: { cacheControl: { type: "ephemeral" } },
      },
    },
    { role: "user", content: "How can it be optimized?" },
  ],
});
```

Cache on user message content parts:

```typescript
await generateText({
  model: dashscope("qwen3.5-flash"),
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: longCode,
          providerOptions: {
            dashscope: { cacheControl: { type: "ephemeral" } },
          },
        },
        { type: "text", text: "Explain this code." },
      ],
    },
  ],
});
```

> Implicit caching is enabled automatically for supported models — no configuration needed.

## JSON Output

### Structured Output with Schema

Use `generateText` with `Output.object()` to generate typed JSON:

```typescript
import { generateText, Output } from "ai";
import { z } from "zod/v4";

const result = await generateText({
  model: dashscope("qwen3.5-flash"),
  prompt: "List 3 programming languages with their creators.",
  output: Output.object({
    schema: z.object({
      languages: z.array(
        z.object({
          name: z.string(),
          creator: z.string(),
          year: z.number(),
        }),
      ),
    }),
  }),
});

console.log(result.output);
```

## Completions (FIM)

Use `completionModel()` for text/code completion via the `/completions` endpoint (Fill-In-the-Middle):

```typescript
const result = await generateText({
  model: dashscope.completionModel("qwen2.5-coder-32b-instruct"),
  prompt:
    '<|fim_prefix|>def quick_sort(arr):\n    """Sort array using quicksort."""\n<|fim_suffix|>\n    return arr\n<|fim_middle|>',
});

console.log(result.text);
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

## Embedding

```typescript
import { embed, embedMany } from "ai";

// Single text embedding
const { embedding, usage } = await embed({
  model: dashscope.embeddingModel("text-embedding-v4"),
  value: "The clothes quality is excellent",
});

console.log(embedding.length); // 1024 (default dimensions)

// Batch embedding
const { embeddings } = await embedMany({
  model: dashscope.embeddingModel("text-embedding-v4"),
  values: ["Hello world", "Machine learning is fascinating"],
});
```

### Custom Dimensions

```typescript
const { embedding } = await embed({
  model: dashscope.embeddingModel("text-embedding-v4"),
  value: "Custom dimension embedding",
  providerOptions: {
    openaiCompatible: {
      dimensions: 256,
    },
  },
});

console.log(embedding.length); // 256
```

## Reranking

```typescript
import { rerank } from "ai";

const { ranking } = await rerank({
  model: dashscope.rerankingModel("qwen3-rerank"),
  query: "What is a reranking model?",
  documents: [
    "Reranking models sort candidate texts by relevance",
    "Quantum computing is a frontier field",
    "Pre-trained models brought advances to reranking",
  ],
});

for (const item of ranking) {
  console.log(`Index: ${item.originalIndex}, Score: ${item.score}`);
}
```

### Top N Results

```typescript
const { ranking } = await rerank({
  model: dashscope.rerankingModel("qwen3-rerank"),
  query: "How to reset password?",
  documents: [
    "Go to Settings > Security > Change Password",
    "Forgot your password?",
    "Two-factor authentication is supported",
  ],
  topN: 2,
});
```

## Image Generation

```typescript
import { generateImage } from "ai";

const { images } = await generateImage({
  model: dashscope.imageModel("qwen-image-plus"),
  prompt: "A cute cat sitting on a windowsill with sunlight streaming in",
  providerOptions: {
    dashscope: {
      size: "1024*1024",
    },
  },
});

// images[0].uint8Array — raw image data
// images[0].base64 — base64 encoded image
```

## Video Generation

```typescript
import { experimental_generateVideo as generateVideo } from "ai";

// Text-to-video
const { videos } = await generateVideo({
  model: dashscope.videoModel("wan2.6-t2v"),
  prompt: "A golden retriever running through a field of sunflowers",
  providerOptions: {
    dashscope: {
      size: "1280*720",
      duration: 5,
    },
  },
});
```

### Image-to-Video

Use a model ID containing `-i2v` for image-to-video mode:

```typescript
const { videos } = await generateVideo({
  model: dashscope.videoModel("wan2.6-i2v-turbo"),
  prompt: "The cat stretches and walks away",
  providerOptions: {
    dashscope: {
      resolution: "720P",
    },
  },
  image: "data:image/png;base64,...", // or a URL string
});
```

## Speech Synthesis (TTS)

```typescript
import { experimental_generateSpeech as generateSpeech } from "ai";
import { writeFileSync } from "fs";

const { audio } = await generateSpeech({
  model: dashscope.speechModel("cosyvoice-v3-flash"),
  text: "Hello, welcome to Agentor.",
  providerOptions: {
    dashscope: {
      voice: "longanyang",
      format: "wav",
      sampleRate: 24000,
    },
  },
});

writeFileSync("output.wav", audio.uint8Array);
```

## Transcription (Speech-to-Text)

### Short Audio (Sync)

```typescript
import { experimental_transcribe as transcribe } from "ai";

const { text } = await transcribe({
  model: dashscope.transcriptionModel("qwen3-asr-flash"),
  audio: new URL("https://example.com/audio.mp3"),
});

console.log(text);
```

### Long Audio (Async)

For async models, provide the audio URL via `providerOptions`:

```typescript
const { text, segments } = await transcribe({
  model: dashscope.transcriptionModel("qwen3-asr-flash-filetrans"),
  audio: new Uint8Array(0), // placeholder
  providerOptions: {
    dashscope: {
      fileUrl: "https://example.com/long-audio.mp3",
      enableWords: true,
    },
  },
});
```

## Provider Configuration

```typescript
import { createDashScope } from "@agentor/dashscope";

const dashscope = createDashScope({
  apiKey: "sk-xxx", // or set DASHSCOPE_API_KEY env var
  region: "beijing", // beijing | singapore | us | germany
  workspaceId: "ws-xxx", // required for germany region
  baseURL: "https://custom-endpoint.com", // override default base URL
  headers: { "X-Custom-Header": "value" }, // custom headers
});
```

## Available Models

> For the complete and up-to-date model list, see [Alibaba Cloud Model Studio](https://help.aliyun.com/zh/model-studio/models).

### Chat Completions (`/chat/completions`)

| Series      | Models                                                                         |
| ----------- | ------------------------------------------------------------------------------ |
| Qwen Max    | `qwen3.6-max-preview`, `qwen3-max`, `qwen-max`, `qwen-max-latest`              |
| Qwen Plus   | `qwen3.6-plus`, `qwen3.5-plus`, `qwen-plus`, `qwen-plus-latest`                |
| Qwen Flash  | `qwen3.6-flash`, `qwen3.5-flash`, `qwen-flash`                                 |
| Qwen Turbo  | `qwen-turbo`, `qwen-turbo-latest`                                              |
| Qwen Coder  | `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen-coder-plus`, `qwen-coder-turbo` |
| Qwen Long   | `qwen-long`, `qwen-long-latest`                                                |
| QwQ         | `qwq-plus`, `qwq-plus-latest`                                                  |
| Qwen Math   | `qwen-math-plus`, `qwen-math-turbo`                                            |
| Vision (VL) | `qwen3-vl-plus`, `qwen3-vl-flash`, `qwen-vl-max`, `qwen-vl-plus`               |
| QVQ         | `qvq-max`, `qvq-plus`                                                          |

### Completions (`/completions`)

| Model                        | Description             |
| ---------------------------- | ----------------------- |
| `qwen2.5-coder-32b-instruct` | Qwen2.5 Coder 32B       |
| `qwen2.5-coder-14b-instruct` | Qwen2.5 Coder 14B       |
| `qwen2.5-coder-7b-instruct`  | Qwen2.5 Coder 7B        |
| `qwen-coder-turbo-latest`    | Qwen Coder Turbo        |
| `qwen-coder-turbo`           | Qwen Coder Turbo (base) |

### Responses (`/responses`)

`qwen3-max`, `qwen3.6-plus`, `qwen3.6-flash`, `qwen3.5-plus`, `qwen3.5-flash`, `qwen-plus`, `qwen-flash`, `qwen3-coder-plus`, `qwen3-coder-flash`

### Embedding (`/embeddings`)

| Model               | Dimensions             | Languages              |
| ------------------- | ---------------------- | ---------------------- |
| `text-embedding-v4` | 64-2048 (default 1024) | 100+ languages         |
| `text-embedding-v3` | 64-1024 (default 1024) | 50+ languages          |
| `text-embedding-v2` | 1536                   | Chinese, English, etc. |
| `text-embedding-v1` | 1536                   | Chinese, English, etc. |

> Multimodal embedding models (`qwen3-vl-embedding`, `tongyi-embedding-vision-*`) do not support the OpenAI-compatible interface.

### Reranking (`/reranks`)

| Model             | Description                             |
| ----------------- | --------------------------------------- |
| `qwen3-rerank`    | Text reranking, 100+ languages          |
| `qwen3-vl-rerank` | Multimodal reranking (text/image/video) |
| `gte-rerank-v2`   | Semantic text reranking                 |

### Image Generation

| Model                | Description                                  |
| -------------------- | -------------------------------------------- |
| `wan2.7-image-pro`   | Latest Wan image generation, up to 4096x4096 |
| `wan2.7-image`       | Wan image generation, up to 2048x2048        |
| `qwen-image-2.0-pro` | Qwen image generation and editing            |
| `qwen-image-max`     | High quality image generation                |
| `qwen-image-plus`    | Enhanced image generation                    |
| `z-image-turbo`      | Fast image generation                        |

### Video Generation

| Model              | Mode | Description                           |
| ------------------ | ---- | ------------------------------------- |
| `wan2.7-t2v`       | T2V  | Recommended text-to-video with audio  |
| `wan2.6-t2v`       | T2V  | Text-to-video with audio              |
| `wan2.2-t2v-plus`  | T2V  | Text-to-video (silent)                |
| `wan2.7-i2v`       | I2V  | Recommended image-to-video with audio |
| `wan2.6-i2v`       | I2V  | Image-to-video with audio             |
| `wan2.6-i2v-flash` | I2V  | Fast image-to-video                   |

### Speech Synthesis (TTS)

| Model                      | Description                        |
| -------------------------- | ---------------------------------- |
| `cosyvoice-v3.5-plus`      | Latest flagship, best quality      |
| `cosyvoice-v3.5-flash`     | Latest lightweight                 |
| `cosyvoice-v3-plus`        | V3 enhanced                        |
| `cosyvoice-v3-flash`       | V3 fast synthesis                  |
| `qwen3-tts-flash-realtime` | Qwen TTS with 17 human-like voices |

### Transcription (STT)

| Model                       | Mode  | Description                    |
| --------------------------- | ----- | ------------------------------ |
| `qwen3-asr-flash`           | Sync  | Short audio (up to 5 min)      |
| `qwen3-asr-flash-filetrans` | Async | Long audio (up to 12 hours)    |
| `fun-asr`                   | Async | Speaker diarization, hot words |
| `paraformer-v2`             | Async | Legacy async transcription     |

## License

MIT © [Demo Macro](https://www.demomacro.com/)
