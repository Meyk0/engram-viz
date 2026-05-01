import { getCurrentEventNarrative } from "@/lib/eventNarrative";
import type { EngramEvent } from "@/types";

type CurrentEventBannerProps = {
  draftAssistant?: string;
  events: EngramEvent[];
  streaming?: boolean;
};

export function CurrentEventBanner({ draftAssistant = "", events, streaming = false }: CurrentEventBannerProps) {
  const narrative = getLiveNarrative({ draftAssistant, events, streaming });

  return (
    <aside className="current-event-banner" data-type={narrative.type} data-region={narrative.region} aria-label="Current memory event">
      <div className="current-event-title">{narrative.title}</div>
      <div className="current-event-body">{narrative.body}</div>
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
      title: "Engram responding",
      body: responsePreview,
      type: "fire" as const,
      region: "prefrontal" as const
    };
  }

  if (streaming) {
    return {
      title: "Thinking through memory",
      body: "Searching stored memories, preparing context, and waiting for the model response.",
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
