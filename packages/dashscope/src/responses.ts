import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Source,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResult,
  LanguageModelV4ToolResultPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

import type { DashScopeResponsesOptions } from "./types";
import {
  buildJsonInstruction,
  convertResponsesUsage,
  failedResponseHandler,
  fileDataToImageUrl,
  type DashScopeConfig,
  type ResponsesUsage,
} from "./utils";

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

// --- Helpers ---

function mapFinishReason(status?: string): LanguageModelV4FinishReason {
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

function mapToolChoice(toolChoice: LanguageModelV4ToolChoice): string | Record<string, unknown> {
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

// Parts emitted for a DashScope tool output item. Shared subset of
// LanguageModelV4Content (doGenerate) and LanguageModelV4StreamPart (doStream).
type ToolOutputPart = LanguageModelV4ToolCall | LanguageModelV4Source | LanguageModelV4ToolResult;

/**
 * Convert a DashScope Responses output item (provider-executed built-in tool,
 * MCP call, or function call) into ai-sdk parts. Shared by doGenerate's
 * convertOutput and doStream's output_item.done so both paths surface identical
 * tool-call / source / tool-result parts.
 */
function convertToolItemToParts(item: Record<string, unknown>): ToolOutputPart[] {
  const parts: ToolOutputPart[] = [];
  const id = (item.id as string) ?? "";

  switch (item.type as string) {
    case "function_call":
      parts.push({
        type: "tool-call",
        toolCallId: (item.call_id as string) ?? id,
        toolName: (item.name as string) ?? "",
        input: (item.arguments as string) ?? "",
        providerExecuted: false,
      });
      break;

    case "web_search_call": {
      const action = item.action as Record<string, unknown> | undefined;
      const sources = action?.sources as Array<Record<string, string>> | undefined;
      if (sources) {
        for (const source of sources) {
          if (source.url) {
            parts.push({
              type: "source",
              sourceType: "url",
              id,
              url: source.url,
              title: source.title,
            });
          }
        }
      }
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "web_search",
        input: JSON.stringify({ query: action?.query, sources }),
        providerExecuted: true,
      });
      break;
    }

    case "code_interpreter_call":
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "code_interpreter",
        input: JSON.stringify({
          code: item.code,
          outputs: item.outputs,
          containerId: item.container_id,
        }),
        providerExecuted: true,
      });
      break;

    case "web_extractor_call":
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "web_extractor",
        input: JSON.stringify({ urls: item.urls, goal: item.goal }),
        providerExecuted: true,
      });
      if (item.output != null) {
        parts.push({
          type: "tool-result",
          toolCallId: id,
          toolName: "web_extractor",
          result: item.output as string,
        });
      }
      break;

    case "file_search_call":
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "file_search",
        input: JSON.stringify({ queries: item.queries, results: item.results }),
        providerExecuted: true,
      });
      break;

    case "web_search_image_call":
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "web_search_image",
        input: JSON.stringify({ name: item.name, arguments: item.arguments }),
        providerExecuted: true,
      });
      if (item.output != null) {
        parts.push({
          type: "tool-result",
          toolCallId: id,
          toolName: "web_search_image",
          result: item.output as string,
        });
      }
      break;

    case "image_search_call":
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: "image_search",
        input: JSON.stringify({ name: item.name, arguments: item.arguments }),
        providerExecuted: true,
      });
      if (item.output != null) {
        parts.push({
          type: "tool-result",
          toolCallId: id,
          toolName: "image_search",
          result: item.output as string,
        });
      }
      break;

    case "mcp_call": {
      const toolName = (item.name as string) ?? (item.server_label as string) ?? "mcp";
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName,
        input: (item.arguments as string) ?? "{}",
        providerExecuted: true,
      });
      if (item.output != null) {
        parts.push({
          type: "tool-result",
          toolCallId: id,
          toolName,
          result: item.output as string,
        });
      }
      break;
    }
  }

  return parts;
}

function convertOutput(output: Array<Record<string, unknown>>): Array<LanguageModelV4Content> {
  const content: Array<LanguageModelV4Content> = [];

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

      default:
        content.push(...convertToolItemToParts(item));
        break;
    }
  }

  return content;
}

// --- Tool processing ---

function prepareTools(tools: LanguageModelV4CallOptions["tools"]): Array<Record<string, unknown>> {
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

function convertFilePart(part: LanguageModelV4FilePart): Record<string, unknown> | undefined {
  const url = fileDataToImageUrl(part.data, part.mediaType);
  return url ? { type: "input_image", image_url: url } : undefined;
}

function convertToolResultOutput(output: LanguageModelV4ToolResultPart["output"]): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "type" in output && output.type === "text") {
    return (output as { type: "text"; value: string }).value;
  }
  return JSON.stringify(output);
}

function extractCacheControl(
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const ds = providerOptions?.dashscope as { cacheControl?: { type: string } } | undefined;
  if (ds?.cacheControl) {
    return { cache_control: { type: ds.cacheControl.type } };
  }
  return undefined;
}

function convertInput(prompt: Array<LanguageModelV4Message>): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const message of prompt) {
    const { role, content } = message;

    // system: content is always a string. The Responses endpoint is an
    // OpenAI-compatible layer that caches via the x-dashscope-session-cache
    // request header (server-side session cache), not via cache_control on
    // input content blocks (no DashScope documentation supports block-level
    // cache_control here). cache_control is therefore intentionally NOT
    // attached to input blocks; getArgs maps any cacheControl marker to that
    // header instead.
    if (typeof content === "string") {
      input.push({ role, content });
      continue;
    }

    // user / assistant / tool: content is an array of parts
    const textParts: Array<{ text: string }> = [];
    const fileParts: Array<Record<string, unknown>> = [];
    const functionCalls: Array<Record<string, unknown>> = [];
    const functionOutputs: Array<Record<string, unknown>> = [];

    for (const part of content) {
      switch (part.type) {
        case "text": {
          textParts.push({ text: part.text });
          break;
        }

        case "file": {
          const filePart = convertFilePart(part as LanguageModelV4FilePart);
          if (filePart) fileParts.push(filePart);
          break;
        }

        case "reasoning":
          // reasoning parts are not sent to DashScope
          break;

        case "tool-call": {
          const callPart = part as LanguageModelV4ToolCallPart;
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
          const resultPart = part as LanguageModelV4ToolResultPart;
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
      ...textParts.map((t) => ({ type: "input_text" as const, text: t.text })),
      ...fileParts,
    ];

    if (messageParts.length > 0) {
      if (messageParts.length === 1 && textParts.length === 1) {
        input.push({ role, content: textParts[0].text });
      } else {
        input.push({ role, content: messageParts });
      }
    }

    input.push(...functionCalls, ...functionOutputs);
  }

  return input;
}

// --- Model ---

export class DashScopeResponsesLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
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
    return {};
  }

  private async getArgs(options: LanguageModelV4CallOptions) {
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

    // Output.object reaches us via responseFormat; the Responses endpoint has
    // no native structured output, so inject the schema into instructions (see
    // buildJsonInstruction).
    let instructions = dsOptions?.instructions;
    if (options.responseFormat?.type === "json") {
      const jsonInstruction = buildJsonInstruction(options.responseFormat);
      instructions = instructions ? `${instructions}\n\n${jsonInstruction}` : jsonInstruction;
    }

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
      ...(instructions && { instructions }),
    };

    // The Responses endpoint caches via the x-dashscope-session-cache header
    // (server-side session cache), not via cache_control on input content
    // blocks. Map any cacheControl marker on the prompt to that header.
    // Session cache is a whole-request flag, so a marker on ANY message or
    // part — including tool-result / reasoning parts that convertInput drops
    // — enables it: the marker expresses "cache this turn" intent. The marker
    // type is intentionally unchecked, mirroring the anthropic provider's
    // permissive cacheControl handling (ephemeral / 1h).
    const sessionCache = options.prompt.some((message) => {
      if (extractCacheControl(message.providerOptions)) return true;
      if (Array.isArray(message.content)) {
        return message.content.some((part) => extractCacheControl(part.providerOptions));
      }
      return false;
    });

    return {
      args: body,
      warnings,
      headers: sessionCache ? { "x-dashscope-session-cache": "enable" } : undefined,
    };
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const { args: body, warnings, headers: sessionHeaders } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/compatible-mode/v1/responses`,
      headers: combineHeaders(this.config.headers(), sessionHeaders, options.headers),
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
      usage: convertResponsesUsage(response.usage as ResponsesUsage | undefined),
      request: { body },
      response: {
        id: response.id ?? undefined,
        timestamp: response.created_at ? new Date(response.created_at * 1000) : new Date(),
        modelId: response.model ?? undefined,
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

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const { args: body, warnings, headers: sessionHeaders } = await this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/compatible-mode/v1/responses`,
      headers: combineHeaders(this.config.headers(), sessionHeaders, options.headers),
      body: { ...body, stream: true },
      failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(streamChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV4FinishReason | undefined;
    let usage: LanguageModelV4Usage | undefined;
    let hasToolCall = false;

    // DashScope streams each output item as added → (deltas) → done. ai-sdk
    // consumers (e.g. toUIMessageStreamResponse) require every text/reasoning
    // delta to be preceded by its matching start event, so we track the active
    // part ids and emit start/end pairs around the deltas.
    let activeTextId: string | undefined;
    let activeReasoningId: string | undefined;

    // Tool-call arguments may arrive incrementally (function_call_arguments /
    // mcp_call_arguments delta events) or whole (inside output_item.done), so
    // accumulate them per item and finalize on whichever comes last.
    const toolCalls = new Map<
      string,
      {
        id: string;
        toolName: string;
        arguments: string;
        finished: boolean;
        providerExecuted: boolean;
      }
    >();

    function finalizeToolCall(
      tc: {
        id: string;
        toolName: string;
        arguments: string;
        finished: boolean;
        providerExecuted: boolean;
      },
      input: string,
      controller: { enqueue: (part: LanguageModelV4StreamPart) => void },
    ) {
      if (tc.finished) return;
      tc.finished = true;
      controller.enqueue({ type: "tool-input-end", id: tc.id });
      controller.enqueue({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.toolName,
        input,
        providerExecuted: tc.providerExecuted,
      });
      if (!tc.providerExecuted) {
        hasToolCall = true;
      }
    }

    return {
      stream: response.pipeThrough(
        new TransformStream<
          {
            success: boolean;
            value?: Record<string, unknown>;
            error?: unknown;
          },
          LanguageModelV4StreamPart
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
              case "response.output_item.added": {
                const item = (val.item as Record<string, unknown> | undefined) ?? {};
                const id = (item.id as string) ?? "";
                switch (item.type as string) {
                  case "reasoning":
                    // Open the reasoning part before any reasoning delta arrives.
                    activeReasoningId = id;
                    controller.enqueue({ type: "reasoning-start", id });
                    break;
                  case "function_call":
                    toolCalls.set(id, {
                      id,
                      toolName: (item.name as string) ?? "",
                      arguments: "",
                      finished: false,
                      providerExecuted: false,
                    });
                    controller.enqueue({
                      type: "tool-input-start",
                      id,
                      toolName: (item.name as string) ?? "",
                    });
                    break;
                  case "mcp_call": {
                    const toolName =
                      (item.name as string) ?? (item.server_label as string) ?? "mcp";
                    toolCalls.set(id, {
                      id,
                      toolName,
                      arguments: "",
                      finished: false,
                      providerExecuted: true,
                    });
                    controller.enqueue({ type: "tool-input-start", id, toolName });
                    break;
                  }
                }
                break;
              }

              case "response.output_text.delta": {
                const id = (val.item_id as string) ?? String((val.output_index as number) ?? 0);
                if (activeTextId == null) {
                  activeTextId = id;
                  controller.enqueue({ type: "text-start", id });
                }
                controller.enqueue({
                  type: "text-delta",
                  id,
                  delta: (val.delta as string) ?? "",
                });
                break;
              }

              case "response.reasoning_summary_text.delta": {
                // Normally reasoning-start was emitted via response.output_item.added;
                // guard against streams that open with a delta directly.
                if (activeReasoningId == null) {
                  activeReasoningId =
                    (val.item_id as string) ?? String((val.output_index as number) ?? 0);
                  controller.enqueue({ type: "reasoning-start", id: activeReasoningId });
                }
                controller.enqueue({
                  type: "reasoning-delta",
                  id: activeReasoningId,
                  delta: (val.delta as string) ?? "",
                });
                break;
              }

              case "response.function_call_arguments.delta":
              case "response.mcp_call_arguments.delta": {
                const id = (val.item_id as string) ?? "";
                const tc = toolCalls.get(id);
                const delta = (val.delta as string) ?? "";
                if (tc && !tc.finished) {
                  tc.arguments += delta;
                  controller.enqueue({ type: "tool-input-delta", id, delta });
                }
                break;
              }

              case "response.function_call_arguments.done":
              case "response.mcp_call_arguments.done": {
                const id = (val.item_id as string) ?? "";
                const tc = toolCalls.get(id);
                if (tc) {
                  finalizeToolCall(tc, (val.arguments as string) ?? tc.arguments, controller);
                }
                break;
              }

              case "response.output_item.done": {
                const item = (val.item as Record<string, unknown> | undefined) ?? {};
                const id = (item.id as string) ?? "";
                switch (item.type as string) {
                  case "message":
                    if (activeTextId != null) {
                      controller.enqueue({ type: "text-end", id: activeTextId });
                      activeTextId = undefined;
                    }
                    break;
                  case "reasoning":
                    if (activeReasoningId != null) {
                      controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
                      activeReasoningId = undefined;
                    }
                    break;
                  case "function_call": {
                    const tc = toolCalls.get(id);
                    if (tc) {
                      finalizeToolCall(tc, (item.arguments as string) ?? tc.arguments, controller);
                    }
                    break;
                  }
                  case "mcp_call": {
                    const tc = toolCalls.get(id);
                    if (tc) {
                      finalizeToolCall(tc, (item.arguments as string) ?? tc.arguments, controller);
                    }
                    if (item.output != null) {
                      controller.enqueue({
                        type: "tool-result",
                        toolCallId: id,
                        toolName: tc?.toolName ?? "mcp",
                        result: item.output as string,
                      });
                    }
                    break;
                  }
                  default:
                    // Provider-executed built-in tools (web_search_call,
                    // code_interpreter_call, ...) arrive whole in output_item.done;
                    // reuse the same mapping as doGenerate.
                    for (const part of convertToolItemToParts(item)) {
                      controller.enqueue(part);
                    }
                    break;
                }
                break;
              }

              case "response.completed": {
                const resp = (val.response as Record<string, unknown> | undefined) ?? {};
                finishReason = mapFinishReason(resp.status as string | undefined);
                if (resp.usage) {
                  usage = convertResponsesUsage(resp.usage as ResponsesUsage);
                }
                if (resp.id) {
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
            // Close any parts that never received their done event.
            if (activeReasoningId != null) {
              controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
            }
            if (activeTextId != null) {
              controller.enqueue({ type: "text-end", id: activeTextId });
            }

            // Finalize any tool calls that never received their done event.
            for (const tc of toolCalls.values()) {
              if (!tc.finished) {
                finalizeToolCall(tc, tc.arguments, controller);
              }
            }

            // A completed status with an emitted tool call should be reported as
            // tool-calls, mirroring doGenerate.
            let resolved =
              finishReason ??
              ({
                unified: "stop",
                raw: undefined,
              } as LanguageModelV4FinishReason);
            if (hasToolCall && resolved.unified === "stop") {
              resolved = { unified: "tool-calls", raw: resolved.raw };
            }

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
              finishReason: resolved,
            });
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }
}
