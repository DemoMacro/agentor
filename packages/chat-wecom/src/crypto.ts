// https://developer.work.weixin.qq.com/document/path/90930
// 加解密方案说明: AES-256-CBC + SHA1 签名验证

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { WeComCallbackQuery, WeComEncryptedBody, WeComEncryptedReply } from "./types";

// --- Key helpers ---

export function parseAESKey(encodingAESKey: string): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(`${encodingAESKey}=`, "base64");
  if (key.length !== 32) {
    throw new Error("invalid encodingAESKey");
  }
  const iv = key.subarray(0, 16);
  return { key, iv };
}

// --- PKCS7 padding ---

export function pkcs7Pad(data: Buffer): Buffer {
  const padLength = 32 - (data.length % 32);
  const pad = Buffer.alloc(padLength, padLength);
  return Buffer.concat([data, pad]);
}

export function pkcs7Unpad(data: Buffer): Buffer {
  const padLength = data[data.length - 1];
  if (padLength < 1 || padLength > 32) return data;
  return data.subarray(0, data.length - padLength);
}

// --- SHA1 signature ---

export async function calculateSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
): Promise<string> {
  return createHash("sha1")
    .update([token, timestamp, nonce, encrypted].sort().join(""))
    .digest("hex");
}

export async function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
  expected: string,
): Promise<boolean> {
  const sig = await calculateSignature(token, timestamp, nonce, encrypted);
  return sig === expected;
}

// --- AES-256-CBC encrypt/decrypt ---

export function encodeNetworkOrder(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

export function decodeNetworkOrder(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

export async function encrypt(
  encodingAESKey: string,
  message: string,
  receiveId: string,
): Promise<string> {
  const { key, iv } = parseAESKey(encodingAESKey);

  const random = randomBytes(16);
  const msgBuf = Buffer.from(message);
  const msgLen = encodeNetworkOrder(msgBuf.length);
  const receiveIdBuf = Buffer.from(receiveId);

  const plaintext = pkcs7Pad(Buffer.concat([random, msgLen, msgBuf, receiveIdBuf]));

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

export async function decrypt(
  encodingAESKey: string,
  encrypted: string,
  receiveId: string,
): Promise<string> {
  const { key, iv } = parseAESKey(encodingAESKey);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]),
  );

  const msgLen = decodeNetworkOrder(decrypted, 16);
  const msg = decrypted.subarray(20, 20 + msgLen).toString();
  const decryptedReceiveId = decrypted.subarray(20 + msgLen).toString();

  if (receiveId && decryptedReceiveId !== receiveId) {
    throw new Error(`ReceiveId mismatch: expected ${receiveId}, got ${decryptedReceiveId}`);
  }

  return msg;
}

// --- High-level helpers ---

export async function verifyUrl(
  token: string,
  encodingAESKey: string,
  query: WeComCallbackQuery,
  receiveId = "",
): Promise<string> {
  const valid = await verifySignature(
    token,
    query.timestamp,
    query.nonce,
    query.echostr ?? "",
    query.msg_signature,
  );
  if (!valid) {
    throw new Error("Signature verification failed");
  }
  return decrypt(encodingAESKey, query.echostr ?? "", receiveId);
}

export async function decryptCallback(
  token: string,
  encodingAESKey: string,
  body: WeComEncryptedBody,
  query: WeComCallbackQuery,
  receiveId = "",
): Promise<string> {
  const valid = await verifySignature(
    token,
    query.timestamp,
    query.nonce,
    body.encrypt,
    query.msg_signature,
  );
  if (!valid) {
    throw new Error("Signature verification failed");
  }
  return decrypt(encodingAESKey, body.encrypt, receiveId);
}

export async function encryptReply(
  token: string,
  encodingAESKey: string,
  reply: string,
  receiveId = "",
): Promise<WeComEncryptedReply> {
  const encrypted = await encrypt(encodingAESKey, reply, receiveId);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).slice(2);

  const signature = await calculateSignature(token, timestamp, nonce, encrypted);

  return {
    encrypt: encrypted,
    msgsignature: signature,
    timestamp: Number(timestamp),
    nonce,
  };
}
