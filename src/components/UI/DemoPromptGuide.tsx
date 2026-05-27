import { Sparkles } from "lucide-react";

type DemoPromptGuideProps = {
  currentPrompt?: string;
  onRunDemo: () => void;
  onStopDemo: () => void;
  remainingCount?: number;
  running?: boolean;
};

export function DemoPromptGuide({
  currentPrompt,
  onRunDemo,
  onStopDemo,
  remainingCount = 0,
  running = false
}: DemoPromptGuideProps) {
  if (remainingCount <= 0 && !running) return null;

  return (
    <aside className="demo-prompt-guide" data-live={Boolean(currentPrompt)} aria-label="Demo controls">
      <div className="demo-prompt-meta">
        <span className="demo-prompt-label">
          <Sparkles size={13} aria-hidden="true" />
          {running ? "Demo playing" : "Demo"}
        </span>
        {currentPrompt ? (
          <p className="demo-current-prompt">
            <b>User</b>
            {currentPrompt}
          </p>
        ) : null}
      </div>
      <button
        className="demo-run-btn"
        type="button"
        onClick={running ? onStopDemo : onRunDemo}
        aria-label={running ? "Stop demo" : "Run demo"}
      >
        {running ? "Stop demo" : "Run demo"}
        {remainingCount > 0 && !running ? <small>{remainingCount} steps</small> : null}
      </button>
    </aside>
  );
}
