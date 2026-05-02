import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";

describe("CurrentEventBanner", () => {
  it("shows immediate memory thinking state while waiting for first response text", () => {
    render(<CurrentEventBanner events={[]} streaming />);

    expect(screen.getByText("Checking memory")).toBeInTheDocument();
    expect(screen.getByText(/Looking for relevant memories/)).toBeInTheDocument();
    expect(screen.getByLabelText("Memory lifecycle")).toBeVisible();
    expect(screen.getByText("Retrieve")).toBeVisible();
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
});
