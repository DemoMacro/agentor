import { experimental_generateSpeech as generateSpeech } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import type { SpeechCreateParams } from "openai/resources/audio/speech";

import type { ServerContext } from "../../types";

type RequestBody = SpeechCreateParams & Record<string, unknown>;

export function registerSpeech(app: H3, context: ServerContext) {
  app.post(
    "/audio/speech",
    defineHandler(async (event) => {
      try {
        const body = (await event.req.json()) as RequestBody;
        if (!body.model || !body.input) {
          event.res.status = 400;
          return {
            error: {
              message: "Missing required fields: model, input",
              type: "invalid_request_error",
            },
          };
        }

        const model = context.registry.speechModel(body.model as never);

        const result = await generateSpeech({
          model,
          text: body.input,
          voice: typeof body.voice === "string" ? body.voice : undefined,
          outputFormat: body.response_format ?? undefined,
          speed: body.speed ?? undefined,
          providerOptions: body.providerOptions as Parameters<
            typeof generateSpeech
          >[0]["providerOptions"],
        });

        return new Response(new Uint8Array(result.audio.uint8Array), {
          headers: {
            "Content-Type": result.audio.mediaType ?? "audio/mpeg",
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        event.res.status = 500;
        return { error: { message, type: "internal_error" } };
      }
    }),
  );
}
