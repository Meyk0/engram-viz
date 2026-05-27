import { Activity } from "lucide-react";

type AnswerProvenancePillProps = {
  count: number;
  onSelect: () => void;
};

export function AnswerProvenancePill({ count, onSelect }: AnswerProvenancePillProps) {
  if (count <= 0) return null;

  return (
    <button
      aria-label={`Show answer provenance: used ${count} ${count === 1 ? "memory" : "memories"}`}
      className="answer-provenance-pill"
      onClick={onSelect}
      type="button"
    >
      <Activity size={13} aria-hidden="true" />
      <span>Used {count}</span>
      <b>{count === 1 ? "memory" : "memories"}</b>
    </button>
  );
}
