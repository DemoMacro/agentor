import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createDashScope } from "./index";

// A minimal valid DashScope chat-completion response body.
function chatCompletion(content: string): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "qwen3.5-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// The 400 body an unsupported model returns when handed json_schema with no
// injected "json" keyword — the signal to retry once with json_object.
function jsonSchemaUnsupportedError(): Record<string, unknown> {
  return {
    error: {
      message:
        "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
    },
  };
}

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

// Always-200 fetch mock.
function mockFetch(content = '{"result":"ok"}') {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return new Response(JSON.stringify(chatCompletion(content)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

// Fetch mock whose FIRST request fails with the json_schema "unsupported" 400;
// every later request succeeds. Models that reject json_schema behave exactly
// this way on the probe attempt.
function mockFallbackFetch(content = '{"result":"ok"}') {
  const calls: RecordedCall[] = [];
  let first = true;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
    if (first) {
      first = false;
      return new Response(JSON.stringify(jsonSchemaUnsupportedError()), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(chatCompletion(content)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const schema = z.object({ result: z.string() });

type Msg = { role: string; content: unknown };

// Normalizes a converted user message's content (string or text-part array) to plain text.
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p: { text?: string }) => p.text ?? "").join("");
  }
  return "";
}

describe("DashScope chat: native json_schema structured output", () => {
  it("sends native json_schema by default and injects no schema message", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen-plus"),
      prompt: "go",
      output: Output.object({ schema }),
    });

    // schema enforced via response_format, never injected into messages, so the
    // prompt prefix stays cache-stable and any cacheControl keeps hitting.
    expect(calls[0].body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    const messages = calls[0].body.messages as Msg[];
    expect(messages).toHaveLength(1);
    expect(userText(messages[0].content)).toBe("go");
  });

  it("falls back to json_object + injection when the model rejects json_schema", async () => {
    const { fetch, calls } = mockFallbackFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      prompt: "go",
      output: Output.object({ schema }),
    });

    // First attempt probes native json_schema; the 400 triggers one retry.
    expect(calls).toHaveLength(2);
    expect(calls[0].body.response_format).toMatchObject({ type: "json_schema" });
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
    expect((calls[1].body.messages as Msg[]).some((m) => String(m.content).includes("JSON"))).toBe(
      true,
    );
  });

  it("remembers the fallback so the next call on the same instance skips the probe", async () => {
    const { fetch, calls } = mockFallbackFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });
    const model = dashscope("qwen3.5-flash");

    await generateText({ model, prompt: "a", output: Output.object({ schema }) });
    await generateText({ model, prompt: "b", output: Output.object({ schema }) });

    // First generateObject: probe (json_schema) + retry (json_object) = 2 calls.
    // Second generateObject: the instance remembers the rejection => 1 call.
    expect(calls).toHaveLength(3);
    expect(calls[0].body.response_format).toMatchObject({ type: "json_schema" });
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
    expect(calls[2].body.response_format).toEqual({ type: "json_object" });
  });
});

describe("DashScope chat: schema injection on json_object fallback", () => {
  it("places the schema after the system block when system carries cacheControl", async () => {
    const { fetch, calls } = mockFallbackFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      system: {
        role: "system",
        content: "You are helpful.",
        providerOptions: { dashscope: { cacheControl: { type: "ephemeral" } } },
      } as never,
      prompt: "List items.",
      output: Output.object({ schema }),
    });

    // calls[1] is the json_object fallback; schema sits between system and query.
    const messages = calls[1].body.messages as Msg[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(String(messages[1].content)).toContain("JSON");
    expect(userText(messages[2].content)).toBe("List items.");
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
  });

  it("places the schema as system[0] when there is no system message", async () => {
    const { fetch, calls } = mockFallbackFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      prompt: "List items.",
      output: Output.object({ schema }),
    });

    const messages = calls[1].body.messages as Msg[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(String(messages[0].content)).toContain("JSON");
    expect(userText(messages[1].content)).toBe("List items.");
  });

  it("places the schema after the last system message when there are several", async () => {
    const { fetch, calls } = mockFallbackFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      system: [
        { role: "system", content: "rule A" },
        { role: "system", content: "rule B" },
      ] as never,
      prompt: "go",
      output: Output.object({ schema }),
    });

    const messages = calls[1].body.messages as Msg[];
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
    expect(String(messages[2].content)).toContain("JSON");
    expect(userText(messages[3].content)).toBe("go");
  });
});

describe("DashScope chat: cacheControl wiring (non-json mode)", () => {
  it("maps system cacheControl to a wire cache_control block", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      system: {
        role: "system",
        content: "You are helpful.",
        providerOptions: { dashscope: { cacheControl: { type: "ephemeral" } } },
      } as never,
      prompt: "hi",
    });

    const messages = calls[0].body.messages as Msg[];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toEqual([
      { type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("DashScope chat: ocr_options passthrough", () => {
  it("forwards ocrOptions as ocr_options", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-ocr"),
      prompt: "ocr",
      providerOptions: { dashscope: { ocrOptions: { task: "text_recognition" } } },
    });

    expect(calls[0].body.ocr_options).toEqual({ task: "text_recognition" });
  });

  it("maps taskConfig.resultSchema to task_config.result_schema", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });
    const resultSchema = { 发票号码: "invoice number" };

    await generateText({
      model: dashscope("qwen3.5-ocr"),
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
});
