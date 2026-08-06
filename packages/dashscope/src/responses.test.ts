import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createDashScope } from "./index";

// A minimal valid DashScope Responses API body.
function responsesBody(content: string): Record<string, unknown> {
  return {
    id: "resp_test",
    object: "response",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: content }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// Reads a header from either a Headers object or a plain record.
function getHeader(headers: unknown, key: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }
  if (headers && typeof headers === "object") {
    return (headers as Record<string, string>)[key];
  }
  return undefined;
}

function mockFetch(content = '{"result":"ok"}') {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responsesBody(content)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const schema = z.object({ result: z.string() });

describe("DashScope responses: session cache + json instructions", () => {
  it("sends x-dashscope-session-cache when a message carries cacheControl", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.7-plus"),
      system: {
        role: "system",
        content: "You are helpful.",
        providerOptions: { dashscope: { cacheControl: { type: "ephemeral" } } },
      } as never,
      prompt: "hi",
    });

    expect(getHeader(calls[0].headers, "x-dashscope-session-cache")).toBe("enable");
  });

  it("does not send the session-cache header without cacheControl", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.7-plus"),
      prompt: "hi",
    });

    expect(getHeader(calls[0].headers, "x-dashscope-session-cache")).toBeUndefined();
  });

  it("injects the json schema into instructions for Output.object", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.7-plus"),
      prompt: "List items.",
      output: Output.object({ schema }),
    });

    expect(String(calls[0].body.instructions)).toContain("JSON");
  });

  it("forwards previousResponseId as previous_response_id", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.7-plus"),
      prompt: "follow up",
      providerOptions: { dashscope: { previousResponseId: "resp_prev" } },
    });

    expect(calls[0].body.previous_response_id).toBe("resp_prev");
  });
});

describe("DashScope responses: ocr_options passthrough", () => {
  it("forwards ocrOptions as ocr_options", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.5-ocr"),
      prompt: "parse",
      providerOptions: { dashscope: { ocrOptions: { task: "document_parsing" } } },
    });

    expect(calls[0].body.ocr_options).toEqual({ task: "document_parsing" });
  });

  it("maps taskConfig.resultSchema to task_config.result_schema", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });
    const resultSchema = { 发票号码: "extract invoice number" };

    await generateText({
      model: dashscope.responses("qwen3.5-ocr"),
      prompt: "extract",
      providerOptions: {
        dashscope: {
          ocrOptions: {
            task: "key_information_extraction",
            taskConfig: { resultSchema },
          },
        },
      },
    });

    expect(calls[0].body.ocr_options).toEqual({
      task: "key_information_extraction",
      task_config: { result_schema: resultSchema },
    });
  });

  it("omits ocr_options when ocrOptions is not provided", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({ model: dashscope.responses("qwen3.5-ocr"), prompt: "hi" });

    expect(calls[0].body.ocr_options).toBeUndefined();
  });
});

describe("DashScope responses: tool_choice requires tools", () => {
  it("does not inject tool_choice without tools (guard)", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });
    const model = dashscope.responses("qwen3.5-ocr");

    // Direct doGenerate so we can hand the provider toolChoice WITHOUT tools —
    // the exact shape DashScope rejects ("tool_choice must be paired with
    // tools"). generateText never produces this, but the provider must guard.
    await model.doGenerate({
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      toolChoice: { type: "auto" },
      headers: {},
      abortSignal: undefined,
    } as never);

    expect(calls[0].body.tool_choice).toBeUndefined();
    expect(calls[0].body.tools).toBeUndefined();
  });

  it("injects tool_choice when tools are present", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.5-ocr"),
      prompt: "hi",
      tools: { noop: { description: "no-op", inputSchema: z.object({}) } },
      toolChoice: "auto" as const,
    });

    expect(calls[0].body.tool_choice).toBe("auto");
    expect(calls[0].body.tools).toBeDefined();
  });
});

describe("DashScope responses: OCR file inputs", () => {
  type InputMsg = { content: string | Array<{ type: string; [k: string]: unknown }> };

  function filePart(calls: RecordedCall[]): { type: string; [k: string]: unknown } | undefined {
    const input = calls[0].body.input as InputMsg[];
    const content = input[0]?.content;
    if (!Array.isArray(content)) return undefined;
    return content.find((p) => p.type === "input_file" || p.type === "input_image");
  }

  it("sends a PDF file as input_file (file_url)", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.5-ocr"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "parse this pdf" },
            {
              type: "file",
              data: new Uint8Array([1, 2, 3]),
              mediaType: "application/pdf",
            },
          ],
        },
      ] as never,
    });

    const pdf = filePart(calls);
    expect(pdf?.type).toBe("input_file");
    expect(String(pdf?.file_url)).toMatch(/^data:application\/pdf;base64,/);
  });

  it("sends an image file as input_image (image_url)", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope.responses("qwen3.5-ocr"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "ocr this image" },
            {
              type: "file",
              data: new Uint8Array([4, 5, 6]),
              mediaType: "image/png",
            },
          ],
        },
      ] as never,
    });

    const img = filePart(calls);
    expect(img?.type).toBe("input_image");
    expect(String(img?.image_url)).toMatch(/^data:image/);
  });
});
