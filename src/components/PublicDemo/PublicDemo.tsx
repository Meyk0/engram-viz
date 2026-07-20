"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Database,
  Pause,
  Play,
  RotateCcw
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Brain3D } from "@/components/Brain/Brain3D";
import { PublicIncidentDemo } from "@/components/PublicDemo/PublicIncidentDemo";
import {
  createPublicDemoStory,
  PUBLIC_DEMO_STEP_NAMES,
  type PublicDemoFrame
} from "@/lib/lab/demo-story";
import type { BrainRegion } from "@/types";
import "./public-demo.css";

const PLAYBACK_HOLD_MS = 6_000;

type FocusOverride = {
  stepIndex: number;
  memoryIds: string[];
  regions: BrainRegion[];
};

export function PublicDemo() {
  const story = useMemo(() => createPublicDemoStory(), []);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [replayComplete, setReplayComplete] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [focusOverride, setFocusOverride] = useState<FocusOverride>();
  const frame = story.frames[stepIndex] ?? story.frames[0];
  const incidentPhase = stepIndex < 2
    ? "hidden"
    : stepIndex === 2
      ? "diagnose"
      : stepIndex === 3
        ? "intervene"
        : stepIndex === 4 ? "replay" : "test";

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (stepIndex === 3 && !replayComplete) return;

    const timeout = window.setTimeout(() => {
      if (stepIndex >= PUBLIC_DEMO_STEP_NAMES.length - 1) {
        setPlaying(false);
        return;
      }
      setStepIndex((current) => Math.min(current + 1, PUBLIC_DEMO_STEP_NAMES.length - 1));
    }, PLAYBACK_HOLD_MS);

    return () => window.clearTimeout(timeout);
  }, [playing, replayComplete, stepIndex]);

  if (!frame) return null;

  const currentFocus = focusOverride?.stepIndex === stepIndex ? focusOverride : undefined;
  const focusedMemoryIds = currentFocus?.memoryIds ?? frame.focusedMemoryIds;
  const focusedRegions = currentFocus?.regions ?? frame.focusedRegions;
  const nextDisabled = stepIndex === PUBLIC_DEMO_STEP_NAMES.length - 1
    || (stepIndex === 3 && !replayComplete);

  function goToStep(nextStep: number) {
    if (nextStep >= 4 && !replayComplete) return;
    setStepIndex(Math.max(0, Math.min(nextStep, PUBLIC_DEMO_STEP_NAMES.length - 1)));
  }

  function restart() {
    setPlaying(false);
    setStepIndex(0);
    setSessionEpoch((current) => current + 1);
    setReplayComplete(false);
    setFocusOverride(undefined);
  }

  return (
    <main className="public-demo" data-step={frame.name.toLocaleLowerCase()}>
      <header className="public-demo-header">
        <Link className="public-demo-brand" href="/" aria-label="Engram home">
          <span>ENGRAM</span>
          <small>Memory incident lab</small>
        </Link>
        <div className="public-demo-runtime" aria-label="Demo runtime">
          <CircleDot size={11} />
          <span>Fixture-backed</span>
          <i />
          <span>Browser only</span>
        </div>
      </header>

      <section className="public-demo-stage" aria-live="polite">
        <Brain3D
          compactReference
          events={frame.events}
          focusedMemoryIds={focusedMemoryIds}
          focusedRegions={focusedRegions}
          focusPulseKey={`${sessionEpoch}-${stepIndex}-${focusedMemoryIds.join(".")}`}
          loadedMemoryIds={frame.loadedMemoryIds}
          memories={frame.memories}
          reduceMotion={reduceMotion}
          responseActive={frame.loadedMemoryIds.length > 0}
          retrievedMemoryIds={frame.retrievedMemoryIds}
          sceneEpoch={sessionEpoch * PUBLIC_DEMO_STEP_NAMES.length + stepIndex}
          selectedMemoryId={focusedMemoryIds[0]}
        />

        <div className="public-demo-narrative">
          <span>{frame.eyebrow}</span>
          <h1>{frame.title}</h1>
          <p>{frame.description}</p>
        </div>

        <div className="public-demo-signal" aria-label="Current evidence">
          <span>{frame.provenance}</span>
          <strong>{frame.evidence}</strong>
          <small>{frame.regionLabel}</small>
        </div>

        {stepIndex < 2 ? <DemoEvidenceRail frame={frame} /> : null}
        <PublicIncidentDemo
          key={sessionEpoch}
          onFocus={(memoryIds, regions = []) => setFocusOverride({ stepIndex, memoryIds, regions })}
          onReplayComplete={() => setReplayComplete(true)}
          phase={incidentPhase}
          story={story}
        />

        <p className="public-demo-caveat">
          <strong>Where the analogy breaks:</strong> brain regions organize memory lifecycle stages; they do not claim biological anatomy, hidden neural access, or a view inside model weights.
        </p>

      </section>

      <footer className="public-demo-controls">
        <div className="public-demo-transport">
          <button
            aria-label="Previous step"
            disabled={stepIndex === 0}
            onClick={() => goToStep(stepIndex - 1)}
            title="Previous"
            type="button"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            aria-label={playing ? "Pause guided demo" : "Play guided demo"}
            aria-pressed={playing}
            onClick={() => setPlaying((current) => !current)}
            title={playing ? "Pause" : "Play"}
            type="button"
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button aria-label="Restart demo" onClick={restart} title="Restart" type="button">
            <RotateCcw size={15} />
          </button>
        </div>

        <nav className="public-demo-steps" aria-label="Guided demo steps">
          {PUBLIC_DEMO_STEP_NAMES.map((name, index) => (
            <button
              aria-label={name}
              aria-current={index === stepIndex ? "step" : undefined}
              data-complete={index < stepIndex}
              disabled={index >= 4 && !replayComplete}
              key={name}
              onClick={() => goToStep(index)}
              type="button"
            >
              <i aria-hidden="true">{index < stepIndex ? <Check size={10} /> : index + 1}</i>
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="public-demo-next">
          <span>Step {stepIndex + 1} of {PUBLIC_DEMO_STEP_NAMES.length}</span>
          <button disabled={nextDisabled} onClick={() => goToStep(stepIndex + 1)} type="button">
            Next <ArrowRight size={14} />
          </button>
        </div>
      </footer>
    </main>
  );
}

function DemoEvidenceRail({ frame }: { frame: PublicDemoFrame }) {
  return (
    <aside className="public-demo-evidence" aria-label={`${frame.name} evidence`}>
      <header>
        <div><Database size={14} /><span>Memory state</span></div>
        <small>Deterministic fixture</small>
      </header>
      <div className="public-demo-evidence-body">
        <section>
          <span>Provenance</span>
          <strong>{frame.provenance}</strong>
          <p>{frame.evidence}</p>
        </section>
        <section>
          <span>Visual mapping</span>
          <strong>{frame.regionLabel}</strong>
          <p>Region highlighting follows the explicit lifecycle event shown in this step.</p>
        </section>
        <ol aria-label="Visible fixture memories">
          {frame.memories.map((memory) => (
            <li key={memory.id} data-status={memory.status ?? "active"}>
              <i />
              <div>
                <strong>{memory.text}</strong>
                <small>{memory.status ?? "active"} / {memory.access_count} prior accesses</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
