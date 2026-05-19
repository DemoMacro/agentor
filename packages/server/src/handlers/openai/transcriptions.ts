import { experimental_transcribe as transcribe } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import type {
  Transcription,
  TranscriptionCreateParamsBase,
} from "openai/resources/audio/transcriptions";

import type { ServerContext } from "../../types";

type RequestBody = TranscriptionCreateParamsBase & Record<string, unknown>;

export function registerTranscriptions(app: H3, context: ServerContext) {
  app.post(
    "/audio/transcriptions",
    defineHandler(async (event) => {
      try {
        const body = (await event.req.json()) as RequestBody;
        if (!body.model) {
          event.res.status = 400;
          return {
            error: {
              message: "Missing required fields: model",
              type: "invalid_request_error",
            },
          };
        }

        const model = context.registry.transcriptionModel(body.model as never);
        const url = (body as Record<string, unknown>).url as string | undefined;
        const audio = url ? new URL(url) : new Uint8Array();
        const result = await transcribe({
          model,
          audio,
          providerOptions: body.providerOptions as Parameters<
            typeof transcribe
          >[0]["providerOptions"],
        });

        const response: Transcription = { text: result.text };
        return response;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        event.res.status = 500;
        return { error: { message, type: "internal_error" } };
      }
    }),
  );
}
