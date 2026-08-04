# @agentor/dashscope

[English](./README.md) | **[中文](./README.zh-CN.md)**

![npm version](https://img.shields.io/npm/v/@agentor/dashscope)
![npm downloads](https://img.shields.io/npm/dw/@agentor/dashscope)
![npm license](https://img.shields.io/npm/l/@agentor/dashscope)

> [AI SDK](https://ai-sdk.dev/) provider for [Alibaba Cloud DashScope (Bailian)](https://help.aliyun.com/zh/model-studio/) API.

## 功能特性

- **Chat Completions** - `/chat/completions`，支持函数调用、流式输出、推理和视觉
- **Completions (FIM)** - `/completions`，Qwen Coder 模型的代码补全
- **Responses** - `/responses` 端点，内置工具（联网搜索、代码解释器、MCP 等）
- **Embedding** - `/embeddings` 端点的文本向量化
- **Reranking** - `/reranks` 端点的文档重排序
- **Image Generation** - 多模态生成端点的文生图
- **Video Generation** - 文生视频和图生视频，异步轮询
- **Speech Synthesis** - CosyVoice 和 Qwen-TTS 模型的文本转语音
- **Transcription** - 短音频和长音频的语音转文字
- **Built-in Tools** - 联网搜索、代码解释器、网页提取、文件搜索、以文搜图、以图搜图、MCP 集成
- **Thinking Mode** - 可配置预算的推理/思考模式
- **Multi-region** - 北京、新加坡、美国、德国区域
- **AI SDK V4** - 实现 LanguageModelV4 规范
- **TypeScript-First** - 完整的类型安全支持

## 安装

```bash
# Install with npm
$ npm install @agentor/dashscope

# Install with yarn
$ yarn add @agentor/dashscope

# Install with pnpm
$ pnpm add @agentor/dashscope
```

## 快速开始

### 初始化

```typescript
import { createDashScope } from "@agentor/dashscope";

const dashscope = createDashScope({
  apiKey: process.env.DASHSCOPE_API_KEY,
});
```

或使用默认实例（自动读取 `DASHSCOPE_API_KEY` 环境变量）：

```typescript
import { dashscope } from "@agentor/dashscope";
```

### 基础对话

```typescript
import { dashscope } from "@agentor/dashscope";
import { generateText } from "ai";

const result = await generateText({
  model: dashscope("qwen3.5-flash"),
  prompt: "Introduce yourself in one sentence.",
});

console.log(result.text);
```

### 流式输出

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

### 函数调用

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

### 联网搜索

通过 `providerOptions` 启用联网搜索：

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

选项：`enableSearch`、`searchStrategy`（`"enable"` | `"enable_with_history"` | `"agent_max"`）。

### 代码解释器

启用代码解释器（需要开启思考模式）：

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

### 思考模式

启用推理并配置 token 预算：

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

## 上下文缓存

适用于 Chat 端点（`dashscope(modelId)`）。Responses 端点（`dashscope.responses(modelId)`）改用 session 请求头缓存——见 [Session 缓存](#session-缓存)。

DashScope 支持显式缓存以减少重复前缀的成本和延迟。通过 `providerOptions` 在消息或内容块上添加 `cacheControl`：

```typescript
import { generateText } from "ai";

// 缓存长系统提示词（最少 1024 tokens）
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

// 第二次请求使用相同系统提示词会命中缓存
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

在用户消息的内容块上设置缓存：

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

> 支持的模型会自动启用隐式缓存，无需配置。

### 与结构化输出共用

默认情况下，schema 通过 `response_format`（json_schema）发送，不进入 messages，因此无论 `cacheControl` 标记在 system 还是 user 消息上，都能持续命中，即使每次请求 schema 变化。

只有不支持 `json_schema` 的模型才会回退到 `json_object` + 提示词注入。在该回退路径下，schema 会作为 `user` 消息注入到 system 块之后，落在 system 缓存前缀之外，因此 system 侧的 `cacheControl` 标记仍能命中。Qwen3.5+ 会把所有 system 消息合并为单个缓存段，且只在段尾才会识别 `cache_control` 标记，所以 schema 绝不会作为 system 消息注入。建议把 `cacheControl` 设在 system 消息上；回退模式下若设在 user 内容块上，注入的 schema 会落在该内容之前，可能影响其缓存。

## JSON 输出

### 带 Schema 的结构化输出

使用 `generateText` 配合 `Output.object()` 生成类型化的 JSON：

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

provider 默认通过原生 `response_format: { type: "json_schema" }`（strict）发送 schema。schema 在服务端强制，且只存在于 `response_format`、不进入 messages——因此无论 `cacheControl` 标记在何处都能持续命中，即使每次请求 schema 变化。不支持 `json_schema` 的模型会自动回退到 `json_object` + 提示词注入（best-effort，请校验输出）。

#### 支持的模型

结构化输出在千问全系列及合作伙伴模型上均受支持，包括 `qwen3.7-max`、`qwen3-max`、`qwen3.7-plus`、`qwen-plus`、`qwen3.7-flash`、`qwen3.5-flash`、`qwen-flash`、`qwen-turbo`、`qwen3-coder`、`qwen-long`、千问 VL 系列，以及合作伙伴模型（Kimi、DeepSeek、GLM、Stepfun）。完整列表见[官方文档](https://help.aliyun.com/zh/model-studio/structured-output)。

#### 思考模式

标注"非思考模式"的模型在思考模式下可能返回非严格 JSON。如需稳定的结构化输出，避免将 `enableThinking` 与 `Output.object` 同时使用；或采用两步修复法：先用思考模型生成，再用快速的非思考模型（如 `qwen-flash`）配合 `Output.object` 规范化输出。

#### 避免设置 `maxOutputTokens`

使用结构化输出时不要设置 `maxOutputTokens`（即 `max_tokens`）——限制输出 token 可能导致 JSON 在流式输出中被截断、解析失败。

## Completions (FIM)

使用 `completionModel()` 通过 `/completions` 端点进行文本/代码补全（Fill-In-the-Middle）：

```typescript
const result = await generateText({
  model: dashscope.completionModel("qwen2.5-coder-32b-instruct"),
  prompt:
    '<|fim_prefix|>def quick_sort(arr):\n    """Sort array using quicksort."""\n<|fim_suffix|>\n    return arr\n<|fim_middle|>',
});

console.log(result.text);
```

## Responses API

使用 `responses` 命名空间访问带内置工具的 Responses API：

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  prompt: "Search the web for the latest news.",
});
```

### 内置工具

#### 联网搜索

```typescript
import { dashscope } from "@agentor/dashscope";
import { generateText } from "ai";

const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.webSearch()],
  prompt: "What are the latest tech news today?",
});
```

选项：`forcedSearch`、`searchStrategy`（`"enable"` | `"enable_with_history"`）。

#### 代码解释器

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.codeInterpreter()],
  prompt: "Calculate the sum of the first 20 Fibonacci numbers.",
});
```

#### 网页提取

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.webExtractor()],
  prompt: "Extract the main content from https://example.com",
});
```

> 可与 `webSearch` 搭配使用以获得更好的结果。

#### 文件搜索

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

#### MCP 集成

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

选项：`serverProtocol`、`serverLabel`、`serverUrl`、`serverDescription`、`headers`。

#### 以文搜图

基于文本描述搜索图片。

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.webSearchImage()],
  prompt: "搜索埃菲尔铁塔日落时的图片。",
});
```

#### 以图搜图

基于输入图片搜索相似图片。

```typescript
const result = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  tools: [dashscope.responses.tools.imageSearch()],
  prompt: "搜索与 https://example.com/cat.jpg 相似的图片。",
});
```

### 多轮对话

通过 `providerOptions.dashscope` 配置：`previousResponseId`、`enableThinking`、`reasoning`（推理力度）、`conversation`、`instructions`、`includeUsage`。

使用 `previousResponseId` 进行多轮对话：

```typescript
const first = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  prompt: "Tell me about TypeScript.",
});

const second = await generateText({
  model: dashscope.responses("qwen3.5-flash"),
  providerOptions: {
    dashscope: {
      previousResponseId: first.response.id,
    },
  },
  prompt: "Follow up question...",
});
```

### Session 缓存

Responses 端点通过服务端 **Session 缓存**而非 `cache_control` 标记来缓存。在任意消息上设置 `cacheControl` 会自动发送 `x-dashscope-session-cache: enable` 请求头——配合上文的 `previousResponseId` 跨轮携带上下文即可命中缓存（最少 1024 token，有效期 5 分钟）。

## Embedding

```typescript
import { embed, embedMany } from "ai";

// 单文本嵌入
const { embedding, usage } = await embed({
  model: dashscope.embeddingModel("text-embedding-v4"),
  value: "The clothes quality is excellent",
});

console.log(embedding.length); // 1024 (default dimensions)

// 批量嵌入
const { embeddings } = await embedMany({
  model: dashscope.embeddingModel("text-embedding-v4"),
  values: ["Hello world", "Machine learning is fascinating"],
});
```

### 自定义维度

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

### Top N 结果

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

使用包含 `-i2v` 的模型 ID 进入图生视频模式：

```typescript
const { videos } = await generateVideo({
  model: dashscope.videoModel("wan2.7-i2v"),
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

### 短音频（同步）

```typescript
import { experimental_transcribe as transcribe } from "ai";

const { text } = await transcribe({
  model: dashscope.transcriptionModel("qwen3-asr-flash"),
  audio: new URL("https://example.com/audio.mp3"),
});

console.log(text);
```

### 长音频（异步）

对于异步模型，通过 `providerOptions` 提供音频 URL：

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

## Provider 配置

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

> For the complete and up-to-date model list, see [Alibaba Cloud Model Studio](https://help.aliyun.com/en/model-studio/models).

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
