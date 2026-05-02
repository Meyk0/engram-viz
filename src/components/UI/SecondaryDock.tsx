import { Activity, BrainCircuit, MapPin, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";

export type SecondaryPanel = "transcript" | "memory" | "context" | "region";

type SecondaryDockProps = {
  activeContextCount: number;
  activePanel: SecondaryPanel | null;
  hasActiveContext: boolean;
  hasMemoryDetails: boolean;
  hasRegionDetails: boolean;
  memoryCount: number;
  onSelect: (panel: SecondaryPanel) => void;
  regionCount: number;
  transcriptCount: number;
};

export function SecondaryDock({
  activeContextCount,
  activePanel,
  hasActiveContext,
  hasMemoryDetails,
  hasRegionDetails,
  memoryCount,
  onSelect,
  regionCount,
  transcriptCount
}: SecondaryDockProps) {
  const items: Array<{
    count: number;
    icon: ReactNode;
    id: SecondaryPanel;
    label: string;
  }> = [
    {
      count: transcriptCount,
      icon: <MessageSquareText size={14} />,
      id: "transcript",
      label: "Transcript"
    },
    ...(hasMemoryDetails
      ? [
          {
            count: memoryCount,
            icon: <BrainCircuit size={14} />,
            id: "memory" as const,
            label: "Memory"
          }
        ]
      : []),
    ...(hasActiveContext
      ? [
          {
            count: activeContextCount,
            icon: <Activity size={14} />,
            id: "context" as const,
            label: "Context"
          }
        ]
      : []),
    ...(hasRegionDetails
      ? [
          {
            count: regionCount,
            icon: <MapPin size={14} />,
            id: "region" as const,
            label: "Region"
          }
        ]
      : [])
  ];

  return (
    <nav className="secondary-dock" aria-label="Secondary views">
      {items.map((item) => (
        <button
          aria-pressed={activePanel === item.id}
          className="secondary-dock-btn"
          data-active={activePanel === item.id}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
          {item.count > 0 ? <b>{item.count}</b> : null}
        </button>
      ))}
    </nav>
  );
}
