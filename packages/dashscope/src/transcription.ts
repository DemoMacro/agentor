import type {
  SharedV3Warning,
  TranscriptionModelV3,
  TranscriptionModelV3CallOptions,
} from "@ai-sdk/provider";
import { AISDKError } from "@ai-sdk/provider";
import {
  combineHeaders,
  createJsonResponseHandler,
  delay,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";
import { nativeFailedHandler, uint8ArrayToBase64, type DashScopeConfig } from "./utils";

// --- Options ---

export interface DashScopeTranscriptionOptions {
  /**
   * Publicly accessible audio file URL for async transcription.
   * Required for async models (filetrans, fun-asr, paraformer) when using long audio.
   */
  fileUrl?: string;
  /** Language hint(s), e.g. ["zh", "en"]. */
  languageHints?: string[];
  /** Enable inverse text normalization (convert spoken numbers/dates to written form). */
  enableItn?: boolean;
  /** Enable word-level timestamps. */
  enableWords?: boolean;
  /** Channel IDs to transcribe. Default [0]. */
  channelId?: number[];
  /** Polling interval in ms. Default 5000. (async mode only) */
  pollIntervalMs?: number;
  /** Polling timeout in ms. Default 600000. (async mode only) */
  pollTimeoutMs?: number;
}

// --- Schema ---

const transcriptionOptionsSchema = z.object({
  fileUrl: z.string().optional(),
  languageHints: z.array(z.string()).optional(),
  enableItn: z.boolean().optional(),
  enableWords: z.boolean().optional(),
  channelId: z.array(z.number()).optional(),
  pollIntervalMs: z.number().positive().optional(),
  pollTimeoutMs: z.number().positive().optional(),
});

// Short audio (sync) response via multimodal-generation
const syncResponseSchema = zodSchema(
  z.object({
    output: z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.array(
                  z.object({
                    text: z.string().optional(),
                  }),
                ),
              }),
            }),
          )
          .optional(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// Async task creation response
const createTaskSchema = zodSchema(
  z.object({
    output: z
      .object({
        task_id: z.string(),
        task_status: z.string(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// Async task status response
const taskStatusSchema = zodSchema(
  z.object({
    output: z
      .object({
        task_id: z.string(),
        task_status: z.string(),
        // qwen3-asr-flash-filetrans: result.transcription_url
        result: z
          .object({
            transcription_url: z.string().nullish(),
          })
          .nullish(),
        // fun-asr / paraformer: results array
        results: z
          .array(
            z.object({
              subtask_status: z.string().nullish(),
              transcription_url: z.string().nullish(),
            }),
          )
          .nullish(),
        code: z.string().nullish(),
        message: z.string().nullish(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// --- Helpers ---

function isAsyncModel(modelId: string): boolean {
  return (
    modelId.includes("filetrans") ||
    modelId.startsWith("fun-asr") ||
    modelId.startsWith("paraformer")
  );
}

function buildAudioUrl(audio: Uint8Array | string, mediaType: string): string {
  if (typeof audio === "string") {
    if (audio.startsWith("http")) return audio;
    return `data:${mediaType};base64,${audio}`;
  }
  return `data:${mediaType};base64,${uint8ArrayToBase64(audio)}`;
}

// --- Model ---

export class DashScopeTranscriptionModel implements TranscriptionModelV3 {
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

  async doGenerate(options: TranscriptionModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const dsOptions =
      (await parseProviderOptions<DashScopeTranscriptionOptions>({
        provider: "dashscope",
        providerOptions: options.providerOptions,
        schema: transcriptionOptionsSchema,
      })) ?? null;

    const asyncMode = isAsyncModel(this.modelId);

    // Use async endpoint only when a fileUrl is explicitly provided
    if (asyncMode && dsOptions?.fileUrl) {
      return this.doAsync(options, dsOptions, warnings);
    }
    return this.doSync(options, dsOptions, warnings);
  }

  private async doSync(
    options: TranscriptionModelV3CallOptions,
    dsOptions: DashScopeTranscriptionOptions | null,
    warnings: SharedV3Warning[],
  ) {
    const audioUrl = buildAudioUrl(options.audio, options.mediaType);

    const body: Record<string, unknown> = {
      model: this.modelId,
      input: {
        messages: [
          {
            role: "user",
            content: [{ audio: audioUrl }],
          },
        ],
      },
      parameters: {
        result_format: "message",
        ...(dsOptions?.enableItn != null && {
          asr_options: { enable_itn: dsOptions.enableItn },
        }),
      },
    };

    const { responseHeaders, value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/api/v1/services/aigc/multimodal-generation/generation`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: nativeFailedHandler,
      successfulResponseHandler: createJsonResponseHandler(syncResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const text =
      response.output?.choices?.[0]?.message.content
        .filter((p) => p.text != null)
        .map((p) => p.text!)
        .join("") ?? "";

    return {
      text,
      segments: [],
      language: undefined,
      durationInSeconds: undefined,
      warnings,
      request: { body },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }

  private async doAsync(
    options: TranscriptionModelV3CallOptions,
    dsOptions: DashScopeTranscriptionOptions | null,
    warnings: SharedV3Warning[],
  ) {
    const audioUrl = dsOptions?.fileUrl;
    if (!audioUrl) {
      throw new AISDKError({
        name: "DASHSCOPE_TRANSCRIPTION_ERROR",
        message:
          "Async transcription requires providerOptions.dashscope.fileUrl with a publicly accessible audio URL.",
      });
    }

    const parameters: Record<string, unknown> = {};
    if (dsOptions?.channelId != null) parameters.channel_id = dsOptions.channelId;
    if (dsOptions?.enableItn != null) parameters.enable_itn = dsOptions.enableItn;
    if (dsOptions?.enableWords != null) parameters.enable_words = dsOptions.enableWords;
    if (dsOptions?.languageHints?.length) {
      parameters.language_hints = dsOptions.languageHints;
    }

    // Step 1: Create task
    const { value: createResponse } = await postJsonToApi({
      url: `${this.config.baseURL}/api/v1/services/audio/asr/transcription`,
      headers: combineHeaders(this.config.headers(), options.headers, {
        "X-DashScope-Async": "enable",
      }),
      body: {
        model: this.modelId,
        input: { file_url: audioUrl },
        ...(Object.keys(parameters).length > 0 && { parameters }),
      },
      successfulResponseHandler: createJsonResponseHandler(createTaskSchema),
      failedResponseHandler: nativeFailedHandler,
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const taskId = createResponse.output?.task_id;
    if (!taskId) {
      throw new AISDKError({
        name: "DASHSCOPE_TRANSCRIPTION_ERROR",
        message: `No task_id returned. Response: ${JSON.stringify(createResponse)}`,
      });
    }

    // Step 2: Poll for completion
    const pollInterval = dsOptions?.pollIntervalMs ?? 5000;
    const pollTimeout = dsOptions?.pollTimeoutMs ?? 600000;
    const startTime = Date.now();

    while (true) {
      await delay(pollInterval, { abortSignal: options.abortSignal });

      if (Date.now() - startTime > pollTimeout) {
        throw new AISDKError({
          name: "DASHSCOPE_TRANSCRIPTION_TIMEOUT",
          message: `Transcription timed out after ${pollTimeout}ms`,
        });
      }

      const { value: status, responseHeaders } = await getFromApi({
        url: `${this.config.baseURL}/api/v1/tasks/${taskId}`,
        headers: combineHeaders(this.config.headers(), options.headers, {
          "X-DashScope-Async": "enable",
        }),
        successfulResponseHandler: createJsonResponseHandler(taskStatusSchema),
        failedResponseHandler: nativeFailedHandler,
        abortSignal: options.abortSignal,
        fetch: this.config.fetch,
      });

      const taskStatus = status.output?.task_status;

      if (taskStatus === "SUCCEEDED") {
        // qwen3-asr-flash-filetrans: output.result.transcription_url
        // fun-asr / paraformer: output.results[].transcription_url
        let transcriptionUrl: string | undefined | null = status.output?.result?.transcription_url;

        if (!transcriptionUrl) {
          const results = status.output?.results;
          const succeededResult = results?.find((r) => r.subtask_status === "SUCCEEDED");
          transcriptionUrl = succeededResult?.transcription_url;
        }

        if (!transcriptionUrl) {
          throw new AISDKError({
            name: "DASHSCOPE_TRANSCRIPTION_ERROR",
            message: `No transcription URL in response. Task ID: ${taskId}`,
          });
        }

        // Fetch the transcription result JSON from URL
        const resultResponse = await (this.config.fetch ?? fetch)(transcriptionUrl);
        const resultData = (await resultResponse.json()) as {
          transcripts?: Array<{
            text: string;
            sentences?: Array<{
              text: string;
              begin_time?: number | null;
              end_time?: number | null;
            }>;
          }>;
        };

        let text = "";
        const segments: Array<{
          text: string;
          startSecond: number;
          endSecond: number;
        }> = [];

        if (resultData.transcripts) {
          for (const transcript of resultData.transcripts) {
            text += transcript.text;
            if (transcript.sentences) {
              for (const sentence of transcript.sentences) {
                if (sentence.begin_time != null && sentence.end_time != null) {
                  segments.push({
                    text: sentence.text,
                    startSecond: sentence.begin_time / 1000,
                    endSecond: sentence.end_time / 1000,
                  });
                }
              }
            }
          }
        }

        return {
          text,
          segments,
          language: undefined,
          durationInSeconds: undefined,
          warnings,
          response: {
            timestamp: new Date(),
            modelId: this.modelId,
            headers: responseHeaders,
          },
        };
      }

      if (taskStatus === "FAILED" || taskStatus === "CANCELED") {
        throw new AISDKError({
          name: "DASHSCOPE_TRANSCRIPTION_FAILED",
          message: `Transcription ${taskStatus.toLowerCase()}. ${status.output?.message ?? ""}`,
        });
      }
    }
  }
}
