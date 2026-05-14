import type { SharedV3Warning, SpeechModelV3, SpeechModelV3CallOptions } from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonResponseHandler,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
import { nativeFailedHandler, type DashScopeConfig } from "./utils";

// --- Options ---

export interface DashScopeSpeechOptions {
  /** Voice name. Model-specific, e.g. "longanyang" for CosyVoice, "Cherry" for Qwen-TTS. */
  voice?: string;
  /** Output audio format: "wav", "mp3", "pcm". Default depends on model. */
  format?: string;
  /** Sample rate. Default depends on model. */
  sampleRate?: number;
  /** Language type for Qwen-TTS: "Chinese" | "English" | "Japanese" | etc. */
  languageType?: string;
  /** Speaking speed. 0.5-2.0, default 1.0. */
  speed?: number;
  /** Volume. 0.5-2.0, default 1.0. */
  volume?: number;
  /** Pitch. -12 to 12, default 0. */
  pitch?: number;
}

// --- Schema ---

const speechOptionsSchema = z.object({
  voice: z.string().optional(),
  format: z.string().optional(),
  sampleRate: z.number().optional(),
  languageType: z.string().optional(),
  speed: z.number().optional(),
  volume: z.number().optional(),
  pitch: z.number().optional(),
});

const cosyvoiceResponseSchema = zodSchema(
  z.object({
    output: z
      .object({
        audio: z
          .object({
            url: z.string().optional(),
          })
          .nullish(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// --- Model ---

export class DashScopeSpeechModel implements SpeechModelV3 {
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

  async doGenerate(options: SpeechModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const dsOptions = await parseProviderOptions<DashScopeSpeechOptions>({
      provider: "dashscope",
      providerOptions: options.providerOptions,
      schema: speechOptionsSchema,
    });

    const voice = dsOptions?.voice ?? "longanyang";
    const format = dsOptions?.format ?? "wav";
    const sampleRate = dsOptions?.sampleRate ?? 24000;

    // CosyVoice models use dedicated TTS endpoint
    const isCosyVoice = this.modelId.startsWith("cosyvoice");

    let url: string;
    let body: Record<string, unknown>;

    if (isCosyVoice) {
      url = `${this.config.baseURL}/api/v1/services/audio/tts/SpeechSynthesizer`;
      body = {
        model: this.modelId,
        input: {
          text: options.text,
          voice,
          format,
          sample_rate: sampleRate,
          ...(dsOptions?.speed != null && { speech_rate: dsOptions.speed }),
          ...(dsOptions?.volume != null && { volume: dsOptions.volume }),
          ...(dsOptions?.pitch != null && { pitch_rate: dsOptions.pitch }),
        },
      };
    } else {
      // Qwen-TTS / MiniMax use multimodal-generation endpoint
      url = `${this.config.baseURL}/api/v1/services/aigc/multimodal-generation/generation`;
      body = {
        model: this.modelId,
        input: {
          text: options.text,
          voice,
          ...(dsOptions?.languageType != null && { language_type: dsOptions.languageType }),
        },
      };
    }

    const { responseHeaders, value: response } = await postJsonToApi({
      url,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: nativeFailedHandler,
      successfulResponseHandler: createJsonResponseHandler(cosyvoiceResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const audioUrl = response.output?.audio?.url;
    if (!audioUrl) {
      throw new Error("No audio URL returned from TTS API");
    }

    // Fetch the audio data from URL
    const audioResponse = await (this.config.fetch ?? fetch)(audioUrl, {
      headers: this.config.headers(),
    });
    const audioBuffer = await audioResponse.arrayBuffer();

    return {
      audio: new Uint8Array(audioBuffer),
      warnings,
      request: { body },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }
}
