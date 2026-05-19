import { type LanguageModelUsage, generateText, streamText } from "ai";
import type { ModelMessage } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";

import type { ServerContext } from "../../types";
import { generateId, mapFinishReason } from "../../utils";
import { sseData, sseDone } from "../utils";

type RequestBody = ChatCompletionCreateParamsBase & Record<string, unknown>;

// --- Conversion ---

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

export function convertParams(body: RequestBody): Record<string, unknown> {
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
  // Deprecated: function_call → toolChoice
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

// --- Response ---

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

export function buildCompletion(
  id: string,
  model: string,
  text: string,
  finishReason: string | undefined,
  usage?: LanguageModelUsage,
): ChatCompletion {
  return {
    id,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
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

// --- Route ---

export function registerChatCompletions(app: H3, context: ServerContext) {
  app.post(
    "/chat/completions",
    defineHandler(async (event) => {
      try {
        const body = (await event.req.json()) as RequestBody;
        if (!body.model || !body.messages) {
          event.res.status = 400;
          return {
            error: {
              message: "Missing required fields: model, messages",
              type: "invalid_request_error",
            },
          };
        }

        const model = context.registry.languageModel(body.model as never);
        const messages = convertMessages(body.messages);
        const params = convertParams(body);
        const providerOptions = body.providerOptions as Parameters<
          typeof generateText
        >[0]["providerOptions"];

        if (body.stream) {
          const id = generateId("chatcmpl");
          const result = streamText({ model, messages, ...params, providerOptions });
          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(
                encoder.encode(
                  sseData(
                    JSON.stringify(buildChunk(id, body.model, { role: "assistant", content: "" })),
                  ),
                ),
              );

              try {
                for await (const part of result.fullStream) {
                  if (part.type === "text-delta") {
                    controller.enqueue(
                      encoder.encode(
                        sseData(JSON.stringify(buildChunk(id, body.model, { content: part.text }))),
                      ),
                    );
                  } else if (part.type === "tool-call") {
                    controller.enqueue(
                      encoder.encode(
                        sseData(
                          JSON.stringify(
                            buildChunk(id, body.model, {
                              tool_calls: [
                                {
                                  index: 0,
                                  id: part.toolCallId,
                                  type: "function",
                                  function: {
                                    name: part.toolName,
                                    arguments:
                                      typeof part.input === "string"
                                        ? part.input
                                        : JSON.stringify(part.input),
                                  },
                                },
                              ],
                            }),
                          ),
                        ),
                      ),
                    );
                  } else if (part.type === "finish") {
                    controller.enqueue(
                      encoder.encode(
                        sseData(
                          JSON.stringify(
                            buildChunk(
                              id,
                              body.model,
                              {},
                              mapFinishReason(part.finishReason),
                              part.totalUsage,
                            ),
                          ),
                        ),
                      ),
                    );
                  }
                }
              } catch {
                controller.enqueue(
                  encoder.encode(sseData(JSON.stringify(buildChunk(id, body.model, {})))),
                );
              }

              controller.enqueue(encoder.encode(sseDone()));
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        const result = await generateText({ model, messages, ...params, providerOptions });
        return buildCompletion(
          generateId("chatcmpl"),
          body.model,
          result.text,
          result.finishReason,
          result.usage,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        event.res.status = 500;
        return { error: { message, type: "internal_error" } };
      }
    }),
  );
}
