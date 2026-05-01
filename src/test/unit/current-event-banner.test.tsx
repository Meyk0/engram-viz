import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";

describe("CurrentEventBanner", () => {
  it("shows immediate memory thinking state while waiting for first response text", () => {
    render(<CurrentEventBanner events={[]} streaming />);

    expect(screen.getByText("Thinking through memory")).toBeInTheDocument();
    expect(screen.getByText(/Searching stored memories/)).toBeInTheDocument();
  });

  it("shows a live response preview while the assistant is streaming", () => {
    render(
      <CurrentEventBanner
        draftAssistant="You like blue, and I found that in the hippocampus memory trace."
        events={[]}
        streaming
      />
    );

    expect(screen.getByText("Engram responding")).toBeInTheDocument();
    expect(screen.getByText(/You like blue/)).toBeInTheDocument();
  });
});
