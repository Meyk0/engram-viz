"use client";

import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export function BrainMesh() {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/brain.glb");

  const { glassBrain, wireBrain } = useMemo(() => {
    const clone = scene.clone(true);
    const wireClone = scene.clone(true);
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: "#1a2744",
      emissive: "#123a82",
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.72,
      roughness: 0.28,
      metalness: 0.18,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#00d4ff",
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });

    normalizeBrain(clone);
    normalizeBrain(wireClone);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = glassMaterial;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    wireClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = wireMaterial;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return { glassBrain: clone, wireBrain: wireClone };
  }, [scene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.2) * 0.08;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.75) * 0.025;
  });

  return (
    <group ref={group} scale={1.55} rotation={[0.02, -0.28, 0]}>
      <primitive object={glassBrain} />
      <primitive object={wireBrain} />
    </group>
  );
}

useGLTF.preload("/brain.glb");

function normalizeBrain(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxAxis = Math.max(size.x, size.y, size.z);
  const scale = maxAxis > 0 ? 2 / maxAxis : 1;

  object.scale.setScalar(scale);
  object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
}
