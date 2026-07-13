"use client";

import { Html, Line } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { memoryColors } from "@/lib/memoryVisuals";
import { regionBounds } from "@/lib/regions";
import type {
  SemanticLayoutEdge,
  SemanticLayoutSnapshot,
  SemanticMemoryDescriptor,
  Vector3Tuple
} from "@/lib/semantic/types";

type SemanticLayoutView = Pick<SemanticLayoutSnapshot, "nodes" | "edges">;

export type SemanticConstellationProps = {
  activeMemoryIds?: readonly string[];
  layout?: SemanticLayoutView | null;
  memories: readonly SemanticMemoryDescriptor[];
  onMemorySelect?: (memoryId: string) => void;
  retrievedMemoryIds?: readonly string[];
  selectedMemoryId?: string;
};

export type ResolvedSemanticNode = {
  memory: SemanticMemoryDescriptor;
  position: Vector3Tuple;
};

type ResolvedSemanticEdge = SemanticLayoutEdge & {
  source: Vector3Tuple;
  target: Vector3Tuple;
};

const fallbackRadius = 0.42;
const nodeRadius = 0.042;
const semanticSceneScale = 1.35;

export function resolveSemanticNodes(
  memories: readonly SemanticMemoryDescriptor[],
  layout?: SemanticLayoutView | null
): ResolvedSemanticNode[] {
  const visibleMemories = memories.filter((memory) => memory.status !== "superseded");
  const layoutById = new Map(layout?.nodes.map((node) => [node.memoryId, node.position]) ?? []);

  return visibleMemories.map((memory, index) => ({
    memory,
    position: layoutById.get(memory.id) ?? getFallbackPosition(index, visibleMemories.length)
  }));
}

export function SemanticConstellation({
  activeMemoryIds = [],
  layout,
  memories,
  onMemorySelect,
  retrievedMemoryIds = [],
  selectedMemoryId
}: SemanticConstellationProps) {
  const nodes = useMemo(() => resolveSemanticNodes(memories, layout), [layout, memories]);
  const positions = useMemo(
    () => new Map(nodes.map((node) => [node.memory.id, scalePosition(node.position)])),
    [nodes]
  );
  const edges = useMemo(() => resolveEdges(layout?.edges ?? [], positions), [layout, positions]);
  const activeIds = useMemo(() => new Set(activeMemoryIds), [activeMemoryIds]);
  const retrievedIds = useMemo(() => new Set(retrievedMemoryIds), [retrievedMemoryIds]);

  return (
    <group name="semantic-constellation" renderOrder={7}>
      {edges.map((edge) => {
        const emphasized =
          selectedMemoryId === edge.sourceId ||
          selectedMemoryId === edge.targetId ||
          retrievedIds.has(edge.sourceId) ||
          retrievedIds.has(edge.targetId) ||
          activeIds.has(edge.sourceId) ||
          activeIds.has(edge.targetId);

        return <SimilarityEdge edge={edge} emphasized={emphasized} key={`${edge.sourceId}:${edge.targetId}`} />;
      })}
      {nodes.map(({ memory }) => (
        <SemanticMemoryNode
          active={activeIds.has(memory.id)}
          key={memory.id}
          memory={memory}
          onSelect={onMemorySelect}
          position={positions.get(memory.id) ?? [0, 0, 0]}
          retrieved={retrievedIds.has(memory.id)}
          selected={selectedMemoryId === memory.id}
        />
      ))}
    </group>
  );
}

function SimilarityEdge({ edge, emphasized }: { edge: ResolvedSemanticEdge; emphasized: boolean }) {
  const similarity = THREE.MathUtils.clamp(edge.similarity, 0, 1);
  const opacity = emphasized ? 0.3 + similarity * 0.5 : 0.055 + similarity * 0.2;

  return (
    <Line
      points={[edge.source, edge.target]}
      color={emphasized ? memoryColors.prefrontal : "#5c7394"}
      lineWidth={emphasized ? 1.5 + similarity * 1.1 : 0.45 + similarity * 0.7}
      transparent
      opacity={opacity}
      depthWrite={false}
      depthTest={false}
      blending={THREE.AdditiveBlending}
      renderOrder={6}
      userData={{ similarity, sourceId: edge.sourceId, targetId: edge.targetId }}
    />
  );
}

function SemanticMemoryNode({
  active,
  memory,
  onSelect,
  position,
  retrieved,
  selected
}: {
  active: boolean;
  memory: SemanticMemoryDescriptor;
  onSelect?: (memoryId: string) => void;
  position: Vector3Tuple;
  retrieved: boolean;
  selected: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const coreMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const color = memoryColors[memory.region];
  const emphasized = active || retrieved || selected || hovered;

  const targetPosition = useMemo(() => new THREE.Vector3(...position), [position]);
  const initialPosition = regionBounds[memory.region].center;
  const appearance = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    appearance.current = THREE.MathUtils.damp(appearance.current, 1, 4.2, delta);
    group.current.position.lerp(targetPosition, 1 - Math.exp(-delta * 3.4));
    const phase = hashPhase(memory.id);
    const idlePulse = 1 + Math.sin(clock.elapsedTime * 1.7 + phase) * 0.055;
    const activityPulse = active || retrieved ? 1 + Math.sin(clock.elapsedTime * 4.6 + phase) * 0.11 : 1;
    const emphasisScale = selected ? 1.42 : hovered ? 1.25 : active ? 1.22 : retrieved ? 1.16 : 1;
    group.current.scale.setScalar(nodeRadius * idlePulse * activityPulse * emphasisScale * appearance.current);

    if (coreMaterial.current) {
      coreMaterial.current.emissiveIntensity = selected ? 3.2 : active ? 2.7 : retrieved ? 2.2 : hovered ? 1.8 : 1.05;
      coreMaterial.current.opacity = emphasized ? 1 : 0.86;
    }
    if (haloMaterial.current) {
      haloMaterial.current.opacity = selected ? 0.28 : active ? 0.22 : retrieved ? 0.18 : 0.08;
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.(memory.id);
  };

  return (
    <group
      ref={group}
      name={`semantic-memory-${memory.id}`}
      position={initialPosition}
      userData={{ memoryId: memory.id }}
    >
      <mesh
        onClick={handleClick}
        onPointerOut={() => setHovered(false)}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        renderOrder={9}
      >
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial
          ref={coreMaterial}
          color={color}
          emissive={color}
          emissiveIntensity={1.05}
          metalness={0.12}
          roughness={0.22}
          transparent
          opacity={0.86}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh renderOrder={8} scale={2.15}>
        <sphereGeometry args={[1, 20, 12]} />
        <meshBasicMaterial
          ref={haloMaterial}
          color={active ? memoryColors.prefrontal : retrieved ? memoryColors.store : color}
          blending={THREE.AdditiveBlending}
          transparent
          opacity={0.08}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh renderOrder={10} scale={selected ? 1.7 : 1.48}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshBasicMaterial
          color={selected ? "#ffffff" : active ? memoryColors.prefrontal : color}
          wireframe
          transparent
          opacity={selected ? 0.78 : active || retrieved ? 0.42 : 0.18}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <Html
        className="semantic-node-label"
        center={false}
        distanceFactor={5.8}
        position={[1.65, 0.28, 0]}
        style={{ pointerEvents: "none" }}
        zIndexRange={[20, 0]}
      >
        <span data-emphasized={emphasized}>{truncateMemoryLabel(memory.text)}</span>
      </Html>
    </group>
  );
}

function resolveEdges(
  edges: readonly SemanticLayoutEdge[],
  positions: ReadonlyMap<string, Vector3Tuple>
): ResolvedSemanticEdge[] {
  return edges.flatMap((edge) => {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (!source || !target || edge.sourceId === edge.targetId) return [];
    return [{ ...edge, source, target }];
  });
}

function getFallbackPosition(index: number, count: number): Vector3Tuple {
  if (count <= 1) return [0, 0, 0];
  const angle = (index / count) * Math.PI * 2;
  return [Math.cos(angle) * fallbackRadius, Math.sin(angle) * fallbackRadius * 0.72, 0];
}

function hashPhase(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 628) / 100;
}

function scalePosition(position: Vector3Tuple): Vector3Tuple {
  return position.map((coordinate) => coordinate * semanticSceneScale) as Vector3Tuple;
}

function truncateMemoryLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 39)}...` : trimmed;
}
