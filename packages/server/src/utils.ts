import type { LanguageModelUsage } from "ai";
import type { ModelMessage } from "ai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";
import type { ImagesResponse } from "openai/resources/images";

import type { Handler } from "./types";

// --- Handler ---

export type HandlerFactory<OptionsT> = (opts?: OptionsT) => Handler;

// --- ID & Finish Reason ---

export function generateId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${id}`;
}

export function mapFinishReason(
  reason: string | undefined | null,
): "stop" | "length" | "tool_calls" | "content_filter" | "function_call" {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
      return "tool_calls";
    case "content-filter":
      return "content_filter";
    default:
      return "stop";
  }
}

// --- SSE ---

export function sseData(data: string): string {
  return `data: ${data}\n\n`;
}

export function sseEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export function sseDone(): string {
  return "data: [DONE]\n\n";
}

// --- OpenAI Chat Conversion ---

export function convertMessages(messages: ChatCompletionMessageParam[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      result.push({ role: "system", content });
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const content: Array<{ type: "text"; text: string } | { type: "image"; image: URL }> = [];
        for (const p of msg.content) {
          if (p.type === "text") content.push({ type: "text", text: p.text });
          else if (p.type === "image_url")
            content.push({ type: "image", image: new URL(p.image_url.url) });
        }
        result.push({ role: "user", content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const functionCalls = msg.tool_calls?.filter(
        (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function",
      );

      if (functionCalls?.length) {
        const content: Array<
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        > = [];
        if (msg.content) {
          const text = typeof msg.content === "string" ? msg.content : "";
          if (text) content.push({ type: "text", text });
        }
        for (const tc of functionCalls) {
          content.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}"),
          });
        }
        result.push({ role: "assistant", content });
      } else {
        const text = typeof msg.content === "string" ? msg.content : "";
        result.push({ role: "assistant", content: text });
      }
      continue;
    }

    if (msg.role === "tool") {
      const text =
        typeof msg.content === "string" ? msg.content : msg.content.map((p) => p.text).join("");
      result.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: msg.tool_call_id,
            toolName: "",
            output: { type: "text" as const, value: text },
          },
        ],
      });
      continue;
    }
  }

  return result;
}

export function convertParams(
  body: ChatCompletionCreateParamsBase & Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (body.temperature != null) params.temperature = body.temperature;
  if (body.top_p != null) params.topP = body.top_p;
  if (body.max_completion_tokens != null) {
    params.maxOutputTokens = body.max_completion_tokens;
  } else if (body.max_tokens != null) {
    params.maxOutputTokens = body.max_tokens;
  }
  if (body.frequency_penalty != null) params.frequencyPenalty = body.frequency_penalty;
  if (body.presence_penalty != null) params.presencePenalty = body.presence_penalty;
  if (body.seed != null) params.seed = body.seed;
  if (body.stop) params.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.tools?.length) {
    const tools: Record<string, unknown> = {};
    for (const t of body.tools) {
      if (t.type !== "function") continue;
      tools[t.function.name] = {
        description: t.function.description,
        parameters: t.function.parameters,
      };
    }
    params.tools = tools;
  }
  if (body.tool_choice != null) {
    const tc = body.tool_choice as ChatCompletionToolChoiceOption;
    if (typeof tc === "string") {
      params.toolChoice = tc;
    } else if (tc.type === "function") {
      params.toolChoice = { type: "tool", toolName: tc.function.name };
    }
  }
  if (body.function_call != null && body.tool_choice == null) {
    const fc = body.function_call;
    if (typeof fc === "string") {
      params.toolChoice = fc;
    } else if ("name" in fc) {
      params.toolChoice = { type: "tool", toolName: fc.name };
    }
  }
  return params;
}

// --- OpenAI Usage Conversion ---

export function convertUsage(usage?: LanguageModelUsage): CompletionUsage {
  const promptTokens = usage?.inputTokens ?? 0;
  const completionTokens = usage?.outputTokens ?? 0;
  const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens;
  const reasoningTokens = usage?.outputTokenDetails?.reasoningTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(cachedTokens || reasoningTokens
      ? {
          prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined,
          completion_tokens_details: reasoningTokens
            ? { reasoning_tokens: reasoningTokens }
            : undefined,
        }
      : {}),
  };
}

// --- OpenAI Chat Response Builders ---

export function buildCompletion(
  id: string,
  model: string,
  text: string,
  finishReason: string | undefined,
  usage?: LanguageModelUsage,
  timestamp?: Date,
): ChatCompletion {
  return {
    id,
    object: "chat.completion" as const,
    created: Math.floor((timestamp ?? new Date()).getTime() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text, refusal: null },
        finish_reason: mapFinishReason(finishReason),
        logprobs: null,
      },
    ],
    usage: convertUsage(usage),
  };
}

export function buildChunk(
  id: string,
  model: string,
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null = null,
  usage?: LanguageModelUsage,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage: convertUsage(usage) } : {}),
  };
}

// --- OpenAI Image Utilities ---

export function convertImageUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): ImagesResponse.Usage {
  return {
    input_tokens: usage.inputTokens ?? 0,
    input_tokens_details: { image_tokens: 0, text_tokens: 0 },
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
  };
}

export function inferOutputFormat(mediaType: string | undefined): ImagesResponse["output_format"] {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpeg";
  if (mediaType === "image/webp") return "webp";
  return undefined;
}

export function extractImageProviderMeta(
  providerMetadata: Record<string, unknown> | undefined,
  mediaType: string | undefined,
): Partial<ImagesResponse> {
  if (!providerMetadata) return {};

  const provider = Object.values(providerMetadata)[0] as
    | { images?: Array<Record<string, unknown>> }
    | undefined;
  const meta = provider?.images?.[0];
  if (!meta) return {};

  const background = meta.background;
  const outputFormat = meta.outputFormat ?? meta.output_format;
  const quality = meta.quality;
  const size = meta.size;

  return {
    background: background === "transparent" || background === "opaque" ? background : undefined,
    output_format:
      outputFormat === "png" || outputFormat === "jpeg" || outputFormat === "webp"
        ? outputFormat
        : inferOutputFormat(mediaType),
    quality: quality === "low" || quality === "medium" || quality === "high" ? quality : undefined,
    size: size === "1024x1024" || size === "1024x1536" || size === "1536x1024" ? size : undefined,
  };
}
