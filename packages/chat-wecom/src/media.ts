// 企业微信媒体上传工具
// 支持应用消息上传和 Webhook 上传

import type { FileUpload } from "chat";

import { decryptMedia } from "./crypto";
import type { WeComMediaUploadResponse } from "./types";
import { WECOM_API_BASE, wecomUpload } from "./utils";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp"]);
const VOICE_EXTENSIONS = new Set(["amr", "mp3", "wav"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi"]);

export function inferMediaType(
  filename: string,
  mimeType?: string,
): "image" | "voice" | "video" | "file" {
  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "voice";
    if (mimeType.startsWith("video/")) return "video";
  }

  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VOICE_EXTENSIONS.has(ext)) return "voice";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  return "file";
}

export interface FetchEncryptedMediaResult {
  data: Buffer;
  filename?: string;
}

// 下载并解密企业微信加密媒体文件
// 从 Content-Disposition 或 URL 中提取原始文件名
export async function fetchEncryptedMedia(
  url: string,
  aeskey: string,
  fetch?: typeof globalThis.fetch,
): Promise<FetchEncryptedMediaResult> {
  const response = await (fetch ?? globalThis.fetch)(url);
  const encrypted = Buffer.from(await response.arrayBuffer());
  const data = decryptMedia(encrypted, aeskey);

  const filename = extractFilename(response.headers, url);
  return { data, filename };
}

function extractFilename(headers: Headers, url: string): string | undefined {
  const disposition = headers.get("content-disposition");
  if (disposition) {
    // filename*=charset'language'encoded_name (RFC 5987)
    const utf8Match = disposition.match(/filename\*=\s*[^']+'[^']*'([^;]+)/i);
    if (utf8Match) {
      const decoded = decodeURIComponent(utf8Match[1].trim());
      if (decoded) return decoded;
    }
    // filename="name" or filename=name
    const match =
      disposition.match(/filename\s*=\s*"([^"]+)"/i) ??
      disposition.match(/filename\s*=\s*([^";\s]+)/i);
    if (match) {
      const name = match[1].trim();
      if (name) return name;
    }
  }
  // 从 URL 路径提取
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop();
    if (lastSegment && lastSegment.includes(".")) return lastSegment;
  } catch {}
  return undefined;
}

// POST /cgi-bin/media/upload?access_token=X&type=TYPE
export async function uploadAppMedia(
  accessToken: string,
  file: FileUpload,
  fetch?: typeof globalThis.fetch,
): Promise<string> {
  const mediaType = inferMediaType(file.filename, file.mimeType);
  const result = await wecomUpload<WeComMediaUploadResponse>({
    url: "/cgi-bin/media/upload",
    params: { access_token: accessToken, type: mediaType },
    fieldName: "media",
    fileName: file.filename,
    data: file.data,
    fetch,
  });
  return result.media_id!;
}

// GET /cgi-bin/media/get?access_token=TOKEN&media_id=MEDIA_ID
export async function downloadAppMedia(
  accessToken: string,
  mediaId: string,
  fetch?: typeof globalThis.fetch,
): Promise<FetchEncryptedMediaResult> {
  const fetchFn = fetch ?? globalThis.fetch;
  const url = new URL("/cgi-bin/media/get", WECOM_API_BASE);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("media_id", mediaId);
  const response = await fetchFn(url);
  const data = Buffer.from(await response.arrayBuffer());
  const filename = extractFilename(response.headers, url.toString());
  return { data, filename };
}

// POST /cgi-bin/webhook/upload_media?key=KEY&type=TYPE
export async function uploadWebhookMedia(
  key: string,
  file: FileUpload,
  fetch?: typeof globalThis.fetch,
): Promise<string> {
  const mediaType = inferMediaType(file.filename, file.mimeType);
  // webhook upload_media 仅支持 file 和 voice
  const uploadType = mediaType === "voice" ? "voice" : "file";
  const result = await wecomUpload<WeComMediaUploadResponse>({
    url: "/cgi-bin/webhook/upload_media",
    params: { key, type: uploadType },
    fieldName: "media",
    fileName: file.filename,
    data: file.data,
    fetch,
  });
  return result.media_id!;
}
