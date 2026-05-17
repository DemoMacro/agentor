// 企业微信 API 请求封装与通用编解码工具

import type { WeComBaseResponse } from "./types";

// https://developer.work.weixin.qq.com/document/path/90455
const WECOM_API_BASE = "https://qyapi.weixin.qq.com";

// https://developer.work.weixin.qq.com/document/path/90455
export class WeComError extends Error {
  constructor(
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    super(`WeCom API error ${errcode}: ${errmsg}`);
    this.name = "WeComError";
  }
}

interface WeComRequestOptions {
  method?: "GET" | "POST";
  url: string;
  body?: unknown;
  params?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  abortSignal?: AbortSignal;
}

export async function wecomRequest<T extends WeComBaseResponse>(
  options: WeComRequestOptions,
): Promise<T> {
  const { method = "GET", url, body, params, fetch: customFetch, abortSignal } = options;

  const fullUrl = new URL(url, WECOM_API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      fullUrl.searchParams.set(key, value);
    }
  }

  const response = await (customFetch ?? globalThis.fetch)(fullUrl.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: abortSignal,
  });

  const data = (await response.json()) as T;

  if (data.errcode !== 0) {
    throw new WeComError(data.errcode, data.errmsg);
  }

  return data;
}

// 企业微信回调使用 XML 格式，支持 <![CDATA[...]]> 和纯文本两种节点格式
export function extractXmlField(xml: string, field: string): string | null {
  const match =
    xml.match(new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${field}>`)) ??
    xml.match(new RegExp(`<${field}>([\\s\\S]*?)</${field}>`));
  return match?.[1] ?? null;
}
