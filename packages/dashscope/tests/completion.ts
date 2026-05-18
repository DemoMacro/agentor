import { generateText, streamText } from "ai";

import { dashscope } from "../src";

// --- Basic completion (FIM: Fill-In-the-Middle) ---

async function basicCompletion() {
  console.log("=== Basic Completion ===");

  const result = await generateText({
    model: dashscope.completionModel("qwen2.5-coder-32b-instruct"),
    prompt:
      '<|fim_prefix|>def quick_sort(arr):\n    """Sort array using quicksort."""\n<|fim_suffix|>\n    return arr\n<|fim_middle|>',
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
  console.log("FinishReason:", result.finishReason);
}

// --- Completion with streaming ---

async function completionStream() {
  console.log("\n=== Completion Stream ===");

  const result = streamText({
    model: dashscope.completionModel("qwen2.5-coder-32b-instruct"),
    prompt:
      "<|fim_prefix|>function fibonacci(n: number): number {\n<|fim_suffix|>\n  return result;\n}\n<|fim_middle|>",
  });

  for await (const part of result.textStream) {
    process.stdout.write(part);
  }
  console.log();

  const usage = await result.usage;
  console.log("Usage:", usage);
}

// --- Run ---

async function main() {
  try {
    await basicCompletion();
    await completionStream();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
