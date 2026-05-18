import { H3, serve } from "h3";

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
  };

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
