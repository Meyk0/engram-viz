import { Sparkles } from "lucide-react";

type DemoPromptGuideProps = {
  onPromptSend: (prompt: string) => void;
  prompt?: string;
};

export function DemoPromptGuide({ onPromptSend, prompt }: DemoPromptGuideProps) {
  if (!prompt) return null;

  return (
    <aside className="demo-prompt-guide" aria-label="Guided demo prompt">
      <span>
        <Sparkles size={13} aria-hidden="true" />
        Try next
      </span>
      <button
        type="button"
        onClick={() => onPromptSend(prompt)}
        aria-label={`Send demo prompt: ${prompt}`}
      >
        {prompt}
      </button>
    </aside>
  );
}
