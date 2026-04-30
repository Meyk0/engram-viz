import { getCurrentEventNarrative } from "@/lib/eventNarrative";
import type { EngramEvent } from "@/types";

type CurrentEventBannerProps = {
  events: EngramEvent[];
};

export function CurrentEventBanner({ events }: CurrentEventBannerProps) {
  const narrative = getCurrentEventNarrative(events);

  return (
    <aside className="current-event-banner" data-type={narrative.type} data-region={narrative.region} aria-label="Current memory event">
      <div className="current-event-title">{narrative.title}</div>
      <div className="current-event-body">{narrative.body}</div>
    </aside>
  );
}
