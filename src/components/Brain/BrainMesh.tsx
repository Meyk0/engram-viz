"use client";

import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export function BrainMesh() {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/brain.glb");

  const brain = useMemo(() => {
    const clone = scene.clone(true);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: "#1a2744",
      emissive: "#0b1d4d",
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.34,
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.45,
      thickness: 0.38,
      ior: 1.18,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = glassMaterial;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return clone;
  }, [scene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.2) * 0.08;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.75) * 0.025;
  });

  return (
    <group ref={group} scale={1.4} rotation={[0.08, 0, 0]}>
      <primitive object={brain} />
      <mesh scale={[1.03, 0.82, 0.78]}>
        <sphereGeometry args={[1.1, 36, 24]} />
        <meshBasicMaterial color="#2a4080" wireframe transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </group>
  );
}

useGLTF.preload("/brain.glb");
