"use client";

import { Line } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { activeContextCapacity, memoryColors } from "@/lib/memoryVisuals";
import type { SemanticLayoutSnapshot, SemanticMemoryDescriptor, Vector3Tuple } from "@/lib/semantic/types";

type SemanticLayoutView = Pick<SemanticLayoutSnapshot, "nodes">;

export type SemanticContextRibbonProps = {
  layout?: SemanticLayoutView | null;
  loadedMemoryIds: readonly string[];
  memories: readonly SemanticMemoryDescriptor[];
  onMemorySelect?: (memoryId: string) => void;
  selectedMemoryId?: string;
};

export type SemanticContextSlot = {
  index: number;
  memoryId?: string;
  position: Vector3Tuple;
  sourcePosition?: Vector3Tuple;
};

const ribbonY = -0.72;
const ribbonZ = 0.2;
const ribbonWidth = 0.94;
const slotRadius = 0.018;

export function getSemanticContextSlots(
  loadedMemoryIds: readonly string[],
  layout?: SemanticLayoutView | null
): SemanticContextSlot[] {
  const loadedIds = [...new Set(loadedMemoryIds)].slice(0, activeContextCapacity);
  const sourcePositions = new Map(layout?.nodes.map((node) => [node.memoryId, node.position]) ?? []);

  return Array.from({ length: activeContextCapacity }, (_, index) => {
    const x = -ribbonWidth / 2 + (index / (activeContextCapacity - 1)) * ribbonWidth;
    const memoryId = loadedIds[index];
    return {
      index,
      memoryId,
      position: [x, ribbonY, ribbonZ],
      sourcePosition: memoryId ? sourcePositions.get(memoryId) : undefined
    };
  });
}

export function SemanticContextRibbon({
  layout,
  loadedMemoryIds,
  memories,
  onMemorySelect,
  selectedMemoryId
}: SemanticContextRibbonProps) {
  const slots = useMemo(() => getSemanticContextSlots(loadedMemoryIds, layout), [layout, loadedMemoryIds]);
  const memoryById = useMemo(() => new Map(memories.map((memory) => [memory.id, memory])), [memories]);
  const loadedCount = slots.filter((slot) => slot.memoryId).length;

  return (
    <group name="semantic-context-ribbon" renderOrder={8}>
      <Line
        points={[
          [-ribbonWidth / 2 - 0.035, ribbonY, ribbonZ],
          [ribbonWidth / 2 + 0.035, ribbonY, ribbonZ]
        ]}
        color={memoryColors.prefrontal}
        lineWidth={0.8}
        transparent
        opacity={loadedCount > 0 ? 0.34 : 0.14}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
      {slots.map((slot) => {
        const memory = slot.memoryId ? memoryById.get(slot.memoryId) : undefined;
        return (
          <ContextSlot
            key={slot.index}
            memory={memory}
            memoryId={slot.memoryId}
            onSelect={onMemorySelect}
            selected={Boolean(slot.memoryId && slot.memoryId === selectedMemoryId)}
            slot={slot}
          />
        );
      })}
    </group>
  );
}

function ContextSlot({
  memory,
  memoryId,
  onSelect,
  selected,
  slot
}: {
  memory?: SemanticMemoryDescriptor;
  memoryId?: string;
  onSelect?: (memoryId: string) => void;
  selected: boolean;
  slot: SemanticContextSlot;
}) {
  const color = memory ? memoryColors[memory.region] : memoryColors.prefrontal;
  const loaded = Boolean(memoryId);
  const path = useMemo(
    () => (slot.sourcePosition ? getContextPath(slot.sourcePosition, slot.position, slot.index) : undefined),
    [slot.index, slot.position, slot.sourcePosition]
  );

  return (
    <group>
      {loaded && path ? (
        <Line
          points={path}
          color={color}
          lineWidth={selected ? 1.5 : 0.7}
          transparent
          opacity={selected ? 0.66 : 0.24}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          renderOrder={7}
          userData={{ memoryId }}
        />
      ) : null}
      {loaded && memoryId ? (
        <LoadedMemoryCopy
          color={color}
          memoryId={memoryId}
          onSelect={onSelect}
          position={slot.position}
          selected={selected}
        />
      ) : (
        <mesh position={slot.position} renderOrder={8} scale={slotRadius}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshBasicMaterial
            color="#53647c"
            transparent
            opacity={0.2}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      )}
    </group>
  );
}

function LoadedMemoryCopy({
  color,
  memoryId,
  onSelect,
  position,
  selected
}: {
  color: string;
  memoryId: string;
  onSelect?: (memoryId: string) => void;
  position: Vector3Tuple;
  selected: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.8 + hashPhase(memoryId)) * 0.09;
    const emphasis = selected ? 1.38 : hovered ? 1.2 : 1;
    group.current.scale.setScalar(slotRadius * 1.45 * pulse * emphasis);
    if (material.current) material.current.opacity = selected || hovered ? 1 : 0.84;
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.(memoryId);
  };

  return (
    <group ref={group} position={position} userData={{ memoryId }}>
      <mesh
        onClick={handleClick}
        onPointerOut={() => setHovered(false)}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        renderOrder={10}
      >
        <sphereGeometry args={[1, 18, 12]} />
        <meshBasicMaterial
          ref={material}
          color={color}
          blending={THREE.AdditiveBlending}
          transparent
          opacity={0.84}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh scale={selected ? 1.9 : 1.55} renderOrder={9}>
        <sphereGeometry args={[1, 14, 9]} />
        <meshBasicMaterial
          color={selected ? "#ffffff" : memoryColors.prefrontal}
          wireframe
          transparent
          opacity={selected ? 0.68 : 0.3}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

function getContextPath(source: Vector3Tuple, target: Vector3Tuple, index: number): Vector3Tuple[] {
  const start = new THREE.Vector3(...source);
  const end = new THREE.Vector3(...target);
  const midpoint = start.clone().lerp(end, 0.5);
  midpoint.y += 0.08 + (index % 3) * 0.018;
  midpoint.z += 0.08;
  const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
  return curve.getPoints(20).map((point) => [point.x, point.y, point.z]);
}

function hashPhase(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 628) / 100;
}
