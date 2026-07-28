import type {
  RerankingModelV4,
  RerankingModelV4CallOptions,
  SharedV4Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

import { failedResponseHandler, type DashScopeConfig } from "./utils";

// --- Options ---

export interface DashScopeRerankOptions {
  /** English instruction to guide the reranking strategy. */
  instruct?: string;
}

// --- Schema ---

const rerankResponseSchema = zodSchema(
  z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    results: z
      .array(
        z.object({
          index: z.number(),
          relevance_score: z.number(),
        }),
      )
      .optional(),
  }),
);

// --- Model ---

export class DashScopeRerankingModel implements RerankingModelV4 {
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

  async doRerank(options: RerankingModelV4CallOptions) {
    const warnings: SharedV4Warning[] = [];

    const documents =
      options.documents.type === "text"
        ? options.documents.values
        : options.documents.values.map((d) => JSON.stringify(d));

    const body: Record<string, unknown> = {
      model: this.modelId,
      query: options.query,
      documents,
      ...(options.topN != null && { top_n: options.topN }),
    };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/compatible-api/v1/reranks`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: failedResponseHandler as ReturnType<
        typeof createJsonErrorResponseHandler
      >,
      successfulResponseHandler: createJsonResponseHandler(rerankResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      ranking: (response.results ?? []).map((r) => ({
        index: r.index,
        relevanceScore: r.relevance_score,
      })),
      warnings,
      response: {
        id: response.id ?? undefined,
        timestamp: new Date(),
        modelId: response.model ?? undefined,
        headers: responseHeaders,
      },
    };
  }
}
