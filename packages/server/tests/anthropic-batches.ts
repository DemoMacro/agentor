import { createDashScope } from "@agentor/dashscope";
import { createProviderRegistry } from "ai";

import { createServer, anthropicHandler } from "../src";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 30_000;

type BatchResponse = {
  id: string;
  type: string;
  processing_status: string;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  results_url: string | null;
};

// --- Setup ---

function setupServer() {
  const dashscope = createDashScope({ apiKey: DASHSCOPE_API_KEY });
  const registry = createProviderRegistry({ dashscope });

  return createServer({
    registry,
    handlers: [anthropicHandler()],
    models: ["dashscope:qwen3.5-flash"],
  });
}

async function poll<T>(fn: () => Promise<T>, predicate: (result: T) => boolean): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    const result = await fn();
    if (!predicate(result)) return result;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Polling timed out after ${POLL_TIMEOUT}ms`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Test: Message Batch full lifecycle ---

async function testMessageBatch() {
  console.log("=== Anthropic Message Batches: Full Lifecycle ===");
  const { app } = setupServer();

  // Create batch
  const createRes = await app.fetch(
    new Request("http://localhost/v1/messages/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            custom_id: "req-1",
            params: {
              model: "dashscope:qwen3.5-flash",
              max_tokens: 50,
              messages: [{ role: "user", content: "Say hello" }],
            },
          },
          {
            custom_id: "req-2",
            params: {
              model: "dashscope:qwen3.5-flash",
              max_tokens: 50,
              messages: [{ role: "user", content: "Say goodbye" }],
            },
          },
        ],
      }),
    }),
  );
  assert(createRes.status === 200, `Create should return 200, got ${createRes.status}`);
  const batch = (await createRes.json()) as BatchResponse;
  console.log("  Created batch:", batch.id, "status:", batch.processing_status);
  assert(batch.type === "message_batch", "type should be 'message_batch'");
  assert(batch.processing_status === "in_progress", "initial status should be in_progress");
  assert(batch.request_counts.processing === 2, "should have 2 processing requests");

  // Poll until ended
  const completed = await poll(
    async () => {
      const res = await app.fetch(new Request(`http://localhost/v1/messages/batches/${batch.id}`));
      return (await res.json()) as BatchResponse;
    },
    (b) => b.processing_status !== "ended",
  );
  console.log("  Final status:", completed.processing_status, "counts:", completed.request_counts);
  assert(
    completed.processing_status === "ended",
    `Batch should end, got status: ${completed.processing_status}`,
  );
  assert(
    completed.request_counts.succeeded === 2,
    `Should have 2 succeeded, got ${completed.request_counts.succeeded}`,
  );
  assert(
    completed.request_counts.errored === 0,
    `Should have 0 errored, got ${completed.request_counts.errored}`,
  );

  // Verify results
  assert(completed.results_url != null, "ended batch should have results_url");
  const resultsRes = await app.fetch(new Request(`http://localhost${completed.results_url}`));
  assert(resultsRes.status === 200, "results should be accessible");
  const resultsText = await resultsRes.text();
  const lines = resultsText.split("\n").filter((l) => l.trim());
  assert(lines.length === 2, `results should have 2 lines, got ${lines.length}`);

  for (const line of lines) {
    const result = JSON.parse(line) as {
      custom_id: string;
      result: { type: string; message?: { content?: Array<{ type: string; text?: string }> } };
    };
    assert(
      result.result.type === "succeeded",
      `result ${result.custom_id} should be succeeded, got ${result.result.type}`,
    );
    assert(
      result.result.message?.content?.length != null && result.result.message.content.length > 0,
      `result ${result.custom_id} should have content`,
    );
    const content = result.result.message?.content?.map((b) => b.text).join("") ?? "(empty)";
    console.log("  Result:", result.custom_id, "->", content);
  }

  // List batches
  const listRes = await app.fetch(new Request("http://localhost/v1/messages/batches"));
  const list = (await listRes.json()) as { data: BatchResponse[] };
  assert(
    list.data.some((b) => b.id === batch.id),
    "batch should appear in list",
  );

  // Delete batch
  const deleteRes = await app.fetch(
    new Request(`http://localhost/v1/messages/batches/${batch.id}`, { method: "DELETE" }),
  );
  assert(deleteRes.status === 200, `DELETE should return 200, got ${deleteRes.status}`);
  const deleted = (await deleteRes.json()) as { id: string; type: string };
  assert(
    deleted.type === "message_batch_deleted",
    "delete response type should be message_batch_deleted",
  );

  // Verify deleted
  const afterDelete = await app.fetch(
    new Request(`http://localhost/v1/messages/batches/${batch.id}`),
  );
  assert(afterDelete.status === 404, "deleted batch should return 404");

  console.log("  All tests passed.\n");
}

// --- Run ---

async function main() {
  try {
    await testMessageBatch();
    console.log("All tests passed!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

void main();
