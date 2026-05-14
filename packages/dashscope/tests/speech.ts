import { dashscope } from "../src";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { mkdirSync, writeFileSync } from "fs";

// --- Basic speech synthesis (CosyVoice) ---

async function basicCosyVoice() {
  console.log("=== Basic Speech Synthesis (CosyVoice) ===");

  const { audio } = await generateSpeech({
    model: dashscope.speechModel("cosyvoice-v3-flash"),
    text: "Hello, welcome to the Agentor DashScope provider test.",
    providerOptions: {
      dashscope: {
        voice: "longanyang",
        format: "wav",
        sampleRate: 24000,
      },
    },
  });

  mkdirSync(".temp", { recursive: true });
  writeFileSync(".temp/test-output-cosyvoice.wav", audio.uint8Array);
  console.log(
    `  Audio saved to .temp/test-output-cosyvoice.wav (${audio.format}, ${audio.mediaType})`,
  );
}

// --- Run all tests ---

async function main() {
  try {
    await basicCosyVoice();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
