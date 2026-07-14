import { importAgentTrace } from "@/lib/traces/import";
import { redactSensitiveJson } from "@/lib/traces/export";
import type { LiveTraceSnapshot } from "@/lib/traces/types";

const MAX_CHANNELS = 50;
const MAX_ITEMS_PER_CHANNEL = 1000;
const CHANNEL_TTL_MS = 30 * 60 * 1000;

type Listener = (snapshot: LiveTraceSnapshot) => void;
type Channel = {
  items: unknown[];
  listeners: Set<Listener>;
  touchedAt: number;
  snapshot?: LiveTraceSnapshot;
};

export type LiveTraceHub = ReturnType<typeof createLiveTraceHub>;

export function createLiveTraceHub() {
  const channels = new Map<string, Channel>();

  function append(channelId: string, incoming: unknown[]): LiveTraceSnapshot {
    cleanup(channels);
    const channel = channels.get(channelId) ?? {
      items: [],
      listeners: new Set<Listener>(),
      touchedAt: Date.now()
    };
    if (!channels.has(channelId) && channels.size >= MAX_CHANNELS) {
      throw new Error("The live recorder is at its session capacity.");
    }

    const nextItems = [...channel.items];
    for (const rawItem of incoming) {
      const item = redactSensitiveJson(rawItem).value;
      upsertTraceItem(nextItems, item);
    }
    if (nextItems.length > MAX_ITEMS_PER_CHANNEL) {
      throw new Error(`A live trace cannot exceed ${MAX_ITEMS_PER_CHANNEL} items.`);
    }

    const imported = importAgentTrace({ items: nextItems });
    const snapshot: LiveTraceSnapshot = {
      channelId,
      receivedAt: new Date().toISOString(),
      itemCount: nextItems.length,
      trace: imported.trace,
      warnings: imported.warnings
    };
    channel.items = nextItems;
    channel.snapshot = snapshot;
    channel.touchedAt = Date.now();
    channels.set(channelId, channel);
    channel.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  function subscribe(channelId: string, listener: Listener) {
    cleanup(channels);
    const channel = channels.get(channelId) ?? {
      items: [],
      listeners: new Set<Listener>(),
      touchedAt: Date.now()
    };
    channel.listeners.add(listener);
    channel.touchedAt = Date.now();
    channels.set(channelId, channel);
    if (channel.snapshot) listener(channel.snapshot);

    return () => {
      channel.listeners.delete(listener);
      channel.touchedAt = Date.now();
    };
  }

  function snapshot(channelId: string) {
    return channels.get(channelId)?.snapshot;
  }

  return { append, snapshot, subscribe };
}

function upsertTraceItem(items: unknown[], item: unknown) {
  const identity = traceItemIdentity(item);
  if (!identity) {
    items.push(item);
    return;
  }
  const existingIndex = items.findIndex((candidate) => traceItemIdentity(candidate) === identity);
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);
}

function traceItemIdentity(value: unknown) {
  if (!isRecord(value)) return undefined;
  const type = stringValue(value.object) ?? stringValue(value.type);
  const id = stringValue(value.id) ?? stringValue(value.span_id) ?? stringValue(value.trace_id);
  return type && id ? `${type}:${id}` : undefined;
}

function cleanup(channels: Map<string, Channel>) {
  const cutoff = Date.now() - CHANNEL_TTL_MS;
  for (const [id, channel] of channels) {
    if (channel.listeners.size === 0 && channel.touchedAt < cutoff) channels.delete(id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

const globalLiveHub = globalThis as typeof globalThis & {
  __engramLiveTraceHub?: LiveTraceHub;
};

export const liveTraceHub = globalLiveHub.__engramLiveTraceHub ?? createLiveTraceHub();
globalLiveHub.__engramLiveTraceHub = liveTraceHub;
