import type {
  Experimental_VideoModelV4 as VideoModelV4,
  LanguageModelV4,
  ProviderV4,
  RerankingModelV4,
  SpeechModelV4,
  TranscriptionModelV4,
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

// --- OCR options (shared by Chat and Responses) ---
// @see https://help.aliyun.com/zh/model-studio/qwen-vl-ocr

export interface DashScopeOcrOptions {
  /** Built-in task type. */
  task:
    | "advanced_recognition"
    | "key_information_extraction"
    | "table_parsing"
    | "document_parsing"
    | "formula_recognition"
    | "text_recognition"
    | "multi_lan";
  /** Task configuration; only `key_information_extraction` uses `resultSchema`. */
  taskConfig?: {
    /** Custom field-extraction JSON template (key -> description). */
    resultSchema?: Record<string, unknown>;
  };
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
  /**
   * Built-in OCR task for Qwen-OCR models (maps to `ocr_options`). The
   * OpenAI-compatible Chat endpoint does not officially honor built-in OCR
   * tasks via parameter — prefer the Responses endpoint, or emulate the task
   * through the text prompt.
   */
  ocrOptions?: DashScopeOcrOptions;
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
  /** Built-in OCR task for Qwen-OCR models (maps to the top-level `ocr_options`). */
  ocrOptions?: DashScopeOcrOptions;
}

// --- Responses namespace ---

export interface DashScopeResponsesNamespace {
  (modelId: string): LanguageModelV4;
  tools: DashScopeResponsesTools;
}

// --- Provider interface ---

export interface DashScopeProvider extends ProviderV4 {
  rerankingModel(modelId: string): RerankingModelV4;
  speechModel(modelId: string): SpeechModelV4;
  transcriptionModel(modelId: string): TranscriptionModelV4;
  (modelId: string): LanguageModelV4;
  completionModel(modelId: string): LanguageModelV4;
  videoModel(modelId: string): VideoModelV4;
  chatOptions: (options: DashScopeChatOptions) => {
    providerOptions: { dashscope: DashScopeChatOptions };
  };
  responsesOptions: (options: DashScopeResponsesOptions) => {
    providerOptions: { dashscope: DashScopeResponsesOptions };
  };
  responses: DashScopeResponsesNamespace;
}
