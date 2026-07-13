import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";

describe("CurrentEventBanner", () => {
  it("shows immediate memory thinking state while waiting for first response text", () => {
    render(<CurrentEventBanner events={[]} streaming />);

    expect(screen.getByText("Reading this turn")).toBeInTheDocument();
    expect(screen.getByText(/stored, recalled, or answered directly/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Memory lifecycle")).not.toBeInTheDocument();
  });

  it("shows a live response preview while the assistant is streaming", () => {
    render(
      <CurrentEventBanner
        draftAssistant="You like blue, and I found that in the hippocampus memory trace."
        events={[]}
        streaming
      />
    );

    expect(screen.getByText("Answering")).toBeInTheDocument();
    expect(screen.getByText(/You like blue/)).toBeInTheDocument();
  });

  it("turns the completed receipt into the single provenance entry point", async () => {
    const onInspect = vi.fn();
    const user = userEvent.setup();

    render(
      <CurrentEventBanner
        events={[{ type: "fire", region: "prefrontal", ids: ["mem-indigo"] }]}
        onInspectUsedMemories={onInspect}
        usedMemoryCount={1}
      />
    );

    await user.click(screen.getByRole("button", { name: "Inspect 1 used memory" }));
    expect(onInspect).toHaveBeenCalledTimes(1);
  });
});
