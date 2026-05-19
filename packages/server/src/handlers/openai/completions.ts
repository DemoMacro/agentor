import { generateText } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type { Completion, CompletionCreateParamsBase } from "openai/resources/completions";

import type { ServerContext } from "../../types";
import { generateId, mapFinishReason } from "../../utils";

type RequestBody = CompletionCreateParamsBase & Record<string, unknown>;

export function registerCompletions(app: H3, context: ServerContext) {
  app.post(
    "/completions",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as RequestBody;
      if (!body.model || body.prompt == null) {
        throw new HTTPError({ status: 400, message: "Missing required fields: model, prompt" });
      }

      const model = context.registry.languageModel(body.model as never);

      const params: Record<string, unknown> = {};
      if (body.temperature != null) params.temperature = body.temperature;
      if (body.top_p != null) params.topP = body.top_p;
      if (body.max_tokens != null) params.maxOutputTokens = body.max_tokens;
      if (body.presence_penalty != null) params.presencePenalty = body.presence_penalty;
      if (body.frequency_penalty != null) params.frequencyPenalty = body.frequency_penalty;
      if (body.seed != null) params.seed = body.seed;
      if (body.stop) params.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];

      const prompt = typeof body.prompt === "string" ? body.prompt : String(body.prompt);
      const result = await generateText({
        model,
        prompt,
        ...params,
        providerOptions: body.providerOptions as Parameters<
          typeof generateText
        >[0]["providerOptions"],
      });

      const response: Completion = {
        id: result.response.id ?? generateId("cmpl"),
        object: "text_completion",
        created: Math.floor(result.response.timestamp.getTime() / 1000),
        model: result.response.modelId ?? body.model,
        choices: [
          {
            text: result.text,
            index: 0,
            finish_reason: mapFinishReason(
              result.finishReason,
            ) as Completion["choices"][number]["finish_reason"],
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
          total_tokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
        },
      };
      return response;
    }),
  );
}
