import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryLineagePanel } from "@/components/UI/MemoryLineagePanel";
import type { MemoryLineageGraph } from "@/lib/lineage/types";

describe("MemoryLineagePanel", () => {
  it("does not render while closed", () => {
    render(<MemoryLineagePanel graph={graph} open={false} onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Memory lineage")).not.toBeInTheDocument();
  });

  it("shows the focused memory, ordered provenance nodes, labeled connectors, and legend", () => {
    render(<MemoryLineagePanel graph={graph} open onClose={vi.fn()} />);

    const panel = screen.getByLabelText("Memory lineage");
    expect(panel).toBeVisible();
    expect(screen.getByRole("heading", { name: "Memory lineage" })).toBeVisible();
    expect(screen.getByText("Focused memory")).toBeVisible();
    expect(screen.getAllByText("User prefers indigo interfaces.")).toHaveLength(2);
    expect(screen.getByText("created")).toBeVisible();
    expect(screen.getByText("derived into")).toBeVisible();
    expect(screen.getByText("proposed during dream")).toBeVisible();
    expect(screen.getByText("supplied to answer")).toBeVisible();
    expect(screen.queryByText("caused the answer")).not.toBeInTheDocument();
    expect(screen.getByText(/does not prove that it caused the answer/i)).toBeVisible();

    const labels = Array.from(panel.querySelectorAll(".memory-lineage-node-copy > strong")).map(
      (element) => element.textContent
    );
    expect(labels).toEqual([
      "I love indigo interfaces.",
      "User likes indigo.",
      "Dream review: palette preferences",
      "User prefers indigo interfaces.",
      "What palette should I use?"
    ]);

    expect(screen.getByRole("heading", { name: "Legend" })).toBeVisible();
    expect(screen.getByText("Stored or stabilized knowledge")).toBeVisible();
    expect(screen.getByText("A conversation event")).toBeVisible();
    expect(screen.getByText("An offline reflection proposal")).toBeVisible();
  });

  it("selects memory nodes but keeps turn and dream nodes non-interactive", async () => {
    const onSelectMemory = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryLineagePanel
        graph={graph}
        open
        onClose={vi.fn()}
        onSelectMemory={onSelectMemory}
      />
    );

    await user.click(screen.getByRole("button", { name: "Select memory: User likes indigo." }));
    expect(onSelectMemory).toHaveBeenCalledWith("memory-raw");
    expect(screen.queryByRole("button", { name: /What palette should I use/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dream review: palette preferences/i })).not.toBeInTheDocument();
  });

  it("closes from an accessible icon button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MemoryLineagePanel graph={graph} open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close memory lineage" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a useful empty state when no graph is available", () => {
    render(<MemoryLineagePanel open onClose={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("No lineage to show yet");
    expect(screen.getByText(/Store, retrieve, update, or dream over this memory/i)).toBeVisible();
  });
});

const graph: MemoryLineageGraph = {
  focusMemoryId: "memory-stable",
  relatedMemoryIds: ["memory-raw", "memory-stable"],
  nodes: [
    {
      id: "turn-answer",
      kind: "turn",
      label: "What palette should I use?",
      detail: "Engram answered with an indigo palette.",
      timestamp: "2026-07-13T10:04:00.000Z"
    },
    {
      id: "memory-stable-node",
      kind: "memory",
      memoryId: "memory-stable",
      label: "User prefers indigo interfaces.",
      detail: "Stable preference distilled from related memory.",
      timestamp: "2026-07-13T10:03:00.000Z",
      region: "temporal",
      status: "active"
    },
    {
      id: "turn-store",
      kind: "turn",
      label: "I love indigo interfaces.",
      timestamp: "2026-07-13T10:00:00.000Z"
    },
    {
      id: "dream-1",
      kind: "dream",
      label: "Dream review: palette preferences",
      detail: "Proposed a stable preference.",
      timestamp: "2026-07-13T10:02:00.000Z"
    },
    {
      id: "memory-raw-node",
      kind: "memory",
      memoryId: "memory-raw",
      label: "User likes indigo.",
      timestamp: "2026-07-13T10:01:00.000Z",
      region: "hippocampus",
      status: "superseded"
    }
  ],
  edges: [
    {
      id: "edge-created",
      sourceId: "turn-store",
      targetId: "memory-raw-node",
      kind: "created",
      label: "created"
    },
    {
      id: "edge-dream",
      sourceId: "memory-raw-node",
      targetId: "dream-1",
      kind: "dream_proposed",
      label: "proposed during dream"
    },
    {
      id: "edge-derived",
      sourceId: "dream-1",
      targetId: "memory-stable-node",
      kind: "derived",
      label: "derived into"
    },
    {
      id: "edge-supplied",
      sourceId: "memory-stable-node",
      targetId: "turn-answer",
      kind: "supplied_to_answer",
      label: "used to answer"
    }
  ]
};
