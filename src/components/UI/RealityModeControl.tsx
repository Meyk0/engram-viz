import { Brain, Network } from "lucide-react";
import type { EngramViewMode } from "@/lib/semantic/types";

export type RealityModeControlProps = {
  memoryCount: number;
  mode: EngramViewMode;
  onModeChange: (mode: EngramViewMode) => void;
};

const modes: Array<{
  icon: typeof Brain;
  label: string;
  value: EngramViewMode;
}> = [
  { icon: Brain, label: "Brain model", value: "anatomical" },
  { icon: Network, label: "Semantic map", value: "semantic" }
];

export function RealityModeControl({ memoryCount, mode, onModeChange }: RealityModeControlProps) {
  if (memoryCount <= 0) return null;

  return (
    <div className="reality-mode-control" role="radiogroup" aria-label="Reality mode">
      {modes.map(({ icon: Icon, label, value }) => {
        const active = mode === value;

        return (
          <button
            aria-checked={active}
            className="reality-mode-option"
            data-active={active}
            key={value}
            onClick={() => onModeChange(value)}
            role="radio"
            type="button"
          >
            <Icon aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
