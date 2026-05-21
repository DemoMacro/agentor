import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";

import { createWeComBotAdapter, WeComBotCallbackAdapter, WeComBotWebSocketAdapter } from "./bot";

const CALLBACK_CONFIG = {
  mode: "callback" as const,
  token: "test-token",
  encodingAESKey: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY",
};

const WS_CONFIG = {
  botId: "bot123",
  secret: "secret456",
};

// --- 统一工厂: createWeComBotAdapter ---

describe("createWeComBotAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates websocket adapter by default", () => {
    const adapter = createWeComBotAdapter(WS_CONFIG);
    expect(adapter).toBeInstanceOf(WeComBotWebSocketAdapter);
    expect(adapter.name).toBe("wecom-bot-websocket");
  });

  it("creates callback adapter with explicit mode", () => {
    const adapter = createWeComBotAdapter(CALLBACK_CONFIG);
    expect(adapter).toBeInstanceOf(WeComBotCallbackAdapter);
    expect(adapter.name).toBe("wecom-bot-callback");
  });

  it("reads WECOM_BOT_MODE env var for callback", () => {
    process.env.WECOM_BOT_MODE = "callback";
    process.env.WECOM_BOT_TOKEN = "env-token";
    process.env.WECOM_BOT_ENCODING_AES_KEY = "env-aes-key-1234567890123456789";
    const adapter = createWeComBotAdapter();
    expect(adapter).toBeInstanceOf(WeComBotCallbackAdapter);
  });

  it("defaults to websocket from env vars", () => {
    process.env.WECOM_BOT_WS_BOT_ID = "env-bot-id";
    process.env.WECOM_BOT_WS_SECRET = "env-secret";
    const adapter = createWeComBotAdapter();
    expect(adapter).toBeInstanceOf(WeComBotWebSocketAdapter);
  });
});

// --- ThreadId ---

describe("WeComBotCallbackAdapter threadId", () => {
  const adapter = createWeComBotAdapter({ mode: "callback", token: "t", encodingAESKey: "e" });

  it("encodes with wecom-bot-callback prefix", () => {
    const encoded = adapter.encodeThreadId({ chatId: "chat001" });
    expect(encoded).toBe("wecom-bot-callback:chat001");
  });

  it("decodes callback threadId", () => {
    const decoded = adapter.decodeThreadId("wecom-bot-callback:chat001");
    expect(decoded).toEqual({ chatId: "chat001" });
  });

  it("roundtrips encode → decode", () => {
    const data = { chatId: "user123" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });

  it("extracts channel ID", () => {
    const threadId = adapter.encodeThreadId({ chatId: "chat001" });
    expect(adapter.channelIdFromThreadId(threadId)).toBe("chat001");
  });
});

describe("WeComBotWebSocketAdapter threadId", () => {
  const adapter = createWeComBotAdapter(WS_CONFIG);

  it("encodes with wecom-bot-websocket prefix", () => {
    const encoded = adapter.encodeThreadId({ chatId: "chat001" });
    expect(encoded).toBe("wecom-bot-websocket:chat001");
  });

  it("decodes websocket threadId", () => {
    const decoded = adapter.decodeThreadId("wecom-bot-websocket:chat001");
    expect(decoded).toEqual({ chatId: "chat001" });
  });

  it("roundtrips encode → decode", () => {
    const data = { chatId: "user456" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });

  it("extracts channel ID", () => {
    const threadId = adapter.encodeThreadId({ chatId: "chat001" });
    expect(adapter.channelIdFromThreadId(threadId)).toBe("chat001");
  });

  it("handleWebhook returns ok", async () => {
    const request = new Request("https://example.com/webhook", { method: "POST" });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// --- parseMessage ---

describe("WeComBotCallbackAdapter parseMessage", () => {
  const adapter = createWeComBotAdapter({ mode: "callback", token: "t", encodingAESKey: "e" });

  it("parses plain text message", () => {
    const raw = {
      msgid: "msg_001",
      aibotid: "bot_001",
      chatid: "chat_abc",
      chattype: "group" as const,
      from: { userid: "zhangsan" },
      msgtype: "text" as const,
      text: { content: "Hello world" },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.id).toBe("msg_001");
    expect(msg.text).toBe("Hello world");
    expect(msg.author.userId).toBe("zhangsan");
    expect(msg.author.isBot).toBe(false);
    expect(msg.attachments).toEqual([]);
  });

  it("parses message with image attachment", () => {
    const raw = {
      msgid: "msg_002",
      aibotid: "bot_001",
      chatid: "chat_abc",
      chattype: "group" as const,
      from: { userid: "lisi" },
      msgtype: "image" as const,
      image: { url: "https://example.com/img.jpg", aeskey: "key123" },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("image");
    expect(msg.attachments[0].url).toBe("https://example.com/img.jpg");
    expect(msg.attachments[0].fetchMetadata?.aeskey).toBe("key123");
  });

  it("parses message with file attachment", () => {
    const raw = {
      msgid: "msg_003",
      aibotid: "bot_001",
      chatid: "chat_def",
      chattype: "group" as const,
      from: { userid: "wangwu" },
      msgtype: "file" as const,
      file: {
        url: "https://example.com/doc.pdf",
        aeskey: "key456",
        filename: "report.pdf",
        filesize: 1024,
      },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("file");
    expect(msg.attachments[0].name).toBe("report.pdf");
    expect(msg.attachments[0].size).toBe(1024);
  });

  it("parses voice message with transcription text", () => {
    const raw = {
      msgid: "msg_004",
      aibotid: "bot_001",
      chattype: "single" as const,
      from: { userid: "user_voice" },
      msgtype: "voice" as const,
      voice: { content: "语音转文本的内容" },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("语音转文本的内容");
    expect(msg.attachments).toEqual([]);
  });

  it("parses message with video attachment", () => {
    const raw = {
      msgid: "msg_005",
      aibotid: "bot_001",
      chatid: "chat_abc",
      chattype: "group" as const,
      from: { userid: "user_video" },
      msgtype: "video" as const,
      video: { url: "https://example.com/video.mp4", aeskey: "videokey" },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("video");
  });

  it("falls back to userid when chatid is missing", () => {
    const raw = {
      msgid: "msg_006",
      aibotid: "bot_001",
      chattype: "single" as const,
      from: { userid: "user_direct" },
      msgtype: "text" as const,
      text: { content: "Direct message" },
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.threadId).toContain("user_direct");
  });

  it("parses message with empty text", () => {
    const raw = {
      msgid: "msg_007",
      aibotid: "bot_001",
      chatid: "chat_abc",
      chattype: "group" as const,
      from: { userid: "user_empty" },
      msgtype: "text" as const,
    };
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("");
  });
});

// --- handleWebhook ---

describe("WeComBotCallbackAdapter handleWebhook", () => {
  const adapter = createWeComBotAdapter({ mode: "callback", token: "t", encodingAESKey: "e" });

  it("returns 400 for GET without echostr", async () => {
    const request = new Request("https://example.com/webhook?msg_signature=x&timestamp=x&nonce=x");
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});
