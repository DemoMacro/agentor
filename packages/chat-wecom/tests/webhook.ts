import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CardElement } from "chat";

import { createWeComWebhookAdapter } from "../src";

const WEBHOOK_KEY = process.env.WECOM_WEBHOOK_KEY!;

const ASSETS_DIR = resolve(import.meta.dirname, "assets");

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

// --- 发送图片消息 (base64) ---

async function sendImageMessage() {
  console.log("\n=== Send Image Message ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const imageBuffer = readFileSync(resolve(ASSETS_DIR, "test-image.png"));

  const result = await adapter.postMessage(threadId, {
    raw: "",
    files: [{ data: imageBuffer, filename: "test-image.png", mimeType: "image/png" }],
  });

  console.log("Message ID:", result.id);
}

// --- 发送文件消息 (upload + media_id) ---

async function sendFileMessage() {
  console.log("\n=== Send File Message ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const fileBuffer = readFileSync(resolve(ASSETS_DIR, "test-video.mp4"));

  const result = await adapter.postMessage(threadId, {
    raw: "",
    files: [{ data: fileBuffer, filename: "test-video.mp4", mimeType: "video/mp4" }],
  });

  console.log("Message ID:", result.id);
}

// --- 发送文本通知卡片 (text_notice) ---

async function sendTextNoticeCard() {
  console.log("\n=== Send Text Notice Card ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const card: CardElement = {
    type: "card",
    title: "文本通知",
    subtitle: "这是一条文本通知卡片",
    children: [
      { type: "text", content: "欢迎使用企业微信卡片消息", style: "bold" },
      {
        type: "fields",
        children: [
          { type: "field", label: "发送者", value: "Webhook 机器人" },
          { type: "field", label: "时间", value: new Date().toLocaleString("zh-CN") },
        ],
      },
    ],
  };

  const result = await adapter.postMessage(threadId, card);
  console.log("Card Message ID:", result.id);
}

// --- 发送图文通知卡片 (news_notice) ---

async function sendNewsNoticeCard() {
  console.log("\n=== Send News Notice Card ===");

  const adapter = createWeComWebhookAdapter({ key: WEBHOOK_KEY });
  const threadId = adapter.encodeThreadId({ key: WEBHOOK_KEY });

  const card: CardElement = {
    type: "card",
    title: "图文通知",
    subtitle: "这是一条图文通知卡片",
    imageUrl: "https://placehold.co/600x400/png",
    children: [
      { type: "text", content: "卡片支持展示图片和链接跳转" },
      {
        type: "link",
        label: "查看详情",
        url: "https://developer.work.weixin.qq.com/document/path/91770",
      },
    ],
  };

  const result = await adapter.postMessage(threadId, card);
  console.log("Card Message ID:", result.id);
}

// --- Main ---

async function main() {
  if (!WEBHOOK_KEY) {
    console.error("Please set WECOM_WEBHOOK_KEY in .env");
    return;
  }

  try {
    await threadIdCodec();
    await sendMarkdownMessage();
    await sendImageMessage();
    await sendFileMessage();
    await sendTextNoticeCard();
    await sendNewsNoticeCard();
    // button_interaction / vote_interaction / multiple_interaction 需通过 Bot 或 App 发送
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
