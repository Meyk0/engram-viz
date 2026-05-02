import { getMemoryLifecycleSteps } from "@/lib/memoryLifecycle";
import type { EngramEvent } from "@/types";

type MemoryLifecycleStripProps = {
  events: EngramEvent[];
  streaming?: boolean;
};

export function MemoryLifecycleStrip({ events, streaming = false }: MemoryLifecycleStripProps) {
  const steps = getMemoryLifecycleSteps(events, streaming);

  return (
    <div className="memory-lifecycle-strip" aria-label="Memory lifecycle">
      {steps.map((step) => (
        <div className="memory-lifecycle-step" data-state={step.state} key={step.id}>
          <span>{step.label}</span>
          <small>{step.caption}</small>
        </div>
      ))}
    </div>
  );
}
