import { X } from "lucide-react";

type HowItWorksPanelProps = {
  onClose: () => void;
  open: boolean;
};

export function HowItWorksPanel({ onClose, open }: HowItWorksPanelProps) {
  if (!open) return null;

  return (
    <aside
      aria-label="How Engram works"
      className="secondary-panel secondary-panel-right how-it-works-panel"
    >
      <header className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">AI memory, visible</div>
          <div className="secondary-panel-title">How Engram works</div>
        </div>
        <button aria-label="Close how Engram works" className="panel-icon-btn" onClick={onClose} type="button">
          <X size={14} />
        </button>
      </header>
      <div className="how-it-works-body">
        <p>
          Engram shows what the AI stores, retrieves, and uses. Durable facts become memory dots.
          Questions retrieve relevant dots into working memory before the answer, so you can see what
          influenced it.
        </p>
        <dl className="memory-model-list">
          <div data-region="hippocampus">
            <dt>New Memories</dt>
            <dd>Hippocampus: durable facts land here first</dd>
          </div>
          <div data-region="prefrontal">
            <dt>Working Memory</dt>
            <dd>Prefrontal cortex: retrieved facts used right now</dd>
          </div>
          <div data-region="temporal">
            <dt>Stable Knowledge</dt>
            <dd>Temporal cortex: repeated memories can merge here</dd>
          </div>
        </dl>
        <p className="how-it-works-hint">
          Use Try next for the guided demo, or open Story to follow the memory lifecycle turn by turn.
        </p>
      </div>
    </aside>
  );
}
