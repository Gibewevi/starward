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
 * The light is a warm white, wide and soft-edged, with a little glow round
 * the lens that lights the man himself and what stands near him. Every rifle
 * shows its beam — a soft cone of light in the dusty air, fading along its
 * length, stopping where a crate or a wall stands in the way — with dust
 * motes drifting and swirling in it (stirred when the hero or his blade
 * goes through). Beams, glints and motes are on layer 1: the wet floor does
 * not mirror them, only the light they cast.
 *
 * The light itself comes from a small fixed pool of spot lights (each with
 * its spill) handed each frame to the rifles nearest the hero, all casting
 * shadows: the number of lights the shaders know never changes, whatever the
 * number of troopers.
 *
 * update(dt, { troopers, hero, stirs, night }) returns the troopers who
 * switched their lamp on this frame (a click to play). `stirs`: points
 * moving through the air ({ at, speed }) that stir the dust.
 */
const LENS = new THREE.Vector3(0, -0.035, 0.36);
const LAYER = 1;

export function createFlashlights(scene, { lab = null, random = Math.random } = {}) {
  const { lamps: count, shadows, lamp, beam: B, dust: D } = FEEL.blackout;
  const warmth = new THREE.Color(lamp.color);
  const pool = Array.from({ length: count }, (_, index) => {
    const light = new THREE.SpotLight(warmth, 0, lamp.distance, lamp.angle, lamp.penumbra, lamp.decay);
    light.name = 'Rifle lamp';
    if (index < shadows) {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.15;
      light.shadow.camera.far = lamp.distance;
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.02;
    }
    // The glow round the lens: the man holding it and what is right by him.
    const spill = new THREE.PointLight(warmth, 0, lamp.spillDistance, 2);
    spill.name = 'Rifle lamp spill';
    scene.add(light, light.target, spill);
    return { light, spill };
  });
  // The beam: a cone from the lens, its light fading along it and soft at its edges.
  const geometry = new THREE.ConeGeometry(B.radius, B.length, 20, 1, true);
  geometry.translate(0, -B.length / 2, 0);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { tint: { value: warmth.clone().multiplyScalar(0.8) }, level: { value: 0 }, reach: { value: 1 } },
    vertexShader: /* glsl */`
      varying float vAlong; varying float vEdge;
      void main() {
        vAlong = clamp(position.z / ${B.length.toFixed(2)}, 0.0, 1.0);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vEdge = abs(dot(n, normalize(cameraPosition - world.xyz)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint; uniform float level; uniform float reach;
      varying float vAlong; varying float vEdge;
      void main() {
        // Faded along the whole beam length (it may be cut short by a crate: reach), soft at its sides.
        float along = vAlong * reach;
        float fade = pow(1.0 - along, 2.0) * smoothstep(0.0, 0.06, along);
        float soft = pow(vEdge, 2.4);
        gl_FragColor = vec4(tint * fade * soft * level, 1.0);
      }`,
  });
  const glintMap = glowTexture();
  // Drawn from the start, shrunk to nothing: the beam's shader is built at load, not at the first lamp switched on in the dark.
  const warm = new THREE.Mesh(geometry, material);
  warm.matrixAutoUpdate = false;
  warm.matrix.makeScale(1e-4, 1e-4, 1e-4);
  warm.frustumCulled = false;
  warm.layers.set(LAYER);
  scene.add(warm);

  // Dust: motes living in the beams, each in its beam's own space (along, out from the axis, round it).
  const MOTES = D.motes * count * 2;
  const dustPositions = new Float32Array(MOTES * 3), dustGlow = new Float32Array(MOTES), dustSizes = new Float32Array(MOTES);
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeometry.setAttribute('glow', new THREE.BufferAttribute(dustGlow, 1).setUsage(THREE.DynamicDrawUsage));
  dustGeometry.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1).setUsage(THREE.DynamicDrawUsage));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: warmth.clone().multiplyScalar(1.4) } },
    vertexShader: /* glsl */`
      attribute float glow; attribute float size; varying float vGlow;
      void main() { vGlow = glow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint; varying float vGlow;
      void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0 || vGlow < 0.01) discard; gl_FragColor = vec4(tint * vGlow * (1.0 - d), 1.0); }`,
  }));
  dust.name = 'Lamp dust';
  dust.frustumCulled = false;
  dust.layers.set(LAYER);
  scene.add(dust);
  // Each mote: along (0..1), out (0..1 of the radius there), round (rad), its own swirl and twinkle.
  const motes = Array.from({ length: MOTES }, () => ({ along: random(), out: Math.sqrt(random()), round: random() * Math.PI * 2, swirl: pick(D.swirl, random) * (random() < 0.5 ? -1 : 1), phase: random() * 10, size: pick(D.size, random), owner: null }));

  const beams = new Map();
  const lens = new THREE.Vector3(), end = new THREE.Vector3(), forward = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const local = new THREE.Vector3();
  let clock = 0;

  /** A trooper's beam (made when first needed); the lamp itself is off until switched on. */
  function beamOf(trooper) {
    let beam = beams.get(trooper);
    if (beam) return beam;
    const cone = new THREE.Mesh(geometry, material.clone());
    cone.name = 'Rifle lamp beam';
    cone.matrixAutoUpdate = false;
    cone.frustumCulled = false;
    cone.renderOrder = 3;
    // The lens: a hot little core in a wider soft glow.
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, color: warmth.clone().multiplyScalar(1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, color: warmth.clone().multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glint.scale.setScalar(0.2);
    halo.scale.setScalar(0.85);
    for (const object of [cone, glint, halo]) { object.visible = false; object.layers.set(LAYER); scene.add(object); }
    beam = { cone, glint, halo, on: 0, switchAt: Infinity, switched: false, flicker: 0, reach: 1, stir: 0, lens: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1), rotation: new THREE.Quaternion() };
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
    for (const [, beam] of beams) for (const object of [beam.cone, beam.glint, beam.halo]) { object.removeFromParent(); object.material.dispose(); }
    beams.clear();
    for (const { light, spill } of pool) light.intensity = spill.intensity = 0;
    for (const mote of motes) mote.owner = null;
    dustGlow.fill(0);
    dustGeometry.attributes.glow.needsUpdate = true;
  }
  const hide = beam => { beam.cone.visible = beam.glint.visible = beam.halo.visible = false; };
  function update(dt, { troopers, hero, night = 0, stirs = [] }) {
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
      if (!rifle || !trooper.debris?.parent) { hide(beam); continue; }
      if (!beam.switched && clock >= beam.switchAt) { beam.switched = true; beam.flicker = 0.35; clicks.push(trooper); }
      // Switched on: a stutter, then steady (the power gone back: off).
      if (beam.switched) {
        beam.flicker = Math.max(0, beam.flicker - dt);
        const stutter = beam.flicker > 0 ? (Math.sin(beam.flicker * 90) > 0.2 ? 1 : 0.15) : 1;
        beam.on = night * stutter;
      } else beam.on = 0;
      if (beam.on <= 0.01) { hide(beam); continue; }
      rifle.updateWorldMatrix(true, false);
      lens.copy(LENS).applyMatrix4(rifle.matrixWorld);
      rifle.getWorldQuaternion(rotation);
      forward.set(0, 0, 1).applyQuaternion(rotation);
      // A crate or a wall in the way: the beam stops on it (light passes the railings, as bolts do); the floor stops it too.
      end.copy(lens).addScaledVector(forward, B.length);
      const hit = lab?.segmentHit(lens, end, box => box.kind === 'rail');
      let reach = hit ? Math.max(0.08, hit.t) : 1;
      if (forward.y < -1e-3) reach = Math.min(reach, Math.max(0.08, lens.y / (-forward.y * B.length)));
      beam.reach = reach;
      beam.cone.matrix.compose(lens, rotation, scale.setScalar(reach));
      beam.cone.matrixWorldNeedsUpdate = true;
      beam.cone.material.uniforms.level.value = beam.on * B.level;
      beam.cone.material.uniforms.reach.value = reach;
      beam.cone.visible = true;
      beam.glint.position.copy(lens);
      beam.halo.position.copy(lens);
      beam.glint.material.opacity = beam.halo.material.opacity = beam.on;
      beam.glint.visible = beam.halo.visible = true;
      beam.lens.copy(lens);
      beam.forward.copy(forward);
      beam.rotation.copy(rotation);
      // Something moving through it stirs the dust.
      for (const stir of stirs) {
        local.copy(stir.at).sub(lens);
        const along = local.dot(forward);
        if (along < 0 || along > B.length * reach) continue;
        const radius = B.radius * along / B.length + 0.3;
        if (local.addScaledVector(forward, -along).length() < radius) beam.stir = Math.min(1, beam.stir + stir.speed * dt * 0.6);
      }
      beam.stir = Math.max(0, beam.stir - dt * 0.7);
      lit.push({ beam, at: lens.clone(), forward: forward.clone(), on: beam.on, distance: hero ? lens.distanceTo(hero) : 0 });
    }
    // The real lights for the rifles nearest the hero.
    lit.sort((a, b) => a.distance - b.distance);
    pool.forEach(({ light, spill }, index) => {
      const entry = lit[index];
      if (!entry) { light.intensity = spill.intensity = 0; return; }
      light.position.copy(entry.at);
      light.target.position.copy(entry.at).addScaledVector(entry.forward, 4);
      light.target.updateMatrixWorld();
      light.intensity = lamp.intensity * entry.on;
      spill.position.copy(entry.at).addScaledVector(entry.forward, 0.35);
      spill.intensity = lamp.spill * entry.on;
    });
    updateDust(dt, lit.map(entry => entry.beam));
    return clicks;
  }
  /** The motes: shared among the lit beams; each drifts down its beam and swirls round it, glowing where the light is. */
  function updateDust(dt, live) {
    const share = live.length ? Math.floor(MOTES / live.length) : 0;
    motes.forEach((mote, index) => {
      const beam = share && index < share * live.length ? live[Math.floor(index / share)] : null;
      if (!beam) { dustGlow[index] = 0; mote.owner = null; return; }
      if (mote.owner !== beam) { mote.owner = beam; mote.along = random(); }
      const stir = 1 + beam.stir * D.stir;
      mote.round += mote.swirl * stir * dt;
      mote.along += (D.drift * (0.3 + random()) + beam.stir * (random() - 0.4) * 0.6) * dt;
      mote.out = THREE.MathUtils.clamp(mote.out + (random() - 0.5) * dt * 0.6 * stir, 0.05, 1);
      if (mote.along > 1 || mote.along < 0) { mote.along = random() * 0.15; mote.out = Math.sqrt(random()); }
      if (mote.along > beam.reach) { dustGlow[index] = 0; return; }
      const radius = B.radius * mote.along * mote.out;
      side.set(1, 0, 0).applyQuaternion(beam.rotation);
      up.set(0, 1, 0).applyQuaternion(beam.rotation);
      local.copy(beam.lens).addScaledVector(beam.forward, mote.along * B.length).addScaledVector(side, Math.cos(mote.round) * radius).addScaledVector(up, Math.sin(mote.round) * radius);
      local.toArray(dustPositions, index * 3);
      // Brightest near the lamp and on the axis, twinkling as they turn in the light.
      const twinkle = 0.55 + 0.45 * Math.sin(clock * 2.3 + mote.phase);
      dustGlow[index] = beam.on * (1 - mote.along) ** 1.4 * (1 - 0.6 * mote.out) * twinkle * Math.min(1, mote.along * 12);
      dustSizes[index] = mote.size;
    });
    for (const attribute of [dustGeometry.attributes.position, dustGeometry.attributes.glow, dustGeometry.attributes.size]) attribute.needsUpdate = true;
  }
  return {
    update, darkness, clear,
    pool: pool.map(({ light }) => light), spills: pool.map(({ spill }) => spill), dust,
    /** How many lamps are on (beams showing). */
    get on() { let n = 0; for (const [, beam] of beams) n += beam.cone.visible ? 1 : 0; return n; },
    /** Motes glowing now. */
    get motes() { let n = 0; for (let i = 0; i < MOTES; i++) n += dustGlow[i] > 0.02 ? 1 : 0; return n; },
    beams,
  };
}
