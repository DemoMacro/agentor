import { OpenAICompatibleCompletionLanguageModel } from "@ai-sdk/openai-compatible";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { DashScopeConfig } from "./utils";

// --- Model ---

export class DashScopeCompletionModel extends OpenAICompatibleCompletionLanguageModel {
  constructor(modelId: string, config: DashScopeConfig) {
    super(modelId, {
      provider: config.provider,
      url: () => `${config.baseURL}/compatible-mode/v1/completions`,
      headers: config.headers as () => Record<string, string | undefined>,
      fetch: config.fetch as FetchFunction | undefined,
      includeUsage: config.includeUsage,
    });
  }
}
