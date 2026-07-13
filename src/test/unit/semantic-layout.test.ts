import { describe, expect, it } from "vitest";
import { buildSemanticLayout } from "@/lib/semantic/layout";
import { SEMANTIC_LAYOUT_COORDINATE_BOUND, semanticLayoutSnapshotSchema } from "@/lib/semantic/schema";
import { createTfIdfVectors } from "@/lib/semantic/text";
import type { SemanticLayoutNode, SemanticMemoryDescriptor, Vector3Tuple } from "@/lib/semantic/types";

const memories: SemanticMemoryDescriptor[] = [
  {
    id: "react-visualization",
    text: "The React visualization displays neural memory connections as an interactive graph.",
    topic: "memory visualization",
    kind: "project_fact",
    entities: ["React", "neural graph"],
    region: "hippocampus",
    status: "active"
  },
  {
    id: "garden-recipe",
    text: "The summer pasta recipe uses tomatoes, basil, garlic, and olive oil.",
    topic: "cooking",
    kind: "preference",
    entities: ["pasta", "tomatoes"],
    region: "temporal",
    status: "active"
  },
  {
    id: "three-memory",
    text: "The neural memory graph is implemented with React and an interactive visualization.",
    topic: "memory visualization",
    kind: "project_fact",
    entities: ["React", "neural graph"],
    region: "temporal",
    status: "active"
  }
];

describe("semantic TF-IDF and layout", () => {
  it("builds vectors and positions independently of input order", () => {
    const forwardVectors = createTfIdfVectors(memories);
    const reverseVectors = createTfIdfVectors([...memories].reverse());

    expect(reverseVectors.vocabulary).toEqual(forwardVectors.vocabulary);
    memories.forEach((memory) => {
      expect(reverseVectors.vectors.get(memory.id)).toEqual(forwardVectors.vectors.get(memory.id));
    });

    const options = { generatedAt: "2026-07-13T00:00:00.000Z" };
    const forward = buildSemanticLayout({ memories }, options);
    const reverse = buildSemanticLayout({ memories: [...memories].reverse() }, options);

    expect(reverse).toEqual(forward);
  });

  it("places related memories closer than an unrelated memory", () => {
    const snapshot = buildSemanticLayout({ memories }, { generatedAt: "2026-07-13T00:00:00.000Z" });
    const reactA = position(snapshot.nodes, "react-visualization");
    const reactB = position(snapshot.nodes, "three-memory");
    const recipe = position(snapshot.nodes, "garden-recipe");

    expect(distance(reactA, reactB)).toBeLessThan(distance(reactA, recipe));
    expect(distance(reactA, reactB)).toBeLessThan(distance(reactB, recipe));
  });

  it("returns finite bounded coordinates that satisfy the response schema", () => {
    const snapshot = buildSemanticLayout({ memories });

    expect(() => semanticLayoutSnapshotSchema.parse(snapshot)).not.toThrow();
    snapshot.nodes.flatMap((node) => node.position).forEach((coordinate) => {
      expect(Number.isFinite(coordinate)).toBe(true);
      expect(Math.abs(coordinate)).toBeLessThanOrEqual(SEMANTIC_LAYOUT_COORDINATE_BOUND);
    });
  });

  it("handles valid text containing only ignored words", () => {
    const snapshot = buildSemanticLayout({
      memories: [
        { id: "empty-a", text: "I am the", region: "prefrontal" },
        { id: "empty-b", text: "You are an", region: "hippocampus" }
      ]
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(() => semanticLayoutSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("pins valid prior nodes while positioning a new related node", () => {
    const initial = buildSemanticLayout({ memories: memories.slice(0, 2) });
    const expanded = buildSemanticLayout({ memories, previousNodes: initial.nodes });

    initial.nodes.forEach((priorNode) => {
      expect(position(expanded.nodes, priorNode.memoryId)).toEqual(priorNode.position);
    });
    expect(position(expanded.nodes, "three-memory").every(Number.isFinite)).toBe(true);
  });
});

function position(nodes: SemanticLayoutNode[], memoryId: string): Vector3Tuple {
  const node = nodes.find((candidate) => candidate.memoryId === memoryId);
  if (!node) throw new Error(`Missing node ${memoryId}`);
  return node.position;
}

function distance(a: Vector3Tuple, b: Vector3Tuple) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
