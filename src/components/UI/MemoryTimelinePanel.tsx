import { X } from "lucide-react";
import {
  buildTimelineSteps,
  getTimelineEntryRegions,
  timelineDemoPrompts,
  type MemoryTimelineEntry,
  type MemoryTimelineStep
} from "@/lib/timeline";

type MemoryTimelinePanelProps = {
  activeEntryId?: string;
  entries: MemoryTimelineEntry[];
  onClearFocus: () => void;
  onClose: () => void;
  onPromptSelect: (prompt: string) => void;
  onSelectEntry: (entry: MemoryTimelineEntry) => void;
  open: boolean;
};

export function MemoryTimelinePanel({
  activeEntryId,
  entries,
  onClearFocus,
  onClose,
  onPromptSelect,
  onSelectEntry,
  open
}: MemoryTimelinePanelProps) {
  if (!open) return null;

  return (
    <aside className="secondary-panel secondary-panel-left memory-timeline-panel" aria-label="Memory timeline">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">{entries.length} turns</div>
          <div className="secondary-panel-title">Timeline</div>
        </div>
        <div className="timeline-header-actions">
          {activeEntryId ? (
            <button className="timeline-clear-focus" type="button" onClick={onClearFocus}>
              Clear focus
            </button>
          ) : null}
          <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close timeline">
            <X size={13} />
          </button>
        </div>
      </div>

      <section className="timeline-script" aria-label="Guided demo script">
        <div className="timeline-script-kicker">Guided demo</div>
        <p>Use these prompts to show store, retrieve, correction, and working memory.</p>
        <div className="timeline-script-prompts">
          {timelineDemoPrompts.map((prompt, index) => (
            <button key={prompt} type="button" onClick={() => onPromptSelect(prompt)}>
              <span>{index + 1}</span>
              {prompt}
            </button>
          ))}
        </div>
        <div className="timeline-script-hint">Dream Mode becomes useful after several related memories exist.</div>
      </section>

      <div className="timeline-entry-list">
        {entries.length === 0 ? (
          <div className="timeline-empty">No turns yet. Pick a demo prompt or tell Engram something durable.</div>
        ) : (
          entries.map((entry, index) => (
            <TimelineEntryCard
              active={activeEntryId === entry.id}
              entry={entry}
              index={index}
              key={entry.id}
              latest={index === entries.length - 1}
              onSelectEntry={onSelectEntry}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function TimelineEntryCard({
  active,
  entry,
  index,
  latest,
  onSelectEntry
}: {
  active: boolean;
  entry: MemoryTimelineEntry;
  index: number;
  latest: boolean;
  onSelectEntry: (entry: MemoryTimelineEntry) => void;
}) {
  const steps = buildTimelineSteps(entry);
  const regions = getTimelineEntryRegions(entry);
  const title = entry.kind === "dream" ? "Dream Mode" : `Turn ${index + 1}`;
  const summary = entry.kind === "dream" ? "Offline memory cleanup" : preview(entry.userText ?? "Conversation turn", 78);

  return (
    <article
      aria-label={entry.kind === "dream" ? "Timeline Dream Mode" : `Timeline turn ${index + 1}`}
      className="timeline-entry"
      data-active={active}
      data-status={entry.status}
    >
      <button className="timeline-entry-focus" type="button" onClick={() => onSelectEntry(entry)}>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <b>{entry.status}</b>
      </button>

      <details open={active || latest || entry.status === "running"}>
        <summary>Story steps</summary>
        <div className="timeline-entry-body">
          {entry.userText ? (
            <div className="timeline-turn-copy">
              <span>YOU</span>
              {entry.userText}
            </div>
          ) : null}
          {entry.assistantText ? (
            <div className="timeline-turn-copy" data-role="assistant">
              <span>AI</span>
              {preview(entry.assistantText, 180)}
            </div>
          ) : null}
          <div className="timeline-region-row">
            {regions.length > 0 ? regions.map((region) => <span data-region={region} key={region}>{regionLabel(region)}</span>) : <span>no brain focus</span>}
          </div>
          {steps.length > 0 ? (
            <ol className="timeline-step-list">
              {steps.map((step) => (
                <TimelineStepItem key={step.id} step={step} />
              ))}
            </ol>
          ) : (
            <div className="timeline-step-empty">Waiting for memory events.</div>
          )}
        </div>
      </details>
    </article>
  );
}

function TimelineStepItem({ step }: { step: MemoryTimelineStep }) {
  return (
    <li className="timeline-step" data-region={step.regions[0]}>
      <strong>{step.label}</strong>
      <span>{step.body}</span>
    </li>
  );
}

function regionLabel(region: string) {
  switch (region) {
    case "prefrontal":
      return "working";
    case "hippocampus":
      return "new";
    case "temporal":
      return "stable";
    default:
      return region;
  }
}

function preview(text: string, max = 120) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trim()}...`;
}
