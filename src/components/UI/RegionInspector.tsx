import { X } from "lucide-react";
import { regionExplanations } from "@/lib/explanations";
import { getRegionColor } from "@/lib/regions";
import type { BrainRegion } from "@/types";

type RegionInspectorProps = {
  onClose: () => void;
  open: boolean;
  region: BrainRegion | undefined;
};

export function RegionInspector({ onClose, open, region }: RegionInspectorProps) {
  if (!open || !region) return null;

  const explanation = regionExplanations[region];

  return (
    <aside
      className="secondary-panel secondary-panel-right region-inspector"
      aria-label={`${explanation.label} explanation`}
      data-region={region}
      style={{ color: getRegionColor(region) }}
    >
      <div className="secondary-panel-header region-inspector-header">
        <div>
          <div className="region-inspector-eyebrow">Brain metaphor</div>
          <div className="region-inspector-title">{explanation.label}</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close region explanation">
          <X size={13} />
        </button>
      </div>
      <div className="region-inspector-summary">
        <strong>{explanation.concept}</strong>
        <span>{explanation.description}</span>
      </div>
      <dl className="region-inspector-details">
        <div>
          <dt>HUMAN BRAIN</dt>
          <dd>{explanation.humanAnalogy}</dd>
        </div>
        <div>
          <dt>AI MEMORY</dt>
          <dd>{explanation.llmRole}</dd>
        </div>
        <div>
          <dt>WHAT TO WATCH</dt>
          <dd>{explanation.visualBehavior}</dd>
        </div>
      </dl>
    </aside>
  );
}
