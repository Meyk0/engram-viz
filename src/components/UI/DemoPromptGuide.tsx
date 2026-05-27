import { Sparkles } from "lucide-react";

type DemoPromptGuideProps = {
  onPromptSend: (prompt: string) => void;
  onRunDemo: () => void;
  onStopDemo: () => void;
  prompt?: string;
  remainingCount?: number;
  running?: boolean;
};

export function DemoPromptGuide({
  onPromptSend,
  onRunDemo,
  onStopDemo,
  prompt,
  remainingCount = 0,
  running = false
}: DemoPromptGuideProps) {
  if (!prompt && !running) return null;

  return (
    <aside className="demo-prompt-guide" aria-label="Guided demo prompt">
      <span>
        <Sparkles size={13} aria-hidden="true" />
        {running ? "Demo playing" : "Guided demo"}
      </span>
      <div className="demo-prompt-actions">
        {prompt && !running ? (
          <button
            className="demo-prompt-step"
            type="button"
            onClick={() => onPromptSend(prompt)}
            aria-label={`Send demo prompt: ${prompt}`}
          >
            <b>Try next</b>
            <span>{prompt}</span>
          </button>
        ) : null}
        <button
          className="demo-run-btn"
          type="button"
          onClick={running ? onStopDemo : onRunDemo}
          aria-label={running ? "Stop guided demo" : "Run full guided demo"}
        >
          {running ? "Stop demo" : "Run demo"}
          {remainingCount > 0 && !running ? <small>{remainingCount} steps</small> : null}
        </button>
      </div>
    </aside>
  );
}
