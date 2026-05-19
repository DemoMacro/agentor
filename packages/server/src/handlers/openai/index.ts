import type { H3 } from "h3";

import type { ServerContext } from "../../types";
import { type HandlerFactory } from "../utils";
import { registerChatCompletions } from "./chat-completions";
import { registerEmbeddings } from "./embeddings";
import { registerModels } from "./models";

export type {
  convertMessages,
  convertParams,
  convertUsage,
  buildCompletion,
  buildChunk,
} from "./chat-completions";

export interface OpenAIHandlerOptions {}

const handler: HandlerFactory<OpenAIHandlerOptions> = () => ({
  name: "openai",
  path: "/v1",
  register(app: H3, context: ServerContext) {
    registerChatCompletions(app, context);
    registerEmbeddings(app, context);
    registerModels(app, context);
  },
});

export default handler;
