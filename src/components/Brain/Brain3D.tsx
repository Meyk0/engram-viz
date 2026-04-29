"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense } from "react";
import { BrainMesh } from "@/components/Brain/BrainMesh";
import { RegionHighlights } from "@/components/Brain/RegionHighlights";
import { RegionLabels } from "@/components/Brain/RegionLabels";
import { Neurons } from "@/components/Brain/Neurons";
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
        <ambientLight intensity={0.34} />
        <pointLight position={[0, 1.8, 2.4]} intensity={3.4} color="#00d4ff" />
        <pointLight position={[-2.4, -0.8, 1.2]} intensity={1.5} color="#a855f7" />
        <pointLight position={[2.6, 0.1, -1.4]} intensity={1.3} color="#3b82f6" />
        <Stars radius={8} depth={18} count={900} factor={2.2} saturation={0} fade speed={0.35} />
        <Suspense fallback={<FallbackBrain />}>
          <BrainMesh />
          <RegionHighlights events={events} />
          <Neurons events={events} />
          <RegionLabels events={events} />
        </Suspense>
        <OrbitControls
          autoRotate
          autoRotateSpeed={0.35}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.7}
          maxDistance={6}
        />
        <EffectComposer>
          <Bloom intensity={0.95} luminanceThreshold={0.18} luminanceSmoothing={0.35} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </section>
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
