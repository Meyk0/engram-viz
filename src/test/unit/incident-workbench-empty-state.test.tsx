import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IncidentWorkbenchEmptyState } from "@/components/UI/IncidentWorkbenchEmptyState";

describe("IncidentWorkbenchEmptyState", () => {
  it("presents the golden memory-incident workflow in order", () => {
    render(
      <IncidentWorkbenchEmptyState
        onLoadSampleIncident={vi.fn()}
        onReturnToLearn={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Start with a memory incident" })).toBeVisible();

    const steps = screen.getByRole("list", { name: "Memory incident workflow" });
    expect(steps).toHaveTextContent(
      "Inspect retrievalSee what was considered, filtered, and loaded."
    );
    expect(steps).toHaveTextContent(
      "Test without memoryReplay the turn with one memory removed."
    );
    expect(steps).toHaveTextContent(
      "Branch a fixQuarantine or replace memory without changing the live session."
    );
    expect(steps).toHaveTextContent(
      "Save regressionKeep the repaired behavior as a repeatable check."
    );

    const labels = screen.getAllByRole("listitem").map((item) =>
      item.querySelector("strong")?.textContent
    );
    expect(labels).toEqual([
      "Inspect retrieval",
      "Test without memory",
      "Branch a fix",
      "Save regression"
    ]);
  });

  it("exposes the sample and Learn callbacks as distinct actions", async () => {
    const onLoadSampleIncident = vi.fn();
    const onReturnToLearn = vi.fn();
    const user = userEvent.setup();

    render(
      <IncidentWorkbenchEmptyState
        onLoadSampleIncident={onLoadSampleIncident}
        onReturnToLearn={onReturnToLearn}
      />
    );

    await user.click(screen.getByRole("button", { name: "Load sample incident" }));
    await user.click(screen.getByRole("button", { name: "Return to Learn" }));

    expect(onLoadSampleIncident).toHaveBeenCalledTimes(1);
    expect(onReturnToLearn).toHaveBeenCalledTimes(1);
  });
});
