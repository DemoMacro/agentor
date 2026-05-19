import { generateText, streamText } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";

import type { ServerContext } from "../../types";
import {
  buildChunk,
  buildCompletion,
  convertMessages,
  convertParams,
  generateId,
  mapFinishReason,
  sseData,
  sseDone,
} from "../../utils";

type RequestBody = ChatCompletionCreateParamsBase & Record<string, unknown>;

export function registerChatCompletions(app: H3, context: ServerContext) {
  app.post(
    "/chat/completions",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as RequestBody;
      if (!body.model || !body.messages) {
        throw new HTTPError({ status: 400, message: "Missing required fields: model, messages" });
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
        result.response.id ?? generateId("chatcmpl"),
        result.response.modelId ?? body.model,
        result.text,
        result.finishReason,
        result.usage,
        result.response.timestamp,
      );
    }),
  );
}
