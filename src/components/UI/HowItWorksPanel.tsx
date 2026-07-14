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
          Engram visualizes observable memory operations around an AI agent. Durable facts become
          memory dots, and retrieved dots show what memory was made available to the model for an
          answer. Engram does not expose hidden reasoning or internal model activations.
        </p>
        <dl className="memory-model-list">
          <div data-region="hippocampus">
            <dt>New Memories</dt>
            <dd>Hippocampus: durable facts land here first</dd>
          </div>
          <div data-region="prefrontal">
            <dt>Working Memory</dt>
            <dd>Prefrontal cortex: retrieved facts loaded for this turn</dd>
          </div>
          <div data-region="temporal">
            <dt>Stable Knowledge</dt>
            <dd>Temporal cortex: repeated memories can merge here</dd>
          </div>
        </dl>
        <p className="how-it-works-hint">
          Use Run demo for a short walkthrough, or open Story to follow the memory lifecycle turn by turn.
        </p>
        <section className="advanced-model-list" aria-labelledby="advanced-model-title">
          <h3 id="advanced-model-title">Explore deeper</h3>
          <dl>
            <div>
              <dt>Reality map</dt>
              <dd>Switch from anatomy to the semantic geometry used for memory retrieval.</dd>
            </div>
            <div>
              <dt>Ablation Replay</dt>
              <dd>
                Compare a baseline rerun with a replay that omits one retrieved memory. A changed
                answer is experimental evidence, not proof of deterministic causality.
              </dd>
            </div>
            <div>
              <dt>Lineage</dt>
              <dd>Trace how a memory was created, corrected, consolidated, or supplied to an answer.</dd>
            </div>
            <div>
              <dt>Dream Mode</dt>
              <dd>Review proposed offline merges and corrections before applying any change.</dd>
            </div>
            <div>
              <dt>Trace playback</dt>
              <dd>Import recorded OpenAI agent or Responses JSON and replay explicit memory operations.</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
