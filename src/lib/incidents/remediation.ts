import type { MemoryIncident, MemoryIncidentIntervention } from "@/lib/incidents/types";

export type SourceRemediationRecipe = {
  provider: string;
  title: string;
  summary: string;
  code: string;
  warning: string;
};

export function buildSourceRemediationRecipe(
  incident: MemoryIncident,
  intervention: MemoryIncidentIntervention
): SourceRemediationRecipe {
  const provider = incident.memories.find((memory) => memory.provider)?.provider ?? "your memory provider";
  const mutation = intervention.mutations[0];
  if (provider === "mem0" && mutation?.type === "supersede") {
    const stale = incident.memories.find((memory) => memory.id === mutation.memoryId);
    return {
      provider: "Mem0",
      title: "Retire the stale Mem0 record",
      summary: "After the branch replay passes, review the stale record and apply the equivalent change in Mem0.",
      code: [
        "// Manual source action after review",
        `await memory.delete(${JSON.stringify(mutation.memoryId)});`,
        `// Current fact retained: ${JSON.stringify(mutation.supersededByMemoryId)}`,
        stale ? `// Removed: ${JSON.stringify(stale.text)}` : ""
      ].filter(Boolean).join("\n"),
      warning: "Engram does not execute this deletion. Confirm scope and retention policy in Mem0 first."
    };
  }
  if (provider === "mem0" && mutation?.type === "include") {
    return {
      provider: "Mem0",
      title: "Adjust selection before prompt assembly",
      summary: "Keep Mem0 search observable, select the expected record, and explicitly record what reaches context.",
      code: [
        "const results = await memory.search(question, { limit: 10 });",
        `const selected = results.results.filter((item) => item.id === ${JSON.stringify(mutation.memoryId)});`,
        "await turn.load(selected.map((item) => item.id));"
      ].join("\n"),
      warning: "This recipe changes application selection policy, not the recorded incident or Mem0 data."
    };
  }
  return {
    provider,
    title: "Apply the verified policy in source",
    summary: "Translate the passing branch into your memory provider or retrieval policy after review.",
    code: `// Verified branch mutation\n${JSON.stringify(intervention.mutations, null, 2)}`,
    warning: "Engram never mutates the source provider automatically in v1."
  };
}
