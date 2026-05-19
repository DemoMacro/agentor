import { generateImage, type ImageModelUsage } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import type {
  Image as ImageData,
  ImageGenerateParamsBase,
  ImagesResponse,
} from "openai/resources/images";

import type { ServerContext } from "../../types";

type RequestBody = ImageGenerateParamsBase & Record<string, unknown>;

function convertUsage(usage: ImageModelUsage): ImagesResponse.Usage {
  return {
    input_tokens: usage.inputTokens ?? 0,
    input_tokens_details: { image_tokens: 0, text_tokens: 0 },
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
  };
}

function inferOutputFormat(mediaType: string | undefined): ImagesResponse["output_format"] {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpeg";
  if (mediaType === "image/webp") return "webp";
  return undefined;
}

export function registerImages(app: H3, context: ServerContext) {
  app.post(
    "/images/generations",
    defineHandler(async (event) => {
      try {
        const body = (await event.req.json()) as RequestBody;
        if (!body.model || !body.prompt) {
          event.res.status = 400;
          return {
            error: {
              message: "Missing required fields: model, prompt",
              type: "invalid_request_error",
            },
          };
        }

        const model = context.registry.imageModel(body.model as never);

        // AI SDK expects "WxH" format, filter out non-matching values like "auto"
        const size =
          body.size != null && /^\d+x\d+$/.test(body.size)
            ? (body.size as `${number}x${number}`)
            : undefined;

        const result = await generateImage({
          model,
          prompt: body.prompt,
          n: body.n ?? undefined,
          size,
          providerOptions: body.providerOptions as Parameters<
            typeof generateImage
          >[0]["providerOptions"],
        });

        const data: ImageData[] = result.images.map((img) => ({
          b64_json: img.base64,
        }));

        const response: ImagesResponse = {
          created: Math.floor(result.responses[0]?.timestamp?.getTime() ?? Date.now() / 1000),
          data,
          output_format: inferOutputFormat(result.images[0]?.mediaType),
          usage: convertUsage(result.usage),
        };
        return response;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        event.res.status = 500;
        return { error: { message, type: "internal_error" } };
      }
    }),
  );
}
