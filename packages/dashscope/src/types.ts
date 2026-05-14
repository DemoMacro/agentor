import type { EmbeddingModelV3, LanguageModelV3, RerankingModelV3 } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { DashScopeResponsesTools } from "./tools";

// --- Region ---

export type DashScopeRegion = "beijing" | "singapore" | "us" | "germany";

export const DASHSCOPE_REGION_BASE_URLS: Record<
  DashScopeRegion,
  { baseURL: string; videoBaseURL: string }
> = {
  beijing: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    videoBaseURL: "https://dashscope.aliyuncs.com",
  },
  singapore: {
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    videoBaseURL: "https://dashscope-intl.aliyuncs.com",
  },
  us: {
    baseURL: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    videoBaseURL: "https://dashscope-us.aliyuncs.com",
  },
  germany: {
    baseURL: "https://{workspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1",
    videoBaseURL: "https://{workspaceId}.eu-central-1.maas.aliyuncs.com",
  },
};

// --- Provider settings ---

export interface DashScopeProviderSettings {
  apiKey?: string;
  region?: DashScopeRegion;
  workspaceId?: string;
  baseURL?: string;
  videoBaseURL?: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
  includeUsage?: boolean;
}

// --- Chat options ---

export interface DashScopeChatOptions {
  /** Enable thinking/reasoning mode. */
  enableThinking?: boolean;
  /** Maximum reasoning tokens. */
  thinkingBudget?: number;
  /** Enable parallel tool calls. */
  parallelToolCalls?: boolean;
  /** Enable web search. */
  enableSearch?: boolean;
  /**
   * Search strategy.
   * - "enable": enable search
   * - "enable_with_history": enable search with history context
   * - "agent_max": enable web extraction (requires enableSearch + enableThinking)
   */
  searchStrategy?: "enable" | "enable_with_history" | "agent_max";
  /** Enable code interpreter (requires enableThinking). */
  enableCodeInterpreter?: boolean;
}

// --- Responses API options ---

export interface DashScopeResponsesOptions {
  enableThinking?: boolean;
  reasoning?: {
    effort: "none" | "minimal" | "low" | "medium" | "high";
  };
  previousResponseId?: string;
  conversation?: string;
  instructions?: string;
  includeUsage?: boolean;
}

// --- Responses namespace ---

export interface DashScopeResponsesNamespace {
  (modelId: string): LanguageModelV3;
  tools: DashScopeResponsesTools;
}

// --- Provider interface ---

export interface DashScopeProvider {
  (modelId: string): LanguageModelV3;
  languageModel(modelId: string): LanguageModelV3;
  embeddingModel(modelId: string): EmbeddingModelV3;
  rerankingModel(modelId: string): RerankingModelV3;
  chatOptions: (options: DashScopeChatOptions) => {
    providerOptions: { dashscope: DashScopeChatOptions };
  };
  responsesOptions: (options: DashScopeResponsesOptions) => {
    providerOptions: { dashscope: DashScopeResponsesOptions };
  };
  responses: DashScopeResponsesNamespace;
}
