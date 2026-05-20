// QQ Bot API 请求封装

import type { QQBotBaseResponse, QQBotTokenResponse, QQBotUploadMediaResponse } from "./types";

const QQ_API_BASE = "https://api.sgroup.qq.com";
const QQ_SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com";

export class QQBotError extends Error {
  constructor(
    public readonly code: number,
    public readonly message: string,
  ) {
    super(`QQBot API error ${code}: ${message}`);
    this.name = "QQBotError";
  }
}

interface QQBotRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  token: string;
  sandbox?: boolean;
  fetch?: typeof globalThis.fetch;
  abortSignal?: AbortSignal;
}

export async function qqBotRequest<T extends QQBotBaseResponse>(
  options: QQBotRequestOptions,
): Promise<T> {
  const {
    method = "GET",
    url,
    body,
    token,
    sandbox = false,
    fetch: customFetch,
    abortSignal,
  } = options;

  const baseUrl = sandbox ? QQ_SANDBOX_API_BASE : QQ_API_BASE;
  const fullUrl = new URL(url, baseUrl);

  const response = await (customFetch ?? globalThis.fetch)(fullUrl.toString(), {
    method,
    headers: {
      Authorization: `QQBot ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: abortSignal,
  });

  const data = (await response.json()) as T;

  if (data.code && data.code !== 0) {
    throw new QQBotError(data.code, data.message ?? "Unknown error");
  }

  return data;
}

// POST /app/getAppAccessToken
export async function getAppAccessToken(
  appId: string,
  clientSecret: string,
  fetch?: typeof globalThis.fetch,
): Promise<QQBotTokenResponse> {
  const fetchFn = fetch ?? globalThis.fetch;
  const response = await fetchFn("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
  });

  const data = (await response.json()) as QQBotTokenResponse;
  return data;
}

// https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/rich-media.html
// 富媒体上传: 获取 file_info 后通过发送消息接口发送
// 支持 file_data (base64) 或 media_url (远程 URL) 两种方式
export async function uploadRichMedia(
  options: {
    url: string;
    file_type: number;
    srv_send_msg?: boolean;
    file_data?: string;
    media_url?: string;
  },
  token: string,
  sandbox?: boolean,
  customFetch?: typeof globalThis.fetch,
): Promise<QQBotUploadMediaResponse> {
  return qqBotRequest<QQBotUploadMediaResponse>({
    method: "POST",
    url: options.url,
    body: {
      file_type: options.file_type,
      url: options.media_url ?? "",
      srv_send_msg: options.srv_send_msg ?? false,
      ...(options.file_data ? { file_data: options.file_data } : {}),
    },
    token,
    sandbox,
    fetch: customFetch,
  });
}
