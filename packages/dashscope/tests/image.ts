import { mkdirSync, writeFileSync } from "fs";

import { generateImage } from "ai";

import { dashscope } from "../src";

// --- Basic image generation ---

async function basicImageGeneration() {
  console.log("=== Basic Image Generation ===");

  const { images } = await generateImage({
    model: dashscope.imageModel("qwen-image-plus"),
    prompt: "A cute cat sitting on a windowsill with sunlight streaming in",
    providerOptions: {
      dashscope: {
        size: "1024*1024",
      },
    },
  });

  mkdirSync(".temp", { recursive: true });
  for (const image of images) {
    writeFileSync(".temp/test-output-image.png", image.uint8Array);
    console.log(
      `  Image saved to .temp/test-output-image.png (${image.base64.length} chars base64, ${image.mediaType})`,
    );
  }
}

// --- Run all tests ---

async function main() {
  try {
    await basicImageGeneration();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
