"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { BRAIN_BASE_ASSET_PATH } from "@/lib/brainAsset";

export function BrainMesh() {
  const { scene: brainScene } = useGLTF(BRAIN_BASE_ASSET_PATH);

  const { lobeBrain, wireBrain } = useMemo(() => {
    const clone = brainScene.clone(true);
    const wireClone = brainScene.clone(true);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#00d4ff",
      wireframe: true,
      transparent: true,
      opacity: 0.018,
      depthWrite: false
    });

    normalizeBrain(clone);
    normalizeBrain(wireClone);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.color.multiplyScalar(0.9);
            material.emissiveIntensity = 0;
            material.roughness = Math.max(material.roughness, 0.66);
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

  return (
    <>
      <primitive object={lobeBrain} />
      <primitive object={wireBrain} />
    </>
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
