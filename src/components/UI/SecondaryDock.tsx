import { Activity, BrainCircuit, GitBranch, History, MapPin, MoonStar, ScanSearch } from "lucide-react";
import type { ReactNode } from "react";

export type SecondaryPanel =
  | "timeline"
  | "memory"
  | "context"
  | "region"
  | "dream"
  | "help"
  | "xray"
  | "lineage"
  | "trace"
  | "retrieval"
  | "timeMachine";

type SecondaryDockProps = {
  activeContextCount: number;
  activePanel: SecondaryPanel | null;
  dreamCount?: number;
  dreamReady?: boolean;
  hasActiveContext: boolean;
  hasDreamReview?: boolean;
  hasMemoryDetails: boolean;
  hasRegionDetails: boolean;
  hasRetrieval?: boolean;
  memoryCount: number;
  onSelect: (panel: SecondaryPanel) => void;
  regionCount: number;
  retrievalCount?: number;
  checkpointCount?: number;
  timelineCount: number;
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
  hasRetrieval = false,
  memoryCount,
  onSelect,
  regionCount,
  retrievalCount = 0,
  checkpointCount = 0,
  timelineCount
}: SecondaryDockProps) {
  const shouldShowDream = hasDreamReview || dreamReady || dreamCount >= 3;
  const items: Array<{
    count: number;
    badge?: string;
    icon: ReactNode;
    id: SecondaryPanel;
    label: string;
  }> = [
    {
      count: timelineCount,
      icon: <History size={14} />,
      id: "timeline",
      label: "Story"
    },
    ...(checkpointCount > 0
      ? [
          {
            count: checkpointCount,
            icon: <GitBranch size={14} />,
            id: "timeMachine" as const,
            label: "Time Machine"
          }
        ]
      : []),
    ...(hasRetrieval
      ? [
          {
            count: retrievalCount,
            icon: <ScanSearch size={14} />,
            id: "retrieval" as const,
            label: "Retrieval MRI"
          }
        ]
      : []),
    ...(shouldShowDream
      ? [
          {
            count: hasDreamReview ? dreamCount : 0,
            badge: hasDreamReview ? undefined : "Ready",
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
            label: "Memories"
          }
        ]
      : []),
    ...(hasActiveContext
      ? [
          {
            count: activeContextCount,
            icon: <Activity size={14} />,
            id: "context" as const,
            label: "Working"
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
          aria-label={item.badge ? `${item.label} ${item.badge}` : item.count > 0 ? `${item.label} ${item.count}` : item.label}
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
          {item.badge ? <b>{item.badge}</b> : null}
        </button>
      ))}
    </nav>
  );
}
