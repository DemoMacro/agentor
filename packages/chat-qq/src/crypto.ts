// https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html
// QQ Bot Webhook 签名验证: Ed25519

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// --- 从 botSecret 派生 32 字节 seed ---

function deriveSeed(botSecret: string): Buffer {
  let seed = botSecret;
  while (seed.length < 32) {
    seed = seed.repeat(2);
  }
  return Buffer.from(seed.slice(0, 32), "utf-8");
}

// --- 构建 Ed25519 PKCS#8 DER (48 bytes) ---

function buildEd25519Pkcs8(seed: Buffer): Buffer {
  // SEQUENCE { INTEGER(0), SEQUENCE { OID(1.3.101.112) }, OCTET STRING { OCTET STRING { seed } } }
  const content = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x00]), // version
    Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]), // Ed25519 OID
    Buffer.from([0x04, 0x22, 0x04, 0x20]), // OCTET STRING wrappers
    seed, // 32 bytes
  ]);
  return Buffer.concat([Buffer.from([0x30, content.length]), content]);
}

function getPrivateKey(botSecret: string) {
  const pkcs8 = buildEd25519Pkcs8(deriveSeed(botSecret));
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

function getPublicKey(botSecret: string) {
  return createPublicKey(getPrivateKey(botSecret));
}

// --- 回调地址验证 (OpCode 13): 用私钥签名 event_ts + plain_token ---

export function signCallbackValidation(
  botSecret: string,
  plainToken: string,
  eventTs: string,
): string {
  const privateKey = getPrivateKey(botSecret);
  const msg = Buffer.from(eventTs + plainToken, "utf-8");
  return sign(undefined, msg, privateKey).toString("hex");
}

// --- 普通事件推送验证: 用公钥验证 X-Signature-Ed25519 ---

export function verifyEventSignature(
  botSecret: string,
  signatureHex: string,
  timestamp: string,
  body: string,
): boolean {
  const publicKey = getPublicKey(botSecret);
  const sig = Buffer.from(signatureHex, "hex");
  const msg = Buffer.from(timestamp + body, "utf-8");
  return verify(undefined, msg, publicKey, sig);
}
