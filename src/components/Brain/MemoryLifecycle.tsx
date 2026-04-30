"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  activeContextCapacity,
  getActiveMemoryIds,
  getActiveContextFill,
  getLatestConsolidateEvent,
  getLatestFireEvent,
  getLatestLoadEvent,
  getLatestRetrieveEvent,
  getLatestStoreEvent,
  getLoadedMemoryIds,
  getMemoryPosition,
  getMemoryPositionById,
  getMemoryVisuals,
  memoryColors,
  type MemoryVisual
} from "@/lib/memoryVisuals";
import { regionBounds } from "@/lib/regions";
import type { EngramEvent, EngramMemory } from "@/types";

const activeContextCenter: [number, number, number] = [
  regionBounds.prefrontal.center[0],
  regionBounds.prefrontal.center[1] + 0.07,
  regionBounds.prefrontal.center[2] + 0.05
];

type MemoryLifecycleProps = {
  events: EngramEvent[];
  onActiveContextSelect?: () => void;
  onMemorySelect?: (id: string) => void;
  responseActive?: boolean;
  selectedMemoryId?: string;
};

export function MemoryLifecycle({
  events,
  onActiveContextSelect,
  onMemorySelect,
  responseActive = false,
  selectedMemoryId
}: MemoryLifecycleProps) {
  const memories = useMemo(() => getMemoryVisuals(events), [events]);
  const activeIds = useMemo(() => new Set(getActiveMemoryIds(events)), [events]);
  const loadedIds = useMemo(() => getLoadedMemoryIds(events), [events]);
  const latestStore = useMemo(() => getLatestStoreEvent(events), [events]);
  const latestRetrieve = useMemo(() => getLatestRetrieveEvent(events), [events]);
  const latestLoad = useMemo(() => getLatestLoadEvent(events), [events]);
  const latestFire = useMemo(() => getLatestFireEvent(events), [events]);
  const latestConsolidate = useMemo(() => getLatestConsolidateEvent(events), [events]);
  const prefrontalBoltKey = latestRetrieve && latestRetrieve.ids.length > 0 ? latestRetrieve.query : undefined;

  return (
    <group renderOrder={6}>
      <MemoryNeurons
        memories={memories}
        activeIds={activeIds}
        latestStoreId={latestStore?.memory.id}
        onMemorySelect={onMemorySelect}
        selectedMemoryId={selectedMemoryId}
      />
      <StoreComet memory={latestStore?.memory} />
      <PrefrontalBolt triggerKey={prefrontalBoltKey} />
      <ActiveContextWindow
        events={events}
        ids={loadedIds}
        load={latestLoad}
        onSelect={onActiveContextSelect}
        responseActive={responseActive}
      />
      <ConsolidationArc consolidate={latestConsolidate} events={events} />
      <FiredAxons memories={memories} activeIds={activeIds} triggerKey={latestFire ? `${latestFire.region}-${latestFire.ids.join(".")}` : undefined} />
    </group>
  );
}

function MemoryNeurons({
  memories,
  activeIds,
  latestStoreId,
  onMemorySelect,
  selectedMemoryId
}: {
  memories: MemoryVisual[];
  activeIds: Set<string>;
  latestStoreId?: string;
  onMemorySelect?: (id: string) => void;
  selectedMemoryId?: string;
}) {
  return (
    <group>
      {memories.map((visual) => (
        <MemoryNeuron
          active={activeIds.has(visual.memory.id)}
          key={visual.memory.id}
          onSelect={onMemorySelect}
          selected={selectedMemoryId === visual.memory.id}
          storeActive={latestStoreId === visual.memory.id}
          visual={visual}
        />
      ))}
    </group>
  );
}

function MemoryNeuron({
  active,
  onSelect,
  selected,
  storeActive,
  visual
}: {
  active: boolean;
  onSelect?: (id: string) => void;
  selected: boolean;
  storeActive: boolean;
  visual: MemoryVisual;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const baseScale = visual.memory.region === "temporal" ? 0.024 : 0.03;

  useFrame(({ clock }) => {
    if (!mesh.current || !material.current) return;
    const shimmer = Math.sin(clock.elapsedTime * 3.4 + visual.position[0] * 8) * 0.06;
    const pulse = selected ? 0.58 : active ? 0.42 : storeActive ? 0.3 : 0;
    mesh.current.scale.setScalar(baseScale * (1 + shimmer + pulse));
    material.current.emissiveIntensity = 0.45 + pulse * 2.4 + (visual.isHighImportance ? 0.28 : 0);
  });

  return (
    <group position={visual.position}>
      <mesh
        ref={mesh}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(visual.memory.id);
        }}
      >
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial
          ref={material}
          color={visual.color}
          emissive={visual.color}
          emissiveIntensity={0.45}
          transparent
          opacity={active ? 0.96 : 0.76}
          roughness={0.24}
          metalness={0.08}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      {visual.isHighImportance ? (
        <mesh scale={baseScale * 1.72}>
          <sphereGeometry args={[1, 18, 10]} />
          <meshBasicMaterial
            color={memoryColors.importance}
            transparent
            opacity={0.18}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : null}
      {selected ? (
        <mesh scale={baseScale * 2.25}>
          <sphereGeometry args={[1, 22, 12]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.16}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function StoreComet({ memory }: { memory?: EngramMemory }) {
  const comet = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.MeshBasicMaterial>(null);
  const activeId = useRef<string | undefined>(undefined);
  const startTime = useRef(0);
  const target = useMemo(() => (memory ? getMemoryPosition(memory) : undefined), [memory]);
  const curve = useMemo(() => {
    if (!target) return undefined;
    return getArcCurve([0, -0.04, 0.18], target, 0.28);
  }, [target]);
  const geometry = useMemo(() => (curve ? new THREE.TubeGeometry(curve, 36, 0.004, 8, false) : undefined), [curve]);

  useFrame(({ clock }) => {
    if (!memory || !target || !curve || !comet.current) {
      if (comet.current) comet.current.visible = false;
      if (trail.current) trail.current.opacity = 0;
      return;
    }

    if (activeId.current !== memory.id) {
      activeId.current = memory.id;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const progress = Math.min(1, easeOutCubic(elapsed / 0.95));
    const visible = elapsed < 1.25;
    const point = curve.getPoint(progress);
    comet.current.visible = visible;
    comet.current.position.copy(point);
    comet.current.scale.setScalar(0.026 * (1 + Math.sin(progress * Math.PI) * 0.55));

    if (trail.current) {
      trail.current.opacity = visible ? Math.max(0, 0.28 * (1 - progress * 0.65)) : 0;
    }
  });

  if (!geometry) return null;

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={trail}
          color={memoryColors.store}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={comet} visible={false}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshBasicMaterial
          color={memoryColors.store}
          transparent
          opacity={0.92}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function PrefrontalBolt({ triggerKey }: { triggerKey?: string }) {
  const bolt = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const activeKey = useRef<string | undefined>(undefined);
  const startTime = useRef(-10);
  const curve = useMemo(() => {
    const target = new THREE.Vector3(...regionBounds.prefrontal.center);
    const start = target.clone().add(new THREE.Vector3(0, 0.8, 0.12));
    return new THREE.CatmullRomCurve3([start, target]);
  }, []);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 16, 0.006, 8, false), [curve]);

  useFrame(({ clock }) => {
    if (triggerKey && activeKey.current !== triggerKey) {
      activeKey.current = triggerKey;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const intensity = elapsed >= 0 && elapsed < 0.72 ? Math.max(0, 1 - elapsed / 0.72) : 0;

    if (bolt.current) {
      bolt.current.opacity = intensity * 0.82;
    }
    if (ring.current) {
      ring.current.visible = intensity > 0.02;
      ring.current.scale.setScalar(0.11 + intensity * 0.16);
      const material = ring.current.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = intensity * 0.38;
      }
    }
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={bolt}
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ring} position={regionBounds.prefrontal.center} rotation={[Math.PI / 2, 0.2, 0]} visible={false}>
        <torusGeometry args={[1, 0.025, 8, 48]} />
        <meshBasicMaterial
          color={memoryColors.prefrontal}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function ActiveContextWindow({
  events,
  ids,
  load,
  onSelect,
  responseActive
}: {
  events: EngramEvent[];
  ids: string[];
  load?: Extract<EngramEvent, { type: "load" }>;
  onSelect?: () => void;
  responseActive: boolean;
}) {
  const fill = useMemo(() => getActiveContextFill(ids), [ids]);
  const triggerKey = load ? load.ids.join(".") : undefined;
  const loadedIds = ids.slice(0, activeContextCapacity);

  return (
    <group>
      <CapacityRing fill={fill} onSelect={onSelect} responseActive={responseActive} triggerKey={triggerKey} />
      {loadedIds.map((id, index) => (
        <LoadedGhost
          events={events}
          id={id}
          index={index}
          key={id}
          responseActive={responseActive}
          triggerKey={triggerKey}
        />
      ))}
    </group>
  );
}

function CapacityRing({
  fill,
  onSelect,
  responseActive,
  triggerKey
}: {
  fill: ReturnType<typeof getActiveContextFill>;
  onSelect?: () => void;
  responseActive: boolean;
  triggerKey?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const activeKey = useRef<string | undefined>(undefined);
  const startTime = useRef(-10);
  const tickIndexes = useMemo(() => Array.from({ length: fill.capacity }, (_, index) => index), [fill.capacity]);

  useFrame(({ clock }) => {
    if (triggerKey && activeKey.current !== triggerKey) {
      activeKey.current = triggerKey;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const visible = fill.used > 0;
    const fade = responseActive ? 1 : Math.max(0.32, 1 - Math.max(0, elapsed - 1.7) / 1.7);

    if (!group.current) return;
    group.current.visible = visible;
    group.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        const baseOpacity = Number(child.userData.baseOpacity ?? 0.32);
        material.opacity = baseOpacity * fade;
      }
    });
  });

  return (
    <group ref={group} position={activeContextCenter} rotation={[Math.PI / 2, 0.1, 0]} visible={false}>
      <mesh scale={0.145} userData={{ baseOpacity: 0.14 }}>
        <torusGeometry args={[1, 0.018, 8, 72]} />
        <meshBasicMaterial
          color={memoryColors.prefrontal}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {tickIndexes.map((index) => {
        const angle = (index / fill.capacity) * Math.PI * 2;
        const active = index < fill.used;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * 0.145, Math.sin(angle) * 0.145, 0]}
            scale={active ? 0.014 : 0.008}
            userData={{ baseOpacity: active ? 0.72 : 0.18 }}
          >
            <sphereGeometry args={[1, 10, 8]} />
            <meshBasicMaterial
              color={active ? memoryColors.prefrontal : "#6b7b9a"}
              transparent
              opacity={0}
              depthWrite={false}
              depthTest={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}
      {fill.used > 0 ? (
        <Html
          center
          distanceFactor={4.4}
          position={[0.02, -0.18, 0.01]}
          transform={false}
          className="active-context-label"
          style={{ opacity: responseActive ? 0.95 : 0.72 }}
        >
          <button
            aria-label={`Open working memory details: ${fill.used} of ${fill.capacity} loaded`}
            className="active-context-button"
            disabled={!onSelect}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
            type="button"
          >
            <span className="active-context-count">
              {fill.used}/{fill.capacity}
            </span>
            <span>Working Memory</span>
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function LoadedGhost({
  events,
  id,
  index,
  responseActive,
  triggerKey
}: {
  events: EngramEvent[];
  id: string;
  index: number;
  responseActive: boolean;
  triggerKey?: string;
}) {
  const ghost = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const activeKey = useRef<string | undefined>(undefined);
  const startTime = useRef(-10);
  const source = useMemo(() => getMemoryPositionById(events, id), [events, id]);
  const target = useMemo(() => getContextSlotPosition(index), [index]);
  const curve = useMemo(() => getArcCurve(source, target, 0.2), [source, target]);

  useFrame(({ clock }) => {
    if (triggerKey && activeKey.current !== triggerKey) {
      activeKey.current = triggerKey;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const visible = elapsed >= 0 && (responseActive || elapsed < 3.4);
    const travel = easeOutCubic(Math.min(1, elapsed / 0.68));
    const fade = responseActive ? 1 : Math.max(0, 1 - Math.max(0, elapsed - 1.8) / 1.6);

    if (!ghost.current || !material.current) return;
    ghost.current.visible = visible;
    ghost.current.position.copy(curve.getPoint(travel));
    ghost.current.scale.setScalar(0.021 * (1 + Math.sin(Math.min(1, elapsed) * Math.PI) * 0.45));
    material.current.opacity = 0.68 * fade;
  });

  return (
    <mesh ref={ghost} visible={false}>
      <sphereGeometry args={[1, 16, 10]} />
      <meshBasicMaterial
        ref={material}
        color={memoryColors.prefrontal}
        transparent
        opacity={0}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function FiredAxons({
  activeIds,
  memories,
  triggerKey
}: {
  activeIds: Set<string>;
  memories: MemoryVisual[];
  triggerKey?: string;
}) {
  const activeMemories = memories.filter((visual) => activeIds.has(visual.memory.id)).slice(0, 4);

  return (
    <group>
      {activeMemories.map((visual) => (
        <FiredAxon key={visual.memory.id} triggerKey={triggerKey} visual={visual} />
      ))}
    </group>
  );
}

function FiredAxon({ triggerKey, visual }: { triggerKey?: string; visual: MemoryVisual }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const tracer = useRef<THREE.Mesh>(null);
  const activeKey = useRef<string | undefined>(undefined);
  const startTime = useRef(-10);
  const curve = useMemo(() => getArcCurve(visual.position, activeContextCenter, 0.18), [visual.position]);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 36, 0.004, 8, false), [curve]);

  useFrame(({ clock }) => {
    if (triggerKey && activeKey.current !== triggerKey) {
      activeKey.current = triggerKey;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const active = elapsed >= 0 && elapsed < 2;
    const fade = active ? Math.max(0, 1 - elapsed / 2) : 0;

    if (material.current) {
      material.current.opacity = fade * 0.45;
    }

    if (!tracer.current) return;
    tracer.current.visible = active;
    tracer.current.position.copy(curve.getPoint((elapsed * 0.9) % 1));
    tracer.current.scale.setScalar(0.5 + fade * 0.8);
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={material}
          color={memoryColors.prefrontal}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={tracer} visible={false}>
        <sphereGeometry args={[0.022, 14, 8]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.74}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function ConsolidationArc({
  consolidate,
  events
}: {
  consolidate?: Extract<EngramEvent, { type: "consolidate" }>;
  events: EngramEvent[];
}) {
  const sourceGhosts = useRef<THREE.Group>(null);
  const shockwave = useRef<THREE.Mesh>(null);
  const arcMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const tracer = useRef<THREE.Mesh>(null);
  const activeKey = useRef<string | undefined>(undefined);
  const startTime = useRef(-10);
  const sourcePositions = useMemo(
    () => consolidate?.removed.map((id) => getMemoryPositionById(events, id)) ?? [],
    [consolidate, events]
  );
  const target = useMemo(
    () => (consolidate ? getMemoryPosition(consolidate.added) : regionBounds.temporal.center),
    [consolidate]
  );
  const centroid = useMemo(() => getCentroid(sourcePositions), [sourcePositions]);
  const curve = useMemo(() => getArcCurve(centroid, target, 0.32), [centroid, target]);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.006, 8, false), [curve]);
  const triggerKey = consolidate ? `${consolidate.added.id}-${consolidate.removed.join(".")}` : undefined;

  useFrame(({ clock }) => {
    if (triggerKey && activeKey.current !== triggerKey) {
      activeKey.current = triggerKey;
      startTime.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - startTime.current;
    const active = elapsed >= 0 && elapsed < 1.45;
    const mergePhase = active ? Math.max(0, 1 - Math.abs(elapsed - 0.45) / 0.45) : 0;
    const arcPhase = active ? Math.max(0, Math.min(1, (elapsed - 0.45) / 0.72)) : 0;
    const fade = active ? Math.max(0, 1 - elapsed / 1.45) : 0;

    if (sourceGhosts.current) {
      sourceGhosts.current.visible = active && elapsed < 0.68;
      sourceGhosts.current.children.forEach((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = child.material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = Math.max(0, 0.64 * (1 - elapsed / 0.68));
        }
        child.scale.setScalar(0.03 * (1 + mergePhase * 0.85));
      });
    }

    if (shockwave.current) {
      shockwave.current.visible = active && elapsed > 0.34 && elapsed < 0.9;
      shockwave.current.scale.setScalar(0.04 + mergePhase * 0.13);
      const material = shockwave.current.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = mergePhase * 0.16;
      }
    }

    if (arcMaterial.current) {
      arcMaterial.current.opacity = arcPhase > 0 ? Math.max(0, 0.52 * fade) : 0;
    }

    if (tracer.current) {
      tracer.current.visible = active && arcPhase > 0;
      tracer.current.position.copy(curve.getPoint(arcPhase));
      tracer.current.scale.setScalar(0.55 + Math.sin(arcPhase * Math.PI) * 0.8);
    }
  });

  return (
    <group>
      <group ref={sourceGhosts}>
        {sourcePositions.map((position, index) => (
          <mesh key={`${position.join(".")}-${index}`} position={position} scale={0.03}>
            <sphereGeometry args={[1, 16, 10]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0}
              depthWrite={false}
              depthTest={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
      <mesh ref={shockwave} position={centroid} rotation={[Math.PI / 2, 0.2, 0]} visible={false}>
        <torusGeometry args={[1, 0.018, 8, 56]} />
        <meshBasicMaterial
          color={memoryColors.temporal}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={arcMaterial}
          color={memoryColors.temporal}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={tracer} visible={false}>
        <sphereGeometry args={[0.028, 18, 10]} />
        <meshBasicMaterial
          color={memoryColors.temporal}
          transparent
          opacity={0.86}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function getArcCurve(from: [number, number, number], to: [number, number, number], lift: number) {
  const start = new THREE.Vector3(...from);
  const target = new THREE.Vector3(...to);
  const midpoint = start.clone().lerp(target, 0.5);
  midpoint.y += lift;
  midpoint.z += 0.08;
  return new THREE.CatmullRomCurve3([start, midpoint, target]);
}

function getCentroid(positions: [number, number, number][]): [number, number, number] {
  if (positions.length === 0) return regionBounds.hippocampus.center;

  const totals = positions.reduce(
    (sum, position) => [sum[0] + position[0], sum[1] + position[1], sum[2] + position[2]],
    [0, 0, 0]
  );

  return [totals[0] / positions.length, totals[1] / positions.length, totals[2] / positions.length];
}

function getContextSlotPosition(index: number): [number, number, number] {
  const angle = (index / activeContextCapacity) * Math.PI * 2;
  return [
    activeContextCenter[0] + Math.cos(angle) * 0.09,
    activeContextCenter[1] + Math.sin(angle) * 0.045,
    activeContextCenter[2] + 0.045
  ];
}

function easeOutCubic(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return 1 - (1 - clamped) ** 3;
}
