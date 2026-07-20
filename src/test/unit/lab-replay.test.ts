import { describe, expect, it, vi } from "vitest";
import type { ChatProviderClient, ChatTurnInput } from "@/lib/chat/providers/types";
import { branchContextMemories, applyMemoryBranch, createMemoryBranch, createReplacementMemory } from "@/lib/lab/branches";
import { buildTimelineCheckpoints } from "@/lib/lab/checkpoints";
import {
  MemoryBranchReplayValidationError,
  runMemoryBranchReplay
} from "@/lib/lab/replay";
import type { MemoryTimelineEntry } from "@/lib/timeline";
import type { TurnRecord } from "@/lib/evidence/types";
import type { EngramMemory } from "@/types";

describe("memory branch replay", () => {
  it("replays a recorded turn with a quarantined memory without mutating history", async () => {
    const { checkpoint, record } = fixture();
    const originalCheckpoint = structuredClone(checkpoint);
    const branch = createMemoryBranch({
      checkpoint,
      id: "branch-quarantine",
      createdAt: "2026-07-13T12:00:00.000Z",
      mutations: [{
        id: "mutation-quarantine",
        type: "quarantine",
        memoryId: "memory-indigo",
        reason: "Test the answer without this memory"
      }]
    });
    const materialized = applyMemoryBranch(checkpoint, branch);
    const branchContext = branchContextMemories(record, branch, materialized);
    const inputs: ChatTurnInput[] = [];
    const provider = providerFor(inputs);

    const result = await runMemoryBranchReplay({
      record,
      branch,
      branchContextMemories: branchContext
    }, provider);

    expect(inputs.map((input) => input.retrievedMemories.map((memory) => memory.id))).toEqual([
      ["memory-indigo"],
      []
    ]);
    expect(result).toMatchObject({
      evidence: "replayed",
      mode: "context-only-counterfactual",
      baselineMemoryIds: ["memory-indigo"],
      branchMemoryIds: [],
      changed: true,
      comparison: { outcome: "changed" },
      reproduction: { reproduced: true },
      capabilities: {
        rerunsCandidateGeneration: false,
        rerunsSelection: false,
        rerunsContextAssembly: true,
        rerunsGeneration: true
      }
    });
    expect(checkpoint).toEqual(originalCheckpoint);
  });

  it("maps an explicit replacement into branch context", () => {
    const { checkpoint, record } = fixture();
    const original = checkpoint.memories[0]!;
    const replacement = createReplacementMemory({
      branchId: "branch-replace",
      original,
      text: "User loves vermilion.",
      createdAt: "2026-07-13T12:00:00.000Z"
    });
    const branch = createMemoryBranch({
      checkpoint,
      id: "branch-replace",
      createdAt: "2026-07-13T12:00:00.000Z",
      mutations: [{
        id: "mutation-replace",
        type: "replace",
        memoryId: original.id,
        replacement,
        reason: "Test a corrected preference"
      }]
    });

    const context = branchContextMemories(record, branch, applyMemoryBranch(checkpoint, branch));

    expect(context.map((memory) => memory.text)).toEqual(["User loves vermilion."]);
  });

  it("rejects untracked memories in branch context", async () => {
    const { checkpoint, record } = fixture();
    const branch = createMemoryBranch({
      checkpoint,
      mutations: [{
        id: "mutation-quarantine",
        type: "quarantine",
        memoryId: "memory-indigo",
        reason: "test"
      }]
    });

    await expect(runMemoryBranchReplay({
      record,
      branch,
      branchContextMemories: [{ ...checkpoint.memories[0]!, id: "injected-memory" }]
    }, providerFor([]))).rejects.toBeInstanceOf(MemoryBranchReplayValidationError);
  });
});

function providerFor(inputs: ChatTurnInput[]): ChatProviderClient {
  return {
    id: "demo",
    model: "branch-test",
    streamTurn: vi.fn(async function* (input: ChatTurnInput) {
      inputs.push(structuredClone(input));
      yield {
        kind: "text" as const,
        delta: input.retrievedMemories.length > 0 ? "Your color is indigo." : "I do not know your color."
      };
      yield { kind: "done" as const };
    })
  };
}

function fixture() {
  const memory: EngramMemory = {
    id: "memory-indigo",
    text: "User loves indigo.",
    importance: 0.8,
    topic: "preference",
    region: "hippocampus",
    created_at: "2026-07-13T10:00:00.000Z",
    access_count: 1
  };
  const record: TurnRecord = {
    version: 1,
    id: "turn-record-indigo",
    sessionId: "session-test",
    startedAt: "2026-07-13T11:00:00.000Z",
    completedAt: "2026-07-13T11:00:01.000Z",
    userMessage: "What color do I love?",
    history: [],
    retrievedMemories: [memory],
    events: [],
    originalAnswer: "Your color is indigo.",
    provider: { id: "demo" }
  };
  const entries: MemoryTimelineEntry[] = [{
    id: "timeline-turn",
    kind: "conversation",
    status: "completed",
    userText: record.userMessage,
    assistantText: record.originalAnswer,
    events: [
      { type: "init", memories: [memory] },
      { type: "retrieve", query: record.userMessage, ids: [memory.id], accessed: [memory] },
      { type: "load", ids: [memory.id] }
    ],
    startedAt: record.startedAt,
    completedAt: record.completedAt
  }];
  const checkpoint = buildTimelineCheckpoints(entries, { "timeline-turn": record })[0]!;
  return { checkpoint, record };
}
