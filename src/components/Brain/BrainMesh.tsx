"use client";

import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BRAIN_BASE_ASSET_PATH, BRAIN_REGION_ASSET_PATH, getRegionFromMeshName } from "@/lib/brainAsset";
import { getRegionPulseStrength, regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent } from "@/types";

const baseRotationY = -1.05;
const regionScale = 0.44;

type BrainMeshProps = {
  events: EngramEvent[];
};

export function BrainMesh({ events }: BrainMeshProps) {
  const group = useRef<THREE.Group>(null);
  const { scene: brainScene } = useGLTF(BRAIN_BASE_ASSET_PATH);
  const { scene: regionScene } = useGLTF(BRAIN_REGION_ASSET_PATH);

  const { glassBrain, regionBrain, wireBrain, regionMeshes } = useMemo(() => {
    const clone = brainScene.clone(true);
    const wireClone = brainScene.clone(true);
    const regionClone = regionScene.clone(true);
    const regionRefs: Partial<Record<BrainRegion, THREE.Mesh[]>> = {};
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: "#1a2744",
      emissive: "#123a82",
      emissiveIntensity: 0.42,
      transparent: true,
      opacity: 0.42,
      roughness: 0.3,
      metalness: 0.12,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#00d4ff",
      wireframe: true,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    });
    const regionMaterials = Object.fromEntries(
      (Object.keys(regionBounds) as BrainRegion[]).map((region) => [
        region,
        new THREE.MeshStandardMaterial({
          color: regionBounds[region].color,
          emissive: regionBounds[region].color,
          emissiveIntensity: 1.45,
          transparent: true,
          opacity: 0.48,
          roughness: 0.22,
          metalness: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      ])
    ) as Record<BrainRegion, THREE.MeshStandardMaterial>;

    normalizeBrain(clone);
    normalizeBrain(wireClone);
    normalizeBrain(regionClone);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = baseMaterial;
        child.renderOrder = 1;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    regionClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const region = getRegionFromMeshName(child.name);
        if (region) {
          child.material = regionMaterials[region].clone();
          child.renderOrder = 2;
          child.scale.multiplyScalar(regionScale);
          regionRefs[region] = [...(regionRefs[region] ?? []), child];
        } else {
          child.visible = false;
        }
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    wireClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (getRegionFromMeshName(child.name)) {
          child.visible = false;
          return;
        }
        child.material = wireMaterial;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return { glassBrain: clone, regionBrain: regionClone, regionMeshes: regionRefs, wireBrain: wireClone };
  }, [brainScene, regionScene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = baseRotationY + Math.sin(clock.elapsedTime * 0.2) * 0.08;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.75) * 0.025;

    (Object.keys(regionMeshes) as BrainRegion[]).forEach((region) => {
      const pulse = getRegionPulseStrength(events, region);
      const glow = 1.1 + pulse * 2.4 + Math.sin(clock.elapsedTime * 4.4) * 0.08;
      regionMeshes[region]?.forEach((mesh) => {
        const material = mesh.material instanceof THREE.MeshStandardMaterial ? mesh.material : undefined;
        if (!material) return;
        material.opacity = 0.42 + pulse * 0.34;
        material.emissiveIntensity = glow;
      });
    });
  });

  return (
    <group ref={group} scale={1.72} rotation={[0.02, baseRotationY, 0]}>
      <primitive object={glassBrain} />
      <primitive object={regionBrain} />
      <primitive object={wireBrain} />
    </group>
  );
}

useGLTF.preload(BRAIN_BASE_ASSET_PATH);
useGLTF.preload(BRAIN_REGION_ASSET_PATH);

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
