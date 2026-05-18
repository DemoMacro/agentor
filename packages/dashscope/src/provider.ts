import { DashScopeChatLanguageModel } from "./chat";
import { DashScopeCompletionModel } from "./completion";
import { DashScopeEmbeddingModel } from "./embedding";
import { DashScopeImageModel } from "./image";
import { DashScopeRerankingModel } from "./rerank";
import { DashScopeResponsesLanguageModel } from "./responses";
import { DashScopeSpeechModel } from "./speech";
import { responsesTools } from "./tools";
import { DashScopeTranscriptionModel } from "./transcription";
import type {
  DashScopeChatOptions,
  DashScopeProvider,
  DashScopeProviderSettings,
  DashScopeResponsesOptions,
} from "./types";
import { DASHSCOPE_REGION_URLS } from "./types";
import { DashScopeVideoModel } from "./video";

export function createDashScope(options: DashScopeProviderSettings = {}): DashScopeProvider {
  const {
    region = "beijing",
    workspaceId,
    baseURL: explicitBaseURL,
    includeUsage,
    ...rest
  } = options;

  if (region === "germany" && !explicitBaseURL && !workspaceId) {
    throw new Error(
      "workspaceId is required when region is 'germany'. See https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id",
    );
  }

  const baseURL = (explicitBaseURL ?? DASHSCOPE_REGION_URLS[region]).replace(
    "{workspaceId}",
    workspaceId ?? "",
  );

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

  const baseConfig = {
    provider: "dashscope" as const,
    baseURL,
    headers: getHeaders,
    fetch: rest.fetch,
  };

  const createChatModel = (modelId: string) =>
    new DashScopeChatLanguageModel(modelId, { ...baseConfig, includeUsage });

  const createCompletionModel = (modelId: string) =>
    new DashScopeCompletionModel(modelId, { ...baseConfig, provider: "dashscope.completion" });

  const createEmbeddingModel = (modelId: string) =>
    new DashScopeEmbeddingModel(modelId, { ...baseConfig, includeUsage });

  const createRerankingModel = (modelId: string) =>
    new DashScopeRerankingModel(modelId, {
      ...baseConfig,
      provider: "dashscope.rerank",
    });

  const createResponsesModel = (modelId: string) =>
    new DashScopeResponsesLanguageModel(modelId, {
      ...baseConfig,
      provider: "dashscope.responses",
    });

  const responses = Object.assign(createResponsesModel, {
    tools: responsesTools,
  });

  const createImageModel = (modelId: string) =>
    new DashScopeImageModel(modelId, {
      ...baseConfig,
      provider: "dashscope.image",
    });

  const createVideoModel = (modelId: string) =>
    new DashScopeVideoModel(modelId, {
      ...baseConfig,
      provider: "dashscope.video",
    });

  const createSpeechModel = (modelId: string) =>
    new DashScopeSpeechModel(modelId, {
      ...baseConfig,
      provider: "dashscope.speech",
    });

  const createTranscriptionModel = (modelId: string) =>
    new DashScopeTranscriptionModel(modelId, {
      ...baseConfig,
      provider: "dashscope.transcription",
    });

  return Object.assign(createChatModel, {
    specificationVersion: "v3" as const,
    languageModel: createChatModel,
    completionModel: createCompletionModel,
    embeddingModel: createEmbeddingModel,
    rerankingModel: createRerankingModel,
    imageModel: createImageModel,
    videoModel: createVideoModel,
    speechModel: createSpeechModel,
    transcriptionModel: createTranscriptionModel,
    chatOptions: (chatOpts: DashScopeChatOptions) => ({
      providerOptions: { dashscope: chatOpts },
    }),
    responsesOptions: (responsesOpts: DashScopeResponsesOptions) => ({
      providerOptions: { dashscope: responsesOpts },
    }),
    responses,
  }) as DashScopeProvider;
}
