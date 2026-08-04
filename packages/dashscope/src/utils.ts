import type { JSONObject, LanguageModelV4Usage, SharedV4FileData } from "@ai-sdk/provider";
import {
  convertToBase64,
  createJsonErrorResponseHandler,
  FetchFunction,
  zodSchema,
} from "@ai-sdk/provider-utils";
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

export function convertResponsesUsage(usage: ResponsesUsage | undefined): LanguageModelV4Usage {
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

// --- Cache control (providerOptions.dashscope.cacheControl) ---

// Shared by the Chat and Responses paths. Returns the wire cache_control
// object (for Chat content blocks) or a truthy signal (for the Responses
// session-cache header). The marker type is intentionally unchecked, mirroring
// the anthropic provider's permissive cacheControl handling.
export function extractCacheControl(
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const ds = providerOptions?.dashscope as { cacheControl?: { type: string } } | undefined;
  if (ds?.cacheControl) {
    return { cache_control: { type: ds.cacheControl.type } };
  }
  return undefined;
}

// --- Structured output (JSON) instruction ---

/**
 * Build a system instruction asking the model to reply with a JSON object
 * conforming to the given schema. Shared by the Chat and Responses paths:
 * neither DashScope endpoint can take the schema natively to enforce the
 * structure (Chat only guarantees JSON shape via response_format json_object;
 * Responses ignores text.format / response_format entirely).
 */
export function buildJsonInstruction(format: {
  schema?: unknown;
  name?: string;
  description?: string;
}): string {
  const lines = ["Respond with a single valid JSON object as the entire output."];
  if (format.description) lines.push(format.description);
  if (format.schema) {
    lines.push(
      `The JSON must conform to this JSON Schema${format.name ? ` for "${format.name}"` : ""}:`,
      "```json",
      JSON.stringify(format.schema),
      "```",
    );
  }
  lines.push(
    "Do not include any markdown fences, explanations, or surrounding text — output only the raw JSON.",
  );
  return lines.join("\n");
}

// --- File part conversion ---

/**
 * Resolve a V4 file part's SharedV4Data into a URL the DashScope
 * OpenAI-compatible endpoints accept as `image_url`. SharedV4FileData is a
 * tagged union; only the `data` (raw bytes or base64) and `url` variants can
 * become a URL — `reference` and `text` have no URL form.
 */
export function fileDataToImageUrl(data: SharedV4FileData, mediaType: string): string | undefined {
  switch (data.type) {
    case "url":
      return data.url.toString();
    case "data":
      if (typeof data.data === "string") {
        return data.data.startsWith("data:") ? data.data : `data:${mediaType};base64,${data.data}`;
      }
      return `data:${mediaType};base64,${convertToBase64(data.data)}`;
    default:
      return undefined;
  }
}

// --- Base64 utility ---

export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}
