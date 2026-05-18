import type { Handler } from "../../types";

export type HandlerFactory<OptionsT> = (opts?: OptionsT) => Handler<OptionsT>;

export function createHandlerError(handler: string, message: string): Error {
  return new Error(`[${handler}] ${message}`);
}

export function createRequiredError(handler: string, name: string): Error {
  return createHandlerError(handler, `Missing required option \`${name}\`.`);
}

export function sseData(data: string): string {
  return `data: ${data}\n\n`;
}

export function sseEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export function sseDone(): string {
  return "data: [DONE]\n\n";
}
