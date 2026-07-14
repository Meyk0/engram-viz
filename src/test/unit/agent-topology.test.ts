import { describe, expect, it } from "vitest";
import { importAgentTrace } from "@/lib/traces/import";
import { buildAgentTopology } from "@/lib/topology/build";

describe("agent memory topology", () => {
  it("reconstructs recorded agents, handoff, and shared memory without inventing scope", () => {
    const trace = importAgentTrace({ items: multiAgentItems }).trace;
    const topology = buildAgentTopology(trace);

    expect(topology.agentCount).toBe(2);
    expect(topology.handoffCount).toBe(1);
    expect(topology.nodes).toContainEqual(expect.objectContaining({
      kind: "store",
      scope: "shared",
      storeId: "profile-memory",
      provenance: "observed"
    }));
    expect(topology.edges).toContainEqual(expect.objectContaining({
      kind: "memory_write",
      from: "agent:memory-specialist",
      provenance: "mapped"
    }));
  });

  it("keeps absent memory scope unknown", () => {
    const trace = importAgentTrace({
      items: [
        { object: "trace", id: "unknown-scope", workflow_name: "Agent" },
        {
          object: "trace.span",
          id: "store",
          span_data: { type: "function", name: "store_memory", input: { text: "User likes tea." } }
        }
      ]
    }).trace;
    const topology = buildAgentTopology(trace);

    expect(topology.unknownScopeCount).toBe(1);
    expect(topology.meaningful).toBe(false);
    expect(topology.nodes).not.toContainEqual(expect.objectContaining({ kind: "store", scope: "shared" }));
    expect(topology.edges[0]?.provenance).toBe("unknown");
  });

  it("reveals topology progressively through trace steps", () => {
    const trace = importAgentTrace({ items: multiAgentItems }).trace;
    expect(buildAgentTopology(trace, 0).agentCount).toBe(1);
    expect(buildAgentTopology(trace, 1).handoffCount).toBe(1);
    expect(buildAgentTopology(trace, trace.steps.length - 1).storeCount).toBe(1);
  });
});

const multiAgentItems = [
  { object: "trace", id: "multi-agent", workflow_name: "Profile workflow" },
  {
    object: "trace.span",
    id: "coordinator-span",
    started_at: "2026-01-01T00:00:00.000Z",
    span_data: { type: "agent", agent_id: "coordinator", name: "Coordinator" }
  },
  {
    object: "trace.span",
    id: "handoff-span",
    parent_id: "coordinator-span",
    started_at: "2026-01-01T00:00:01.000Z",
    span_data: {
      type: "handoff",
      name: "Delegate profile memory",
      to_agent: { id: "memory-specialist", name: "Memory Specialist" }
    }
  },
  {
    object: "trace.span",
    id: "specialist-span",
    parent_id: "coordinator-span",
    started_at: "2026-01-01T00:00:02.000Z",
    span_data: { type: "agent", agent_id: "memory-specialist", name: "Memory Specialist" }
  },
  {
    object: "trace.span",
    id: "store-span",
    parent_id: "specialist-span",
    started_at: "2026-01-01T00:00:03.000Z",
    span_data: {
      type: "function",
      name: "store_memory",
      memory_scope: "shared",
      store_id: "profile-memory",
      input: { text: "User likes indigo." }
    }
  }
];
