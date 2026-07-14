import { extractEntities, inferCluster } from "@/lib/memory/turn-planner";
import type {
  MemoryIntegrityEvidence,
  MemoryIntegrityFinding,
  MemoryIntegrityReport,
  MemoryIntegritySeverity
} from "@/lib/integrity/types";
import type { EngramMemory } from "@/types";

const MUTUALLY_EXCLUSIVE_CLUSTERS = new Set([
  "current_location",
  "favorite_color",
  "relationship"
]);

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "API credential", pattern: /\b(?:sk|rk|pk)-[a-z0-9_-]{12,}\b/i },
  { label: "authentication secret", pattern: /\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*(?:is|=|:)\s*["']?[a-z0-9_./+=-]{8,}/i },
  { label: "US Social Security number", pattern: /\b\d{3}-\d{2}-\d{4}\b/ }
];

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|system|developer)\s+instructions?\b/i,
  /\b(?:reveal|print|return|expose)\s+(?:the\s+)?(?:system prompt|developer message|hidden instructions?)\b/i,
  /\b(?:jailbreak|prompt injection|bypass (?:the )?(?:safety|policy|guardrail))\b/i,
  /\bdo not follow (?:the )?(?:system|developer) (?:prompt|instructions?)\b/i
];

export function scanMemoryIntegrity(input: {
  memories: readonly EngramMemory[];
  loadedMemoryIds?: readonly string[];
  now?: Date | string;
}): MemoryIntegrityReport {
  const memories = input.memories.map((memory) => structuredClone(memory));
  const active = memories.filter((memory) => memory.status !== "superseded");
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const findings: MemoryIntegrityFinding[] = [];

  for (const memory of active) {
    const secret = secretLabel(memory);
    if (secret) {
      findings.push(finding({
        rule: "secret_exposure",
        severity: "critical",
        title: "Secret-shaped data stored in memory",
        summary: `${secret} appears in a durable memory and could be recalled into future context.`,
        recommendation: "Quarantine this memory and rotate the credential if it is real.",
        memories: [memory],
        fields: [secretField(memory)]
      }));
    }

    if (hasInstructionInjection(memory)) {
      findings.push(finding({
        rule: "instruction_injection",
        severity: "high",
        title: "Instruction-like memory can steer future turns",
        summary: "The stored text contains a strong prompt-injection pattern, not ordinary user context.",
        recommendation: "Quarantine it or store it as untrusted content outside the instruction path.",
        memories: [memory]
      }));
    }

    if (memory.confidence !== undefined && memory.confidence < 0.55) {
      findings.push(finding({
        rule: "low_confidence",
        severity: "medium",
        title: "Low-confidence memory remains active",
        summary: `Planner confidence is ${Math.round(memory.confidence * 100)}%, below the 55% review threshold.`,
        recommendation: "Verify the fact with the user before relying on it in an answer.",
        memories: [memory],
        fields: ["confidence"]
      }));
    }
  }

  for (const memory of active) {
    const activeSuperseded = (memory.supersedes ?? [])
      .map((id) => byId.get(id))
      .filter((candidate): candidate is EngramMemory => Boolean(candidate && candidate.status !== "superseded"));
    if (activeSuperseded.length > 0) {
      findings.push(finding({
        rule: "active_conflict",
        severity: "high",
        title: "Old and replacement memories are both active",
        summary: "A newer memory explicitly supersedes an older trace, but both remain eligible for recall.",
        recommendation: "Keep the newer fact active and quarantine the superseded trace in a branch.",
        memories: [memory, ...activeSuperseded],
        fields: ["status"]
      }));
    }
  }

  const pairs = memoryPairs(active);
  for (const [left, right] of pairs) {
    if (isExplicitSupersedePair(left, right)) continue;
    if (memoriesConflict(left, right)) {
      findings.push(finding({
        rule: "active_conflict",
        severity: "high",
        title: "Conflicting active memories",
        summary: `Both memories describe a different current value for ${signalLabel(left)}.`,
        recommendation: "Confirm which fact is current, then supersede or quarantine the stale trace.",
        memories: [left, right]
      }));
      continue;
    }
    if (memoriesDuplicate(left, right)) {
      findings.push(finding({
        rule: "duplicate_memory",
        severity: "medium",
        title: "Near-duplicate active memories",
        summary: "Two active traces carry substantially the same durable fact.",
        recommendation: "Review a Dream merge to reduce redundant retrieval candidates.",
        memories: [left, right]
      }));
    }
  }

  const loadedSuperseded = unique(input.loadedMemoryIds ?? [])
    .map((id) => byId.get(id))
    .filter((memory): memory is EngramMemory => Boolean(memory?.status === "superseded"));
  if (loadedSuperseded.length > 0) {
    findings.push(finding({
      rule: "stale_context",
      severity: "critical",
      title: "Retired memory loaded into working context",
      summary: "A superseded trace is present in the current answer context.",
      recommendation: "Exclude retired memories from retrieval before generating the answer.",
      memories: loadedSuperseded,
      fields: ["status"]
    }));
  }

  const missingProvenance = active.filter(
    (memory) => !memory.sourceText?.trim() && !(memory.sourceMemoryIds?.length)
  );
  if (missingProvenance.length > 0) {
    findings.push(finding({
      rule: "missing_provenance",
      severity: "info",
      title: "Source provenance is unavailable",
      summary: `${missingProvenance.length} active ${plural(missingProvenance.length, "memory")} cannot be traced to source text or parent memories.`,
      recommendation: "Capture source text or lineage for future stores so users can audit where each fact came from.",
      memories: missingProvenance.slice(0, 6),
      fields: ["sourceText"]
    }));
  }

  const deduped = dedupeFindings(findings).sort(compareFindings);
  const riskPoints = Math.min(100, deduped.reduce((sum, item) => sum + severityPoints(item.severity), 0));
  const affectedMemoryIds = new Set(deduped.flatMap((item) => item.memoryIds));

  return deepFreeze({
    version: 1,
    scannedAt: toIsoDate(input.now),
    status: deduped.some((item) => item.severity === "critical" || item.severity === "high")
      ? "attention"
      : deduped.some((item) => item.severity === "medium")
        ? "review"
        : "clear",
    riskPoints,
    scannedMemoryCount: memories.length,
    activeMemoryCount: active.length,
    affectedMemoryCount: affectedMemoryIds.size,
    findings: deduped,
    caveat: "Deterministic integrity rules flag observable memory-state risks. They do not prove malicious intent or factual incorrectness."
  });
}

export function countMemoryPairs(memories: readonly EngramMemory[]) {
  const active = memories.filter((memory) => memory.status !== "superseded");
  let duplicatePairs = 0;
  let conflictPairs = 0;
  for (const [left, right] of memoryPairs(active)) {
    if (memoriesConflict(left, right)) conflictPairs += 1;
    else if (memoriesDuplicate(left, right)) duplicatePairs += 1;
  }
  return { conflictPairs, duplicatePairs };
}

function finding(input: {
  rule: MemoryIntegrityFinding["rule"];
  severity: MemoryIntegritySeverity;
  title: string;
  summary: string;
  recommendation: string;
  memories: EngramMemory[];
  fields?: MemoryIntegrityEvidence["field"][];
}): MemoryIntegrityFinding {
  const memoryIds = unique(input.memories.map((memory) => memory.id));
  const fields = input.fields ?? ["text"];
  return {
    id: `${input.rule}-${stableHash(memoryIds.slice().sort().join("|"))}`,
    rule: input.rule,
    severity: input.severity,
    title: input.title,
    summary: input.summary,
    recommendation: input.recommendation,
    memoryIds,
    evidence: input.memories.flatMap((memory) => fields.map((field) => ({
      memoryId: memory.id,
      field,
      excerpt: evidenceExcerpt(memory, field)
    }))),
    provenance: "observed"
  };
}

function secretLabel(memory: EngramMemory) {
  const value = `${memory.text}\n${memory.sourceText ?? ""}`;
  return SECRET_PATTERNS.find(({ pattern }) => pattern.test(value))?.label;
}

function secretField(memory: EngramMemory): MemoryIntegrityEvidence["field"] {
  return SECRET_PATTERNS.some(({ pattern }) => pattern.test(memory.text)) ? "text" : "sourceText";
}

function hasInstructionInjection(memory: EngramMemory) {
  const value = `${memory.text}\n${memory.sourceText ?? ""}`;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

function memoriesConflict(left: EngramMemory, right: EngramMemory) {
  const cluster = sharedSignal(left, right);
  if (!cluster || !MUTUALLY_EXCLUSIVE_CLUSTERS.has(cluster)) return false;
  return canonicalValue(left, cluster) !== canonicalValue(right, cluster);
}

function memoriesDuplicate(left: EngramMemory, right: EngramMemory) {
  if (normalize(left.text) === normalize(right.text)) return true;
  if (!sharedSignal(left, right)) return false;
  const leftWords = contentWords(left.text);
  const rightWords = contentWords(right.text);
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return intersection / union >= 0.72;
}

function sharedSignal(left: EngramMemory, right: EngramMemory) {
  const leftSignal = memorySignal(left);
  return leftSignal && leftSignal === memorySignal(right) ? leftSignal : undefined;
}

function memorySignal(memory: EngramMemory) {
  return memory.cluster ?? inferCluster(memory.text, memory.topic, memory.kind) ?? memory.topic;
}

function canonicalValue(memory: EngramMemory, cluster: string) {
  const entities = (memory.entities ?? extractEntities(memory.text))
    .map(normalize)
    .filter((entity) => entity !== "user")
    .sort();
  if (entities.length > 0) return entities.join("|");
  const text = normalize(memory.text).replace(/\b(actually|now|instead|no longer|not anymore)\b/g, "").trim();
  if (cluster === "favorite_color") {
    return text.replace(/^.*?\b(?:color|colour)\b(?:\s+is)?\s+/, "");
  }
  return text;
}

function isExplicitSupersedePair(left: EngramMemory, right: EngramMemory) {
  return Boolean(left.supersedes?.includes(right.id) || right.supersedes?.includes(left.id));
}

function memoryPairs(memories: readonly EngramMemory[]): Array<[EngramMemory, EngramMemory]> {
  const pairs: Array<[EngramMemory, EngramMemory]> = [];
  for (let left = 0; left < memories.length; left += 1) {
    for (let right = left + 1; right < memories.length; right += 1) {
      const leftMemory = memories[left];
      const rightMemory = memories[right];
      if (leftMemory && rightMemory) pairs.push([leftMemory, rightMemory]);
    }
  }
  return pairs;
}

function evidenceExcerpt(memory: EngramMemory, field: MemoryIntegrityEvidence["field"]) {
  if (field === "status") return memory.status ?? "active";
  if (field === "confidence") return `${Math.round((memory.confidence ?? 0) * 100)}%`;
  const raw = field === "sourceText" ? memory.sourceText ?? "Source text unavailable" : memory.text;
  return redactExcerpt(raw);
}

function redactExcerpt(value: string) {
  let redacted = value;
  SECRET_PATTERNS.forEach(({ pattern }) => {
    redacted = redacted.replace(pattern, "[REDACTED]");
  });
  return redacted.length > 160 ? `${redacted.slice(0, 157)}...` : redacted;
}

function dedupeFindings(findings: MemoryIntegrityFinding[]) {
  return [...new Map(findings.map((item) => [item.id, item])).values()];
}

function compareFindings(left: MemoryIntegrityFinding, right: MemoryIntegrityFinding) {
  const severityOrder: Record<MemoryIntegritySeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  return severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title);
}

function severityPoints(severity: MemoryIntegritySeverity) {
  return { critical: 30, high: 18, medium: 7, info: 0 }[severity];
}

function signalLabel(memory: EngramMemory) {
  return (memorySignal(memory) ?? "the same durable topic").replace(/_/g, " ");
}

function contentWords(value: string) {
  const stop = new Set(["user", "the", "and", "that", "this", "has", "with", "likes", "loves", "prefers", "their"]);
  return new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !stop.has(word)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}

function toIsoDate(now?: Date | string) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string") return new Date(now).toISOString();
  return new Date().toISOString();
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
