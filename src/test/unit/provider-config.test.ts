import { afterEach, describe, expect, it } from "vitest";
import { configuredChatProvider } from "@/lib/chat/providers";

const PROVIDER_ENV_KEYS = ["ENGRAM_CHAT_PROVIDER", "CHAT_PROVIDER", "OPENAI_API_KEY", "OPENAI_LIVE_ENABLED"] as const;

afterEach(() => {
  resetProviderEnv();
});

describe("configuredChatProvider", () => {
  it("defaults to deterministic demo mode", () => {
    resetProviderEnv();

    expect(configuredChatProvider()).toBe("demo");
  });

  it("enables OpenAI only when provider, API key, and live flag are set", () => {
    process.env.ENGRAM_CHAT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_LIVE_ENABLED = "true";

    expect(configuredChatProvider()).toBe("openai");
  });

  it("keeps demo mode when OpenAI live calls are not explicitly enabled", () => {
    process.env.ENGRAM_CHAT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";

    expect(configuredChatProvider()).toBe("demo");
  });
});

function resetProviderEnv() {
  PROVIDER_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}
