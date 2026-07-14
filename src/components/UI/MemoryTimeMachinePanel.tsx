import { useEffect, useMemo, useRef, useState } from "react";
import { Download, GitBranch, Play, Replace, RotateCcw, ShieldOff, X } from "lucide-react";
import { memoryBranchReplayResultSchema } from "@/lib/events/schema";
import {
  applyMemoryBranch,
  branchContextMemories,
  createMemoryBranch,
  createReplacementMemory
} from "@/lib/lab/branches";
import type {
  MaterializedMemoryBranch,
  MemoryBranch,
  MemoryBranchMutation,
  MemoryBranchReplayResult,
  MemoryCheckpoint
} from "@/lib/lab/types";
import {
  createMemoryRegressionArtifact,
  replayResultsFromBranchReplay
} from "@/lib/regressions";
import type { MemoryRegressionArtifact } from "@/lib/regressions";
import type { EngramMemory } from "@/types";
import { IncidentWorkbenchEmptyState } from "@/components/UI/IncidentWorkbenchEmptyState";
import "./memory-time-machine.css";

type MemoryTimeMachinePanelProps = {
  checkpoints: MemoryCheckpoint[];
  initialQuarantineMemoryIds?: string[];
  onLoadSampleIncident?: () => void;
  onReturnToLearn?: () => void;
  onClose: () => void;
  onFocusMemoryIds: (ids: string[]) => void;
  onSaveRegression?: (artifact: MemoryRegressionArtifact) => void;
};

export function MemoryTimeMachinePanel({
  checkpoints,
  initialQuarantineMemoryIds = [],
  onLoadSampleIncident,
  onReturnToLearn,
  onClose,
  onFocusMemoryIds,
  onSaveRegression
}: MemoryTimeMachinePanelProps) {
  const [checkpointId, setCheckpointId] = useState<string>();
  const [branchState, setBranchState] = useState<{ checkpointId: string; branch: MemoryBranch }>();
  const [editingMemoryId, setEditingMemoryId] = useState<string>();
  const [replacementDraft, setReplacementDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<MemoryBranchReplayResult>();
  const [regressionSaved, setRegressionSaved] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const latestCheckpointId = checkpoints.at(-1)?.id;
  const resolvedCheckpointId = checkpoints.some((checkpoint) => checkpoint.id === checkpointId)
    ? checkpointId
    : latestCheckpointId;

  const checkpoint = useMemo(
    () => checkpoints.find((candidate) => candidate.id === resolvedCheckpointId),
    [checkpoints, resolvedCheckpointId]
  );
  const initialQuarantineKey = initialQuarantineMemoryIds.slice().sort().join("|");
  const branch = useMemo(() => {
    if (!checkpoint) return undefined;
    if (branchState?.checkpointId === checkpoint.id) return branchState.branch;
    return createMemoryBranch({
      checkpoint,
      id: `branch-${checkpoint.id}`,
      title: `Branch from ${checkpoint.label}`,
      createdAt: checkpoint.createdAt,
      mutations: initialQuarantineKey.split("|").filter(Boolean)
        .filter((memoryId) => checkpoint.memories.some((memory) => memory.id === memoryId))
        .map((memoryId) => ({
          id: mutationId("quarantine", memoryId),
          type: "quarantine" as const,
          memoryId,
          reason: "Seeded from Memory Integrity review"
        }))
    });
  }, [branchState, checkpoint, initialQuarantineKey]);

  const materialized = useMemo<MaterializedMemoryBranch | undefined>(() => {
    if (!checkpoint || !branch) return undefined;
    return applyMemoryBranch(checkpoint, branch);
  }, [branch, checkpoint]);
  const mutationByMemoryId = useMemo(
    () => new Map(branch?.mutations.map((mutation) => [mutation.memoryId, mutation]) ?? []),
    [branch]
  );
  const changedMemoryIds = useMemo(
    () => materialized
      ? [
          ...materialized.diff.quarantinedMemoryIds,
          ...materialized.diff.addedMemoryIds
        ]
      : [],
    [materialized]
  );

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [result]);

  function updateMutations(mutations: MemoryBranchMutation[], focusIds: string[]) {
    if (!checkpoint || !branch) return;
    setBranchState({ checkpointId: checkpoint.id, branch: createMemoryBranch({
      checkpoint,
      id: branch.id,
      title: branch.title,
      createdAt: branch.createdAt,
      mutations
    }) });
    setResult(undefined);
    setRegressionSaved(false);
    setError(undefined);
    onFocusMemoryIds(focusIds);
  }

  function quarantine(memory: EngramMemory) {
    if (!branch) return;
    updateMutations([
      ...branch.mutations.filter((mutation) => mutation.memoryId !== memory.id),
      {
        id: mutationId("quarantine", memory.id),
        type: "quarantine",
        memoryId: memory.id,
        reason: "Manual Time Machine experiment"
      }
    ], [memory.id]);
  }

  function startReplacement(memory: EngramMemory) {
    setEditingMemoryId(memory.id);
    setReplacementDraft(memory.text);
    onFocusMemoryIds([memory.id]);
  }

  function saveReplacement(memory: EngramMemory) {
    if (!branch || !replacementDraft.trim() || replacementDraft.trim() === memory.text.trim()) return;
    const replacement = createReplacementMemory({
      branchId: branch.id,
      original: memory,
      text: replacementDraft
    });
    updateMutations([
      ...branch.mutations.filter((mutation) => mutation.memoryId !== memory.id),
      {
        id: mutationId("replace", memory.id),
        type: "replace",
        memoryId: memory.id,
        replacement,
        reason: "Manual Time Machine experiment"
      }
    ], [memory.id, replacement.id]);
    setEditingMemoryId(undefined);
    setReplacementDraft("");
  }

  function undoMutation(memoryId: string) {
    if (!branch) return;
    updateMutations(
      branch.mutations.filter((mutation) => mutation.memoryId !== memoryId),
      [memoryId]
    );
  }

  async function replayBranch() {
    if (!checkpoint?.turnRecord || !branch || !materialized || branch.mutations.length === 0) return;
    setPending(true);
    setError(undefined);
    setResult(undefined);

    try {
      const response = await fetch("/api/lab/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record: checkpoint.turnRecord,
          branch,
          branchContextMemories: branchContextMemories(checkpoint.turnRecord, branch, materialized)
        })
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        throw new Error(readError(payload) ?? "Branch replay failed.");
      }
      setResult(memoryBranchReplayResultSchema.parse(payload));
      setRegressionSaved(false);
      onFocusMemoryIds(changedMemoryIds);
    } catch (replayError) {
      setError(replayError instanceof Error ? replayError.message : "Branch replay failed.");
    } finally {
      setPending(false);
    }
  }

  function selectCheckpoint(nextCheckpointId: string) {
    const nextCheckpoint = checkpoints.find((candidate) => candidate.id === nextCheckpointId);
    setCheckpointId(nextCheckpointId);
    setBranchState(undefined);
    setEditingMemoryId(undefined);
    setReplacementDraft("");
    setResult(undefined);
    setRegressionSaved(false);
    setError(undefined);
    onFocusMemoryIds(nextCheckpoint?.loadedMemoryIds ?? []);
  }

  function saveRegression() {
    if (!checkpoint || !branch || !materialized || !result || !onSaveRegression) return;
    const branchMemoryIds = new Set(result.branchMemoryIds);
    const memoryFixture = uniqueMemories([
      ...checkpoint.memories,
      ...materialized.memories
    ]);
    const artifact = createMemoryRegressionArtifact({
      checkpoint,
      title: `Regression: ${checkpoint.label}`,
      description: `Protect the observed branch behavior after ${branch.mutations.length} memory edit${branch.mutations.length === 1 ? "" : "s"}.`,
      memoryFixture,
      replayResults: replayResultsFromBranchReplay(result),
      assertions: {
        retrieval: {
          mustRetrieve: result.branchMemoryIds,
          mustNotRetrieve: result.baselineMemoryIds.filter((id) => !branchMemoryIds.has(id)),
          maxLoaded: result.branchMemoryIds.length
        }
      },
      metadata: {
        branchId: branch.id,
        evidenceBoundary: "single-controlled-context-replay"
      }
    });
    onSaveRegression(artifact);
    setRegressionSaved(true);
  }

  return (
    <aside className="secondary-panel secondary-panel-right memory-time-machine" aria-label="Memory Time Machine">
      <header className="time-machine-header">
        <div>
          <div className="time-machine-eyebrow"><GitBranch size={12} /> Memory Time Machine</div>
          <h2>Branch a recorded memory state</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Memory Time Machine"><X size={14} /></button>
      </header>

      {checkpoint ? (
        <div className="time-machine-scroll">
          <InvestigationProgress
            branchEdits={branch?.mutations.length ?? 0}
            hasReplay={Boolean(result)}
            regressionSaved={regressionSaved}
          />
          <section className="time-machine-checkpoint">
            <label htmlFor="time-machine-checkpoint">Recorded checkpoint</label>
            <select
              id="time-machine-checkpoint"
              value={checkpoint.id}
              onChange={(event) => selectCheckpoint(event.target.value)}
            >
              {checkpoints.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.index + 1}. {candidate.label}
                </option>
              ))}
            </select>
            <div>
              <span>{checkpoint.source}</span>
              <span>{checkpoint.memories.length} memories</span>
              <span>{checkpoint.loadedMemoryIds.length} loaded</span>
              <span>{checkpoint.turnRecord ? "replayable turn" : "state only"}</span>
            </div>
          </section>

          <section className="time-machine-compare" aria-label="Recorded and branch memory states">
            <MemoryStateColumn
              label="Recorded"
              memories={checkpoint.memories}
              loadedIds={checkpoint.loadedMemoryIds}
            />
            <div className="time-machine-branch-column">
              <div className="time-machine-column-heading">
                <span>Experimental branch</span>
                <strong>{branch?.mutations.length ?? 0} edits</strong>
              </div>
              <ol>
                {checkpoint.memories.length > 0 ? checkpoint.memories.map((memory) => {
                  const mutation = mutationByMemoryId.get(memory.id);
                  const replacement = mutation?.type === "replace" ? mutation.replacement : undefined;
                  return (
                    <li key={memory.id} data-state={mutation?.type ?? "retained"}>
                      <MemorySummary memory={replacement ?? memory} loaded={checkpoint.loadedMemoryIds.includes(memory.id)} />
                      {editingMemoryId === memory.id ? (
                        <div className="time-machine-replace-editor">
                          <textarea
                            aria-label={`Replacement text for ${memory.text}`}
                            value={replacementDraft}
                            onChange={(event) => setReplacementDraft(event.target.value)}
                          />
                          <div>
                            <button type="button" onClick={() => saveReplacement(memory)}>Save replacement</button>
                            <button type="button" onClick={() => setEditingMemoryId(undefined)}>Cancel</button>
                          </div>
                        </div>
                      ) : mutation ? (
                        <div className="time-machine-mutation-status">
                          <span>{mutation.type === "replace" ? "Original replaced" : "Quarantined from branch"}</span>
                          <button type="button" onClick={() => undoMutation(memory.id)}><RotateCcw size={11} /> Undo</button>
                        </div>
                      ) : (
                        <div className="time-machine-memory-actions">
                          <button type="button" onClick={() => quarantine(memory)}><ShieldOff size={11} /> Quarantine</button>
                          <button type="button" onClick={() => startReplacement(memory)}><Replace size={11} /> Replace</button>
                        </div>
                      )}
                    </li>
                  );
                }) : <li className="time-machine-empty-memory">No memories existed at this checkpoint.</li>}
              </ol>
            </div>
          </section>

          <section className="time-machine-replay">
            <div>
              <span>Controlled replay</span>
              <p>
                Re-run the same recorded user turn with the branch context. The live session remains unchanged.
              </p>
            </div>
            <button
              type="button"
              disabled={pending || !checkpoint.turnRecord || !branch?.mutations.length}
              onClick={() => void replayBranch()}
            >
              <Play size={12} /> {pending ? "Running two replays..." : "Replay branch"}
            </button>
            {!checkpoint.turnRecord ? (
              <p className="time-machine-replay-note">State-only checkpoint: this source did not record the turn input needed for answer replay.</p>
            ) : null}
            {error ? <p className="time-machine-error">{error}</p> : null}
          </section>

          {result ? (
            <ReplayComparison
              ref={resultRef}
              onSaveRegression={onSaveRegression ? saveRegression : undefined}
              regressionSaved={regressionSaved}
              result={result}
            />
          ) : null}
        </div>
      ) : onLoadSampleIncident && onReturnToLearn ? (
        <IncidentWorkbenchEmptyState
          onLoadSampleIncident={onLoadSampleIncident}
          onReturnToLearn={onReturnToLearn}
        />
      ) : (
        <div className="time-machine-empty">
          No checkpoints yet. Complete a conversation turn or load a trace to create an inspectable state.
        </div>
      )}
    </aside>
  );
}

function InvestigationProgress({
  branchEdits,
  hasReplay,
  regressionSaved
}: {
  branchEdits: number;
  hasReplay: boolean;
  regressionSaved: boolean;
}) {
  const current = regressionSaved ? 4 : hasReplay ? 4 : branchEdits > 0 ? 3 : 2;
  const steps = [
    { number: 1, label: "Inspect", detail: "Recorded evidence" },
    { number: 2, label: "Branch", detail: "Test a memory fix" },
    { number: 3, label: "Compare", detail: "Run two replays" },
    { number: 4, label: "Save", detail: "Create regression" }
  ];

  return (
    <nav className="time-machine-progress" aria-label="Investigation workflow">
      <ol>
        {steps.map((step) => {
          const state = step.number < current || regressionSaved ? "done" : step.number === current ? "current" : "pending";
          return (
            <li
              key={step.number}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              <i aria-hidden="true">{step.number}</i>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MemoryStateColumn({
  label,
  memories,
  loadedIds
}: {
  label: string;
  memories: EngramMemory[];
  loadedIds: string[];
}) {
  return (
    <div className="time-machine-state-column">
      <div className="time-machine-column-heading">
        <span>{label}</span>
        <strong>Immutable</strong>
      </div>
      <ol>
        {memories.length > 0
          ? memories.map((memory) => (
              <li key={memory.id}>
                <MemorySummary memory={memory} loaded={loadedIds.includes(memory.id)} />
              </li>
            ))
          : <li className="time-machine-empty-memory">No memories existed at this checkpoint.</li>}
      </ol>
    </div>
  );
}

function MemorySummary({ memory, loaded }: { memory: EngramMemory; loaded: boolean }) {
  return (
    <div className="time-machine-memory-summary" data-region={memory.region}>
      <i aria-hidden="true" />
      <div>
        <strong>{memory.text}</strong>
        <span>{memory.region} · {memory.status ?? "active"}{loaded ? " · loaded" : ""}</span>
      </div>
    </div>
  );
}

function ReplayComparison({
  ref,
  result,
  onSaveRegression,
  regressionSaved
}: {
  ref: React.Ref<HTMLElement>;
  result: MemoryBranchReplayResult;
  onSaveRegression?: () => void;
  regressionSaved: boolean;
}) {
  return (
    <section ref={ref} className="time-machine-result" data-outcome={result.comparison.outcome} aria-label="Branch replay result">
      <header>
        <div>
          <span>Observed replay result</span>
          <h3>{result.changed ? "The answer changed" : "The answer remained stable"}</h3>
        </div>
        <output>{Math.round(result.comparison.normalizedTextDistance * 100)}% text distance</output>
      </header>
      <div className="time-machine-answer-grid">
        <article>
          <span>Recorded context replay</span>
          <p>{result.baselineAnswer || "No answer text returned."}</p>
          <small>{result.baselineMemoryIds.length} memories</small>
        </article>
        <article>
          <span>Branch context replay</span>
          <p>{result.branchAnswer || "No answer text returned."}</p>
          <small>{result.branchMemoryIds.length} memories</small>
        </article>
      </div>
      <p className="time-machine-caveat">{result.caveat}</p>
      {onSaveRegression ? (
        <div className="time-machine-regression-action">
          <div>
            <strong>{regressionSaved ? "Regression saved" : "Keep this repair reproducible"}</strong>
            <span>
              Export the frozen memory fixture, turn input, replay evidence, and retrieval expectations as a portable test.
            </span>
          </div>
          <button type="button" onClick={onSaveRegression}>
            <Download size={12} /> {regressionSaved ? "Download again" : "Save regression"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function uniqueMemories(memories: EngramMemory[]) {
  return [...new Map(memories.map((memory) => [memory.id, memory])).values()];
}

function mutationId(type: "quarantine" | "replace", memoryId: string) {
  return `${type}-${memoryId}-${Date.now().toString(36)}`;
}

function readError(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  return typeof value.error === "string" ? value.error : undefined;
}
