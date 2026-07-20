"use client";

import {
  AlertTriangle,
  Check,
  Download,
  FlaskConical,
  Play,
  ShieldCheck,
  Terminal
} from "lucide-react";
import { useMemo, useState } from "react";
import type { MemoryPolicyReplayResult } from "@engramviz/core";
import { CausalMemoryDiff } from "@/components/Incidents/CausalMemoryDiff";
import type { PublicDemoStory } from "@/lib/lab/demo-story";
import {
  answerLocationQuestion,
  createStaleLocationPolicyReplay
} from "@/lib/reliability/stale-location";
import { compileMemoryRegressionV2 } from "@/lib/regressions/v2-compiler";
import {
  runMemoryRegressionMatrixV2,
  type MemoryRegressionMatrixRunV2
} from "@/lib/regressions/v2-runner";
import type { BrainRegion } from "@/types";
import "@/components/UI/incident-workspace.css";

type PublicIncidentDemoProps = {
  onFocus: (memoryIds: string[], regions?: BrainRegion[]) => void;
  onReplayComplete: () => void;
  phase: "hidden" | "fail" | "repair" | "test";
  story: PublicDemoStory;
};

const localDemoCommand = "npx --yes @engramviz/cli demo stale-location";
const matrixExecutor = {
  id: "engram-public-location-agent",
  version: "1",
  deterministic: true as const,
  generateAnswer: answerLocationQuestion
};

export function PublicIncidentDemo({ onFocus, onReplayComplete, phase, story }: PublicIncidentDemoProps) {
  const { incident } = story;
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState<string>();
  const [replayResult, setReplayResult] = useState<MemoryPolicyReplayResult>();
  const [matrixRun, setMatrixRun] = useState<MemoryRegressionMatrixRunV2>();
  const [commandCopied, setCommandCopied] = useState(false);
  const failureStage = incident.stages.find((stage) => stage.kind === incident.diagnosis.stage);
  const staleMemory = incident.memories.find((memory) => memory.id === "sample-memory-san-francisco");
  const currentMemory = incident.memories.find((memory) => memory.id === "sample-memory-oakland");
  const replayVerified = replayResult?.verification.passed ?? false;

  const decisionRows = useMemo(() => [
    {
      label: "Memory state",
      observed: `${staleMemory?.text ?? "Older location"} stayed active beside the explicit correction.`,
      status: "failed" as const,
      memoryIds: [staleMemory?.id, currentMemory?.id].filter((id): id is string => Boolean(id)),
      regions: ["hippocampus"] as BrainRegion[]
    },
    {
      label: "Candidates",
      observed: "Both location memories entered the recorded top-1 retrieval decision.",
      status: "passed" as const,
      memoryIds: incident.memories.map((memory) => memory.id),
      regions: ["hippocampus"] as BrainRegion[]
    },
    {
      label: "Selected",
      observed: "San Francisco ranked first; Oakland was excluded by the top-1 limit.",
      status: "failed" as const,
      memoryIds: staleMemory ? [staleMemory.id] : [],
      regions: ["hippocampus", "prefrontal"] as BrainRegion[]
    },
    {
      label: "Active context",
      observed: "Only the stale San Francisco memory reached the answer context.",
      status: "failed" as const,
      memoryIds: incident.checkpoint.loadedMemoryIds,
      regions: ["prefrontal"] as BrainRegion[]
    },
    {
      label: "Answer",
      observed: incident.observedAnswer,
      status: "failed" as const,
      memoryIds: incident.checkpoint.loadedMemoryIds,
      regions: ["prefrontal"] as BrainRegion[]
    }
  ], [currentMemory, incident, staleMemory]);

  async function runRepair() {
    setReplayPending(true);
    setReplayError(undefined);
    onFocus(incident.diagnosis.memoryIds, ["hippocampus", "prefrontal"]);
    try {
      await Promise.resolve();
      const replay = createStaleLocationPolicyReplay();
      const artifact = compileMemoryRegressionV2({
        replay,
        id: "stale-location-policy-v2",
        title: "Current location remains authoritative",
        description: "The latest active correction must be selected and loaded across controlled memory variations.",
        variants: [
          {
            id: "paraphrase",
            label: "Query paraphrase",
            perturbations: [{ type: "query_paraphrase", query: "Where is my current home?" }]
          },
          {
            id: "new-entities",
            label: "Different cities",
            perturbations: [{
              type: "entity_substitution",
              target: { subject: "current_location", status: "active", valueContains: "Oakland" },
              from: "Oakland",
              to: "Lisbon"
            }]
          },
          {
            id: "near-tie",
            label: "Near score tie",
            perturbations: [{
              type: "score_margin",
              leader: { subject: "current_location", valueContains: "Oakland" },
              challenger: { subject: "current_location", valueContains: "San Francisco" },
              margin: 0.001
            }]
          },
          {
            id: "distractor",
            label: "Unrelated distractor",
            perturbations: [{
              type: "distractors",
              candidates: [{
                memory: {
                  id: "demo-distractor-coffee",
                  content: "User enjoys light-roast coffee.",
                  subject: "coffee_preference",
                  value: "light roast",
                  status: "active",
                  tier: "semantic",
                  scope: "user",
                  createdAt: replay.source.completedAt,
                  evidence: "simulated"
                },
                score: 0.1
              }]
            }]
          }
        ]
      });
      const matrix = runMemoryRegressionMatrixV2(artifact, matrixExecutor);
      setReplayResult(replay);
      setMatrixRun(matrix);
      onReplayComplete();
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "The deterministic policy replay could not run.");
    } finally {
      setReplayPending(false);
    }
  }

  function downloadRegression() {
    if (!matrixRun || !matrixRun.report.pass) return;
    const blob = new Blob([`${JSON.stringify(matrixRun.artifact, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "engram-stale-location-v2.engram-test.json";
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
      className="incident-workspace public-incident-demo public-incident-v2"
      data-presentation="guided-demo"
      data-presentation-phase={phase}
    >
      <div className="incident-scroll public-incident-v2__scroll">
        <header className="public-incident-v2__summary">
          <div>
            <span>Recorded incident</span>
            <h2>{incident.title}</h2>
          </div>
          <dl>
            <div><dt>Asked</dt><dd>{incident.question}</dd></div>
            <div><dt>Got</dt><dd>{incident.observedAnswer}</dd></div>
            <div><dt>Expected</dt><dd>{incident.expectedAnswer}</dd></div>
          </dl>
        </header>

        {phase === "fail" ? (
          <section className="public-incident-step" aria-labelledby="public-diagnose-title">
            <StepHeader
              eyebrow="1 / Diagnose"
              title={incident.diagnosis.label}
              detail={incident.diagnosis.summary}
              id="public-diagnose-title"
            />
            <div className="public-decision-ledger" aria-label="Recorded memory decision ledger">
              {decisionRows.map((row, index) => (
                <button
                  key={row.label}
                  data-status={row.status}
                  onClick={() => onFocus(row.memoryIds, row.regions)}
                  type="button"
                >
                  <i>{index + 1}</i>
                  <span><strong>{row.label}</strong><small>{row.observed}</small></span>
                  {row.status === "passed" ? <Check aria-label="Passed" size={14} /> : <AlertTriangle aria-label="Issue" size={14} />}
                </button>
              ))}
            </div>
            <div className="public-incident-v2__finding">
              <strong>Earliest recorded failure: {failureStage?.label ?? "Memory state"}</strong>
              <p>The trace shows an explicit correction relationship, but the stale fact remained active and won selection.</p>
            </div>
          </section>
        ) : null}

        {phase === "repair" ? (
          <section className="public-incident-step" aria-labelledby="public-intervene-title">
            <StepHeader
              eyebrow={replayResult ? "3 / Replay" : "2 / Intervene"}
              title={replayResult ? "Compare the policy branch" : "Change the memory policy, not the trace"}
              detail={replayResult
                ? "Engram first reproduced the bad baseline, then reran state resolution through answer generation over the recorded candidate set."
                : "The source run stays immutable. This branch resolves explicit corrections before ranking and excludes superseded facts."}
              id="public-intervene-title"
            />
            {!replayResult ? (
              <article className="public-policy-intervention">
                <div><FlaskConical size={16} /><span>Policy intervention</span></div>
                <h3>Prefer the latest active correction</h3>
                <ol>
                  <li>Resolve same-subject memories with explicit correction evidence.</li>
                  <li>Mark the older fact superseded in the branch.</li>
                  <li>Rerun eligibility, ranking, selection, context, and the fixture answer.</li>
                </ol>
                <p>Candidate generation is not rerun; the replay uses the recorded candidate set and says so explicitly.</p>
                <button
                  aria-busy={replayPending}
                  className="incident-primary-action"
                  disabled={replayPending}
                  onClick={() => void runRepair()}
                  type="button"
                >
                  <Play size={14} /> {replayPending ? "Replaying policy pipeline..." : "Run policy replay"}
                </button>
              </article>
            ) : (
              <>
                <div className="public-replay-verdict" data-verified={replayVerified} role="status">
                  <ShieldCheck size={17} />
                  <span>
                    <strong>{replayVerified ? "Baseline reproduced; treatment passed" : "Replay needs review"}</strong>
                    <small>{replayResult.baseline.answer.content} → {replayResult.treatment.answer.content}</small>
                  </span>
                </div>
                <CausalMemoryDiff
                  result={replayResult}
                  onFocusMemoryIds={(memoryIds) => onFocus(memoryIds, ["hippocampus", "prefrontal"])}
                />
              </>
            )}
            {replayError ? <p className="incident-error" role="alert">{replayError}</p> : null}
          </section>
        ) : null}

        {phase === "test" && matrixRun ? (
          <section className="public-incident-step" aria-labelledby="public-prove-title">
            <StepHeader
              eyebrow="4 / Prove"
              title={`${matrixRun.report.summary.variants.passed}/${matrixRun.report.summary.variants.total} reliability cases passed`}
              detail="The repair is now a portable semantic contract: which kind of memory must be selected and loaded, what must stay out, and what the answer must affirm."
              id="public-prove-title"
            />
            <div className="public-regression-matrix" role="list" aria-label="Regression variants">
              {matrixRun.report.variants.map((variant) => (
                <article data-status={variant.status} key={variant.id} role="listitem">
                  {variant.pass ? <Check size={14} /> : <AlertTriangle size={14} />}
                  <span><strong>{variant.label}</strong><small>{variant.summary.passed}/{variant.summary.total} assertions passed</small></span>
                </article>
              ))}
            </div>
            <div className="public-regression-contract">
              <span>Semantic assertions survive provider-generated IDs</span>
              <code>mustSelect(current_location: active) · mustNotLoad(current_location: superseded)</code>
            </div>
            <button className="incident-primary-action" disabled={!matrixRun.report.pass} onClick={downloadRegression} type="button">
              <Download size={14} /> Download executable regression
            </button>
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

function StepHeader({ detail, eyebrow, id, title }: { detail: string; eyebrow: string; id: string; title: string }) {
  return (
    <header className="public-incident-step__header">
      <span>{eyebrow}</span>
      <h3 id={id}>{title}</h3>
      <p>{detail}</p>
    </header>
  );
}
