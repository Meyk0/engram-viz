import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RetrievalMRIPanel } from "@/components/UI/RetrievalMRIPanel";
import type { EngramMemory } from "@/types";

describe("RetrievalMRIPanel", () => {
  it("shows the recorded candidate funnel, score evidence, and final context state", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const memories = [
      memory("indigo", "User loves indigo."),
      memory("ramen", "User likes ramen."),
      { ...memory("blue", "User previously loved blue."), status: "superseded" as const }
    ];

    render(
      <RetrievalMRIPanel
        loadedMemoryIds={["indigo"]}
        memories={memories}
        onClose={onClose}
        retrieve={{
          type: "retrieve",
          query: "What color do I love?",
          ids: ["indigo"],
          retrieval: {
            provider: "semantic",
            reason: "Embeddings ranked the active memory set.",
            candidateCount: 3,
            eligibleCount: 2,
            selectedCount: 1,
            limit: 3,
            matches: [
              {
                id: "indigo",
                rank: 1,
                score: 0.91,
                similarity: 0.86,
                basis: "semantic",
                eligible: true,
                selected: true,
                components: { semantic: 0.86, importance: 0.03, access: 0.02 }
              },
              {
                id: "ramen",
                rank: 2,
                score: 0.12,
                basis: "semantic",
                eligible: true,
                selected: false,
                components: { semantic: 0.09, importance: 0.03 }
              },
              {
                id: "blue",
                rank: 3,
                score: 0,
                basis: "lexical",
                eligible: false,
                selected: false,
                filterReason: "Superseded memory"
              }
            ]
          }
        }}
      />
    );

    expect(screen.getByLabelText("Retrieval pipeline")).toHaveTextContent("Candidates3Eligible2Selected1Loaded1");
    expect(screen.getByText("User loves indigo.").closest("li")).toHaveAttribute("data-status", "loaded");
    expect(screen.getByText("User likes ramen.").closest("li")).toHaveAttribute("data-status", "candidate");
    expect(screen.getByText("User previously loved blue.").closest("li")).toHaveAttribute("data-status", "filtered");
    expect(screen.getByText(/Filtered: Superseded memory/)).toBeVisible();
    expect(screen.getAllByText("Semantic")).toHaveLength(2);
    expect(screen.getByText("Semantic embeddings")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close Retrieval MRI" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("labels a semantic provider short-circuit as lexical preflight", () => {
    render(
      <RetrievalMRIPanel
        loadedMemoryIds={["indigo"]}
        memories={[memory("indigo", "User loves indigo.")]}
        onClose={vi.fn()}
        retrieve={{
          type: "retrieve",
          query: "What color do I love?",
          ids: ["indigo"],
          retrieval: {
            provider: "semantic",
            matches: [{
              id: "indigo",
              rank: 1,
              score: 1.1,
              basis: "lexical",
              selected: true
            }]
          }
        }}
      />
    );

    expect(screen.getByText("Lexical preflight")).toBeVisible();
    expect(screen.queryByText("Semantic embeddings")).not.toBeInTheDocument();
  });
});

function memory(id: string, text: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    region: "hippocampus",
    created_at: "2026-07-13T10:00:00.000Z",
    access_count: 0
  };
}
