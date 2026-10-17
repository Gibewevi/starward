import * as THREE from 'three';

/** Hilt and blue blade along the socket's +Y axis, with its two moving lights.
 * update(ignition 0..1, time, flare 0..1) drives the blade: switched on, it
 * shoots out of the emitter in a fraction of a second, slightly overshooting,
 * and is drawn back in when switched off. It returns 'ignite' or 'retract' on
 * the frame either starts. A flare brightens it for an impact.
 * segment(base, tip) gives the lit blade. */
export const IGNITE_TIME = 0.3;
export const RETRACT_TIME = 0.22;

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
  // The beam is widest where it leaves the emitter, by the hand, and tapers
  // towards the tip.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.021, length, 8), coreMaterial);
  core.position.y = length / 2;
  const aura = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.048, length, 10), auraMaterial);
  aura.position.y = length / 2;
  const emitter = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), auraMaterial);
  emitter.scale.set(0.04, 0.06, 0.04);
  emitter.position.y = 0.012;
  blade.add(core, aura, emitter);
  // Held low, the blade lights the floor more than the coat.
  const bladeLight = new THREE.PointLight(0x2671ff, 5, 3.2, 1.7);
  const tipLight = new THREE.PointLight(0x2375ff, 4, 2.6, 1.7);
  scene.add(bladeLight, tipLight);
  const center = new THREE.Vector3(), tip = new THREE.Vector3();
  let extension = 1, lit = true, lastTime = null, burst = 0;
  const easeOutBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
  const easeIn = t => t * t;

  function update(ignition, time, flare = 0) {
    const dt = lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
    lastTime = time;
    let event = null;
    const on = ignition > 0.5;
    if (on !== lit) { lit = on; event = on ? 'ignite' : 'retract'; if (on) burst = 1; }
    extension = Math.max(0, Math.min(1, extension + (lit ? dt / IGNITE_TIME : -dt / RETRACT_TIME)));
    burst = Math.max(0, burst - dt * 5);
    const shown = lit ? easeOutBack(extension) : easeIn(extension);
    blade.scale.y = Math.max(shown, 0.0001);
    blade.visible = shown > 0.005;
    emitter.scale.set(0.04, 0.06, 0.04).multiplyScalar(Math.min(1, extension * 3) * (1 + burst * 0.8));
    blade.updateWorldMatrix(true, false);
    center.set(0, length * 0.42, 0).applyMatrix4(blade.matrixWorld);
    tip.set(0, length * 0.9, 0).applyMatrix4(blade.matrixWorld);
    bladeLight.position.copy(center);
    tipLight.position.copy(tip);
    const pulse = 1 + Math.sin(time * 38) * 0.025 + Math.sin(time * 71) * 0.015;
    const glow = Math.min(1, shown) * pulse;
    bladeLight.intensity = 5 * glow * (1 + flare * 2.5 + burst * 1.5);
    tipLight.intensity = 4.5 * glow * (1 + flare * 4);
    return event;
  }
  function segment(base, tipPoint) {
    blade.updateWorldMatrix(true, false);
    base.set(0, 0, 0).applyMatrix4(blade.matrixWorld);
    tipPoint.set(0, length, 0).applyMatrix4(blade.matrixWorld);
  }
  return { group: saber, blade, length, update, segment, get extension() { return extension; } };
}
