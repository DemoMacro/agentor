import type {
  Experimental_VideoModelV4 as VideoModelV4,
  Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  SharedV4Warning,
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

export interface DashScopeVideoOptions {
  /** Negative prompt. */
  negativePrompt?: string;
  /** Enable prompt extension. */
  promptExtend?: boolean;
  /** Add watermark. Default false. */
  watermark?: boolean;
  /** Resolution for I2V: "720P" | "1080P". For T2V: use size "WIDTH*HEIGHT". */
  resolution?: string;
  /** Size in "WIDTH*HEIGHT" format (T2V/R2V). */
  size?: string;
  /** Video duration in seconds. */
  duration?: number;
  /** Polling interval in ms. Default 5000. */
  pollIntervalMs?: number;
  /** Polling timeout in ms. Default 600000. */
  pollTimeoutMs?: number;
}

// --- Schema ---

const videoOptionsSchema = z.object({
  negativePrompt: z.string().optional(),
  promptExtend: z.boolean().optional(),
  watermark: z.boolean().optional(),
  resolution: z.string().optional(),
  size: z.string().optional(),
  duration: z.number().optional(),
  pollIntervalMs: z.number().positive().optional(),
  pollTimeoutMs: z.number().positive().optional(),
});

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

const taskStatusSchema = zodSchema(
  z.object({
    output: z
      .object({
        task_id: z.string(),
        task_status: z.string(),
        video_url: z.string().nullish(),
        submit_time: z.string().nullish(),
        scheduled_time: z.string().nullish(),
        end_time: z.string().nullish(),
        code: z.string().nullish(),
        message: z.string().nullish(),
      })
      .nullish(),
    usage: z
      .object({
        duration: z.number().nullish(),
        output_video_duration: z.number().nullish(),
        size: z.string().nullish(),
      })
      .nullish(),
    request_id: z.string().nullish(),
  }),
);

// --- Model ---

function detectMode(modelId: string): "t2v" | "i2v" {
  return modelId.includes("-i2v") ? "i2v" : "t2v";
}

export class DashScopeVideoModel implements VideoModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly modelId: string;
  private readonly config: DashScopeConfig;

  constructor(modelId: string, config: DashScopeConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get maxVideosPerCall(): number | undefined {
    return 1;
  }

  async doGenerate(options: VideoModelV4CallOptions) {
    const warnings: SharedV4Warning[] = [];
    const mode = detectMode(this.modelId);

    const dsOptions = await parseProviderOptions<DashScopeVideoOptions>({
      provider: "dashscope",
      providerOptions: options.providerOptions,
      schema: videoOptionsSchema,
    });

    const input: Record<string, unknown> = {};
    if (options.prompt != null) {
      input.prompt = options.prompt;
    }
    if (dsOptions?.negativePrompt != null) {
      input.negative_prompt = dsOptions.negativePrompt;
    }
    // I2V: image input
    if (mode === "i2v" && options.image != null) {
      if (options.image.type === "url") {
        input.img_url = options.image.url;
      } else {
        input.img_url =
          typeof options.image.data === "string"
            ? options.image.data
            : uint8ArrayToBase64(options.image.data);
      }
    }

    const parameters: Record<string, unknown> = {};
    if (dsOptions?.duration != null) parameters.duration = dsOptions.duration;
    if (options.seed != null) parameters.seed = options.seed;
    if (dsOptions?.promptExtend != null) parameters.prompt_extend = dsOptions.promptExtend;
    if (dsOptions?.watermark != null) parameters.watermark = dsOptions.watermark;
    if (mode === "i2v" && dsOptions?.resolution != null) {
      parameters.resolution = dsOptions.resolution;
    } else if (options.resolution != null) {
      parameters.size = options.resolution.replace("x", "*");
    } else if (dsOptions?.size != null) {
      parameters.size = dsOptions.size;
    }

    // Step 1: Create task
    const { value: createResponse } = await postJsonToApi({
      url: `${this.config.baseURL}/api/v1/services/aigc/video-generation/video-synthesis`,
      headers: combineHeaders(this.config.headers(), options.headers, {
        "X-DashScope-Async": "enable",
      }),
      body: { model: this.modelId, input, parameters },
      successfulResponseHandler: createJsonResponseHandler(createTaskSchema),
      failedResponseHandler: nativeFailedHandler,
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const taskId = createResponse.output?.task_id;
    if (!taskId) {
      throw new AISDKError({
        name: "DASHSCOPE_VIDEO_ERROR",
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
          name: "DASHSCOPE_VIDEO_TIMEOUT",
          message: `Video generation timed out after ${pollTimeout}ms`,
        });
      }

      const { value: status, responseHeaders } = await getFromApi({
        url: `${this.config.baseURL}/api/v1/tasks/${taskId}`,
        headers: combineHeaders(this.config.headers(), options.headers),
        successfulResponseHandler: createJsonResponseHandler(taskStatusSchema),
        failedResponseHandler: nativeFailedHandler,
        abortSignal: options.abortSignal,
        fetch: this.config.fetch,
      });

      const taskStatus = status.output?.task_status;

      if (taskStatus === "SUCCEEDED") {
        const videoUrl = status.output?.video_url;
        if (!videoUrl) {
          throw new AISDKError({
            name: "DASHSCOPE_VIDEO_ERROR",
            message: `No video URL in response. Task ID: ${taskId}`,
          });
        }
        return {
          videos: [{ type: "url" as const, url: videoUrl, mediaType: "video/mp4" }],
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
          name: "DASHSCOPE_VIDEO_FAILED",
          message: `Video generation ${taskStatus.toLowerCase()}. ${status.output?.message ?? ""}`,
        });
      }
    }
  }
}
