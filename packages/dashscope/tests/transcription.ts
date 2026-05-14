import { dashscope } from "../src";
import { experimental_transcribe as transcribe } from "ai";

// --- Short audio transcription (sync) ---

async function shortAudioTranscription() {
  console.log("=== Short Audio Transcription (qwen3-asr-flash) ===");

  const { text } = await transcribe({
    model: dashscope.transcriptionModel("qwen3-asr-flash"),
    audio: new URL("https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3"),
  });

  console.log(`  Transcribed text: ${text}`);
}

// --- Long audio transcription (async via fileUrl) ---

async function longAudioTranscription() {
  console.log("\n=== Long Audio Transcription (qwen3-asr-flash-filetrans) ===");

  const { text, segments } = await transcribe({
    model: dashscope.transcriptionModel("qwen3-asr-flash-filetrans"),
    // Dummy audio data — will be ignored in async mode since fileUrl is provided
    audio: new Uint8Array(0),
    providerOptions: {
      dashscope: {
        fileUrl: "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3",
        enableWords: true,
      },
    },
  });

  console.log(`  Transcribed text: ${text}`);
  if (segments.length > 0) {
    console.log(`  Segments: ${segments.length}`);
    for (const seg of segments.slice(0, 3)) {
      console.log(
        `    [${seg.startSecond.toFixed(1)}s - ${seg.endSecond.toFixed(1)}s] ${seg.text}`,
      );
    }
  }
}

// --- Run all tests ---

async function main() {
  try {
    await shortAudioTranscription();
    await longAudioTranscription();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
