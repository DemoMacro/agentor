import type {
  Experimental_VideoModelV3 as VideoModelV3,
  LanguageModelV3,
  ProviderV3,
  RerankingModelV3,
  SpeechModelV3,
  TranscriptionModelV3,
} from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";

import type { DashScopeResponsesTools } from "./tools";

// --- Region ---

export type DashScopeRegion = "beijing" | "singapore" | "us" | "germany";

export const DASHSCOPE_REGION_URLS: Record<DashScopeRegion, string> = {
  beijing: "https://dashscope.aliyuncs.com",
  singapore: "https://dashscope-intl.aliyuncs.com",
  us: "https://dashscope-us.aliyuncs.com",
  germany: "https://{workspaceId}.eu-central-1.maas.aliyuncs.com",
};

// --- Provider settings ---

export interface DashScopeProviderSettings {
  apiKey?: string;
  region?: DashScopeRegion;
  workspaceId?: string;
  baseURL?: string;
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

export interface DashScopeProvider extends ProviderV3 {
  rerankingModel(modelId: string): RerankingModelV3;
  speechModel(modelId: string): SpeechModelV3;
  transcriptionModel(modelId: string): TranscriptionModelV3;
  (modelId: string): LanguageModelV3;
  completionModel(modelId: string): LanguageModelV3;
  videoModel(modelId: string): VideoModelV3;
  chatOptions: (options: DashScopeChatOptions) => {
    providerOptions: { dashscope: DashScopeChatOptions };
  };
  responsesOptions: (options: DashScopeResponsesOptions) => {
    providerOptions: { dashscope: DashScopeResponsesOptions };
  };
  responses: DashScopeResponsesNamespace;
}
