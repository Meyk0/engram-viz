"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const FIRST_LINE_DELAY_MS = 1_100;
const INTER_TURN_HOLD_MS = 4_200;
const STAGED_LINE_HOLD_MS = 3_000;

export type GuidedDemoPlaybackOptions = {
  prompts: readonly string[];
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  conversationCount: number;
  isStreaming: boolean;
  isTurnInFlight: () => boolean;
  sendTurn: (prompt: string) => Promise<void>;
};

export type GuidedDemoPlayback = {
  active: boolean;
  stagedPrompt: string | null;
  start: () => void;
  stop: () => void;
};

export function useGuidedDemoPlayback({
  prompts,
  message,
  setMessage,
  conversationCount,
  isStreaming,
  isTurnInFlight,
  sendTurn
}: GuidedDemoPlaybackOptions): GuidedDemoPlayback {
  const [active, setActive] = useState(false);
  const [stagedPrompt, setStagedPrompt] = useState<string | null>(null);
  const activeRef = useRef(active);
  const stagedPromptRef = useRef(stagedPrompt);
  const messageRef = useRef(message);
  const setMessageRef = useRef(setMessage);
  const isStreamingRef = useRef(isStreaming);
  const isTurnInFlightRef = useRef(isTurnInFlight);
  const sendTurnRef = useRef(sendTurn);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    activeRef.current = active;
    stagedPromptRef.current = stagedPrompt;
    messageRef.current = message;
    setMessageRef.current = setMessage;
    isStreamingRef.current = isStreaming;
    isTurnInFlightRef.current = isTurnInFlight;
    sendTurnRef.current = sendTurn;
  }, [active, isStreaming, isTurnInFlight, message, sendTurn, setMessage, stagedPrompt]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (stagedPromptRef.current && messageRef.current === stagedPromptRef.current) {
      setMessageRef.current("");
    }
    stagedPromptRef.current = null;
    activeRef.current = false;
    setStagedPrompt(null);
    setActive(false);
  }, []);

  const start = useCallback(() => {
    generationRef.current += 1;
    stagedPromptRef.current = null;
    activeRef.current = true;
    setStagedPrompt(null);
    setActive(true);
  }, []);

  const prompt = prompts[conversationCount];

  useEffect(() => {
    if (!active || isStreaming || isTurnInFlight()) return;

    const generation = generationRef.current;
    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        if (!mountedRef.current || generationRef.current !== generation || !activeRef.current) return;
        callback();
      }, delay);
      return () => window.clearTimeout(timer);
    };

    if (!prompt) {
      return schedule(stop, 0);
    }

    if (message && message !== prompt) return;

    if (stagedPrompt === prompt) {
      if (message !== prompt) return;

      return schedule(() => {
        if (isStreamingRef.current || isTurnInFlightRef.current()) return;
        if (stagedPromptRef.current !== prompt || messageRef.current !== prompt) return;

        stagedPromptRef.current = null;
        setStagedPrompt(null);
        void sendTurnRef.current(prompt);
      }, STAGED_LINE_HOLD_MS);
    }

    const delay = conversationCount === 0 ? FIRST_LINE_DELAY_MS : INTER_TURN_HOLD_MS;
    return schedule(() => {
      if (isStreamingRef.current || isTurnInFlightRef.current()) return;
      if (messageRef.current && messageRef.current !== prompt) return;

      setMessageRef.current(prompt);
      stagedPromptRef.current = prompt;
      setStagedPrompt(prompt);
    }, delay);
  }, [active, conversationCount, isStreaming, isTurnInFlight, message, prompt, stagedPrompt, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  return { active, stagedPrompt, start, stop };
}
