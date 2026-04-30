"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  getActiveMemoryIds,
  getLatestFireEvent,
  getLatestRetrieveEvent,
  getLatestStoreEvent,
  getMemoryPosition,
  getMemoryVisuals,
  memoryColors,
  type MemoryVisual
} from "@/lib/memoryVisuals";
import { regionBounds } from "@/lib/regions";
import type { EngramEvent, EngramMemory } from "@/types";

type MemoryLifecycleProps = {
  events: EngramEvent[];
};

export function MemoryLifecycle({ events }: MemoryLifecycleProps) {
  const memories = useMemo(() => getMemoryVisuals(events), [events]);
  const activeIds = useMemo(() => new Set(getActiveMemoryIds(events)), [events]);
  const latestStore = useMemo(() => getLatestStoreEvent(events), [events]);
  const latestRetrieve = useMemo(() => getLatestRetrieveEvent(events), [events]);
  const latestFire = useMemo(() => getLatestFireEvent(events), [events]);

  return (
    <group renderOrder={6}>
      <MemoryNeurons memories={memories} activeIds={activeIds} latestStoreId={latestStore?.memory.id} />
      <StoreComet memory={latestStore?.memory} />
      <PrefrontalBolt triggerKey={latestRetrieve?.query} />
      <FiredAxons memories={memories} activeIds={activeIds} triggerKey={latestFire ? `${latestFire.region}-${latestFire.ids.join(".")}` : undefined} />
    </group>
  );
}

function MemoryNeurons({
  memories,
  activeIds,
  latestStoreId
}: {
  memories: MemoryVisual[];
  activeIds: Set<string>;
  latestStoreId?: string;
}) {
  return (
    <group>
      {memories.map((visual) => (
        <MemoryNeuron
          active={activeIds.has(visual.memory.id)}
          key={visual.memory.id}
          storeActive={latestStoreId === visual.memory.id}
          visual={visual}
        />
      ))}
    </group>
  );
}

function MemoryNeuron({
  active,
  storeActive,
  visual
}: {
  active: boolean;
  storeActive: boolean;
  visual: MemoryVisual;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const baseScale = visual.memory.region === "temporal" ? 0.024 : 0.03;

  useFrame(({ clock }) => {
    if (!mesh.current || !material.current) return;
    const shimmer = Math.sin(clock.elapsedTime * 3.4 + visual.position[0] * 8) * 0.06;
    const pulse = active ? 0.42 : storeActive ? 0.3 : 0;
    mesh.current.scale.setScalar(baseScale * (1 + shimmer + pulse));
    material.current.emissiveIntensity = 0.45 + pulse * 2.4 + (visual.isHighImportance ? 0.28 : 0);
  });

  return (
    <group position={visual.position}>
      <mesh ref={mesh}>
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
  const curve = useMemo(() => getArcCurve(visual.position, regionBounds.prefrontal.center, 0.18), [visual.position]);
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

function getArcCurve(from: [number, number, number], to: [number, number, number], lift: number) {
  const start = new THREE.Vector3(...from);
  const target = new THREE.Vector3(...to);
  const midpoint = start.clone().lerp(target, 0.5);
  midpoint.y += lift;
  midpoint.z += 0.08;
  return new THREE.CatmullRomCurve3([start, midpoint, target]);
}

function easeOutCubic(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return 1 - (1 - clamped) ** 3;
}
