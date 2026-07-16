"use client";

import { ArrowRight, Check, Download, Play, ShieldCheck, Sparkles, Terminal } from "lucide-react";
import { useState } from "react";
import { expectedAnswerFragments } from "@/lib/incidents/expectations";
import type { IncidentEvidenceOrigin } from "@/lib/incidents/types";
import { executePublicDemoReplay } from "@/lib/lab/demo-replay";
import type { MemoryBranchReplayResult } from "@/lib/lab/types";
import type { PublicDemoStory } from "@/lib/lab/demo-story";
import {
  createMemoryRegressionArtifact,
  replayResultsFromBranchReplay,
  serializeMemoryRegressionArtifact
} from "@/lib/regressions/artifact";
import type { BrainRegion } from "@/types";
import "@/components/UI/incident-workspace.css";

type PublicIncidentDemoProps = {
  onFocus: (memoryIds: string[], regions?: BrainRegion[]) => void;
  onReplayComplete: () => void;
  phase: "hidden" | "fail" | "repair" | "test";
  story: PublicDemoStory;
};

const localDemoCommand = "npx --yes @engramviz/cli demo stale-location";

export function PublicIncidentDemo({ onFocus, onReplayComplete, phase, story }: PublicIncidentDemoProps) {
  const { incident, intervention } = story;
  const [selectedStageId, setSelectedStageId] = useState(
    incident.stages.find((stage) => stage.kind === incident.diagnosis.stage)?.id ?? incident.stages[0]?.id
  );
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState<string>();
  const [replayResult, setReplayResult] = useState<MemoryBranchReplayResult>();
  const [commandCopied, setCommandCopied] = useState(false);
  const selectedStage = incident.stages.find((stage) => stage.id === selectedStageId) ?? incident.stages[0];
  const replayVerified = replayResult?.branchAnswer.toLocaleLowerCase().includes(
    (incident.expectedAnswer ?? "").toLocaleLowerCase()
  ) ?? false;

  async function runRepair() {
    setReplayPending(true);
    setReplayError(undefined);
    onFocus(intervention.affectedMemoryIds, intervention.focusedRegions);
    try {
      const result = await executePublicDemoReplay({
        record: incident.record,
        branch: story.branch,
        branchContextMemories: story.branchContextMemories
      });
      setReplayResult(result);
      onReplayComplete();
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "The deterministic replay could not run.");
    } finally {
      setReplayPending(false);
    }
  }

  function downloadRegression() {
    if (!replayResult || !replayVerified) return;
    const branchIds = new Set(replayResult.branchMemoryIds);
    const removedEntities = incident.record.retrievedMemories
      .filter((memory) => !branchIds.has(memory.id))
      .flatMap((memory) => memory.entities ?? []);
    const artifact = createMemoryRegressionArtifact({
      checkpoint: incident.checkpoint,
      title: `Regression: ${incident.title}`,
      description: `Preserve the verified repair for “${incident.question}”.`,
      memoryFixture: incident.memories,
      replayResults: replayResultsFromBranchReplay(replayResult),
      assertions: {
        retrieval: {
          mustRetrieve: replayResult.branchMemoryIds,
          mustNotRetrieve: replayResult.baselineMemoryIds.filter((id) => !branchIds.has(id)),
          maxLoaded: replayResult.branchMemoryIds.length
        },
        answer: {
          contains: expectedAnswerFragments(incident.expectedAnswer ?? "Oakland"),
          notContains: removedEntities.slice(0, 5)
        }
      },
      metadata: {
        incidentId: incident.id,
        diagnosis: incident.diagnosis.kind,
        interventionId: intervention.id,
        evidenceBoundary: "deterministic-fixture-replay"
      }
    });
    const blob = new Blob([serializeMemoryRegressionArtifact(artifact)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "engram-stale-location.engram-test.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyLocalDemoCommand() {
    await navigator.clipboard?.writeText(localDemoCommand);
    setCommandCopied(true);
    window.setTimeout(() => setCommandCopied(false), 1_500);
  }

  return (
    <aside
      aria-hidden={phase === "hidden" ? true : undefined}
      aria-label="Memory Incident Workspace"
      className="incident-workspace public-incident-demo"
      data-presentation="guided-demo"
      data-presentation-phase={phase}
    >
      <div className="incident-scroll">
        <section className="incident-summary">
          <div className="incident-summary-heading">
            <div>
              <span><i data-status={incident.status} /> Recorded incident</span>
              <h2>{incident.title}</h2>
            </div>
            <EvidenceBadge origin={incident.diagnosis.origin} />
          </div>
          <div className="incident-answer-grid">
            <article><span>Question</span><p>{incident.question}</p></article>
            <article data-answer="observed"><span>Observed answer</span><p>{incident.observedAnswer}</p></article>
            <article data-answer="expected"><span>Expected</span><p>{incident.expectedAnswer}</p></article>
          </div>
        </section>

        <section className="incident-section incident-causal" aria-labelledby="public-incident-causal">
          <SectionHeading
            eyebrow="Capture"
            title="Follow the recorded memory decision"
            detail="Each stage comes from the bundled turn fixture. Select one to focus its evidence in the brain."
          />
          <ol className="incident-causal-spine" id="public-incident-causal">
            {incident.stages.map((stage, index) => (
              <li key={stage.id}>
                <button
                  aria-current={selectedStage?.id === stage.id ? "step" : undefined}
                  aria-label={`Inspect ${stage.label} evidence`}
                  data-active={selectedStage?.id === stage.id}
                  data-status={stage.status}
                  onClick={() => {
                    setSelectedStageId(stage.id);
                    onFocus(stage.memoryIds, stageRegions(stage.kind));
                  }}
                  type="button"
                >
                  <i>{stage.status === "passed" ? <Check size={11} /> : index + 1}</i>
                  <span><strong>{stage.label}</strong><small>{stage.summary}</small></span>
                </button>
                {index < incident.stages.length - 1 ? <ArrowRight aria-hidden="true" size={13} /> : null}
              </li>
            ))}
          </ol>
          {selectedStage ? (
            <div className="incident-evidence-list">
              {selectedStage.evidenceIds.flatMap((id) => {
                const evidence = incident.evidence.find((item) => item.id === id);
                return evidence ? [(
                  <article key={evidence.id}>
                    <div><EvidenceBadge origin={evidence.origin} /><strong>{evidence.label}</strong></div>
                    <p>{evidence.detail}</p>
                  </article>
                )] : [];
              })}
            </div>
          ) : null}
        </section>

        <section className="incident-section incident-diagnosis">
          <SectionHeading eyebrow="Diagnose" title={incident.diagnosis.label} detail={incident.diagnosis.summary} />
          <div className="incident-diagnosis-meta">
            <span>Deterministic rule diagnosis</span>
            <span>Failure stage: {incident.diagnosis.stage}</span>
            <EvidenceBadge origin={incident.diagnosis.origin} />
          </div>
        </section>

        <section className="incident-section incident-intervention">
          <SectionHeading
            eyebrow="Replay"
            title="Test one isolated repair"
            detail="The recorded incident stays immutable while the branch changes only the supplied memory context."
          />
          <article className="incident-recommended-fix">
            <div className="incident-fix-title">
              <span><Sparkles size={12} /> Recommended repair</span>
              <EvidenceBadge origin="inferred" label="Derived" />
            </div>
            <h3>{intervention.label}</h3>
            <p>{intervention.description}</p>
            <small>{intervention.reason}</small>
            <button className="incident-primary-action" disabled={replayPending} onClick={() => void runRepair()} type="button">
              <Play size={13} /> {replayPending ? "Running fixture replay..." : "Run deterministic repair"}
            </button>
          </article>
          {replayError ? <p className="incident-error">{replayError}</p> : null}
        </section>

        {replayResult ? (
          <section className="incident-section incident-replay" aria-labelledby="public-replay-result">
            <SectionHeading
              eyebrow="Replay"
              title={replayVerified ? "The repair produced the expected behavior" : "The answer changed"}
              detail="A browser-only fixture executor evaluated the same recorded turn against the original and repaired contexts."
            />
            <div className="incident-replay-status" data-verified={replayVerified} id="public-replay-result">
              <ShieldCheck size={15} />
              <span>{replayVerified ? "Verified against the incident expectation" : "The replay changed but missed the expectation"}</span>
            </div>
            <div className="incident-replay-grid">
              <article><span>Original</span><p>{replayResult.baselineAnswer}</p><small>{replayResult.baselineMemoryIds.length} context memory</small></article>
              <article data-replay="branch"><span>Branch</span><p>{replayResult.branchAnswer}</p><small>{replayResult.branchMemoryIds.length} context memory</small></article>
            </div>
            <div className="incident-context-diff">
              <span>Context change</span>
              <code>- San Francisco / + Oakland</code>
            </div>
            <p className="incident-caveat">{replayResult.caveat}</p>
          </section>
        ) : null}

        {replayResult ? (
          <section className="incident-section incident-prove public-demo-test-output" aria-labelledby="public-regression-title">
            <SectionHeading
              eyebrow="Test"
              title="Keep the repair from regressing"
              detail="Download the real portable fixture, replay evidence, and retrieval and answer assertions."
            />
            <div id="public-regression-title">
              <ul>
                <li><Check size={12} /> Require Oakland in active context</li>
                <li><Check size={12} /> Reject the superseded San Francisco fact</li>
                <li><Check size={12} /> Assert the expected answer evidence</li>
              </ul>
              <button className="incident-primary-action" disabled={!replayVerified} onClick={downloadRegression} type="button">
                <Download size={13} /> Download regression JSON
              </button>
            </div>
            <div className="public-demo-local-handoff">
              <code>{localDemoCommand}</code>
              <button onClick={() => void copyLocalDemoCommand()} type="button">
                <Terminal size={13} /> {commandCopied ? "Copied" : "Copy local demo command"}
              </button>
            </div>
            <nav className="public-demo-resource-links" aria-label="Engram resources">
              <a href="/docs">Docs</a>
              <a href="https://github.com/Meyk0/engram-viz" rel="noreferrer" target="_blank">GitHub</a>
            </nav>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="incident-section-heading"><span>{eyebrow}</span><h3>{title}</h3><p>{detail}</p></div>;
}

function EvidenceBadge({ origin, label }: { origin: IncidentEvidenceOrigin; label?: string }) {
  return <span className="incident-evidence-badge" data-origin={origin}>{label ?? origin}</span>;
}

function stageRegions(stage: string): BrainRegion[] {
  if (stage === "memory_state") return ["hippocampus", "temporal"];
  if (stage === "retrieval" || stage === "active_context" || stage === "answer") return ["prefrontal"];
  return [];
}
