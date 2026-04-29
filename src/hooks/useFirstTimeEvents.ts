"use client";

import { useCallback, useState } from "react";
import { firstTimeCaptions } from "@/lib/explanations";
import type { EngramEvent } from "@/types";

export function useFirstTimeEvents() {
  const [seen, setSeen] = useState<Set<EngramEvent["type"]>>(() => new Set());
  const [caption, setCaption] = useState<string | null>(null);

  const recordEvent = useCallback(
    (event: EngramEvent) => {
      const nextCaption = firstTimeCaptions[event.type];
      if (!nextCaption || seen.has(event.type)) return null;

      setSeen((current) => new Set(current).add(event.type));
      setCaption(nextCaption);
      return nextCaption;
    },
    [seen]
  );

  const dismissCaption = useCallback(() => setCaption(null), []);

  return { caption, recordEvent, dismissCaption };
}
