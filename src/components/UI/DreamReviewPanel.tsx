import { GitMerge, Lightbulb, MoonStar, Replace, X } from "lucide-react";
import type { ReactNode } from "react";
import { benchmarkDreamProposal } from "@/lib/integrity/dream-benchmark";
import type { DreamBenchmark } from "@/lib/integrity/types";
import type { DreamOperation, DreamProposal, EngramMemory } from "@/types";

type DreamReviewPanelProps = {
  beforeMemories?: EngramMemory[];
  error?: string | null;
  onApply: (proposal: DreamProposal) => void;
  onClose?: () => void;
  onDismiss: (proposal: DreamProposal) => void;
  open: boolean;
  pending?: boolean;
  proposal?: DreamProposal | null;
};

export function DreamReviewPanel({
  beforeMemories = [],
  error,
  onApply,
  onClose,
  onDismiss,
  open,
  pending = false,
  proposal
}: DreamReviewPanelProps) {
  if (!open) return null;

  const beforeById = new Map(beforeMemories.map((memory) => [memory.id, memory]));
  const operationCount = proposal?.operations.length ?? 0;
  const canApply = Boolean(proposal && proposal.status === "proposed" && operationCount > 0);
  const benchmark = proposal ? benchmarkDreamProposal(beforeMemories, proposal) : undefined;

  return (
    <aside className="secondary-panel secondary-panel-right dream-review-panel" aria-label="Dream review">
      <header className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">Dream Mode</div>
          <div className="secondary-panel-title">Dream proposal</div>
        </div>
        {onClose ? (
          <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close dream panel">
            <X size={14} />
          </button>
        ) : null}
      </header>

      <div className="dream-review-summary">
        <div className="dream-review-kicker">
          <MoonStar size={13} />
          {pending
            ? "Dreaming over memories"
            : proposal?.provider === "llm"
              ? "Model-reviewed memories"
              : "Dream review complete"}
        </div>
        <p>
          {error ??
            proposal?.reason ??
            "Engram is dreaming over memory traces: checking duplicates, stale conflicts, and possible insights."}
        </p>
        <span>
          {pending
            ? "Input memories stay unchanged while the dream runs."
            : `${operationCount} ${operationCount === 1 ? "change" : "changes"} proposed. Nothing changes until you apply it.`}
        </span>
      </div>

      <div className="dream-operation-list">
        {benchmark && proposal?.status === "proposed" ? <DreamBenchmarkStrip benchmark={benchmark} /> : null}
        {proposal?.operations.map((operation) => (
          <DreamOperationCard beforeById={beforeById} key={operation.id} operation={operation} />
        ))}
        {!pending && proposal && operationCount === 0 ? (
          <article className="dream-operation-card" data-operation="skip">
            <div className="dream-operation-heading">
              <MoonStar size={14} />
              <div>
                <strong>No safe dream yet</strong>
                <span>Current memories stay as they are.</span>
              </div>
            </div>
          </article>
        ) : null}
      </div>

      {proposal ? (
        <div className="dream-review-actions">
          {canApply ? (
            <button className="dream-action dream-action-primary" type="button" onClick={() => onApply(proposal)}>
              Apply dream
            </button>
          ) : null}
          <button className="dream-action" type="button" onClick={() => onDismiss(proposal)}>
            Keep current memories
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function DreamBenchmarkStrip({ benchmark }: { benchmark: DreamBenchmark }) {
  const metrics = [
    { label: "Active", before: benchmark.before.activeMemories, after: benchmark.after.activeMemories },
    { label: "Duplicates", before: benchmark.before.duplicatePairs, after: benchmark.after.duplicatePairs },
    { label: "Conflicts", before: benchmark.before.conflictPairs, after: benchmark.after.conflictPairs },
    { label: "Est. tokens", before: benchmark.before.estimatedContextTokens, after: benchmark.after.estimatedContextTokens }
  ];

  return (
    <section className="dream-benchmark" data-verdict={benchmark.verdict} aria-label="Dream benchmark">
      <header>
        <div>
          <span>Projected benchmark</span>
          <strong>{benchmark.verdict === "improved" ? "Cleaner proposed state" : benchmark.verdict === "regressed" ? "Review regression" : "No measured change"}</strong>
        </div>
        <b>{Math.round(benchmark.estimatedInformationRetention * 100)}% est. retained</b>
      </header>
      <div className="dream-benchmark-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.before} <i aria-hidden="true">to</i> {metric.after}</strong>
          </div>
        ))}
      </div>
      <ul>{benchmark.observations.map((observation) => <li key={observation}>{observation}</li>)}</ul>
      <p>{benchmark.caveat}</p>
    </section>
  );
}

function DreamOperationCard({
  beforeById,
  operation
}: {
  beforeById: Map<string, EngramMemory>;
  operation: DreamOperation;
}) {
  const before = operation.sourceIds
    .map((id) => beforeById.get(id) ?? fallbackMemory(id))
    .filter((memory): memory is EngramMemory => Boolean(memory));
  const superseded = operation.supersedeIds ?? [];

  return (
    <article className="dream-operation-card" data-operation={operation.type}>
      <div className="dream-operation-heading">
        {operationIcon(operation.type)}
        <div>
          <strong>{operationLabel(operation)}</strong>
          <span>{Math.round(operation.confidence * 100)}% confidence</span>
        </div>
      </div>

      <div className="dream-review-columns">
        <section>
          <h3>Before</h3>
          <ul>
            {before.map((memory) => (
              <li key={memory.id}>{memory.text}</li>
            ))}
            {before.length === 0 ? <li>Source memories will be resolved when the proposal is applied.</li> : null}
          </ul>
        </section>
        <section>
          <h3>After</h3>
          <p>{afterText(operation, superseded.length)}</p>
        </section>
      </div>

      <div className="dream-operation-reason">
        <strong>Reason</strong>
        <span>{operation.reason}</span>
      </div>
    </article>
  );
}

function operationIcon(type: DreamOperation["type"]): ReactNode {
  switch (type) {
    case "merge":
      return <GitMerge size={14} />;
    case "supersede":
      return <Replace size={14} />;
    case "insight":
      return <Lightbulb size={14} />;
  }
}

function operationLabel(operation: DreamOperation) {
  switch (operation.type) {
    case "merge":
      return "Merge related memories";
    case "supersede":
      return `Supersede ${pluralize(operation.supersedeIds?.length ?? operation.sourceIds.length, "memory")}`;
    case "insight":
      return "Create dream insight";
  }
}

function afterText(operation: DreamOperation, supersededCount: number) {
  if (operation.result) return operation.result.text;
  if (operation.type === "supersede") return `${pluralize(supersededCount, "memory")} will be retired from active recall.`;
  return "Engram will keep the current memories unchanged for this operation.";
}

function fallbackMemory(id: string): EngramMemory {
  return {
    id,
    text: `Memory ${id}`,
    importance: 0,
    region: "hippocampus",
    created_at: new Date(0).toISOString(),
    access_count: 0
  };
}

function pluralize(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}
