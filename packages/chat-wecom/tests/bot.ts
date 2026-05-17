// 智能机器人 - 回调 URL 模式测试
// 启动 h3 服务器接收企业微信回调，用于 URL 验证和消息接收测试

import { H3, fromWebHandler, serve } from "h3";
import { Message, type Adapter } from "chat";
import { createWeComBotAdapter } from "../src";

const BOT_TOKEN = process.env.WECOM_BOT_TOKEN!;
const BOT_ENCODING_AES_KEY = process.env.WECOM_BOT_ENCODING_AES_KEY!;

// --- 加解密验证 ---

async function cryptoTest() {
  console.log("=== Crypto Test ===");

  const { encrypt, decrypt, calculateSignature, verifySignature } = await import("../src/crypto");

  const message = "Hello World";

  const encrypted = await encrypt(BOT_ENCODING_AES_KEY, message, "");
  console.log("Encrypted:", encrypted.substring(0, 20) + "...");

  const decrypted = await decrypt(BOT_ENCODING_AES_KEY, encrypted, "");
  console.log("Decrypted:", decrypted);

  console.assert(decrypted === message, "Decrypt mismatch");

  const timestamp = "1234567890";
  const nonce = "test_nonce";
  const signature = await calculateSignature(BOT_TOKEN, timestamp, nonce, encrypted);
  console.log("Signature:", signature);

  const valid = await verifySignature(BOT_TOKEN, timestamp, nonce, encrypted, signature);
  console.log("Signature valid:", valid);
}

// --- Thread ID 编解码 ---

async function threadIdTest() {
  console.log("\n=== Thread ID Codec ===");

  const adapter = createWeComBotAdapter({
    token: BOT_TOKEN,
    encodingAESKey: BOT_ENCODING_AES_KEY,
  });

  const chatId = "test-chat-id";
  const encoded = adapter.encodeThreadId({ chatId });
  console.log("Encoded:", encoded);

  const decoded = adapter.decodeThreadId(encoded);
  console.log("Decoded:", decoded);

  console.log("Channel ID:", adapter.channelIdFromThreadId(encoded));
}

// --- 启动回调服务器 ---

async function startServer() {
  const adapter = createWeComBotAdapter({
    token: BOT_TOKEN,
    encodingAESKey: BOT_ENCODING_AES_KEY,
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

  const app = new H3();

  app.all(
    "/webhook",
    fromWebHandler((req) => {
      console.log(`[Request] ${req.method} ${req.url}`);
      return adapter.handleWebhook(req);
    }),
  );
  app.all("/**", () => new Response("Not Found", { status: 404 }));

  const listener = serve(app, { port: 3000 });
  const address = listener.url ?? `http://localhost:3000`;

  console.log(`\n=== Bot Callback Server ===`);
  console.log(`Webhook URL: ${address}webhook`);
  console.log(`Configure this URL in WeCom admin panel`);
  console.log(`Waiting for callbacks... (Ctrl+C to stop)\n`);

  const shutdown = () => {
    console.log("\nShutting down...");
    void listener.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Main ---

async function main() {
  if (!BOT_TOKEN || !BOT_ENCODING_AES_KEY) {
    console.error("Please set WECOM_BOT_TOKEN and WECOM_BOT_ENCODING_AES_KEY in .env");
    return;
  }

  try {
    await cryptoTest();
    await threadIdTest();
    await startServer();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
