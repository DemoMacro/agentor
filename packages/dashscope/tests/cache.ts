import { dashscope } from "../src";
import { generateText } from "ai";

// --- Explicit cache ---
// Minimum 1024 tokens for cache creation. Use repeat(400) to exceed threshold.

async function explicitCache() {
  console.log("=== Explicit Cache ===");

  // ~1600 tokens, exceeds the 1024 minimum
  const longText = "<Your Code Here>".repeat(400);

  // First request: creates cache
  const first = await generateText({
    model: dashscope("qwen3.5-flash"),
    messages: [
      {
        role: "system",
        content: longText,
        providerOptions: {
          dashscope: { cacheControl: { type: "ephemeral" } },
        },
      },
      {
        role: "user",
        content: "What does this code do?",
      },
    ],
  });

  console.log("First request text:", first.text);
  console.log(
    "First request cache creation tokens:",
    first.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
  );
  console.log("First request cached tokens:", first.usage?.inputTokenDetails?.cacheReadTokens ?? 0);

  // Second request: should hit cache (same system message)
  const second = await generateText({
    model: dashscope("qwen3.5-flash"),
    messages: [
      {
        role: "system",
        content: longText,
        providerOptions: {
          dashscope: { cacheControl: { type: "ephemeral" } },
        },
      },
      {
        role: "user",
        content: "How can this code be optimized?",
      },
    ],
  });

  console.log("Second request text:", second.text);
  console.log(
    "Second request cache creation tokens:",
    second.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
  );
  console.log(
    "Second request cached tokens:",
    second.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
  );
}

// --- Run ---

async function main() {
  try {
    await explicitCache();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
