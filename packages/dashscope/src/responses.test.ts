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
