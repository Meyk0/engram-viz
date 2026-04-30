import type { ChatMessage } from "@/types";

type DraftTurn = {
  user: string;
  assistant: string;
};

type ChatTranscriptProps = {
  history: ChatMessage[];
  draftTurn: DraftTurn | null;
  error: string | null;
};

export function ChatTranscript({ history, draftTurn, error }: ChatTranscriptProps) {
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
    <aside className="chat-transcript" aria-label="Chat transcript">
      <div className="transcript-header">CONVERSATION</div>
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
