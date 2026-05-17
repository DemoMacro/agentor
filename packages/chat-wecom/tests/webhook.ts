import { createWeComWebhookAdapter } from "../src";

const WEBHOOK_KEY = process.env.WECOM_WEBHOOK_KEY!;

// --- Thread ID 编解码 ---

async function threadIdCodec() {
  console.log("=== Thread ID Codec ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });

  const encoded = adapter.encodeThreadId({ key: WEBHOOK_KEY });
  console.log("Encoded:", encoded);

  const decoded = adapter.decodeThreadId(encoded);
  console.log("Decoded:", decoded);

  console.log("Channel ID:", adapter.channelIdFromThreadId(encoded));
}

// --- 发送文本消息 ---

async function sendTextMessage() {
  console.log("\n=== Send Text Message ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const result = await adapter.postMessage(threadId, "Hello from @agentor/chat-wecom!");

  console.log("Message ID:", result.id);
  console.log("Thread ID:", result.threadId);
}

// --- 发送 Markdown 消息 ---

async function sendMarkdownMessage() {
  console.log("\n=== Send Markdown Message ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const result = await adapter.postMessage(
    threadId,
    "## Webhook Test\n> Hello from @agentor/chat-wecom!",
  );

  console.log("Message ID:", result.id);
}

// --- Main ---

async function main() {
  if (!WEBHOOK_KEY) {
    console.error("Please set WECOM_WEBHOOK_KEY in .env");
    return;
  }

  try {
    await threadIdCodec();
    await sendTextMessage();
    await sendMarkdownMessage();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
