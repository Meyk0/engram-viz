"use client";

import { useCallback, useState } from "react";
import type { EngramEvent } from "@/types";

export function useEventQueue(initialEvents: EngramEvent[] = []) {
  const [events, setEvents] = useState<EngramEvent[]>(initialEvents);

  const pushEvent = useCallback((event: EngramEvent) => {
    setEvents((current) => [event, ...current].slice(0, 50));
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, pushEvent, clearEvents };
}
