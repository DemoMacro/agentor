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

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

// Returns a fetch mock that records every request body for assertions.
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

describe("DashScope chat: JSON schema injection", () => {
  it("places the schema after the system block when system carries cacheControl", async () => {
    const { fetch, calls } = mockFetch();
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

    const messages = calls[0].body.messages as Msg[];
    // [system(cc), user(schema), user(query)] — schema sits between system and query.
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(String(messages[1].content)).toContain("JSON");
    expect(userText(messages[2].content)).toBe("List items.");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("places the schema as system[0] when there is no system message", async () => {
    const { fetch, calls } = mockFetch();
    const dashscope = createDashScope({ apiKey: "test", fetch });

    await generateText({
      model: dashscope("qwen3.5-flash"),
      prompt: "List items.",
      output: Output.object({ schema }),
    });

    const messages = calls[0].body.messages as Msg[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(String(messages[0].content)).toContain("JSON");
    expect(userText(messages[1].content)).toBe("List items.");
  });

  it("places the schema after the last system message when there are several", async () => {
    const { fetch, calls } = mockFetch();
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

    const messages = calls[0].body.messages as Msg[];
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
    expect(String(messages[2].content)).toContain("JSON");
    expect(userText(messages[3].content)).toBe("go");
  });

  it("maps system cacheControl to a wire cache_control block (non-json mode)", async () => {
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
