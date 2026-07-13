import { SEMANTIC_LAYOUT_COORDINATE_BOUND } from "@/lib/semantic/schema";
import { cosineSimilarity, createTfIdfVectors } from "@/lib/semantic/text";
import type {
  SemanticLayoutCluster,
  SemanticLayoutEdge,
  SemanticLayoutProvider,
  SemanticLayoutRequest,
  SemanticLayoutSnapshot,
  SemanticMemoryDescriptor,
  Vector3Tuple
} from "@/lib/semantic/types";

const CLUSTER_SIMILARITY_THRESHOLD = 0.16;
const EDGE_SIMILARITY_THRESHOLD = 0.08;
const MAX_EDGES_PER_NODE = 3;
const STRESS_ITERATIONS = 120;
const MIN_TARGET_DISTANCE = 0.12;
const MAX_TARGET_DISTANCE = 1.15;

export type SemanticLayoutOptions = {
  generatedAt?: string;
  model?: string;
  provider?: SemanticLayoutProvider;
  vectors?: ReadonlyMap<string, readonly number[]>;
};

export function buildSemanticLayout(
  request: SemanticLayoutRequest,
  options: SemanticLayoutOptions = {}
): SemanticLayoutSnapshot {
  const memories = canonicalizeSemanticMemories(request.memories);
  assertUniqueIds(memories);
  const provider = options.provider ?? "lexical-fallback";
  const vectors = options.vectors ?? createTfIdfVectors(memories).vectors;
  validateVectors(memories, vectors);

  const similarities = buildSimilarityMatrix(memories, vectors);
  const clusters = buildClusters(memories, similarities);
  const positions = calculatePositions(memories, clusters, similarities, request.previousNodes ?? []);
  const clusterByMemoryId = new Map(
    clusters.flatMap((cluster) => cluster.memberIds.map((memoryId) => [memoryId, cluster.id] as const))
  );

  return {
    version: 1,
    signature: semanticLayoutSignature(memories, provider, options.model),
    provider,
    ...(options.model ? { model: options.model } : {}),
    algorithm: "similarity-force-v1",
    nodes: memories.map((memory, index) => ({
      memoryId: memory.id,
      position: positions[index] ?? [0, 0, 0],
      clusterId: clusterByMemoryId.get(memory.id) ?? `cluster-${stableHash(memory.id)}`
    })),
    edges: buildEdges(memories, similarities),
    clusters,
    generatedAt: options.generatedAt ?? new Date().toISOString()
  };
}

export function canonicalizeSemanticMemories(
  memories: readonly SemanticMemoryDescriptor[]
): SemanticMemoryDescriptor[] {
  return [...memories]
    .map((memory) => ({
      id: memory.id,
      text: memory.text,
      ...(memory.topic ? { topic: memory.topic } : {}),
      ...(memory.kind ? { kind: memory.kind } : {}),
      ...(memory.entities ? { entities: [...memory.entities].sort() } : {}),
      region: memory.region,
      ...(memory.status ? { status: memory.status } : {})
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function semanticLayoutSignature(
  memories: readonly SemanticMemoryDescriptor[],
  provider: SemanticLayoutProvider = "lexical-fallback",
  model?: string
): string {
  const canonical = canonicalizeSemanticMemories(memories).map((memory) => ({
    id: memory.id,
    text: memory.text,
    topic: memory.topic ?? null,
    kind: memory.kind ?? null,
    entities: memory.entities ?? [],
    region: memory.region,
    status: memory.status ?? null
  }));

  return `semantic-v1-${stableHash(JSON.stringify({ provider, model: model ?? null, memories: canonical }))}`;
}

function buildSimilarityMatrix(
  memories: readonly SemanticMemoryDescriptor[],
  vectors: ReadonlyMap<string, readonly number[]>
): number[][] {
  return memories.map((memoryA) =>
    memories.map((memoryB) => {
      if (memoryA.id === memoryB.id) return 1;
      const similarity = cosineSimilarity(vectors.get(memoryA.id) ?? [], vectors.get(memoryB.id) ?? []);
      return clamp(similarity, 0, 1);
    })
  );
}

function buildClusters(
  memories: readonly SemanticMemoryDescriptor[],
  similarities: readonly number[][]
): SemanticLayoutCluster[] {
  const parent = memories.map((_, index) => index);

  for (let left = 0; left < memories.length; left += 1) {
    for (let right = left + 1; right < memories.length; right += 1) {
      if ((similarities[left]?.[right] ?? 0) >= CLUSTER_SIMILARITY_THRESHOLD) {
        union(parent, left, right);
      }
    }
  }

  const membersByRoot = new Map<number, string[]>();
  memories.forEach((memory, index) => {
    const root = find(parent, index);
    const members = membersByRoot.get(root) ?? [];
    members.push(memory.id);
    membersByRoot.set(root, members);
  });

  return [...membersByRoot.values()]
    .map((memberIds) => {
      memberIds.sort();
      return {
        id: `cluster-${stableHash(memberIds.join("|"))}`,
        memberIds
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildEdges(
  memories: readonly SemanticMemoryDescriptor[],
  similarities: readonly number[][]
): SemanticLayoutEdge[] {
  const edges = new Map<string, SemanticLayoutEdge>();

  memories.forEach((memory, sourceIndex) => {
    similarities[sourceIndex]
      ?.map((similarity, targetIndex) => ({ similarity, targetIndex }))
      .filter(
        ({ similarity, targetIndex }) =>
          targetIndex !== sourceIndex && similarity >= EDGE_SIMILARITY_THRESHOLD
      )
      .sort((a, b) => b.similarity - a.similarity || memories[a.targetIndex]!.id.localeCompare(memories[b.targetIndex]!.id))
      .slice(0, MAX_EDGES_PER_NODE)
      .forEach(({ similarity, targetIndex }) => {
        const target = memories[targetIndex]!;
        const [sourceId, targetId] = [memory.id, target.id].sort();
        const key = `${sourceId}\u0000${targetId}`;
        edges.set(key, { sourceId, targetId, similarity: round(similarity) });
      });
  });

  return [...edges.values()].sort(
    (a, b) => a.sourceId.localeCompare(b.sourceId) || a.targetId.localeCompare(b.targetId)
  );
}

function calculatePositions(
  memories: readonly SemanticMemoryDescriptor[],
  clusters: readonly SemanticLayoutCluster[],
  similarities: readonly number[][],
  previousNodes: NonNullable<SemanticLayoutRequest["previousNodes"]>
): Vector3Tuple[] {
  const memoryIndex = new Map(memories.map((memory, index) => [memory.id, index] as const));
  const previousById = new Map(
    previousNodes
      .filter((node) => memoryIndex.has(node.memoryId) && isBoundedPosition(node.position))
      .map((node) => [node.memoryId, [...node.position] as Vector3Tuple] as const)
  );
  const pinned = memories.map((memory) => previousById.has(memory.id));
  const clusterIndex = new Map(clusters.map((cluster, index) => [cluster.id, index] as const));
  const clusterByMemoryId = new Map(
    clusters.flatMap((cluster) => cluster.memberIds.map((memoryId) => [memoryId, cluster] as const))
  );
  const positions = memories.map((memory) => {
    const previous = previousById.get(memory.id);
    if (previous) return previous;

    const relatedPrevious = weightedPreviousPosition(memory.id, memories, similarities, previousById);
    if (relatedPrevious) return add(relatedPrevious, scale(hashDirection(memory.id), 0.05));

    const cluster = clusterByMemoryId.get(memory.id)!;
    const center = clusterCenter(clusterIndex.get(cluster.id) ?? 0, clusters.length);
    if (cluster.memberIds.length === 1) return center;
    return add(center, scale(hashDirection(memory.id), 0.1));
  });

  for (let iteration = 0; iteration < STRESS_ITERATIONS; iteration += 1) {
    const rate = 0.055 * (1 - iteration / (STRESS_ITERATIONS * 1.35));
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        if (pinned[left] && pinned[right]) continue;

        const delta = subtract(positions[right]!, positions[left]!);
        const rawDistance = magnitude(delta);
        const direction = rawDistance > 1e-8
          ? scale(delta, 1 / rawDistance)
          : hashDirection(`${memories[left]!.id}|${memories[right]!.id}`);
        const similarity = similarities[left]?.[right] ?? 0;
        const target = MIN_TARGET_DISTANCE +
          (MAX_TARGET_DISTANCE - MIN_TARGET_DISTANCE) * (1 - similarity) ** 2;
        const correction = clamp((rawDistance - target) * rate, -0.035, 0.035);

        if (!pinned[left] && !pinned[right]) {
          positions[left] = add(positions[left]!, scale(direction, correction / 2));
          positions[right] = add(positions[right]!, scale(direction, -correction / 2));
        } else if (!pinned[left]) {
          positions[left] = add(positions[left]!, scale(direction, correction));
        } else if (!pinned[right]) {
          positions[right] = add(positions[right]!, scale(direction, -correction));
        }
      }
    }

    positions.forEach((position, index) => {
      if (!pinned[index]) positions[index] = boundPosition(position);
    });
  }

  return positions.map((position, index) =>
    pinned[index] ? position : position.map(round) as Vector3Tuple
  );
}

function weightedPreviousPosition(
  memoryId: string,
  memories: readonly SemanticMemoryDescriptor[],
  similarities: readonly number[][],
  previousById: ReadonlyMap<string, Vector3Tuple>
): Vector3Tuple | undefined {
  const index = memories.findIndex((memory) => memory.id === memoryId);
  let weight = 0;
  let position: Vector3Tuple = [0, 0, 0];

  memories.forEach((memory, otherIndex) => {
    const previous = previousById.get(memory.id);
    const similarity = similarities[index]?.[otherIndex] ?? 0;
    if (!previous || similarity < EDGE_SIMILARITY_THRESHOLD) return;
    position = add(position, scale(previous, similarity));
    weight += similarity;
  });

  return weight > 0 ? scale(position, 1 / weight) : undefined;
}

function clusterCenter(index: number, count: number): Vector3Tuple {
  if (count <= 1) return [0, 0, 0];
  const y = 1 - (2 * (index + 0.5)) / count;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(angle) * radial * 0.68, y * 0.68, Math.sin(angle) * radial * 0.68];
}

function hashDirection(value: string): Vector3Tuple {
  const x = hashUnit(`${value}:x`) * 2 - 1;
  const y = hashUnit(`${value}:y`) * 2 - 1;
  const z = hashUnit(`${value}:z`) * 2 - 1;
  const vector: Vector3Tuple = [x, y, z];
  const length = magnitude(vector);
  return length > 1e-8 ? scale(vector, 1 / length) : [1, 0, 0];
}

function validateVectors(
  memories: readonly SemanticMemoryDescriptor[],
  vectors: ReadonlyMap<string, readonly number[]>
) {
  let dimension: number | undefined;
  memories.forEach((memory) => {
    const vector = vectors.get(memory.id);
    if (!vector || vector.length === 0 || !vector.every(Number.isFinite)) {
      throw new Error(`Missing or invalid semantic vector for memory ${memory.id}.`);
    }
    dimension ??= vector.length;
    if (vector.length !== dimension) throw new Error("Semantic vectors must have consistent dimensions.");
  });
}

function assertUniqueIds(memories: readonly SemanticMemoryDescriptor[]) {
  const ids = new Set<string>();
  memories.forEach((memory) => {
    if (ids.has(memory.id)) throw new Error(`Duplicate semantic memory id: ${memory.id}.`);
    ids.add(memory.id);
  });
}

function isBoundedPosition(position: Vector3Tuple): boolean {
  return position.every(
    (coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= SEMANTIC_LAYOUT_COORDINATE_BOUND
  );
}

function boundPosition(position: Vector3Tuple): Vector3Tuple {
  const length = magnitude(position);
  if (length <= SEMANTIC_LAYOUT_COORDINATE_BOUND) return position;
  return scale(position, SEMANTIC_LAYOUT_COORDINATE_BOUND / length);
}

function union(parent: number[], left: number, right: number) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function find(parent: number[], index: number): number {
  let root = index;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[index] !== index) {
    const next = parent[index]!;
    parent[index] = root;
    index = next;
  }
  return root;
}

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vector3Tuple, factor: number): Vector3Tuple {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function magnitude(vector: Vector3Tuple): number {
  return Math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function hashUnit(value: string): number {
  return Number.parseInt(stableHash(value), 16) / 0xffffffff;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
