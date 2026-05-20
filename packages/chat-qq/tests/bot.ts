// QQ Bot - Webhook 回调模式测试
// 启动 h3 服务器接收 QQ Bot 回调事件

import { Message, type Adapter } from "chat";
import { H3, fromWebHandler, serve } from "h3";

import { createQQBotAdapter, signCallbackValidation } from "../src";

const APP_ID = process.env.QQ_BOT_APP_ID!;
const CLIENT_SECRET = process.env.QQ_BOT_CLIENT_SECRET!;

// --- Ed25519 签名验证测试 ---

async function cryptoTest() {
  console.log("=== Ed25519 Crypto Test ===");

  const secret = "DG5g3B4j9X2KOErG";
  const plainToken = "Arq0D5A61EgUu4OxUvOp";
  const eventTs = "1725442341";

  const sig = signCallbackValidation(secret, plainToken, eventTs);
  console.log("Signature:", sig);

  // 验证签名结果与官方文档示例一致
  const expected =
    "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706";
  console.assert(sig === expected, `Signature mismatch: got ${sig}`);
  console.log("Signature matches official example:", sig === expected);
}

// --- Token 获取测试 ---

async function tokenTest() {
  console.log("\n=== Token Test ===");

  if (!APP_ID || !CLIENT_SECRET) {
    console.log("Skipped: QQ_BOT_APP_ID / QQ_BOT_CLIENT_SECRET not configured");
    return;
  }

  const adapter = createQQBotAdapter({
    appId: APP_ID,
    clientSecret: CLIENT_SECRET,
  });

  const token = await adapter.getAccessToken();
  console.log("Access Token:", token.substring(0, 20) + "...");
}

// --- Thread ID 编解码 ---

async function threadIdTest() {
  console.log("\n=== Thread ID Codec ===");

  const adapter = createQQBotAdapter({
    appId: APP_ID || "test-app-id",
    clientSecret: CLIENT_SECRET || "test-secret",
  });

  // C2C
  const c2cId = adapter.encodeThreadId({ scene: "c2c", id: "user_openid_123" });
  console.log("C2C Encoded:", c2cId);
  const c2cDecoded = adapter.decodeThreadId(c2cId);
  console.log("C2C Decoded:", c2cDecoded);
  console.assert(c2cDecoded.scene === "c2c", "Scene mismatch");
  console.assert(c2cDecoded.id === "user_openid_123", "ID mismatch");

  // Group
  const groupId = adapter.encodeThreadId({ scene: "group", id: "group_openid_456" });
  console.log("Group Encoded:", groupId);
  const groupDecoded = adapter.decodeThreadId(groupId);
  console.log("Group Decoded:", groupDecoded);
  console.assert(groupDecoded.scene === "group", "Scene mismatch");

  // Channel
  const channelId = adapter.encodeThreadId({ scene: "channel", id: "channel_id_789" });
  console.log("Channel Encoded:", channelId);
  const channelDecoded = adapter.decodeThreadId(channelId);
  console.log("Channel Decoded:", channelDecoded);
  console.assert(channelDecoded.scene === "channel", "Scene mismatch");

  // channelIdFromThreadId
  console.log("Channel ID from thread:", adapter.channelIdFromThreadId(c2cId));
}

// --- 启动回调服务器 ---

async function startServer() {
  const adapter = createQQBotAdapter({
    appId: APP_ID,
    clientSecret: CLIENT_SECRET,
  });

  await adapter.initialize({
    processMessage: async (
      _adapter: Adapter<unknown, unknown>,
      threadId: string,
      factory: () => Promise<Message<unknown>>,
    ) => {
      const message = await factory();
      const attachmentInfo =
        message.attachments.length > 0
          ? ` [${message.attachments.map((a) => a.type).join(", ")}]`
          : "";
      console.log(`\n[Message] ${message.author.userName}: ${message.text}${attachmentInfo}`);
      console.log(`  Thread: ${message.threadId}`);

      // 回复用户消息: 带附件时转发媒体，否则回显文字
      const result =
        message.attachments.length > 0
          ? await adapter.postMessage(threadId, {
              markdown: message.text || " ",
              attachments: message.attachments,
            })
          : await adapter.postMessage(threadId, message.text || " ");
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

  console.log(`\n=== QQ Bot Webhook Server ===`);
  console.log(`Webhook URL: ${address}webhook`);
  console.log(`Configure this URL in QQ Bot management console`);
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
  try {
    await cryptoTest();
    await tokenTest();
    await threadIdTest();
    await startServer();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
