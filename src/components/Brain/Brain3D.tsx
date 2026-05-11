"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { MapPin, RotateCcw, Trash2 } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Axons } from "@/components/Brain/Axons";
import { BrainMesh } from "@/components/Brain/BrainMesh";
import { MemoryLifecycle } from "@/components/Brain/MemoryLifecycle";
import { RegionHighlights } from "@/components/Brain/RegionHighlights";
import { RegionLabels } from "@/components/Brain/RegionLabels";
import { getBrainAnimationState } from "@/lib/animations";
import { brainCameraProfiles, getBrainCameraProfile } from "@/lib/brainCamera";
import { regionBounds } from "@/lib/regions";
import type { EngramEvent } from "@/types";

type Brain3DProps = {
  events: EngramEvent[];
  onActiveContextSelect?: () => void;
  onMemorySelect?: (id: string) => void;
  onRegionSelect?: (region: keyof typeof regionBounds) => void;
  onResetSession?: () => void;
  responseActive?: boolean;
  selectedMemoryId?: string;
};

export function Brain3D({
  events,
  onActiveContextSelect,
  onMemorySelect,
  onRegionSelect,
  onResetSession,
  responseActive = false,
  selectedMemoryId
}: Brain3DProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const resetView = useCallback(() => {
    controls.current?.reset();
  }, []);

  return (
    <section className="brain-scene" aria-label="Engram 3D brain scene">
      <Canvas
        camera={{ position: brainCameraProfiles.desktop.position, fov: 46, near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        data-testid="brain-canvas"
      >
        <color attach="background" args={["#050510"]} />
        <ResponsiveFog />
        <ambientLight intensity={0.25} />
        <directionalLight position={[1.6, 2.2, 2.6]} intensity={0.52} color="#e7f1ff" />
        <pointLight position={[0, 1.8, 2.4]} intensity={0.2} color="#00d4ff" />
        <pointLight position={[-2.4, -0.8, 1.2]} intensity={0.18} color="#a855f7" />
        <pointLight position={[2.6, 0.1, -1.4]} intensity={0.16} color={regionBounds.temporal.color} />
        <Stars radius={8} depth={18} count={900} factor={2.2} saturation={0} fade speed={0.35} />
        <Suspense fallback={<FallbackBrain />}>
          <BrainRig
            events={events}
            labelsVisible={labelsVisible}
            onActiveContextSelect={onActiveContextSelect}
            onMemorySelect={onMemorySelect}
            onRegionSelect={onRegionSelect}
            responseActive={responseActive}
            selectedMemoryId={selectedMemoryId}
          />
        </Suspense>
        <ResponsiveBrainCamera controls={controls} />
        <ResponsiveOrbitControls controls={controls} />
        <EffectComposer>
          <Bloom intensity={0.045} luminanceThreshold={0.92} luminanceSmoothing={0.58} mipmapBlur />
        </EffectComposer>
      </Canvas>
      <div className="brain-scene-tools" aria-label="Brain view controls">
        <button className="brain-tool-btn" type="button" onClick={resetView} aria-label="Reset brain view" title="Reset view">
          <RotateCcw size={14} />
        </button>
        <button
          aria-label={labelsVisible ? "Hide brain labels" : "Show brain labels"}
          aria-pressed={labelsVisible}
          className="brain-tool-btn"
          data-active={labelsVisible}
          onClick={() => setLabelsVisible((current) => !current)}
          title={labelsVisible ? "Hide labels" : "Show labels"}
          type="button"
        >
          <MapPin size={14} />
        </button>
        <button
          aria-label="Reset demo session"
          className="brain-tool-btn"
          disabled={!onResetSession}
          onClick={onResetSession}
          title="Reset demo session"
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </section>
  );
}

function ResponsiveFog() {
  const { size } = useThree();
  const profile = getBrainCameraProfile(size.width, size.height);

  return <fog attach="fog" args={["#050510", profile.fog[0], profile.fog[1]]} />;
}

function ResponsiveBrainCamera({ controls }: { controls: RefObject<OrbitControlsImpl | null> }) {
  const { camera, size } = useThree();
  const profile = getBrainCameraProfile(size.width, size.height);

  useEffect(() => {
    camera.position.set(...profile.position);
    camera.updateProjectionMatrix();

    const controlsInstance = controls.current;
    if (controlsInstance) {
      controlsInstance.target.set(0, 0, 0);
      controlsInstance.update();
      controlsInstance.saveState();
    }
  }, [camera, controls, profile]);

  return null;
}

function ResponsiveOrbitControls({ controls }: { controls: RefObject<OrbitControlsImpl | null> }) {
  const { size } = useThree();
  const profile = getBrainCameraProfile(size.width, size.height);

  return (
    <OrbitControls
      ref={controls}
      autoRotate
      autoRotateSpeed={0.12}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={profile.minDistance}
      maxDistance={profile.maxDistance}
    />
  );
}

function BrainRig({
  events,
  labelsVisible,
  onActiveContextSelect,
  onMemorySelect,
  onRegionSelect,
  responseActive = false,
  selectedMemoryId
}: Brain3DProps & { labelsVisible: boolean }) {
  const group = useRef<THREE.Group>(null);
  const animation = getBrainAnimationState(events);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const sleep = animation.dream.sleepDimming;
    const driftSpeed = 0.1 - sleep * 0.055;
    const floatSpeed = 0.55 - sleep * 0.28;
    group.current.rotation.y = -1.05 + Math.sin(clock.elapsedTime * driftSpeed) * (0.035 - sleep * 0.018);
    group.current.position.y = Math.sin(clock.elapsedTime * floatSpeed) * (0.018 - sleep * 0.008);
  });

  return (
    <group ref={group} scale={1.58} rotation={[0.02, -1.05, 0]}>
      <BrainMesh />
      <RegionHighlights animation={animation} />
      <Axons animation={animation} />
      <MemoryLifecycle
        events={events}
        dream={animation.dream}
        onActiveContextSelect={onActiveContextSelect}
        onMemorySelect={onMemorySelect}
        responseActive={responseActive}
        selectedMemoryId={selectedMemoryId}
      />
      <DreamQuietField prefrontalQuiet={animation.dream.prefrontalQuiet} sleepDimming={animation.dream.sleepDimming} />
      <HippocampusMarker
        pulse={animation.hippocampusMarker}
        reviewPulse={animation.dream.reviewPulse}
        decayDimming={animation.decayDimming}
      />
      <RegionLabels animation={animation} onRegionSelect={onRegionSelect} visible={labelsVisible} />
    </group>
  );
}

function DreamQuietField({
  prefrontalQuiet,
  sleepDimming
}: {
  prefrontalQuiet: number;
  sleepDimming: number;
}) {
  const prefrontal = useRef<THREE.Mesh>(null);
  const sleepShell = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (prefrontal.current) {
      prefrontal.current.visible = prefrontalQuiet > 0.02;
      prefrontal.current.scale.setScalar(0.11 + prefrontalQuiet * 0.035);
      const material = prefrontal.current.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = prefrontalQuiet * (0.16 + Math.sin(clock.elapsedTime * 1.4) * 0.025);
      }
    }

    if (sleepShell.current) {
      sleepShell.current.visible = sleepDimming > 0.02;
      sleepShell.current.scale.setScalar(0.78 + sleepDimming * 0.06);
      const material = sleepShell.current.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = sleepDimming * 0.045;
      }
    }
  });

  return (
    <group renderOrder={7}>
      <mesh ref={sleepShell} visible={false}>
        <sphereGeometry args={[1, 48, 24]} />
        <meshBasicMaterial
          color="#141a32"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={prefrontal} position={regionBounds.prefrontal.center} scale={0.11} visible={false}>
        <sphereGeometry args={[1, 28, 16]} />
        <meshBasicMaterial
          color="#050510"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

function HippocampusMarker({
  pulse,
  reviewPulse,
  decayDimming
}: {
  pulse: number;
  reviewPulse: number;
  decayDimming: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const material = mesh.current?.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    const reviewWave = reviewPulse * (0.7 + Math.sin(clock.elapsedTime * 2.1) * 0.3);
    material.opacity = Math.max(0.03, 0.05 + pulse * 0.12 + reviewWave * 0.16 - decayDimming * 0.08);
    material.emissiveIntensity = 0.22 + pulse * 0.65 + reviewWave * 0.9 + Math.sin(clock.elapsedTime * 3.8) * 0.03;
    if (mesh.current) {
      mesh.current.scale.set(
        0.095 + pulse * 0.016 + reviewWave * 0.018,
        0.034 + pulse * 0.006 + reviewWave * 0.008,
        0.044 + pulse * 0.008 + reviewWave * 0.009
      );
    }
  });

  return (
    <mesh ref={mesh} position={regionBounds.hippocampus.center} rotation={[0.2, -0.55, 0.1]} scale={[0.095, 0.034, 0.044]} renderOrder={3}>
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
