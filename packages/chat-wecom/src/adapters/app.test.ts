import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";

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
