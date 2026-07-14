import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstrumentationCoveragePanel } from "@/components/UI/InstrumentationCoveragePanel";
import type { NormalizedTrace } from "@/lib/traces/types";

describe("InstrumentationCoveragePanel", () => {
  it("renders compact capability states, evidence reasons, and the honesty boundary", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<InstrumentationCoveragePanel onClose={onClose} trace={trace} />);

    const panel = screen.getByLabelText("Instrumentation coverage");
    expect(panel).toHaveTextContent("What this trace can support");
    expect(screen.getByLabelText("Trace capability coverage").children).toHaveLength(8);
    expect(panel).toHaveTextContent("Agent spans");
    expect(panel).toHaveTextContent("Model calls");
    expect(panel).toHaveTextContent("Retrieval candidates");
    expect(panel).toHaveTextContent("selected IDs, but no candidate lists");
    expect(panel).toHaveTextContent("Missing telemetry is a blind spot");

    await user.click(screen.getByRole("button", { name: "Close instrumentation coverage" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const trace: NormalizedTrace = {
  schemaVersion: 1,
  trace: {
    id: "panel-trace",
    name: "Panel trace",
    source: { provider: "test", format: "normalized" }
  },
  steps: [
    {
      id: "agent",
      index: 0,
      kind: "agent",
      name: "Support agent",
      status: "completed",
      memoryMappings: []
    },
    {
      id: "retrieve",
      index: 1,
      kind: "tool",
      name: "retrieve_memory",
      status: "completed",
      input: { query: "preference" },
      output: { ids: ["memory-1"] },
      memoryMappings: [{
        provenance: "mapped",
        event: { type: "retrieve", query: "preference", ids: ["memory-1"] },
        sourcePath: "steps[1]",
        note: "Recognized retrieve_memory tool."
      }]
    }
  ]
};
