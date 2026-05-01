import {
  deterministicMemoryConsolidationPlanner,
  type MemoryConsolidationPlanner
} from "@/lib/memory/consolidationPolicy";
import { deterministicMemoryDecisionPlanner, type MemoryDecisionPlanner } from "@/lib/memory/decision";
import { OpenAIConsolidationPlanner } from "@/lib/memory/openai-consolidation-planner";
import { OpenAIMemoryDecisionPlanner } from "@/lib/memory/openai-planner";

export type MemoryPlannerProvider = "deterministic" | "openai";
export type ConsolidationPlannerProvider = "deterministic" | "openai";

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

export function configuredMemoryConsolidationPlanner(): MemoryConsolidationPlanner {
  if (configuredConsolidationPlannerProvider() === "openai") {
    return new OpenAIConsolidationPlanner();
  }

  return deterministicMemoryConsolidationPlanner;
}

export function configuredConsolidationPlannerProvider(): ConsolidationPlannerProvider {
  const requestedProvider = process.env.ENGRAM_CONSOLIDATION_PLANNER ?? process.env.CONSOLIDATION_PLANNER;

  if (requestedProvider === "openai" && process.env.OPENAI_CONSOLIDATION_PLANNER_ENABLED === "true") {
    return "openai";
  }

  return "deterministic";
}
