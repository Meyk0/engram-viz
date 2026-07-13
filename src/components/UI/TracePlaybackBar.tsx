"use client";

import {
  ChevronLeft,
  ChevronRight,
  ListTree,
  Pause,
  Play,
  RotateCcw,
  X
} from "lucide-react";
import type { NormalizedTrace, NormalizedTraceStep } from "@/lib/traces/types";
import "./trace-playback.css";

export type TracePlaybackSpeed = 0.5 | 1 | 2;

export type TracePlaybackBarProps = {
  currentStepIndex: number;
  onExit: () => void;
  onInspect: () => void;
  onNext: () => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onSeek: (stepIndex: number) => void;
  onSpeedChange: (speed: TracePlaybackSpeed) => void;
  playing: boolean;
  speed: TracePlaybackSpeed;
  trace: NormalizedTrace;
};

const SPEEDS: TracePlaybackSpeed[] = [0.5, 1, 2];

export function TracePlaybackBar({
  currentStepIndex,
  onExit,
  onInspect,
  onNext,
  onPlayPause,
  onPrevious,
  onRestart,
  onSeek,
  onSpeedChange,
  playing,
  speed,
  trace
}: TracePlaybackBarProps) {
  const totalSteps = trace.steps.length;
  const clampedIndex = Math.min(Math.max(currentStepIndex, -1), totalSteps - 1);
  const currentStep = trace.steps[clampedIndex];
  const currentPosition = clampedIndex + 1;
  const mappingState = getMappingState(currentStep);

  return (
    <section className="trace-playback-bar" aria-label="Trace playback controls">
      <div className="trace-playback-identity">
        <span className="trace-playback-source">{trace.trace.source.provider}</span>
        <strong title={trace.trace.name}>{trace.trace.name}</strong>
        <span className="trace-playback-count">{currentPosition}/{totalSteps}</span>
      </div>

      <div className="trace-transport" role="group" aria-label="Playback">
        <button type="button" onClick={onRestart} aria-label="Restart trace">
          <RotateCcw aria-hidden="true" size={14} />
        </button>
        <button type="button" onClick={onPrevious} aria-label="Previous trace step" disabled={clampedIndex < 0}>
          <ChevronLeft aria-hidden="true" size={15} />
        </button>
        <button className="trace-play-button" type="button" onClick={onPlayPause} aria-label={playing ? "Pause trace" : "Play trace"} disabled={totalSteps === 0}>
          {playing ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
        </button>
        <button type="button" onClick={onNext} aria-label="Next trace step" disabled={clampedIndex >= totalSteps - 1}>
          <ChevronRight aria-hidden="true" size={15} />
        </button>
      </div>

      <div className="trace-scrubber">
        <input
          type="range"
          min={0}
          max={totalSteps}
          step={1}
          value={currentPosition}
          onChange={(event) => onSeek(Number(event.target.value) - 1)}
          aria-label="Trace position"
          aria-valuetext={`${currentPosition} of ${totalSteps}${currentStep ? `, ${currentStep.name}` : ", before playback"}`}
          disabled={totalSteps === 0}
        />
        <div className="trace-current-step" aria-live="polite">
          <span className="trace-step-kind">{currentStep ? formatStepKind(currentStep.kind) : "Ready"}</span>
          <strong>{currentStep?.name ?? "Playback has not started"}</strong>
          <span className="trace-mapping-indicator" data-provenance={mappingState.provenance}>
            <i aria-hidden="true" />
            {mappingState.label}
          </span>
        </div>
      </div>

      <div className="trace-speed" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((value) => (
          <button
            aria-checked={speed === value}
            key={value}
            role="radio"
            type="button"
            onClick={() => onSpeedChange(value)}
          >
            {value}x
          </button>
        ))}
      </div>

      <div className="trace-playback-actions">
        <button type="button" onClick={onInspect} aria-label="Inspect trace">
          <ListTree aria-hidden="true" size={14} />
          <span>Inspect</span>
        </button>
        <button type="button" onClick={onExit} aria-label="Exit trace playback">
          <X aria-hidden="true" size={14} />
          <span>Exit</span>
        </button>
      </div>
    </section>
  );
}

function getMappingState(step?: NormalizedTraceStep): {
  label: string;
  provenance: "observed" | "mapped" | "none";
} {
  if (!step) return { label: "No memory event", provenance: "none" };
  const observedCount = step.memoryMappings.filter((mapping) => mapping.provenance === "observed").length;
  if (observedCount > 0) {
    return {
      label: observedCount === 1 ? "Observed memory event" : `${observedCount} observed memory events`,
      provenance: "observed"
    };
  }
  const mappedCount = step.memoryMappings.filter((mapping) => mapping.provenance === "mapped").length;
  if (mappedCount > 0) {
    return {
      label: mappedCount === 1 ? "Mapped memory event" : `${mappedCount} mapped memory events`,
      provenance: "mapped"
    };
  }
  return { label: "No memory event", provenance: "none" };
}

function formatStepKind(kind: NormalizedTraceStep["kind"]) {
  if (kind === "model") return "Model";
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
