import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventFeed } from "@/components/UI/EventFeed";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import { OnboardingPanel } from "@/components/UI/OnboardingPanel";
import { RegionInspector } from "@/components/UI/RegionInspector";
import type { EngramEvent, EngramMemory } from "@/types";

describe("memory UX panels", () => {
  it("introduces Engram as a memory map instead of a generic chatbot", () => {
    render(<OnboardingPanel onStart={vi.fn()} />);

    expect(screen.getByText("AI Memory Map")).toBeVisible();
    expect(screen.getByText("See what the AI remembers, recalls, and uses.")).toBeVisible();
    expect(screen.getByText(/new facts are stored/i)).toBeVisible();
    expect(screen.getByText(/Click a region label or memory dot/i)).toBeVisible();
  });

  it("explains a selected brain region in human and AI terms", () => {
    render(<RegionInspector region="prefrontal" onClose={vi.fn()} open />);

    expect(screen.getByLabelText("Prefrontal Cortex explanation")).toBeVisible();
    expect(screen.getByText("Active Context Window")).toBeVisible();
    expect(screen.getByText("HUMAN BRAIN")).toBeVisible();
    expect(screen.getByText("AI MEMORY")).toBeVisible();
    expect(screen.getByText(/Retrieved memories are copied here/)).toBeVisible();
  });

  it("makes selected memory dots inspectable with latest-use context", () => {
    render(
      <MemoryInspector
        active
        latestQuery="What color do I love?"
        memory={makeMemory()}
        onClose={vi.fn()}
        open
      />
    );

    expect(screen.getByText("Used in the latest answer")).toBeVisible();
    expect(screen.getByText("User loves indigo.")).toBeVisible();
    expect(screen.getByText("LATEST QUESTION: What color do I love?")).toBeVisible();
    expect(screen.getByText("RETRIEVED")).toBeVisible();
    expect(screen.getByText(/Why here:/)).toBeVisible();
  });

  it("explains temporal memories that moved after repeated retrievals", () => {
    render(
      <MemoryInspector
        memory={{ ...makeMemory(), region: "temporal", access_count: 3 }}
        onClose={vi.fn()}
        open
      />
    );

    expect(screen.getAllByText("Semantic Memory").length).toBeGreaterThan(0);
    expect(screen.getByText("RETRIEVED")).toBeVisible();
    expect(screen.getByText(/Moved to semantic memory after being retrieved 3 times/)).toBeVisible();
  });

  it("rewrites low-level events as a user-facing memory story", () => {
    const events: EngramEvent[] = [
      {
        type: "plan",
        decision: {
          stage: "memory",
          operation: "ignore",
          provider: "llm",
          confidence: 0.93,
          reason: "OpenAI planner skipped storage: internal debug reason.",
          relatedMemoryIds: ["mem-indigo"]
        }
      },
      { type: "retrieve", query: "What color do I love?", ids: ["mem-indigo"], retrieval: { provider: "semantic" } },
      { type: "store", memory: makeMemory() }
    ];

    render(<EventFeed events={events} explainEvent={() => "Plain explanation."} onClose={vi.fn()} open />);

    expect(screen.getByLabelText("Memory story")).toBeVisible();
    expect(screen.getByText("Answered from memory")).toBeVisible();
    expect(screen.getByText("Found relevant memory")).toBeVisible();
    expect(screen.getByText("Stored a new memory")).toBeVisible();
    expect(screen.queryByText(/OpenAI planner/)).not.toBeInTheDocument();
    expect(screen.queryByText(/semantic search/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });
});

function makeMemory(): EngramMemory {
  return {
    id: "mem-indigo",
    text: "User loves indigo.",
    importance: 0.84,
    topic: "preference",
    region: "hippocampus",
    created_at: "2026-04-30T00:00:00.000Z",
    access_count: 1
  };
}
