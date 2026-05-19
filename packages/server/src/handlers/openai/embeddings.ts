import { embed } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import type { CreateEmbeddingResponse, EmbeddingCreateParams } from "openai/resources/embeddings";

import type { ServerContext } from "../../types";

export function registerEmbeddings(app: H3, context: ServerContext) {
  app.post(
    "/embeddings",
    defineHandler(async (event) => {
      try {
        const body = (await event.req.json()) as EmbeddingCreateParams & Record<string, unknown>;
        if (!body.model || body.input == null) {
          event.res.status = 400;
          return {
            error: {
              message: "Missing required fields: model, input",
              type: "invalid_request_error",
            },
          };
        }

        const model = context.registry.embeddingModel(body.model as never);
        const inputs = Array.isArray(body.input)
          ? body.input.every((v) => typeof v === "number")
            ? [String(body.input)]
            : (body.input as string[])
          : [body.input as string];

        const data: CreateEmbeddingResponse["data"] = [];
        let totalTokens = 0;

        for (const [index, input] of inputs.entries()) {
          const result = await embed({ model, value: input });
          data.push({
            object: "embedding",
            index,
            embedding: result.embedding,
          });
          totalTokens += result.usage?.tokens ?? 0;
        }

        const response: CreateEmbeddingResponse = {
          object: "list",
          data,
          model: body.model,
          usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
        };
        return response;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        event.res.status = 500;
        return { error: { message, type: "internal_error" } };
      }
    }),
  );
}
