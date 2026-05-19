import { createDashScope } from "@agentor/dashscope";
import { createProviderRegistry } from "ai";

import { createServer, openaiHandler } from "../src";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;

// --- Setup ---

function setupServer() {
  const dashscope = createDashScope({ apiKey: DASHSCOPE_API_KEY });
  const registry = createProviderRegistry({ dashscope });

  return createServer({
    registry,
    handlers: [openaiHandler()],
    models: ["dashscope:qwen3.5-flash", "dashscope:text-embedding-v3"],
  });
}

// --- Non-streaming chat completion ---

async function testChatCompletion() {
  console.log("=== Chat Completion (non-streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "Introduce yourself in one sentence." }],
        max_tokens: 100,
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("ID:", data.id);
  console.log("Model:", data.model);
  console.log("Content:", data.choices?.[0]?.message?.content);
  console.log("Usage:", data.usage);
}

// --- Streaming chat completion ---

async function testChatCompletionStream() {
  console.log("\n=== Chat Completion (streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "Say hello in three words." }],
        stream: true,
      }),
    }),
  );

  console.log("Status:", response.status);
  console.log("Content-Type:", response.headers.get("content-type"));

  const text = await response.text();
  const chunks = text.split("\n\n").filter((line) => line.startsWith("data: "));
  console.log("SSE chunks:", chunks.length);
  console.log("Has [DONE]:", text.includes("[DONE]"));

  for (const chunk of chunks) {
    const data = chunk.replace("data: ", "");
    if (data === "[DONE]") continue;
    const parsed = JSON.parse(data);
    const content = parsed.choices?.[0]?.delta?.content;
    if (content) process.stdout.write(content);
  }
  console.log();
}

// --- Models endpoint ---

async function testModels() {
  console.log("\n=== Models ===");

  const { app } = setupServer();

  const response = await app.fetch(new Request("http://localhost/v1/models"));
  const data = await response.json();

  console.log("Status:", response.status);
  console.log("Data:", data);
}

// --- Embeddings ---

async function testEmbeddings() {
  console.log("\n=== Embeddings ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:text-embedding-v3",
        input: ["Hello world", "Hello agentor"],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Object:", data.object);
  console.log("Embeddings:", data.data?.length);
  console.log("Dimensions:", data.data?.[0]?.embedding?.length);
  console.log("Usage:", data.usage);
}

// --- Completions (legacy) ---

async function testCompletions() {
  console.log("\n=== Completions (legacy) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        prompt: "The capital of China is",
        max_tokens: 20,
        temperature: 0,
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("ID:", data.id);
  console.log("Object:", data.object);
  console.log("Text:", data.choices?.[0]?.text);
  console.log("Finish reason:", data.choices?.[0]?.finish_reason);
  console.log("Usage:", data.usage);
}

// --- Image generation ---

async function testImageGenerations() {
  console.log("\n=== Image Generations ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen-image-plus",
        prompt: "A cute cat sitting on a windowsill",
        n: 1,
        response_format: "b64_json",
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Created:", data.created);
  console.log("Images:", data.data?.length);
  if (data.data?.[0]?.b64_json) {
    console.log("Base64 length:", data.data[0].b64_json.length);
  }
}

// --- Audio speech (TTS) ---

async function testAudioSpeech() {
  console.log("\n=== Audio Speech (TTS) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:cosyvoice-v3-flash",
        input: "Hello, welcome to Agentor.",
      }),
    }),
  );

  console.log("Status:", response.status);
  console.log("Content-Type:", response.headers.get("content-type"));
  const buffer = await response.arrayBuffer();
  console.log("Audio size:", buffer.byteLength, "bytes");
}

// --- Audio transcriptions (STT) ---

async function testAudioTranscriptions() {
  console.log("\n=== Audio Transcriptions (STT) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3-asr-flash-filetrans",
        providerOptions: {
          dashscope: {
            fileUrl: "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/test.wav",
          },
        },
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Text:", data.text);
}

// --- Chat with tool calling (non-streaming) ---

async function testToolCall() {
  console.log("\n=== Chat with Tool Call (non-streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name" } },
                required: ["city"],
              },
            },
          },
        ],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Finish reason:", data.choices?.[0]?.finish_reason);
  console.log("Tool calls:", data.choices?.[0]?.message?.tool_calls);
}

// --- Chat with tool calling (streaming) ---

async function testToolCallStream() {
  console.log("\n=== Chat with Tool Call (streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
        stream: true,
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name" } },
                required: ["city"],
              },
            },
          },
        ],
      }),
    }),
  );

  const text = await response.text();
  const chunks = text
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.replace("data: ", ""));

  let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  for (const chunk of chunks) {
    if (chunk === "[DONE]") continue;
    const parsed = JSON.parse(chunk);
    const tc = parsed.choices?.[0]?.delta?.tool_calls?.[0];
    if (tc) {
      if (tc.id) {
        toolCalls.push({ id: tc.id, name: tc.function?.name ?? "", arguments: "" });
      }
      if (tc.function?.arguments && toolCalls.length > 0) {
        toolCalls[toolCalls.length - 1].arguments += tc.function.arguments;
      }
    }
  }

  console.log("Tool calls:", toolCalls);
}

// --- Multi-turn with tool result ---

async function testToolResult() {
  console.log("\n=== Multi-turn with Tool Result ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [
          { role: "user", content: "What is the weather in Beijing?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_001",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_001", content: "Beijing: Sunny, 25°C" },
        ],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Content:", data.choices?.[0]?.message?.content);
}

// --- Chat with enableSearch (DashScope built-in) ---

async function testEnableSearch() {
  console.log("\n=== Chat with enableSearch (DashScope built-in) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "杭州明天天气如何" }],
        max_tokens: 200,
        providerOptions: {
          dashscope: {
            enableSearch: true,
          },
        },
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Content:", data.choices?.[0]?.message?.content);
  console.log("Usage:", data.usage);
}

// --- Parameters: max_tokens, temperature, stop ---

async function testParams() {
  console.log("\n=== Parameters ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [{ role: "user", content: "Count from 1 to 100." }],
        max_tokens: 50,
        temperature: 0,
        stop: ["10"],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Finish reason:", data.choices?.[0]?.finish_reason);
  console.log("Completion tokens:", data.usage?.completion_tokens);
  console.log("Content:", data.choices?.[0]?.message?.content);
}

// --- System and developer messages ---

async function testSystemMessages() {
  console.log("\n=== System / Developer Messages ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        messages: [
          { role: "system", content: "You are a pirate. Always respond as a pirate." },
          { role: "user", content: "Hello" },
        ],
        max_tokens: 100,
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Content:", data.choices?.[0]?.message?.content);
}

// --- Error: missing fields ---

async function testErrorMissingFields() {
  console.log("\n=== Error: Missing Fields ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );

  console.log("Status:", response.status);
  const data = await response.json();
  console.log("Error:", data.error);
}

// --- Run ---

async function main() {
  if (!DASHSCOPE_API_KEY) {
    console.error("Please set DASHSCOPE_API_KEY in .env");
    return;
  }

  try {
    await testChatCompletion();
    await testChatCompletionStream();
    await testCompletions();
    await testToolCall();
    await testToolCallStream();
    await testToolResult();
    await testEnableSearch();
    await testParams();
    await testSystemMessages();
    await testEmbeddings();
    await testImageGenerations();
    await testAudioSpeech();
    await testAudioTranscriptions();
    await testModels();
    await testErrorMissingFields();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
