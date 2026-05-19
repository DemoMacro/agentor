import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type { Batch, BatchCreateParams } from "openai/resources/batches";

import { buildBatchKey } from "../../storage";
import type { ServerContext } from "../../types";
import { generateId } from "../../utils";
import { startBatchWorker, createOpenAIExecutor } from "../batch-worker";
import type { BatchItem } from "../batch-worker";

interface BatchRequestLine {
  custom_id: string;
  method: string;
  url: string;
  body: Record<string, unknown>;
}

function buildBatch(params: BatchCreateParams): Batch {
  return {
    id: generateId("batch"),
    completion_window: params.completion_window,
    created_at: Math.floor(Date.now() / 1000),
    endpoint: params.endpoint,
    input_file_id: params.input_file_id,
    object: "batch",
    status: "validating",
    metadata: params.metadata ?? null,
  };
}

export function registerBatches(app: H3, context: ServerContext) {
  // POST /batches — create
  app.post(
    "/batches",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as BatchCreateParams;

      // Validate input file
      const fileContent = await context.storage!.getItem<string>(`file:${body.input_file_id}`);
      if (!fileContent) {
        throw new HTTPError({ status: 400, message: `File ${body.input_file_id} not found` });
      }

      const batch = buildBatch(body);
      await context.storage!.setItem(buildBatchKey(batch.id), batch);

      // Parse JSONL items
      const items: BatchItem[] = fileContent
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as BatchRequestLine)
        .map((line) => ({ custom_id: line.custom_id, body: line.body }));

      // Start background worker
      const executor = createOpenAIExecutor(body.endpoint);
      startBatchWorker(batch.id, items, executor, context);

      return batch;
    }),
  );

  // GET /batches — list
  app.get(
    "/batches",
    defineHandler(async () => {
      const keys = await context.storage!.getKeys("batch:");
      const batchKeys = keys.filter((k) => !k.includes(":results"));
      const data: Batch[] = [];
      for (const key of batchKeys) {
        const batch = await context.storage!.getItem<Batch>(key);
        if (batch) data.push(batch);
      }
      return { object: "list", data };
    }),
  );

  // GET /batches/:id — retrieve
  app.get(
    "/batches/:id",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<Batch>(buildBatchKey(id));
      if (!batch) {
        throw new HTTPError({ status: 404, message: `Batch ${id} not found` });
      }
      return batch;
    }),
  );

  // POST /batches/:id/cancel — cancel
  app.post(
    "/batches/:id/cancel",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<Batch>(buildBatchKey(id));
      if (!batch) {
        throw new HTTPError({ status: 404, message: `Batch ${id} not found` });
      }
      batch.status = "cancelling";
      batch.cancelling_at = Math.floor(Date.now() / 1000);
      await context.storage!.setItem(buildBatchKey(id), batch);
      return batch;
    }),
  );
}
