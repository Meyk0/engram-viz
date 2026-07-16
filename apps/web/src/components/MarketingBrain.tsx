"use client";

import { useEffect, useState } from "react";
import { Brain3D } from "@/components/Brain/Brain3D";
import type { EngramEvent, EngramMemory } from "@/types";

const staleMemory: EngramMemory = {
  id: "memory-san-francisco",
  text: "User lives in San Francisco.",
  importance: 0.82,
  topic: "current location",
  status: "superseded",
  region: "temporal",
  created_at: "2026-05-02T10:00:00.000Z",
  last_accessed: "2026-05-03T09:15:00.000Z",
  access_count: 4
};

const currentMemory: EngramMemory = {
  id: "memory-oakland",
  text: "User now lives in Oakland.",
  importance: 0.94,
  topic: "current location",
  status: "active",
  supersedes: [staleMemory.id],
  region: "hippocampus",
  created_at: "2026-05-03T09:12:00.000Z",
  access_count: 0
};

const memories = [staleMemory, currentMemory];

const initEvent: EngramEvent = { type: "init", memories };
const retrieveEvent: EngramEvent = {
  type: "retrieve",
  query: "What city do I live in now?",
  ids: [staleMemory.id],
  accessed: [staleMemory]
};
const loadEvent: EngramEvent = { type: "load", ids: [staleMemory.id] };

const eventStages: EngramEvent[][] = [
  [initEvent],
  [{ type: "store", memory: currentMemory }, initEvent],
  [retrieveEvent, initEvent],
  [loadEvent, retrieveEvent, initEvent],
  [
    { type: "fire", ids: [staleMemory.id], region: "prefrontal" },
    loadEvent,
    retrieveEvent,
    initEvent
  ]
];

export function MarketingBrain() {
  const [stage, setStage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const timer = window.setInterval(() => {
      setStage((current) => (current + 1) % eventStages.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const visibleStage = reduceMotion ? 3 : stage;

  return (
    <div className="marketing-brain" data-stage={visibleStage}>
      <Brain3D
        compactReference
        events={eventStages[visibleStage]}
        focusedMemoryIds={visibleStage >= 2 ? [staleMemory.id] : [currentMemory.id]}
        focusedRegions={visibleStage >= 3 ? ["prefrontal", "temporal"] : ["hippocampus"]}
        focusPulseKey={`marketing-${visibleStage}`}
        loadedMemoryIds={visibleStage >= 3 ? [staleMemory.id] : []}
        memories={memories}
        reduceMotion={reduceMotion}
        responseActive={visibleStage === 4}
        retrievedMemoryIds={visibleStage >= 2 ? [staleMemory.id] : []}
      />
      <div className="scene-telemetry" aria-hidden="true">
        <div className="scene-telemetry-heading">
          <span className="status-light" />
          Observed trace / stale-location
        </div>
        <div className="scene-telemetry-row">
          <span>Retrieved</span>
          <strong>San Francisco</strong>
        </div>
        <div className="scene-telemetry-row">
          <span>Ignored</span>
          <strong>Oakland</strong>
        </div>
        <div className="scene-telemetry-row scene-telemetry-alert">
          <span>Answer</span>
          <strong>stale</strong>
        </div>
      </div>
    </div>
  );
}
