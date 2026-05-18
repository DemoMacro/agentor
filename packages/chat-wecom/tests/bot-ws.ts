// 智能机器人 - WebSocket 长连接模式测试
// 直连企业微信 WebSocket 服务，测试消息收发

import { Message, type Adapter, type FileUpload } from "chat";

import { createWeComBotAdapter, fetchEncryptedMedia } from "../src";

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
      const attachmentInfo =
        message.attachments.length > 0
          ? ` [${message.attachments.map((a) => a.type).join(", ")}]`
          : "";
      console.log(`\n[Message] ${message.author.userName}: ${message.text}${attachmentInfo}`);
      console.log(`  Thread: ${message.threadId}`);

      // 解密附件并通过 postMessage 发回
      const mediaFiles: FileUpload[] = [];
      const parts: string[] = [];
      for (const attachment of message.attachments) {
        const aeskey = attachment.fetchMetadata?.aeskey as string | undefined;
        if (aeskey && attachment.url) {
          try {
            const { data: decrypted, filename: originalName } = await fetchEncryptedMedia(
              attachment.url,
              aeskey,
            );
            console.log(
              `  ${attachment.type}: decrypted ${decrypted.length} bytes${originalName ? ` (${originalName})` : ""}`,
            );
            const extMap: Record<string, string> = {
              image: ".jpg",
              video: ".mp4",
              audio: ".amr",
            };
            mediaFiles.push({
              data: decrypted,
              filename:
                attachment.name ??
                originalName ??
                `echo-${attachment.type}${extMap[attachment.type] ?? ""}`,
              mimeType:
                attachment.type === "image"
                  ? "image/jpeg"
                  : attachment.type === "video"
                    ? "video/mp4"
                    : attachment.type === "audio"
                      ? "audio/amr"
                      : undefined,
            });
            parts.push(
              `**${attachment.type}**: ${decrypted.length} bytes${originalName ? ` (${originalName})` : ""}\nurl: ${attachment.url}\naeskey: ${aeskey}`,
            );
          } catch {
            parts.push(
              `**${attachment.type}**: decrypt failed\nurl: ${attachment.url}\naeskey: ${aeskey}`,
            );
          }
        } else {
          parts.push(`**${attachment.type}**: ${attachment.url ?? attachment.name ?? "unknown"}`);
        }
      }

      const replyText = message.attachments.length > 0 ? parts.join("\n\n") : message.text;
      const result = await adapter.postMessage(
        threadId,
        mediaFiles.length > 0 ? { raw: replyText, files: mediaFiles } : replyText,
      );
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
