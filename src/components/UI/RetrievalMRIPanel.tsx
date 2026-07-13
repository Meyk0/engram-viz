import { ArrowRight, ScanSearch, X } from "lucide-react";
import type { EngramEvent, EngramMemory, MemoryRetrievalTrace } from "@/types";
import "./retrieval-mri.css";

type RetrieveEvent = Extract<EngramEvent, { type: "retrieve" }>;

type RetrievalMRIPanelProps = {
  loadedMemoryIds: string[];
  memories: EngramMemory[];
  onClose: () => void;
  retrieve: RetrieveEvent;
};

const componentLabels: Record<string, string> = {
  semantic: "Semantic",
  lexical: "Lexical",
  importance: "Importance boost",
  access: "Access boost",
  guardrail: "Guardrail signal"
};

export function RetrievalMRIPanel({
  loadedMemoryIds,
  memories,
  onClose,
  retrieve
}: RetrievalMRIPanelProps) {
  const memoryById = new Map(
    [...memories, ...(retrieve.accessed ?? [])].map((memory) => [memory.id, memory])
  );
  const matches = retrievalMatches(retrieve);
  const retrieval = retrieve.retrieval;
  const candidateCount = retrieval?.candidateCount ?? matches.length;
  const eligibleCount = retrieval?.eligibleCount
    ?? matches.filter((match) => match.eligible !== false).length;
  const selectedCount = retrieval?.selectedCount
    ?? matches.filter((match) => match.selected).length;
  const loadedCount = matches.filter((match) => loadedMemoryIds.includes(match.id)).length;
  const maxPositiveScore = Math.max(0.0001, ...matches.map((match) => Math.max(0, match.score)));

  return (
    <aside className="secondary-panel secondary-panel-right retrieval-mri-panel" aria-label="Retrieval MRI">
      <header className="retrieval-mri-header">
        <div>
          <div className="retrieval-mri-eyebrow">
            <ScanSearch aria-hidden="true" size={12} />
            Retrieval MRI
          </div>
          <h2>Why these memories?</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Retrieval MRI">
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="retrieval-mri-scroll">
        <section className="retrieval-mri-query" aria-label="Retrieval query">
          <span>Query</span>
          <p>{retrieve.query}</p>
        </section>

        <ol className="retrieval-mri-pipeline" aria-label="Retrieval pipeline">
          <PipelineStage label="Candidates" value={candidateCount} />
          <PipelineStage label="Eligible" value={eligibleCount} />
          <PipelineStage label="Selected" value={selectedCount} />
          <PipelineStage label="Loaded" value={loadedCount} />
        </ol>

        <div className="retrieval-mri-method">
          <div>
            <span>Method</span>
            <strong>{providerLabel(retrieval)}</strong>
          </div>
          {retrieval?.limit ? (
            <div>
              <span>Context limit</span>
              <strong>{retrieval.limit}</strong>
            </div>
          ) : null}
          {retrieval?.reason ? <p>{retrieval.reason}</p> : null}
        </div>

        <section className="retrieval-mri-candidates" aria-labelledby="retrieval-mri-candidates-title">
          <div className="retrieval-mri-section-heading">
            <h3 id="retrieval-mri-candidates-title">Candidate evidence</h3>
            <span>Recorded, not inferred</span>
          </div>

          {matches.length > 0 ? (
            <ol>
              {matches.map((match) => {
                const memory = memoryById.get(match.id);
                const status = candidateStatus(match, loadedMemoryIds);
                const components = Object.entries(match.components ?? {})
                  .filter((entry): entry is [string, number] =>
                    typeof entry[1] === "number" && (entry[0] !== "guardrail" || entry[1] !== 0)
                  );

                return (
                  <li data-status={status} key={match.id}>
                    <div className="retrieval-mri-candidate-heading">
                      <span className="retrieval-mri-rank">{match.rank}</span>
                      <div>
                        <strong>{memory?.text ?? match.id}</strong>
                        <span>{basisLabel(match.basis)} · {statusLabel(status)}</span>
                      </div>
                      <output>{formatScore(match.score)}</output>
                    </div>
                    <div className="retrieval-mri-score-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, match.score) / maxPositiveScore * 100}%` }} />
                    </div>
                    {components.length > 0 ? (
                      <dl className="retrieval-mri-components">
                        {components.map(([key, value]) => (
                          <div key={key}>
                            <dt>{componentLabels[key] ?? key}</dt>
                            <dd>{formatScore(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {match.filterReason ? (
                      <p className="retrieval-mri-filter-reason">Filtered: {match.filterReason}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="retrieval-mri-empty">This older retrieval event did not record candidate-level evidence.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function PipelineStage({ label, value }: { label: string; value: number }) {
  return (
    <li>
      <span>{label}</span>
      <strong>{value}</strong>
      {label === "Loaded" ? null : <ArrowRight aria-hidden="true" size={10} />}
    </li>
  );
}

function retrievalMatches(retrieve: RetrieveEvent): NonNullable<MemoryRetrievalTrace["matches"]> {
  return retrieve.retrieval?.matches ?? retrieve.ids.map((id, index) => ({
    id,
    rank: index + 1,
    score: 1,
    basis: retrieve.retrieval?.provider === "semantic" ? "semantic" : "lexical",
    eligible: true,
    selected: true
  }));
}

function candidateStatus(
  match: NonNullable<MemoryRetrievalTrace["matches"]>[number],
  loadedMemoryIds: string[]
) {
  if (match.eligible === false) return "filtered";
  if (loadedMemoryIds.includes(match.id)) return "loaded";
  if (match.selected) return "selected";
  return "candidate";
}

function statusLabel(status: ReturnType<typeof candidateStatus>) {
  if (status === "loaded") return "Loaded into context";
  if (status === "selected") return "Selected";
  if (status === "filtered") return "Filtered";
  return "Not selected";
}

function providerLabel(retrieval?: MemoryRetrievalTrace) {
  const selectedBases = new Set(
    retrieval?.matches?.filter((match) => match.selected).map((match) => match.basis) ?? []
  );

  if (retrieval?.provider === "semantic" && selectedBases.size === 1 && selectedBases.has("lexical")) {
    return "Lexical preflight";
  }
  if (retrieval?.provider === "semantic" && selectedBases.has("guardrail")) {
    return "Semantic + lexical guardrail";
  }
  if (retrieval?.provider === "semantic") return "Semantic embeddings";
  if (retrieval?.provider === "fallback") return "Lexical fallback";
  return "Lexical ranking";
}

function basisLabel(basis: NonNullable<MemoryRetrievalTrace["matches"]>[number]["basis"]) {
  if (basis === "semantic") return "Semantic rank";
  if (basis === "guardrail") return "Lexical guardrail";
  return "Lexical rank";
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}
