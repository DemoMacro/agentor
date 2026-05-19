import { defineHandler } from "h3";
import type { H3 } from "h3";
import type { Model } from "openai/resources/models";

import type { ServerContext } from "../../types";

export function registerModels(app: H3, context: ServerContext) {
  app.get(
    "/models",
    defineHandler(() => {
      const models = context.models ?? [];
      const data: Model[] = models.map((m) => {
        const cfg = typeof m === "string" ? { id: m } : m;
        return {
          id: cfg.id,
          object: "model" as const,
          created: cfg.created ?? 0,
          owned_by: cfg.owned_by ?? "",
        };
      });
      return { object: "list", data };
    }),
  );
}
