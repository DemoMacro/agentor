import { readFileSync } from "node:fs";

import { generateText } from "ai";

import { dashscope } from "../src";

// Synthetic receipt fixture — fabricated content, no copyright/privacy concerns.
const receiptBytes = new Uint8Array(
  readFileSync(new URL("./fixtures/receipt.png", import.meta.url)),
);

// --- Chat: OCR via image + text prompt ---

async function chatOcr() {
  console.log("=== Chat OCR (image + prompt) ===");

  const result = await generateText({
    model: dashscope("qwen3.5-ocr"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "提取图中的票据编号、开票日期、购买方、合计金额，以 JSON 返回。",
          },
          { type: "file", data: receiptBytes, mediaType: "image/png" },
        ],
      },
    ],
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
}

// --- Responses: OCR via ocr_options (text_recognition) ---

async function responsesOcrText() {
  console.log("\n=== Responses OCR (text_recognition) ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-ocr"),
    messages: [
      {
        role: "user",
        content: [{ type: "file", data: receiptBytes, mediaType: "image/png" }],
      },
    ],
    providerOptions: {
      dashscope: { ocrOptions: { task: "text_recognition" } },
    },
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
}

// --- Responses: key field extraction (task_config.result_schema) ---

async function responsesOcrKeyExtraction() {
  console.log("\n=== Responses OCR (key_information_extraction) ===");

  const result = await generateText({
    model: dashscope.responses("qwen3.5-ocr"),
    messages: [
      {
        role: "user",
        content: [{ type: "file", data: receiptBytes, mediaType: "image/png" }],
      },
    ],
    providerOptions: {
      dashscope: {
        ocrOptions: {
          task: "key_information_extraction",
          taskConfig: {
            resultSchema: {
              票据编号: "票据编号",
              开票日期: "开票日期",
              购买方: "购买方",
              合计金额: "合计金额",
            },
          },
        },
      },
    },
  });

  console.log("Text:", result.text);
  console.log("Usage:", result.usage);
}

// --- Run ---

async function main() {
  try {
    await chatOcr();
    await responsesOcrText();
    await responsesOcrKeyExtraction();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
