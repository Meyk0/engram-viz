"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BRAIN_BASE_ASSET_PATH } from "@/lib/brainAsset";

export function BrainMesh({ semantic = false }: { semantic?: boolean }) {
  const { scene: brainScene } = useGLTF(BRAIN_BASE_ASSET_PATH);
  const group = useRef<THREE.Group>(null);
  const visibility = useRef(semantic ? 0 : 1);

  const { lobeBrain, wireBrain } = useMemo(() => {
    const clone = brainScene.clone(true);
    const wireClone = brainScene.clone(true);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#00d4ff",
      wireframe: true,
      transparent: true,
      opacity: 0.014,
      depthWrite: false
    });
    wireMaterial.userData.engramBaseOpacity = 0.014;

    normalizeBrain(clone);
    normalizeBrain(wireClone);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const dimmedMaterials = materials.map((material) => prepareBrainMaterial(material));
        child.material = Array.isArray(child.material) ? dimmedMaterials : dimmedMaterials[0];
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

  useFrame((_, delta) => {
    visibility.current = THREE.MathUtils.damp(visibility.current, semantic ? 0.1 : 1, 3.8, delta);
    const strength = visibility.current;

    lobeBrain.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material.transparent) return;
        material.opacity = ((material.userData.engramBaseOpacity as number | undefined) ?? 0.36) * strength;
      });
    });
    wireBrain.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        material.opacity = ((material.userData.engramBaseOpacity as number | undefined) ?? 0.014) * strength;
      });
    });

    group.current?.scale.setScalar(1 + (1 - strength) * 0.035);
  });

  return (
    <group ref={group}>
      <primitive object={lobeBrain} />
      <primitive object={wireBrain} />
    </group>
  );
}

useGLTF.preload(BRAIN_BASE_ASSET_PATH);

function prepareBrainMaterial(material: THREE.Material): THREE.Material {
  const next = material.clone();

  if (next instanceof THREE.MeshStandardMaterial) {
    next.color.lerp(new THREE.Color("#050816"), 0.6);
    next.color.multiplyScalar(0.5);
    next.emissive.set("#00040a");
    next.emissiveIntensity = 0;
    next.transparent = true;
    next.opacity = 0.36;
    next.userData.engramBaseOpacity = 0.36;
    next.roughness = Math.max(next.roughness, 0.84);
    next.metalness = 0.015;
    next.depthWrite = true;
    next.needsUpdate = true;
  }

  return next;
}

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
