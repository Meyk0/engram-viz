import type { MemoryTelemetryEvent } from "@/lib/telemetry";

export type TelemetryTenantContext = {
  tenantId: string;
  projectId: string;
  keyId: string;
};

export type StoredMemoryTelemetryEvent = {
  cursor: number;
  tenantId: string;
  projectId: string;
  eventId: string;
  sequence?: number;
  occurredAt: string;
  receivedAt: string;
  event: MemoryTelemetryEvent;
};

export type TelemetryAppendResult = {
  acceptedEventIds: string[];
  duplicateEventIds: string[];
  highWaterCursor: number;
};

export type TelemetryReadResult = {
  events: StoredMemoryTelemetryEvent[];
  highWaterCursor: number;
};

export interface MemoryTelemetryStore {
  append(
    context: TelemetryTenantContext,
    events: readonly MemoryTelemetryEvent[]
  ): Promise<TelemetryAppendResult>;
  read(
    context: TelemetryTenantContext,
    input: { afterCursor: number; limit: number }
  ): Promise<TelemetryReadResult>;
}
