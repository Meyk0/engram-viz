import { deterministicMemoryDecisionPlanner, type MemoryDecisionPlanner } from "@/lib/memory/decision";
import { OpenAIMemoryDecisionPlanner } from "@/lib/memory/openai-planner";

export type MemoryPlannerProvider = "deterministic" | "openai";

export function configuredMemoryDecisionPlanner(): MemoryDecisionPlanner {
  if (configuredMemoryPlannerProvider() === "openai") {
    return new OpenAIMemoryDecisionPlanner();
  }

  return deterministicMemoryDecisionPlanner;
}

export function configuredMemoryPlannerProvider(): MemoryPlannerProvider {
  const requestedProvider = process.env.ENGRAM_MEMORY_PLANNER ?? process.env.MEMORY_PLANNER;

  if (requestedProvider === "openai" && process.env.OPENAI_MEMORY_PLANNER_ENABLED === "true") {
    return "openai";
  }

  return "deterministic";
}
