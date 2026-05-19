import { createDashScope } from "@agentor/dashscope";
import { createProviderRegistry } from "ai";

import { createServer, openaiHandler } from "../src";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 30_000;

type FileResponse = {
  id: string;
  object: string;
  bytes: number;
  filename: string;
  purpose: string;
  status: string;
};
type BatchResponse = {
  id: string;
  object: string;
  status: string;
  input_file_id: string;
  output_file_id?: string;
  error_file_id?: string;
  request_counts: { total: number; completed: number; failed: number };
};

// --- Setup ---

function setupServer() {
  const dashscope = createDashScope({ apiKey: DASHSCOPE_API_KEY });
  const registry = createProviderRegistry({ dashscope });

  return createServer({
    registry,
    handlers: [openaiHandler()],
    models: ["dashscope:qwen3.5-flash", "dashscope:text-embedding-v3"],
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

// --- Helpers ---

async function uploadFile(
  app: ReturnType<typeof setupServer>["app"],
  content: string,
  purpose = "batch",
) {
  const form = new FormData();
  form.append("file", new File([content], "input.jsonl"));
  form.append("purpose", purpose);

  const res = await app.fetch(
    new Request("http://localhost/v1/files", { method: "POST", body: form }),
  );
  assert(res.status === 200, `Upload file should return 200, got ${res.status}`);
  return res.json() as Promise<FileResponse>;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Test: Files CRUD ---

async function testFiles() {
  console.log("=== Files: CRUD ===");
  const { app } = setupServer();

  // Upload
  const file = await uploadFile(app, "test content for files");
  console.log("  Upload:", file.id, "bytes:", file.bytes);
  assert(file.object === "file", "object should be 'file'");
  assert(file.status === "processed", "status should be 'processed'");
  assert(file.bytes > 0, "bytes should be > 0");

  // List
  const listRes = await app.fetch(new Request("http://localhost/v1/files"));
  const list = (await listRes.json()) as { data: FileResponse[] };
  console.log("  List:", list.data.length, "file(s)");
  assert(
    list.data.some((f) => f.id === file.id),
    "uploaded file should appear in list",
  );

  // Retrieve metadata
  const metaRes = await app.fetch(new Request(`http://localhost/v1/files/${file.id}`));
  assert(metaRes.status === 200, `GET /files/:id should return 200, got ${metaRes.status}`);
  const meta = (await metaRes.json()) as FileResponse;
  assert(meta.id === file.id, "metadata id should match");
  assert(meta.filename === "input.jsonl", "filename should be input.jsonl");

  // Download content
  const contentRes = await app.fetch(new Request(`http://localhost/v1/files/${file.id}/content`));
  assert(
    contentRes.status === 200,
    `GET /files/:id/content should return 200, got ${contentRes.status}`,
  );
  const content = await contentRes.text();
  assert(content === "test content for files", "content should match uploaded");

  // 404 for non-existent file
  const notFoundRes = await app.fetch(new Request("http://localhost/v1/files/file_nonexistent"));
  assert(notFoundRes.status === 404, "non-existent file should return 404");

  // Delete
  const deleteRes = await app.fetch(
    new Request(`http://localhost/v1/files/${file.id}`, { method: "DELETE" }),
  );
  assert(deleteRes.status === 200, `DELETE should return 200, got ${deleteRes.status}`);
  const deleted = (await deleteRes.json()) as { id: string; deleted: boolean };
  assert(deleted.deleted === true, "deleted should be true");

  // Verify deleted
  const afterDelete = await app.fetch(new Request(`http://localhost/v1/files/${file.id}`));
  assert(afterDelete.status === 404, "deleted file should return 404");

  console.log("  All file tests passed.\n");
}

// --- Test: Batch full lifecycle ---

async function testBatch() {
  console.log("=== Batches: Full Lifecycle ===");
  const { app } = setupServer();

  // Upload input file (JSONL)
  const inputJsonl = [
    JSON.stringify({
      custom_id: "req-1",
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "Say hello" }],
        max_tokens: 50,
      },
    }),
    JSON.stringify({
      custom_id: "req-2",
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "Say goodbye" }],
        max_tokens: 50,
      },
    }),
  ].join("\n");

  const file = await uploadFile(app, inputJsonl);
  console.log("  Uploaded input file:", file.id);

  // Create batch
  const createRes = await app.fetch(
    new Request("http://localhost/v1/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_file_id: file.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      }),
    }),
  );
  assert(createRes.status === 200, `Create batch should return 200, got ${createRes.status}`);
  const batch = (await createRes.json()) as BatchResponse;
  console.log("  Created batch:", batch.id, "status:", batch.status);
  assert(batch.object === "batch", "object should be 'batch'");
  assert(batch.input_file_id === file.id, "input_file_id should match");

  // Poll until completed
  const completed = await poll(
    async () => {
      const res = await app.fetch(new Request(`http://localhost/v1/batches/${batch.id}`));
      return (await res.json()) as BatchResponse;
    },
    (b) => b.status !== "completed" && b.status !== "failed" && b.status !== "cancelled",
  );
  console.log("  Final status:", completed.status, "counts:", completed.request_counts);
  assert(
    completed.status === "completed",
    `Batch should complete, got status: ${completed.status}`,
  );
  assert(
    completed.request_counts.completed === 2,
    `Should have 2 completed, got ${completed.request_counts.completed}`,
  );
  assert(
    completed.request_counts.failed === 0,
    `Should have 0 failed, got ${completed.request_counts.failed}`,
  );

  // Verify output file
  assert(completed.output_file_id != null, "completed batch should have output_file_id");
  const outputRes = await app.fetch(
    new Request(`http://localhost/v1/files/${completed.output_file_id}/content`),
  );
  assert(outputRes.status === 200, "output file should be downloadable");
  const output = await outputRes.text();
  const lines = output.split("\n").filter((l) => l.trim());
  assert(lines.length === 2, `output should have 2 lines, got ${lines.length}`);

  for (const line of lines) {
    const result = JSON.parse(line) as {
      custom_id: string;
      response: {
        status_code: number;
        body: { choices?: Array<{ message?: { content?: string } }> };
      };
    };
    assert(
      result.response.status_code === 200,
      `result ${result.custom_id} should be 200, got ${result.response.status_code}`,
    );
    const content = result.response.body.choices?.[0]?.message?.content ?? "(empty)";
    console.log("  Result:", result.custom_id, "->", content);
  }

  // List batches
  const listRes = await app.fetch(new Request("http://localhost/v1/batches"));
  const list = (await listRes.json()) as { data: BatchResponse[] };
  assert(
    list.data.some((b) => b.id === batch.id),
    "batch should appear in list",
  );

  console.log("  All batch tests passed.\n");
}

// --- Run ---

async function main() {
  try {
    await testFiles();
    await testBatch();
    console.log("All tests passed!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

void main();
