import {
  convertOpenAICompatibleChatUsage,
  getResponseMetadata,
  mapOpenAICompatibleFinishReason,
  prepareTools,
} from "@ai-sdk/openai-compatible/internal";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  SharedV4Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  isParsableJson,
  parseProviderOptions,
  postJsonToApi,
  type ParseResult,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

import type { DashScopeChatOptions } from "./types";
import {
  buildJsonInstruction,
  extractCacheControl,
  failedResponseHandler,
  fileDataToImageUrl,
  isJsonSchemaUnsupportedError,
  type DashScopeConfig,
} from "./utils";

// --- Schemas ---

const chatOptionsSchema = z.object({
  enableThinking: z.boolean().optional(),
  thinkingBudget: z.number().positive().optional(),
  parallelToolCalls: z.boolean().optional(),
  enableSearch: z.boolean().optional(),
  searchStrategy: z.enum(["enable", "enable_with_history", "agent_max"]).optional(),
  enableCodeInterpreter: z.boolean().optional(),
});

const usageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().nullish(),
      cache_creation_input_tokens: z.number().nullish(),
    })
    .nullish(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().nullish(),
    })
    .nullish(),
});

const chatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant").nullish(),
        content: z.string().nullish(),
        reasoning_content: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              type: z.literal("function"),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
      index: z.number(),
    }),
  ),
  usage: usageSchema.nullish(),
});

const chatChunkSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      delta: z.object({
        role: z.enum(["assistant"]).nullish(),
        content: z.string().nullish(),
        reasoning_content: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              index: z.number().nullish(),
              id: z.string().nullish(),
              type: z.literal("function").nullish(),
              function: z
                .object({
                  name: z.string().nullish(),
                  arguments: z.string().nullish(),
                })
                .nullish(),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
      index: z.number(),
    }),
  ),
  usage: usageSchema.nullish(),
});

// --- Message conversion ---

function convertMessages(
  prompt: LanguageModelV4CallOptions["prompt"],
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  for (const message of prompt) {
    const { role, content, providerOptions: msgProviderOptions } = message;

    switch (role) {
      case "system": {
        const cc = extractCacheControl(msgProviderOptions);
        if (cc) {
          messages.push({
            role: "system",
            content: [{ type: "text", text: content as string, ...cc }],
          });
        } else {
          messages.push({ role: "system", content: content as string });
        }
        break;
      }

      case "user": {
        const parts: Array<Record<string, unknown>> = [];
        for (const part of content) {
          switch (part.type) {
            case "text": {
              const cc = extractCacheControl(part.providerOptions);
              parts.push({ type: "text", text: part.text, ...cc });
              break;
            }
            case "file": {
              // V4 normalizes `image/*` to the top-level `image`, so match the prefix.
              if (part.mediaType.startsWith("image")) {
                const url = fileDataToImageUrl(part.data, part.mediaType);
                if (url) {
                  parts.push({ type: "image_url", image_url: { url } });
                }
              }
              break;
            }
          }
        }

        messages.push({ role: "user", content: parts });
        break;
      }

      case "assistant": {
        let text = "";
        const toolCalls: Array<Record<string, unknown>> = [];

        for (const part of content) {
          switch (part.type) {
            case "text":
            case "reasoning":
              text += part.text;
              break;
            case "tool-call":
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: { name: part.toolName, arguments: JSON.stringify(part.input) },
              });
              break;
          }
        }

        messages.push({
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        });
        break;
      }

      case "tool": {
        for (const part of content) {
          if (part.type === "tool-approval-response") continue;

          let outputValue: string;
          switch (part.output.type) {
            case "text":
            case "error-text":
              outputValue = part.output.value;
              break;
            case "execution-denied":
              outputValue = part.output.reason ?? "Tool execution denied.";
              break;
            default:
              outputValue = JSON.stringify(part.output.value);
          }

          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: outputValue,
          });
        }
        break;
      }
    }
  }

  return messages;
}

// --- Model ---

export class DashScopeChatLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly modelId: string;
  private readonly config: DashScopeConfig;
  // Flipped on the first json_schema rejection so later calls on this model
  // instance skip the probe and go straight to json_object + injection.
  private jsonSchemaUnsupported = false;

  constructor(modelId: string, config: DashScopeConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return { "image/*": [/^https?:\/\/.*$/] };
  }

  private async getArgs(options: LanguageModelV4CallOptions) {
    const warnings: SharedV4Warning[] = [];

    if (options.frequencyPenalty != null) {
      warnings.push({ type: "unsupported", feature: "frequencyPenalty" });
    }

    const dsOptions = await parseProviderOptions<DashScopeChatOptions>({
      provider: "dashscope",
      providerOptions: options.providerOptions,
      schema: chatOptionsSchema,
    });

    const {
      tools: apiTools,
      toolChoice,
      toolWarnings,
    } = prepareTools({
      tools: options.tools,
      toolChoice: options.toolChoice,
    });

    warnings.push(...toolWarnings);

    const messages = convertMessages(options.prompt);

    // Native json_schema (DashScope structured output) enforces the schema
    // server-side AND keeps it out of the messages — so a cacheControl marker
    // anywhere (system or user) keeps hitting even as the schema varies per
    // call. Prefer it whenever a schema is present, unless this model instance
    // has already rejected json_schema (jsonSchemaUnsupported).
    const useNativeJsonSchema =
      !this.jsonSchemaUnsupported &&
      options.responseFormat?.type === "json" &&
      options.responseFormat.schema != null;

    if (options.responseFormat?.type === "json" && !useNativeJsonSchema) {
      // json_object fallback: json_object only guarantees JSON shape (not the
      // schema) and requires the word "json" in the prompt, so inject the
      // schema as guidance — the instruction also satisfies the keyword
      // requirement.
      const jsonInstruction = buildJsonInstruction(options.responseFormat);

      // Place the schema immediately AFTER the system block:
      //  - ai-sdk passes the schema via responseFormat and leaves prompt
      //    injection to the provider, so the position is ours to choose.
      //  - Prefix caching caches the stable prefix up to the cache_control
      //    marker, which sits at the system-segment tail. The schema varies
      //    per call, so it must stay OUTSIDE that prefix — i.e. after every
      //    system message. As a user message it also stays out of the Qwen3.5+
      //    merged system segment, so a system-side marker keeps hitting.
      //  - Sitting before the first real user turn, it never becomes the
      //    trailing turn or splits the conversation mid-history.
      // With no system message, fall back to a single system message (only
      // one system message => no merge risk) for stronger schema adherence.
      const lastSystemIdx = messages.findLastIndex((m) => m.role === "system");
      if (lastSystemIdx === -1) {
        messages.unshift({ role: "system", content: jsonInstruction });
      } else {
        messages.splice(lastSystemIdx + 1, 0, {
          role: "user",
          content: jsonInstruction,
        });
      }
    }

    // Build response_format here (rather than inline in `args`) so the
    // `type === "json"` guard narrows the discriminated union and exposes
    // name/description/schema on the json variant.
    let responseFormatArg: Record<string, unknown> | undefined;
    if (options.responseFormat?.type === "json") {
      responseFormatArg = useNativeJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: options.responseFormat.name ?? "schema",
              ...(options.responseFormat.description != null && {
                description: options.responseFormat.description,
              }),
              strict: true,
              schema: options.responseFormat.schema,
            },
          }
        : { type: "json_object" };
    }

    const args: Record<string, unknown> = {
      model: this.modelId,
      messages,
      ...(options.maxOutputTokens != null && { max_tokens: options.maxOutputTokens }),
      ...(options.temperature != null && { temperature: options.temperature }),
      ...(options.topP != null && { top_p: options.topP }),
      ...(options.topK != null && { top_k: options.topK }),
      ...(options.presencePenalty != null && { presence_penalty: options.presencePenalty }),
      ...(options.stopSequences?.length && { stop: options.stopSequences }),
      ...(options.seed != null && { seed: options.seed }),
      ...(responseFormatArg && { response_format: responseFormatArg }),
      ...(apiTools != null && { tools: apiTools, tool_choice: toolChoice }),
      ...(dsOptions?.parallelToolCalls != null && {
        parallel_tool_calls: dsOptions.parallelToolCalls,
      }),
      // DashScope-specific options
      ...(dsOptions?.enableThinking != null && { enable_thinking: dsOptions.enableThinking }),
      ...(dsOptions?.thinkingBudget != null && { thinking_budget: dsOptions.thinkingBudget }),
      ...(dsOptions?.enableSearch != null && { enable_search: dsOptions.enableSearch }),
      ...(dsOptions?.searchStrategy != null && {
        search_options: { search_strategy: dsOptions.searchStrategy },
      }),
      ...(dsOptions?.enableCodeInterpreter != null && {
        enable_code_interpreter: dsOptions.enableCodeInterpreter,
      }),
    };

    return { args, warnings };
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    try {
      return await this.doGenerateOnce(options);
    } catch (error) {
      if (this.shouldFallbackToJsonObject(error)) {
        this.jsonSchemaUnsupported = true;
        return await this.doGenerateOnce(options);
      }
      throw error;
    }
  }

  // Decide whether a failed request should retry with json_object + injection.
  // Only the first json_schema probe on an unsupported model raises this error;
  // the json_object path always injects the "JSON" keyword so it never fires
  // there. Once flipped, jsonSchemaUnsupported prevents further retries.
  private shouldFallbackToJsonObject(error: unknown): boolean {
    return !this.jsonSchemaUnsupported && isJsonSchemaUnsupportedError(error);
  }

  private async doGenerateOnce(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const { args, warnings } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/compatible-mode/v1/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(chatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = response.choices[0];
    const content: Array<LanguageModelV4Content> = [];

    if (choice.message.content != null && choice.message.content.length > 0) {
      content.push({ type: "text", text: choice.message.content });
    }

    if (choice.message.reasoning_content != null && choice.message.reasoning_content.length > 0) {
      content.push({ type: "reasoning", text: choice.message.reasoning_content });
    }

    if (choice.message.tool_calls != null) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
        });
      }
    }

    const finishReason: LanguageModelV4FinishReason = {
      unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
      raw: choice.finish_reason ?? undefined,
    };

    return {
      content,
      finishReason,
      usage: convertOpenAICompatibleChatUsage(response.usage),
      request: { body: args },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
      },
      warnings,
    };
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    try {
      return await this.doStreamOnce(options);
    } catch (error) {
      if (this.shouldFallbackToJsonObject(error)) {
        this.jsonSchemaUnsupported = true;
        return await this.doStreamOnce(options);
      }
      throw error;
    }
  }

  private async doStreamOnce(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    const { args, warnings } = await this.getArgs(options);
    const body = { ...args, stream: true };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/compatible-mode/v1/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(chatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV4FinishReason = { unified: "other", raw: undefined };
    let usage: z.infer<typeof usageSchema> | undefined;

    let isFirstChunk = true;
    let activeText = false;
    let activeReasoningId: string | null = null;

    const toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
      hasFinished: boolean;
    }> = [];

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof chatChunkSchema>>,
          LanguageModelV4StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },

          transform(chunk, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
            }

            if (!chunk.success) {
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }

            const value = chunk.value;

            if (isFirstChunk) {
              isFirstChunk = false;
              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata(value),
              });
            }

            if (value.usage != null) {
              usage = value.usage;
            }

            if (value.choices.length === 0) return;

            const choice = value.choices[0];
            const delta = choice.delta;

            // Reasoning content
            if (delta.reasoning_content != null && delta.reasoning_content.length > 0) {
              if (activeReasoningId == null) {
                if (activeText) {
                  controller.enqueue({ type: "text-end", id: "0" });
                  activeText = false;
                }
                activeReasoningId = generateId();
                controller.enqueue({ type: "reasoning-start", id: activeReasoningId });
              }
              controller.enqueue({
                type: "reasoning-delta",
                id: activeReasoningId,
                delta: delta.reasoning_content,
              });
            }

            // Text content
            if (delta.content != null && delta.content.length > 0) {
              if (activeReasoningId != null) {
                controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
                activeReasoningId = null;
              }
              if (!activeText) {
                controller.enqueue({ type: "text-start", id: "0" });
                activeText = true;
              }
              controller.enqueue({ type: "text-delta", id: "0", delta: delta.content });
            }

            // Tool calls
            if (delta.tool_calls != null) {
              if (activeReasoningId != null) {
                controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
                activeReasoningId = null;
              }
              if (activeText) {
                controller.enqueue({ type: "text-end", id: "0" });
                activeText = false;
              }

              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index ?? toolCalls.length;

                if (toolCalls[index] == null) {
                  if (toolCallDelta.id == null || toolCallDelta.function?.name == null) continue;

                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallDelta.id,
                    toolName: toolCallDelta.function.name,
                  });

                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    function: {
                      name: toolCallDelta.function.name,
                      arguments: toolCallDelta.function.arguments ?? "",
                    },
                    hasFinished: false,
                  };

                  const tc = toolCalls[index];
                  if (tc.function.arguments.length > 0) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: tc.id,
                      delta: tc.function.arguments,
                    });
                  }
                  if (isParsableJson(tc.function.arguments)) {
                    controller.enqueue({ type: "tool-input-end", id: tc.id });
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: tc.id,
                      toolName: tc.function.name,
                      input: tc.function.arguments,
                    });
                    tc.hasFinished = true;
                  }
                  continue;
                }

                const tc = toolCalls[index];
                if (tc.hasFinished) continue;

                if (toolCallDelta.function?.arguments != null) {
                  tc.function.arguments += toolCallDelta.function.arguments;
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: tc.id,
                    delta: toolCallDelta.function.arguments,
                  });
                }

                if (isParsableJson(tc.function.arguments)) {
                  controller.enqueue({ type: "tool-input-end", id: tc.id });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: tc.id,
                    toolName: tc.function.name,
                    input: tc.function.arguments,
                  });
                  tc.hasFinished = true;
                }
              }
            }

            if (choice.finish_reason != null) {
              finishReason = {
                unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
                raw: choice.finish_reason,
              };
            }
          },

          flush(controller) {
            if (activeReasoningId != null) {
              controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
            }
            if (activeText) {
              controller.enqueue({ type: "text-end", id: "0" });
            }
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: convertOpenAICompatibleChatUsage(usage),
            });
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}
