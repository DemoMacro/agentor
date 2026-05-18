import { embed, embedMany } from "ai";

import { dashscope } from "../src";

// --- Basic embedding ---

async function basicEmbedding() {
  console.log("=== Basic Embedding ===");

  const { embedding, usage } = await embed({
    model: dashscope.embeddingModel("text-embedding-v4"),
    value: "The clothes quality is excellent",
  });

  console.log("Dimensions:", embedding.length);
  console.log("Usage:", usage);
}

// --- Batch embedding ---

async function batchEmbedding() {
  console.log("\n=== Batch Embedding ===");

  const { embeddings, usage } = await embedMany({
    model: dashscope.embeddingModel("text-embedding-v4"),
    values: [
      "Artificial intelligence is a branch of computer science",
      "Machine learning is an important method to achieve AI",
      "Deep learning is a subfield of machine learning",
    ],
  });

  console.log("Count:", embeddings.length);
  console.log("Dimensions:", embeddings[0].length);
  console.log("Usage:", usage);
}

// --- Embedding with custom dimensions ---

async function embeddingWithDimensions() {
  console.log("\n=== Embedding with Dimensions ===");

  const { embedding } = await embed({
    model: dashscope.embeddingModel("text-embedding-v4"),
    value: "Custom dimension embedding",
    providerOptions: {
      openaiCompatible: {
        dimensions: 256,
      },
    },
  });

  console.log("Dimensions:", embedding.length);
}

// --- Run ---

async function main() {
  try {
    await basicEmbedding();
    await batchEmbedding();
    await embeddingWithDimensions();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
