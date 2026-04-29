"use client";

import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BRAIN_BASE_ASSET_PATH } from "@/lib/brainAsset";
import type { EngramEvent } from "@/types";

const baseRotationY = -1.05;

type BrainMeshProps = {
  events: EngramEvent[];
};

export function BrainMesh({ events: _events }: BrainMeshProps) {
  const group = useRef<THREE.Group>(null);
  const { scene: brainScene } = useGLTF(BRAIN_BASE_ASSET_PATH);

  const { lobeBrain, wireBrain } = useMemo(() => {
    const clone = brainScene.clone(true);
    const wireClone = brainScene.clone(true);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#00d4ff",
      wireframe: true,
      transparent: true,
      opacity: 0.055,
      depthWrite: false
    });

    normalizeBrain(clone);
    normalizeBrain(wireClone);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.roughness = Math.min(material.roughness, 0.58);
            material.metalness = 0.02;
          }
        });
        child.renderOrder = 1;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    wireClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = wireMaterial;
        child.renderOrder = 2;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return { lobeBrain: clone, wireBrain: wireClone };
  }, [brainScene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = baseRotationY + Math.sin(clock.elapsedTime * 0.2) * 0.08;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.75) * 0.025;
  });

  return (
    <group ref={group} scale={1.72} rotation={[0.02, baseRotationY, 0]}>
      <primitive object={lobeBrain} />
      <primitive object={wireBrain} />
    </group>
  );
}

useGLTF.preload(BRAIN_BASE_ASSET_PATH);

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
