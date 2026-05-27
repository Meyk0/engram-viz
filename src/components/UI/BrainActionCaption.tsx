import type { BrainRegion, EngramEvent } from "@/types";

type BrainActionCaptionProps = {
  demoPlaying?: boolean;
  events: EngramEvent[];
  streaming?: boolean;
};

type BrainAction = {
  body: string;
  region?: BrainRegion;
  title: string;
};

export function BrainActionCaption({
  demoPlaying = false,
  events,
  streaming = false
}: BrainActionCaptionProps) {
  const action = getBrainAction({ demoPlaying, events, streaming });
  if (!action) return null;

  return (
    <aside className="brain-action-caption" data-region={action.region} aria-label="Brain action caption">
      <span>{action.title}</span>
      <strong>{action.body}</strong>
    </aside>
  );
}

export function getBrainAction({
  demoPlaying,
  events,
  streaming
}: {
  demoPlaying?: boolean;
  events: EngramEvent[];
  streaming?: boolean;
}): BrainAction | null {
  const event = events[0];

  if (streaming && !event) {
    return {
      title: demoPlaying ? "Demo running" : "Reading turn",
      body: "Deciding whether to store, retrieve, or answer directly"
    };
  }

  if (!event && demoPlaying) {
    return {
      title: "Demo ready",
      body: "Engram will store, retrieve, update, and answer from memory"
    };
  }

  if (!event) return null;
  const previous = events[1];

  switch (event.type) {
    case "store":
      return {
        title: event.memory.supersedes?.length ? "Update" : "Store",
        body: event.memory.supersedes?.length
          ? "New fact replaces an older memory"
          : "New durable fact lands in hippocampus",
        region: "hippocampus"
      };
    case "retrieve":
      return {
        title: event.ids.length > 0 ? "Retrieve" : "Search",
        body: event.ids.length > 0
          ? "Relevant memory is found before answering"
          : "No stored memory matched this turn",
        region: event.ids.length > 0 ? "prefrontal" : undefined
      };
    case "load":
      return {
        title: "Working memory",
        body: `${event.ids.length} ${event.ids.length === 1 ? "memory" : "memories"} copied into prefrontal cortex`,
        region: "prefrontal"
      };
    case "fire":
      if (event.region === "hippocampus" && previous?.type === "store" && event.ids.includes(previous.memory.id)) {
        return {
          title: previous.memory.supersedes?.length ? "Update" : "Store",
          body: previous.memory.supersedes?.length
            ? "New fact replaces an older memory"
            : "New durable fact lands in hippocampus",
          region: "hippocampus"
        };
      }
      if (event.region === "temporal" && previous?.type === "consolidate" && event.ids.includes(previous.added.id)) {
        return {
          title: "Stabilize",
          body: "Related raw memories merge into temporal cortex",
          region: "temporal"
        };
      }
      return {
        title: event.region === "prefrontal" ? "Use" : "Pulse",
        body: event.region === "prefrontal"
          ? "Retrieved facts influence the current answer"
          : `${regionLabel(event.region)} lights up`,
        region: event.region
      };
    case "consolidate":
      return {
        title: "Stabilize",
        body: "Related raw memories merge into temporal cortex",
        region: "temporal"
      };
    case "dream_start":
    case "dream_review":
      return {
        title: "Dream",
        body: "Offline memory review is comparing stored traces",
        region: "hippocampus"
      };
    case "dream_merge":
    case "dream_insight":
      return {
        title: "Dream proposal",
        body: "A stable memory candidate is drafted",
        region: "temporal"
      };
    case "dream_supersede":
      return {
        title: "Dream update",
        body: "Stale memory candidates are marked for retirement",
        region: "temporal"
      };
    case "dream_apply":
      return {
        title: "Dream applied",
        body: "Reviewed changes are now reflected in memory",
        region: "temporal"
      };
    case "dream_complete":
      return {
        title: "Dream ready",
        body: "Review the proposed memory changes before applying",
        region: "hippocampus"
      };
    case "dream_dismiss":
      return {
        title: "Dream dismissed",
        body: "Current memories stayed unchanged",
        region: "hippocampus"
      };
    case "plan":
      if (event.decision.operation === "store") {
        return {
          title: "Plan",
          body: "This turn looks durable enough to save",
          region: "hippocampus"
        };
      }
      if ((event.decision.relatedMemoryIds?.length ?? 0) > 0) {
        return {
          title: "Answer from memory",
          body: "Relevant memories were used without storing a new fact",
          region: "prefrontal"
        };
      }
      return null;
    case "init":
    case "decay":
      return null;
  }
}

function regionLabel(region: BrainRegion) {
  switch (region) {
    case "hippocampus":
      return "Hippocampus";
    case "prefrontal":
      return "Prefrontal cortex";
    case "temporal":
      return "Temporal cortex";
  }
}
