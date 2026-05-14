import { dashscope } from "../src";
import { rerank } from "ai";

// --- Basic rerank ---

async function basicRerank() {
  console.log("=== Basic Rerank ===");

  const { ranking } = await rerank({
    model: dashscope.rerankingModel("qwen3-rerank"),
    query: "What is a reranking model?",
    documents: [
      "Reranking models are widely used in search engines and recommendation systems to sort candidate texts by relevance",
      "Quantum computing is a frontier field of computational science",
      "The development of pre-trained language models has brought new advances to reranking models",
    ],
  });

  for (const item of ranking) {
    console.log(`  Index: ${item.originalIndex}, Score: ${item.score.toFixed(4)}`);
  }
}

// --- Rerank with topN ---

async function rerankWithTopN() {
  console.log("\n=== Rerank with TopN ===");

  const { ranking } = await rerank({
    model: dashscope.rerankingModel("qwen3-rerank"),
    query: "How to reset password?",
    documents: [
      "Go to Settings > Security > Change Password to update your credentials",
      "Forgot your password?",
      "Our platform supports two-factor authentication",
      "You can also reset via email verification",
    ],
    topN: 2,
  });

  console.log("Top N results:", ranking.length);
  for (const item of ranking) {
    console.log(`  Index: ${item.originalIndex}, Score: ${item.score.toFixed(4)}`);
  }
}

// --- Run ---

async function main() {
  try {
    await basicRerank();
    await rerankWithTopN();
  } catch (error) {
    console.error("Error:", error);
  }
}

void main();
