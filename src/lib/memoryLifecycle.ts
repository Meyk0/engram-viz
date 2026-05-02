import type { EngramEvent } from "@/types";

export type MemoryLifecycleStepId = "store" | "retrieve" | "use" | "stabilize";

export type MemoryLifecycleStep = {
  caption: string;
  id: MemoryLifecycleStepId;
  label: string;
  state: "idle" | "active" | "complete";
};

const lifecycleStepCopy: Array<Omit<MemoryLifecycleStep, "state">> = [
  { id: "store", label: "Store", caption: "save durable facts" },
  { id: "retrieve", label: "Retrieve", caption: "find relevant memories" },
  { id: "use", label: "Use", caption: "load working memory" },
  { id: "stabilize", label: "Stabilize", caption: "merge repeated memories" }
];

export function getMemoryLifecycleSteps(events: EngramEvent[], streaming = false): MemoryLifecycleStep[] {
  const activeStep = getActiveLifecycleStep(events, streaming);

  return lifecycleStepCopy.map((step) => ({
    ...step,
    state: activeStep === step.id ? "active" : hasLifecycleEvidence(events, step.id) ? "complete" : "idle"
  }));
}

export function getActiveLifecycleStep(
  events: EngramEvent[],
  streaming = false
): MemoryLifecycleStepId | undefined {
  const event = events[0];

  if (!event) return streaming ? "retrieve" : undefined;

  if (event.type === "store" || isStoreFollowupFire(events)) return "store";
  if (event.type === "consolidate" || isConsolidationFollowupFire(events)) return "stabilize";
  if (
    event.type === "load" ||
    (event.type === "fire" && event.region === "prefrontal") ||
    (event.type === "plan" &&
      event.decision.operation === "ignore" &&
      (event.decision.relatedMemoryIds?.length ?? 0) > 0)
  ) {
    return "use";
  }
  if (event.type === "retrieve" || streaming) return "retrieve";

  return undefined;
}

function hasLifecycleEvidence(events: EngramEvent[], step: MemoryLifecycleStepId) {
  switch (step) {
    case "store":
      return events.some((event) => event.type === "store");
    case "retrieve":
      return events.some((event) => event.type === "retrieve");
    case "use":
      return events.some(
        (event) =>
          (event.type === "load" && event.ids.length > 0) ||
          (event.type === "fire" && event.region === "prefrontal" && event.ids.length > 0) ||
          (event.type === "plan" &&
            event.decision.operation === "ignore" &&
            (event.decision.relatedMemoryIds?.length ?? 0) > 0)
      );
    case "stabilize":
      return events.some((event) => event.type === "consolidate");
  }
}

function isStoreFollowupFire(events: EngramEvent[]) {
  const event = events[0];
  const previous = events[1];

  return (
    event?.type === "fire" &&
    event.region === "hippocampus" &&
    previous?.type === "store" &&
    event.ids.includes(previous.memory.id)
  );
}

function isConsolidationFollowupFire(events: EngramEvent[]) {
  const event = events[0];
  const previous = events[1];

  return (
    event?.type === "fire" &&
    event.region === "temporal" &&
    previous?.type === "consolidate" &&
    event.ids.includes(previous.added.id)
  );
}
