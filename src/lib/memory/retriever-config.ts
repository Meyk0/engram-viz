import { OpenAISemanticMemoryRetriever } from "@/lib/memory/openai-retriever";
import { lexicalMemoryRetriever, type MemoryRetriever } from "@/lib/memory/retrieve";

export type MemoryRetrieverProvider = "lexical" | "openai";

export function configuredMemoryRetriever(): MemoryRetriever {
  if (configuredMemoryRetrieverProvider() === "openai") {
    return new OpenAISemanticMemoryRetriever();
  }

  return lexicalMemoryRetriever;
}

export function configuredMemoryRetrieverProvider(): MemoryRetrieverProvider {
  const requestedProvider = process.env.ENGRAM_RETRIEVAL_PROVIDER ?? process.env.RETRIEVAL_PROVIDER;

  if (requestedProvider === "openai" && process.env.OPENAI_RETRIEVAL_ENABLED === "true") {
    return "openai";
  }

  return "lexical";
}
