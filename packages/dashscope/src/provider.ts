import { DashScopeChatLanguageModel } from "./chat";
import { DashScopeResponsesLanguageModel } from "./responses";
import { responsesTools } from "./tools";
import type {
  DashScopeChatOptions,
  DashScopeProvider,
  DashScopeProviderSettings,
  DashScopeResponsesOptions,
} from "./types";
import { DASHSCOPE_REGION_BASE_URLS } from "./types";

export function createDashScope(options: DashScopeProviderSettings = {}): DashScopeProvider {
  const {
    region = "beijing",
    workspaceId,
    baseURL: explicitBaseURL,
    videoBaseURL: _explicitVideoBaseURL,
    includeUsage,
    ...rest
  } = options;

  const regionUrls = DASHSCOPE_REGION_BASE_URLS[region];
  const baseURL = (explicitBaseURL ?? regionUrls.baseURL).replace(
    "{workspaceId}",
    workspaceId ?? "",
  );

  if (region === "germany" && !explicitBaseURL && !workspaceId) {
    throw new Error(
      "workspaceId is required when region is 'germany'. See https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id",
    );
  }

  const apiKey = rest.apiKey ?? process.env.DASHSCOPE_API_KEY;

  const getHeaders = () => {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (rest.headers) {
      Object.assign(headers, rest.headers);
    }
    return headers;
  };

  const chatConfig = {
    provider: "dashscope",
    baseURL,
    headers: getHeaders,
    fetch: rest.fetch,
    includeUsage,
  };

  const createChatModel = (modelId: string) => new DashScopeChatLanguageModel(modelId, chatConfig);

  const createResponsesModel = (modelId: string) =>
    new DashScopeResponsesLanguageModel(modelId, {
      provider: "dashscope.responses",
      baseURL,
      headers: getHeaders,
      fetch: rest.fetch,
    });

  const responses = Object.assign(createResponsesModel, {
    tools: responsesTools,
  });

  return Object.assign(createChatModel, {
    languageModel: createChatModel,
    chatOptions: (chatOpts: DashScopeChatOptions) => ({
      providerOptions: { dashscope: chatOpts },
    }),
    responsesOptions: (responsesOpts: DashScopeResponsesOptions) => ({
      providerOptions: { dashscope: responsesOpts },
    }),
    responses,
  }) as DashScopeProvider;
}
