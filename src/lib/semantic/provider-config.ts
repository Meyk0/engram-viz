import type { SemanticLayoutProvider } from "@/lib/semantic/types";

export const DEFAULT_SEMANTIC_EMBEDDING_MODEL = "text-embedding-3-small";

export type SemanticLayoutProviderConfig = {
  provider: SemanticLayoutProvider;
  apiKey?: string;
  model?: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

export function configuredSemanticLayoutProvider(env: Environment = process.env): SemanticLayoutProvider {
  return getSemanticLayoutProviderConfig(env).provider;
}

export function getSemanticLayoutProviderConfig(env: Environment = process.env): SemanticLayoutProviderConfig {
  const requestedProvider = env.ENGRAM_SEMANTIC_LAYOUT_PROVIDER ?? env.SEMANTIC_LAYOUT_PROVIDER;
  const enabled = env.OPENAI_SEMANTIC_LAYOUT_ENABLED === "true";
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (requestedProvider === "openai" && enabled && apiKey) {
    return {
      provider: "openai",
      apiKey,
      model:
        env.OPENAI_SEMANTIC_LAYOUT_MODEL ??
        env.OPENAI_EMBEDDING_MODEL ??
        DEFAULT_SEMANTIC_EMBEDDING_MODEL
    };
  }

  return { provider: "lexical-fallback" };
}
