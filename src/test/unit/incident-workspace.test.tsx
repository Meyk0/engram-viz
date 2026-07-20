import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncidentWorkspace } from "@/components/UI/IncidentWorkspace";
import { buildTimelineCheckpoints } from "@/lib/lab/checkpoints";
import {
  createSampleMemoryIncident,
  createSampleMemoryIncidentCase
} from "@/lib/lab/sample-incident";
import type { MemoryBranchReplayResult } from "@/lib/lab/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IncidentWorkspace", () => {
  it("promotes a locally captured SDK turn into an incident", async () => {
    const user = userEvent.setup();
    const onCreateTraceIncident = vi.fn();
    const trace = {
      schemaVersion: 1 as const,
      trace: {
        id: "trace-local",
        name: "What city do I live in now?",
        source: { provider: "openai", format: "engram.telemetry.v2" }
      },
      steps: [{
        id: "answer",
        index: 0,
        kind: "model" as const,
        name: "openai",
        status: "completed" as const,
        output: { role: "assistant", content: "You live in San Francisco." },
        memoryMappings: []
      }]
    };

    render(
      <IncidentWorkspace
        localTraceStatus="ready"
        localTraces={[trace]}
        onClose={vi.fn()}
        onCreateTraceIncident={onCreateTraceIncident}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Captured agent turns")).toHaveTextContent("You live in San Francisco.");
    await user.type(screen.getByLabelText("Expected answer evidence"), "You live in Oakland.");
    await user.click(screen.getByRole("button", { name: "Diagnose captured turn" }));
    expect(onCreateTraceIncident).toHaveBeenCalledWith(trace, "You live in Oakland.");
  });

  it("presents one clear entry path while preserving trace import", async () => {
    const user = userEvent.setup();
    const onLoadSample = vi.fn();
    const onImportTrace = vi.fn();

    render(
      <IncidentWorkspace
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={onImportTrace}
        onLoadSample={onLoadSample}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Start with a bad agent answer" })).toBeVisible();
    const workflow = screen.getByLabelText("Memory incident workflow");
    for (const label of ["Diagnose", "Intervene", "Replay", "Prove"]) {
      expect(workflow).toHaveTextContent(label);
    }
    await user.click(screen.getByRole("button", { name: "Load reference incident" }));
    await user.click(screen.getByRole("button", { name: "Import agent trace" }));
    expect(onLoadSample).toHaveBeenCalledOnce();
    expect(onImportTrace).toHaveBeenCalledOnce();
  });

  it("promotes a recorded bad answer into an incident", async () => {
    const user = userEvent.setup();
    const onCreateIncident = vi.fn();
    const sample = createSampleMemoryIncident();
    const checkpoints = buildTimelineCheckpoints(
      [sample.entry],
      { [sample.entry.id]: sample.record }
    );

    render(
      <IncidentWorkspace
        checkpoints={checkpoints}
        onClose={vi.fn()}
        onCreateIncident={onCreateIncident}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Recorded answers")).toContainElement(
      screen.getByText("What city do I live in now?")
    );
    const diagnose = screen.getByRole("button", { name: "Diagnose this turn" });
    expect(diagnose).toBeDisabled();
    await user.type(screen.getByLabelText("Expected answer evidence"), "Oakland");
    await user.click(diagnose);

    expect(onCreateIncident).toHaveBeenCalledWith(checkpoints[0], "Oakland");
  });

  it("connects the observed answer to evidence and a diagnosis-specific repair", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const incident = createSampleMemoryIncidentCase();

    render(
      <IncidentWorkspace
        incident={incident}
        onClose={vi.fn()}
        onFocus={onFocus}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    expect(screen.getByText("Agent used an outdated location")).toBeVisible();
    expect(screen.getAllByText("You live in San Francisco.")[0]).toBeVisible();
    expect(screen.getAllByText("A stale fact remained active")[0]).toBeVisible();
    expect(screen.queryByText("Prefer the current fact")).not.toBeInTheDocument();
    expect(screen.getAllByText("Observed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("derived").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Inspect Retrieval evidence" }));
    expect(onFocus).toHaveBeenLastCalledWith(
      ["sample-memory-san-francisco", "sample-memory-oakland"],
      ["prefrontal"]
    );

    await user.click(screen.getByRole("button", { name: "Review interventions" }));
    expect(screen.getByText("Prefer the current fact")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run context counterfactual" })).not.toBeInTheDocument();
  });

  it("gates each task step on the action that actually completes it", async () => {
    const user = userEvent.setup();

    render(
      <IncidentWorkspace
        incident={createSampleMemoryIncidentCase()}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    const diagnose = screen.getByRole("tab", { name: /Diagnose/ });
    const intervene = screen.getByRole("tab", { name: /Intervene/ });
    const replay = screen.getByRole("tab", { name: /Replay/ });
    const prove = screen.getByRole("tab", { name: /Prove/ });

    expect(diagnose).toHaveAttribute("aria-selected", "true");
    expect(intervene).toBeDisabled();
    expect(replay).toBeDisabled();
    expect(prove).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Review interventions" }));
    expect(diagnose).toHaveAttribute("data-complete", "true");
    expect(intervene).toHaveAttribute("aria-selected", "true");
    expect(replay).toBeDisabled();
    expect(prove).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Continue with this intervention" }));
    expect(intervene).toHaveAttribute("data-complete", "true");
    expect(replay).toHaveAttribute("aria-selected", "true");
    expect(replay).toHaveAttribute("data-complete", "false");
    expect(prove).toBeDisabled();

    await user.click(diagnose);
    expect(diagnose).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "A stale fact remained active" })).toBeVisible();
  });

  it("reproduces the baseline before exporting a context regression", async () => {
    const user = userEvent.setup();
    const incident = createSampleMemoryIncidentCase();
    const onSaveRegression = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(replayResult), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    render(
      <IncidentWorkspace
        incident={incident}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={onSaveRegression}
      />
    );

    await user.click(screen.getByRole("button", { name: "Review interventions" }));
    await user.click(screen.getByRole("button", { name: "Continue with this intervention" }));
    expect(screen.getByRole("tab", { name: /Prove/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Run context counterfactual" }));

    await waitFor(() => {
      expect(screen.getByText("Proof gate passed for this context-only counterfactual")).toBeVisible();
    });
    const request = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body));
    expect(request.branchContextMemories.map((memory: { id: string }) => memory.id)).toEqual([
      "sample-memory-oakland"
    ]);
    expect(screen.getByRole("heading", { name: "Context-only counterfactual" })).toBeVisible();
    expect(screen.getByLabelText("Context-only replay boundary")).toHaveTextContent("Candidate generationNot rerun");
    expect(screen.getByLabelText("Context-only replay boundary")).toHaveTextContent("Answer generationReran");
    expect(screen.getByText("Matches recorded answer")).toBeVisible();
    expect(screen.getByRole("tab", { name: /Replay/ })).toHaveAttribute("data-complete", "true");
    expect(screen.getByRole("tab", { name: /Prove/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Review proof" }));
    expect(screen.getByRole("tab", { name: /Prove/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Prove/ })).toHaveAttribute("data-complete", "false");
    await user.click(screen.getByRole("button", { name: "Save context regression" }));
    expect(onSaveRegression).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: /Prove/ })).toHaveAttribute("data-complete", "true");
    expect(screen.getByText("Regression saved")).toBeVisible();
    expect(onSaveRegression.mock.calls[0]?.[0]).toMatchObject({
      kind: "engram.memory-regression",
      assertions: {
        retrieval: {
          mustRetrieve: ["sample-memory-oakland"],
          mustNotRetrieve: ["sample-memory-san-francisco"]
        },
        answer: {
          contains: ["Oakland"],
          notContains: ["San Francisco"]
        }
      }
    });
  });

  it("does not unlock proof when the regenerated baseline differs from the recorded answer", async () => {
    const user = userEvent.setup();
    const onSaveRegression = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(unreproducedReplayResult), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    render(
      <IncidentWorkspace
        incident={createSampleMemoryIncidentCase()}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={onSaveRegression}
      />
    );

    await user.click(screen.getByRole("button", { name: "Review interventions" }));
    await user.click(screen.getByRole("button", { name: "Continue with this intervention" }));
    await user.click(screen.getByRole("button", { name: "Run context counterfactual" }));

    await waitFor(() => expect(screen.getByText("Baseline not reproduced; proof remains locked")).toBeVisible());
    expect(screen.getByText("Does not match recorded answer")).toBeVisible();
    expect(screen.getByRole("tab", { name: /Prove/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Proof unavailable/ })).toBeDisabled();
    expect(onSaveRegression).not.toHaveBeenCalled();
  });

  it("announces replay work while keeping the active action area outside the scroller", async () => {
    const user = userEvent.setup();
    let resolveReplay: ((value: typeof replayResult) => void) | undefined;
    const replayExecutor = vi.fn(() => new Promise<typeof replayResult>((resolve) => {
      resolveReplay = resolve;
    }));

    render(
      <IncidentWorkspace
        incident={createSampleMemoryIncidentCase()}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
        replayExecutor={replayExecutor}
      />
    );

    await user.click(screen.getByRole("button", { name: "Review interventions" }));
    await user.click(screen.getByRole("button", { name: "Continue with this intervention" }));

    const panel = screen.getByRole("tabpanel");
    const actions = screen.getByLabelText("replay step actions");
    expect(panel.parentElement).not.toContainElement(actions);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Run context counterfactual" }));
    expect(panel.parentElement).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Regenerating baseline and counterfactual answers");

    resolveReplay?.(replayResult);
    await waitFor(() => expect(panel.parentElement).toHaveAttribute("aria-busy", "false"));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("labels counterfactual influence as simulated evidence", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(ablationResult), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    render(
      <IncidentWorkspace
        incident={createSampleMemoryIncidentCase()}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onImportTrace={vi.fn()}
        onLoadSample={vi.fn()}
        onOpenTool={vi.fn()}
        onSaveRegression={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Run influence check" }));
    await waitFor(() => expect(screen.getByText("Removing this memory changed the replayed answer.")).toBeVisible());
    expect(screen.getByText("simulated")).toBeVisible();
    expect(screen.getByText(/not proof of hidden causality/)).toBeVisible();
  });
});

const replayResult: MemoryBranchReplayResult = {
  version: 1,
  evidence: "replayed",
  mode: "context-only-counterfactual",
  recordId: "sample-turn-current-city",
  branchId: "branch-incident-current-city",
  baselineMemoryIds: ["sample-memory-san-francisco"],
  branchMemoryIds: ["sample-memory-oakland"],
  baselineAnswer: "You live in San Francisco.",
  branchAnswer: "Based on the retrieved memory: User lives in Oakland now.",
  changed: true,
  comparison: {
    outcome: "changed",
    normalizedTextDistance: 0.44,
    answerLengthDelta: -8,
    baselineRuns: 1,
    counterfactualRuns: 1
  },
  capabilities: {
    levels: ["context"],
    deterministic: true,
    reusesRecordedCandidates: true,
    rerunsCandidateGeneration: false,
    rerunsEligibility: false,
    rerunsRanking: false,
    rerunsSelection: false,
    rerunsContextAssembly: true,
    rerunsGeneration: true,
    supportsPolicyInterventions: false,
    supportsStateInterventions: false,
    supportsRepeatedRuns: false
  },
  reproduction: {
    method: "normalized-exact",
    reproduced: true,
    observedAnswer: "You live in San Francisco.",
    replayedAnswer: "You live in San Francisco."
  },
  caveat: "Controlled replay does not reproduce hidden model state.",
  provider: { id: "demo" }
};

const unreproducedReplayResult: MemoryBranchReplayResult = {
  ...replayResult,
  baselineAnswer: "Based on the retrieved memory: User moved to San Francisco in 2022.",
  reproduction: {
    method: "normalized-exact",
    reproduced: false,
    observedAnswer: "You live in San Francisco.",
    replayedAnswer: "Based on the retrieved memory: User moved to San Francisco in 2022."
  }
};

const ablationResult = {
  version: 2,
  recordId: "sample-turn-current-city",
  excludedMemoryIds: ["sample-memory-san-francisco"],
  originalAnswer: "You live in San Francisco.",
  baselineAnswer: "Based on the retrieved memory: User moved to San Francisco in 2022.",
  counterfactualAnswer: "I do not have a matching prior memory yet.",
  changed: true,
  comparison: {
    outcome: "changed",
    normalizedTextDistance: 0.7,
    answerLengthDelta: -18,
    baselineRuns: 1,
    counterfactualRuns: 1
  },
  caveat: "Controlled replay does not prove hidden model causality.",
  provider: { id: "demo" }
};
