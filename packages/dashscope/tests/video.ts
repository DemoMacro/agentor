import { dashscope } from "../src";
import { experimental_generateVideo as generateVideo } from "ai";
import { mkdirSync, writeFileSync } from "fs";

// --- Basic video generation (text-to-video) ---

async function basicVideoGeneration() {
  console.log("=== Basic Video Generation (T2V) ===");

  const { videos } = await generateVideo({
    model: dashscope.videoModel("wan2.6-t2v"),
    prompt: "A golden retriever running through a field of sunflowers at sunset",
    providerOptions: {
      dashscope: {
        size: "1280*720",
        duration: 5,
      },
    },
  });

  mkdirSync(".temp", { recursive: true });
  for (const video of videos) {
    writeFileSync(".temp/test-output-video.mp4", video.uint8Array);
    console.log(`  Video saved to .temp/test-output-video.mp4 (${video.mediaType})`);
  }
}

// --- Run all tests ---

async function main() {
  try {
    await basicVideoGeneration();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
