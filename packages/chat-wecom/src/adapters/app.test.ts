import type { CardElement, ChatInstance } from "chat";
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

import { encrypt, calculateSignature } from "../crypto";
import type { WeComTemplateCard } from "../types";
import { createWeComAppAdapter, WeComAppAdapter, parseCallbackXml } from "./app";

const CONFIG = {
  corpId: "corp123",
  corpSecret: "secret456",
  agentId: 1000001,
};

describe("createWeComAppAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates adapter from explicit config", () => {
    const adapter = createWeComAppAdapter(CONFIG);
    expect(adapter).toBeInstanceOf(WeComAppAdapter);
    expect(adapter.name).toBe("wecom-app");
  });

  it("reads environment variables as fallback", () => {
    process.env.WECOM_APP_CORP_ID = "env-corp";
    process.env.WECOM_APP_CORP_SECRET = "env-secret";
    process.env.WECOM_APP_AGENT_ID = "2000002";
    const adapter = createWeComAppAdapter();
    expect(adapter).toBeInstanceOf(WeComAppAdapter);
  });

  it("throws when corpId is missing", () => {
    expect(() => createWeComAppAdapter()).toThrow("WECOM_APP_CORP_ID");
  });

  it("throws when corpSecret is missing", () => {
    process.env.WECOM_APP_CORP_ID = "corp";
    expect(() => createWeComAppAdapter()).toThrow("WECOM_APP_CORP_SECRET");
  });

  it("throws when agentId is missing", () => {
    process.env.WECOM_APP_CORP_ID = "corp";
    process.env.WECOM_APP_CORP_SECRET = "secret";
    expect(() => createWeComAppAdapter()).toThrow("WECOM_APP_AGENT_ID");
  });

  it("explicit config overrides env vars", () => {
    process.env.WECOM_APP_CORP_ID = "env-corp";
    const adapter = createWeComAppAdapter(CONFIG);
    expect(adapter).toBeInstanceOf(WeComAppAdapter);
  });
});

describe("WeComAppAdapter threadId", () => {
  const adapter = createWeComAppAdapter(CONFIG);

  it("encodes with corpId and userId", () => {
    const encoded = adapter.encodeThreadId({ corpId: "corp123", userId: "user001" });
    expect(encoded).toBe("wecom-app:corp123:user001");
  });

  it("decodes threadId", () => {
    const decoded = adapter.decodeThreadId("wecom-app:corp123:user001");
    expect(decoded).toEqual({ corpId: "corp123", userId: "user001" });
  });

  it("roundtrips encode → decode", () => {
    const data = { corpId: "corpABC", userId: "userXYZ" };
    const encoded = adapter.encodeThreadId(data);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(data);
  });

  it("extracts channel ID (userId) from threadId", () => {
    const threadId = adapter.encodeThreadId({ corpId: "corp123", userId: "user001" });
    expect(adapter.channelIdFromThreadId(threadId)).toBe("user001");
  });
});

describe("parseCallbackXml", () => {
  it("parses text message XML", () => {
    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[corpAgent]]></ToUserName>",
      "<FromUserName><![CDATA[user001]]></FromUserName>",
      "<CreateTime>1700000000</CreateTime>",
      "<MsgType><![CDATA[text]]></MsgType>",
      "<Content><![CDATA[Hello]]></Content>",
      "<MsgId>123456</MsgId>",
      "</xml>",
    ].join("");

    const msg = parseCallbackXml(xml);
    expect(msg.toUserName).toBe("corpAgent");
    expect(msg.fromUserName).toBe("user001");
    expect(msg.createTime).toBe(1700000000);
    expect(msg.msgType).toBe("text");
    expect(msg.content).toBe("Hello");
    expect(msg.msgId).toBe("123456");
  });

  it("parses image message XML", () => {
    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[corpAgent]]></ToUserName>",
      "<FromUserName><![CDATA[user002]]></FromUserName>",
      "<CreateTime>1700000001</CreateTime>",
      "<MsgType><![CDATA[image]]></MsgType>",
      "<PicUrl><![CDATA[https://example.com/img.jpg]]></PicUrl>",
      "<MediaId><![CDATA[media_123]]></MediaId>",
      "<MsgId>789012</MsgId>",
      "</xml>",
    ].join("");

    const msg = parseCallbackXml(xml);
    expect(msg.msgType).toBe("image");
    expect(msg.picUrl).toBe("https://example.com/img.jpg");
    expect(msg.mediaId).toBe("media_123");
  });

  it("handles missing optional fields", () => {
    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[corpAgent]]></ToUserName>",
      "<FromUserName><![CDATA[user003]]></FromUserName>",
      "<CreateTime>0</CreateTime>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "</xml>",
    ].join("");

    const msg = parseCallbackXml(xml);
    expect(msg.msgType).toBe("event");
    expect(msg.content).toBeUndefined();
    expect(msg.msgId).toBeUndefined();
  });
});

// --- 模板卡片回调（template_card_event）---

const AES_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY";
const CARD_CONFIG = {
  corpId: "corp123",
  corpSecret: "secret456",
  agentId: 1000001,
  token: "test-token",
  encodingAESKey: AES_KEY,
};

describe("parseCallbackXml — template card event", () => {
  it("parses template_card_event fields", () => {
    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[corpAgent]]></ToUserName>",
      "<FromUserName><![CDATA[user001]]></FromUserName>",
      "<CreateTime>1700000000</CreateTime>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[template_card_event]]></Event>",
      "<EventKey><![CDATA[approve]]></EventKey>",
      "<TaskId><![CDATA[task123]]></TaskId>",
      "<CardType><![CDATA[button_interaction]]></CardType>",
      "<ResponseCode><![CDATA[rc456]]></ResponseCode>",
      "<AgentID>1</AgentID>",
      "</xml>",
    ].join("");
    const msg = parseCallbackXml(xml);
    expect(msg.event).toBe("template_card_event");
    expect(msg.eventKey).toBe("approve");
    expect(msg.taskId).toBe("task123");
    expect(msg.cardType).toBe("button_interaction");
    expect(msg.responseCode).toBe("rc456");
  });

  it("parses SelectedItems (vote / multiple_interaction)", () => {
    const xml = [
      "<xml>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[template_card_event]]></Event>",
      "<SelectedItems>",
      "<SelectedItem>",
      "<QuestionKey><![CDATA[q1]]></QuestionKey>",
      "<OptionIds><OptionId><![CDATA[o1]]></OptionId><OptionId><![CDATA[o2]]></OptionId></OptionIds>",
      "</SelectedItem>",
      "<SelectedItem>",
      "<QuestionKey><![CDATA[q2]]></QuestionKey>",
      "<OptionIds><OptionId><![CDATA[o3]]></OptionId></OptionIds>",
      "</SelectedItem>",
      "</SelectedItems>",
      "</xml>",
    ].join("");
    const msg = parseCallbackXml(xml);
    expect(msg.selectedItems).toEqual([
      { questionKey: "q1", optionIds: ["o1", "o2"] },
      { questionKey: "q2", optionIds: ["o3"] },
    ]);
  });

  it("parses template_card_menu_event without selectedItems", () => {
    const xml = [
      "<xml>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[template_card_menu_event]]></Event>",
      "<EventKey><![CDATA[menu1]]></EventKey>",
      "<TaskId><![CDATA[task789]]></TaskId>",
      "<ResponseCode><![CDATA[rc000]]></ResponseCode>",
      "</xml>",
    ].join("");
    const msg = parseCallbackXml(xml);
    expect(msg.event).toBe("template_card_menu_event");
    expect(msg.eventKey).toBe("menu1");
    expect(msg.selectedItems).toBeUndefined();
  });
});

// --- handleWebhook 卡片回调路由（真实加解密）---

function createMockChat() {
  return {
    processAction: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildCallbackRequest(messageXml: string): Promise<Request> {
  const encrypted = await encrypt(AES_KEY, messageXml, CARD_CONFIG.corpId);
  const timestamp = "1700000000";
  const nonce = "nonce1";
  const sig = await calculateSignature(CARD_CONFIG.token, timestamp, nonce, encrypted);
  const url = `https://example.com/cb?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`;
  const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
  return new Request(url, { method: "POST", body });
}

let lastUpdateBody: Record<string, unknown> | null = null;

function mockWeComFetch(url: string, init?: RequestInit): Promise<Response> {
  const pathname = new URL(url).pathname;
  let payload: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
  if (pathname === "/cgi-bin/gettoken") {
    payload = { errcode: 0, errmsg: "ok", access_token: "tok", expires_in: 7200 };
  } else if (pathname === "/cgi-bin/message/send") {
    payload = { errcode: 0, errmsg: "ok", msgid: "msg1", response_code: "sendrc" };
  } else if (pathname === "/cgi-bin/message/update_template_card") {
    lastUpdateBody = init?.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : null;
  }
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function makeAdapter() {
  return new WeComAppAdapter({
    ...CARD_CONFIG,
    fetch: mockWeComFetch as typeof globalThis.fetch,
  });
}

describe("WeComAppAdapter handleWebhook — card callback routing", () => {
  it("routes template_card_event to processAction", async () => {
    const chat = createMockChat();
    const adapter = makeAdapter();
    await adapter.initialize(chat as unknown as ChatInstance);

    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[corp123]]></ToUserName>",
      "<FromUserName><![CDATA[user001]]></FromUserName>",
      "<CreateTime>1700000000</CreateTime>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[template_card_event]]></Event>",
      "<EventKey><![CDATA[approve]]></EventKey>",
      "<TaskId><![CDATA[task123]]></TaskId>",
      "<CardType><![CDATA[button_interaction]]></CardType>",
      "<ResponseCode><![CDATA[rc456]]></ResponseCode>",
      "</xml>",
    ].join("");

    const response = await adapter.handleWebhook(await buildCallbackRequest(xml));
    expect(response.status).toBe(200);

    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const event = chat.processAction.mock.calls[0][0];
    expect(event.actionId).toBe("approve");
    expect(event.threadId).toBe("wecom-app:corp123:user001");
    expect(event.messageId).toBe("task123");
    expect(event.value).toBe("approve");
    expect(event.user.userId).toBe("user001");
    expect(event.raw.taskId).toBe("task123");
    expect(event.raw.responseCode).toBe("rc456");
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("routes text message to processMessage", async () => {
    const chat = createMockChat();
    const adapter = makeAdapter();
    await adapter.initialize(chat as unknown as ChatInstance);

    const xml = [
      "<xml>",
      "<FromUserName><![CDATA[user001]]></FromUserName>",
      "<CreateTime>1700000000</CreateTime>",
      "<MsgType><![CDATA[text]]></MsgType>",
      "<Content><![CDATA[hello]]></Content>",
      "</xml>",
    ].join("");

    await adapter.handleWebhook(await buildCallbackRequest(xml));
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    expect(chat.processAction).not.toHaveBeenCalled();
  });

  it("ignores non-card events (enter_agent)", async () => {
    const chat = createMockChat();
    const adapter = makeAdapter();
    await adapter.initialize(chat as unknown as ChatInstance);

    const xml = [
      "<xml>",
      "<FromUserName><![CDATA[user001]]></FromUserName>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[enter_agent]]></Event>",
      "</xml>",
    ].join("");

    await adapter.handleWebhook(await buildCallbackRequest(xml));
    expect(chat.processAction).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});

describe("WeComAppAdapter template card send / update", () => {
  it("postMessage(card) returns taskId and responseCode in raw", async () => {
    const adapter = makeAdapter();
    const card: CardElement = {
      type: "card",
      title: "审批",
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "approve", label: "同意", style: "primary" }],
        },
      ],
    };
    const result = await adapter.postMessage("wecom-app:corp123:user001", card);
    expect(result.id).toBe("msg1");
    expect(result.raw.taskId).toBeTruthy();
    expect(result.raw.responseCode).toBe("sendrc");
  });

  it("updateTemplateCard sends button.replace_name with default atall", async () => {
    lastUpdateBody = null;
    const adapter = makeAdapter();
    await adapter.updateTemplateCard({ responseCode: "rc1", replaceName: "已处理" });
    expect(lastUpdateBody).toMatchObject({
      agentid: 1000001,
      response_code: "rc1",
      atall: 1,
      button: { replace_name: "已处理" },
    });
  });

  it("updateTemplateCard sends template_card with explicit userids", async () => {
    lastUpdateBody = null;
    const adapter = makeAdapter();
    const newCard: WeComTemplateCard = {
      card_type: "text_notice",
      main_title: { title: "已更新" },
    };
    await adapter.updateTemplateCard({
      responseCode: "rc2",
      userIds: ["u1", "u2"],
      templateCard: newCard,
    });
    expect(lastUpdateBody).toMatchObject({
      response_code: "rc2",
      userids: ["u1", "u2"],
      template_card: newCard,
    });
    expect(lastUpdateBody).not.toHaveProperty("atall");
    expect(lastUpdateBody).not.toHaveProperty("button");
  });

  it("updateTemplateCard throws without replaceName or templateCard", async () => {
    const adapter = makeAdapter();
    await expect(adapter.updateTemplateCard({ responseCode: "rc3" })).rejects.toThrow(
      "replaceName",
    );
  });
});
