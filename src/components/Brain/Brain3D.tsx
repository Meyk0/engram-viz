"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { Axons } from "@/components/Brain/Axons";
import { BrainMesh } from "@/components/Brain/BrainMesh";
import { RegionLabels } from "@/components/Brain/RegionLabels";
import { getBrainAnimationState } from "@/lib/animations";
import { regionBounds } from "@/lib/regions";
import type { EngramEvent } from "@/types";

type Brain3DProps = {
  events: EngramEvent[];
};

export function Brain3D({ events }: Brain3DProps) {
  return (
    <section className="brain-scene" aria-label="Engram 3D brain scene">
      <Canvas
        camera={{ position: [0, 0.15, 4.2], fov: 48, near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        data-testid="brain-canvas"
      >
        <color attach="background" args={["#050510"]} />
        <fog attach="fog" args={["#050510", 5, 9]} />
        <ambientLight intensity={0.36} />
        <directionalLight position={[1.6, 2.2, 2.6]} intensity={0.78} color="#e7f1ff" />
        <pointLight position={[0, 1.8, 2.4]} intensity={0.42} color="#00d4ff" />
        <pointLight position={[-2.4, -0.8, 1.2]} intensity={0.42} color="#a855f7" />
        <pointLight position={[2.6, 0.1, -1.4]} intensity={0.32} color="#3b82f6" />
        <Stars radius={8} depth={18} count={900} factor={2.2} saturation={0} fade speed={0.35} />
        <Suspense fallback={<FallbackBrain />}>
          <BrainRig events={events} />
        </Suspense>
        <OrbitControls
          autoRotate
          autoRotateSpeed={0.12}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.7}
          maxDistance={6}
        />
        <EffectComposer>
          <Bloom intensity={0.08} luminanceThreshold={0.9} luminanceSmoothing={0.55} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </section>
  );
}

function BrainRig({ events }: Brain3DProps) {
  const group = useRef<THREE.Group>(null);
  const animation = getBrainAnimationState(events);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = -1.05 + Math.sin(clock.elapsedTime * 0.1) * 0.035;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.55) * 0.018;
  });

  return (
    <group ref={group} scale={1.72} rotation={[0.02, -1.05, 0]}>
      <BrainMesh />
      <Axons animation={animation} />
      <HippocampusMarker pulse={animation.hippocampusMarker} decayDimming={animation.decayDimming} />
      <RegionLabels animation={animation} />
    </group>
  );
}

function HippocampusMarker({ pulse, decayDimming }: { pulse: number; decayDimming: number }) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const material = mesh.current?.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    material.opacity = Math.max(0.2, 0.3 + pulse * 0.22 - decayDimming * 0.18);
    material.emissiveIntensity = 0.45 + pulse * 0.95 + Math.sin(clock.elapsedTime * 3.8) * 0.04;
    if (mesh.current) {
      mesh.current.scale.set(0.12 + pulse * 0.022, 0.045 + pulse * 0.009, 0.055 + pulse * 0.011);
    }
  });

  return (
    <mesh ref={mesh} position={regionBounds.hippocampus.center} rotation={[0.2, -0.55, 0.1]} scale={[0.12, 0.045, 0.055]} renderOrder={3}>
      <sphereGeometry args={[1, 32, 16]} />
      <meshStandardMaterial
        color={regionBounds.hippocampus.color}
        emissive={regionBounds.hippocampus.color}
        emissiveIntensity={0.45}
        transparent
        opacity={0.34}
        roughness={0.32}
        metalness={0.04}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function FallbackBrain() {
  return (
    <mesh>
      <sphereGeometry args={[0.9, 32, 24]} />
      <meshBasicMaterial color="#1a2744" wireframe transparent opacity={0.35} />
    </mesh>
  );
}
