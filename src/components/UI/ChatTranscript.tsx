import { X } from "lucide-react";
import type { ChatMessage } from "@/types";

type DraftTurn = {
  user: string;
  assistant: string;
};

type ChatTranscriptProps = {
  history: ChatMessage[];
  draftTurn: DraftTurn | null;
  error: string | null;
  onClose: () => void;
  open: boolean;
};

export function ChatTranscript({ history, draftTurn, error, onClose, open }: ChatTranscriptProps) {
  if (!open) return null;

  const messages = draftTurn
    ? [
        ...history,
        { role: "user" as const, content: draftTurn.user },
        ...(draftTurn.assistant
          ? [{ role: "assistant" as const, content: draftTurn.assistant }]
          : [{ role: "assistant" as const, content: "..." }])
      ]
    : history;

  return (
    <aside className="secondary-panel secondary-panel-left chat-transcript" aria-label="Chat transcript">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">Transcript</div>
          <div className="secondary-panel-title">Conversation</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close transcript">
          <X size={13} />
        </button>
      </div>
      <div className="transcript-list">
        {messages.length === 0 ? (
          <div className="transcript-empty">No turns yet. Tell Engram something worth remembering.</div>
        ) : (
          messages.slice(-6).map((message, index) => (
            <article className="transcript-message" data-role={message.role} key={`${message.role}-${index}-${message.content}`}>
              <div className="transcript-role">{message.role === "user" ? "YOU" : "AI"}</div>
              <div className="transcript-copy">{message.content}</div>
            </article>
          ))
        )}
        {error ? <div className="transcript-error">{error}</div> : null}
      </div>
    </aside>
  );
}
