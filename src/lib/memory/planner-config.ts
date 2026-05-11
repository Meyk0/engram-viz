import {
  deterministicMemoryConsolidationPlanner,
  type MemoryConsolidationPlanner
} from "@/lib/memory/consolidationPolicy";
import { deterministicMemoryDecisionPlanner, type MemoryDecisionPlanner } from "@/lib/memory/decision";
import { deterministicDreamPlanner, HybridDreamPlanner, type DreamPlanner } from "@/lib/memory/dream-planner";
import { OpenAIConsolidationPlanner } from "@/lib/memory/openai-consolidation-planner";
import { OpenAIDreamPlanner } from "@/lib/memory/openai-dream-planner";
import { OpenAIMemoryDecisionPlanner } from "@/lib/memory/openai-planner";
import { OpenAITurnMemoryPlanner } from "@/lib/memory/openai-turn-planner";
import {
  deterministicTurnMemoryPlanner,
  HybridTurnMemoryPlanner,
  type TurnMemoryPlanner
} from "@/lib/memory/turn-planner";

export type MemoryPlannerProvider = "deterministic" | "openai";
export type ConsolidationPlannerProvider = "deterministic" | "openai";
export type TurnMemoryPlannerProvider = "deterministic" | "openai";
export type DreamPlannerProvider = "deterministic" | "openai";

export function configuredDreamPlanner(): DreamPlanner {
  if (configuredDreamPlannerProvider() === "openai") {
    return new HybridDreamPlanner(new OpenAIDreamPlanner(), deterministicDreamPlanner);
  }

  return deterministicDreamPlanner;
}

export function configuredDreamPlannerProvider(): DreamPlannerProvider {
  const requestedProvider = process.env.ENGRAM_DREAM_PLANNER;

  if (requestedProvider === "openai" && process.env.OPENAI_DREAM_PLANNER_ENABLED === "true") {
    return "openai";
  }

  return "deterministic";
}

export function configuredTurnMemoryPlanner(): TurnMemoryPlanner {
  if (configuredTurnMemoryPlannerProvider() === "openai") {
    return new HybridTurnMemoryPlanner(new OpenAITurnMemoryPlanner(), deterministicTurnMemoryPlanner);
  }

  return deterministicTurnMemoryPlanner;
}

export function configuredTurnMemoryPlannerProvider(): TurnMemoryPlannerProvider {
  const requestedProvider =
    process.env.ENGRAM_TURN_MEMORY_PLANNER ??
    process.env.ENGRAM_MEMORY_PLANNER ??
    process.env.MEMORY_PLANNER;

  if (requestedProvider === "openai" && process.env.OPENAI_MEMORY_PLANNER_ENABLED === "true") {
    return "openai";
  }

  return "deterministic";
}

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
