import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { glowTexture } from './kit.js';

/**
 * Lamps under the troopers' rifle barrels, for the dark. Once the power is
 * cut each trooper switches his on after a moment (a click, a stutter, then
 * steady), and it goes where his rifle goes: sweeping the room as he looks
 * for the hero, onto the hero as he aims, and on the floor by a dead man.
 * A dead man's lamp stays on where it fell for a few seconds, then flickers
 * — fewer and dimmer flashes, as a dying battery — and goes out for good (a
 * last click). A man already dead when the power goes never switches his on.
 *
 * The light is a warm white, wide and soft-edged, with a little glow round
 * the lens that lights the man himself and what stands near him. Every rifle
 * shows its beam in the dusty air: `volumes` lists them each frame, nearest
 * the hero first, for the beam pass (beam-pass.js) that works their light
 * out pixel by pixel — up to the floor or whatever stands in the way, cut by
 * the shadows of the real lights.
 *
 * The dust hangs in the room's air, drifting and twirling slowly where it is;
 * a beam only reveals it. A lamp sweeping the room lights new motes as it
 * goes and leaves the others in the dark — it never carries its own. The
 * hero or his blade going through pushes the dust aside and whirls it.
 * Glints and motes are on layer 1, and the beams are added after the
 * scene: the wet floor does not mirror them, only the light they cast.
 *
 * The light itself comes from a small fixed pool of spot lights (each with
 * its spill) handed each frame to the rifles nearest the hero, all casting
 * shadows: the number of lights the shaders know never changes, whatever the
 * number of troopers.
 *
 * update(dt, { troopers, hero, stirs, night }) returns the troopers who
 * switched their lamp on this frame (a click to play). `stirs`: points
 * moving through the air ({ at, speed }) that stir the dust. `bounds`: the
 * room's floor (x, z) the dust fills.
 */
const LENS = new THREE.Vector3(0, -0.035, 0.36);
const LAYER = 1;

export function createFlashlights(scene, { lab = null, bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, random = Math.random } = {}) {
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
  const glintMap = glowTexture();

  // Dust: motes hanging in the room's air (a little past its edges, where the beams reach over the railing).
  const room = { minX: bounds.minX - 1.5, maxX: bounds.maxX + 1.5, minY: 0.05, maxY: 2.4, minZ: bounds.minZ - 1.5, maxZ: bounds.maxZ + 1.5 };
  const span = new THREE.Vector3(room.maxX - room.minX, room.maxY - room.minY, room.maxZ - room.minZ);
  const MOTES = Math.min(D.cap, Math.round(D.density * span.x * span.y * span.z));
  const dustPositions = new Float32Array(MOTES * 3), dustGlow = new Float32Array(MOTES), dustSizes = new Float32Array(MOTES);
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeometry.setAttribute('glow', new THREE.BufferAttribute(dustGlow, 1).setUsage(THREE.DynamicDrawUsage));
  dustGeometry.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1).setUsage(THREE.DynamicDrawUsage));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: warmth.clone() } },
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
  dustGeometry.setDrawRange(0, 0);
  scene.add(dust);
  // Each mote: where it hangs (it wanders slowly round that point), its own little twirl (rad/s, m) and twinkle.
  const motes = Array.from({ length: MOTES }, () => ({
    anchor: new THREE.Vector3(room.minX + random() * span.x, room.minY + random() * span.y, room.minZ + random() * span.z),
    wander: [pick(D.wander.rate, random), pick(D.wander.rate, random), pick(D.wander.rate, random)], phase: random() * Math.PI * 2,
    swirl: pick(D.swirl, random) * (random() < 0.5 ? -1 : 1), orbit: pick(D.orbit, random), size: pick(D.size, random),
    velocity: new THREE.Vector3(), cell: -1,
  }));
  // Filed by the square metre of floor they hang over: only those near a lit beam (or a stir) are looked at.
  const columns = Math.ceil(span.x), rows = Math.ceil(span.z);
  const cells = Array.from({ length: columns * rows }, () => []);
  const cellAt = (x, z) => THREE.MathUtils.clamp(Math.floor(z - room.minZ), 0, rows - 1) * columns + THREE.MathUtils.clamp(Math.floor(x - room.minX), 0, columns - 1);
  const file = (mote, index) => {
    const cell = cellAt(mote.anchor.x, mote.anchor.z);
    if (cell === mote.cell) return;
    if (mote.cell >= 0) cells[mote.cell].splice(cells[mote.cell].indexOf(index), 1);
    cells[cell].push(index);
    mote.cell = cell;
  };
  motes.forEach(file);
  function eachNear(minX, minZ, maxX, maxZ, visit) {
    const x0 = Math.max(0, Math.floor(minX - room.minX)), x1 = Math.min(columns - 1, Math.floor(maxX - room.minX));
    const z0 = Math.max(0, Math.floor(minZ - room.minZ)), z1 = Math.min(rows - 1, Math.floor(maxZ - room.minZ));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) for (const index of cells[z * columns + x]) visit(index);
  }
  /** Where a mote is now: round its anchor on slow eddies, twirling. */
  function where(mote, out) {
    const t = clock, p = mote.phase, [a, b, c] = mote.wander, w = D.wander.reach, turn = p + t * mote.swirl;
    return out.set(
      mote.anchor.x + w * (Math.sin(t * a + p) + 0.5 * Math.sin(t * b * 1.7 + p * 2.3)) + Math.cos(turn) * mote.orbit,
      mote.anchor.y + w * 0.35 * Math.sin(t * c + p * 1.3) + Math.sin(turn * 1.3) * mote.orbit * 0.6,
      mote.anchor.z + w * (Math.cos(t * b + p * 1.9) + 0.5 * Math.cos(t * a * 1.3 + p * 0.7)) + Math.sin(turn) * mote.orbit);
  }
  const seenAt = new Int32Array(MOTES).fill(-1), glowOf = new Float32Array(MOTES), placed = new Float32Array(MOTES * 3), touched = [];
  const moving = new Set();
  let shown = 0, frame = 0;

  const beams = new Map(), volumes = [];
  const lens = new THREE.Vector3(), end = new THREE.Vector3(), forward = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const local = new THREE.Vector3(), point = new THREE.Vector3();
  let clock = 0;

  /** A trooper's beam (made when first needed); the lamp itself is off until switched on. */
  function beamOf(trooper) {
    let beam = beams.get(trooper);
    if (beam) return beam;
    // The lens: a hot little core in a wider soft glow.
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, color: warmth.clone().multiplyScalar(1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintMap, color: warmth.clone().multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glint.scale.setScalar(0.2);
    halo.scale.setScalar(0.85);
    for (const object of [glint, halo]) { object.visible = false; object.layers.set(LAYER); scene.add(object); }
    beam = { glint, halo, on: 0, switchAt: Infinity, switched: false, flicker: 0, reach: 1, lens: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1), diesAt: Infinity, fading: 1, seed: random() * 100, out: false };
    beams.set(trooper, beam);
    return beam;
  }
  /** The dark comes: every lamp is switched on after a moment of its own. */
  function darkness(troopers, delay = FEEL.blackout.onAfter) {
    for (const trooper of troopers) {
      const beam = beamOf(trooper);
      if (!beam.switched && !trooper.dead) beam.switchAt = clock + pick(delay, random);
    }
  }
  /** The power back (a restart): all off. */
  function clear() {
    for (const [, beam] of beams) for (const object of [beam.glint, beam.halo]) { object.removeFromParent(); object.material.dispose(); }
    beams.clear();
    volumes.length = 0;
    for (const { light, spill } of pool) light.intensity = spill.intensity = 0;
    shown = 0;
    dustGeometry.setDrawRange(0, 0);
  }
  const hide = beam => { beam.glint.visible = beam.halo.visible = false; };
  /** A dead man's lamp: 1 until its battery starts to go, then fewer and dimmer flashes, then 0 for good. */
  function failing(beam) {
    if (clock < beam.diesAt) return 1;
    const progress = (clock - beam.diesAt) / beam.fading;
    if (progress >= 1) return 0;
    const slot = Math.floor((clock - beam.diesAt) * FEEL.blackout.dying.rate);
    const chance = Math.abs(Math.sin(slot * 12.9898 + beam.seed) * 43758.5453) % 1;
    return chance > 0.08 + 0.85 * progress ** 1.5 ? (0.45 + 0.55 * chance) * (1 - 0.5 * progress) : 0.03;
  }
  function update(dt, { troopers, hero, night = 0, stirs = [] }) {
    clock += dt;
    const clicks = [];
    const lit = [];
    for (const trooper of troopers) {
      const beam = beams.get(trooper) ?? (night > 0.5 ? beamOf(trooper) : null);
      if (!beam) continue;
      // A newcomer in the dark switches his on too (not a dead man).
      if (night > 0.5 && !beam.switched && beam.switchAt === Infinity && !trooper.dead) beam.switchAt = clock + pick(FEEL.blackout.onAfter, random) * 0.5;
      // Gone (a body cleared away): its lamp with it.
      const rifle = trooper.parts?.blaster;
      if (!rifle || !trooper.debris?.parent) { hide(beam); continue; }
      if (trooper.dead && !beam.switched) beam.switchAt = Infinity;
      if (!beam.switched && clock >= beam.switchAt) { beam.switched = true; beam.flicker = 0.35; clicks.push(trooper); }
      // Dead, his lamp lit: in a few seconds its battery starts to go.
      if (trooper.dead && beam.switched && beam.diesAt === Infinity) { beam.diesAt = clock + pick(FEEL.blackout.dying.after, random); beam.fading = pick(FEEL.blackout.dying.flicker, random); }
      // Switched on: a stutter, then steady (the power gone back: off); a dead man's, failing, then out.
      if (beam.switched && !beam.out) {
        beam.flicker = Math.max(0, beam.flicker - dt);
        const stutter = beam.flicker > 0 ? (Math.sin(beam.flicker * 90) > 0.2 ? 1 : 0.15) : 1, left = failing(beam);
        if (left <= 0) { beam.out = true; clicks.push(trooper); }
        beam.on = night * stutter * left;
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
      beam.glint.position.copy(lens);
      beam.halo.position.copy(lens);
      beam.glint.material.opacity = beam.halo.material.opacity = beam.on;
      beam.glint.visible = beam.halo.visible = true;
      beam.lens.copy(lens);
      beam.forward.copy(forward);
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
    // For the beam pass. A real light's beam goes its whole length (its shadows cut it); the others stop on what is in the way.
    volumes.length = 0;
    lit.forEach((entry, index) => {
      const light = pool[index]?.light ?? null, shadowed = !!(light?.castShadow && light.shadow.map);
      volumes.push({ lens: entry.at, forward: entry.forward, on: entry.on, light, length: B.length * (shadowed ? 1 : entry.beam.reach) });
    });
    updateDust(dt, lit.map(entry => entry.beam), stirs);
    return clicks;
  }
  /**
   * The motes: each wanders round the point where it hangs, and is drawn only
   * if a beam lights it — brightest near the lamp and on the axis, twinkling
   * as it twirls. Only the motes over the floor a lit beam covers are looked
   * at. Day, or no lamp on: nothing to see, nothing done.
   */
  function updateDust(dt, live, stirs) {
    shown = 0;
    if (!live.length) { dustGeometry.setDrawRange(0, 0); return; }
    // Pushed aside and whirled by the hero or his blade going through; they slow down and stay where they end.
    const R = D.reach;
    for (const stir of stirs) {
      if (stir.speed < 0.5) continue;
      eachNear(stir.at.x - R, stir.at.z - R, stir.at.x + R, stir.at.z + R, index => {
        const mote = motes[index], d2 = where(mote, point).distanceToSquared(stir.at);
        if (d2 > R * R) return;
        const d = Math.sqrt(d2) + 1e-3, push = (1 - d / R) * stir.speed * D.stir * dt, spin = random() < 0.5 ? -0.6 : 0.6;
        local.subVectors(point, stir.at).divideScalar(d);
        mote.velocity.x += (local.x - local.z * spin + random() - 0.5) * push;
        mote.velocity.y += (local.y + random() - 0.5) * push * 0.4;
        mote.velocity.z += (local.z + local.x * spin + random() - 0.5) * push;
        if (mote.velocity.lengthSq() > 2.25) mote.velocity.setLength(1.5);
        moving.add(index);
      });
    }
    for (const index of moving) {
      const mote = motes[index];
      mote.anchor.addScaledVector(mote.velocity, dt);
      mote.anchor.y = THREE.MathUtils.clamp(mote.anchor.y, room.minY, room.maxY);
      mote.velocity.multiplyScalar(Math.exp(-dt / D.settle));
      file(mote, index);
      if (mote.velocity.lengthSq() < 1e-4) { mote.velocity.set(0, 0, 0); moving.delete(index); }
    }
    // Lit by a beam? (Not right at the lens: the glint is there.)
    frame++;
    touched.length = 0;
    const margin = D.wander.reach * 1.5 + D.orbit[1];
    for (const beam of live) {
      const length = B.length * beam.reach;
      end.copy(beam.lens).addScaledVector(beam.forward, length);
      const r = B.radius * beam.reach + margin;
      eachNear(Math.min(beam.lens.x, end.x) - r, Math.min(beam.lens.z, end.z) - r, Math.max(beam.lens.x, end.x) + r, Math.max(beam.lens.z, end.z) + r, index => {
        // Too far from the cone for its wandering to bring it in: skipped before working out where it is.
        local.subVectors(motes[index].anchor, beam.lens);
        const ahead = local.dot(beam.forward), limit = B.radius * Math.max(0, ahead) / B.length + margin;
        if (ahead < -margin || ahead > length + margin || local.lengthSq() - ahead * ahead > limit * limit) return;
        if (seenAt[index] !== frame) {
          seenAt[index] = frame;
          glowOf[index] = 0;
          where(motes[index], point).toArray(placed, index * 3);
          touched.push(index);
        }
        local.fromArray(placed, index * 3).sub(beam.lens);
        const along = local.dot(beam.forward) / B.length;
        if (along < 0.05 || along > beam.reach) return;
        const edge = local.addScaledVector(beam.forward, -along * B.length).lengthSq() / (B.radius * along) ** 2;
        if (edge < 1) glowOf[index] += beam.on * (1 - along) * (1 - edge) * Math.min(1, (along - 0.05) * 12);
      });
    }
    for (const index of touched) {
      if (glowOf[index] < 0.01) continue;
      const mote = motes[index];
      for (let k = 0; k < 3; k++) dustPositions[shown * 3 + k] = placed[index * 3 + k];
      dustGlow[shown] = Math.min(1, glowOf[index]) * D.glow * (0.55 + 0.45 * Math.sin(clock * 2.3 + mote.phase * 3));
      dustSizes[shown] = mote.size;
      shown++;
    }
    dustGeometry.setDrawRange(0, shown);
    if (!shown) return;
    for (const attribute of [dustGeometry.attributes.position, dustGeometry.attributes.glow, dustGeometry.attributes.size]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, shown * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
  return {
    update, darkness, clear,
    pool: pool.map(({ light }) => light), spills: pool.map(({ spill }) => spill), dust,
    /** How many lamps are on (beams showing). */
    get on() { let n = 0; for (const [, beam] of beams) n += beam.glint.visible ? 1 : 0; return n; },
    /** This frame's beams, nearest the hero first: { lens, forward, length, on, light (a real light, or null) }. */
    volumes,
    /** Motes glowing now (in a beam), and where each one hangs. */
    get motes() { let n = 0; for (let i = 0; i < shown; i++) n += dustGlow[i] > 0.02 ? 1 : 0; return n; },
    get air() { return motes.map(mote => where(mote, new THREE.Vector3())); },
    beams,
  };
}
