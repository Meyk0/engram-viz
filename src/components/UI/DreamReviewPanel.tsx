import { GitMerge, Lightbulb, MoonStar, Replace, X } from "lucide-react";
import type { ReactNode } from "react";
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

  return (
    <aside className="secondary-panel secondary-panel-right dream-review-panel" aria-label="Dream reflection review">
      <header className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">Dream Mode</div>
          <div className="secondary-panel-title">Reflection proposal</div>
        </div>
        {onClose ? (
          <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close reflection review">
            <X size={14} />
          </button>
        ) : null}
      </header>

      <div className="dream-review-summary">
        <div className="dream-review-kicker">
          <MoonStar size={13} />
          {pending
            ? "Reviewing memories"
            : proposal?.provider === "llm"
              ? "Model-reviewed memories"
              : "Deterministic memory review"}
        </div>
        <p>{error ?? proposal?.reason ?? "Engram is reviewing memory traces before proposing any change."}</p>
        <span>
          {pending
            ? "Nothing is changing yet."
            : `${operationCount} ${operationCount === 1 ? "change" : "changes"} proposed. Nothing changes until you apply it.`}
        </span>
      </div>

      <div className="dream-operation-list">
        {proposal?.operations.map((operation) => (
          <DreamOperationCard beforeById={beforeById} key={operation.id} operation={operation} />
        ))}
        {!pending && proposal && operationCount === 0 ? (
          <article className="dream-operation-card" data-operation="skip">
            <div className="dream-operation-heading">
              <MoonStar size={14} />
              <div>
                <strong>No safe reflection yet</strong>
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
              Apply reflection
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
      return "Create reflected insight";
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
