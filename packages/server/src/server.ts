import { H3, HTTPError, onError, serve } from "h3";
import { createStorage } from "unstorage";

import type { ServerContext, ServerOptions } from "./types";

export interface ServerInstance {
  app: H3;
  listen(port?: number, hostname?: string): Promise<void>;
}

export function createServer(options: ServerOptions): ServerInstance {
  const app = new H3();
  const context: ServerContext = {
    registry: options.registry,
    models: options.models,
    fetch: options.fetch,
    storage: options.storage ?? createStorage(),
  };

  app.use(
    onError((error, event) => {
      if (error instanceof HTTPError) {
        event.res.status = error.status;
        const data = error.data as Record<string, unknown> | undefined;
        const errorType = (data?.errorType as string) ?? "invalid_request_error";

        if (data?.format === "anthropic") {
          return {
            type: "error",
            error: { type: errorType, message: error.message },
          };
        }

        return {
          error: { message: error.message, type: errorType },
        };
      }
      event.res.status = 500;
      const err = error as unknown;
      return {
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: "internal_error",
        },
      };
    }),
  );

  for (const handler of options.handlers) {
    const sub = new H3();
    handler.register(sub, context);
    app.use(handler.path, sub);
  }

  return {
    app,
    async listen(port = 3000, hostname = "localhost") {
      serve(app, { port, hostname });
    },
  };
}
