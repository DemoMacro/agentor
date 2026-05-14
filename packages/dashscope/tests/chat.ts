import { dashscope } from "../src";
import { generateText, hasToolCall, streamText, tool } from "ai";
import { z } from "zod/v4";

// --- Basic chat ---

async function basicChat() {
  console.log("=== Basic Chat ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    prompt: "Introduce yourself in one sentence.",
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
  console.log("FinishReason:", result.finishReason);
}

// --- Chat with streaming ---

async function chatStream() {
  console.log("\n=== Chat Stream ===");

  const result = streamText({
    model: dashscope("qwen3.5-flash"),
    prompt: "Explain the Vercel AI SDK in three sentences.",
  });

  for await (const part of result.textStream) {
    process.stdout.write(part);
  }
  console.log();

  const usage = await result.usage;
  console.log("Usage:", usage);
}

// --- Chat with function tool ---

async function chatWithFunctionTool() {
  console.log("\n=== Chat with Function Tool ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    tools: {
      weather: tool({
        description: "Get weather information for a city",
        inputSchema: z.object({
          city: z.string().describe("City name"),
        }),
        execute: async ({ city }) => {
          return `${city}: Sunny, 25°C`;
        },
      }),
    },
    prompt: "What's the weather in Beijing and Shanghai?",
    stopWhen: hasToolCall("weather"),
  });

  console.log("Text:", result.text);
  console.log("Steps:", result.steps.length);
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

// --- Chat with web search (enableSearch) ---

async function chatWithWebSearch() {
  console.log("\n=== Chat with Web Search ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        enableSearch: true,
      },
    },
    prompt: "What are the latest tech news today?",
  });

  console.log("Text:", result.text);
}

// --- Chat with code interpreter (enableCodeInterpreter) ---

async function chatWithCodeInterpreter() {
  console.log("\n=== Chat with Code Interpreter ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        enableCodeInterpreter: true,
        enableThinking: true,
      },
    },
    prompt: "Calculate the sum of the first 20 Fibonacci numbers.",
  });

  console.log("Text:", result.text);
}

// --- Chat with thinking mode ---

async function chatWithThinking() {
  console.log("\n=== Chat with Thinking ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    providerOptions: {
      dashscope: {
        enableThinking: true,
        thinkingBudget: 5000,
      },
    },
    prompt: "Which is larger, 9.11 or 9.9? Think carefully.",
  });

  console.log("Text:", result.text);
  for (const part of result.content) {
    if (part.type === "reasoning") {
      console.log("Reasoning:", part.text);
    }
  }
}

// --- Run ---

async function main() {
  try {
    await basicChat();
    await chatStream();
    await chatWithFunctionTool();
    await chatWithWebSearch();
    await chatWithCodeInterpreter();
    await chatWithThinking();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
