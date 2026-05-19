import { generateImage } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type {
  Image as ImageData,
  ImageEditParamsBase,
  ImagesResponse,
} from "openai/resources/images";

import type { ServerContext } from "../../types";
import { convertImageUsage } from "../../utils";

type RequestBody = ImageEditParamsBase & Record<string, unknown>;

export function registerImageEdits(app: H3, context: ServerContext) {
  app.post(
    "/images/edits",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as RequestBody;
      if (!body.model || !body.prompt || !body.image) {
        throw new HTTPError({
          status: 400,
          message: "Missing required fields: model, prompt, image",
        });
      }

      const model = context.registry.imageModel(body.model as never);

      // JSON body sends base64 strings; validate type
      const image = typeof body.image === "string" ? body.image : undefined;
      if (!image) {
        throw new HTTPError({
          status: 400,
          message: "image must be a base64 string",
        });
      }
      const mask = typeof body.mask === "string" ? body.mask : undefined;

      const size =
        body.size != null && /^\d+x\d+$/.test(body.size)
          ? (body.size as `${number}x${number}`)
          : undefined;

      const result = await generateImage({
        model,
        prompt: {
          text: body.prompt,
          images: [image],
          mask,
        },
        n: body.n ?? undefined,
        size,
        providerOptions: body.providerOptions as Parameters<
          typeof generateImage
        >[0]["providerOptions"],
      });

      const data: ImageData[] = result.images.map((img, i) => {
        const meta = (
          Object.values(result.providerMetadata ?? {})[0] as
            | { images?: Array<Record<string, unknown>> }
            | undefined
        )?.images?.[i];
        return {
          b64_json: img.base64,
          revised_prompt: typeof meta?.revisedPrompt === "string" ? meta.revisedPrompt : undefined,
        };
      });

      const response: ImagesResponse = {
        created: Math.floor(result.responses[0]?.timestamp?.getTime() ?? Date.now() / 1000),
        data,
        usage: convertImageUsage(result.usage),
      };
      return response;
    }),
  );
}
