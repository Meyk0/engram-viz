import { BookOpen, FlaskConical, RadioTower } from "lucide-react";
import type { EngramProductMode } from "@/lib/lab/types";

type ProductModeControlProps = {
  mode: EngramProductMode;
  onModeChange: (mode: EngramProductMode) => void;
};

const modes: Array<{
  description: string;
  icon: typeof BookOpen;
  label: string;
  value: EngramProductMode;
}> = [
  {
    description: "Explore how memory works",
    icon: BookOpen,
    label: "Learn",
    value: "learn"
  },
  {
    description: "Inspect an agent trace",
    icon: RadioTower,
    label: "Observe",
    value: "observe"
  },
  {
    description: "Diagnose and repair a memory incident",
    icon: FlaskConical,
    label: "Incidents",
    value: "investigate"
  }
];

export function ProductModeControl({ mode, onModeChange }: ProductModeControlProps) {
  return (
    <nav className="product-mode-control" aria-label="Engram mode">
      {modes.map(({ description, icon: Icon, label, value }) => {
        const active = mode === value;

        return (
          <button
            aria-current={active ? "page" : undefined}
            aria-label={`${label}: ${description}`}
            data-active={active}
            key={value}
            onClick={() => onModeChange(value)}
            title={description}
            type="button"
          >
            <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
