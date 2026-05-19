import type {
  ImageBlockParam,
  MessageCreateParamsBase,
  Tool,
  ToolChoice,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import { generateText, streamText } from "ai";
import type { LanguageModelUsage, ModelMessage } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";

import type { ServerContext } from "../../types";
import { generateId, sseEvent } from "../../utils";

type RequestBody = MessageCreateParamsBase & Record<string, unknown>;

// --- Conversion ---

export function convertMessages(body: RequestBody): {
  messages: ModelMessage[];
  system: string | undefined;
} {
  const messages: ModelMessage[] = [];
  const pendingToolResults: Array<{
    toolCallId: string;
    toolName: string;
    output: string;
  }> = [];

  for (const msg of body.messages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      const parts: Array<{ type: "text"; text: string } | { type: "image"; image: URL | string }> =
        [];
      let hasToolResults = false;

      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          const img = block as ImageBlockParam;
          if (img.source.type === "base64") {
            parts.push({
              type: "image",
              image: `data:${img.source.media_type};base64,${img.source.data}`,
            });
          } else {
            parts.push({ type: "image", image: new URL(img.source.url) });
          }
        } else if (block.type === "tool_result") {
          const tr = block as ToolResultBlockParam;
          hasToolResults = true;
          const output =
            typeof tr.content === "string"
              ? tr.content
              : (tr.content
                  ?.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                  .map((b) => b.text)
                  .join("\n") ?? "");
          pendingToolResults.push({
            toolCallId: tr.tool_use_id,
            toolName: "",
            output,
          });
        }
      }

      if (hasToolResults) {
        for (const tr of pendingToolResults) {
          messages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: tr.toolCallId,
                toolName: tr.toolName,
                output: { type: "text" as const, value: tr.output },
              },
            ],
          });
        }
        pendingToolResults.length = 0;
      } else if (parts.length > 0) {
        messages.push({ role: "user", content: parts });
      }
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolParts: Array<{
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }> = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          const tu = block as ToolUseBlockParam;
          toolParts.push({
            type: "tool-call",
            toolCallId: tu.id,
            toolName: tu.name,
            input: tu.input,
          });
        }
      }

      if (toolParts.length > 0) {
        const content: Array<{ type: "text"; text: string } | (typeof toolParts)[number]> = [];
        if (textParts.length > 0) content.push({ type: "text", text: textParts.join("\n") });
        content.push(...toolParts);
        messages.push({ role: "assistant", content });
      } else {
        messages.push({ role: "assistant", content: textParts.join("\n") });
      }
    }
  }

  const system = typeof body.system === "string" ? body.system : undefined;
  return { messages, system };
}

export function convertParams(body: RequestBody): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (body.temperature != null) params.temperature = body.temperature;
  if (body.top_p != null) params.topP = body.top_p;
  if (body.max_tokens != null) params.maxOutputTokens = body.max_tokens;
  if (body.stop_sequences) params.stopSequences = body.stop_sequences;
  if (body.tools?.length) {
    const tools: Record<string, unknown> = {};
    for (const t of body.tools) {
      if ("input_schema" in t) {
        const tool = t as Tool;
        tools[tool.name] = { description: tool.description, parameters: tool.input_schema };
      }
    }
    params.tools = tools;
  }
  if (body.tool_choice != null) {
    const tc = body.tool_choice as ToolChoice;
    if (tc.type === "auto") {
      params.toolChoice = "auto";
    } else if (tc.type === "any") {
      params.toolChoice = "required";
    } else if (tc.type === "none") {
      params.toolChoice = "none";
    } else if (tc.type === "tool") {
      params.toolChoice = { type: "tool", toolName: tc.name };
    }
  }
  return params;
}

export function convertUsage(usage?: LanguageModelUsage): Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    cache_read_input_tokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    inference_geo: null,
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    server_tool_use: null,
    service_tier: null,
  };
}

export function mapStopReason(
  reason: string | undefined | null,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool-calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

// --- Route ---

export function registerMessages(app: H3, context: ServerContext) {
  app.post(
    "/messages",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as RequestBody;
      if (!body.model || !body.messages) {
        throw new HTTPError({
          status: 400,
          message: "Missing required fields: model, messages",
          data: { errorType: "invalid_request_error", format: "anthropic" },
        });
      }

      const model = context.registry.languageModel(body.model as never);
      const { messages, system } = convertMessages(body);
      const params = convertParams(body);
      const providerOptions = body.providerOptions as Parameters<
        typeof generateText
      >[0]["providerOptions"];

      if (body.stream) {
        const id = generateId("msg");
        const result = streamText({ model, system, messages, ...params, providerOptions });
        const encoder = new TextEncoder();
        let contentIndex = 0;

        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: string) => controller.enqueue(encoder.encode(data));

            send(
              sseEvent(
                "message_start",
                JSON.stringify({
                  type: "message_start",
                  message: {
                    id,
                    type: "message",
                    role: "assistant",
                    content: [],
                    model: body.model,
                    stop_reason: null,
                    usage: convertUsage(),
                  },
                }),
              ),
            );

            send(
              sseEvent(
                "content_block_start",
                JSON.stringify({
                  type: "content_block_start",
                  index: contentIndex,
                  content_block: { type: "text", text: "" },
                }),
              ),
            );

            try {
              for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                  send(
                    sseEvent(
                      "content_block_delta",
                      JSON.stringify({
                        type: "content_block_delta",
                        index: contentIndex,
                        delta: { type: "text_delta", text: part.text },
                      }),
                    ),
                  );
                } else if (part.type === "tool-call") {
                  send(
                    sseEvent(
                      "content_block_stop",
                      JSON.stringify({
                        type: "content_block_stop",
                        index: contentIndex,
                      }),
                    ),
                  );
                  contentIndex++;

                  send(
                    sseEvent(
                      "content_block_start",
                      JSON.stringify({
                        type: "content_block_start",
                        index: contentIndex,
                        content_block: {
                          type: "tool_use",
                          id: part.toolCallId,
                          name: part.toolName,
                        },
                      }),
                    ),
                  );

                  send(
                    sseEvent(
                      "content_block_delta",
                      JSON.stringify({
                        type: "content_block_delta",
                        index: contentIndex,
                        delta: {
                          type: "input_json_delta",
                          partial_json:
                            typeof part.input === "string"
                              ? part.input
                              : JSON.stringify(part.input),
                        },
                      }),
                    ),
                  );

                  send(
                    sseEvent(
                      "content_block_stop",
                      JSON.stringify({
                        type: "content_block_stop",
                        index: contentIndex,
                      }),
                    ),
                  );
                  contentIndex++;
                } else if (part.type === "finish") {
                  send(
                    sseEvent(
                      "content_block_stop",
                      JSON.stringify({
                        type: "content_block_stop",
                        index: contentIndex,
                      }),
                    ),
                  );

                  send(
                    sseEvent(
                      "message_delta",
                      JSON.stringify({
                        type: "message_delta",
                        delta: {
                          stop_reason: mapStopReason(part.finishReason),
                          stop_sequence: null,
                        },
                        usage: {
                          output_tokens: part.totalUsage?.outputTokens ?? 0,
                          ...(part.totalUsage?.inputTokenDetails?.cacheWriteTokens != null
                            ? {
                                cache_creation_input_tokens:
                                  part.totalUsage.inputTokenDetails.cacheWriteTokens,
                              }
                            : {}),
                          ...(part.totalUsage?.inputTokenDetails?.cacheReadTokens != null
                            ? {
                                cache_read_input_tokens:
                                  part.totalUsage.inputTokenDetails.cacheReadTokens,
                              }
                            : {}),
                        },
                      }),
                    ),
                  );

                  send(sseEvent("message_stop", JSON.stringify({ type: "message_stop" })));
                }
              }
            } catch {
              send(
                sseEvent(
                  "error",
                  JSON.stringify({
                    type: "error",
                    error: {
                      type: "api_error",
                      message: "Stream error",
                    },
                  }),
                ),
              );
            }

            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      const result = await generateText({
        model,
        system,
        messages,
        ...params,
        providerOptions,
      });
      const content: Array<{ type: "text"; text: string }> = [];
      if (result.text) content.push({ type: "text", text: result.text });

      return {
        id: generateId("msg"),
        type: "message",
        role: "assistant",
        content,
        model: body.model,
        stop_reason: mapStopReason(result.finishReason),
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: convertUsage(result.usage),
      };
    }),
  );
}
