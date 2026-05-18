import { generateText, hasToolCall, streamText, tool } from "ai";
import { z } from "zod/v4";

import { dashscope } from "../src";

// --- Basic response ---

async function basicResponse() {
  console.log("=== Basic Response ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    prompt: "Introduce the DashScope platform in one sentence.",
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
  console.log("FinishReason:", result.finishReason);
}

// --- Response with streaming ---

async function responseStream() {
  console.log("\n=== Response Stream ===");

  const result = streamText({
    model: dashscope.responses("qwen3.5-flash"),
    prompt: "Explain MCP (Model Context Protocol) in three sentences.",
  });

  for await (const part of result.textStream) {
    process.stdout.write(part);
  }
  console.log();

  const usage = await result.usage;
  console.log("Usage:", usage);
}

// --- Response with web search ---

async function responseWithWebSearch() {
  console.log("\n=== Response with Web Search ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      search: dashscope.responses.tools.webSearch(),
    },
    prompt: "What are the latest tech news in May 2026?",
  });

  console.log("Text:", result.text);
  for (const source of result.sources) {
    if (source.sourceType === "url") {
      console.log(`  - ${source.title ?? "untitled"}: ${source.url}`);
    }
  }
}

// --- Response with code interpreter ---

async function responseWithCodeInterpreter() {
  console.log("\n=== Response with Code Interpreter ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      code: dashscope.responses.tools.codeInterpreter(),
    },
    prompt: "Calculate the sum of the first 20 Fibonacci numbers.",
  });

  console.log("Text:", result.text);
}

// --- Response with web extractor ---

async function responseWithWebExtractor() {
  console.log("\n=== Response with Web Extractor ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      search: dashscope.responses.tools.webSearch(),
      extractor: dashscope.responses.tools.webExtractor(),
    },
    prompt:
      "Search for Alibaba Cloud official website and extract key product information from the homepage.",
  });

  console.log("Text:", result.text);
  for (const source of result.sources) {
    if (source.sourceType === "url") {
      console.log(`  - ${source.title ?? "untitled"}: ${source.url}`);
    }
  }
}

// --- Response with web search image ---

async function responseWithWebSearchImage() {
  console.log("\n=== Response with Web Search Image ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      searchImage: dashscope.responses.tools.webSearchImage(),
    },
    prompt: "Search for images of the Eiffel Tower.",
  });

  console.log("Text:", result.text);
}

// --- Response with image search ---

async function responseWithImageSearch() {
  console.log("\n=== Response with Image Search ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      imageSearch: dashscope.responses.tools.imageSearch(),
    },
    prompt: "Find similar images to a sunset landscape.",
  });

  console.log("Text:", result.text);
}

// --- Response with function tool ---

async function responseWithFunctionTool() {
  console.log("\n=== Response with Function Tool ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      weather: tool({
        description: "Get weather information for a city",
        inputSchema: z.object({
          city: z.string().describe("City name"),
        }),
        execute: async ({ city }) => {
          return `${city}: Cloudy, 22°C`;
        },
      }),
    },
    prompt: "What's the weather in Hangzhou and Shenzhen?",
    stopWhen: hasToolCall("weather"),
  });

  console.log("Text:", result.text);
  for (const step of result.steps) {
    if (step.toolCalls.length > 0) {
      console.log(
        "  Tool calls:",
        step.toolCalls.map((t) => `${t.toolName}(${JSON.stringify(t.input)})`),
      );
    }
    if (step.toolResults.length > 0) {
      console.log(
        "  Tool results:",
        step.toolResults.map((t) => `${t.toolName} → ${JSON.stringify(t.output)}`),
      );
    }
  }
}

// --- Response with reasoning ---

async function responseWithReasoning() {
  console.log("\n=== Response with Reasoning ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        reasoning: { effort: "high" },
      },
    },
    prompt: "If a farmer has 17 sheep and all but 9 die, how many are left?",
  });

  console.log("Text:", result.text);
  console.log("Reasoning:", result.reasoning);
}

// --- Response with multi-turn (previousResponseId) ---

async function responseMultiTurn() {
  console.log("\n=== Response Multi-Turn ===");

  const first = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        instructions: "You are a helpful assistant.",
      },
    },
    prompt: "My name is Alice, please remember it.",
  });

  console.log("Turn 1:", first.text);
  console.log("Response ID:", first.response?.id);

  if (!first.response?.id) {
    console.log("Skipping turn 2: no response ID returned.");
    return;
  }

  const second = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        previousResponseId: first.response.id,
      },
    },
    prompt: "What is my name?",
  });

  console.log("Turn 2:", second.text);
}

// --- Response with MCP tool ---
// Note: DashScope MCP requires SSE protocol. The MCP server must be reachable
// from DashScope's backend. Use a DashScope-hosted MCP service or ensure the
// external MCP server supports SSE transport (e.g., URL ending with /sse).

async function responseWithMcp() {
  console.log("\n=== Response with MCP ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-flash"),
    tools: {
      mcp: dashscope.responses.tools.mcp({
        serverProtocol: "sse",
        serverLabel: "WebParser",
        serverDescription: "Web content parsing MCP service",
        serverUrl: "https://dashscope.aliyuncs.com/api/v1/mcps/WebParser/sse",
        headers: {
          Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
      }),
    },
    prompt: "Parse the content of https://httpbin.org/html and summarize it.",
  });

  console.log("Text:", result.text);
}

// --- Run ---

async function main() {
  try {
    await basicResponse();
    await responseStream();
    await responseWithWebSearch();
    await responseWithCodeInterpreter();
    await responseWithWebExtractor();
    await responseWithWebSearchImage();
    await responseWithImageSearch();
    await responseWithFunctionTool();
    await responseWithReasoning();
    await responseMultiTurn();
    await responseWithMcp();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
