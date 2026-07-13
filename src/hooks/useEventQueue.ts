"use client";

import { useCallback, useState } from "react";
import type { EngramEvent } from "@/types";

export function useEventQueue(initialEvents: EngramEvent[] = []) {
  const [events, setEvents] = useState<EngramEvent[]>(initialEvents);
  const [eventHistory, setEventHistory] = useState<EngramEvent[]>(initialEvents);

  const pushEvent = useCallback((event: EngramEvent) => {
    const prepend = (current: EngramEvent[]) => {
      const retained = event.type === "init" ? current.filter((item) => item.type !== "init") : current;
      return [event, ...retained];
    };

    setEvents((current) => prepend(current).slice(0, 50));
    setEventHistory(prepend);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setEventHistory([]);
  }, []);

  return { events, eventHistory, pushEvent, clearEvents };
}
