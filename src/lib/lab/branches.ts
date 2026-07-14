import type {
  MaterializedMemoryBranch,
  MemoryBranch,
  MemoryBranchMutation,
  MemoryCheckpoint
} from "@/lib/lab/types";
import type { TurnRecord } from "@/lib/evidence/types";
import type { EngramMemory } from "@/types";

export function createMemoryBranch(input: {
  checkpoint: MemoryCheckpoint;
  title?: string;
  mutations?: MemoryBranchMutation[];
  id?: string;
  createdAt?: string;
}): MemoryBranch {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return deepFreeze({
    version: 1,
    id: input.id ?? `branch-${stableHash(`${input.checkpoint.id}-${createdAt}`)}`,
    checkpointId: input.checkpoint.id,
    title: input.title?.trim() || "Alternative memory state",
    createdAt,
    mutations: structuredClone(input.mutations ?? [])
  });
}

export function applyMemoryBranch(
  checkpoint: MemoryCheckpoint,
  branch: MemoryBranch
): MaterializedMemoryBranch {
  if (branch.checkpointId !== checkpoint.id) {
    throw new Error("Memory branch does not belong to this checkpoint.");
  }

  const byId = new Map(checkpoint.memories.map((memory) => [memory.id, structuredClone(memory)]));
  const quarantined = new Set<string>();
  const replaced = new Set<string>();
  const added = new Set<string>();
  const included = new Set<string>();
  const superseded = new Set<string>();

  for (const mutation of branch.mutations) {
    if (!byId.has(mutation.memoryId) && mutation.type !== "restore") {
      throw new Error(`Memory branch references unknown memory "${mutation.memoryId}".`);
    }

    if (mutation.type === "quarantine") {
      quarantined.add(mutation.memoryId);
      continue;
    }

    if (mutation.type === "replace") {
      if (mutation.replacement.id === mutation.memoryId) {
        throw new Error("Replacement memory must use a new id.");
      }
      quarantined.add(mutation.memoryId);
      replaced.add(mutation.memoryId);
      byId.set(mutation.replacement.id, structuredClone(mutation.replacement));
      added.add(mutation.replacement.id);
      continue;
    }

    if (mutation.type === "include") {
      included.add(mutation.memoryId);
      continue;
    }

    if (mutation.type === "supersede") {
      const successor = byId.get(mutation.supersededByMemoryId);
      const stale = byId.get(mutation.memoryId);
      if (!successor || !stale) {
        throw new Error("A supersession must reference two memories in the checkpoint.");
      }
      byId.set(mutation.memoryId, {
        ...stale,
        status: "superseded",
        retiredReason: "corrected"
      });
      byId.set(mutation.supersededByMemoryId, {
        ...successor,
        status: "active",
        supersedes: [...new Set([...(successor.supersedes ?? []), mutation.memoryId])]
      });
      quarantined.add(mutation.memoryId);
      superseded.add(mutation.memoryId);
      included.add(mutation.supersededByMemoryId);
      continue;
    }

    quarantined.delete(mutation.memoryId);
    replaced.delete(mutation.memoryId);
    included.delete(mutation.memoryId);
    superseded.delete(mutation.memoryId);
    for (const [id, memory] of byId) {
      if (memory.supersedes?.includes(mutation.memoryId) && added.has(id)) {
        byId.delete(id);
        added.delete(id);
      }
    }
  }

  const memories = [...byId.values()].filter((memory) => !quarantined.has(memory.id));
  const memoryIds = new Set(memories.map((memory) => memory.id));
  const loadedMemoryIds = checkpoint.loadedMemoryIds.filter((id) => memoryIds.has(id));
  const changed = new Set([...quarantined, ...added, ...included, ...superseded]);

  return deepFreeze({
    checkpoint,
    branch,
    memories,
    loadedMemoryIds,
    diff: {
      quarantinedMemoryIds: [...quarantined],
      replacedMemoryIds: [...replaced],
      addedMemoryIds: [...added],
      includedMemoryIds: [...included],
      supersededMemoryIds: [...superseded],
      unchangedMemoryIds: checkpoint.memories
        .map((memory) => memory.id)
        .filter((id) => !changed.has(id))
    }
  });
}

export function createReplacementMemory(input: {
  branchId: string;
  original: EngramMemory;
  text: string;
  createdAt?: string;
}): EngramMemory {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    ...structuredClone(input.original),
    id: `branch-memory-${stableHash(`${input.branchId}-${input.original.id}-${input.text}`)}`,
    text: input.text.trim(),
    created_at: createdAt,
    last_accessed: undefined,
    access_count: 0,
    status: "active",
    retiredReason: undefined,
    supersedes: [input.original.id],
    sourceMemoryIds: [input.original.id]
  };
}

export function branchContextMemories(
  record: TurnRecord,
  branch: MemoryBranch,
  materialized: MaterializedMemoryBranch
): EngramMemory[] {
  const materializedById = new Map(materialized.memories.map((memory) => [memory.id, memory]));
  const replacements = new Map(
    branch.mutations
      .filter((mutation): mutation is Extract<MemoryBranchMutation, { type: "replace" }> =>
        mutation.type === "replace"
      )
      .map((mutation) => [mutation.memoryId, mutation.replacement])
  );
  const excludedIds = new Set(
    branch.mutations
      .filter((mutation) => mutation.type === "quarantine" || mutation.type === "supersede")
      .map((mutation) => mutation.memoryId)
  );
  const includedIds = new Set(
    branch.mutations.flatMap((mutation) => {
      if (mutation.type === "include") return [mutation.memoryId];
      if (mutation.type === "supersede") return [mutation.supersededByMemoryId];
      return [];
    })
  );

  const baseline = record.retrievedMemories.flatMap((memory) => {
    if (excludedIds.has(memory.id)) return [];
    const replacement = replacements.get(memory.id);
    if (replacement && materializedById.has(replacement.id)) {
      return [structuredClone(replacement)];
    }

    const current = materializedById.get(memory.id);
    return current ? [structuredClone(current)] : [];
  });

  const presentIds = new Set(baseline.map((memory) => memory.id));
  const additions = [...includedIds].flatMap((id) => {
    const memory = materializedById.get(id);
    return memory && !presentIds.has(id) ? [structuredClone(memory)] : [];
  });
  return [...baseline, ...additions];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
