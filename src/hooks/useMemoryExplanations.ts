"use client";

import { useMemo } from "react";
import { buildMemoryExplanations } from "@/lib/explanations";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import type { EngramEvent } from "@/types";

export function useMemoryExplanations(events: EngramEvent[]) {
  const memories = useMemoryStore(events);

  return useMemo(() => buildMemoryExplanations(events, memories), [events, memories]);
}
