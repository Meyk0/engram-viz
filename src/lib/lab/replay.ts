import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import type { ChatProviderClient, ChatTurnInput } from "@/lib/chat/providers/types";
import { compareReplayAnswers } from "@/lib/evidence/ablation";
import type {
  MemoryBranchReplayRequest,
  MemoryBranchReplayResult
} from "@/lib/lab/types";

export const MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES = 384_000;
export const MAX_MEMORY_BRANCH_CONTEXT = 10;
export const MEMORY_BRANCH_REPLAY_CAVEAT =
  "This is a controlled context replay of one recorded turn. It does not reproduce hidden model state, rerun retrieval, or prove deterministic causality.";

export class MemoryBranchReplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryBranchReplayValidationError";
  }
}

export class MemoryBranchReplayProviderError extends Error {
  constructor() {
    super("The configured chat provider could not complete the branch replay.");
    this.name = "MemoryBranchReplayProviderError";
  }
}

export async function runMemoryBranchReplay(
  request: MemoryBranchReplayRequest,
  provider?: ChatProviderClient,
  signal?: AbortSignal
): Promise<MemoryBranchReplayResult> {
  validateBranchReplay(request);
  const replayProvider = provider ?? createChatProvider(
    request.record.provider.id === "demo" ? "demo" : configuredChatProvider()
  );

  const baselineAnswer = await replay(replayProvider, {
    message: request.record.userMessage,
    history: structuredClone(request.record.history),
    retrievedMemories: structuredClone(request.record.retrievedMemories),
    signal
  });
  const branchAnswer = await replay(replayProvider, {
    message: request.record.userMessage,
    history: structuredClone(request.record.history),
    retrievedMemories: structuredClone(request.branchContextMemories),
    signal
  });
  const comparison = compareReplayAnswers(baselineAnswer, branchAnswer);

  return {
    version: 1,
    evidence: "replayed",
    recordId: request.record.id,
    branchId: request.branch.id,
    baselineMemoryIds: request.record.retrievedMemories.map((memory) => memory.id),
    branchMemoryIds: request.branchContextMemories.map((memory) => memory.id),
    baselineAnswer,
    branchAnswer,
    changed: comparison.outcome === "changed",
    comparison,
    caveat: MEMORY_BRANCH_REPLAY_CAVEAT,
    provider: {
      id: replayProvider.id,
      ...(replayProvider.model ? { model: replayProvider.model } : {})
    }
  };
}

export function validateBranchReplay(request: MemoryBranchReplayRequest): void {
  if (request.branch.mutations.length === 0) {
    throw new MemoryBranchReplayValidationError("Add at least one branch mutation before replaying.");
  }
  if (request.branchContextMemories.length > MAX_MEMORY_BRANCH_CONTEXT) {
    throw new MemoryBranchReplayValidationError(
      `Branch context cannot contain more than ${MAX_MEMORY_BRANCH_CONTEXT} memories.`
    );
  }

  const originalIds = new Set(request.record.retrievedMemories.map((memory) => memory.id));
  const replacementByOriginal = new Map(
    request.branch.mutations
      .filter((mutation) => mutation.type === "replace")
      .map((mutation) => [mutation.memoryId, mutation.replacement.id])
  );
  const quarantineIds = new Set(
    request.branch.mutations
      .filter((mutation) => mutation.type === "quarantine" || mutation.type === "supersede")
      .map((mutation) => mutation.memoryId)
  );
  const includedIds = request.branch.mutations.flatMap((mutation) => {
    if (mutation.type === "include") return [mutation.memoryId];
    if (mutation.type === "supersede") return [mutation.supersededByMemoryId];
    return [];
  });
  const allowedIds = new Set([
    ...originalIds,
    ...includedIds,
    ...[...replacementByOriginal.entries()]
      .filter(([originalId]) => originalIds.has(originalId))
      .map(([, replacementId]) => replacementId)
  ]);
  const branchIds = request.branchContextMemories.map((memory) => memory.id);

  if (new Set(branchIds).size !== branchIds.length) {
    throw new MemoryBranchReplayValidationError("Branch context memory IDs must be unique.");
  }
  if (branchIds.some((id) => !allowedIds.has(id))) {
    throw new MemoryBranchReplayValidationError(
      "Branch context can only contain original retrieved memories or explicit replacements."
    );
  }
  if ([...quarantineIds].some((id) => branchIds.includes(id))) {
    throw new MemoryBranchReplayValidationError("Quarantined memories cannot remain in branch context.");
  }
  if (includedIds.some((id) => !branchIds.includes(id))) {
    throw new MemoryBranchReplayValidationError("Included memories must be present in branch context.");
  }
  for (const [originalId, replacementId] of replacementByOriginal) {
    if (!originalIds.has(originalId)) continue;
    if (branchIds.includes(originalId) || !branchIds.includes(replacementId)) {
      throw new MemoryBranchReplayValidationError(
        "A retrieved memory replacement must replace its original in branch context."
      );
    }
  }
}

async function replay(provider: ChatProviderClient, input: ChatTurnInput) {
  let answer = "";
  try {
    for await (const chunk of provider.streamTurn(input)) {
      if (chunk.kind === "text") answer += chunk.delta;
      if (chunk.kind === "error") throw new MemoryBranchReplayProviderError();
    }
  } catch {
    throw new MemoryBranchReplayProviderError();
  }
  return answer;
}
