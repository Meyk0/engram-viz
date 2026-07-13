import { describe, expect, it } from "vitest";
import { importAgentTrace } from "@/lib/traces/import";
import { traceMemoryOperationCount, traceStepEvents } from "@/lib/traces/types";

const memory = {
  id: "memory-indigo",
  text: "User likes indigo.",
  importance: 0.8,
  region: "hippocampus",
  created_at: "2026-07-13T10:00:00.000Z",
  access_count: 0
};

describe("trace import", () => {
  it("accepts, sanitizes, and deterministically orders a normalized Engram trace", () => {
    const result = importAgentTrace({
      schemaVersion: 1,
      trace: {
        id: "normalized-1",
        name: "Native Engram trace",
        source: { provider: "engram", format: "normalized" },
        metadata: {
          authorization: "Bearer secret",
          nested: { tracing_api_key: "trace-secret", safe: "visible" }
        }
      },
      steps: [
        {
          id: "later",
          index: 42,
          kind: "tool",
          name: "store_memory",
          status: "completed",
          startedAt: "2026-07-13T10:00:02.000Z",
          memoryMappings: []
        },
        {
          id: "earlier",
          index: 9,
          kind: "custom",
          name: "engram.memory",
          status: "completed",
          startedAt: "2026-07-13T10:00:01.000Z",
          input: { authorization: "secret", safe: true },
          memoryMappings: [{
            provenance: "observed",
            event: { type: "store", memory },
            sourcePath: "steps[1]",
            note: "Native event"
          }]
        }
      ]
    });

    expect(result.trace.steps.map((step) => [step.id, step.index])).toEqual([
      ["earlier", 0],
      ["later", 1]
    ]);
    expect(result.trace.trace.metadata).toEqual({ nested: { safe: "visible" } });
    expect(result.trace.steps[0].input).toEqual({ safe: true });
    expect(traceMemoryOperationCount(result.trace)).toBe(1);
  });

  it("imports generic Agents SDK spans without inventing memory operations", () => {
    const result = importAgentTrace({
      items: [
        { object: "trace", id: "trace-generic", workflow_name: "Research agent" },
        {
          object: "trace.span",
          id: "span-agent",
          trace_id: "trace-generic",
          started_at: "2026-07-13T10:00:00Z",
          ended_at: "2026-07-13T10:00:01Z",
          span_data: { type: "agent", name: "Researcher" }
        },
        {
          object: "trace.span",
          id: "span-search",
          trace_id: "trace-generic",
          started_at: "2026-07-13T10:00:01Z",
          ended_at: "2026-07-13T10:00:02Z",
          span_data: {
            type: "function",
            name: "web_search",
            input: "{\"query\":\"memory systems\"}",
            output: "{\"results\":3}"
          }
        },
        {
          object: "trace.span",
          id: "span-generation",
          trace_id: "trace-generic",
          span_data: { type: "generation", name: "Answer" }
        },
        {
          object: "trace.span",
          id: "span-handoff",
          trace_id: "trace-generic",
          span_data: { type: "handoff", name: "Escalate" }
        },
        {
          object: "trace.span",
          id: "span-guardrail",
          trace_id: "trace-generic",
          span_data: { type: "guardrail", name: "Safety" }
        }
      ]
    });

    expect(result.trace.trace).toMatchObject({
      id: "trace-generic",
      name: "Research agent",
      source: { provider: "openai", format: "agents-sdk-export" }
    });
    expect(result.trace.steps.map((step) => step.kind)).toEqual([
      "agent",
      "tool",
      "model",
      "handoff",
      "guardrail"
    ]);
    expect(traceMemoryOperationCount(result.trace)).toBe(0);
    expect(result.warnings[0]).toMatch(/No memory operations were observed/);
  });

  it("marks a valid engram.memory custom span as observed", () => {
    const result = importAgentTrace([
      { type: "trace", id: "trace-observed", workflowName: "Observed memory" },
      {
        type: "trace.span",
        id: "observed-span",
        parentId: "agent-span",
        startedAt: "2026-07-13T10:00:00Z",
        spanData: {
          type: "custom",
          name: "engram.memory",
          input: JSON.stringify({ type: "store", memory })
        }
      }
    ]);

    const mapping = result.trace.steps[0].memoryMappings[0];
    expect(mapping).toMatchObject({
      provenance: "observed",
      sourcePath: "items[1]"
    });
    expect(mapping.event).toEqual({ type: "store", memory });
  });

  it("maps supported Agents memory tools with stable defaults and snake/camel case fields", () => {
    const input = {
      sdkVersion: "0.9.0",
      items: [
        {
          object: "trace",
          id: "trace-tools",
          workflow_name: "Memory agent",
          group_id: "group-1"
        },
        {
          object: "trace.span",
          id: "store-span",
          started_at: "2026-07-13T10:00:00Z",
          ended_at: "2026-07-13T10:00:01Z",
          span_data: {
            type: "function",
            name: "store_memory",
            input: "{\"text\":\"User likes indigo.\"}",
            output: "{}"
          }
        },
        {
          object: "trace.span",
          id: "retrieve-span",
          started_at: "2026-07-13T10:00:02Z",
          spanData: {
            type: "function",
            functionName: "retrieve_memory",
            arguments: "{\"query\":\"favorite color\"}",
            result: "{\"results\":[{\"id\":\"memory-indigo\",\"text\":\"User likes indigo.\"}]}"
          }
        },
        {
          object: "trace.span",
          id: "update-span",
          started_at: "2026-07-13T10:00:03Z",
          span_data: {
            type: "function",
            name: "update_memory",
            input: "{\"memory_id\":\"memory-sf\",\"text\":\"User lives in Oakland.\"}"
          }
        },
        {
          object: "trace.span",
          id: "merge-span",
          started_at: "2026-07-13T10:00:04Z",
          span_data: {
            type: "function",
            name: "consolidate_memories",
            input: "{\"sourceIds\":[\"memory-a\",\"memory-b\"]}",
            output: "{\"added\":{\"id\":\"memory-stable\",\"text\":\"User likes blue hues.\"}}"
          }
        }
      ]
    };

    const first = importAgentTrace(input);
    const second = importAgentTrace(input);
    const events = first.trace.steps.flatMap(traceStepEvents);

    expect(first.trace.trace.source.sdkVersion).toBe("0.9.0");
    expect(events.map((event) => event.type)).toEqual(["store", "retrieve", "store", "consolidate"]);
    expect(events[0]).toMatchObject({
      type: "store",
      memory: {
        text: "User likes indigo.",
        importance: 0.5,
        region: "hippocampus",
        created_at: "2026-07-13T10:00:00.000Z",
        access_count: 0
      }
    });
    expect(events[0]).toEqual(second.trace.steps.flatMap(traceStepEvents)[0]);
    expect(events[1]).toMatchObject({
      type: "retrieve",
      query: "favorite color",
      ids: ["memory-indigo"]
    });
    expect(events[2]).toMatchObject({
      type: "store",
      memory: { supersedes: ["memory-sf"] }
    });
    if (events[2]?.type === "store") expect(events[2].memory.id).not.toBe("memory-sf");
    expect(events[3]).toMatchObject({
      type: "consolidate",
      removed: ["memory-a", "memory-b"],
      added: {
        id: "memory-stable",
        region: "temporal",
        sourceMemoryIds: ["memory-a", "memory-b"]
      }
    });
    expect(first.trace.steps[0].memoryMappings[0]?.note).toMatch(/deterministic import defaults/);
  });

  it("pairs Responses function calls with outputs and maps only memory tools", () => {
    const result = importAgentTrace({
      name: "Responses capture",
      authorization: "Bearer root-secret",
      responses: [
        {
          started_at: "2026-07-13T10:00:00Z",
          ended_at: "2026-07-13T10:00:03Z",
          input: [
            {
              type: "function_call_output",
              call_id: "call-retrieve",
              output: "{\"ids\":[\"memory-indigo\"]}"
            }
          ],
          response: {
            object: "response",
            id: "resp-1",
            output: [
              {
                type: "function_call",
                call_id: "call-search",
                name: "file_search",
                arguments: "{\"query\":\"notes\"}"
              },
              {
                type: "function_call",
                call_id: "call-retrieve",
                name: "retrieve_memory",
                arguments: "{\"query\":\"What color do I love?\",\"authorization\":\"secret\"}"
              }
            ]
          }
        }
      ]
    });

    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.steps[0]).toMatchObject({ name: "file_search", memoryMappings: [] });
    expect(result.trace.steps[1].input).toEqual({ query: "What color do I love?" });
    expect(traceStepEvents(result.trace.steps[1])).toEqual([{
      type: "retrieve",
      query: "What color do I love?",
      ids: ["memory-indigo"]
    }]);
  });

  it("supports a raw Responses object with inline function output", () => {
    const result = importAgentTrace({
      object: "response",
      id: "resp-raw",
      created_at: "2026-07-13T10:00:00Z",
      output: [
        {
          type: "function_call",
          call_id: "call-store",
          name: "store_memory",
          arguments: "{\"memory\":{\"id\":\"memory-coffee\",\"text\":\"User likes coffee.\",\"importance\":0.7}}"
        },
        {
          type: "function_call_output",
          call_id: "call-store",
          output: "{}"
        }
      ]
    });

    expect(result.trace.steps).toHaveLength(1);
    expect(traceStepEvents(result.trace.steps[0])[0]).toMatchObject({
      type: "store",
      memory: { id: "memory-coffee", text: "User likes coffee.", importance: 0.7 }
    });
  });

  it("pairs a function output supplied by a later Responses capture", () => {
    const result = importAgentTrace({
      responses: [
        {
          started_at: "2026-07-13T10:00:00Z",
          response: {
            object: "response",
            id: "resp-call",
            output: [{
              type: "function_call",
              call_id: "call-later-output",
              name: "retrieve_memory",
              arguments: "{\"query\":\"Where do I live?\"}"
            }]
          }
        },
        {
          started_at: "2026-07-13T10:00:01Z",
          input: [{
            type: "function_call_output",
            call_id: "call-later-output",
            output: "{\"memory_ids\":[\"memory-oakland\"]}"
          }],
          response: { object: "response", id: "resp-answer", output: [] }
        }
      ]
    });

    expect(traceStepEvents(result.trace.steps[0])).toEqual([{
      type: "retrieve",
      query: "Where do I live?",
      ids: ["memory-oakland"]
    }]);
  });

  it("strips sensitive keys recursively from metadata, inputs, and outputs", () => {
    const result = importAgentTrace({
      items: [
        {
          object: "trace",
          id: "trace-secrets",
          workflow_name: "Safe import",
          metadata: {
            tracing_api_key: "secret",
            nested: [{ authorization: "Bearer secret", okay: "kept" }]
          }
        },
        {
          object: "trace.span",
          id: "ordinary-tool",
          span_data: {
            type: "function",
            name: "calendar_lookup",
            input: { tracingApiKey: "secret", payload: { Authorization: "secret", safe: 1 } },
            output: { tracing_api_key: "secret", safe: true }
          }
        }
      ]
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain('"authorization"');
    expect(serialized).not.toContain('"tracing_api_key"');
    expect(serialized).not.toContain('"tracingApiKey"');
    expect(result.trace.trace.metadata).toEqual({ nested: [{ okay: "kept" }] });
    expect(result.trace.steps[0].input).toEqual({ payload: { safe: 1 } });
    expect(result.trace.steps[0].output).toEqual({ safe: true });
  });

  it("rejects invalid formats, malformed JSON, oversized text, and too many steps", () => {
    expect(() => importAgentTrace("not-json")).toThrow(/valid JSON/);
    expect(() => importAgentTrace({ hello: "world" })).toThrow(/Unsupported trace format/);
    expect(() => importAgentTrace(JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) })))
      .toThrow(/2 MB/);

    const items = [
      { object: "trace", id: "too-large", workflow_name: "Too many steps" },
      ...Array.from({ length: 1001 }, (_, index) => ({
        object: "trace.span",
        id: `span-${index}`,
        span_data: { type: "agent", name: `Agent ${index}` }
      }))
    ];
    expect(() => importAgentTrace(items)).toThrow(/more than 1000 steps/);
  });
});
