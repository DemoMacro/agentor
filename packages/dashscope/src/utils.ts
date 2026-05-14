import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import { createJsonErrorResponseHandler, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

// --- Config ---

export interface DashScopeConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: import("@ai-sdk/provider-utils").FetchFunction;
  includeUsage?: boolean;
}

// --- Error handling ---

export const errorSchema = zodSchema(
  z.object({
    error: z.object({
      message: z.string(),
      code: z.string().nullish(),
      type: z.string().nullish(),
    }),
  }),
);

export const failedResponseHandler = createJsonErrorResponseHandler({
  errorSchema,
  errorToMessage: (data) => data.error.message,
});

// --- Usage (Responses API) ---

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
}

export function convertResponsesUsage(usage: ResponsesUsage | undefined): LanguageModelV3Usage {
  if (!usage) {
    return {
      inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: undefined, reasoning: undefined },
    };
  }

  return {
    inputTokens: {
      total: usage.input_tokens ?? 0,
      noCache: undefined,
      cacheRead: usage.input_tokens_details?.cached_tokens ?? undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.output_tokens ?? 0,
      text: undefined,
      reasoning: usage.output_tokens_details?.reasoning_tokens ?? undefined,
    },
    raw: usage as unknown as import("@ai-sdk/provider").JSONObject,
  };
}
