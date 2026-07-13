import { Info, Network } from "lucide-react";
import type { SemanticLayoutProvider, SemanticLayoutSnapshot } from "@/lib/semantic/types";

export type SemanticModeHUDProps = {
  snapshot: Pick<SemanticLayoutSnapshot, "clusters" | "nodes" | "provider">;
};

const providerLabels: Record<SemanticLayoutProvider, string> = {
  openai: "OpenAI",
  "lexical-fallback": "Lexical fallback"
};

export function SemanticModeHUD({ snapshot }: SemanticModeHUDProps) {
  return (
    <aside className="semantic-mode-hud" aria-label="Semantic map details">
      <div className="semantic-mode-hud-title">
        <Network aria-hidden="true" size={14} strokeWidth={1.75} />
        <span>Semantic space</span>
      </div>
      <p className="semantic-mode-hud-note">
        <Info aria-hidden="true" size={12} strokeWidth={1.75} />
        <span>Distance approximates semantic similarity.</span>
      </p>
      <dl className="semantic-mode-hud-stats">
        <div>
          <dt>Provider</dt>
          <dd>{providerLabels[snapshot.provider]}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>{snapshot.nodes.length}</dd>
        </div>
        <div>
          <dt>Clusters</dt>
          <dd>{snapshot.clusters.length}</dd>
        </div>
      </dl>
    </aside>
  );
}
