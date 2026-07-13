"use client";

import { useCallback, useEffect, useState } from "react";
import type { NormalizedTrace } from "@/lib/traces/types";

export type TracePlaybackSpeed = 0.5 | 1 | 2;

export function useTracePlayback(trace?: NormalizedTrace) {
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<TracePlaybackSpeed>(1);
  const stepCount = trace?.steps.length ?? 0;

  useEffect(() => {
    if (!playing || !trace || stepCount === 0) return;
    if (stepIndex >= stepCount - 1) return;

    const timer = window.setTimeout(
      () => {
        const nextIndex = Math.min(stepIndex + 1, stepCount - 1);
        setStepIndex(nextIndex);
        if (nextIndex >= stepCount - 1) setPlaying(false);
      },
      playbackDelay(trace, stepIndex, speed)
    );
    return () => window.clearTimeout(timer);
  }, [playing, speed, stepCount, stepIndex, trace]);

  const play = useCallback(() => {
    if (stepCount === 0) return;
    setStepIndex((current) => (current >= stepCount - 1 ? -1 : current));
    setPlaying(true);
  }, [stepCount]);

  const pause = useCallback(() => setPlaying(false), []);
  const next = useCallback(() => {
    setPlaying(false);
    setStepIndex((current) => Math.min(current + 1, stepCount - 1));
  }, [stepCount]);
  const previous = useCallback(() => {
    setPlaying(false);
    setStepIndex((current) => Math.max(-1, current - 1));
  }, []);
  const restart = useCallback(() => {
    setPlaying(false);
    setStepIndex(-1);
  }, []);
  const seek = useCallback(
    (index: number) => {
      setPlaying(false);
      setStepIndex(Math.max(-1, Math.min(index, stepCount - 1)));
    },
    [stepCount]
  );

  return {
    currentStep: stepIndex >= 0 ? trace?.steps[stepIndex] : undefined,
    next,
    pause,
    play,
    playing,
    previous,
    restart,
    seek,
    setSpeed,
    speed,
    stepCount,
    stepIndex
  };
}

function playbackDelay(trace: NormalizedTrace, currentIndex: number, speed: TracePlaybackSpeed) {
  const current = currentIndex >= 0 ? trace.steps[currentIndex] : undefined;
  const next = trace.steps[currentIndex + 1];
  const currentTime = current?.startedAt ? Date.parse(current.startedAt) : Number.NaN;
  const nextTime = next?.startedAt ? Date.parse(next.startedAt) : Number.NaN;
  const sourceGap = Number.isFinite(currentTime) && Number.isFinite(nextTime)
    ? Math.max(0, nextTime - currentTime)
    : 900;
  const compressed = Math.min(1800, Math.max(520, sourceGap * 0.18 || 900));
  return compressed / speed;
}
