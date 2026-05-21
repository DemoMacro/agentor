import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";

import type { QQMessageScene } from "../types";
import { createQQBotAdapter, QQBotAdapter, isCallbackConfig } from "./bot";

const CALLBACK_CONFIG = {
  mode: "callback" as const,
  appId: "app123",
  clientSecret: "secret456",
};

const WS_CONFIG = {
  appId: "app123",
  clientSecret: "secret456",
};

describe("createQQBotAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates callback mode adapter from explicit config", () => {
    const adapter = createQQBotAdapter(CALLBACK_CONFIG);
    expect(adapter).toBeInstanceOf(QQBotAdapter);
    expect(adapter.name).toBe("qq-bot-callback");
  });

  it("creates websocket mode adapter by default", () => {
    const adapter = createQQBotAdapter(WS_CONFIG);
    expect(adapter).toBeInstanceOf(QQBotAdapter);
    expect(adapter.name).toBe("qq-bot-websocket");
  });

  it("reads environment variables as fallback", () => {
    process.env.QQ_BOT_APP_ID = "env-app-id";
    process.env.QQ_BOT_CLIENT_SECRET = "env-secret";
    const adapter = createQQBotAdapter();
    expect(adapter).toBeInstanceOf(QQBotAdapter);
  });

  it("throws when appId is missing", () => {
    expect(() => createQQBotAdapter()).toThrow("QQ_BOT_APP_ID");
  });

  it("throws when clientSecret is missing", () => {
    process.env.QQ_BOT_APP_ID = "app-id-only";
    expect(() => createQQBotAdapter()).toThrow("QQ_BOT_CLIENT_SECRET");
  });

  it("uses default userName", () => {
    const adapter = createQQBotAdapter(CALLBACK_CONFIG);
    expect(adapter.userName).toBe("QQ Bot");
  });

  it("accepts custom userName", () => {
    const adapter = createQQBotAdapter({ ...CALLBACK_CONFIG, userName: "MyBot" });
    expect(adapter.userName).toBe("MyBot");
  });

  it("explicit config overrides env vars", () => {
    process.env.QQ_BOT_APP_ID = "env-app-id";
    process.env.QQ_BOT_CLIENT_SECRET = "env-secret";
    const adapter = createQQBotAdapter(CALLBACK_CONFIG);
    expect(adapter).toBeInstanceOf(QQBotAdapter);
  });
});

describe("isCallbackConfig", () => {
  it("returns true for callback config", () => {
    expect(isCallbackConfig(CALLBACK_CONFIG)).toBe(true);
  });

  it("returns false for websocket config", () => {
    expect(isCallbackConfig({ mode: "websocket", appId: "a", clientSecret: "s" })).toBe(false);
  });
});

// --- ThreadId ---

describe("QQBotAdapter threadId (callback)", () => {
  const adapter = createQQBotAdapter(CALLBACK_CONFIG);

  const scenes: QQMessageScene[] = ["c2c", "group", "channel", "direct"];

  it.each(scenes)("roundtrips %s scene threadId", (scene) => {
    const data = { scene, id: "test-id-123" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });

  it("encodes with qq-bot-callback prefix", () => {
    const encoded = adapter.encodeThreadId({ scene: "c2c", id: "openid123" });
    expect(encoded).toBe("qq-bot-callback:c2c:openid123");
  });

  it("extracts channel ID from threadId", () => {
    const threadId = adapter.encodeThreadId({ scene: "group", id: "group001" });
    expect(adapter.channelIdFromThreadId(threadId)).toBe("group001");
  });

  it("handles ID containing colons", () => {
    const data = { scene: "c2c" as const, id: "id:with:colons" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });
});

describe("QQBotAdapter threadId (websocket)", () => {
  const adapter = createQQBotAdapter(WS_CONFIG);

  it("encodes with qq-bot-websocket prefix", () => {
    const encoded = adapter.encodeThreadId({ scene: "c2c", id: "openid123" });
    expect(encoded).toBe("qq-bot-websocket:c2c:openid123");
  });

  it("roundtrips encode → decode", () => {
    const data = { scene: "group" as const, id: "group456" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });
});

// --- parseMessage ---

describe("QQBotAdapter parseMessage", () => {
  const adapter = createQQBotAdapter(CALLBACK_CONFIG);

  it("parses C2C message", () => {
    const raw = {
      id: "msg_c2c_001",
      content: "Hello from C2C",
      author: { user_openid: "user_abc" },
      timestamp: "1700000000",
      attachments: [],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.id).toBe("msg_c2c_001");
    expect(msg.text).toBe("Hello from C2C");
    expect(msg.author.userId).toBe("user_abc");
    expect(msg.attachments).toEqual([]);
  });

  it("parses group message", () => {
    const raw = {
      id: "msg_group_001",
      content: "Hello from group",
      author: { member_openid: "member_def" },
      group_openid: "group_xyz",
      timestamp: "1700000000",
      attachments: [],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.id).toBe("msg_group_001");
    expect(msg.text).toBe("Hello from group");
    expect(msg.author.userId).toBe("member_def");
    expect(msg.threadId).toContain("group");
  });

  it("parses channel message with username", () => {
    const raw = {
      id: "msg_channel_001",
      content: "Hello from channel",
      author: { id: "user_id_123", username: "Alice" },
      channel_id: "channel_456",
      guild_id: "guild_789",
      timestamp: "1700000000",
      attachments: [],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.id).toBe("msg_channel_001");
    expect(msg.author.userName).toBe("Alice");
    expect(msg.author.userId).toBe("user_id_123");
  });

  it("parses message with image attachment", () => {
    const raw = {
      id: "msg_img_001",
      content: "Check this",
      author: { user_openid: "user_att" },
      timestamp: "1700000000",
      attachments: [{ content_type: "image/png", url: "https://example.com/img.png" }],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("image");
    expect(msg.attachments[0].url).toBe("https://example.com/img.png");
  });

  it("parses message with video attachment", () => {
    const raw = {
      id: "msg_vid_001",
      content: "",
      author: { user_openid: "user_vid" },
      timestamp: "1700000000",
      attachments: [{ content_type: "video/mp4", url: "https://example.com/vid.mp4" }],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments[0].type).toBe("video");
  });

  it("parses message with voice attachment", () => {
    const raw = {
      id: "msg_voice_001",
      content: "",
      author: { user_openid: "user_voice" },
      timestamp: "1700000000",
      attachments: [{ content_type: "voice", url: "https://example.com/voice.silk" }],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments[0].type).toBe("audio");
  });

  it("parses message with file attachment", () => {
    const raw = {
      id: "msg_file_001",
      content: "Here is a file",
      author: { user_openid: "user_file" },
      timestamp: "1700000000",
      attachments: [{ content_type: "file", filename: "doc.pdf", size: 2048 }],
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments[0].type).toBe("file");
    expect(msg.attachments[0].name).toBe("doc.pdf");
    expect(msg.attachments[0].size).toBe(2048);
  });

  it("parses message with no attachments field", () => {
    const raw = {
      id: "msg_no_att",
      content: "Text only",
      author: { user_openid: "user_plain" },
      timestamp: "1700000000",
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toEqual([]);
  });
});

// --- handleWebhook ---

describe("QQBotAdapter handleWebhook", () => {
  const adapter = createQQBotAdapter(CALLBACK_CONFIG);

  it("returns 405 for GET requests", async () => {
    const request = new Request("https://example.com/webhook", { method: "GET" });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(405);
  });

  it("returns 401 with invalid signature", async () => {
    const body = JSON.stringify({ op: 0, t: "test", d: {} });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": "invalid_signature",
        "X-Signature-Timestamp": "1700000000",
      },
      body,
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("handles OpCode 13 callback verification", async () => {
    const body = JSON.stringify({
      op: 13,
      d: { plain_token: "test_plain_token", event_ts: "1700000000" },
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { plain_token: string; signature: string };
    expect(result.plain_token).toBe("test_plain_token");
    expect(result.signature).toBeDefined();
  });

  it("returns ok for websocket mode adapter", async () => {
    const wsAdapter = createQQBotAdapter(WS_CONFIG);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "{}",
    });
    const response = await wsAdapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});
