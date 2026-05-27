import { Sparkles } from "lucide-react";

type DemoPromptGuideProps = {
  onRunDemo: () => void;
  onStopDemo: () => void;
  remainingCount?: number;
  running?: boolean;
};

export function DemoPromptGuide({
  onRunDemo,
  onStopDemo,
  remainingCount = 0,
  running = false
}: DemoPromptGuideProps) {
  if (remainingCount <= 0 && !running) return null;

  return (
    <aside className="demo-prompt-guide" aria-label="Demo controls">
      <span>
        <Sparkles size={13} aria-hidden="true" />
        {running ? "Demo playing" : "Demo"}
      </span>
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
