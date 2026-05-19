import { generateText, streamText } from "ai";
import type { ModelMessage } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type {
  EasyInputMessage,
  Response as OpenAIResponse,
  ResponseCreateParamsBase,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseInputText,
  ResponseInputContent,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseUsage,
} from "openai/resources/responses/responses";

import type { ServerContext } from "../../types";
import { generateId, sseData } from "../../utils";

type RequestBody = ResponseCreateParamsBase & Record<string, unknown>;

// --- Input Conversion ---

type UserContentPart = { type: "text"; text: string } | { type: "image"; image: URL | string };

function convertContentParts(parts: ResponseInputContent[]): UserContentPart[] {
  const result: UserContentPart[] = [];
  for (const part of parts) {
    if (part.type === "input_text") {
      result.push({ type: "text", text: part.text });
    } else if (part.type === "input_image" && part.image_url) {
      result.push({
        type: "image",
        image: part.image_url.startsWith("data:") ? part.image_url : new URL(part.image_url),
      });
    }
  }
  return result;
}

function toTextContent(content: string | ResponseInputContent[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is ResponseInputText => p.type === "input_text")
    .map((p) => p.text)
    .join("\n");
}

function toUserContent(content: string | ResponseInputContent[]): string | UserContentPart[] {
  if (typeof content === "string") return content;
  const parts = convertContentParts(content);
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}

function convertResponseInput(input: string | ResponseInputItem[]): ModelMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  const messages: ModelMessage[] = [];

  for (const item of input) {
    if (!("type" in item)) continue;

    if (item.type === "message" || item.type === undefined) {
      const msg = item as EasyInputMessage | ResponseInputItem.Message;

      if (msg.role === "system" || msg.role === "developer") {
        messages.push({ role: "system", content: toTextContent(msg.content) });
      } else if (msg.role === "user") {
        messages.push({ role: "user", content: toUserContent(msg.content) });
      } else if (msg.role === "assistant") {
        messages.push({ role: "assistant", content: toTextContent(msg.content) });
      }
    } else if (item.type === "function_call_output") {
      const fc = item as ResponseInputItem.FunctionCallOutput;
      const output = typeof fc.output === "string" ? fc.output : JSON.stringify(fc.output);
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: fc.call_id,
            toolName: "",
            output: { type: "text", value: output },
          },
        ],
      });
    }
  }

  return messages;
}

// --- Param Conversion ---

function convertResponseParams(body: RequestBody): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (body.temperature != null) params.temperature = body.temperature;
  if (body.top_p != null) params.topP = body.top_p;
  if (body.max_output_tokens != null) params.maxOutputTokens = body.max_output_tokens;
  if (body.presence_penalty != null) params.presencePenalty = body.presence_penalty;
  if (body.frequency_penalty != null) params.frequencyPenalty = body.frequency_penalty;
  if (body.seed != null) params.seed = body.seed;

  if (body.tools?.length) {
    const tools: Record<string, unknown> = {};
    for (const t of body.tools) {
      if (t.type === "function" && "name" in t) {
        tools[t.name] = { description: t.description, parameters: t.parameters };
      }
    }
    params.tools = tools;
  }

  if (body.tool_choice != null) {
    const tc = body.tool_choice;
    if (typeof tc === "string") {
      params.toolChoice = tc;
    } else if (tc.type === "function" && "name" in tc) {
      params.toolChoice = { type: "tool", toolName: tc.name };
    }
  }

  return params;
}

// --- Response Builders ---

function buildResponseUsage(
  inputTokens?: number,
  outputTokens?: number,
  cachedTokens?: number,
  reasoningTokens?: number,
): ResponseUsage {
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cachedTokens ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: reasoningTokens ?? 0 },
    total_tokens: input + output,
  };
}

function buildResponseBase(id: string, body: RequestBody): OpenAIResponse {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: body.model ?? "",
    output: [],
    output_text: "",
    error: null,
    incomplete_details: null,
    instructions: body.instructions ?? null,
    metadata: body.metadata ?? null,
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    temperature: body.temperature ?? null,
    tool_choice: body.tool_choice ?? "auto",
    tools: body.tools ?? [],
    top_p: body.top_p ?? null,
  };
}

function buildOutputText(text: string): ResponseOutputText {
  return { type: "output_text", text, annotations: [] };
}

function buildOutputMessage(
  id: string,
  content: ResponseOutputText[],
  status: ResponseOutputMessage["status"] = "completed",
): ResponseOutputMessage {
  return { type: "message", id, role: "assistant", content, status };
}

function buildFunctionToolCall(
  id: string,
  callId: string,
  name: string,
  args: string,
): ResponseFunctionToolCall {
  return { type: "function_call", id, call_id: callId, name, arguments: args, status: "completed" };
}

function mapResponseStatus(
  finishReason: string | undefined,
): "completed" | "incomplete" | "failed" {
  if (finishReason === "length") return "incomplete";
  return "completed";
}

// --- Route ---

export function registerResponses(app: H3, context: ServerContext) {
  app.post(
    "/responses",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as RequestBody;
      if (!body.model) {
        throw new HTTPError({ status: 400, message: "Missing required field: model" });
      }

      const model = context.registry.languageModel(body.model as never);
      const input = body.input ?? "";
      const messages = convertResponseInput(input);
      const system = typeof body.instructions === "string" ? body.instructions : undefined;
      const params = convertResponseParams(body);
      const providerOptions = body.providerOptions as Parameters<
        typeof generateText
      >[0]["providerOptions"];

      if (body.stream) {
        const id = generateId("resp");
        const result = streamText({ model, system, messages, ...params, providerOptions });
        const encoder = new TextEncoder();
        let seq = 0;
        const nextSeq = () => ++seq;

        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: string) => controller.enqueue(encoder.encode(data));
            const msgId = generateId("msg");

            const baseResp = buildResponseBase(id, body);

            send(
              sseData(
                JSON.stringify({
                  type: "response.created",
                  response: baseResp,
                  sequence_number: nextSeq(),
                }),
              ),
            );
            send(
              sseData(
                JSON.stringify({
                  type: "response.in_progress",
                  response: { ...baseResp, status: "in_progress" },
                  sequence_number: nextSeq(),
                }),
              ),
            );

            const outputItems: ResponseOutputItem[] = [];
            let fullText = "";

            try {
              for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                  if (fullText.length === 0) {
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.output_item.added",
                          output_index: 0,
                          item: buildOutputMessage(msgId, [buildOutputText("")], "in_progress"),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.content_part.added",
                          output_index: 0,
                          content_index: 0,
                          item_id: msgId,
                          part: buildOutputText(""),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                  }

                  fullText += part.text;
                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.output_text.delta",
                        output_index: 0,
                        content_index: 0,
                        item_id: msgId,
                        delta: part.text,
                        logprobs: [],
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );
                } else if (part.type === "tool-call") {
                  if (fullText.length > 0) {
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.output_text.done",
                          output_index: 0,
                          content_index: 0,
                          item_id: msgId,
                          text: fullText,
                          logprobs: [],
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.content_part.done",
                          output_index: 0,
                          content_index: 0,
                          item_id: msgId,
                          part: buildOutputText(fullText),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.output_item.done",
                          output_index: 0,
                          item: buildOutputMessage(msgId, [buildOutputText(fullText)], "completed"),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    outputItems.push(
                      buildOutputMessage(msgId, [buildOutputText(fullText)], "completed"),
                    );
                  }

                  const fcId = generateId("fc");
                  const args =
                    typeof part.input === "string" ? part.input : JSON.stringify(part.input);
                  const outputIndex = outputItems.length;

                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.output_item.added",
                        output_index: outputIndex,
                        item: buildFunctionToolCall(fcId, part.toolCallId, part.toolName, ""),
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );

                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.function_call_arguments.delta",
                        output_index: outputIndex,
                        item_id: fcId,
                        delta: args,
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );

                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.function_call_arguments.done",
                        output_index: outputIndex,
                        item_id: fcId,
                        name: part.toolName,
                        arguments: args,
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );

                  const fcItem = buildFunctionToolCall(fcId, part.toolCallId, part.toolName, args);
                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.output_item.done",
                        output_index: outputIndex,
                        item: fcItem,
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );
                  outputItems.push(fcItem);

                  fullText = "";
                } else if (part.type === "finish") {
                  if (fullText.length > 0) {
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.output_text.done",
                          output_index: 0,
                          content_index: 0,
                          item_id: msgId,
                          text: fullText,
                          logprobs: [],
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.content_part.done",
                          output_index: 0,
                          content_index: 0,
                          item_id: msgId,
                          part: buildOutputText(fullText),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    send(
                      sseData(
                        JSON.stringify({
                          type: "response.output_item.done",
                          output_index: 0,
                          item: buildOutputMessage(msgId, [buildOutputText(fullText)], "completed"),
                          sequence_number: nextSeq(),
                        }),
                      ),
                    );
                    outputItems.push(
                      buildOutputMessage(msgId, [buildOutputText(fullText)], "completed"),
                    );
                  }

                  const usage = part.totalUsage;
                  const responseUsage = buildResponseUsage(
                    usage?.inputTokens,
                    usage?.outputTokens,
                    usage?.inputTokenDetails?.cacheReadTokens,
                    usage?.outputTokenDetails?.reasoningTokens,
                  );

                  const completedResp: OpenAIResponse = {
                    ...baseResp,
                    status: mapResponseStatus(part.finishReason),
                    output: outputItems,
                    output_text: fullText,
                    usage: responseUsage,
                    completed_at: Math.floor(Date.now() / 1000),
                  };

                  send(
                    sseData(
                      JSON.stringify({
                        type: "response.completed",
                        response: completedResp,
                        sequence_number: nextSeq(),
                      }),
                    ),
                  );
                }
              }
            } catch {
              send(
                sseData(
                  JSON.stringify({
                    type: "response.failed",
                    response: { ...baseResp, status: "failed" },
                    sequence_number: nextSeq(),
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
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming
      const aiResult = await generateText({ model, system, messages, ...params, providerOptions });
      const id = generateId("resp");
      const msgId = generateId("msg");
      const outputItems: ResponseOutputItem[] = [];
      let outputText = aiResult.text;

      if (aiResult.text) {
        outputItems.push(buildOutputMessage(msgId, [buildOutputText(aiResult.text)], "completed"));
      }

      for (const tc of aiResult.toolCalls) {
        const fcId = generateId("fc");
        const args = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input);
        outputItems.push(buildFunctionToolCall(fcId, tc.toolCallId, tc.toolName, args));
      }

      const usage = aiResult.usage;
      const response: OpenAIResponse = {
        ...buildResponseBase(id, body),
        status: mapResponseStatus(aiResult.finishReason),
        output: outputItems,
        output_text: outputText,
        usage: buildResponseUsage(
          usage?.inputTokens,
          usage?.outputTokens,
          usage?.inputTokenDetails?.cacheReadTokens,
          usage?.outputTokenDetails?.reasoningTokens,
        ),
        completed_at: Math.floor(Date.now() / 1000),
      };

      return response;
    }),
  );
}
