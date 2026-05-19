import type { H3 } from "h3";

import type { ServerContext } from "../../types";
import { type HandlerFactory } from "../../utils";
import { registerChatCompletions } from "./chat-completions";
import { registerCompletions } from "./completions";
import { registerEmbeddings } from "./embeddings";
import { registerImageEdits } from "./image-edits";
import { registerImages } from "./images";
import { registerModels } from "./models";
import { registerRerank } from "./rerank";
import { registerResponses } from "./responses";
import { registerSpeech } from "./speech";
import { registerTranscriptions } from "./transcriptions";

export type {
  convertMessages,
  convertParams,
  convertUsage,
  buildCompletion,
  buildChunk,
} from "../../utils";

export interface OpenAIHandlerOptions {}

const handler: HandlerFactory<OpenAIHandlerOptions> = () => ({
  name: "openai",
  path: "/v1",
  register(app: H3, context: ServerContext) {
    registerChatCompletions(app, context);
    registerCompletions(app, context);
    registerEmbeddings(app, context);
    registerImageEdits(app, context);
    registerImages(app, context);
    registerModels(app, context);
    registerRerank(app, context);
    registerResponses(app, context);
    registerSpeech(app, context);
    registerTranscriptions(app, context);
  },
});

export default handler;
