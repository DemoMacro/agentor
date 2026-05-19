import type { BatchCreateParams, MessageBatch } from "@anthropic-ai/sdk/resources/messages/batches";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { generateText } from "ai";
import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";

import { buildBatchKey, buildBatchResultsKey } from "../../storage";
import type { ServerContext } from "../../types";
import { generateId } from "../../utils";
import type { BatchItem, BatchItemExecutor } from "../batch-worker";
import { startBatchWorker } from "../batch-worker";
import { convertMessages, convertParams, convertUsage, mapStopReason } from "./messages";

function createAnthropicExecutor(): BatchItemExecutor {
  return async (item, context) => {
    const params = item.body as unknown as MessageCreateParamsNonStreaming;
    const model = context.registry.languageModel(params.model as string as never);
    const { messages, system } = convertMessages(params as never);
    const extra = convertParams(params as never);

    const result = await generateText({ model, system, messages, ...extra });

    const content: Array<{ type: "text"; text: string }> = [];
    if (result.text) content.push({ type: "text", text: result.text });

    return {
      status_code: 200,
      body: {
        type: "succeeded" as const,
        message: {
          id: generateId("msg"),
          type: "message",
          role: "assistant",
          content,
          model: params.model,
          stop_reason: mapStopReason(result.finishReason),
          stop_sequence: null,
          usage: convertUsage(result.usage),
        },
      },
    };
  };
}

export function registerMessageBatches(app: H3, context: ServerContext) {
  // POST /messages/batches — create
  app.post(
    "/messages/batches",
    defineHandler(async (event) => {
      const body = (await event.req.json()) as BatchCreateParams;

      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const batch: MessageBatch = {
        id: generateId("msgbatch"),
        type: "message_batch",
        processing_status: "in_progress",
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
        cancel_initiated_at: null,
        ended_at: null,
        archived_at: null,
        results_url: null,
        request_counts: {
          processing: body.requests.length,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
      };

      await context.storage!.setItem(buildBatchKey(batch.id), batch);

      const items: BatchItem[] = body.requests.map((r) => ({
        custom_id: r.custom_id,
        body: r.params as unknown as Record<string, unknown>,
      }));

      const executor = createAnthropicExecutor();
      startBatchWorker(batch.id, items, executor, context);

      return batch;
    }),
  );

  // GET /messages/batches — list
  app.get(
    "/messages/batches",
    defineHandler(async () => {
      const keys = await context.storage!.getKeys("batch:");
      const batchKeys = keys.filter((k) => !k.includes(":results"));
      const data: MessageBatch[] = [];
      for (const key of batchKeys) {
        const batch = await context.storage!.getItem<MessageBatch>(key);
        if (batch && "processing_status" in batch) data.push(batch);
      }
      return { data, has_more: false, object: "list" };
    }),
  );

  // GET /messages/batches/:id — retrieve
  app.get(
    "/messages/batches/:id",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<MessageBatch>(buildBatchKey(id));
      if (!batch || !("processing_status" in batch)) {
        throw new HTTPError({ status: 404, message: `Message batch ${id} not found` });
      }
      return batch;
    }),
  );

  // POST /messages/batches/:id/cancel — cancel
  app.post(
    "/messages/batches/:id/cancel",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<MessageBatch>(buildBatchKey(id));
      if (!batch || !("processing_status" in batch)) {
        throw new HTTPError({ status: 404, message: `Message batch ${id} not found` });
      }
      batch.processing_status = "canceling";
      batch.cancel_initiated_at = new Date().toISOString();
      await context.storage!.setItem(buildBatchKey(id), batch);
      return batch;
    }),
  );

  // DELETE /messages/batches/:id — delete
  app.delete(
    "/messages/batches/:id",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<MessageBatch>(buildBatchKey(id));
      if (!batch || !("processing_status" in batch)) {
        throw new HTTPError({ status: 404, message: `Message batch ${id} not found` });
      }
      await context.storage!.remove(buildBatchKey(id));
      await context.storage!.remove(buildBatchResultsKey(id));
      return { id, type: "message_batch_deleted" as const };
    }),
  );

  // GET /messages/batches/:id/results — results JSONL
  app.get(
    "/messages/batches/:id/results",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const batch = await context.storage!.getItem<MessageBatch>(buildBatchKey(id));
      if (!batch || !("processing_status" in batch)) {
        throw new HTTPError({ status: 404, message: `Message batch ${id} not found` });
      }

      const results = await context.storage!.getItem<
        Array<{
          custom_id: string;
          response: { status_code: number; body: Record<string, unknown> };
          error: string | null;
        }>
      >(buildBatchResultsKey(id));

      if (!results) {
        return new Response("", {
          headers: { "Content-Type": "application/jsonl" },
        });
      }

      const lines = results.map((r) =>
        JSON.stringify({
          custom_id: r.custom_id,
          result: r.error
            ? { type: "errored", error: { type: "api_error", message: r.error } }
            : r.response.body,
        }),
      );

      return new Response(lines.join("\n"), {
        headers: { "Content-Type": "application/jsonl" },
      });
    }),
  );
}
