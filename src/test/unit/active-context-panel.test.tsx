import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveContextPanel } from "@/components/UI/ActiveContextPanel";
import type { EngramMemory } from "@/types";

describe("ActiveContextPanel", () => {
  it("shows loaded working memories with retrieval context", () => {
    const memory = makeMemory("mem-style", "I prefer dark interfaces with red accents.");

    render(
      <ActiveContextPanel
        capacity={10}
        explanations={
          new Map([
            [
              memory.id,
              {
                id: memory.id,
                text: memory.text,
                matchedWords: ["dark", "red"],
                region: "hippocampus",
                regionLabel: "Hippocampus",
                regionConcept: "Episodic Store",
                accessCount: 2,
                importance: 0.86,
                sourceEvent: "load",
                sourceLabel: "Loaded for response context",
                sourceQuery: "What style do I prefer?"
              }
            ]
          ])
        }
        memories={[memory]}
        onClose={vi.fn()}
        open
        used={1}
      />
    );

    expect(screen.getByLabelText("Active context panel")).toBeVisible();
    expect(screen.getByText("1/10 loaded into active context")).toBeVisible();
    expect(screen.getByText(memory.text)).toBeVisible();
    expect(screen.getByText("Loaded for response context")).toBeVisible();
    expect(screen.getByText("QUERY: What style do I prefer?")).toBeVisible();
    expect(screen.getByText("red")).toBeVisible();
  });

  it("does not render while closed", () => {
    render(
      <ActiveContextPanel
        capacity={10}
        explanations={new Map()}
        memories={[]}
        onClose={vi.fn()}
        open={false}
        used={0}
      />
    );

    expect(screen.queryByLabelText("Active context panel")).not.toBeInTheDocument();
  });
});

function makeMemory(id: string, text: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.86,
    topic: "style",
    region: "hippocampus",
    created_at: "2026-04-30T00:00:00.000Z",
    access_count: 2
  };
}
