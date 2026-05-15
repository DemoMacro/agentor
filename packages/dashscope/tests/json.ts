import { dashscope } from "../src";
import { generateText, Output } from "ai";
import { z } from "zod/v4";

// --- JSON mode via providerOptions ---

async function jsonMode() {
  console.log("=== JSON Mode ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    prompt: "List 3 programming languages. Respond in JSON with format: [{name, creator, year}].",
  });

  console.log("Raw text:", result.text);
  try {
    const parsed = JSON.parse(result.text);
    console.log("Parsed:", JSON.stringify(parsed, null, 2));
  } catch {
    console.log("(Response is not valid JSON)");
  }
}

// --- Structured output via output: Output.object() ---

async function structuredOutput() {
  console.log("\n=== Structured Output ===");

  const result = await generateText({
    model: dashscope("qwen3.5-flash"),
    prompt: "List 3 programming languages with their creators and year. Output as JSON.",
    output: Output.object({
      schema: z.object({
        languages: z.array(
          z.object({
            name: z.string().describe("Language name"),
            creator: z.string().describe("Creator name"),
            year: z.number().describe("Year created"),
          }),
        ),
      }),
    }),
  });

  console.log("Object:", JSON.stringify(result.output, null, 2));
}

// --- Run ---

async function main() {
  try {
    await jsonMode();
    await structuredOutput();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
