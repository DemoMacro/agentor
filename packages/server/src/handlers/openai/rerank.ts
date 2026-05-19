import { rerank } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";

import type { ServerContext } from "../../types";

interface RerankResultItem {
  index: number;
  document: string | Record<string, unknown>;
  relevance_score: number;
}

interface RerankResponse {
  id: string;
  model: string;
  results: RerankResultItem[];
}

export function registerRerank(app: H3, context: ServerContext) {
  app.post(
    "/rerank",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as {
        model?: string;
        query?: string;
        documents?: Array<string | Record<string, unknown>>;
        top_n?: number;
        providerOptions?: Record<string, unknown>;
      } & Record<string, unknown>;

      if (!body.model || !body.query || !body.documents) {
        throw new HTTPError({
          status: 400,
          message: "Missing required fields: model, query, documents",
        });
      }

      const model = context.registry.rerankingModel(body.model as never);
      const result = await rerank({
        model,
        query: body.query,
        documents: body.documents as Parameters<typeof rerank>[0]["documents"],
        topN: body.top_n,
        providerOptions: body.providerOptions as Parameters<typeof rerank>[0]["providerOptions"],
      });

      const results: RerankResultItem[] = result.ranking.map((r) => ({
        index: r.originalIndex,
        document: r.document as string | Record<string, unknown>,
        relevance_score: r.score,
      }));

      const response: RerankResponse = {
        id: result.response.id ?? `rerank-${Date.now()}`,
        model: result.response.modelId ?? body.model,
        results,
      };

      return response;
    }),
  );
}
