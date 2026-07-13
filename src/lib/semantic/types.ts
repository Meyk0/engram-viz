import type { EngramMemory } from "@/types";

export type EngramViewMode = "anatomical" | "semantic";
export type SemanticLayoutProvider = "openai" | "lexical-fallback";
export type Vector3Tuple = [number, number, number];

export type SemanticMemoryDescriptor = Pick<
  EngramMemory,
  "id" | "text" | "topic" | "kind" | "entities" | "region" | "status"
>;

export type SemanticLayoutNode = {
  memoryId: string;
  position: Vector3Tuple;
  clusterId: string;
};

export type SemanticLayoutEdge = {
  sourceId: string;
  targetId: string;
  similarity: number;
};

export type SemanticLayoutCluster = {
  id: string;
  memberIds: string[];
  label?: string;
};

export type SemanticLayoutSnapshot = {
  version: 1;
  signature: string;
  provider: SemanticLayoutProvider;
  model?: string;
  algorithm: "similarity-force-v1";
  nodes: SemanticLayoutNode[];
  edges: SemanticLayoutEdge[];
  clusters: SemanticLayoutCluster[];
  generatedAt: string;
};

export type SemanticLayoutRequest = {
  memories: SemanticMemoryDescriptor[];
  previousNodes?: SemanticLayoutNode[];
};
