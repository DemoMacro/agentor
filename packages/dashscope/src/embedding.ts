import { OpenAICompatibleEmbeddingModel } from "@ai-sdk/openai-compatible";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { DashScopeConfig } from "./utils";

// --- Options ---

export interface DashScopeEmbeddingOptions {
  /** Output embedding dimensions. Supported by text-embedding-v4, text-embedding-v3, etc. */
  dimensions?: number;
}

// --- Model ---

export class DashScopeEmbeddingModel extends OpenAICompatibleEmbeddingModel {
  constructor(modelId: string, config: DashScopeConfig) {
    super(modelId, {
      provider: config.provider,
      url: () => `${config.baseURL}/compatible-mode/v1/embeddings`,
      headers: config.headers as () => Record<string, string | undefined>,
      fetch: config.fetch as FetchFunction | undefined,
    });
  }
}
