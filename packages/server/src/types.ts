import type { createProviderRegistry } from "ai";
import type { H3 } from "h3";
import type { Storage } from "unstorage";

export type ProviderRegistry = ReturnType<typeof createProviderRegistry>;

export interface ServerModel {
  id: string;
  display_name?: string;
  created?: number;
  owned_by?: string;
}

export interface ServerContext {
  registry: ProviderRegistry;
  models?: Array<string | ServerModel>;
  fetch?: typeof globalThis.fetch;
  storage?: Storage;
}

export interface Handler {
  name: string;
  path: string;
  register(app: H3, context: ServerContext): void;
}

export interface ServerOptions {
  registry: ProviderRegistry;
  handlers: Handler[];
  models?: Array<string | ServerModel>;
  fetch?: typeof globalThis.fetch;
  storage?: Storage;
}
