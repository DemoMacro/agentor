import type { ModelInfo } from "@anthropic-ai/sdk/resources/models";
import { defineHandler } from "h3";
import type { H3 } from "h3";

import type { ServerContext } from "../../types";

export function registerModels(app: H3, context: ServerContext) {
  app.get(
    "/models",
    defineHandler(() => {
      const models = context.models ?? [];
      const data: ModelInfo[] = models.map((m) => {
        const cfg = typeof m === "string" ? { id: m } : m;
        return {
          id: cfg.id,
          type: "model" as const,
          display_name: cfg.display_name ?? cfg.id,
          created_at: cfg.created
            ? new Date(cfg.created * 1000).toISOString()
            : new Date(0).toISOString(),
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
        };
      });
      const ids = models.map((m) => (typeof m === "string" ? m : m.id));
      return {
        data,
        has_more: false,
        first_id: ids[0] ?? null,
        last_id: ids[ids.length - 1] ?? null,
      };
    }),
  );
}
