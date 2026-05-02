type OnboardingPanelProps = {
  onStart: () => void;
};

export function OnboardingPanel({ onStart }: OnboardingPanelProps) {
  return (
    <section className="onboarding-panel" aria-label="Engram memory model introduction">
      <div className="onboarding-eyebrow">AI memory, visible</div>
      <h2>Engram shows what the AI stores, retrieves, and uses.</h2>
      <p>
        Durable facts become memory dots. Questions retrieve relevant dots into working memory
        before the answer, so you can see what influenced it.
      </p>
      <dl className="onboarding-regions">
        <div data-region="hippocampus">
          <dt>New Memories</dt>
          <dd>Hippocampus: durable facts land here first</dd>
        </div>
        <div data-region="prefrontal">
          <dt>Working Memory</dt>
          <dd>Prefrontal cortex: retrieved facts used now</dd>
        </div>
        <div data-region="temporal">
          <dt>Stable Knowledge</dt>
          <dd>Temporal cortex: repeated memories can merge here</dd>
        </div>
      </dl>
      <p className="onboarding-hint">Start with one durable preference, then ask a related question.</p>
      <div className="onboarding-actions">
        <button className="onboarding-primary" type="button" onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  );
}
