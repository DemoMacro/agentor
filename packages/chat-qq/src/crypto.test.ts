import { createPrivateKey, sign } from "node:crypto";

import { describe, it, expect } from "vite-plus/test";

import { signCallbackValidation, verifyEventSignature } from "./crypto";

const BOT_SECRET = "DG5g3B4j9X2KOErG";

function buildPrivateKey(botSecret: string) {
  let seed = botSecret;
  while (seed.length < 32) seed = seed.repeat(2);
  const seedBuf = Buffer.from(seed.slice(0, 32), "utf-8");
  const content = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x00]),
    Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]),
    Buffer.from([0x04, 0x22, 0x04, 0x20]),
    seedBuf,
  ]);
  const pkcs8 = Buffer.concat([Buffer.from([0x30, content.length]), content]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

describe("signCallbackValidation", () => {
  it("produces correct signature matching official docs", () => {
    const plainToken = "Arq0D5A61EgUu4OxUvOp";
    const eventTs = "1725442341";
    const sig = signCallbackValidation(BOT_SECRET, plainToken, eventTs);
    const expected =
      "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706";
    expect(sig).toBe(expected);
  });

  it("produces different signatures for different inputs", () => {
    const sig1 = signCallbackValidation(BOT_SECRET, "token1", "1000");
    const sig2 = signCallbackValidation(BOT_SECRET, "token2", "1000");
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifyEventSignature", () => {
  it("verifies a valid signature", () => {
    const body = '{"op":0,"t":"AT_MESSAGE_CREATE"}';
    const timestamp = "1725442341";
    const msg = Buffer.from(timestamp + body, "utf-8");
    const privateKey = buildPrivateKey(BOT_SECRET);
    const signatureHex = sign(undefined, msg, privateKey).toString("hex");

    const valid = verifyEventSignature(BOT_SECRET, signatureHex, timestamp, body);
    expect(valid).toBe(true);
  });

  it("rejects invalid signature", () => {
    const valid = verifyEventSignature(BOT_SECRET, "invalid_hex", "1234", "body");
    expect(valid).toBe(false);
  });

  it("rejects wrong secret", () => {
    const valid = verifyEventSignature(
      "WrongSecret12345678901234567890",
      "00".repeat(64),
      "1234",
      "body",
    );
    expect(valid).toBe(false);
  });
});
