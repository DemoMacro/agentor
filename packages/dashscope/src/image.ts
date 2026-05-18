import type { ImageModelV3, ImageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonResponseHandler,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

import { nativeFailedHandler, uint8ArrayToBase64, type DashScopeConfig } from "./utils";

// --- Options ---

export interface DashScopeImageOptions {
  /** Output image size, e.g. "2048*2048", "1024*1024", "1K", "2K". */
  size?: string;
  /** Negative prompt describing what to avoid. */
  negativePrompt?: string;
  /** Enable prompt extension/rewriting. Default depends on model. */
  promptExtend?: boolean;
  /** Add watermark. Default false. */
  watermark?: boolean;
  /** Number of images to generate. Default 1. */
  n?: number;
}

// --- Schema ---

const imageOptionsSchema = z.object({
  size: z.string().optional(),
  negativePrompt: z.string().optional(),
  promptExtend: z.boolean().optional(),
  watermark: z.boolean().optional(),
  n: z.number().optional(),
});

const imageResponseSchema = zodSchema(
  z.object({
    output: z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.array(
                  z.object({
                    image: z.string().optional(),
                  }),
                ),
              }),
            }),
          )
          .optional(),
      })
      .nullish(),
    usage: z
      .object({
        image_count: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// --- Model ---

export class DashScopeImageModel implements ImageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly modelId: string;
  private readonly config: DashScopeConfig;

  constructor(modelId: string, config: DashScopeConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get maxImagesPerCall(): number | undefined {
    return 1;
  }

  async doGenerate(options: ImageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const dsOptions = await parseProviderOptions<DashScopeImageOptions>({
      provider: "dashscope",
      providerOptions: options.providerOptions,
      schema: imageOptionsSchema,
    });

    const body: Record<string, unknown> = {
      model: this.modelId,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: options.prompt }],
          },
        ],
      },
      parameters: {
        ...(dsOptions?.size != null && { size: dsOptions.size }),
        ...(dsOptions?.negativePrompt != null && { negative_prompt: dsOptions.negativePrompt }),
        ...(dsOptions?.promptExtend != null && { prompt_extend: dsOptions.promptExtend }),
        ...(dsOptions?.watermark != null && { watermark: dsOptions.watermark }),
        ...(dsOptions?.n != null && { n: dsOptions.n }),
      },
    };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/api/v1/services/aigc/multimodal-generation/generation`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: nativeFailedHandler,
      successfulResponseHandler: createJsonResponseHandler(imageResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const imageUrls =
      response.output?.choices?.flatMap((c) =>
        c.message.content.filter((p) => p.image != null).map((p) => p.image!),
      ) ?? [];

    // Download images from URLs and convert to base64
    const images: string[] = [];
    for (const url of imageUrls) {
      const imageResponse = await (this.config.fetch ?? fetch)(url, {
        headers: this.config.headers(),
      });
      const buffer = await imageResponse.arrayBuffer();
      images.push(uint8ArrayToBase64(new Uint8Array(buffer)));
    }

    return {
      images,
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }
}
