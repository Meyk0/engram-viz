type OnboardingPanelProps = {
  onStart: () => void;
};

export function OnboardingPanel({ onStart }: OnboardingPanelProps) {
  return (
    <section className="onboarding-panel" aria-label="Engram memory model introduction">
      <div className="onboarding-eyebrow">Visible Memory</div>
      <h2>Engram makes LLM memory visible.</h2>
      <p>
        Durable facts land in the hippocampus. Related memories are pulled into prefrontal working
        memory when answering. Repeated facts can consolidate into temporal semantic memory.
      </p>
      <dl className="onboarding-regions">
        <div data-region="hippocampus">
          <dt>Hippocampus</dt>
          <dd>New raw memories</dd>
        </div>
        <div data-region="prefrontal">
          <dt>Prefrontal</dt>
          <dd>Active context right now</dd>
        </div>
        <div data-region="temporal">
          <dt>Temporal</dt>
          <dd>Stable semantic memory</dd>
        </div>
      </dl>
      <div className="onboarding-actions">
        <button className="onboarding-primary" type="button" onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  );
}
