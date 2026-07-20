import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CausalMemoryDiff } from "@/components/Incidents/CausalMemoryDiff";
import { createStaleLocationPolicyReplay } from "@/lib/reliability/stale-location";

describe("CausalMemoryDiff", () => {
  it("shows all lifecycle stages and supports keyboard stage navigation", async () => {
    const result = createStaleLocationPolicyReplay();
    result.diff.stages[1]!.changed = false;
    result.diff.stages[1]!.summary = "Candidate eligibility and ranking remained unchanged.";
    const user = userEvent.setup();

    render(<CausalMemoryDiff result={result} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveTextContent("Changed");
    expect(tabs[1]).toHaveTextContent("Unchanged");

    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");

    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Candidate eligibility and ranking remained unchanged."
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Unchanged");
  });

  it("names the earliest divergence and compares baseline and treatment evidence", () => {
    const result = createStaleLocationPolicyReplay();

    render(<CausalMemoryDiff result={result} />);

    const divergence = screen.getByLabelText("Earliest divergence");
    expect(divergence).toHaveAttribute("data-stage", "memory_state");
    expect(divergence).toHaveTextContent("Memory state");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByLabelText("Baseline result")).toHaveTextContent(
      result.baseline.answer.content
    );
    expect(within(panel).getByLabelText("Treatment result")).toHaveTextContent(
      result.treatment.answer.content
    );
    const baselineResult = within(panel).getByLabelText("Baseline result");
    for (const memoryId of result.diff.stages[0]!.baselineMemoryIds) {
      expect(within(baselineResult).getByText(memoryId)).toBeVisible();
    }
    expect(screen.getByText(/does not reveal hidden model reasoning or prove/i)).toBeVisible();
  });

  it("discloses replay level and individual capability support", () => {
    const result = createStaleLocationPolicyReplay();

    render(<CausalMemoryDiff result={result} />);

    const scope = screen.getByLabelText("Replay capability scope");
    expect(scope).toHaveAttribute("data-replay-level", "policy");
    expect(scope).toHaveAttribute("data-capability-levels", "policy");
    expect(scope).toHaveAttribute("data-deterministic", "true");
    expect(within(scope).getByText("Candidate generation").closest("li"))
      .toHaveAttribute("data-supported", "false");
    expect(within(scope).getByText("Context assembly").closest("li"))
      .toHaveAttribute("data-supported", "true");
  });

  it("does not label incomparable evidence as unchanged", async () => {
    const result = createStaleLocationPolicyReplay();
    const answerStage = result.diff.stages.find((stage) => stage.stage === "answer")!;
    result.diff.status = "indeterminate";
    result.diff.earliestDivergence = undefined;
    result.diff.firstIncomparableStage = "answer";
    answerStage.comparable = false;
    answerStage.changed = false;
    answerStage.summary = "This stage cannot be compared because one run lacks evidence.";
    const user = userEvent.setup();

    render(<CausalMemoryDiff result={result} />);

    expect(screen.getByLabelText("Earliest divergence"))
      .toHaveTextContent("Indeterminate: Answer is not comparable");
    const answerTab = screen.getByRole("tab", { name: "Answer: Not comparable" });
    await user.click(answerTab);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Not comparable");
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("Unchanged");
  });

  it("reports focused treatment memory IDs through the callback", async () => {
    const result = createStaleLocationPolicyReplay();
    const onFocusMemoryIds = vi.fn();
    const user = userEvent.setup();

    render(
      <CausalMemoryDiff
        result={result}
        onFocusMemoryIds={onFocusMemoryIds}
      />
    );

    await user.click(screen.getByRole("tab", { name: /Selection: Changed/i }));
    await user.click(screen.getByRole("button", { name: "Focus treatment memory IDs" }));

    const selectionStage = result.diff.stages.find((stage) => stage.stage === "selection")!;
    expect(onFocusMemoryIds).toHaveBeenCalledWith(selectionStage.treatmentMemoryIds);
  });

  it("warns when the observed baseline was not reproduced", () => {
    const result = createStaleLocationPolicyReplay();
    result.reproduction = {
      reproduced: false,
      observedAnswer: "You live in San Francisco.",
      replayedAnswer: "Your current city is unknown."
    };

    render(<CausalMemoryDiff result={result} />);

    const warning = screen.getByRole("alert", { name: "Baseline reproduction status" });
    expect(warning).toHaveTextContent("Baseline not reproduced");
    expect(warning).toHaveTextContent("cannot be attributed to the policy change alone");
    expect(warning).toHaveTextContent("Observed answer");
    expect(warning).toHaveTextContent("Replayed baseline");
  });
});
