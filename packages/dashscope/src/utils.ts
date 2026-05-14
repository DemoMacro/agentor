import type { JSONObject, LanguageModelV3Usage } from "@ai-sdk/provider";
import { createJsonErrorResponseHandler, FetchFunction, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

// --- Config ---

export interface DashScopeConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
  includeUsage?: boolean;
}

// --- Error handling (OpenAI-compatible endpoints) ---

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

// --- Error handling (DashScope native endpoints) ---

export const nativeErrorSchema = zodSchema(
  z.object({
    code: z.string().nullish(),
    message: z.string(),
    request_id: z.string().nullish(),
  }),
);

export const nativeFailedHandler = createJsonErrorResponseHandler({
  errorSchema: nativeErrorSchema,
  errorToMessage: (data) => data.message,
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
    raw: usage as unknown as JSONObject,
  };
}

// --- Base64 utility ---

export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}
