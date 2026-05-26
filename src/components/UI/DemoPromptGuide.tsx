import { Sparkles } from "lucide-react";

type DemoPromptGuideProps = {
  onPromptSelect: (prompt: string) => void;
  prompt?: string;
};

export function DemoPromptGuide({ onPromptSelect, prompt }: DemoPromptGuideProps) {
  if (!prompt) return null;

  return (
    <aside className="demo-prompt-guide" aria-label="Guided demo prompt">
      <span>
        <Sparkles size={13} aria-hidden="true" />
        Try next
      </span>
      <button
        type="button"
        onClick={() => onPromptSelect(prompt)}
        aria-label={`Fill demo prompt: ${prompt}`}
      >
        {prompt}
      </button>
    </aside>
  );
}
