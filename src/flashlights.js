import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { glowTexture } from './kit.js';

/**
 * Lamps under the troopers' rifle barrels, for the dark. Once the power is
 * cut each trooper switches his on after a moment (a click, a stutter, then
 * steady), and it goes where his rifle goes: sweeping the room as he looks
 * for the hero, onto the hero as he aims, and on the floor, still lit, by a
 * dead man's dropped rifle.
 *
 * Every rifle shows its beam — a short cone of cold light fading along its
 * length, soft at its edges — and a glint at the lens. The light itself comes
 * from a small fixed pool of spot lights handed each frame to the rifles
 * nearest the hero (the first few cast shadows): the number of lights the
 * shaders know never changes, whatever the number of troopers.
 *
 * update(dt, { troopers, hero, night }) returns the troopers who switched
 * their lamp on this frame (a click to play).
 */
const BEAM = 3.4, RADIUS = 0.62;
const LENS = new THREE.Vector3(0, -0.035, 0.36);

export function createFlashlights(scene, { random = Math.random } = {}) {
  const { lamps: count, shadows } = FEEL.blackout;
  const pool = Array.from({ length: count }, (_, index) => {
    const light = new THREE.SpotLight(0xdfe7ff, 0, 11, 0.36, 0.55, 1.3);
    light.name = 'Rifle lamp';
    if (index < shadows) {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.15;
      light.shadow.camera.far = 11;
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.02;
    }
    scene.add(light, light.target);
    return light;
  });
  // The beam: a cone from the lens, its light fading along it and at its edges.
  const geometry = new THREE.ConeGeometry(RADIUS, BEAM, 18, 1, true);
  geometry.translate(0, -BEAM / 2, 0);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { tint: { value: new THREE.Color(0.62, 0.7, 0.85) } },
    vertexShader: /* glsl */`
      varying float vAlong; varying float vEdge;
      void main() {
        vAlong = clamp(position.z / ${BEAM.toFixed(2)}, 0.0, 1.0);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 normal = normalize(mat3(modelMatrix) * normal);
        vec3 toCamera = normalize(cameraPosition - world.xyz);
        vEdge = abs(dot(normal, toCamera));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint; uniform float level;
      varying float vAlong; varying float vEdge;
      void main() {
        float fade = pow(1.0 - vAlong, 1.7) * smoothstep(0.0, 0.08, vAlong);
        float soft = pow(vEdge, 1.4);
        gl_FragColor = vec4(tint * fade * soft * level, 1.0);
      }`,
  });
  material.uniforms.level = { value: 0 };
  const glintMap = glowTexture();
  // Drawn from the start, shrunk to nothing: the beam's shader is built at load, not at the first lamp switched on in the dark.
  const warm = new THREE.Mesh(geometry, material);
  warm.matrixAutoUpdate = false;
  warm.matrix.makeScale(1e-4, 1e-4, 1e-4);
  warm.frustumCulled = false;
  warm.name = 'Rifle lamp beam (warm-up)';
  const warmGlint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }));
  warmGlint.scale.setScalar(1e-4);
  scene.add(warm, warmGlint);
  const beams = new Map();
  const lens = new THREE.Vector3(), ahead = new THREE.Vector3(), forward = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let clock = 0;

  /** A trooper's beam (made when first needed); the lamp itself is off until switched on. */
  function beamOf(trooper) {
    let beam = beams.get(trooper);
    if (beam) return beam;
    const cone = new THREE.Mesh(geometry, material.clone());
    cone.material.uniforms.level = { value: 0 };
    cone.name = 'Rifle lamp beam';
    cone.matrixAutoUpdate = false;
    cone.frustumCulled = false;
    cone.renderOrder = 3;
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, color: new THREE.Color(1.2, 1.3, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glint.scale.setScalar(0.22);
    cone.visible = glint.visible = false;
    scene.add(cone, glint);
    beam = { cone, glint, on: 0, switchAt: Infinity, switched: false, flicker: 0 };
    beams.set(trooper, beam);
    return beam;
  }
  /** The dark comes: every lamp is switched on after a moment of its own. */
  function darkness(troopers, delay = FEEL.blackout.onAfter) {
    for (const trooper of troopers) {
      const beam = beamOf(trooper);
      if (!beam.switched) beam.switchAt = clock + pick(delay, random);
    }
  }
  /** The power back (a restart): all off. */
  function clear() {
    for (const [, beam] of beams) { beam.cone.removeFromParent(); beam.glint.removeFromParent(); beam.cone.material.dispose(); beam.glint.material.dispose(); }
    beams.clear();
    for (const light of pool) light.intensity = 0;
  }
  function update(dt, { troopers, hero, night = 0 }) {
    clock += dt;
    const clicks = [];
    const lit = [];
    for (const trooper of troopers) {
      const beam = beams.get(trooper) ?? (night > 0.5 ? beamOf(trooper) : null);
      if (!beam) continue;
      // A newcomer in the dark switches his on too.
      if (night > 0.5 && !beam.switched && beam.switchAt === Infinity) beam.switchAt = clock + pick(FEEL.blackout.onAfter, random) * 0.5;
      // Gone (a body cleared away): its lamp with it.
      const rifle = trooper.parts?.blaster;
      if (!rifle || !trooper.debris?.parent) { beam.cone.visible = beam.glint.visible = false; continue; }
      if (!beam.switched && clock >= beam.switchAt) { beam.switched = true; beam.flicker = 0.35; clicks.push(trooper); }
      // Switched on: a stutter, then steady (the power gone back: off).
      if (beam.switched) {
        beam.flicker = Math.max(0, beam.flicker - dt);
        const stutter = beam.flicker > 0 ? (Math.sin(beam.flicker * 90) > 0.2 ? 1 : 0.15) : 1;
        beam.on = night * stutter;
      } else beam.on = 0;
      if (beam.on <= 0.01) { beam.cone.visible = beam.glint.visible = false; continue; }
      rifle.updateWorldMatrix(true, false);
      lens.copy(LENS).applyMatrix4(rifle.matrixWorld);
      rifle.getWorldQuaternion(rotation);
      forward.set(0, 0, 1).applyQuaternion(rotation);
      beam.cone.matrix.compose(lens, rotation, ahead.set(1, 1, 1));
      beam.cone.matrixWorldNeedsUpdate = true;
      beam.cone.material.uniforms.level.value = beam.on * 0.55;
      beam.cone.visible = true;
      beam.glint.position.copy(lens);
      beam.glint.material.opacity = beam.on;
      beam.glint.visible = true;
      lit.push({ trooper, at: lens.clone(), forward: forward.clone(), on: beam.on, distance: hero ? lens.distanceTo(hero) : 0 });
    }
    // The real lights for the rifles nearest the hero.
    lit.sort((a, b) => a.distance - b.distance);
    pool.forEach((light, index) => {
      const entry = lit[index];
      if (!entry) { light.intensity = 0; return; }
      light.position.copy(entry.at);
      light.target.position.copy(entry.at).addScaledVector(entry.forward, 4);
      light.target.updateMatrixWorld();
      light.intensity = 26 * entry.on;
    });
    return clicks;
  }
  return {
    update, darkness, clear, pool,
    /** How many lamps are on (beams showing). */
    get on() { let n = 0; for (const [, beam] of beams) n += beam.cone.visible ? 1 : 0; return n; },
    beams,
  };
}
