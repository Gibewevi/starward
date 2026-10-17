import * as THREE from 'three';

/** Hilt and blue blade along the socket's +Y axis, with its two moving lights.
 * update(ignition 0..1, time, flare 0..1) extends the blade and drives the glow;
 * a flare brightens it for an impact. segment(base, tip) gives the lit blade. */
export function createSaber({ socket, scene }) {
  const saber = new THREE.Group();
  saber.name = 'Lightsaber';
  socket.add(saber);
  const metal = new THREE.MeshStandardMaterial({ color: 0x777e89, metalness: 0.9, roughness: 0.27, flatShading: true });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x18202c, metalness: 0.65, roughness: 0.45, flatShading: true });
  function cylinder(radius, length, material, y) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
    mesh.position.y = y;
    saber.add(mesh);
    return mesh;
  }
  cylinder(0.026, 0.21, darkMetal, -0.02);
  cylinder(0.031, 0.04, metal, -0.115);
  cylinder(0.035, 0.04, metal, 0.09);
  for (let i = 0; i < 4; i++) cylinder(0.029, 0.011, metal, -0.08 + i * 0.03);
  const blade = new THREE.Group();
  blade.position.y = 0.115;
  saber.add(blade);
  const length = 0.9;
  const auraMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.65, 5.5), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 5.5, 10), toneMapped: false });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.015, length, 6), coreMaterial);
  core.position.y = length / 2;
  const aura = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.033, length, 8), auraMaterial);
  aura.position.y = length / 2;
  blade.add(core, aura);
  // Held low, the blade lights the floor more than the coat.
  const bladeLight = new THREE.PointLight(0x2671ff, 5, 3.2, 1.7);
  const tipLight = new THREE.PointLight(0x2375ff, 4, 2.6, 1.7);
  scene.add(bladeLight, tipLight);
  const center = new THREE.Vector3(), tip = new THREE.Vector3();

  function update(ignition, time, flare = 0) {
    blade.scale.y = Math.max(ignition, 0.0001);
    blade.visible = ignition > 0.005;
    blade.updateWorldMatrix(true, false);
    center.set(0, length * 0.42, 0).applyMatrix4(blade.matrixWorld);
    tip.set(0, length * 0.9, 0).applyMatrix4(blade.matrixWorld);
    bladeLight.position.copy(center);
    tipLight.position.copy(tip);
    const pulse = 1 + Math.sin(time * 38) * 0.025 + Math.sin(time * 71) * 0.015;
    bladeLight.intensity = 5 * ignition * pulse * (1 + flare * 2.5);
    tipLight.intensity = 4.5 * ignition * pulse * (1 + flare * 4);
  }
  function segment(base, tip) {
    blade.updateWorldMatrix(true, false);
    base.set(0, 0, 0).applyMatrix4(blade.matrixWorld);
    tip.set(0, length, 0).applyMatrix4(blade.matrixWorld);
  }
  return { group: saber, blade, length, update, segment };
}
