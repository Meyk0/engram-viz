import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TraceImportDialog } from "@/components/UI/TraceImportDialog";
import { TraceInspectorPanel } from "@/components/UI/TraceInspectorPanel";
import { TracePlaybackBar } from "@/components/UI/TracePlaybackBar";
import type { NormalizedTrace } from "@/lib/traces/types";

describe("TraceImportDialog", () => {
  it("stays hidden when closed", () => {
    render(
      <TraceImportDialog
        open={false}
        onCancel={vi.fn()}
        onImport={vi.fn()}
        onLoadSample={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("imports pasted JSON locally and exposes sample and cancel actions", async () => {
    const onCancel = vi.fn();
    const onImport = vi.fn();
    const onLoadSample = vi.fn();
    const user = userEvent.setup();

    render(
      <TraceImportDialog
        open
        onCancel={onCancel}
        onImport={onImport}
        onLoadSample={onLoadSample}
      />
    );

    expect(screen.getByRole("dialog", { name: "Import a recorded trace" })).toBeVisible();
    expect(screen.getByText("Parsed locally; never uploaded.")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Trace JSON"), {
      target: { value: '{"object":"response","id":"resp-1"}' }
    });
    await user.click(screen.getByRole("button", { name: "Import trace" }));

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith('{"object":"response","id":"resp-1"}')
    );

    await user.click(screen.getByRole("button", { name: "Load sample trace" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onLoadSample).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("reports invalid pasted JSON before calling the importer", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();

    render(
      <TraceImportDialog
        open
        onCancel={vi.fn()}
        onImport={onImport}
        onLoadSample={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Trace JSON"), { target: { value: "{broken" } });
    await user.click(screen.getByRole("button", { name: "Import trace" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This is not valid JSON");
    expect(onImport).not.toHaveBeenCalled();
  });

  it("opens a live flight recorder and shows copyable processor setup", async () => {
    const onStartLive = vi.fn();
    const onStopLive = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <TraceImportDialog
        open
        onCancel={vi.fn()}
        onImport={vi.fn()}
        onLoadSample={vi.fn()}
        onStartLive={onStartLive}
        onStopLive={onStopLive}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Live" }));
    await user.click(screen.getByRole("button", { name: "Start flight recorder" }));
    expect(onStartLive).toHaveBeenCalledTimes(1);

    rerender(
      <TraceImportDialog
        open
        liveChannelId="live-test-channel-123"
        liveStatus="listening"
        onCancel={vi.fn()}
        onImport={vi.fn()}
        onLoadSample={vi.fn()}
        onStartLive={onStartLive}
        onStopLive={onStopLive}
      />
    );

    expect(screen.getByLabelText("Live flight recorder setup")).toHaveTextContent("Listening for first span");
    expect(screen.getByText(/addTraceProcessor/)).toHaveTextContent("live-test-channel-123");
    expect(screen.getByText("Ephemeral demo channel.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Stop listening" }));
    expect(onStopLive).toHaveBeenCalledTimes(1);
  });
});

describe("TracePlaybackBar", () => {
  it("controls playback, seeking, speed, inspection, and exit", async () => {
    const callbacks = {
      onExit: vi.fn(),
      onInspect: vi.fn(),
      onNext: vi.fn(),
      onPlayPause: vi.fn(),
      onPrevious: vi.fn(),
      onRestart: vi.fn(),
      onSeek: vi.fn(),
      onSpeedChange: vi.fn()
    };
    const user = userEvent.setup();

    render(
      <TracePlaybackBar
        {...callbacks}
        currentStepIndex={0}
        playing={false}
        speed={1}
        trace={trace}
      />
    );

    expect(screen.getByLabelText("Trace playback controls")).toHaveTextContent("1/3");
    expect(screen.getByText("Observed memory event")).toBeVisible();
    expect(screen.getByRole("radio", { name: "1x" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Play trace" }));
    await user.click(screen.getByRole("button", { name: "Previous trace step" }));
    await user.click(screen.getByRole("button", { name: "Next trace step" }));
    await user.click(screen.getByRole("button", { name: "Restart trace" }));
    await user.click(screen.getByRole("radio", { name: "2x" }));
    await user.click(screen.getByRole("button", { name: "Inspect trace" }));
    await user.click(screen.getByRole("button", { name: "Exit trace playback" }));
    fireEvent.change(screen.getByRole("slider", { name: "Trace position" }), { target: { value: "3" } });

    expect(callbacks.onPlayPause).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1);
    expect(callbacks.onNext).toHaveBeenCalledTimes(1);
    expect(callbacks.onRestart).toHaveBeenCalledTimes(1);
    expect(callbacks.onSpeedChange).toHaveBeenCalledWith(2);
    expect(callbacks.onInspect).toHaveBeenCalledTimes(1);
    expect(callbacks.onExit).toHaveBeenCalledTimes(1);
    expect(callbacks.onSeek).toHaveBeenCalledWith(2);
  });

  it("represents paused step zero without pretending a step already ran", () => {
    render(
      <TracePlaybackBar
        currentStepIndex={-1}
        playing={false}
        speed={1}
        trace={trace}
        onExit={vi.fn()}
        onInspect={vi.fn()}
        onNext={vi.fn()}
        onPlayPause={vi.fn()}
        onPrevious={vi.fn()}
        onRestart={vi.fn()}
        onSeek={vi.fn()}
        onSpeedChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Trace playback controls")).toHaveTextContent("0/3");
    expect(screen.getByText("Playback has not started")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous trace step" })).toBeDisabled();
  });

  it("replaces playback controls with an honest live ingest state", () => {
    render(
      <TracePlaybackBar
        currentStepIndex={2}
        live
        playing={false}
        speed={1}
        trace={trace}
        onExit={vi.fn()}
        onInspect={vi.fn()}
        onNext={vi.fn()}
        onPlayPause={vi.fn()}
        onPrevious={vi.fn()}
        onRestart={vi.fn()}
        onSeek={vi.fn()}
        onSpeedChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Live trace controls")).toHaveTextContent("Live flight recorder");
    expect(screen.queryByRole("button", { name: "Play trace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit trace playback" })).toHaveTextContent("Stop");
  });
});

describe("TraceInspectorPanel", () => {
  it("shows metadata, honest mapping provenance, and the current step", async () => {
    const onClose = vi.fn();
    const onSelectStep = vi.fn();
    const user = userEvent.setup();

    render(
      <TraceInspectorPanel
        currentStepIndex={1}
        onClose={onClose}
        onSelectStep={onSelectStep}
        open
        trace={trace}
      />
    );

    const panel = screen.getByLabelText("Trace inspector");
    expect(panel).toHaveTextContent("OpenAI demo trace");
    expect(panel).toHaveTextContent("OpenAI");
    expect(panel).toHaveTextContent("1 observed");
    expect(panel).toHaveTextContent("1 mapped");
    expect(screen.getAllByText("No memory event").length).toBeGreaterThan(0);
    expect(screen.getByText("Current").closest("li")).toHaveAttribute("data-current", "true");
    expect(panel).toHaveTextContent("Neither proves hidden model reasoning");

    await user.click(screen.getByRole("button", { name: "Go to step 3: Draft answer" }));
    await user.click(screen.getByRole("button", { name: "Close trace inspector" }));
    expect(onSelectStep).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exposes sanitized copy and export actions", async () => {
    const onCopyExport = vi.fn();
    const onExport = vi.fn();
    const user = userEvent.setup();
    render(
      <TraceInspectorPanel
        currentStepIndex={0}
        exportCopied
        onClose={vi.fn()}
        onCopyExport={onCopyExport}
        onExport={onExport}
        open
        trace={trace}
      />
    );

    expect(screen.getByText(/portable/)).toHaveTextContent(".engram");
    await user.click(screen.getByRole("button", { name: "Copy sanitized trace" }));
    await user.click(screen.getByRole("button", { name: "Download sanitized trace" }));
    expect(onCopyExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("stays hidden when closed", () => {
    render(
      <TraceInspectorPanel currentStepIndex={0} onClose={vi.fn()} open={false} trace={trace} />
    );

    expect(screen.queryByLabelText("Trace inspector")).not.toBeInTheDocument();
  });
});

const memory = {
  id: "mem-indigo",
  text: "User likes indigo.",
  importance: 0.8,
  region: "hippocampus" as const,
  created_at: "2026-07-13T10:00:00.000Z",
  access_count: 0
};

const trace: NormalizedTrace = {
  schemaVersion: 1,
  trace: {
    id: "trace-1",
    name: "OpenAI demo trace",
    source: { provider: "OpenAI", format: "agents-sdk" }
  },
  steps: [
    {
      id: "step-1",
      index: 0,
      kind: "custom",
      name: "Store preference",
      status: "completed",
      memoryMappings: [
        {
          provenance: "observed",
          event: { type: "store", memory },
          sourcePath: "items[0].span_data.event",
          note: "Explicit Engram memory event captured by the trace."
        }
      ]
    },
    {
      id: "step-2",
      index: 1,
      kind: "tool",
      name: "retrieve_memory",
      status: "completed",
      memoryMappings: [
        {
          provenance: "mapped",
          event: { type: "retrieve", query: "What color?", ids: [memory.id], accessed: [memory] },
          sourcePath: "items[1].span_data",
          note: "Recognized retrieve_memory tool translated deterministically."
        }
      ]
    },
    {
      id: "step-3",
      index: 2,
      kind: "model",
      name: "Draft answer",
      status: "completed",
      memoryMappings: []
    }
  ]
};
