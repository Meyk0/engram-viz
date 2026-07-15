import { createMemoryTelemetryStoreFromEnv } from "@/lib/ingest/store";
import type { MemoryTelemetryStore } from "@/lib/ingest/types";
import {
  FileAgentTurnStore,
  InMemoryAgentTurnStore,
  type AgentTurnStore
} from "@/lib/turns/store";

const runtimeStores = globalThis as typeof globalThis & {
  __engramMemoryTelemetryStore?: MemoryTelemetryStore;
  __engramAgentTurnStore?: AgentTurnStore;
};

export function getMemoryTelemetryStore(): MemoryTelemetryStore {
  runtimeStores.__engramMemoryTelemetryStore ??= createMemoryTelemetryStoreFromEnv();
  return runtimeStores.__engramMemoryTelemetryStore;
}

export function getAgentTurnStore(): AgentTurnStore {
  runtimeStores.__engramAgentTurnStore ??= process.env.ENGRAM_LOCAL_DATA_DIR?.trim()
    ? new FileAgentTurnStore(process.env.ENGRAM_LOCAL_DATA_DIR)
    : new InMemoryAgentTurnStore();
  return runtimeStores.__engramAgentTurnStore;
}
