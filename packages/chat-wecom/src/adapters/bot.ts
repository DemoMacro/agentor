// 智能机器人: 统一入口，通过 mode 切换回调/WebSocket 模式

export { WeComBotCallbackAdapter, createWeComBotCallbackAdapter } from "./bot-callback";
export { WeComBotWebSocketAdapter, createWeComBotWebSocketAdapter } from "./bot-websocket";

import type { WeComBotCallbackConfig, WeComBotWebSocketConfig } from "../types";
import { createWeComBotCallbackAdapter, WeComBotCallbackAdapter } from "./bot-callback";
import { createWeComBotWebSocketAdapter, WeComBotWebSocketAdapter } from "./bot-websocket";

export type WeComBotFactoryConfig = Partial<Omit<WeComBotCallbackConfig, "mode">> &
  Partial<Omit<WeComBotWebSocketConfig, "mode">> & { mode?: "callback" | "websocket" };

export function createWeComBotAdapter(
  config?: WeComBotFactoryConfig,
): WeComBotCallbackAdapter | WeComBotWebSocketAdapter {
  const mode = config?.mode ?? (process.env.WECOM_BOT_MODE as "callback" | "websocket" | undefined);

  if (mode === "callback") {
    return createWeComBotCallbackAdapter({
      token: config?.token,
      encodingAESKey: config?.encodingAESKey,
      userName: config?.userName,
      fetch: config?.fetch,
    });
  }

  return createWeComBotWebSocketAdapter({
    botId: config?.botId,
    secret: config?.secret,
    userName: config?.userName,
    wsUrl: config?.wsUrl,
    WebSocket: config?.WebSocket,
  });
}
