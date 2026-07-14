import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CausalXRayPanel } from "@/components/UI/CausalXRayPanel";
import type { CausalAblationResult, TurnRecord } from "@/lib/evidence/types";
import type { EngramMemory } from "@/types";

describe("Ablation Replay panel", () => {
  it("shows the excluded memory, original answer, and one run action", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();

    render(
      <CausalXRayPanel
        record={record}
        memory={memory}
        onRun={onRun}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Ablation Replay")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ablation Replay" })).toBeVisible();
    expect(screen.getByText("Memory omitted in replay")).toBeVisible();
    expect(screen.getByText(/tests whether that observable context change alters the output/i)).toBeVisible();
    expect(screen.getByText(/does not reveal hidden model reasoning/i)).toBeVisible();
    expect(screen.getByText(memory.text)).toBeVisible();
    expect(screen.getByText(record.originalAnswer)).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByLabelText("Baseline rerun")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run without this memory" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("compares the baseline and counterfactual answers with explicit replay evidence", () => {
    render(
      <CausalXRayPanel
        record={record}
        memory={memory}
        result={result}
        onRun={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Baseline rerun")).toHaveTextContent(result.baselineAnswer);
    expect(screen.getByLabelText("Answer without memory")).toHaveTextContent(result.counterfactualAnswer);
    expect(screen.getByLabelText("Replay evidence")).toHaveTextContent("Baseline context1 memories");
    expect(screen.getByText("Changed")).toBeVisible();
    expect(screen.getByText("Answer changed when this memory was omitted")).toBeVisible();
    expect(screen.getByLabelText("Ablation Replay")).toHaveTextContent(result.caveat);
    expect(screen.getByText(/One replay does not establish causality/i)).toBeVisible();
    expect(screen.getByText(/uncontrolled runtime differences may also change the answer/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run without this memory" })).not.toBeInTheDocument();
  });

  it("disables the run action and announces work while pending", () => {
    render(
      <CausalXRayPanel
        record={record}
        memory={memory}
        pending
        onRun={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("complementary")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Running without memory..." })).toBeDisabled();
  });

  it("announces errors, allows retry, and closes from the icon control", async () => {
    const onClose = vi.fn();
    const onRun = vi.fn();
    const user = userEvent.setup();

    render(
      <CausalXRayPanel
        record={record}
        memory={memory}
        error="The comparison could not be completed."
        onRun={onRun}
        onClose={onClose}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The comparison could not be completed.");
    await user.click(screen.getByRole("button", { name: "Run without this memory" }));
    await user.click(screen.getByRole("button", { name: "Close Ablation Replay" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const memory: EngramMemory = {
  id: "mem-indigo",
  text: "The user prefers indigo interfaces.",
  importance: 0.9,
  topic: "interface preference",
  region: "hippocampus",
  created_at: "2026-07-13T10:00:00.000Z",
  access_count: 3
};

const record: TurnRecord = {
  version: 1,
  id: "turn-7",
  sessionId: "session-1",
  startedAt: "2026-07-13T10:01:00.000Z",
  completedAt: "2026-07-13T10:01:01.000Z",
  userMessage: "What palette should I use?",
  history: [],
  retrievedMemories: [memory],
  events: [],
  originalAnswer: "Use an indigo-led palette with restrained cyan accents.",
  provider: { id: "demo" }
};

const result: CausalAblationResult = {
  version: 2,
  recordId: record.id,
  excludedMemoryIds: [memory.id],
  originalAnswer: record.originalAnswer,
  baselineAnswer: "Use an indigo-led palette with restrained cyan accents.",
  counterfactualAnswer: "Use a neutral palette with one high-contrast accent.",
  changed: true,
  comparison: {
    outcome: "changed",
    normalizedTextDistance: 0.72,
    answerLengthDelta: -8,
    baselineRuns: 1,
    counterfactualRuns: 1
  },
  caveat: "This is an estimated effect from reruns, not proof of deterministic causation.",
  provider: { id: "demo" }
};
