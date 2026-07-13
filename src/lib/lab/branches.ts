import type {
  MaterializedMemoryBranch,
  MemoryBranch,
  MemoryBranchMutation,
  MemoryCheckpoint
} from "@/lib/lab/types";
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

    quarantined.delete(mutation.memoryId);
    replaced.delete(mutation.memoryId);
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
  const changed = new Set([...quarantined, ...added]);

  return deepFreeze({
    checkpoint,
    branch,
    memories,
    loadedMemoryIds,
    diff: {
      quarantinedMemoryIds: [...quarantined],
      replacedMemoryIds: [...replaced],
      addedMemoryIds: [...added],
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

