import {
  convertOpenAICompatibleChatUsage,
  getResponseMetadata,
  mapOpenAICompatibleFinishReason,
  prepareTools,
} from "@ai-sdk/openai-compatible/internal";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  convertToBase64,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  isParsableJson,
  parseProviderOptions,
  postJsonToApi,
  type ParseResult,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
import { failedResponseHandler, type DashScopeConfig } from "./utils";
import type { DashScopeChatOptions } from "./types";

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
  prompt: LanguageModelV3CallOptions["prompt"],
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        messages.push({ role: "system", content: content as string });
        break;
      }

      case "user": {
        const parts: Array<Record<string, unknown>> = [];
        for (const part of content) {
          switch (part.type) {
            case "text":
              parts.push({ type: "text", text: part.text });
              break;
            case "file": {
              if (part.mediaType.startsWith("image/")) {
                const url =
                  part.data instanceof URL
                    ? part.data.toString()
                    : `data:${part.mediaType === "image/*" ? "image/jpeg" : part.mediaType};base64,${convertToBase64(part.data as Uint8Array)}`;
                parts.push({ type: "image_url", image_url: { url } });
              }
              break;
            }
          }
        }

        if (parts.length === 1 && parts[0].type === "text") {
          messages.push({ role: "user", content: parts[0].text });
        } else {
          messages.push({ role: "user", content: parts });
        }
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

export class DashScopeChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly modelId: string;
  private readonly config: DashScopeConfig;

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

  private async getArgs(options: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

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

    const args: Record<string, unknown> = {
      model: this.modelId,
      messages: convertMessages(options.prompt),
      ...(options.maxOutputTokens != null && { max_tokens: options.maxOutputTokens }),
      ...(options.temperature != null && { temperature: options.temperature }),
      ...(options.topP != null && { top_p: options.topP }),
      ...(options.topK != null && { top_k: options.topK }),
      ...(options.presencePenalty != null && { presence_penalty: options.presencePenalty }),
      ...(options.stopSequences?.length && { stop: options.stopSequences }),
      ...(options.seed != null && { seed: options.seed }),
      ...(options.responseFormat?.type === "json" && {
        response_format: { type: "json_object" },
      }),
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

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
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
    const content: Array<LanguageModelV3Content> = [];

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

    const finishReason: LanguageModelV3FinishReason = {
      unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
      raw: choice.finish_reason ?? undefined,
    };

    return {
      content,
      finishReason,
      usage: convertOpenAICompatibleChatUsage(response.usage),
      request: { body: JSON.stringify(args) },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
      },
      warnings,
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
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

    let finishReason: LanguageModelV3FinishReason = { unified: "other", raw: undefined };
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
          LanguageModelV3StreamPart
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
      request: { body: JSON.stringify(body) },
      response: { headers: responseHeaders },
    };
  }
}
