import { Activity, BrainCircuit, History, MapPin, MessageSquareText, MoonStar } from "lucide-react";
import type { ReactNode } from "react";

export type SecondaryPanel = "timeline" | "transcript" | "memory" | "context" | "region" | "dream";

type SecondaryDockProps = {
  activeContextCount: number;
  activePanel: SecondaryPanel | null;
  dreamCount?: number;
  dreamReady?: boolean;
  hasActiveContext: boolean;
  hasDreamReview?: boolean;
  hasMemoryDetails: boolean;
  hasRegionDetails: boolean;
  memoryCount: number;
  onSelect: (panel: SecondaryPanel) => void;
  regionCount: number;
  timelineCount: number;
  transcriptCount: number;
};

export function SecondaryDock({
  activeContextCount,
  activePanel,
  dreamCount = 0,
  dreamReady,
  hasActiveContext,
  hasDreamReview = false,
  hasMemoryDetails,
  hasRegionDetails,
  memoryCount,
  onSelect,
  regionCount,
  timelineCount,
  transcriptCount
}: SecondaryDockProps) {
  const shouldShowDream = hasDreamReview || dreamReady || dreamCount >= 3;
  const items: Array<{
    count: number;
    icon: ReactNode;
    id: SecondaryPanel;
    label: string;
  }> = [
    {
      count: timelineCount,
      icon: <History size={14} />,
      id: "timeline",
      label: "Timeline"
    },
    {
      count: transcriptCount,
      icon: <MessageSquareText size={14} />,
      id: "transcript",
      label: "Transcript"
    },
    ...(shouldShowDream
      ? [
          {
            count: dreamCount || activeContextCount,
            icon: <MoonStar size={14} />,
            id: "dream" as const,
            label: "Dream"
          }
        ]
      : []),
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
          aria-label={item.count > 0 ? `${item.label} ${item.count}` : item.label}
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
