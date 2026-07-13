import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RealityModeControl } from "@/components/UI/RealityModeControl";
import { SemanticModeHUD } from "@/components/UI/SemanticModeHUD";
import type { SemanticLayoutSnapshot } from "@/lib/semantic/types";

describe("RealityModeControl", () => {
  it("does not render before a memory exists", () => {
    render(<RealityModeControl memoryCount={0} mode="anatomical" onModeChange={vi.fn()} />);

    expect(screen.queryByRole("radiogroup", { name: "Reality mode" })).not.toBeInTheDocument();
  });

  it("exposes both reality modes as an accessible segmented control", async () => {
    const onModeChange = vi.fn();
    const user = userEvent.setup();

    render(<RealityModeControl memoryCount={3} mode="anatomical" onModeChange={onModeChange} />);

    expect(screen.getByRole("radio", { name: "Brain model" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Semantic map" })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Semantic map" }));

    expect(onModeChange).toHaveBeenCalledWith("semantic");
  });
});

describe("SemanticModeHUD", () => {
  it("explains the approximation and reports layout metadata", () => {
    render(<SemanticModeHUD snapshot={makeSnapshot()} />);

    const hud = screen.getByLabelText("Semantic map details");
    expect(hud).toHaveTextContent("Distance approximates semantic similarity.");
    expect(hud).toHaveTextContent("OpenAI");
    expect(hud).toHaveTextContent("Nodes2");
    expect(hud).toHaveTextContent("Clusters1");
  });
});

function makeSnapshot(): SemanticLayoutSnapshot {
  return {
    version: 1,
    signature: "memory-layout",
    provider: "openai",
    model: "text-embedding-3-small",
    algorithm: "similarity-force-v1",
    nodes: [
      { memoryId: "memory-1", position: [0, 0, 0], clusterId: "cluster-1" },
      { memoryId: "memory-2", position: [1, 0, 0], clusterId: "cluster-1" }
    ],
    edges: [{ sourceId: "memory-1", targetId: "memory-2", similarity: 0.8 }],
    clusters: [{ id: "cluster-1", memberIds: ["memory-1", "memory-2"] }],
    generatedAt: "2026-07-13T00:00:00.000Z"
  };
}
