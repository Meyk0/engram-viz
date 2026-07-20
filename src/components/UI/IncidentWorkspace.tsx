import { useMemo, useState } from "react";
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
  { id: "replay", label: "Replay", detail: "Run the same turn again" },
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
  onSaveRegression: (artifact: MemoryRegressionArtifact) => void;
  presentationMode?: "standard" | "guided-demo";
  presentationPhase?: "hidden" | "fail" | "repair" | "test";
  replayExecutor?: (request: MemoryBranchReplayRequest) => Promise<MemoryBranchReplayResult>;
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
  replayExecutor
}: IncidentWorkspaceProps) {
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
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>();
  const [recipeCopied, setRecipeCopied] = useState(false);
  const [activeStep, setActiveStep] = useState<IncidentTaskStep>("diagnose");
  const [diagnosisReviewed, setDiagnosisReviewed] = useState(false);
  const [interventionConfirmed, setInterventionConfirmed] = useState(false);

  if (!incident) {
    return (
      <aside className="incident-workspace" aria-label="Memory Incident Workspace">
        <WorkspaceHeader onClose={onClose} />
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
              ["Capture", "Reconstruct the recorded memory state"],
              ["Diagnose", "Locate the failing lifecycle stage"],
              ["Replay", "Test a controlled memory change"],
              ["Test", "Save the verified repair as a regression"]
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
  const replayVerified = replayResult
    ? incident.expectedAnswer
      ? answerSupportsExpectation(replayResult.branchAnswer, incident.expectedAnswer)
      : replayResult.changed
    : false;

  const completedSteps: Record<IncidentTaskStep, boolean> = {
    diagnose: diagnosisReviewed,
    intervene: interventionConfirmed,
    replay: Boolean(replayResult),
    prove: regressionSaved
  };
  const availableSteps: Record<IncidentTaskStep, boolean> = {
    diagnose: true,
    intervene: diagnosisReviewed,
    replay: interventionConfirmed,
    prove: Boolean(replayResult)
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
    setReplayError(undefined);
    setRegressionSaved(false);
    onFocus(intervention.affectedMemoryIds, intervention.focusedRegions);
  }

  async function replayIntervention() {
    if (!selectedIntervention || !branch || !materialized || !incident) return;
    setReplayPending(true);
    setReplayError(undefined);
    setReplayResult(undefined);
    setRegressionSaved(false);
    onFocus(selectedIntervention.affectedMemoryIds, selectedIntervention.focusedRegions);

    try {
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
    if (!incident || !selectedIntervention || !branch || !materialized || !replayResult || !replayVerified) return;
    const branchIds = new Set(replayResult.branchMemoryIds);
    const removedMemories = incident.record.retrievedMemories.filter((memory) => !branchIds.has(memory.id));
    const artifact = createMemoryRegressionArtifact({
      checkpoint: incident.checkpoint,
      title: `Regression: ${incident.title}`,
      description: `Preserve the verified repair for “${incident.question}”.`,
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
        evidenceBoundary: "controlled-context-replay"
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
      {guidedDemo ? null : <WorkspaceHeader onClose={onClose} />}
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
            ? "Replaying the original and repaired memory branches..."
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
              title={replayResult
                ? replayVerified
                  ? "The repair produced the expected behavior"
                  : replayResult.changed ? "The answer changed" : "The answer remained stable"
                : "Replay the original and repaired branches"}
              detail={replayResult
                ? guidedDemo
                  ? "A fixed fixture executor evaluated the same recorded turn against both contexts."
                  : "Both answers used the same recorded turn; only the branch memory context changed."
                : `Ready to test “${selectedIntervention?.label ?? "the selected intervention"}” without mutating the incident.`}
              titleId="incident-replay-heading"
            />
            {replayResult ? (
              <>
                <div className="incident-replay-status" data-verified={replayVerified}>
                  {replayVerified ? <ShieldCheck size={17} /> : <FlaskConical size={17} />}
                  <span>{replayVerified ? "Verified against the incident expectation" : "Replay completed, but the result did not meet the expected answer"}</span>
                </div>
                <div className="incident-replay-grid">
                  <article>
                    <span>Original</span>
                    <p>{replayResult.baselineAnswer}</p>
                    <small>{replayResult.baselineMemoryIds.length} context memories</small>
                  </article>
                  <article data-replay="branch">
                    <span>Repaired branch</span>
                    <p>{replayResult.branchAnswer}</p>
                    <small>{replayResult.branchMemoryIds.length} context memories</small>
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
                <FlaskConical size={20} />
                <div>
                  <strong>The source incident stays frozen</strong>
                  <p>Engram will compare the original answer with a branch containing only the selected memory intervention.</p>
                </div>
              </div>
            )}
            {replayError ? <p className="incident-error" role="alert">{replayError}</p> : null}
          </section>
        ) : null}

        {activeStep === "prove" && replayResult ? (
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
                ? "Build a portable test from the frozen memory fixture, replay evidence, and lifecycle assertions."
                : "Export the frozen memory state, turn input, replay evidence, and lifecycle assertions as a portable test."}
              titleId="incident-prove-heading"
            />
            <div className="incident-proof-summary" data-saved={regressionSaved}>
              {regressionSaved ? <ShieldCheck size={20} /> : <Download size={20} />}
              <div>
                <strong>{regressionSaved ? "Regression saved" : replayVerified ? "Verified replay ready to save" : "Replay needs review"}</strong>
                <p>{regressionSaved
                  ? "The repair is now a portable memory regression artifact."
                  : replayVerified
                    ? "The test will preserve both the memory lifecycle and expected answer evidence."
                    : "The branch did not meet the expected answer, so it cannot be saved as a verified repair."}</p>
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
        {activeStep === "replay" && !replayResult ? (
          <button className="incident-primary-action" disabled={replayPending || !selectedIntervention} onClick={() => void replayIntervention()} type="button">
            <Play size={16} /> {replayPending
              ? "Replaying original and branch..."
              : guidedDemo ? "Run deterministic repair" : "Replay this fix"}
          </button>
        ) : null}
        {activeStep === "replay" && replayResult ? (
          <div className="incident-action-group">
            <button className="incident-secondary-action" disabled={replayPending} onClick={() => void replayIntervention()} type="button">
              <Play size={15} /> Replay again
            </button>
            <button className="incident-primary-action" onClick={() => openStep("prove")} type="button">
              Review proof <ArrowRight size={16} />
            </button>
          </div>
        ) : null}
        {activeStep === "prove" ? (
          <button className="incident-primary-action" disabled={!replayVerified} onClick={saveRegression} type="button">
            <Download size={16} /> {regressionSaved ? "Download regression again" : "Save verified regression"}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

function WorkspaceHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="incident-workspace-header">
      <div><FileSearch size={13} /><span>Engram / Memory incident</span><small>Recorded evidence · isolated branches</small></div>
      <button type="button" onClick={onClose} aria-label="Close incident workspace"><X size={15} /></button>
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
