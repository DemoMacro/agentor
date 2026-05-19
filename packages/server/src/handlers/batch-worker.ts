import { embed, generateText } from "ai";

import { buildBatchKey, buildBatchResultsKey, buildFileKey, buildFileMetaKey } from "../storage";
import type { ServerContext } from "../types";
import { buildCompletion, convertMessages, convertParams, generateId } from "../utils";

const BATCH_CONCURRENCY = 5;

// --- Types ---

export interface BatchItem {
  custom_id: string;
  body: Record<string, unknown>;
}

export interface BatchResult {
  custom_id: string;
  response: { status_code: number; body: Record<string, unknown> };
  error: string | null;
}

export type BatchItemExecutor = (
  item: BatchItem,
  context: ServerContext,
) => Promise<{ status_code: number; body: Record<string, unknown> }>;

// --- Main entry point ---

export function startBatchWorker(
  batchId: string,
  items: BatchItem[],
  executor: BatchItemExecutor,
  context: ServerContext,
  onProgress?: (batchId: string, completed: number, failed: number, total: number) => Promise<void>,
): void {
  runWorker(batchId, items, executor, context, onProgress).catch(async () => {
    const batch = await context.storage!.getItem<Record<string, unknown>>(buildBatchKey(batchId));
    if (batch) {
      batch.status = "failed";
      batch.failed_at = Math.floor(Date.now() / 1000);
      await context.storage!.setItem(buildBatchKey(batchId), batch);
    }
  });
}

// --- Worker with concurrency control ---

async function runWorker(
  batchId: string,
  items: BatchItem[],
  executor: BatchItemExecutor,
  context: ServerContext,
  onProgress?: (batchId: string, completed: number, failed: number, total: number) => Promise<void>,
): Promise<void> {
  const total = items.length;
  let completed = 0;
  let failed = 0;
  const results: BatchResult[] = [];
  const pending = [...items];
  const active = new Set<Promise<void>>();

  const batch = await context.storage!.getItem<Record<string, unknown>>(buildBatchKey(batchId));
  const isAnthropic = batch != null && "processing_status" in batch;
  if (batch) {
    if (isAnthropic) {
      batch.request_counts = {
        processing: total,
        succeeded: 0,
        errored: 0,
        canceled: 0,
        expired: 0,
      };
    } else {
      batch.status = "in_progress";
      batch.in_progress_at = Math.floor(Date.now() / 1000);
      batch.request_counts = { total, completed: 0, failed: 0 };
    }
    await context.storage!.setItem(buildBatchKey(batchId), batch);
  }

  async function processOne(item: BatchItem): Promise<void> {
    try {
      const result = await executor(item, context);
      completed++;
      results.push({ custom_id: item.custom_id, response: result, error: null });
    } catch {
      failed++;
      results.push({
        custom_id: item.custom_id,
        response: { status_code: 500, body: {} },
        error: "Internal error",
      });
    }

    if (onProgress) {
      await onProgress(batchId, completed, failed, total);
    } else {
      const current = await context.storage!.getItem<Record<string, unknown>>(
        buildBatchKey(batchId),
      );
      if (current) {
        current.request_counts = isAnthropic
          ? {
              processing: total - completed - failed,
              succeeded: completed,
              errored: failed,
              canceled: 0,
              expired: 0,
            }
          : { total, completed, failed };
        await context.storage!.setItem(buildBatchKey(batchId), current);
      }
    }

    // Check for cancellation
    const latest = await context.storage!.getItem<Record<string, unknown>>(buildBatchKey(batchId));
    if (latest?.status === "cancelling" || latest?.processing_status === "canceling") {
      pending.length = 0;
    }
  }

  while (pending.length > 0 || active.size > 0) {
    while (active.size < BATCH_CONCURRENCY && pending.length > 0) {
      const item = pending.shift()!;
      const p = processOne(item).then(() => {
        active.delete(p);
      });
      active.add(p);
    }

    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  // Store results
  await context.storage!.setItem(buildBatchResultsKey(batchId), results);

  // Finalize batch
  const finalBatch = await context.storage!.getItem<Record<string, unknown>>(
    buildBatchKey(batchId),
  );
  if (finalBatch) {
    // OpenAI style
    if ("status" in finalBatch) {
      finalBatch.status = "finalizing";
      finalBatch.finalizing_at = Math.floor(Date.now() / 1000);
      await context.storage!.setItem(buildBatchKey(batchId), finalBatch);

      // Create output file
      const outputId = generateId("file");
      const outputLines = results
        .filter((r) => !r.error)
        .map((r) =>
          JSON.stringify({
            id: generateId("batch-resp"),
            custom_id: r.custom_id,
            response: r.response,
            error: null,
          }),
        )
        .join("\n");
      await context.storage!.setItem(buildFileKey(outputId), outputLines);
      await context.storage!.setItem(buildFileMetaKey(outputId), {
        id: outputId,
        bytes: outputLines.length,
        created_at: Math.floor(Date.now() / 1000),
        filename: `${batchId}_output.jsonl`,
        object: "file",
        purpose: "batch_output",
        status: "processed",
      });

      // Create error file if needed
      const errorResults = results.filter((r) => r.error);
      if (errorResults.length > 0) {
        const errorId = generateId("file");
        const errorLines = errorResults
          .map((r) =>
            JSON.stringify({
              id: generateId("batch-resp"),
              custom_id: r.custom_id,
              response: r.response,
              error: r.error,
            }),
          )
          .join("\n");
        await context.storage!.setItem(buildFileKey(errorId), errorLines);
        await context.storage!.setItem(buildFileMetaKey(errorId), {
          id: errorId,
          bytes: errorLines.length,
          created_at: Math.floor(Date.now() / 1000),
          filename: `${batchId}_errors.jsonl`,
          object: "file",
          purpose: "batch_output",
          status: "processed",
        });
        finalBatch.error_file_id = errorId;
      }

      finalBatch.status = "completed";
      finalBatch.completed_at = Math.floor(Date.now() / 1000);
      finalBatch.output_file_id = outputId;
      finalBatch.request_counts = { total, completed, failed };
      await context.storage!.setItem(buildBatchKey(batchId), finalBatch);
    }
    // Anthropic style
    else if ("processing_status" in finalBatch) {
      finalBatch.processing_status = "ended";
      finalBatch.ended_at = new Date().toISOString();
      finalBatch.request_counts = {
        processing: 0,
        succeeded: completed,
        errored: failed,
        canceled: 0,
        expired: 0,
      };
      finalBatch.results_url = `/v1/messages/batches/${batchId}/results`;
      await context.storage!.setItem(buildBatchKey(batchId), finalBatch);
    }
  }
}

// --- OpenAI Executor ---

export function createOpenAIExecutor(endpoint: string): BatchItemExecutor {
  return async (item, context) => {
    const body = item.body;

    if (endpoint === "/v1/chat/completions") {
      const model = context.registry.languageModel(body.model as string as never);
      const messages = convertMessages((body.messages ?? []) as never);
      const params = convertParams(body as never);
      const result = await generateText({ model, messages, ...params });
      return {
        status_code: 200,
        body: buildCompletion(
          generateId("chatcmpl"),
          body.model as string,
          result.text,
          result.finishReason,
          result.usage,
        ),
      } as unknown as { status_code: number; body: Record<string, unknown> };
    }

    if (endpoint === "/v1/embeddings") {
      const model = context.registry.embeddingModel(body.model as string as never);
      const input = (body.input ?? []) as string[];
      const result = await embed({ model, value: input[0] ?? "" });
      return {
        status_code: 200,
        body: {
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: result.embedding }],
          model: body.model,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        },
      };
    }

    return { status_code: 400, body: { error: { message: `Unsupported endpoint: ${endpoint}` } } };
  };
}
