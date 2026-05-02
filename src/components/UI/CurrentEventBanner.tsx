import { getCurrentEventNarrative } from "@/lib/eventNarrative";
import { MemoryLifecycleStrip } from "@/components/UI/MemoryLifecycleStrip";
import type { EngramEvent } from "@/types";

type CurrentEventBannerProps = {
  draftAssistant?: string;
  events: EngramEvent[];
  streaming?: boolean;
};

export function CurrentEventBanner({ draftAssistant = "", events, streaming = false }: CurrentEventBannerProps) {
  const narrative = getLiveNarrative({ draftAssistant, events, streaming });

  return (
    <aside className="current-event-banner" data-type={narrative.type} data-region={narrative.region} aria-label="Current memory receipt">
      <div className="current-event-title">
        {narrative.title}
        {streaming && !draftAssistant ? (
          <span className="event-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>
      <div className="current-event-body">{narrative.body}</div>
      <MemoryLifecycleStrip events={events} streaming={streaming} />
    </aside>
  );
}

function getLiveNarrative({
  draftAssistant,
  events,
  streaming
}: {
  draftAssistant: string;
  events: EngramEvent[];
  streaming: boolean;
}) {
  const responsePreview = previewText(draftAssistant);

  if (streaming && responsePreview) {
    return {
      title: "Answering",
      body: responsePreview,
      type: "fire" as const,
      region: "prefrontal" as const
    };
  }

  if (streaming) {
    return {
      title: "Checking memory",
      body: "Looking for relevant memories before answering.",
      type: "retrieve" as const,
      region: "prefrontal" as const
    };
  }

  return getCurrentEventNarrative(events);
}

function previewText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137).trim()}...`;
}
