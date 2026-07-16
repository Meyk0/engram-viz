"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleDot,
  Database,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  Terminal
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Brain3D } from "@/components/Brain/Brain3D";
import { IncidentWorkspace } from "@/components/UI/IncidentWorkspace";
import { executePublicDemoReplay } from "@/lib/lab/demo-replay";
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
  const [repairComplete, setRepairComplete] = useState(false);
  const [regressionSaved, setRegressionSaved] = useState(false);
  const [focusOverride, setFocusOverride] = useState<FocusOverride>();
  const [installCopied, setInstallCopied] = useState(false);
  const frame = story.frames[stepIndex] ?? story.frames[0];
  const incidentPhase = stepIndex < 2
    ? "hidden"
    : stepIndex === 2 ? "fail" : stepIndex === 3 ? "repair" : "test";

  useEffect(() => {
    if (!playing) return;
    if (stepIndex === 3 && !repairComplete) return;

    const timeout = window.setTimeout(() => {
      if (stepIndex >= PUBLIC_DEMO_STEP_NAMES.length - 1) {
        setPlaying(false);
        return;
      }
      setStepIndex((current) => Math.min(current + 1, PUBLIC_DEMO_STEP_NAMES.length - 1));
    }, PLAYBACK_HOLD_MS);

    return () => window.clearTimeout(timeout);
  }, [playing, repairComplete, stepIndex]);

  if (!frame) return null;

  const currentFocus = focusOverride?.stepIndex === stepIndex ? focusOverride : undefined;
  const focusedMemoryIds = currentFocus?.memoryIds ?? frame.focusedMemoryIds;
  const focusedRegions = currentFocus?.regions ?? frame.focusedRegions;
  const nextDisabled = stepIndex === PUBLIC_DEMO_STEP_NAMES.length - 1
    || (stepIndex === 3 && !repairComplete);

  function goToStep(nextStep: number) {
    if (nextStep === 4 && !repairComplete) return;
    setStepIndex(Math.max(0, Math.min(nextStep, PUBLIC_DEMO_STEP_NAMES.length - 1)));
  }

  function restart() {
    setPlaying(false);
    setStepIndex(0);
    setSessionEpoch((current) => current + 1);
    setRepairComplete(false);
    setRegressionSaved(false);
    setFocusOverride(undefined);
    setInstallCopied(false);
  }

  async function copyInstallCommand() {
    await navigator.clipboard?.writeText("npm install @engramviz/sdk");
    setInstallCopied(true);
    window.setTimeout(() => setInstallCopied(false), 1_500);
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
          events={frame.events}
          focusedMemoryIds={focusedMemoryIds}
          focusedRegions={focusedRegions}
          focusPulseKey={`${sessionEpoch}-${stepIndex}-${focusedMemoryIds.join(".")}`}
          loadedMemoryIds={frame.loadedMemoryIds}
          memories={frame.memories}
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
        <IncidentWorkspace
          key={sessionEpoch}
          incident={story.incident}
          onClose={() => undefined}
          onFocus={(memoryIds, regions = []) => setFocusOverride({ stepIndex, memoryIds, regions })}
          onImportTrace={() => undefined}
          onLoadSample={() => undefined}
          onOpenTool={() => undefined}
          onReplayComplete={() => setRepairComplete(true)}
          onSaveRegression={() => setRegressionSaved(true)}
          presentationMode="guided-demo"
          presentationPhase={incidentPhase}
          replayExecutor={executePublicDemoReplay}
        />

        <p className="public-demo-caveat">
          <strong>Where the analogy breaks:</strong> brain regions organize memory lifecycle stages; they do not claim biological anatomy, hidden neural access, or a view inside model weights.
        </p>

        {stepIndex === 4 ? (
          <section className="public-demo-final" aria-label="Continue with Engram">
            <span>{regressionSaved ? <Check size={12} /> : <Terminal size={12} />}</span>
            <div>
              <strong>{regressionSaved ? "Regression artifact ready" : "Take the workflow to your agent"}</strong>
              <small>Instrument real turns locally, then investigate them in Engram Studio.</small>
            </div>
            <div className="public-demo-final-actions">
              <button onClick={() => void copyInstallCommand()} type="button">
                <Terminal size={13} /> {installCopied ? "Copied" : "Install"}
              </button>
              <Link href="/docs"><BookOpen size={13} /> Docs</Link>
              <a href="https://github.com/Meyk0/engram-viz" rel="noreferrer" target="_blank">
                <ExternalLink size={13} /> GitHub
              </a>
            </div>
          </section>
        ) : null}
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
              aria-current={index === stepIndex ? "step" : undefined}
              data-complete={index < stepIndex}
              disabled={index === 4 && !repairComplete}
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
