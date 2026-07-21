import executor from "./engram.executor.mjs";
import { supportSourceRun } from "./fixture.mjs";

const source = supportSourceRun();
const current = source.memoryState.before.find((memory) => memory.value === "Oakland");
if (!current) throw new Error("The support fixture is missing its current address.");
const result = await executor.replay({
  baseline: source,
  intervention: {
    format: "engram.memory-intervention",
    version: 2,
    id: "load-current-shipping-city",
    targetRunId: source.id,
    label: "Load the current shipping city",
    rationale: "The replacement destination must use the active correction.",
    createdAt: "2026-07-21T12:01:00.000Z",
    operations: [{
      id: "include-current-address",
      type: "context_override",
      action: "include",
      memoryId: current.id,
      reason: "Use the active shipping city."
    }]
  },
  answerAssertion: { type: "contains_all", values: ["Oakland"], forbidden: ["San Francisco"] }
});

if (!result.reproduction.reproduced) throw new Error("The support executor did not reproduce the incident.");
if (result.diff.earliestDivergence !== "selection") throw new Error("The support replay diverged at the wrong stage.");
if (!result.verification.passed) throw new Error(result.verification.failures.join(" "));
console.log("PASS support-agent replay: stale shipping city -> current Oakland selection.");
