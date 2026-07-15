import type { SpawnOptions } from "node:child_process";

export type StartStudioOptions = {
  port?: number;
  hostname?: string;
  environment?: Record<string, string | undefined>;
  stdio?: SpawnOptions["stdio"];
};

export function studioRuntimePath(): string;
export function isStudioRuntimeReady(): Promise<boolean>;
export function startStudio(options?: StartStudioOptions): Promise<void>;
