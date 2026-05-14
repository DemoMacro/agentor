export * from "./embedding";
export * from "./rerank";
export * from "./tools";
export * from "./types";
export { createDashScope } from "./provider";

import { createDashScope } from "./provider";

export const dashscope = createDashScope();
