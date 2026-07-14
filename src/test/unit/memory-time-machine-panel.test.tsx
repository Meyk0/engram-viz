import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryTimeMachinePanel } from "@/components/UI/MemoryTimeMachinePanel";
import type { MemoryBranchReplayResult, MemoryCheckpoint } from "@/lib/lab/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemoryTimeMachinePanel", () => {
  it("branches an immutable checkpoint and renders observed replay evidence", async () => {
    const user = userEvent.setup();
    const onFocusMemoryIds = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(replayResult), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    render(
      <MemoryTimeMachinePanel
        checkpoints={[checkpoint]}
        onClose={vi.fn()}
        onFocusMemoryIds={onFocusMemoryIds}
      />
    );

    expect(screen.getByLabelText("Memory Time Machine")).toBeVisible();
    expect(screen.getAllByText(memory.text)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Replay branch" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Quarantine" }));
    expect(screen.getByText("Quarantined from branch")).toBeVisible();
    expect(screen.getAllByText(memory.text)).toHaveLength(2);
    expect(onFocusMemoryIds).toHaveBeenLastCalledWith([memory.id]);

    await user.click(screen.getByRole("button", { name: "Replay branch" }));

    await waitFor(() => expect(screen.getByLabelText("Branch replay result")).toBeVisible());
    expect(screen.getByText("The answer changed")).toBeVisible();
    expect(screen.getByText(replayResult.baselineAnswer)).toBeVisible();
    expect(screen.getByText(replayResult.branchAnswer)).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(body.branchContextMemories).toEqual([]);
  });

  it("labels trace checkpoints as state only", () => {
    render(
      <MemoryTimeMachinePanel
        checkpoints={[{ ...checkpoint, source: "trace", turnRecord: undefined }]}
        onClose={vi.fn()}
        onFocusMemoryIds={vi.fn()}
      />
    );

    expect(screen.getByText(/State-only checkpoint/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Replay branch" })).toBeDisabled();
  });
});

const memory = {
  id: "mem-indigo",
  text: "User loves the color indigo.",
  importance: 0.84,
  topic: "preference",
  region: "hippocampus" as const,
  created_at: "2026-07-13T10:00:00.000Z",
  access_count: 1
};

const checkpoint: MemoryCheckpoint = {
  version: 1,
  id: "checkpoint-turn-2",
  index: 1,
  label: "What color do I love?",
  source: "conversation",
  sourceId: "timeline-turn-2",
  createdAt: "2026-07-13T10:01:01.000Z",
  events: [],
  memories: [memory],
  loadedMemoryIds: [memory.id],
  query: "What color do I love?",
  answer: "You love indigo.",
  turnRecord: {
    version: 1,
    id: "turn-2",
    sessionId: "session-1",
    startedAt: "2026-07-13T10:01:00.000Z",
    completedAt: "2026-07-13T10:01:01.000Z",
    userMessage: "What color do I love?",
    history: [],
    retrievedMemories: [memory],
    events: [],
    originalAnswer: "You love indigo.",
    provider: { id: "demo" }
  }
};

const replayResult: MemoryBranchReplayResult = {
  version: 1,
  evidence: "replayed",
  recordId: "turn-2",
  branchId: "branch-checkpoint-turn-2",
  baselineMemoryIds: [memory.id],
  branchMemoryIds: [],
  baselineAnswer: "You love indigo.",
  branchAnswer: "I do not have a matching memory.",
  changed: true,
  comparison: {
    outcome: "changed",
    normalizedTextDistance: 0.72,
    answerLengthDelta: 12,
    baselineRuns: 1,
    counterfactualRuns: 1
  },
  caveat: "This is a controlled context replay and does not prove deterministic causality.",
  provider: { id: "demo" }
};
