import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";

import { createWeComWebhookAdapter, WeComWebhookAdapter } from "./webhook";

const KEY = "test-webhook-key-123";

describe("createWeComWebhookAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates adapter from explicit config", () => {
    const adapter = createWeComWebhookAdapter({ key: KEY });
    expect(adapter).toBeInstanceOf(WeComWebhookAdapter);
    expect(adapter.name).toBe("wecom-webhook");
  });

  it("reads environment variable as fallback", () => {
    process.env.WECOM_WEBHOOK_KEY = KEY;
    const adapter = createWeComWebhookAdapter();
    expect(adapter).toBeInstanceOf(WeComWebhookAdapter);
  });

  it("throws when key is missing", () => {
    expect(() => createWeComWebhookAdapter()).toThrow("WECOM_WEBHOOK_KEY");
  });

  it("uses default userName", () => {
    const adapter = createWeComWebhookAdapter({ key: KEY });
    expect(adapter.userName).toBe("WeCom Webhook");
  });

  it("accepts custom userName", () => {
    const adapter = createWeComWebhookAdapter({ key: KEY, userName: "Bot" });
    expect(adapter.userName).toBe("Bot");
  });
});

describe("WeComWebhookAdapter threadId", () => {
  const adapter = createWeComWebhookAdapter({ key: KEY });

  it("encodes threadId", () => {
    const encoded = adapter.encodeThreadId({ key: KEY });
    expect(encoded).toBe(`wecom-webhook:${KEY}`);
  });

  it("decodes threadId", () => {
    const decoded = adapter.decodeThreadId(`wecom-webhook:${KEY}`);
    expect(decoded).toEqual({ key: KEY });
  });

  it("roundtrips encode → decode", () => {
    const data = { key: "my-key-456" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });

  it("extracts channel ID from threadId", () => {
    const threadId = adapter.encodeThreadId({ key: KEY });
    expect(adapter.channelIdFromThreadId(threadId)).toBe(KEY);
  });
});
