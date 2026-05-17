// 智能机器人 - WebSocket 长连接模式测试
// 直连企业微信 WebSocket 服务，测试消息收发

import { Message, type Adapter } from "chat";
import { createWeComBotAdapter } from "../src";

const BOT_WS_BOT_ID = process.env.WECOM_BOT_WS_BOT_ID;
const BOT_WS_SECRET = process.env.WECOM_BOT_WS_SECRET;
const BOT_CHAT_ID = process.env.WECOM_BOT_CHAT_ID;

// --- Thread ID 编解码 ---

async function threadIdCodec() {
  console.log("=== Thread ID Codec ===");

  const adapter = createWeComBotAdapter({
    mode: "websocket",
    botId: BOT_WS_BOT_ID ?? "test-bot-id",
    secret: BOT_WS_SECRET ?? "test-secret",
  });

  const chatId = BOT_CHAT_ID ?? "test-chat-id";
  const encoded = adapter.encodeThreadId({ chatId });
  console.log("Encoded:", encoded);

  const decoded = adapter.decodeThreadId(encoded);
  console.log("Decoded:", decoded);

  console.log("Channel ID:", adapter.channelIdFromThreadId(encoded));
}

// --- 消息解析 ---

async function parseMessage() {
  console.log("\n=== Parse Message ===");

  const adapter = createWeComBotAdapter({
    mode: "websocket",
    botId: BOT_WS_BOT_ID ?? "test-bot-id",
    secret: BOT_WS_SECRET ?? "test-secret",
  });

  const chatId = BOT_CHAT_ID ?? "test-chat-id";
  const rawMessage = {
    msgid: "ws-msg-001",
    aibotid: BOT_WS_BOT_ID ?? "test-bot-id",
    chatid: chatId,
    chattype: "single" as const,
    from: { userid: "user-ws-001", corpid: "corp-001" },
    create_time: Date.now(),
    msgtype: "text" as const,
    text: { content: "Hello from WebSocket!" },
  };

  const message = adapter.parseMessage(rawMessage);
  console.log("ID:", message.id);
  console.log("Text:", message.text);
  console.log("Thread ID:", message.threadId);
  console.log("Author:", message.author);
}

// --- WebSocket 连接测试 ---

async function wsConnectTest() {
  console.log("\n=== WebSocket Connect Test ===");

  if (!BOT_WS_BOT_ID || !BOT_WS_SECRET) {
    console.log("Skipped: WECOM_BOT_WS_* not configured");
    return;
  }

  const adapter = createWeComBotAdapter({
    mode: "websocket",
    botId: BOT_WS_BOT_ID,
    secret: BOT_WS_SECRET,
  });

  await adapter.initialize({
    processMessage: async (
      _adapter: Adapter<unknown, unknown>,
      threadId: string,
      factory: () => Promise<Message<unknown>>,
    ) => {
      const message = await factory();
      console.log(`\n[Message] ${message.author.userName}: ${message.text}`);
      console.log(`  Thread: ${message.threadId}`);

      const result = await adapter.postMessage(threadId, message.text);
      console.log(`  Reply sent, ID: ${result.id}`);
    },
  } as never);

  console.log("Connected, waiting for messages... (Ctrl+C to stop)");

  const shutdown = () => {
    console.log("\nDisconnecting...");
    void adapter.disconnect().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Main ---

async function main() {
  try {
    await threadIdCodec();
    await parseMessage();
    await wsConnectTest();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
