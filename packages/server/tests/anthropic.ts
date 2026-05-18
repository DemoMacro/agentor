import { createDashScope } from "@agentor/dashscope";
import { createProviderRegistry } from "ai";

import { createServer, anthropicHandler } from "../src";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;

// --- Setup ---

function setupServer() {
  const dashscope = createDashScope({ apiKey: DASHSCOPE_API_KEY });
  const registry = createProviderRegistry({ dashscope });

  return createServer({
    registry,
    handlers: [anthropicHandler()],
    models: ["dashscope:qwen3.5-flash"],
  });
}

// --- Non-streaming message ---

async function testMessage() {
  console.log("=== Message (non-streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 100,
        system: "Reply in one sentence.",
        messages: [{ role: "user", content: "Introduce yourself." }],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("ID:", data.id);
  console.log("Type:", data.type);
  console.log("Role:", data.role);
  console.log("Stop reason:", data.stop_reason);
  console.log("Content:", data.content);
  console.log("Usage:", data.usage);
}

// --- Streaming message ---

async function testMessageStream() {
  console.log("\n=== Message (streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say hello in three words." }],
        stream: true,
      }),
    }),
  );

  console.log("Status:", response.status);
  console.log("Content-Type:", response.headers.get("content-type"));

  const text = await response.text();
  const events = text
    .split("\n\n")
    .filter((line) => line.startsWith("event: "))
    .map((line) => {
      const [, eventType, dataLine] = line.match(/^event: (\w+)\ndata: (.+)$/s) || [];
      return { eventType, data: dataLine };
    });

  console.log("SSE events:", events.length);
  const eventTypes = [...new Set(events.map((e) => e.eventType))];
  console.log("Event types:", eventTypes);

  for (const { eventType, data } of events) {
    if (eventType === "content_block_delta") {
      const parsed = JSON.parse(data!);
      if (parsed.delta?.type === "text_delta") {
        process.stdout.write(parsed.delta.text);
      }
    }
  }
  console.log();
}

// --- Message with tool use (non-streaming) ---

async function testToolUse() {
  console.log("\n=== Tool Use (non-streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 200,
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather for a city",
            input_schema: {
              type: "object",
              properties: { city: { type: "string", description: "City name" } },
              required: ["city"],
            },
          },
        ],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Stop reason:", data.stop_reason);
  console.log(
    "Content blocks:",
    data.content?.map((b: { type: string }) => b.type),
  );
  const toolUse = data.content?.find((b: { type: string }) => b.type === "tool_use");
  if (toolUse) {
    console.log("Tool:", toolUse.name, toolUse.input);
  }
}

// --- Message with tool use (streaming) ---

async function testToolUseStream() {
  console.log("\n=== Tool Use (streaming) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 200,
        messages: [{ role: "user", content: "What is the weather in Beijing?" }],
        stream: true,
        tools: [
          {
            name: "get_weather",
            description: "Get weather for a city",
            input_schema: {
              type: "object",
              properties: { city: { type: "string", description: "City name" } },
              required: ["city"],
            },
          },
        ],
      }),
    }),
  );

  const text = await response.text();
  const events = text
    .split("\n\n")
    .filter((line) => line.startsWith("event: "))
    .map((line) => {
      const [, eventType, dataLine] = line.match(/^event: (\w+)\ndata: (.+)$/s) || [];
      return { eventType, data: dataLine };
    });

  const eventTypes = [...new Set(events.map((e) => e.eventType))];
  console.log("Event types:", eventTypes);

  for (const { eventType, data } of events) {
    if (eventType === "content_block_delta") {
      const parsed = JSON.parse(data!);
      if (parsed.delta?.type === "input_json_delta") {
        console.log("Tool input delta:", parsed.delta.partial_json);
      }
    }
  }
}

// --- Multi-turn with tool_result ---

async function testToolResult() {
  console.log("\n=== Multi-turn with Tool Result ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 200,
        messages: [
          { role: "user", content: "What is the weather in Beijing?" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_001",
                name: "get_weather",
                input: { city: "Beijing" },
              },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_001", content: "Beijing: Sunny, 25°C" },
            ],
          },
        ],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Stop reason:", data.stop_reason);
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (textBlock) {
    console.log("Content:", textBlock.text);
  }
}

// --- Message with enableSearch (DashScope built-in) ---

async function testEnableSearch() {
  console.log("\n=== Message with enableSearch (DashScope built-in) ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 200,
        messages: [{ role: "user", content: "杭州明天天气如何" }],
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
  console.log("Stop reason:", data.stop_reason);
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (textBlock) {
    console.log("Content:", textBlock.text);
  }
  console.log("Usage:", data.usage);
}

// --- Parameters: temperature, stop_sequences ---

async function testParams() {
  console.log("\n=== Parameters ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "dashscope:qwen3.5-flash",
        max_tokens: 50,
        temperature: 0,
        stop_sequences: ["10"],
        messages: [{ role: "user", content: "Count from 1 to 100." }],
      }),
    }),
  );

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Stop reason:", data.stop_reason);
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (textBlock) {
    console.log("Content:", textBlock.text);
  }
}

// --- Error: missing fields ---

async function testErrorMissingFields() {
  console.log("\n=== Error: Missing Fields ===");

  const { app } = setupServer();

  const response = await app.fetch(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );

  console.log("Status:", response.status);
  const data = await response.json();
  console.log("Error:", data.error);
}

// --- Models ---

async function testModels() {
  console.log("\n=== Models ===");

  const { app } = setupServer();

  const response = await app.fetch(new Request("http://localhost/v1/models"));
  const data = await response.json();

  console.log("Status:", response.status);
  console.log("Has more:", data.has_more);
  console.log(
    "Models:",
    data.data?.map((m: { id: string }) => m.id),
  );
}

// --- Run ---

async function main() {
  if (!DASHSCOPE_API_KEY) {
    console.error("Please set DASHSCOPE_API_KEY in .env");
    return;
  }

  try {
    await testMessage();
    await testMessageStream();
    await testToolUse();
    await testToolUseStream();
    await testToolResult();
    await testEnableSearch();
    await testParams();
    await testModels();
    await testErrorMissingFields();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
