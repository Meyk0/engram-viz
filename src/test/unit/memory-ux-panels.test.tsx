import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DemoPromptGuide } from "@/components/UI/DemoPromptGuide";
import { DreamReviewPanel } from "@/components/UI/DreamReviewPanel";
import { EventFeed } from "@/components/UI/EventFeed";
import { MemoryTimelinePanel } from "@/components/UI/MemoryTimelinePanel";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import { OnboardingPanel } from "@/components/UI/OnboardingPanel";
import { RegionInspector } from "@/components/UI/RegionInspector";
import { SecondaryDock } from "@/components/UI/SecondaryDock";
import { createConversationTimelineEntry } from "@/lib/timeline";
import type { DreamProposal } from "@/types";
import type { EngramEvent, EngramMemory } from "@/types";

describe("memory UX panels", () => {
  it("introduces Engram as a memory map instead of a generic chatbot", () => {
    render(<OnboardingPanel onStart={vi.fn()} />);

    expect(screen.getByText("AI memory, visible")).toBeVisible();
    expect(screen.getByText("Engram shows what the AI stores, retrieves, and uses.")).toBeVisible();
    expect(screen.getByText(/Durable facts become memory dots/i)).toBeVisible();
    expect(screen.getByText(/Start with one durable preference/i)).toBeVisible();
  });

  it("explains a selected brain region in human and AI terms", () => {
    render(<RegionInspector region="prefrontal" onClose={vi.fn()} open />);

    expect(screen.getByLabelText("Working Memory explanation")).toBeVisible();
    expect(screen.getByText("Prefrontal Cortex")).toBeVisible();
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
    expect(screen.getByText("Details")).toBeVisible();
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

    expect(screen.getAllByText("Stable Knowledge").length).toBeGreaterThan(0);
    expect(screen.getByText("Details")).toBeVisible();
    expect(screen.getByText(/Moved to stable knowledge after being retrieved 3 times/)).toBeVisible();
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
    expect(screen.getByText("Stored new memory")).toBeVisible();
    expect(screen.queryByText(/OpenAI planner/)).not.toBeInTheDocument();
    expect(screen.queryByText(/semantic search/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
  });

  it("shows a dream dock item after enough active memories exist", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <SecondaryDock
        activeContextCount={3}
        activePanel={null}
        dreamCount={3}
        dreamReady
        hasActiveContext
        hasMemoryDetails={false}
        hasRegionDetails={false}
        memoryCount={0}
        onSelect={onSelect}
        regionCount={0}
        timelineCount={0}
        transcriptCount={1}
      />
    );

    await user.click(screen.getByRole("button", { name: /Dream 3/i }));

    expect(onSelect).toHaveBeenCalledWith("dream");
  });

  it("opens a memory story dock item from a fresh session", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <SecondaryDock
        activeContextCount={0}
        activePanel={null}
        hasActiveContext={false}
        hasMemoryDetails={false}
        hasRegionDetails={false}
        memoryCount={0}
        onSelect={onSelect}
        regionCount={0}
        timelineCount={0}
        transcriptCount={0}
      />
    );

    await user.click(screen.getByRole("button", { name: "Story" }));

    expect(onSelect).toHaveBeenCalledWith("timeline");
  });

  it("fills but does not send guided demo prompts", async () => {
    const onPromptSelect = vi.fn();
    const user = userEvent.setup();

    render(<DemoPromptGuide prompt="I love the color indigo." onPromptSelect={onPromptSelect} />);

    await user.click(screen.getByRole("button", { name: /Fill demo prompt: I love the color indigo/i }));

    expect(onPromptSelect).toHaveBeenCalledWith("I love the color indigo.");
  });

  it("selects timeline entries for brain focus", async () => {
    const entry = createConversationTimelineEntry({
      id: "turn-1",
      startedAt: "2026-05-26T00:00:00.000Z",
      userText: "I love the color indigo."
    });
    const onSelectEntry = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryTimelinePanel
        activeEntryId={entry.id}
        entries={[entry]}
        onClearFocus={vi.fn()}
        onClose={vi.fn()}
        onSelectEntry={onSelectEntry}
        open
      />
    );

    await user.click(screen.getByRole("button", { name: /Turn 1/i }));

    expect(screen.getByLabelText("Timeline turn 1")).toHaveAttribute("data-active", "true");
    expect(onSelectEntry).toHaveBeenCalledWith(entry);
  });

  it("reviews dream proposals and lets users apply or keep memories", async () => {
    const proposal = makeDreamProposal();
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <DreamReviewPanel
        beforeMemories={[makeMemory(), { ...makeMemory(), id: "mem-ui", text: "User prefers dark dashboards." }]}
        onApply={onApply}
        onDismiss={onDismiss}
        open
        proposal={proposal}
      />
    );

    expect(screen.getByLabelText("Dream review")).toBeVisible();
    expect(screen.getByText("Before")).toBeVisible();
    expect(screen.getByText("After")).toBeVisible();
    expect(screen.getByText("User likes indigo and dark dashboard interfaces.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Apply dream" }));
    await user.click(screen.getByRole("button", { name: "Keep current memories" }));

    expect(onApply).toHaveBeenCalledWith(proposal);
    expect(onDismiss).toHaveBeenCalledWith(proposal);
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

function makeDreamProposal(): DreamProposal {
  return {
    id: "dream-1",
    provider: "deterministic",
    status: "proposed",
    reason: "Two active memories describe the same stable interface preference.",
    created_at: "2026-05-02T00:00:00.000Z",
    operations: [
      {
        id: "dream-op-1",
        type: "merge",
        sourceIds: ["mem-indigo", "mem-ui"],
        reason: "Both memories describe durable visual preferences.",
        confidence: 0.88,
        result: {
          ...makeMemory(),
          id: "mem-reflected",
          text: "User likes indigo and dark dashboard interfaces.",
          region: "temporal",
          sourceMemoryIds: ["mem-indigo", "mem-ui"]
        }
      }
    ]
  };
}
