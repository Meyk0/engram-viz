type OnboardingPanelProps = {
  onStart: () => void;
};

export function OnboardingPanel({ onStart }: OnboardingPanelProps) {
  return (
    <section className="onboarding-panel" aria-label="Engram memory model introduction">
      <div className="onboarding-eyebrow">AI Memory Map</div>
      <h2>See what the AI remembers, recalls, and uses.</h2>
      <p>
        Engram turns invisible memory operations into a brain metaphor: new facts are stored,
        relevant memories are recalled, and active context shows what influenced the answer.
      </p>
      <dl className="onboarding-regions">
        <div data-region="hippocampus">
          <dt>Hippocampus</dt>
          <dd>New raw memories land here first</dd>
        </div>
        <div data-region="prefrontal">
          <dt>Prefrontal</dt>
          <dd>Retrieved memories used right now</dd>
        </div>
        <div data-region="temporal">
          <dt>Temporal</dt>
          <dd>Stable knowledge after consolidation</dd>
        </div>
      </dl>
      <p className="onboarding-hint">Click a region label or memory dot later to inspect what happened.</p>
      <div className="onboarding-actions">
        <button className="onboarding-primary" type="button" onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  );
}
