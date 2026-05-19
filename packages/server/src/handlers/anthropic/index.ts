import type { H3 } from "h3";

import type { ServerContext } from "../../types";
import { type HandlerFactory } from "../../utils";
import { registerMessages } from "./messages";
import { registerModels } from "./models";

export type { convertMessages, convertParams, convertUsage, mapStopReason } from "./messages";

export interface AnthropicHandlerOptions {}

const handler: HandlerFactory<AnthropicHandlerOptions> = () => ({
  name: "anthropic",
  path: "/v1",
  register(app: H3, context: ServerContext) {
    registerMessages(app, context);
    registerModels(app, context);
  },
});

export default handler;
