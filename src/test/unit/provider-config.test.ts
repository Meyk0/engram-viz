import { afterEach, describe, expect, it } from "vitest";
import { configuredChatProvider } from "@/lib/chat/providers";
import {
  configuredConsolidationPlannerProvider,
  configuredMemoryPlannerProvider
} from "@/lib/memory/planner-config";

const PROVIDER_ENV_KEYS = ["ENGRAM_CHAT_PROVIDER", "CHAT_PROVIDER", "OPENAI_API_KEY", "OPENAI_LIVE_ENABLED"] as const;
const MEMORY_PLANNER_ENV_KEYS = ["ENGRAM_MEMORY_PLANNER", "MEMORY_PLANNER", "OPENAI_MEMORY_PLANNER_ENABLED"] as const;
const CONSOLIDATION_PLANNER_ENV_KEYS = [
  "ENGRAM_CONSOLIDATION_PLANNER",
  "CONSOLIDATION_PLANNER",
  "OPENAI_CONSOLIDATION_PLANNER_ENABLED"
] as const;

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

describe("configuredMemoryPlannerProvider", () => {
  it("defaults to deterministic memory planning", () => {
    resetProviderEnv();

    expect(configuredMemoryPlannerProvider()).toBe("deterministic");
  });

  it("enables OpenAI memory planning only behind its explicit flag", () => {
    process.env.ENGRAM_MEMORY_PLANNER = "openai";
    process.env.OPENAI_MEMORY_PLANNER_ENABLED = "true";

    expect(configuredMemoryPlannerProvider()).toBe("openai");
  });

  it("keeps deterministic planning when OpenAI memory planner is not enabled", () => {
    process.env.ENGRAM_MEMORY_PLANNER = "openai";

    expect(configuredMemoryPlannerProvider()).toBe("deterministic");
  });
});

describe("configuredConsolidationPlannerProvider", () => {
  it("defaults to deterministic consolidation planning", () => {
    resetProviderEnv();

    expect(configuredConsolidationPlannerProvider()).toBe("deterministic");
  });

  it("enables OpenAI consolidation planning only behind its explicit flag", () => {
    process.env.ENGRAM_CONSOLIDATION_PLANNER = "openai";
    process.env.OPENAI_CONSOLIDATION_PLANNER_ENABLED = "true";

    expect(configuredConsolidationPlannerProvider()).toBe("openai");
  });

  it("keeps deterministic consolidation planning when OpenAI is not enabled", () => {
    process.env.ENGRAM_CONSOLIDATION_PLANNER = "openai";

    expect(configuredConsolidationPlannerProvider()).toBe("deterministic");
  });
});

function resetProviderEnv() {
  [...PROVIDER_ENV_KEYS, ...MEMORY_PLANNER_ENV_KEYS, ...CONSOLIDATION_PLANNER_ENV_KEYS].forEach((key) => {
    delete process.env[key];
  });
}
