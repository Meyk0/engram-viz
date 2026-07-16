import type {
  MemoryBranchReplayRequest,
  MemoryBranchReplayResult
} from "@/lib/lab/types";

export const PUBLIC_DEMO_REPLAY_CAVEAT =
  "Deterministic fixture replay: a fixed browser-safe executor evaluates the recorded input against two explicit memory contexts. No model, retrieval service, hidden state, or API call is involved, so this demonstrates the repair contract rather than model causality.";

export async function executePublicDemoReplay(
  request: MemoryBranchReplayRequest
): Promise<MemoryBranchReplayResult> {
  if (request.record.sessionId !== "sample-memory-incident" || request.record.provider.id !== "demo") {
    throw new Error("The public replay executor only accepts the bundled stale-location fixture.");
  }

  const supersession = request.branch.mutations.find((mutation) => mutation.type === "supersede");
  const correctedMemory = request.branchContextMemories.find((memory) =>
    memory.entities?.some((entity) => normalize(entity) === "oakland")
  );
  const baselineIds = new Set(request.record.retrievedMemories.map((memory) => memory.id));
  if (
    !supersession
    || !baselineIds.has(supersession.memoryId)
    || correctedMemory?.id !== supersession.supersededByMemoryId
  ) {
    throw new Error("The controlled branch must include the recorded Oakland correction.");
  }

  const baselineAnswer = request.record.originalAnswer;
  const branchAnswer = "You live in Oakland.";
  const normalizedTextDistance = textDistance(baselineAnswer, branchAnswer);

  return {
    version: 1,
    evidence: "replayed",
    recordId: request.record.id,
    branchId: request.branch.id,
    baselineMemoryIds: request.record.retrievedMemories.map((memory) => memory.id),
    branchMemoryIds: request.branchContextMemories.map((memory) => memory.id),
    baselineAnswer,
    branchAnswer,
    changed: baselineAnswer !== branchAnswer,
    comparison: {
      outcome: baselineAnswer === branchAnswer ? "stable" : "changed",
      normalizedTextDistance,
      answerLengthDelta: branchAnswer.length - baselineAnswer.length,
      baselineRuns: 1,
      counterfactualRuns: 1
    },
    caveat: PUBLIC_DEMO_REPLAY_CAVEAT,
    provider: { id: "demo" }
  };
}

function textDistance(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft === normalizedRight) return 0;

  const previous = Array.from({ length: normalizedRight.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= normalizedRight.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? rightIndex;
      const insertion = (previous[rightIndex - 1] ?? 0) + 1;
      const deletion = above + 1;
      const substitution = diagonal + Number(normalizedLeft[leftIndex - 1] !== normalizedRight[rightIndex - 1]);
      diagonal = above;
      previous[rightIndex] = Math.min(insertion, deletion, substitution);
    }
  }

  return (previous[normalizedRight.length] ?? 0) / Math.max(normalizedLeft.length, normalizedRight.length, 1);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
