import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  FileSearch,
  FlaskConical,
  GitBranch,
  Play,
  Radar,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { causalAblationResultSchema, memoryBranchReplayResultSchema } from "@/lib/events/schema";
import {
  memoryExecutorManifestSchema,
  parseMemoryExecutorReplayResult,
  type MemoryExecutorManifest,
  type MemoryPolicyReplayResult
} from "@engramviz/core";
import { CausalMemoryDiff } from "@/components/Incidents/CausalMemoryDiff";
import type { LocalIncidentTraceStatus } from "@/hooks/useLocalIncidentTraces";
import { buildIncidentInterventions } from "@/lib/incidents/interventions";
import { answerSupportsExpectation, expectedAnswerFragments } from "@/lib/incidents/expectations";
import { buildSourceRemediationRecipe } from "@/lib/incidents/remediation";
import type {
  MemoryIncident,
  MemoryIncidentIntervention,
  MemoryInfluenceResult
} from "@/lib/incidents/types";
import { applyMemoryBranch, branchContextMemories, createMemoryBranch } from "@/lib/lab/branches";
import type {
  MemoryBranchReplayRequest,
  MemoryBranchReplayResult,
  MemoryCheckpoint
} from "@/lib/lab/types";
import type { NormalizedTrace } from "@/lib/traces/types";
import {
  createMemoryRegressionArtifact,
  replayResultsFromBranchReplay,
  type MemoryRegressionArtifact
} from "@/lib/regressions";
import { compileMemoryRegressionV2 } from "@/lib/regressions/v2-compiler";
import type { MemoryRegressionArtifactV2 } from "@/lib/regressions/v2-schema";
import { memoryPolicyReplayRequestFromIncident } from "@/lib/reliability/from-incident";
import type { BrainRegion } from "@/types";
import "./incident-workspace.css";

type IncidentTaskStep = "diagnose" | "intervene" | "replay" | "prove";

const incidentTaskSteps: Array<{
  id: IncidentTaskStep;
  label: string;
  detail: string;
}> = [
  { id: "diagnose", label: "Diagnose", detail: "Find the failing memory decision" },
  { id: "intervene", label: "Intervene", detail: "Choose an isolated repair" },
  { id: "replay", label: "Replay", detail: "Run a bounded counterfactual" },
  { id: "prove", label: "Prove", detail: "Save the repair as a test" }
];

type IncidentWorkspaceProps = {
  checkpoints?: MemoryCheckpoint[];
  incident?: MemoryIncident;
  localTraceError?: string;
  localTraceStatus?: LocalIncidentTraceStatus;
  localTraces?: NormalizedTrace[];
  onClose: () => void;
  onCreateIncident?: (checkpoint: MemoryCheckpoint, expectedAnswer: string) => void;
  onCreateTraceIncident?: (trace: NormalizedTrace, expectedAnswer: string) => void;
  onFocus: (memoryIds: string[], regions?: BrainRegion[]) => void;
  onImportTrace: () => void;
  onLoadSample: () => void;
  onOpenTool: (tool: "timeMachine" | "integrity" | "retrieval" | "trace") => void;
  onReplayComplete?: (result: MemoryBranchReplayResult) => void;
  onSaveRegression: (artifact: MemoryRegressionArtifact | MemoryRegressionArtifactV2) => void;
  presentationMode?: "standard" | "guided-demo";
  presentationPhase?: "hidden" | "fail" | "repair" | "test";
  replayExecutor?: (request: MemoryBranchReplayRequest) => Promise<MemoryBranchReplayResult>;
  brainOpen?: boolean;
  onToggleBrain?: () => void;
};

export function IncidentWorkspace({
  checkpoints = [],
  incident,
  localTraceError,
  localTraceStatus = "unavailable",
  localTraces = [],
  onClose,
  onCreateIncident,
  onCreateTraceIncident,
  onFocus,
  onImportTrace,
  onLoadSample,
  onOpenTool,
  onReplayComplete,
  onSaveRegression,
  presentationMode = "standard",
  presentationPhase,
  replayExecutor,
  brainOpen = false,
  onToggleBrain
}: IncidentWorkspaceProps) {
  const directLink = useMemo(() => readDirectIncidentLink(), []);
  const guidedDemo = presentationMode === "guided-demo";
  const interventions = useMemo(
    () => incident ? buildIncidentInterventions(incident) : [],
    [incident]
  );
  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(
    () => guidedDemo
      ? incident?.stages.find((stage) => stage.kind === incident.diagnosis.stage)?.id
        ?? incident?.stages[0]?.id
      : incident?.stages[0]?.id
  );
  const [selectedInterventionId, setSelectedInterventionId] = useState<string | undefined>(
    () => interventions[0]?.id
  );
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState<string>();
  const [replayResult, setReplayResult] = useState<MemoryBranchReplayResult>();
  const [policyReplayResult, setPolicyReplayResult] = useState<MemoryPolicyReplayResult>();
  const [executorLookup, setExecutorLookup] = useState<{
    incidentId: string;
    status: "available" | "unavailable";
    manifest?: MemoryExecutorManifest;
  }>();
  const [influencePending, setInfluencePending] = useState(false);
  const [influenceError, setInfluenceError] = useState<string>();
  const [influenceResults, setInfluenceResults] = useState<MemoryInfluenceResult[]>([]);
  const [regressionSaved, setRegressionSaved] = useState(false);
  const replayableCheckpoints = useMemo(
    () => checkpoints.filter((checkpoint) => Boolean(checkpoint.turnRecord && checkpoint.answer)),
    [checkpoints]
  );
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | undefined>(
    () => replayableCheckpoints.at(-1)?.id
  );
  const [expectedAnswer, setExpectedAnswer] = useState(directLink.expectedAnswer ?? "");
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>(directLink.traceId);
  const directIncidentOpened = useRef(false);
  const [recipeCopied, setRecipeCopied] = useState(false);
  const [activeStep, setActiveStep] = useState<IncidentTaskStep>("diagnose");
  const [diagnosisReviewed, setDiagnosisReviewed] = useState(false);
  const [interventionConfirmed, setInterventionConfirmed] = useState(false);

  const executorEligible = Boolean(!guidedDemo && incident && hasLangGraphReplayCheckpoint(incident));
  const currentExecutorLookup = executorLookup?.incidentId === incident?.id
    ? executorLookup
    : undefined;
  const executorStatus = !executorEligible
    ? "unavailable"
    : currentExecutorLookup
      ? currentExecutorLookup.status
      : "checking";
  const executorManifest = currentExecutorLookup?.manifest;

  useEffect(() => {
    if (!incident || !executorEligible) return;
    let active = true;
    const incidentId = incident.id;
    void fetch("/api/local/executor", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!active || !response.ok || !isRecord(payload) || payload.available !== true) {
          if (active) setExecutorLookup({ incidentId, status: "unavailable" });
          return;
        }
        setExecutorLookup({
          incidentId,
          status: "available",
          manifest: memoryExecutorManifestSchema.parse(payload.manifest)
        });
      })
      .catch(() => {
        if (active) setExecutorLookup({ incidentId, status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [executorEligible, incident]);

  useEffect(() => {
    if (
      incident
      || directIncidentOpened.current
      || !directLink.traceId
      || !directLink.expectedAnswer
      || !onCreateTraceIncident
    ) return;
    const trace = localTraces.find((candidate) => candidate.trace.id === directLink.traceId);
    if (!trace) return;
    directIncidentOpened.current = true;
    onCreateTraceIncident(trace, directLink.expectedAnswer);
  }, [directLink, incident, localTraces, onCreateTraceIncident]);

  if (!incident) {
    return (
      <aside className="incident-workspace" aria-label="Memory Incident Workspace">
        <WorkspaceHeader brainOpen={brainOpen} onClose={onClose} onToggleBrain={onToggleBrain} />
        <div className="incident-empty">
          <div className="incident-empty-mark"><FileSearch size={24} /></div>
          <span>Memory incident workspace</span>
          <h2>Start with a bad agent answer</h2>
          <p>
            Select a captured answer, state what should have happened, and Engram will reconstruct the memory failure.
          </p>
          {localTraceStatus !== "unavailable" ? (
            <section className="incident-recorded-turns" aria-label="Captured agent turns">
              <div>
                <strong>Captured agent turns</strong>
                <span>Live from the local Engram SDK.</span>
              </div>
              {localTraces.length > 0 && onCreateTraceIncident ? (
                <div className="incident-recorded-list">
                  {localTraces.slice(-5).reverse().map((trace) => (
                    <button
                      aria-pressed={(selectedTraceId ?? localTraces.at(-1)?.trace.id) === trace.trace.id}
                      data-selected={(selectedTraceId ?? localTraces.at(-1)?.trace.id) === trace.trace.id}
                      key={trace.trace.id}
                      onClick={() => setSelectedTraceId(trace.trace.id)}
                      type="button"
                    >
                      <strong>{trace.trace.name}</strong>
                      <span>{traceAnswerPreview(trace)}</span>
                      <small>{trace.trace.source.provider} · {trace.steps.length} recorded steps</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="incident-capture-status">
                  {localTraceStatus === "loading"
                    ? "Checking for captured turns..."
                    : localTraceStatus === "error"
                      ? localTraceError ?? "Capture is temporarily unavailable."
                      : "Waiting for your agent. Run it with the Engram SDK, then return here."}
                </p>
              )}
              {localTraces.length > 0 && onCreateTraceIncident ? (
                <>
                  <label htmlFor="incident-local-expected-answer">Expected answer evidence</label>
                  <input
                    id="incident-local-expected-answer"
                    onChange={(event) => setExpectedAnswer(event.target.value)}
                    placeholder="Key fact the answer should contain, e.g. Oakland"
                    value={expectedAnswer}
                  />
                  <div className="incident-recorded-actions">
                    <button
                      className="incident-primary-action"
                      disabled={!expectedAnswer.trim()}
                      onClick={() => {
                        const trace = localTraces.find(
                          (candidate) => candidate.trace.id === (selectedTraceId ?? localTraces.at(-1)?.trace.id)
                        );
                        if (trace) onCreateTraceIncident(trace, expectedAnswer.trim());
                      }}
                      type="button"
                    >
                      <FileSearch size={13} /> Diagnose captured turn
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
          {replayableCheckpoints.length > 0 && onCreateIncident ? (
            <section className="incident-recorded-turns" aria-label="Recorded answers">
              <div>
                <strong>Recorded answers</strong>
                <span>Choose the run that behaved incorrectly.</span>
              </div>
              <div className="incident-recorded-list">
                {replayableCheckpoints.slice(-3).reverse().map((checkpoint) => (
                  <button
                    aria-pressed={(selectedCheckpointId ?? replayableCheckpoints.at(-1)?.id) === checkpoint.id}
                    data-selected={(selectedCheckpointId ?? replayableCheckpoints.at(-1)?.id) === checkpoint.id}
                    key={checkpoint.id}
                    onClick={() => setSelectedCheckpointId(checkpoint.id)}
                    type="button"
                  >
                    <strong>{checkpoint.query ?? checkpoint.turnRecord?.userMessage ?? checkpoint.label}</strong>
                    <span>{checkpoint.answer}</span>
                  </button>
                ))}
              </div>
              <label htmlFor="incident-expected-answer">Expected answer evidence</label>
              <input
                id="incident-expected-answer"
                onChange={(event) => setExpectedAnswer(event.target.value)}
                placeholder="Key fact the answer should contain, e.g. Oakland"
                value={expectedAnswer}
              />
              <div className="incident-recorded-actions">
                <button
                  className="incident-primary-action"
                  disabled={!expectedAnswer.trim()}
                  onClick={() => {
                    const checkpoint = replayableCheckpoints.find(
                      (candidate) => candidate.id === (selectedCheckpointId ?? replayableCheckpoints.at(-1)?.id)
                    );
                    if (checkpoint) onCreateIncident(checkpoint, expectedAnswer.trim());
                  }}
                  type="button"
                >
                  <FileSearch size={13} /> Diagnose this turn
                </button>
              </div>
            </section>
          ) : null}
          {checkpoints.length > 0 ? (
            <details className="incident-empty-advanced">
              <summary><ChevronDown size={12} /> Advanced tools</summary>
              <div>
                <button onClick={() => onOpenTool("timeMachine")} type="button">
                  <GitBranch size={12} /> Time Machine
                </button>
                <button onClick={() => onOpenTool("integrity")} type="button">
                  <ShieldCheck size={12} /> Integrity
                </button>
                {checkpoints.some((checkpoint) => Boolean(checkpoint.retrieval)) ? (
                  <button onClick={() => onOpenTool("retrieval")} type="button">
                    <Radar size={12} /> Retrieval MRI
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
          <span className="incident-empty-divider">Or start another way</span>
          <div className="incident-empty-actions">
            <button type="button" onClick={onLoadSample}>
              <Play size={14} /> Load reference incident
            </button>
            <button type="button" onClick={onImportTrace}>
              <Download size={14} /> Import agent trace
            </button>
          </div>
          <ol className="incident-empty-loop" aria-label="Memory incident workflow">
            {[
              ["Diagnose", "Locate the failing lifecycle stage"],
              ["Intervene", "Choose an isolated memory change"],
              ["Replay", "Run a bounded counterfactual"],
              ["Prove", "Save evidence-gated behavior as a regression"]
            ].map(([label, detail], index) => (
              <li key={label}><i>{index + 1}</i><span><strong>{label}</strong><small>{detail}</small></span></li>
            ))}
          </ol>
        </div>
      </aside>
    );
  }

  const selectedStage = incident.stages.find((stage) => stage.id === selectedStageId)
    ?? incident.stages[0];
  const selectedIntervention = interventions.find((item) => item.id === selectedInterventionId)
    ?? interventions[0];
  const branch = selectedIntervention
    ? createMemoryBranch({
        checkpoint: incident.checkpoint,
        id: `branch-${incident.id}-${selectedIntervention.id}`,
        title: selectedIntervention.label,
        createdAt: incident.occurredAt,
        mutations: selectedIntervention.mutations
      })
    : undefined;
  const materialized = branch ? applyMemoryBranch(incident.checkpoint, branch) : undefined;
  const remediationRecipe = !guidedDemo && selectedIntervention
    ? buildSourceRemediationRecipe(incident, selectedIntervention)
    : undefined;
  const realExecutorReady = executorStatus === "available"
    && Boolean(executorManifest)
    && hasLangGraphReplayCheckpoint(incident);
  const completedReplay = policyReplayResult ?? replayResult;
  const baselineReproduced = policyReplayResult?.reproduction.reproduced
    ?? replayResult?.reproduction.reproduced
    ?? false;
  const treatmentMetExpectation = Boolean(
    (policyReplayResult || replayResult)
    && incident.expectedAnswer
    && answerSupportsExpectation(
      policyReplayResult?.treatment.answer.content ?? replayResult?.branchAnswer ?? "",
      incident.expectedAnswer
    )
  );
  const proofEligible = policyReplayResult
    ? policyReplayResult.verification.passed
    : baselineReproduced && treatmentMetExpectation;

  const completedSteps: Record<IncidentTaskStep, boolean> = {
    diagnose: diagnosisReviewed,
    intervene: interventionConfirmed,
    replay: Boolean(completedReplay),
    prove: regressionSaved
  };
  const availableSteps: Record<IncidentTaskStep, boolean> = {
    diagnose: true,
    intervene: diagnosisReviewed,
    replay: interventionConfirmed,
    prove: proofEligible
  };

  function selectStage(stageId: string) {
    const stage = incident?.stages.find((candidate) => candidate.id === stageId);
    if (!stage) return;
    setSelectedStageId(stageId);
    onFocus(stage.memoryIds, stageRegions(stage.kind));
  }

  function selectIntervention(intervention: MemoryIncidentIntervention) {
    setSelectedInterventionId(intervention.id);
    setInterventionConfirmed(false);
    setReplayResult(undefined);
    setPolicyReplayResult(undefined);
    setReplayError(undefined);
    setRegressionSaved(false);
    onFocus(intervention.affectedMemoryIds, intervention.focusedRegions);
  }

  async function replayIntervention() {
    if (
      !selectedIntervention
      || !branch
      || !materialized
      || !incident
      || replayPending
      || (executorEligible && executorStatus === "checking")
    ) return;
    setReplayPending(true);
    setReplayError(undefined);
    setReplayResult(undefined);
    setPolicyReplayResult(undefined);
    setRegressionSaved(false);
    onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);

    try {
      if (realExecutorReady) {
        const policyRequest = memoryPolicyReplayRequestFromIncident(incident, selectedIntervention);
        const response = await fetch("/api/local/executor/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format: "engram.memory-executor-replay",
            version: 1,
            request: policyRequest,
            sideEffectMode: executorManifest?.sideEffects.defaultMode ?? "blocked"
          })
        });
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(readError(payload) ?? "The agent replay could not be completed.");
        setPolicyReplayResult(parseMemoryExecutorReplayResult(payload));
        setActiveStep("replay");
        return;
      }

      const request: MemoryBranchReplayRequest = {
        record: incident.record,
        branch,
        branchContextMemories: branchContextMemories(incident.record, branch, materialized)
      };
      let payload: unknown;

      if (replayExecutor) {
        payload = await replayExecutor(request);
      } else {
        if (guidedDemo) throw new Error("The guided demo requires its browser replay executor.");
        const response = await fetch("/api/lab/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        });
        payload = await response.json() as unknown;
        if (!response.ok) throw new Error(readError(payload) ?? "The replay could not be completed.");
      }

      const result = memoryBranchReplayResultSchema.parse(payload);
      setReplayResult(result);
      setActiveStep("replay");
      onReplayComplete?.(result);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "The replay could not be completed.");
    } finally {
      setReplayPending(false);
    }
  }

  async function runInfluenceAnalysis() {
    if (!incident || incident.record.retrievedMemories.length === 0) return;
    setInfluencePending(true);
    setInfluenceError(undefined);
    setInfluenceResults([]);
    onFocus(
      incident.record.retrievedMemories.map((memory) => memory.id),
      ["prefrontal"]
    );

    try {
      const results: MemoryInfluenceResult[] = [];
      for (const memory of incident.record.retrievedMemories) {
        const response = await fetch("/api/causal-xray", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record: incident.record, excludedMemoryIds: [memory.id] })
        });
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(readError(payload) ?? "Influence analysis failed.");
        const parsed = causalAblationResultSchema.parse(payload);
        results.push({
          memoryId: memory.id,
          evidence: "simulated",
          changed: parsed.changed,
          normalizedTextDistance: parsed.comparison.normalizedTextDistance,
          baselineAnswer: parsed.baselineAnswer,
          counterfactualAnswer: parsed.counterfactualAnswer,
          caveat: parsed.caveat
        });
      }
      setInfluenceResults(results);
    } catch (error) {
      setInfluenceError(error instanceof Error ? error.message : "Influence analysis failed.");
    } finally {
      setInfluencePending(false);
    }
  }

  function saveRegression() {
    if (!incident || !selectedIntervention || !proofEligible) return;
    if (policyReplayResult) {
      onSaveRegression(compileMemoryRegressionV2({
        replay: policyReplayResult,
        id: `regression-${incident.id}`,
        title: `Regression: ${incident.title}`,
        description: `Preserve the real agent replay repair for “${incident.question}”.`,
        createdAt: policyReplayResult.treatment.completedAt
      }));
      setRegressionSaved(true);
      return;
    }
    if (!branch || !materialized || !replayResult) return;
    const branchIds = new Set(replayResult.branchMemoryIds);
    const removedMemories = incident.record.retrievedMemories.filter((memory) => !branchIds.has(memory.id));
    const artifact = createMemoryRegressionArtifact({
      checkpoint: incident.checkpoint,
      title: `Regression: ${incident.title}`,
      description: `Preserve the evidence-gated context repair for “${incident.question}”.`,
      memoryFixture: uniqueMemories([...incident.memories, ...materialized.memories]),
      replayResults: replayResultsFromBranchReplay(replayResult),
      assertions: {
        retrieval: {
          mustRetrieve: replayResult.branchMemoryIds,
          mustNotRetrieve: replayResult.baselineMemoryIds.filter((id) => !branchIds.has(id)),
          maxLoaded: replayResult.branchMemoryIds.length
        },
        answer: {
          contains: incident.expectedAnswer ? expectedAnswerFragments(incident.expectedAnswer) : [],
          notContains: removedMemories.flatMap((memory) => memory.entities ?? []).slice(0, 5)
        }
      },
      metadata: {
        incidentId: incident.id,
        diagnosis: incident.diagnosis.kind,
        interventionId: selectedIntervention.id,
        evidenceBoundary: "context-only-counterfactual"
      }
    });
    onSaveRegression(artifact);
    setRegressionSaved(true);
  }

  function openStep(step: IncidentTaskStep) {
    if (!incident || !availableSteps[step]) return;
    setActiveStep(step);
    if (step === "diagnose") {
      const diagnosisStage = incident.stages.find((stage) => stage.kind === incident.diagnosis.stage);
      if (diagnosisStage) onFocus(diagnosisStage.memoryIds, stageRegions(diagnosisStage.kind));
      return;
    }
    if (step === "intervene" && selectedIntervention) {
      onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);
      return;
    }
    if ((step === "replay" || step === "prove") && selectedIntervention) {
      onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);
    }
  }

  function continueFromDiagnosis() {
    setDiagnosisReviewed(true);
    setActiveStep("intervene");
    if (selectedIntervention) {
      onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);
    }
  }

  function confirmIntervention() {
    if (!selectedIntervention) return;
    setInterventionConfirmed(true);
    setActiveStep("replay");
    onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);
  }

  return (
    <aside
      aria-hidden={presentationPhase === "hidden" ? true : undefined}
      aria-label="Memory Incident Workspace"
      className="incident-workspace"
      data-presentation={presentationMode}
      data-presentation-phase={presentationPhase}
    >
      {guidedDemo ? null : <WorkspaceHeader brainOpen={brainOpen} onClose={onClose} onToggleBrain={onToggleBrain} />}
      <IncidentSummary incident={incident} />
      {guidedDemo ? null : (
        <WorkflowProgress
          active={activeStep}
          available={availableSteps}
          completed={completedSteps}
          onSelect={openStep}
        />
      )}

      <div
        aria-busy={replayPending || influencePending}
        className="incident-scroll incident-task-scroll"
      >
        <div className="incident-activity-status" role="status" aria-live="polite">
          {replayPending
            ? realExecutorReady
              ? "Forking the checkpoint and rerunning the agent pipeline..."
              : "Regenerating baseline and counterfactual answers..."
            : influencePending
              ? "Testing the influence of each loaded memory..."
              : regressionSaved
                ? "Regression saved."
                : ""}
        </div>

        {activeStep === "diagnose" ? (
          <section
            aria-labelledby={guidedDemo ? "incident-diagnose-heading" : "incident-tab-diagnose"}
            className="incident-task-panel"
            id="incident-panel-diagnose"
            role="tabpanel"
          >
            <SectionHeading
              eyebrow="Step 1 · Diagnose"
              title={incident.diagnosis.label}
              detail={incident.diagnosis.summary}
              titleId="incident-diagnose-heading"
            />
            <div className="incident-diagnosis-meta">
              <span>Rule-based diagnosis</span>
              <span>Failure stage: {labelStage(incident.diagnosis.stage)}</span>
              <EvidenceBadge origin={incident.diagnosis.origin} />
            </div>
            <ol className="incident-causal-spine" aria-label="Recorded memory decision stages">
              {incident.stages.map((stage, index) => (
                <li key={stage.id}>
                  <button
                    aria-current={selectedStage?.id === stage.id ? "step" : undefined}
                    aria-label={`Inspect ${stage.label} evidence`}
                    data-active={selectedStage?.id === stage.id}
                    data-status={stage.status}
                    onClick={() => selectStage(stage.id)}
                    type="button"
                  >
                    <i>{stage.status === "passed" ? <Check size={13} /> : index + 1}</i>
                    <span><strong>{stage.label}</strong><small>{stage.summary}</small></span>
                  </button>
                  {index < incident.stages.length - 1 ? <ArrowRight size={14} aria-hidden="true" /> : null}
                </li>
              ))}
            </ol>
            {selectedStage ? (
              <div className="incident-evidence-list" aria-label={`${selectedStage.label} evidence`}>
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
            {guidedDemo ? null : (
              <div className="incident-influence">
                <div>
                  <strong>Memory influence analysis</strong>
                  <span>Replay once without each used memory to test answer sensitivity.</span>
                </div>
                <button disabled={influencePending || incident.record.retrievedMemories.length === 0} onClick={() => void runInfluenceAnalysis()} type="button">
                  <Radar size={15} /> {influencePending ? "Running replays..." : "Run influence check"}
                </button>
              </div>
            )}
            {!guidedDemo && influenceError ? <p className="incident-error" role="alert">{influenceError}</p> : null}
            {!guidedDemo && influenceResults.length > 0 ? (
              <div className="incident-influence-results">
                {influenceResults.map((result) => {
                  const memory = incident.memories.find((candidate) => candidate.id === result.memoryId);
                  return (
                    <article key={result.memoryId} data-changed={result.changed}>
                      <div><EvidenceBadge origin="simulated" /><strong>{memory?.text ?? result.memoryId}</strong></div>
                      <p>{result.changed ? "Removing this memory changed the replayed answer." : "Removing this memory did not change the replayed answer."}</p>
                      <small>{Math.round(result.normalizedTextDistance * 100)}% answer distance · controlled replay, not proof of hidden causality</small>
                    </article>
                  );
                })}
              </div>
            ) : null}
            {guidedDemo ? null : (
              <details className="incident-advanced-tools">
                <summary><ChevronDown size={14} /> Advanced evidence tools</summary>
                <div>
                  <button type="button" onClick={() => onOpenTool("timeMachine")}><GitBranch size={14} /> Time Machine</button>
                  <button type="button" onClick={() => onOpenTool("integrity")}><ShieldCheck size={14} /> Integrity</button>
                  <button type="button" onClick={() => onOpenTool("retrieval")}><Radar size={14} /> Retrieval MRI</button>
                </div>
              </details>
            )}
          </section>
        ) : null}

        {activeStep === "intervene" ? (
          <section
            aria-labelledby={guidedDemo ? "incident-intervene-heading" : "incident-tab-intervene"}
            className="incident-task-panel incident-intervention"
            id="incident-panel-intervene"
            role="tabpanel"
          >
            <SectionHeading
              eyebrow="Step 2 · Intervene"
              title="Choose one controlled repair"
              detail="The recorded incident remains immutable. Every repair is tested on an isolated branch."
              titleId="incident-intervene-heading"
            />
            {selectedIntervention ? (
              <article className="incident-recommended-fix">
                <div className="incident-fix-title">
                  <span><Sparkles size={14} /> {selectedIntervention.recommended ? "Recommended intervention" : "Selected intervention"}</span>
                  <EvidenceBadge origin="derived" />
                </div>
                <h3>{selectedIntervention.label}</h3>
                <p>{selectedIntervention.description}</p>
                <small>{selectedIntervention.reason}</small>
              </article>
            ) : (
              <p className="incident-muted">No safe memory-state intervention was derived from this evidence.</p>
            )}
            {interventions.length > 1 ? (
              <div className="incident-intervention-options" aria-label="Available interventions">
                {interventions.map((intervention) => (
                  <button
                    aria-pressed={selectedIntervention?.id === intervention.id}
                    data-selected={selectedIntervention?.id === intervention.id}
                    key={intervention.id}
                    onClick={() => selectIntervention(intervention)}
                    type="button"
                  >
                    <strong>{intervention.label}</strong>
                    <span>{intervention.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {!guidedDemo && remediationRecipe ? (
              <details className="incident-source-repair">
                <summary><ChevronDown size={14} /> View source remediation</summary>
                <div className="incident-source-repair-heading">
                  <span>{remediationRecipe.provider}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(remediationRecipe.code);
                      setRecipeCopied(true);
                      window.setTimeout(() => setRecipeCopied(false), 1_500);
                    }}
                    type="button"
                  >
                    <Clipboard size={14} /> {recipeCopied ? "Copied" : "Copy recipe"}
                  </button>
                </div>
                <pre><code>{remediationRecipe.code}</code></pre>
                <p>{remediationRecipe.warning}</p>
              </details>
            ) : null}
          </section>
        ) : null}

        {activeStep === "replay" ? (
          <section
            aria-labelledby={guidedDemo ? "incident-replay-heading" : "incident-tab-replay"}
            className="incident-task-panel incident-replay"
            id="incident-panel-replay"
            role="tabpanel"
          >
            <SectionHeading
              eyebrow="Step 3 · Replay"
              title={realExecutorReady ? "Real agent replay" : "Context-only counterfactual"}
              detail={completedReplay
                ? proofEligible
                  ? realExecutorReady
                    ? "The graph reproduced the incident, then the isolated branch met the expected answer."
                    : "The recorded answer was reproduced before the branch met the expected answer."
                  : baselineReproduced
                    ? "The recorded answer was reproduced, but the branch did not meet the expected answer."
                    : "The regenerated baseline did not reproduce the recorded answer, so this branch cannot be promoted as proof."
                : realExecutorReady
                  ? `Ready to fork the recorded LangGraph checkpoint and rerun “${selectedIntervention?.label ?? "the selected intervention"}”.`
                  : `Ready to test “${selectedIntervention?.label ?? "the selected intervention"}” using the recorded context fallback.`}
              titleId="incident-replay-heading"
            />
            {policyReplayResult ? (
              <>
                <div className="incident-replay-status" data-verified={proofEligible}>
                  {proofEligible ? <ShieldCheck size={17} /> : <FlaskConical size={17} />}
                  <span>{proofEligible
                    ? "Real pipeline proof gate passed"
                    : baselineReproduced
                      ? "The graph reproduced the baseline, but the treatment failed its assertion"
                      : "The graph did not reproduce the recorded incident"}</span>
                </div>
                <CausalMemoryDiff
                  result={policyReplayResult}
                  onFocusMemoryIds={(memoryIds) => onFocus(memoryIds, ["prefrontal"])}
                />
              </>
            ) : replayResult ? (
              <>
                <div className="incident-replay-status" data-verified={proofEligible}>
                  {proofEligible ? <ShieldCheck size={17} /> : <FlaskConical size={17} />}
                  <span>{proofEligible
                    ? "Proof gate passed for this context-only counterfactual"
                    : baselineReproduced
                      ? "Baseline reproduced; treatment missed the expected answer"
                      : "Baseline not reproduced; proof remains locked"}</span>
                </div>
                <ReplayCapabilityBoundary result={replayResult} />
                <div className="incident-replay-grid">
                  <article>
                    <span>Recorded incident</span>
                    <p>{replayResult.reproduction.observedAnswer}</p>
                    <small>Observed answer evidence</small>
                  </article>
                  <article data-reproduced={baselineReproduced}>
                    <span>Regenerated baseline</span>
                    <p>{replayResult.baselineAnswer}</p>
                    <small>{baselineReproduced ? "Matches recorded answer" : "Does not match recorded answer"}</small>
                  </article>
                  <article data-replay="branch">
                    <span>Context counterfactual</span>
                    <p>{replayResult.branchAnswer}</p>
                    <small>{treatmentMetExpectation ? "Meets expected answer" : "Does not meet expected answer"}</small>
                  </article>
                </div>
                <div className="incident-context-diff">
                  <span>Context change</span>
                  <code>{formatContextDiff(replayResult)}</code>
                </div>
                <p className="incident-caveat">{replayResult.caveat}</p>
              </>
            ) : (
              <div className="incident-replay-ready">
                {realExecutorReady ? <GitBranch size={20} /> : <FlaskConical size={20} />}
                <div>
                  <strong>The recorded incident remains unchanged</strong>
                  <p>{realExecutorReady
                    ? `${executorManifest?.name ?? "The attached executor"} will run twice from isolated checkpoint and memory-store forks. Side effects are ${executorManifest?.sideEffects.defaultMode ?? "blocked"}.`
                    : executorStatus === "checking"
                      ? "Checking for a project replay executor..."
                      : "No compatible checkpoint executor is attached. Engram will regenerate from recorded context; retrieval policy will not be rerun."}</p>
                </div>
              </div>
            )}
            {replayError ? <p className="incident-error" role="alert">{replayError}</p> : null}
          </section>
        ) : null}

        {activeStep === "prove" && completedReplay ? (
          <section
            aria-labelledby={guidedDemo ? "incident-prove-heading" : "incident-tab-prove"}
            className="incident-task-panel incident-prove"
            id="incident-panel-prove"
            role="tabpanel"
          >
            <SectionHeading
              eyebrow="Step 4 · Prove"
              title="Keep the repair from regressing"
              detail={guidedDemo
                ? "Build a portable test from the recorded memory fixture, bounded replay evidence, and lifecycle assertions."
                : "Export the recorded memory state, turn input, bounded replay evidence, and lifecycle assertions as a portable test."}
              titleId="incident-prove-heading"
            />
            <div className="incident-proof-summary" data-saved={regressionSaved}>
              {regressionSaved ? <ShieldCheck size={20} /> : <Download size={20} />}
              <div>
                <strong>{regressionSaved ? "Regression saved" : proofEligible ? "Evidence gate passed" : "Proof unavailable"}</strong>
                <p>{regressionSaved
                  ? "The repair is now a portable memory regression artifact."
                  : proofEligible
                    ? policyReplayResult
                      ? "The test will rerun the agent executor and preserve lifecycle plus answer assertions."
                      : "The test will preserve the bounded context behavior and expected answer evidence."
                    : "The baseline must reproduce the recorded answer and the branch must meet the expected answer before a test can be saved."}</p>
              </div>
            </div>
            <ul>
              <li><Check size={14} /> Require the branch memories in active context</li>
              <li><Check size={14} /> Reject memories removed by the repair</li>
              <li><Check size={14} /> Assert the expected answer evidence</li>
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="incident-action-bar" aria-label={`${activeStep} step actions`}>
        {activeStep !== "diagnose" ? (
          <button className="incident-secondary-action" onClick={() => openStep(previousStep(activeStep))} type="button">
            <ArrowLeft size={16} /> Back
          </button>
        ) : <span />}
        {activeStep === "diagnose" ? (
          <button className="incident-primary-action" onClick={continueFromDiagnosis} type="button">
            Review interventions <ArrowRight size={16} />
          </button>
        ) : null}
        {activeStep === "intervene" ? (
          <button className="incident-primary-action" disabled={!selectedIntervention} onClick={confirmIntervention} type="button">
            Continue with this intervention <ArrowRight size={16} />
          </button>
        ) : null}
        {activeStep === "replay" && !completedReplay ? (
          <button
            className="incident-primary-action"
            disabled={replayPending || !selectedIntervention || (executorEligible && executorStatus === "checking")}
            onClick={() => void replayIntervention()}
            type="button"
          >
            <Play size={16} /> {replayPending
              ? realExecutorReady ? "Rerunning agent..." : "Running context counterfactual..."
              : executorEligible && executorStatus === "checking" ? "Checking executor..."
              : realExecutorReady ? "Run agent replay" : guidedDemo ? "Run deterministic counterfactual" : "Run context counterfactual"}
          </button>
        ) : null}
        {activeStep === "replay" && completedReplay ? (
          <div className="incident-action-group">
            <button className="incident-secondary-action" disabled={replayPending} onClick={() => void replayIntervention()} type="button">
              <Play size={15} /> Replay again
            </button>
            <button className="incident-primary-action" disabled={!proofEligible} onClick={() => openStep("prove")} type="button">
              {proofEligible ? "Review proof" : "Proof unavailable"} <ArrowRight size={16} />
            </button>
          </div>
        ) : null}
        {activeStep === "prove" ? (
          <button className="incident-primary-action" disabled={!proofEligible} onClick={saveRegression} type="button">
            <Download size={16} /> {regressionSaved
              ? "Download regression again"
              : policyReplayResult ? "Save agent regression" : "Save context regression"}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

function WorkspaceHeader({
  brainOpen,
  onClose,
  onToggleBrain
}: {
  brainOpen: boolean;
  onClose: () => void;
  onToggleBrain?: () => void;
}) {
  return (
    <header className="incident-workspace-header">
      <div><FileSearch size={13} /><span>Engram / Memory incident</span><small>Recorded evidence · isolated branches</small></div>
      <div className="incident-workspace-header-actions">
        {onToggleBrain ? (
          <button className="incident-brain-toggle" type="button" onClick={onToggleBrain} aria-pressed={brainOpen}>
            <Radar size={14} /> {brainOpen ? "Hide brain" : "Show brain"}
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close incident workspace"><X size={15} /></button>
      </div>
    </header>
  );
}

function traceAnswerPreview(trace: NormalizedTrace) {
  for (let index = trace.steps.length - 1; index >= 0; index -= 1) {
    const text = jsonText(trace.steps[index]?.output);
    if (text) return text;
  }
  return "No answer captured";
}

function jsonText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = jsonText(value[index]);
      if (text) return text;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["content", "text", "answer", "output"]) {
      const text = jsonText((value as Record<string, unknown>)[key]);
      if (text) return text;
    }
  }
  return undefined;
}

function IncidentSummary({ incident }: { incident: MemoryIncident }) {
  return (
    <section className="incident-summary" aria-label="Incident summary">
      <div className="incident-summary-heading">
        <div>
          <span><i data-status={incident.status} /> Open incident</span>
          <h2>{incident.title}</h2>
        </div>
        <EvidenceBadge origin={incident.diagnosis.origin} />
      </div>
      <dl className="incident-answer-grid">
        <div>
          <dt>Question</dt>
          <dd>{incident.question}</dd>
        </div>
        <div data-answer="observed">
          <dt>Observed</dt>
          <dd>{incident.observedAnswer}</dd>
        </div>
        {incident.expectedAnswer ? (
          <div data-answer="expected">
            <dt>Expected</dt>
            <dd>{incident.expectedAnswer}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function WorkflowProgress({
  active,
  available,
  completed,
  onSelect
}: {
  active: IncidentTaskStep;
  available: Record<IncidentTaskStep, boolean>;
  completed: Record<IncidentTaskStep, boolean>;
  onSelect: (step: IncidentTaskStep) => void;
}) {
  return (
    <nav className="incident-progress" aria-label="Incident task flow">
      <div role="tablist" aria-orientation="horizontal">
        {incidentTaskSteps.map((step, index) => {
          const isActive = active === step.id;
          const isComplete = completed[step.id];
          return (
            <button
              aria-controls={`incident-panel-${step.id}`}
              aria-selected={isActive}
              data-complete={isComplete}
              data-state={isActive ? "current" : isComplete ? "done" : "pending"}
              disabled={!available[step.id]}
              id={`incident-tab-${step.id}`}
              key={step.id}
              onClick={() => onSelect(step.id)}
              role="tab"
              type="button"
            >
              <i>{isComplete ? <Check size={13} /> : index + 1}</i>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  titleId
}: {
  eyebrow: string;
  title: string;
  detail: string;
  titleId?: string;
}) {
  return <header className="incident-section-heading"><span>{eyebrow}</span><h3 id={titleId}>{title}</h3><p>{detail}</p></header>;
}

function ReplayCapabilityBoundary({ result }: { result: MemoryBranchReplayResult }) {
  const stages = [
    { label: "Memory state", rerun: false },
    { label: "Candidate generation", rerun: result.capabilities.rerunsCandidateGeneration },
    { label: "Eligibility", rerun: result.capabilities.rerunsEligibility },
    { label: "Ranking", rerun: result.capabilities.rerunsRanking },
    { label: "Selection", rerun: result.capabilities.rerunsSelection },
    { label: "Context construction", rerun: result.capabilities.rerunsContextAssembly },
    { label: "Answer generation", rerun: result.capabilities.rerunsGeneration }
  ];

  return (
    <section className="incident-replay-boundary" aria-label="Context-only replay boundary">
      <header>
        <div>
          <span>Replay boundary</span>
          <strong>Recorded candidates reused</strong>
        </div>
        <code>{result.capabilities.deterministic ? "deterministic" : "non-deterministic"}</code>
      </header>
      <ul>
        {stages.map((stage) => (
          <li data-rerun={stage.rerun} key={stage.label}>
            <span>{stage.label}</span>
            <strong>{stage.rerun ? "Reran" : "Not rerun"}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceBadge({ origin }: { origin: MemoryIncident["evidence"][number]["origin"] }) {
  return <b className="incident-evidence-badge" data-origin={origin}>{origin}</b>;
}

function stageRegions(stage: MemoryIncident["stages"][number]["kind"]): BrainRegion[] {
  if (stage === "memory_state") return ["hippocampus", "temporal"];
  if (stage === "retrieval" || stage === "active_context") return ["prefrontal"];
  return [];
}

function labelStage(stage: MemoryIncident["diagnosis"]["stage"]) {
  return stage.replace("_", " ");
}

function previousStep(step: IncidentTaskStep): IncidentTaskStep {
  if (step === "prove") return "replay";
  if (step === "replay") return "intervene";
  return "diagnose";
}

function formatContextDiff(result: MemoryBranchReplayResult) {
  const before = new Set(result.baselineMemoryIds);
  const after = new Set(result.branchMemoryIds);
  const removed = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));
  return `${removed.length ? `-${removed.join(", -")}` : "no removals"} · ${added.length ? `+${added.join(", +")}` : "no additions"}`;
}

function uniqueMemories<T extends { id: string }>(memories: T[]) {
  return [...new Map(memories.map((memory) => [memory.id, memory])).values()];
}

function readError(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  return typeof value.error === "string" ? value.error : undefined;
}

function hasLangGraphReplayCheckpoint(incident: MemoryIncident) {
  const langgraph = incident.replayMetadata?.langgraph;
  return isRecord(langgraph) && isRecord(langgraph.replayCheckpoint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDirectIncidentLink() {
  if (typeof window === "undefined") return {};
  const search = new URLSearchParams(window.location.search);
  const traceId = search.get("trace")?.trim();
  const expectedAnswer = search.get("expected")?.trim();
  return {
    ...(traceId ? { traceId } : {}),
    ...(expectedAnswer ? { expectedAnswer } : {})
  };
}
