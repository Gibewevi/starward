import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { createKit, glowTexture } from './kit.js';

/**
 * A power transformer in a corner of the room — the room's lights hang on
 * it. A squat steel tank with cooling fins, three ceramic insulators on its
 * lid with cables running into the wall, a warning band and status lamps,
 * and an arc window on its front: a slot of crackling blue-white light. It
 * stands in the way like a crate (an obstacle in the lab).
 *
 * The hero can run his blade into the arc window (begin()). The surge then
 * builds for FEEL.sabotage.surge seconds — sparks pouring out round the
 * blade, arcs leaping between the insulators and to the blade, its own light
 * stuttering brighter and brighter, the lamps gone red — until it bursts.
 * Dead, it smoulders, and now and then spits sparks and an arc into the dark.
 *
 * update(dt, { blade }) returns what happened this frame:
 * { progress (0 → 1 while surging), burst (the moment it blows), spit (a
 * crackle in the dark) }.
 */
export function createTransformer(scene, { lab = null, effects = null, at, facing = new THREE.Vector3(0, 0, 1), random = Math.random }) {
  const group = new THREE.Group();
  group.name = 'Transformer';
  scene.add(group);
  const out = facing.clone().setY(0).normalize(), across = new THREE.Vector3(out.z, 0, -out.x);
  const frame = new THREE.Matrix4().makeBasis(across, new THREE.Vector3(0, 1, 0), out).setPosition(at);
  const W = 1.3, D = 1.05, H = 1.75;
  const M = {
    steel: new THREE.MeshStandardMaterial({ name: 'transformer steel', color: 0x262c31, roughness: 0.5, metalness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ name: 'transformer recess', color: 0x0b0d10, roughness: 0.7, metalness: 0.5 }),
    trim: new THREE.MeshStandardMaterial({ name: 'transformer trim', color: 0x3c444e, roughness: 0.38, metalness: 0.75 }),
    ceramic: new THREE.MeshStandardMaterial({ name: 'insulators', color: 0xb9bec2, roughness: 0.3, metalness: 0.05 }),
    copper: new THREE.MeshStandardMaterial({ name: 'copper', color: 0x8a5a33, roughness: 0.32, metalness: 0.85 }),
    cable: new THREE.MeshStandardMaterial({ name: 'cables', color: 0x101215, roughness: 0.62, metalness: 0.2 }),
    band: new THREE.MeshStandardMaterial({ name: 'warning band', color: 0x7a5a16, roughness: 0.6, metalness: 0.2 }),
  };
  // What glows: the arc window and the lamps (their own, not the room's power).
  const slot = new THREE.MeshBasicMaterial({ name: 'arc window', color: new THREE.Color(0.55, 0.8, 1.5), toneMapped: false });
  const lamps = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ name: 'transformer lamp', color: new THREE.Color(0.1, 0.7, 0.2), toneMapped: false }));
  const kit = createKit();
  const local = (x, y, z) => [x, y, z];
  // Plinth, tank, lid.
  kit.box(M.dark, W + 0.12, 0.1, D + 0.1, local(0, 0.05, 0), null, frame);
  kit.box(M.steel, W, 1.3, D - 0.12, local(0, 0.75, -0.06), null, frame);
  kit.box(M.trim, W + 0.04, 0.06, D - 0.06, local(0, 1.43, -0.06), null, frame);
  // Cooling fins down the side the room sees, and along the left of the front.
  for (let i = 0; i < 7; i++) kit.box(M.trim, 0.09, 1.0, 0.035, local(W / 2 + 0.04, 0.72, -0.42 + i * 0.13), null, frame);
  for (let i = 0; i < 4; i++) kit.box(M.trim, 0.035, 1.0, 0.09, local(-W / 2 + 0.12 + i * 0.1, 0.72, D / 2 - 0.08), null, frame);
  // The arc window: a recessed frame, its slot of light, two heavy brackets.
  kit.box(M.dark, 0.5, 0.42, 0.06, local(0.12, 0.98, D / 2 - 0.1), null, frame);
  kit.box(slot, 0.38, 0.26, 0.02, local(0.12, 0.98, D / 2 - 0.065), null, frame);
  for (const side of [-1, 1]) kit.box(M.trim, 0.05, 0.5, 0.08, local(0.12 + side * 0.28, 0.98, D / 2 - 0.08), null, frame);
  // Warning band and its chevrons; the status lamps.
  kit.box(M.band, W - 0.1, 0.1, 0.02, local(0, 0.42, D / 2 - 0.11), null, frame);
  for (let i = 0; i < 6; i++) kit.box(M.dark, 0.05, 0.1, 0.022, local(-0.5 + i * 0.2, 0.42, D / 2 - 0.105), [0, 0, 0.6], frame);
  lamps.forEach((lamp, i) => kit.box(lamp, 0.05, 0.04, 0.02, local(0.5, 1.18 - i * 0.09, D / 2 - 0.11), null, frame));
  // Insulators: stacked ceramic discs with copper caps; cables from them into the wall.
  const tops = [];
  for (const x of [-0.38, 0, 0.38]) {
    for (let k = 0; k < 5; k++) kit.cylinder(M.ceramic, 0.075 - k * 0.006, 0.08 - k * 0.006, 0.05, 10, local(x, 1.5 + k * 0.065, -0.15), null, frame);
    kit.cylinder(M.copper, 0.03, 0.04, 0.07, 8, local(x, 1.85, -0.15), null, frame);
    const top = new THREE.Vector3(x, 1.88, -0.15).applyMatrix4(frame);
    tops.push(top);
    // A thick cable sagging back into the wall.
    const from = new THREE.Vector3(x, 1.86, -0.18), to = new THREE.Vector3(x * 0.6, 2.5, -D / 2 - 0.3);
    const mid = from.clone().lerp(to, 0.5), length = from.distanceTo(to);
    const tilt = Math.atan2(to.z - from.z, to.y - from.y);
    kit.cylinder(M.cable, 0.035, 0.035, length, 8, local(mid.x, mid.y, mid.z), [tilt, 0, 0], frame);
  }
  const meshes = kit.build(group, { name: 'Transformer' });
  // The arc window's glow on the floor before it, and its light.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.35, 0.55, 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const socket = new THREE.Vector3(0.12, 0.98, D / 2 - 0.05).applyMatrix4(frame);
  halo.position.copy(socket).addScaledVector(out, 0.05);
  halo.scale.setScalar(0.7);
  group.add(halo);
  const light = new THREE.PointLight(0x9fc8ff, 0, 5.5, 1.6);
  light.position.copy(socket).addScaledVector(out, 0.35);
  group.add(light);
  // Arcs: jagged blue-white lines, rebuilt every few hundredths of a second.
  const ARCS = 5, SEGMENTS = 9;
  const arcPositions = new Float32Array(ARCS * SEGMENTS * 2 * 3);
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const arcs = new THREE.LineSegments(arcGeometry, new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 2.2, 3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  arcs.name = 'Arcs';
  arcs.frustumCulled = false;
  group.add(arcs);
  // An obstacle like a crate (it may shelter a trooper).
  const corners = [new THREE.Vector3(-W / 2 - 0.06, 0, -D / 2), new THREE.Vector3(W / 2 + 0.1, H, D / 2 - 0.05)].map(point => point.applyMatrix4(frame));
  const box = { kind: 'machine', min: new THREE.Vector3(Math.min(corners[0].x, corners[1].x), 0, Math.min(corners[0].z, corners[1].z)), max: new THREE.Vector3(Math.max(corners[0].x, corners[1].x), H, Math.max(corners[0].z, corners[1].z)) };
  box.centre = box.min.clone().add(box.max).multiplyScalar(0.5);
  lab?.obstacles.push(box);

  // Where the hero stands to run his blade into it: before it, a little to one side (FEEL.sabotage.angle),
  // so that his sword side is turned to the view and the thrust crosses the screen.
  const approach = socket.clone().addScaledVector(out.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), FEEL.sabotage.angle), FEEL.sabotage.stand).setY(0);
  let state = 'ready', clock = 0, arcClock = 0, sprayClock = 0, spitClock = 0, flare = 0, time = 0;
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3();
  const slotBase = slot.color.clone();

  /** A jagged bolt from a to b in slot i; `reach` > 0 shows it. */
  function bolt(i, a, b, jag = 0.12) {
    const base = i * SEGMENTS * 6;
    let previous = a.clone();
    for (let s = 1; s <= SEGMENTS; s++) {
      const k = s / SEGMENTS;
      const next = s === SEGMENTS ? b.clone() : a.clone().lerp(b, k).add(temp.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(jag * 2 * Math.sin(Math.PI * k)));
      previous.toArray(arcPositions, base + (s - 1) * 6);
      next.toArray(arcPositions, base + (s - 1) * 6 + 3);
      previous = next;
    }
  }
  function hideBolt(i) { arcPositions.fill(0, i * SEGMENTS * 6, (i + 1) * SEGMENTS * 6); }

  function begin() {
    if (state !== 'ready') return false;
    state = 'surging';
    clock = 0;
    return true;
  }
  /** blade: { base, tip } this frame (the arcs jump to it while it is in). */
  function update(dt, { blade = null } = {}) {
    time += dt;
    const result = { progress: 0, burst: false, spit: false };
    const s = FEEL.sabotage;
    flare = Math.max(0, flare - dt * 3);
    if (state === 'ready') {
      // Alive: the window crackles softly, the lamps blink green, a faint arc between the insulators now and then.
      const crackle = 0.85 + 0.15 * Math.sin(time * 37) * Math.sin(time * 23);
      slot.color.copy(slotBase).multiplyScalar(crackle);
      lamps.forEach((lamp, i) => lamp.color.setRGB(0.1, 0.7, 0.2).multiplyScalar(Math.sin(time * 2.1 + i * 2) > -0.3 ? 1 : 0.15));
      light.intensity = 0.8 * crackle;
      halo.material.opacity = 0.5 * crackle;
      if ((arcClock -= dt) <= 0) {
        arcClock = 0.05;
        const live = random() < 0.08;
        if (live) bolt(0, tops[Math.floor(random() * 2)], tops[1 + Math.floor(random() * 2)], 0.06); else hideBolt(0);
        for (let i = 1; i < ARCS; i++) hideBolt(i);
        arcGeometry.attributes.position.needsUpdate = true;
      }
    } else if (state === 'surging') {
      clock += dt;
      const k = Math.min(1, clock / s.surge);
      result.progress = k;
      // Sparks pour out round the blade, more and more.
      if ((sprayClock -= dt) <= 0) {
        sprayClock = 0.07 - 0.04 * k;
        effects?.sparks(socket.clone().addScaledVector(out, 0.05), temp.copy(out).add(temp2.set((random() - 0.5) * 1.2, 0.4 + random() * 0.6, (random() - 0.5) * 1.2)).normalize(), across, { count: Math.round(5 + 14 * k), speed: 2.5 + 3 * k, saber: 0.55 });
      }
      // The window and the light stutter, brighter and brighter; the lamps turn red and race.
      const stutter = random() < 0.25 + 0.4 * k ? 0.25 : 1;
      slot.color.copy(slotBase).multiplyScalar((1.2 + 2.5 * k) * stutter);
      light.intensity = (3 + 14 * k) * stutter;
      halo.material.opacity = Math.min(1, 0.6 + k) * stutter;
      halo.scale.setScalar(0.7 + 0.9 * k);
      lamps.forEach((lamp, i) => lamp.color.setRGB(0.9, 0.05, 0.02).multiplyScalar(Math.sin(time * (12 + 20 * k) + i * 1.7) > 0 ? 1 : 0.1));
      // Arcs: between the insulators, and down to the blade.
      if ((arcClock -= dt) <= 0) {
        arcClock = 0.035 + random() * 0.03;
        for (let i = 0; i < ARCS; i++) {
          if (random() > 0.35 + 0.6 * k) { hideBolt(i); continue; }
          const from = tops[Math.floor(random() * 3)];
          const to = i < 2 && blade ? temp2.copy(blade.base).lerp(blade.tip, 0.15 + random() * 0.5) : i < 4 ? tops[Math.floor(random() * 3)] : socket;
          if (from === to) { hideBolt(i); continue; }
          bolt(i, from, to, 0.1 + 0.12 * k);
        }
        arcGeometry.attributes.position.needsUpdate = true;
      }
      arcs.material.opacity = 0.8 + 0.2 * random();
      if (k >= 1) {
        // It blows.
        state = 'dead';
        clock = 0;
        result.burst = true;
        flare = 1;
        slot.color.setRGB(0.02, 0.025, 0.03);
        lamps.forEach(lamp => lamp.color.setRGB(0, 0, 0));
        light.intensity = 40;
        halo.material.opacity = 1;
        halo.scale.setScalar(2.4);
        for (let i = 0; i < ARCS; i++) bolt(i, tops[i % 3], socket.clone().add(temp.set((random() - 0.5) * 1.6, random() * 1.2 - 0.6, 0.6 + random())), 0.3);
        arcGeometry.attributes.position.needsUpdate = true;
        spitClock = pick(s.spit, random);
      }
    } else {
      // Dead: smouldering in the dark; now and then a spit of sparks and an arc, lighting the corner for an instant.
      clock += dt;
      light.intensity = Math.max(0, light.intensity * Math.exp(-dt * 9)) + flare * 6;
      halo.material.opacity = Math.min(1, flare * 1.2);
      halo.scale.setScalar(0.6 + flare * 1.6);
      arcs.material.opacity = Math.min(1, flare * 1.5);
      if (flare <= 0.05) { for (let i = 0; i < ARCS; i++) hideBolt(i); arcGeometry.attributes.position.needsUpdate = true; }
      if ((spitClock -= dt) <= 0) {
        spitClock = pick(s.spit, random) * (clock > s.calm ? 2.5 : 1);
        flare = 0.6 + random() * 0.5;
        result.spit = true;
        effects?.sparks(socket.clone().addScaledVector(out, 0.05), temp.copy(out).add(temp2.set((random() - 0.5), 0.3 + random() * 0.5, (random() - 0.5))).normalize(), across, { count: 8 + Math.round(random() * 14), speed: 3, saber: 0.5 });
        for (let i = 0; i < 2; i++) bolt(i, tops[Math.floor(random() * 3)], socket.clone().add(temp.set((random() - 0.5) * 0.8, random() * 0.5, 0.2)), 0.15);
        arcGeometry.attributes.position.needsUpdate = true;
      }
    }
    return result;
  }
  function reset() {
    state = 'ready';
    clock = flare = 0;
    slot.color.copy(slotBase);
    halo.scale.setScalar(0.7);
    light.intensity = 0.8;
    arcPositions.fill(0);
    arcGeometry.attributes.position.needsUpdate = true;
  }
  reset();
  return {
    group, box, socket, approach, facing: out, light, tops, meshes,
    begin, update, reset,
    get state() { return state; },
    /** Can the hero standing at `position` run his blade into it? */
    reachable: position => state === 'ready' && Math.hypot(position.x - approach.x, position.z - approach.z) < FEEL.sabotage.reach,
  };
}
