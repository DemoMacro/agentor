import { createProviderExecutedToolFactory, lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

// --- Web Search ---

const webSearchInputSchema = lazySchema(() => zodSchema(z.object({})));

const webSearchOutputSchema = lazySchema(() =>
  zodSchema(
    z.object({
      query: z.string().optional(),
      sources: z
        .array(
          z.object({
            type: z.literal("url"),
            url: z.string(),
          }),
        )
        .optional(),
    }),
  ),
);

const webSearchToolFactory = createProviderExecutedToolFactory<
  // INPUT: model-level input (provider-executed, so empty)
  Record<string, never>,
  // OUTPUT: tool output shape
  {
    query?: string;
    sources?: Array<{ type: "url"; url: string }>;
  },
  // ARGS: user-facing configuration
  {
    /** Force web search even when the model doesn't think it's necessary. */
    forcedSearch?: boolean;
    /**
     * Search strategy. Only applicable to qwen3-max thinking mode.
     * - "enable": enable search
     * - "enable_with_history": enable search with history context
     */
    searchStrategy?: "enable" | "enable_with_history";
  }
>({
  id: "dashscope.web_search",
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema,
});

// --- Code Interpreter ---

const codeInterpreterInputSchema = lazySchema(() => zodSchema(z.object({})));

const codeInterpreterOutputSchema = lazySchema(() =>
  zodSchema(
    z.object({
      code: z.string().optional(),
      outputs: z
        .array(
          z.object({
            type: z.literal("logs"),
            logs: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
);

const codeInterpreterToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  {
    code?: string;
    outputs?: Array<{ type: "logs"; logs?: string }>;
  },
  Record<string, never>
>({
  id: "dashscope.code_interpreter",
  inputSchema: codeInterpreterInputSchema,
  outputSchema: codeInterpreterOutputSchema,
});

// --- Web Extractor ---

const webExtractorInputSchema = lazySchema(() => zodSchema(z.object({})));

const webExtractorOutputSchema = lazySchema(() =>
  zodSchema(
    z.object({
      urls: z.array(z.string()).optional(),
      goal: z.string().optional(),
      output: z.string().optional(),
    }),
  ),
);

const webExtractorToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  {
    urls?: string[];
    goal?: string;
    output?: string;
  },
  Record<string, never>
>({
  id: "dashscope.web_extractor",
  inputSchema: webExtractorInputSchema,
  outputSchema: webExtractorOutputSchema,
});

// --- File Search ---

const fileSearchInputSchema = lazySchema(() => zodSchema(z.object({})));

const fileSearchOutputSchema = lazySchema(() =>
  zodSchema(
    z.object({
      queries: z.array(z.string()).optional(),
      results: z
        .array(
          z.object({
            fileId: z.string().optional(),
            filename: z.string().optional(),
            score: z.number().optional(),
            text: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
);

const fileSearchToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  {
    queries?: string[];
    results?: Array<{
      fileId?: string;
      filename?: string;
      score?: number;
      text?: string;
    }>;
  },
  {
    /** Vector store IDs (knowledge base IDs) to search. Currently only 1 is supported. */
    vectorStoreIds: string[];
  }
>({
  id: "dashscope.file_search",
  inputSchema: fileSearchInputSchema,
  outputSchema: fileSearchOutputSchema,
});

// --- Web Search Image ---

const webSearchImageInputSchema = lazySchema(() => zodSchema(z.object({})));

const webSearchImageOutputSchema = lazySchema(() =>
  zodSchema(
    z.object({
      queries: z.array(z.string()).optional(),
    }),
  ),
);

const webSearchImageToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  {
    queries?: string[];
  },
  Record<string, never>
>({
  id: "dashscope.web_search_image",
  inputSchema: webSearchImageInputSchema,
  outputSchema: webSearchImageOutputSchema,
});

// --- Image Search ---

const imageSearchInputSchema = lazySchema(() => zodSchema(z.object({})));

const imageSearchOutputSchema = lazySchema(() => zodSchema(z.object({})));

const imageSearchToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>({
  id: "dashscope.image_search",
  inputSchema: imageSearchInputSchema,
  outputSchema: imageSearchOutputSchema,
});

// --- MCP ---

const mcpInputSchema = lazySchema(() => zodSchema(z.object({})));

const mcpOutputSchema = lazySchema(() => zodSchema(z.object({})));

const mcpToolFactory = createProviderExecutedToolFactory<
  Record<string, never>,
  Record<string, never>,
  {
    /** Communication protocol with the MCP service, e.g. "sse". */
    serverProtocol: string;
    /** Label to identify the MCP server. */
    serverLabel: string;
    /** URL for the MCP server endpoint. */
    serverUrl: string;
    /** Description of the MCP server. */
    serverDescription?: string;
    /** Headers for authentication, e.g. Authorization. */
    headers?: Record<string, string>;
  }
>({
  id: "dashscope.mcp",
  inputSchema: mcpInputSchema,
  outputSchema: mcpOutputSchema,
});

// --- Tool collections ---

/**
 * Built-in tools for the Responses API.
 * Access via `dashscope.responses.tools`.
 */
export const responsesTools = {
  /**
   * Web search tool. Allows the model to search the internet for up-to-date information.
   *
   * @see https://help.aliyun.com/zh/model-studio/web-search
   */
  webSearch: (args: Parameters<typeof webSearchToolFactory>[0] = {}) => webSearchToolFactory(args),

  /**
   * Code interpreter tool. Allows the model to write and execute code.
   *
   * @see https://help.aliyun.com/zh/model-studio/qwen-code-interpreter
   */
  codeInterpreter: (args: Parameters<typeof codeInterpreterToolFactory>[0] = {}) =>
    codeInterpreterToolFactory(args),

  /**
   * Web extractor tool. Allows the model to access and extract content from web pages.
   * Must be used together with webSearch.
   *
   * @see https://help.aliyun.com/zh/model-studio/web-extractor
   */
  webExtractor: (args: Parameters<typeof webExtractorToolFactory>[0] = {}) =>
    webExtractorToolFactory(args),

  /**
   * File search tool. Search within uploaded or associated knowledge bases.
   *
   * @see https://help.aliyun.com/zh/model-studio/file-search
   */
  fileSearch: (args: Parameters<typeof fileSearchToolFactory>[0]) => fileSearchToolFactory(args),

  /**
   * Text-to-image search. Search images based on text description.
   *
   * @see https://help.aliyun.com/zh/model-studio/web-search-image
   */
  webSearchImage: (args: Parameters<typeof webSearchImageToolFactory>[0] = {}) =>
    webSearchImageToolFactory(args),

  /**
   * Image-to-image search. Search similar images based on an input image.
   *
   * @see https://help.aliyun.com/zh/model-studio/image-search
   */
  imageSearch: (args: Parameters<typeof imageSearchToolFactory>[0] = {}) =>
    imageSearchToolFactory(args),

  /**
   * MCP (Model Context Protocol) tool. Allows calling external services via MCP.
   *
   * @see https://help.aliyun.com/zh/model-studio/mcp
   */
  mcp: (args: Parameters<typeof mcpToolFactory>[0]) => mcpToolFactory(args),
};

export type DashScopeResponsesTools = typeof responsesTools;
