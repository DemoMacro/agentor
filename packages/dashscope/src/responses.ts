import type {
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FilePart,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
import type { DashScopeResponsesOptions } from "./types";

// --- Config ---

export interface DashScopeResponsesConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
}

// --- Schemas ---

const responsesOptionsSchema = zodSchema(
  z.object({
    enableThinking: z.boolean().optional(),
    reasoning: z
      .object({
        effort: z.enum(["none", "minimal", "low", "medium", "high"]),
      })
      .optional(),
    previousResponseId: z.string().optional(),
    conversation: z.string().optional(),
    instructions: z.string().optional(),
    includeUsage: z.boolean().optional(),
  }),
);

const errorSchema = zodSchema(
  z.object({
    error: z.object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().optional(),
    }),
  }),
);

const responseSchema = zodSchema(
  z
    .object({
      id: z.string(),
      created_at: z.number().optional(),
      object: z.literal("response"),
      model: z.string().optional(),
      status: z.string().optional(),
      output: z.array(z.record(z.string(), z.unknown())).optional(),
      usage: z
        .object({
          input_tokens: z.number(),
          output_tokens: z.number(),
          total_tokens: z.number(),
          input_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
          output_tokens_details: z.object({ reasoning_tokens: z.number() }).optional(),
        })
        .optional(),
      error: z.object({ message: z.string() }).nullable().optional(),
    })
    .loose(),
);

const streamChunkSchema = zodSchema(z.object({ type: z.string() }).loose());

const failedResponseHandler = createJsonErrorResponseHandler({
  errorSchema,
  errorToMessage: (data) => data.error.message,
});

// --- Helpers ---

function convertUsage(usage?: Record<string, unknown>): LanguageModelV3Usage {
  if (!usage) {
    return {
      inputTokens: {
        total: 0,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 0,
        text: undefined,
        reasoning: undefined,
      },
    };
  }

  const details = usage.output_tokens_details as Record<string, number> | undefined;
  const inputDetails = usage.input_tokens_details as Record<string, number> | undefined;

  return {
    inputTokens: {
      total: (usage.input_tokens as number) ?? 0,
      noCache: undefined,
      cacheRead: inputDetails?.cached_tokens ?? undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: (usage.output_tokens as number) ?? 0,
      text: undefined,
      reasoning: details?.reasoning_tokens ?? undefined,
    },
    raw: usage as JSONObject,
  };
}

function mapFinishReason(status?: string): LanguageModelV3FinishReason {
  switch (status) {
    case "completed":
      return { unified: "stop", raw: status };
    case "incomplete":
      return { unified: "length", raw: status };
    case "failed":
    case "cancelled":
      return { unified: "error", raw: status };
    default:
      return { unified: "other", raw: status };
  }
}

function mapToolChoice(toolChoice: LanguageModelV3ToolChoice): string | Record<string, unknown> {
  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "tool":
      return {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: toolChoice.toolName }],
      };
  }
}

function convertOutput(output: Array<Record<string, unknown>>): Array<LanguageModelV3Content> {
  const content: Array<LanguageModelV3Content> = [];

  for (const item of output) {
    const type = item.type as string;

    switch (type) {
      // Model text response
      case "message": {
        const parts = item.content as Array<Record<string, unknown>> | undefined;
        if (parts) {
          for (const part of parts) {
            if (part.type === "output_text" && typeof part.text === "string") {
              content.push({ type: "text", text: part.text });
            }
          }
        }
        break;
      }

      // Reasoning / thinking
      case "reasoning": {
        const summary = item.summary as Array<Record<string, string>> | undefined;
        if (summary) {
          for (const s of summary) {
            if (s.text) {
              content.push({ type: "reasoning", text: s.text });
            }
          }
        }
        break;
      }

      // Custom function call
      case "function_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.call_id as string) ?? "",
          toolName: (item.name as string) ?? "",
          input: item.arguments as string,
          providerExecuted: false,
        });
        break;
      }

      // Provider-executed tools
      case "web_search_call": {
        const action = item.action as Record<string, unknown> | undefined;
        const sources = action?.sources as Array<Record<string, string>> | undefined;

        if (sources) {
          for (const source of sources) {
            if (source.url) {
              content.push({
                type: "source",
                sourceType: "url",
                id: (item.id as string) ?? "",
                url: source.url,
                title: source.title,
              });
            }
          }
        }

        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "web_search",
          input: JSON.stringify({
            query: action?.query,
            sources,
          }),
          providerExecuted: true,
        });
        break;
      }

      case "code_interpreter_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "code_interpreter",
          input: JSON.stringify({
            code: item.code,
            outputs: item.outputs,
            containerId: item.container_id,
          }),
          providerExecuted: true,
        });
        break;
      }

      case "web_extractor_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "web_extractor",
          input: JSON.stringify({
            urls: item.urls,
            goal: item.goal,
          }),
          providerExecuted: true,
        });
        if (item.output) {
          content.push({
            type: "tool-result",
            toolCallId: (item.id as string) ?? "",
            toolName: "web_extractor",
            result: item.output as string,
          });
        }
        break;
      }

      case "file_search_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "file_search",
          input: JSON.stringify({
            queries: item.queries,
            results: item.results,
          }),
          providerExecuted: true,
        });
        break;
      }

      case "web_search_image_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "web_search_image",
          input: JSON.stringify({
            name: item.name,
            arguments: item.arguments,
          }),
          providerExecuted: true,
        });
        if (item.output) {
          content.push({
            type: "tool-result",
            toolCallId: (item.id as string) ?? "",
            toolName: "web_search_image",
            result: item.output as string,
          });
        }
        break;
      }

      case "image_search_call": {
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName: "image_search",
          input: JSON.stringify({
            name: item.name,
            arguments: item.arguments,
          }),
          providerExecuted: true,
        });
        if (item.output) {
          content.push({
            type: "tool-result",
            toolCallId: (item.id as string) ?? "",
            toolName: "image_search",
            result: item.output as string,
          });
        }
        break;
      }

      case "mcp_call": {
        const toolName = (item.name as string) ?? (item.server_label as string) ?? "mcp";
        content.push({
          type: "tool-call",
          toolCallId: (item.id as string) ?? "",
          toolName,
          input: (item.arguments as string) ?? "{}",
          providerExecuted: true,
        });
        if (item.output) {
          content.push({
            type: "tool-result",
            toolCallId: (item.id as string) ?? "",
            toolName,
            result: item.output as string,
          });
        }
        break;
      }
    }
  }

  return content;
}

// --- Tool processing ---

function prepareTools(tools: LanguageModelV3CallOptions["tools"]): Array<Record<string, unknown>> {
  if (!tools?.length) return [];

  const apiTools: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "provider") {
      switch (tool.id) {
        case "dashscope.web_search":
          apiTools.push({ type: "web_search" });
          break;
        case "dashscope.code_interpreter":
          apiTools.push({ type: "code_interpreter" });
          break;
        case "dashscope.web_extractor":
          apiTools.push({ type: "web_extractor" });
          break;
        case "dashscope.file_search": {
          const args = tool.args as { vectorStoreIds: string[] };
          apiTools.push({
            type: "file_search",
            vector_store_ids: args.vectorStoreIds,
          });
          break;
        }
        case "dashscope.web_search_image":
          apiTools.push({ type: "web_search_image" });
          break;
        case "dashscope.image_search":
          apiTools.push({ type: "image_search" });
          break;
        case "dashscope.mcp": {
          const args = tool.args as {
            serverProtocol: string;
            serverLabel: string;
            serverUrl: string;
            serverDescription?: string;
            headers?: Record<string, string>;
          };
          apiTools.push({
            type: "mcp",
            server_protocol: args.serverProtocol,
            server_label: args.serverLabel,
            server_url: args.serverUrl,
            ...(args.serverDescription && {
              server_description: args.serverDescription,
            }),
            ...(args.headers && { headers: args.headers }),
          });
          break;
        }
      }
    } else {
      apiTools.push({
        type: "function",
        name: tool.name,
        ...(tool.description && { description: tool.description }),
        parameters: tool.inputSchema,
      });
    }
  }

  return apiTools;
}

// --- Input conversion ---

function convertFilePart(part: LanguageModelV3FilePart): Record<string, unknown> | undefined {
  const data = part.data;
  if (data instanceof URL) {
    return { type: "input_image", image_url: data.toString() };
  }
  if (typeof data === "string") {
    if (data.startsWith("data:")) {
      return { type: "input_image", image_url: data };
    }
    return { type: "input_image", image_url: `data:${part.mediaType};base64,${data}` };
  }
  return undefined;
}

function convertToolResultOutput(output: LanguageModelV3ToolResultPart["output"]): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "type" in output && output.type === "text") {
    return (output as { type: "text"; value: string }).value;
  }
  return JSON.stringify(output);
}

function convertInput(prompt: Array<LanguageModelV3Message>): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const message of prompt) {
    const { role, content } = message;

    // system: content is always a string
    if (typeof content === "string") {
      input.push({ role, content });
      continue;
    }

    // user / assistant / tool: content is an array of parts
    const textParts: string[] = [];
    const fileParts: Array<Record<string, unknown>> = [];
    const functionCalls: Array<Record<string, unknown>> = [];
    const functionOutputs: Array<Record<string, unknown>> = [];

    for (const part of content) {
      switch (part.type) {
        case "text":
          textParts.push((part as LanguageModelV3TextPart).text);
          break;

        case "file": {
          const filePart = convertFilePart(part as LanguageModelV3FilePart);
          if (filePart) fileParts.push(filePart);
          break;
        }

        case "reasoning":
          // reasoning parts are not sent to DashScope
          break;

        case "tool-call": {
          const callPart = part as LanguageModelV3ToolCallPart;
          functionCalls.push({
            type: "function_call",
            name: callPart.toolName,
            arguments:
              typeof callPart.input === "string" ? callPart.input : JSON.stringify(callPart.input),
            call_id: callPart.toolCallId,
          });
          break;
        }

        case "tool-result": {
          const resultPart = part as LanguageModelV3ToolResultPart;
          functionOutputs.push({
            type: "function_call_output",
            call_id: resultPart.toolCallId,
            output: convertToolResultOutput(resultPart.output),
          });
          break;
        }
      }
    }

    const messageParts = [
      ...textParts.map((t) => ({ type: "text" as const, text: t })),
      ...fileParts,
    ];

    if (messageParts.length > 0) {
      if (messageParts.length === 1 && textParts.length === 1) {
        input.push({ role, content: textParts[0] });
      } else {
        input.push({ role, content: messageParts });
      }
    }

    input.push(...functionCalls, ...functionOutputs);
  }

  return input;
}

// --- Model ---

export class DashScopeResponsesLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly modelId: string;
  private readonly config: DashScopeResponsesConfig;

  constructor(modelId: string, config: DashScopeResponsesConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {};
  }

  private async getArgs(options: LanguageModelV3CallOptions) {
    const warnings: Array<{ type: "unsupported"; feature: string }> = [];

    if (options.topK != null) {
      warnings.push({ type: "unsupported", feature: "topK" });
    }

    const dsOptions = await parseProviderOptions<DashScopeResponsesOptions>({
      provider: "dashscope",
      providerOptions: options.providerOptions,
      schema: responsesOptionsSchema,
    });

    const tools = prepareTools(options.tools);
    const input = convertInput(options.prompt);

    const body: Record<string, unknown> = {
      model: this.modelId,
      input,
      ...(options.temperature != null && { temperature: options.temperature }),
      ...(options.topP != null && { top_p: options.topP }),
      ...(options.maxOutputTokens != null && {
        max_output_tokens: options.maxOutputTokens,
      }),
      ...(options.stopSequences?.length && { stop: options.stopSequences }),
      ...(tools.length > 0 && { tools }),
      ...(options.toolChoice && {
        tool_choice: mapToolChoice(options.toolChoice),
      }),
      ...(dsOptions?.enableThinking != null && {
        enable_thinking: dsOptions.enableThinking,
      }),
      ...(dsOptions?.reasoning != null && { reasoning: dsOptions.reasoning }),
      ...(dsOptions?.previousResponseId && {
        previous_response_id: dsOptions.previousResponseId,
      }),
      ...(dsOptions?.conversation && { conversation: dsOptions.conversation }),
      ...(dsOptions?.instructions && { instructions: dsOptions.instructions }),
    };

    return { args: body, warnings };
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { args: body, warnings } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/responses`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(responseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    if (response.error) {
      throw new Error(`DashScope Responses API error: ${response.error.message}`);
    }

    const content = convertOutput(response.output ?? []);
    const hasToolCall = content.some(
      (c) => c.type === "tool-call" && "providerExecuted" in c && !c.providerExecuted,
    );

    let finishReason = mapFinishReason(response.status);
    if (hasToolCall && finishReason.unified === "stop") {
      finishReason = { unified: "tool-calls", raw: response.status };
    }

    return {
      content,
      finishReason,
      usage: convertUsage(response.usage as Record<string, unknown> | undefined),
      request: { body },
      response: {
        id: response.id ?? undefined,
        headers: responseHeaders,
      },
      warnings,
      providerMetadata: response.id
        ? {
            dashscope: {
              responseId: response.id,
              ...(response.model && { model: response.model }),
              ...(response.created_at && {
                createdAt: response.created_at,
              }),
            },
          }
        : undefined,
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { args: body, warnings } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/responses`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: { ...body, stream: true },
      failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(streamChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV3FinishReason | undefined;
    let usage: LanguageModelV3Usage | undefined;

    return {
      stream: response.pipeThrough(
        new TransformStream<
          {
            success: boolean;
            value?: Record<string, unknown>;
            error?: unknown;
          },
          LanguageModelV3StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings });
          },

          transform(chunk, controller) {
            if (!chunk.success) {
              finishReason = { unified: "error", raw: undefined };
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }

            const val = chunk.value!;
            const eventType = val.type as string;

            switch (eventType) {
              case "response.output_text.delta":
                controller.enqueue({
                  type: "text-delta",
                  id: String((val.output_index as number) ?? 0),
                  delta: (val.delta as string) ?? "",
                });
                break;

              case "response.reasoning_summary_text.delta":
                controller.enqueue({
                  type: "reasoning-delta",
                  id: String((val.output_index as number) ?? 0),
                  delta: (val.delta as string) ?? "",
                });
                break;

              case "response.output_item.added": {
                const item = val.item as Record<string, unknown> | undefined;
                if (item?.type === "function_call") {
                  controller.enqueue({
                    type: "tool-input-start",
                    id: (item.id as string) ?? "",
                    toolName: (item.name as string) ?? "",
                  });
                }
                break;
              }

              case "response.mcp_call_arguments.delta":
                controller.enqueue({
                  type: "tool-input-delta",
                  id: (val.item_id as string) ?? "",
                  delta: (val.delta as string) ?? "",
                });
                break;

              case "response.completed": {
                const resp = val.response as Record<string, unknown> | undefined;
                finishReason = mapFinishReason(resp?.status as string | undefined);
                if (resp?.usage) {
                  usage = convertUsage(resp.usage as Record<string, unknown>);
                }
                if (resp?.id) {
                  controller.enqueue({
                    type: "response-metadata",
                    id: resp.id as string,
                    modelId: resp.model as string | undefined,
                    timestamp: resp.created_at
                      ? new Date((resp.created_at as number) * 1000)
                      : undefined,
                  });
                }
                break;
              }
            }
          },

          flush(controller) {
            if (finishReason || usage) {
              controller.enqueue({
                type: "finish",
                usage: usage ?? {
                  inputTokens: {
                    total: 0,
                    noCache: undefined,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: {
                    total: 0,
                    text: undefined,
                    reasoning: undefined,
                  },
                },
                finishReason: finishReason ?? { unified: "stop", raw: undefined },
              });
            }
          },
        }),
      ),
      response: { headers: responseHeaders },
    };
  }
}
