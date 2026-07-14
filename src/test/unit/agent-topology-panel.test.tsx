import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentTopologyPanel } from "@/components/UI/AgentTopologyPanel";
import { buildAgentTopology } from "@/lib/topology/build";
import { importAgentTrace } from "@/lib/traces/import";
import { sampleAgentTrace } from "@/lib/traces/sample";

describe("AgentTopologyPanel", () => {
  it("shows recorded agents, scopes, handoffs, and evidence provenance", async () => {
    const trace = importAgentTrace(sampleAgentTrace).trace;
    const topology = buildAgentTopology(trace);
    const onSelectStep = vi.fn();
    const handoff = topology.edges.find((edge) => edge.kind === "handoff");
    const user = userEvent.setup();

    render(
      <AgentTopologyPanel
        currentStepId={handoff?.stepId}
        onClose={vi.fn()}
        onSelectStep={onSelectStep}
        topology={topology}
      />
    );

    const panel = screen.getByLabelText("Agent memory topology");
    expect(panel).toHaveTextContent("Coordinator");
    expect(panel).toHaveTextContent("Memory Specialist");
    expect(panel).toHaveTextContent("Shared memory / profile-memory");
    expect(panel).toHaveTextContent("Delegate profile recall");
    expect(panel).toHaveTextContent("Unknown scope0");
    expect(panel).toHaveTextContent("Unknown scope remains unknown");

    await user.click(screen.getByRole("button", { name: "Go to topology step: Delegate profile recall" }));
    expect(onSelectStep).toHaveBeenCalledWith(handoff?.stepId);
  });
});
