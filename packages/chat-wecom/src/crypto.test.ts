import { createCipheriv } from "node:crypto";

import { describe, it, expect } from "vite-plus/test";

import {
  encrypt,
  decrypt,
  calculateSignature,
  verifySignature,
  pkcs7Pad,
  pkcs7Unpad,
  parseAESKey,
  decryptMedia,
} from "./crypto";

describe("parseAESKey", () => {
  it("parses valid base64-encoded AES key", () => {
    // 43 chars base64 → 32 bytes after adding padding '='
    const key = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY";
    const result = parseAESKey(key);
    expect(result.key).toBeInstanceOf(Buffer);
    expect(result.key.length).toBe(32);
    expect(result.iv).toBeInstanceOf(Buffer);
    expect(result.iv.length).toBe(16);
  });

  it("throws on invalid key", () => {
    expect(() => parseAESKey("a")).toThrow();
  });
});

describe("PKCS7 padding", () => {
  it("pads and unpads roundtrip", () => {
    const data = Buffer.from("hello");
    const padded = pkcs7Pad(data);
    expect(padded.length % 32).toBe(0);
    const unpadded = pkcs7Unpad(padded);
    expect(unpadded.toString()).toBe("hello");
  });

  it("handles data already aligned to block size", () => {
    const data = Buffer.alloc(32, "a");
    const padded = pkcs7Pad(data);
    expect(padded.length).toBe(64);
    const unpadded = pkcs7Unpad(padded);
    expect(unpadded.toString()).toBe("a".repeat(32));
  });
});

describe("encrypt / decrypt", () => {
  const encodingAESKey = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY";
  const receiveId = "testCorpId";

  it("roundtrips encrypt → decrypt", async () => {
    const message = "Hello, World!";
    const encrypted = await encrypt(encodingAESKey, message, receiveId);
    const decrypted = await decrypt(encodingAESKey, encrypted, receiveId);
    expect(decrypted).toBe(message);
  });

  it("roundtrips with empty receiveId", async () => {
    const message = "test message";
    const encrypted = await encrypt(encodingAESKey, message, "");
    const decrypted = await decrypt(encodingAESKey, encrypted, "");
    expect(decrypted).toBe(message);
  });

  it("throws on receiveId mismatch", async () => {
    const encrypted = await encrypt(encodingAESKey, "msg", "corpA");
    await expect(decrypt(encodingAESKey, encrypted, "corpB")).rejects.toThrow("ReceiveId mismatch");
  });
});

describe("SHA1 signature", () => {
  it("calculates and verifies signature", async () => {
    const sig = await calculateSignature("token", "1234", "nonce", "encrypted");
    const valid = await verifySignature("token", "1234", "nonce", "encrypted", sig);
    expect(valid).toBe(true);
  });

  it("rejects tampered signature", async () => {
    const valid = await verifySignature("token", "1234", "nonce", "encrypted", "invalid");
    expect(valid).toBe(false);
  });

  it("rejects wrong token", async () => {
    const sig = await calculateSignature("token", "1234", "nonce", "encrypted");
    const valid = await verifySignature("wrong", "1234", "nonce", "encrypted", sig);
    expect(valid).toBe(false);
  });
});

describe("decryptMedia", () => {
  it("roundtrips media encrypt/decrypt", () => {
    const aeskey = Buffer.alloc(32).toString("base64");
    const key = Buffer.from(aeskey, "base64");
    expect(key.length).toBe(32);
    const iv = key.subarray(0, 16);

    const plaintext = Buffer.from("media content");
    const padLength = 32 - (plaintext.length % 32);
    const padded = Buffer.concat([plaintext, Buffer.alloc(padLength, padLength)]);

    const cipher = createCipheriv("aes-256-cbc", key, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    const decrypted = decryptMedia(encrypted, aeskey);
    expect(decrypted.toString()).toBe("media content");
  });
});
