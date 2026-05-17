// 企业微信应用测试
// 启动 h3 服务器接收回调事件，同时测试消息发送、撤回和 Token 管理

import { H3, fromWebHandler, serve } from "h3";
import { Message, type Adapter } from "chat";
import { createWeComAppAdapter } from "../src";

const CORP_ID = process.env.WECOM_APP_CORP_ID!;
const CORP_SECRET = process.env.WECOM_APP_CORP_SECRET!;
const AGENT_ID = Number(process.env.WECOM_APP_AGENT_ID!);
const APP_TOKEN = process.env.WECOM_APP_TOKEN;
const APP_ENCODING_AES_KEY = process.env.WECOM_APP_ENCODING_AES_KEY;
const APP_USER_ID = process.env.WECOM_APP_USER_ID;

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

// --- 发送应用消息 ---

async function sendMessage() {
  console.log("\n=== Send App Message ===");

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
      console.log(`\n[Message] ${message.author.userName}: ${message.text}`);
      console.log(`  Thread: ${message.threadId}`);

      const result = await adapter.postMessage(threadId, message.text);
      console.log(`  Reply sent, ID: ${result.id}`);
    },
  } as never);

  const app = new H3();

  app.all(
    "/webhook",
    fromWebHandler(async (req) => {
      console.log(`[Request] ${req.method} ${req.url}`);
      console.log(`[Content-Type] ${req.headers.get("content-type")}`);
      console.log(`[Content-Length] ${req.headers.get("content-length")}`);
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
    await recallMessage();
    await startServer();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
