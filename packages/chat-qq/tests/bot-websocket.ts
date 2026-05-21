// QQ Bot - WebSocket 长连接模式测试
// 直连 QQ Bot WebSocket Gateway，测试消息收发

import { Message, type Adapter } from "chat";

import { createQQBotAdapter } from "../src";

const APP_ID = process.env.QQ_BOT_APP_ID;
const CLIENT_SECRET = process.env.QQ_BOT_CLIENT_SECRET;

// --- Thread ID 编解码 ---

async function threadIdCodec() {
  console.log("=== Thread ID Codec ===");

  const adapter = createQQBotAdapter({
    mode: "websocket",
    appId: APP_ID ?? "test-app-id",
    clientSecret: CLIENT_SECRET ?? "test-secret",
  } as Parameters<typeof createQQBotAdapter>[0]);

  // C2C
  const c2cId = adapter.encodeThreadId({ scene: "c2c", id: "user_openid_abc" });
  console.log("C2C Encoded:", c2cId);
  const c2cDecoded = adapter.decodeThreadId(c2cId);
  console.log("C2C Decoded:", c2cDecoded);
  console.assert(c2cDecoded.scene === "c2c", "Scene mismatch");
  console.assert(c2cDecoded.id === "user_openid_abc", "ID mismatch");

  // Group
  const groupId = adapter.encodeThreadId({ scene: "group", id: "group_openid_def" });
  console.log("Group Encoded:", groupId);
  const groupDecoded = adapter.decodeThreadId(groupId);
  console.log("Group Decoded:", groupDecoded);
  console.assert(groupDecoded.scene === "group", "Scene mismatch");

  // channelIdFromThreadId
  console.log("Channel ID from thread:", adapter.channelIdFromThreadId(c2cId));
}

// --- WebSocket 连接测试 ---

async function wsConnectTest() {
  console.log("\n=== WebSocket Connect Test ===");

  if (!APP_ID || !CLIENT_SECRET) {
    console.log("Skipped: QQ_BOT_APP_ID / QQ_BOT_CLIENT_SECRET not configured");
    return;
  }

  const adapter = createQQBotAdapter({
    mode: "websocket",
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
    await wsConnectTest();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
