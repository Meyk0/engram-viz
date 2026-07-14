create table public.memory_telemetry_events (
  cursor bigint generated always as identity primary key,
  tenant_id text not null,
  project_id text not null,
  ingest_key_id text not null,
  event_id text not null,
  sequence bigint not null check (sequence >= 0),
  occurred_at timestamptz not null,
  received_at timestamptz not null default timezone('utc'::text, now()),
  payload jsonb not null,
  constraint memory_telemetry_events_tenant_project_event_unique
    unique (tenant_id, project_id, event_id),
  constraint memory_telemetry_events_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint memory_telemetry_events_payload_is_v2
    check (payload @> '{"schemaVersion": 2}'::jsonb)
);

comment on table public.memory_telemetry_events is
  'Append-only, server-ingested Engram memory telemetry. Browser roles have no access.';

create index memory_telemetry_events_scope_cursor_idx
  on public.memory_telemetry_events (tenant_id, project_id, cursor);

create index memory_telemetry_events_scope_occurred_idx
  on public.memory_telemetry_events (tenant_id, project_id, occurred_at desc, cursor desc);

create index memory_telemetry_events_scope_trace_idx
  on public.memory_telemetry_events (tenant_id, project_id, (payload ->> 'traceId'), cursor);

alter table public.memory_telemetry_events enable row level security;
alter table public.memory_telemetry_events force row level security;

revoke all privileges on table public.memory_telemetry_events
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.memory_telemetry_events_cursor_seq
  from public, anon, authenticated, service_role;

grant select, insert on table public.memory_telemetry_events to service_role;
grant usage on sequence public.memory_telemetry_events_cursor_seq to service_role;

-- Intentionally no RLS policies: only the server-held secret/service role may ingest or read.
