import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import type { ChatProviderClient, ChatTurnInput } from "@/lib/chat/providers/types";
import type { CausalAblationRequest, CausalAblationResult } from "@/lib/evidence/types";

export const MAX_CAUSAL_ABLATION_REQUEST_BYTES = 256_000;
export const MAX_CAUSAL_ABLATION_EXCLUDED_MEMORIES = 10;
export const CAUSAL_ABLATION_CAVEAT =
  "This is an estimated counterfactual, not proof of causality. Model sampling and other factors can also change the answer.";

export class CausalAblationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CausalAblationValidationError";
  }
}

export class CausalAblationProviderError extends Error {
  constructor() {
    super("The configured chat provider could not complete the ablation replay.");
    this.name = "CausalAblationProviderError";
  }
}

export async function runCausalAblation(
  request: CausalAblationRequest,
  provider: ChatProviderClient = createChatProvider(configuredChatProvider())
): Promise<CausalAblationResult> {
  validateExcludedMemoryIds(request);

  const excludedIds = new Set(request.excludedMemoryIds);
  const baselineAnswer = await replayTurn(provider, {
    message: request.record.userMessage,
    history: structuredClone(request.record.history),
    retrievedMemories: structuredClone(request.record.retrievedMemories)
  });
  const counterfactualAnswer = await replayTurn(provider, {
    message: request.record.userMessage,
    history: structuredClone(request.record.history),
    retrievedMemories: structuredClone(
      request.record.retrievedMemories.filter((memory) => !excludedIds.has(memory.id))
    )
  });
  const estimatedInfluence = estimateAnswerInfluence(baselineAnswer, counterfactualAnswer);

  return {
    version: 1,
    recordId: request.record.id,
    excludedMemoryIds: [...request.excludedMemoryIds],
    originalAnswer: request.record.originalAnswer,
    baselineAnswer,
    counterfactualAnswer,
    estimatedInfluence,
    changed: normalizeAnswer(baselineAnswer) !== normalizeAnswer(counterfactualAnswer),
    caveat: CAUSAL_ABLATION_CAVEAT,
    provider: {
      id: provider.id,
      ...(provider.model ? { model: provider.model } : {})
    }
  };
}

export function validateExcludedMemoryIds(request: CausalAblationRequest): void {
  if (
    request.excludedMemoryIds.length < 1 ||
    request.excludedMemoryIds.length > MAX_CAUSAL_ABLATION_EXCLUDED_MEMORIES
  ) {
    throw new CausalAblationValidationError(
      `Choose between 1 and ${MAX_CAUSAL_ABLATION_EXCLUDED_MEMORIES} retrieved memories to exclude.`
    );
  }

  const uniqueIds = new Set(request.excludedMemoryIds);
  if (uniqueIds.size !== request.excludedMemoryIds.length) {
    throw new CausalAblationValidationError("Excluded memory IDs must be unique.");
  }

  const retrievedIds = new Set(request.record.retrievedMemories.map((memory) => memory.id));
  if (request.excludedMemoryIds.some((id) => !retrievedIds.has(id))) {
    throw new CausalAblationValidationError(
      "Excluded memory IDs must belong to the turn's retrieved memories."
    );
  }
}

export function estimateAnswerInfluence(baselineAnswer: string, counterfactualAnswer: string): number {
  const baseline = Array.from(normalizeAnswer(baselineAnswer));
  const counterfactual = Array.from(normalizeAnswer(counterfactualAnswer));
  const longestLength = Math.max(baseline.length, counterfactual.length);

  if (longestLength === 0) return 0;

  const distance = levenshteinDistance(baseline, counterfactual);
  return Math.round((distance / longestLength) * 1_000_000) / 1_000_000;
}

async function replayTurn(provider: ChatProviderClient, input: ChatTurnInput): Promise<string> {
  let answer = "";

  try {
    for await (const chunk of provider.streamTurn(input)) {
      if (chunk.kind === "text") answer += chunk.delta;
      if (chunk.kind === "error") throw new CausalAblationProviderError();
    }
  } catch {
    throw new CausalAblationProviderError();
  }

  return answer;
}

function normalizeAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, " ");
}

function levenshteinDistance(left: string[], right: string[]): number {
  if (left.length > right.length) return levenshteinDistance(right, left);

  let previous = Array.from({ length: left.length + 1 }, (_, index) => index);

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    const current = [rightIndex];
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      current[leftIndex] = Math.min(
        (current[leftIndex - 1] ?? 0) + 1,
        (previous[leftIndex] ?? 0) + 1,
        (previous[leftIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }

  return previous[left.length] ?? 0;
}
