import { Archive, BrainCircuit, X } from "lucide-react";
import { regionExplanations } from "@/lib/explanations";
import type { EngramMemory } from "@/types";

type MemoryLibraryPanelProps = {
  loadedMemoryIds: string[];
  memories: EngramMemory[];
  onClose: () => void;
  onSelectMemory: (id: string) => void;
  open: boolean;
};

export function MemoryLibraryPanel({
  loadedMemoryIds,
  memories,
  onClose,
  onSelectMemory,
  open
}: MemoryLibraryPanelProps) {
  if (!open) return null;

  const active = memories.filter((memory) => memory.status !== "superseded");
  const retired = memories.filter((memory) => memory.status === "superseded");

  return (
    <aside className="secondary-panel secondary-panel-right memory-library" aria-label="Memory library">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">{active.length} active</div>
          <div className="secondary-panel-title">Memories</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close memories">
          <X size={13} />
        </button>
      </div>

      <div className="memory-library-list">
        {active.length === 0 ? (
          <div className="memory-library-empty">No memories yet. Durable facts will appear here.</div>
        ) : (
          active.map((memory) => (
            <MemoryLibraryRow
              active={loadedMemoryIds.includes(memory.id)}
              key={memory.id}
              memory={memory}
              onSelect={() => onSelectMemory(memory.id)}
            />
          ))
        )}

        {retired.length > 0 ? (
          <details className="memory-library-retired">
            <summary>
              <Archive size={12} aria-hidden="true" />
              Retired memories
              <b>{retired.length}</b>
            </summary>
            {retired.map((memory) => (
              <MemoryLibraryRow
                active={false}
                key={memory.id}
                memory={memory}
                onSelect={() => onSelectMemory(memory.id)}
              />
            ))}
          </details>
        ) : null}
      </div>
    </aside>
  );
}

function MemoryLibraryRow({
  active,
  memory,
  onSelect
}: {
  active: boolean;
  memory: EngramMemory;
  onSelect: () => void;
}) {
  const region = regionExplanations[memory.region];

  return (
    <button
      className="memory-library-row"
      data-active={active}
      data-region={memory.region}
      data-retired={memory.status === "superseded"}
      onClick={onSelect}
      type="button"
    >
      <span className="memory-library-node" aria-hidden="true" />
      <span className="memory-library-copy">
        <strong>{memory.text}</strong>
        <small>
          {region.label}
          {memory.topic ? ` · ${memory.topic}` : ""}
        </small>
      </span>
      {active ? <span className="memory-library-used">Used now</span> : <BrainCircuit size={13} aria-hidden="true" />}
    </button>
  );
}
