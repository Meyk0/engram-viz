export const sampleAgentTrace = {
  items: [
    {
      object: "trace",
      id: "trace_engram_memory_demo",
      workflow_name: "Personalization agent",
      group_id: "demo-session",
      metadata: { environment: "sample", sdk: "@openai/agents" }
    },
    {
      object: "trace.span",
      id: "span_agent",
      trace_id: "trace_engram_memory_demo",
      started_at: "2026-07-13T18:00:00.000Z",
      ended_at: "2026-07-13T18:00:08.000Z",
      span_data: { type: "agent", agent_id: "coordinator", name: "Coordinator" }
    },
    memorySpan("span_store_color", "2026-07-13T18:00:01.000Z", {
      type: "store",
      memory: {
        id: "trace-memory-indigo",
        text: "User loves the color indigo.",
        importance: 0.86,
        topic: "personal preference",
        region: "hippocampus",
        created_at: "2026-07-13T18:00:01.000Z",
        access_count: 0,
        status: "active"
      }
    }),
    memorySpan("span_store_design", "2026-07-13T18:00:02.000Z", {
      type: "store",
      memory: {
        id: "trace-memory-interface",
        text: "User prefers calm blue interface accents.",
        importance: 0.78,
        topic: "personal preference",
        region: "hippocampus",
        created_at: "2026-07-13T18:00:02.000Z",
        access_count: 0,
        status: "active"
      }
    }),
    memorySpan("span_consolidate", "2026-07-13T18:00:03.000Z", {
      type: "consolidate",
      removed: ["trace-memory-indigo", "trace-memory-interface"],
      added: {
        id: "trace-memory-visual-preference",
        text: "User prefers indigo and calm blue visual design.",
        importance: 0.9,
        topic: "personal preference",
        region: "temporal",
        created_at: "2026-07-13T18:00:03.000Z",
        access_count: 0,
        status: "active",
        sourceMemoryIds: ["trace-memory-indigo", "trace-memory-interface"]
      }
    }),
    {
      object: "trace.span",
      id: "span_generation",
      trace_id: "trace_engram_memory_demo",
      parent_id: "span_agent",
      started_at: "2026-07-13T18:00:04.000Z",
      ended_at: "2026-07-13T18:00:05.000Z",
      span_data: { type: "generation", model: "gpt-5", input: "Design a palette for me." }
    },
    {
      object: "trace.span",
      id: "span_handoff",
      trace_id: "trace_engram_memory_demo",
      parent_id: "span_agent",
      started_at: "2026-07-13T18:00:04.500Z",
      ended_at: "2026-07-13T18:00:04.650Z",
      span_data: {
        type: "handoff",
        name: "Delegate profile recall",
        from_agent: { id: "coordinator", name: "Coordinator" },
        to_agent: { id: "memory-specialist", name: "Memory Specialist" }
      }
    },
    {
      object: "trace.span",
      id: "span_memory_agent",
      trace_id: "trace_engram_memory_demo",
      parent_id: "span_agent",
      started_at: "2026-07-13T18:00:04.700Z",
      ended_at: "2026-07-13T18:00:08.000Z",
      span_data: { type: "agent", agent_id: "memory-specialist", name: "Memory Specialist" }
    },
    memorySpan("span_retrieve", "2026-07-13T18:00:05.000Z", {
      type: "retrieve",
      query: "Design a palette for me.",
      ids: ["trace-memory-visual-preference"],
      retrieval: { provider: "semantic" }
    }, { parentId: "span_memory_agent" }),
    memorySpan("span_load", "2026-07-13T18:00:06.000Z", {
      type: "load",
      ids: ["trace-memory-visual-preference"]
    }, { parentId: "span_memory_agent" }),
    memorySpan("span_fire", "2026-07-13T18:00:07.000Z", {
      type: "fire",
      region: "prefrontal",
      ids: ["trace-memory-visual-preference"]
    }, { parentId: "span_memory_agent" })
  ]
};

function memorySpan(
  id: string,
  startedAt: string,
  event: Record<string, unknown>,
  options: { parentId?: string } = {}
) {
  return {
    object: "trace.span",
    id,
    trace_id: "trace_engram_memory_demo",
    parent_id: options.parentId ?? "span_agent",
    started_at: startedAt,
    ended_at: new Date(Date.parse(startedAt) + 350).toISOString(),
    span_data: {
      type: "custom",
      name: "engram.memory",
      memory_scope: "shared",
      store_id: "profile-memory",
      data: { event }
    }
  };
}
