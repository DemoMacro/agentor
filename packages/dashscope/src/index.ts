export * from "./completion";
export * from "./embedding";
export * from "./image";
export * from "./rerank";
export * from "./speech";
export * from "./tools";
export * from "./transcription";
export * from "./types";
export * from "./video";
export { createDashScope } from "./provider";

import { createDashScope } from "./provider";

export const dashscope = createDashScope();
