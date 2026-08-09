// 企业微信应用测试
// 启动 h3 服务器接收回调事件，同时测试消息发送、撤回和 Token 管理

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CardElement, Message, type Adapter, type FileUpload } from "chat";
import { H3, fromWebHandler, serve } from "h3";

import {
  createWeComAppAdapter,
  downloadAppMedia,
  isWeComAppAdapter,
  type WeComAppCallbackMessage,
} from "../src";

const CORP_ID = process.env.WECOM_APP_CORP_ID!;
const CORP_SECRET = process.env.WECOM_APP_CORP_SECRET!;
const AGENT_ID = Number(process.env.WECOM_APP_AGENT_ID!);
const APP_TOKEN = process.env.WECOM_APP_TOKEN;
const APP_ENCODING_AES_KEY = process.env.WECOM_APP_ENCODING_AES_KEY;
const APP_USER_ID = process.env.WECOM_APP_USER_ID;

const ASSETS_DIR = resolve(import.meta.dirname, "assets");

// --- 获取 Access Token ---

async function getAccessToken() {
  console.log("=== Get Access Token ===");

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
    token: APP_TOKEN,
    encodingAESKey: APP_ENCODING_AES_KEY,
  });

  const token = await adapter.getAccessToken();
  console.log("Access Token:", token.substring(0, 20) + "...");
}

// --- 发送 Markdown 消息 ---

async function sendMessage() {
  console.log("\n=== Send Markdown Message ===");

  if (!APP_USER_ID) {
    console.log("Skipped: WECOM_APP_USER_ID not configured");
    return;
  }

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
  });
  const threadId = adapter.encodeThreadId({ corpId: CORP_ID, userId: APP_USER_ID });

  const result = await adapter.postMessage(threadId, "App message from @agentor/chat-wecom!");
  console.log("Message ID:", result.id);
  console.log("Thread ID:", result.threadId);
}

// --- 发送图片消息 ---

async function sendImageMessage() {
  console.log("\n=== Send Image Message ===");

  if (!APP_USER_ID) {
    console.log("Skipped: WECOM_APP_USER_ID not configured");
    return;
  }

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
  });
  const threadId = adapter.encodeThreadId({ corpId: CORP_ID, userId: APP_USER_ID });

  const imageBuffer = readFileSync(resolve(ASSETS_DIR, "test-image.png"));

  const result = await adapter.postMessage(threadId, {
    raw: "",
    files: [{ data: imageBuffer, filename: "test-image.png", mimeType: "image/png" }],
  });

  console.log("Image Message ID:", result.id);
}

// --- 撤回消息 ---

async function recallMessage() {
  console.log("\n=== Recall Message ===");

  if (!APP_USER_ID) {
    console.log("Skipped: WECOM_APP_USER_ID not configured");
    return;
  }

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
  });
  const threadId = adapter.encodeThreadId({ corpId: CORP_ID, userId: APP_USER_ID });

  const result = await adapter.postMessage(threadId, "This message will be recalled");
  console.log("Sent message ID:", result.id);

  await adapter.deleteMessage(threadId, result.id);
  console.log("Message recalled successfully");
}

// --- 发送交互卡片（按钮回调闭环）---

async function sendCard() {
  console.log("\n=== Send Interactive Card ===");

  if (!APP_USER_ID) {
    console.log("Skipped: WECOM_APP_USER_ID not configured");
    return;
  }

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
    token: APP_TOKEN,
    encodingAESKey: APP_ENCODING_AES_KEY,
  });
  const threadId = adapter.encodeThreadId({ corpId: CORP_ID, userId: APP_USER_ID });

  const card: CardElement = {
    type: "card",
    title: "审批通知",
    subtitle: "请审批以下申请",
    children: [
      { type: "fields", children: [{ type: "field", label: "申请人", value: "张三" }] },
      // LinkElement 同时作为 card_action（整卡点击跳转）与 jump_list（跳转指引）的来源
      { type: "link", url: "https://github.com/DemoMacro/agentor", label: "项目仓库" },
      {
        type: "actions",
        children: [
          { type: "button", label: "同意", style: "primary", id: "approve" },
          { type: "button", label: "拒绝", style: "danger", id: "reject" },
        ],
      },
    ],
  };

  const result = await adapter.postMessage(threadId, card);
  console.log("Card Message ID:", result.id);
  console.log("Task ID:", result.raw.taskId);
  console.log("Response Code:", result.raw.responseCode);
  console.log(
    "Click the card or the repo link to open GitHub; click a button to trigger the callback and update the card",
  );
}

// --- 启动回调服务器 ---

async function startServer() {
  if (!APP_TOKEN || !APP_ENCODING_AES_KEY) {
    console.log(
      "\nCallback server skipped: WECOM_APP_TOKEN and WECOM_APP_ENCODING_AES_KEY required",
    );
    return;
  }

  const adapter = createWeComAppAdapter({
    corpId: CORP_ID,
    corpSecret: CORP_SECRET,
    agentId: AGENT_ID,
    token: APP_TOKEN,
    encodingAESKey: APP_ENCODING_AES_KEY,
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

      // 有附件时下载并原样回复媒体
      if (message.attachments.length > 0) {
        const mediaFiles: FileUpload[] = [];
        const parts: string[] = [];
        const accessToken = await adapter.getAccessToken();

        for (const attachment of message.attachments) {
          const mediaId = attachment.fetchMetadata?.mediaId as string | undefined;
          try {
            let result: { data: Buffer; filename?: string };
            if (attachment.url) {
              // image 的 picUrl 可直接下载
              const resp = await globalThis.fetch(attachment.url);
              const data = Buffer.from(await resp.arrayBuffer());
              const filename = attachment.name ?? "image.jpg";
              result = { data, filename };
            } else if (mediaId) {
              // voice/video/file 通过 mediaId 下载
              result = await downloadAppMedia(accessToken, mediaId);
            } else {
              parts.push(`**${attachment.type}**: no download info`);
              continue;
            }
            console.log(
              `  ${attachment.type}: downloaded ${result.data.length} bytes${result.filename ? ` (${result.filename})` : ""}`,
            );
            const extMap: Record<string, string> = {
              image: ".jpg",
              video: ".mp4",
              audio: ".amr",
            };
            mediaFiles.push({
              data: result.data,
              filename:
                attachment.name ??
                result.filename ??
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
              `**${attachment.type}**: ${result.data.length} bytes${result.filename ? ` (${result.filename})` : ""}`,
            );
          } catch {
            parts.push(`**${attachment.type}**: download failed`);
          }
        }

        const replyText = parts.join("\n\n");
        const replyResult = await adapter.postMessage(
          threadId,
          mediaFiles.length > 0 ? { raw: replyText, files: mediaFiles } : replyText,
        );
        console.log(`  Reply sent, ID: ${replyResult.id}`);
      } else {
        const result = await adapter.postMessage(threadId, message.text);
        console.log(`  Reply sent, ID: ${result.id}`);
      }
    },
    processAction: async (event: {
      actionId: string;
      user: { userId: string };
      raw: WeComAppCallbackMessage;
      adapter: unknown;
    }) => {
      const raw = event.raw;
      console.log(
        `\n[Card Action] ${event.user.userId} clicked "${event.actionId}" (taskId=${raw.taskId})`,
      );
      if (raw.responseCode && isWeComAppAdapter(event.adapter)) {
        const replaceName = event.actionId === "approve" ? "已同意" : "已拒绝";
        await event.adapter.updateTemplateCard({ responseCode: raw.responseCode, replaceName });
        console.log(`  Card updated: button -> ${replaceName}`);
      }
    },
  } as never);

  const app = new H3();

  app.all(
    "/webhook",
    fromWebHandler(async (req) => {
      console.log(`[Request] ${req.method} ${req.url}`);
      try {
        return await adapter.handleWebhook(req);
      } catch (e) {
        console.error("[Handler Error]", e);
        return new Response("Internal Error", { status: 500 });
      }
    }),
  );
  app.all("/**", () => new Response("Not Found", { status: 404 }));

  const listener = serve(app, { port: 3000 });
  const address = listener.url ?? `http://localhost:3000`;

  console.log(`\n=== App Callback Server ===`);
  console.log(`Webhook URL: ${address}webhook`);
  console.log(`Configure this URL in WeCom admin panel`);
  console.log(`Waiting for callbacks... (Ctrl+C to stop)`);

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
  if (!CORP_ID || !CORP_SECRET || !AGENT_ID) {
    console.error("Please set WECOM_APP_* in .env");
    return;
  }

  try {
    await getAccessToken();
    await sendMessage();
    await sendImageMessage();
    await recallMessage();
    await sendCard();
    await startServer();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
