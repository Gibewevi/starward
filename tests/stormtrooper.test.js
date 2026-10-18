import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper, collideSquad } from '../src/stormtrooper.js';
import { createImpactEffects } from '../src/impact-effects.js';
import { Ragdoll } from '../src/ragdoll.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function fixture(seed = 3) {
  const scene = new THREE.Scene();
  const effects = createImpactEffects(scene, { random: seeded(seed + 100) });
  const trooper = createStormtrooper({ scene, position: new THREE.Vector3(1, 0, 2), heading: 0.4, effects, random: seeded(seed) });
  const state = { scene, effects, trooper, time: 0 };
  state.run = seconds => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      state.time += 1 / 60;
      trooper.update(1 / 60, state.time);
      effects.update(1 / 60);
    }
  };
  // Sweeps a blade through `point`: the blade lies along `axis`, moves along
  // `motion`; it starts `before` metres short of the point and is `length` long.
  state.sweep = (point, axis, motion, speed = 6, frames = 6, { before = 0.55, length = 0.9 } = {}) => {
    axis = axis.clone().normalize(); motion = motion.clone().normalize();
    const travel = speed * frames / 60;
    const events = [];
    for (let frame = 0; frame < frames; frame++) {
      const at = f => point.clone().addScaledVector(motion, (f / frames - 0.5) * travel).addScaledVector(axis, -before);
      const base0 = at(frame), base1 = at(frame + 1);
      state.time += 1 / 60;
      trooper.update(1 / 60, state.time);
      events.push(...trooper.strike(base0, base0.clone().addScaledVector(axis, length), base1, base1.clone().addScaledVector(axis, length), 1 / 60, state.time));
      effects.update(1 / 60);
    }
    return events;
  };
  state.particle = name => trooper.particle(name).position.clone();
  state.speed = name => trooper.ragdoll.velocity(trooper.ragdoll.particles.indexOf(trooper.particle(name))).length();
  state.fastest = () => Math.max(...trooper.ragdoll.particles.map((_, index) => trooper.ragdoll.velocity(index).length()));
  // A clean cut through a joint, as the blade would make it.
  state.cut = (joint, particle) => trooper.cut(joint, { velocity: new THREE.Vector3(3, -0.5, 1), point: state.particle(particle) });
  state.local = point => trooper.root.worldToLocal(point.clone());
  state.finite = () => trooper.ragdoll.particles.every(particle => Number.isFinite(particle.position.x + particle.position.y + particle.position.z));
  state.highest = () => Math.max(...trooper.ragdoll.particles.map(particle => particle.position.y));
  return state;
}
const horizontal = (state, height, side = new THREE.Vector3(1, 0, 0)) => {
  // A flat cut across the trooper at the given height, blade pointing through him.
  const centre = state.trooper.root.position.clone().setY(height);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(state.trooper.root.quaternion);
  return state.sweep(centre.clone().addScaledVector(forward, 0.05), forward, side.clone().applyQuaternion(state.trooper.root.quaternion), 7, 8);
};

test('a complete modular stormtrooper stands at ease, rifle in hand', () => {
  const { trooper, run, highest, finite } = fixture();
  const names = ['head', 'torso', 'pelvis', 'blaster', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR'];
  for (const name of names) {
    assert.ok(trooper.parts[name].isGroup, name);
    let meshes = 0;
    trooper.parts[name].traverse(object => { if (object.isMesh && object.material) meshes++; });
    assert.ok(meshes >= 1, `${name} has its own meshes`);
  }
  const box = new THREE.Box3().setFromObject(trooper.root);
  assert.ok(box.max.y > 1.55 && box.max.y < 1.75, `height ${box.max.y}`);
  const look = [];
  for (let i = 0; i < 6; i++) { run(0.5); look.push(trooper.joints.neck.rotation.y); }
  assert.ok(Math.max(...look) - Math.min(...look) > 0.05, 'he breathes and looks around');
  assert.ok(!trooper.dead && trooper.holding && finite());
  assert.ok(highest() > 1.55, 'still upright');
  assert.ok(trooper.ragdoll.particles.every(particle => particle.kinematic), 'the pose drives every part while he stands');
});

test('a flat cut at the neck takes the head off, then he collapses to the floor', () => {
  const state = fixture();
  state.run(0.5);
  const events = horizontal(state, 1.38);
  assert.ok(events.some(event => event.type === 'cut' && event.joint === 'neck'));
  assert.ok(state.trooper.dead && state.trooper.severed.has('neck'));
  state.run(4);
  assert.ok(state.finite());
  assert.ok(state.highest() < 0.45, `lying on the floor (${state.highest()})`);
  assert.ok(state.trooper.ragdoll.particles.every(particle => particle.position.y >= particle.radius - 1e-3), 'nothing sinks through the floor');
  assert.ok(state.particle('HT').distanceTo(state.particle('SL')) > 0.3, 'the head lies apart from the shoulders');
});

test('a horizontal cut through the waist separates him in two', () => {
  const state = fixture(5);
  state.run(0.5);
  const events = horizontal(state, 0.93);
  assert.ok(events.some(event => event.joint === 'waist'), events.map(event => event.joint ?? event.type).join());
  state.run(4);
  const halves = state.trooper.ragdoll.particles.filter(particle => particle.name === 'W');
  assert.equal(halves.length, 2, 'the waist joint became two ends');
  assert.ok(halves[0].position.distanceTo(halves[1].position) > 0.12, 'the halves come apart');
  assert.ok(state.finite() && state.highest() < 0.5);
});

test('cutting a forearm leaves him standing, staggered, and drops the blaster', () => {
  const state = fixture(7);
  state.run(0.5);
  const elbow = state.particle('EL'), wrist = state.particle('WL');
  const target = elbow.clone().lerp(wrist, 0.35);
  // A short chop down across the outside of the left forearm.
  const outward = new THREE.Vector3().subVectors(target, state.particle('W')).setY(0).normalize();
  const along = new THREE.Vector3().subVectors(wrist, elbow).normalize();
  const blade = along.clone().cross(outward).normalize();
  const events = state.sweep(target.clone().addScaledVector(outward, 0.02), blade, along.clone().cross(blade).normalize(), 3, 3);
  const cut = events.find(event => event.type === 'cut' && /L$/.test(event.joint));
  assert.ok(cut && /^(elbow|wrist)L$/.test(cut.joint), events.map(event => `${event.type}:${event.joint ?? event.part}`).join());
  assert.ok(!state.trooper.dead, 'an arm wound alone does not fell him');
  assert.equal(state.trooper.holding, false, 'the blaster falls from his hands');
  const reaction = state.trooper.reaction;
  assert.ok(Math.abs(reaction.vpitch) + Math.abs(reaction.vroll) + Math.abs(reaction.vyaw) + Math.abs(reaction.pitch) > 0.01, 'he reels from the blow');
  state.run(3);
  const blaster = state.trooper.bodies.blaster.indices.map(index => state.trooper.ragdoll.particles[index].position.y);
  assert.ok(Math.max(...blaster) < 0.2, 'the blaster lies on the floor');
  const lost = state.trooper.bodies[cut.joint === 'elbowL' ? 'forearmL' : 'handL'];
  assert.ok(lost.dynamic && lost.object.parent === state.trooper.debris, 'the severed part is its own physical piece');
});

test('a slow touch of the blade only sparks; a strong leg hit brings him down', () => {
  const state = fixture(9);
  state.run(0.5);
  const torso = state.particle('W').lerp(state.particle('N'), 0.5);
  const slow = state.sweep(torso, new THREE.Vector3(0, 0, 1).applyQuaternion(state.trooper.root.quaternion), new THREE.Vector3(1, 0, 0), 0.8, 6);
  assert.ok(slow.every(event => event.type === 'graze'), 'no cut at walking pace');
  assert.ok(!state.trooper.dead && state.trooper.severed.size === 0);
  assert.ok(state.effects.live > 0, 'it sizzles');
  state.run(1);
  const knee = state.particle('KR'), ankle = state.particle('AR');
  const shin = knee.clone().lerp(ankle, 0.7);
  const events = state.sweep(shin, new THREE.Vector3(0, 0, 1).applyQuaternion(state.trooper.root.quaternion), new THREE.Vector3(1, 0, 0).applyQuaternion(state.trooper.root.quaternion), 6, 6);
  assert.ok(events.some(event => event.type === 'armor' || event.type === 'slash' || event.type === 'cut'));
  assert.ok(state.trooper.fallen, 'he falls');
  assert.ok(!state.trooper.dead, 'a leg wound alone does not kill him');
});

test('falls differ with the blow', () => {
  const ends = [1.38, 0.93, 0.6].map((height, i) => {
    const state = fixture(11 + i);
    state.run(0.5);
    horizontal(state, height);
    state.run(3);
    return state.particle('HT');
  });
  assert.ok(ends[0].distanceTo(ends[1]) > 0.1 && ends[1].distanceTo(ends[2]) > 0.1, 'different cuts, different resting poses');
});

test('reset puts him back together, intact and armed', () => {
  const state = fixture(13);
  state.run(0.3);
  horizontal(state, 0.93);
  horizontal(state, 1.38);
  state.run(1);
  state.trooper.reset();
  state.effects.clear();
  state.run(0.5);
  assert.ok(!state.trooper.dead && state.trooper.holding && state.trooper.severed.size === 0);
  assert.equal(state.trooper.debris.children.length, 0);
  for (const part of Object.values(state.trooper.parts)) assert.ok(part.parent && part.parent !== state.trooper.debris && part.matrixAutoUpdate);
  assert.ok(state.highest() > 1.55 && state.finite());
  assert.equal(state.scene.children.filter(child => child.name === 'Stormtrooper').length, 1, 'no leftover copy in the scene');
});

test('cut ends glow white-hot, then cool down', () => {
  const state = fixture(17);
  state.run(0.3);
  horizontal(state, 1.38);
  const ring = state.trooper.caps.neck[0].ring.material.color;
  assert.ok(state.trooper.caps.neck.every(({ cap }) => cap.visible));
  assert.ok(ring.r > 1.5, 'hot');
  state.run(6);
  assert.ok(ring.r < 0.1, 'scorched');
});

test('ragdoll joints stay attached and limbs keep their length', () => {
  const ragdoll = new Ragdoll();
  const point = (x, y, z) => ragdoll.addParticle({ position: new THREE.Vector3(x, y, z) });
  const a = point(0, 1, 0), b = point(0, 0.6, 0), c = point(0.1, 0.8, 0), d = point(0, 0.2, 0), e = point(0.1, 0.4, 0);
  const upper = ragdoll.addBody({ name: 'upper', indices: [a, b, c] });
  const lower = ragdoll.addBody({ name: 'lower', indices: [b, d, e] });
  ragdoll.release([upper, lower]);
  ragdoll.push([d], new THREE.Vector3(3, 2, 0));
  for (let i = 0; i < 240; i++) ragdoll.step(1 / 60);
  const p = index => ragdoll.particles[index].position;
  assert.ok(Math.abs(p(a).distanceTo(p(b)) - 0.4) < 0.01 && Math.abs(p(b).distanceTo(p(d)) - 0.4) < 0.01);
  assert.ok(ragdoll.particles.every(particle => particle.position.y >= particle.radius - 1e-3));
  const free = ragdoll.sever(b, [lower]);
  ragdoll.push([d], new THREE.Vector3(0, 4, 0));
  for (let i = 0; i < 30; i++) ragdoll.step(1 / 60);
  assert.ok(p(free).distanceTo(p(b)) > 0.05, 'a severed joint lets go');
});

test('the saber cuts like butter: the arm comes away and lands near him while he staggers back on his feet', () => {
  const state = fixture(21);
  state.run(0.5);
  const { trooper } = state;
  const shoulder = state.particle('SL'), elbow = state.particle('EL');
  const target = shoulder.clone().lerp(elbow, 0.6);
  const before = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  // A short chop with the end of the blade, through that arm only.
  const events = state.sweep(target, new THREE.Vector3(0, -1, 1), new THREE.Vector3(-1, 0, 0).applyQuaternion(trooper.root.quaternion), 3, 3, { before: 0.3, length: 0.42 });
  assert.ok(events.some(event => event.type === 'cut' && /^(shoulder|elbow)L$/.test(event.joint)), events.map(event => `${event.type}:${event.joint ?? event.part}`).join());
  // Slowed frames, as during a hit stop, then normal time.
  for (let i = 0; i < 5; i++) { state.time += 0.0013; trooper.update(0.0013, state.time); }
  state.run(3);
  assert.ok(!trooper.dead, 'one arm lost does not fell him');
  const after = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  assert.ok(before.distanceTo(after) > 0.05 && before.distanceTo(after) < 0.8, `the blow shoves him back a little, he is not thrown (${before.distanceTo(after).toFixed(2)} m)`);
  for (const name of ['upperArmL', 'forearmL', 'handL']) {
    for (const index of trooper.bodies[name].indices) {
      const p = trooper.ragdoll.particles[index].position;
      assert.ok(Math.hypot(p.x - after.x, p.z - after.z) < 1.5, `${name} lands near him`);
    }
  }
  assert.ok(trooper.reaction.hurt > 0.9, 'he hunches over the wound');
  const hand = trooper.joints.wristR.getWorldPosition(new THREE.Vector3());
  const joint = trooper.severed.has('shoulderL') ? 'shoulderL' : 'elbowL';
  assert.ok(hand.distanceTo(trooper.caps[joint][0].cap.getWorldPosition(new THREE.Vector3())) < 0.12, 'his other hand presses on the stump');
});

test('sparks streak through the air, land, and glow on the floor before going out', () => {
  const scene = new THREE.Scene();
  const effects = createImpactEffects(scene, { random: seeded(31) });
  effects.sparks(new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), { count: 70, speed: 5 });
  effects.update(1 / 60);
  const lengths = [];
  const streak = effects.streaks.geometry.attributes.position;
  for (let i = 0; i < 70; i++) lengths.push(new THREE.Vector3().fromBufferAttribute(streak, i * 2).distanceTo(new THREE.Vector3().fromBufferAttribute(streak, i * 2 + 1)));
  assert.ok(lengths.filter(length => length > 0.03).length > 30, 'flying sparks are streaks, not squares');
  for (let i = 0; i < 90; i++) effects.update(1 / 60);
  assert.ok(effects.resting > 20, `many lie glowing on the floor (${effects.resting})`);
  const beads = effects.beads.geometry.attributes.position;
  for (let i = 0; i < 70; i++) assert.ok(beads.getY(i) >= 0, 'nothing falls through the floor');
  for (let i = 0; i < 60; i++) effects.update(1 / 60);
  assert.ok(effects.live > 10, 'they take their time to fade');
  for (let i = 0; i < 360; i++) effects.update(1 / 60);
  assert.equal(effects.live, 0, 'and finally go out');
});

test('a severed hand: he drops the rifle, draws the stump in and holds his wrist', () => {
  const state = fixture(23);
  state.run(0.5);
  const { trooper } = state;
  state.cut('wristL', 'WL');
  assert.equal(trooper.holding, false, 'the rifle falls');
  state.run(2.5);
  assert.equal(trooper.state, 'wounded');
  assert.ok(!trooper.fallen, 'he stays on his feet');
  const stump = trooper.caps.wristL[0].cap.getWorldPosition(new THREE.Vector3());
  const local = state.local(stump);
  assert.ok(local.z > 0.12 && Math.abs(local.x) < 0.18 && local.y > 0.8 && local.y < 1.3, `the stump is held in front of his belly (${local.toArray().map(v => v.toFixed(2))})`);
  const grip = trooper.joints.wristR.getWorldPosition(new THREE.Vector3());
  assert.ok(grip.distanceTo(stump) < 0.1, `his right hand holds the wrist (${grip.distanceTo(stump).toFixed(2)} m)`);
  assert.ok(trooper.reaction.hurt > 0.9, 'hunched over it');
  const blaster = trooper.bodies.blaster.indices.map(index => trooper.ragdoll.particles[index].position.y);
  assert.ok(Math.max(...blaster) < 0.2, 'the rifle lies on the floor');
});

test('a severed leg: he falls alive, turns face down and crawls on his elbows until he gives out', () => {
  const state = fixture(25);
  state.run(0.5);
  const { trooper } = state;
  state.cut('kneeL', 'KL');
  assert.ok(trooper.fallen && !trooper.dead, 'he falls, alive');
  state.run(3.5);
  assert.equal(trooper.state, 'crawling');
  const start = state.particle('W');
  const sides = new Set();
  let chest = 0, frames = 0;
  for (let i = 0; i < 240; i++) {
    state.run(1 / 60);
    if (trooper.crawl?.stroke) sides.add(trooper.crawl.stroke.side);
    chest += state.particle('N').y; frames++;
  }
  const travelled = state.particle('W').setY(0).distanceTo(start.setY(0));
  assert.ok(travelled > 0.3, `he drags himself along (${travelled.toFixed(2)} m in 4 s)`);
  assert.deepEqual([...sides].sort(), ['L', 'R'], 'one arm then the other');
  assert.ok(chest / frames > 0.13, `chest raised on his elbows (${(chest / frames).toFixed(2)} m)`);
  const front = new THREE.Vector3().subVectors(state.particle('SL'), state.particle('SR')).cross(new THREE.Vector3().subVectors(state.particle('N'), state.particle('W'))).normalize();
  assert.ok(front.y < -0.5, `face down (${front.y.toFixed(2)})`);
  assert.ok(state.highest() < 0.65, 'low to the floor');
  state.run(16);
  assert.ok(trooper.dead, 'he gives out');
  state.run(3);
  assert.ok(state.fastest() < 0.15 && state.finite(), `and lies still (${state.fastest().toFixed(2)} m/s)`);
});

test('beheaded, the body stays up a heartbeat, collapses, twitches, then lies still', () => {
  const state = fixture(27);
  state.run(0.5);
  const { trooper } = state;
  horizontal(state, 1.38);
  assert.ok(trooper.dead && trooper.severed.has('neck'));
  assert.ok(!trooper.fallen && state.particle('N').y > 1.15, 'still on his feet for a moment');
  state.run(0.6);
  assert.ok(trooper.fallen, 'then he collapses');
  state.run(0.8);
  const limbs = ['WL', 'WR', 'HTL', 'HTR', 'AL', 'AR', 'TL', 'TR'];
  let twitching = 0;
  for (let i = 0; i < 120; i++) {
    state.run(1 / 60);
    if (limbs.some(name => state.speed(name) > 0.4)) twitching++;
  }
  assert.ok(twitching > 20, `his limbs twitch for seconds (${twitching} of 120 frames)`);
  state.run(4);
  assert.ok(state.fastest() < 0.15 && state.finite(), `then lie still (${state.fastest().toFixed(2)} m/s)`);
});

test('a corpse still reacts to the blade', () => {
  const state = fixture(29);
  state.run(0.5);
  const { trooper } = state;
  horizontal(state, 1.38);
  state.run(9);
  assert.ok(state.fastest() < 0.15, 'at rest');
  const torso = state.particle('W').lerp(state.particle('N'), 0.5);
  const before = state.particle('W');
  state.sweep(torso.clone().setY(torso.y + 0.3), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0.3), 5, 4);
  assert.ok(trooper.spasm, 'its nerves twitch');
  let moved = 0;
  for (let i = 0; i < 30; i++) { state.run(1 / 60); moved = Math.max(moved, state.particle('W').distanceTo(before)); }
  assert.ok(moved > 0.02, `the body is jolted (${moved.toFixed(3)} m)`);
  state.run(3);
  assert.ok(state.fastest() < 0.15 && state.finite());
});

test('standing, he answers each hit where it lands', () => {
  const head = fixture(31);
  head.run(0.5);
  const quaternion = head.trooper.root.quaternion;
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion), forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  // A slow touch of the blade's tip across his helmet: his head snaps along it.
  const helmet = head.particle('N').lerp(head.particle('HT'), 0.6).addScaledVector(side, -0.1);
  const touch = head.sweep(helmet, forward, side, 1.6, 4, { before: 0.12, length: 0.24 });
  assert.ok(touch.some(event => event.part === 'head') && touch.every(event => ['graze', 'armor'].includes(event.type)), touch.map(event => `${event.type}:${event.part}`).join());
  const r = head.trooper.reaction;
  assert.ok(Math.abs(r.vheadYaw) + Math.abs(r.headYaw) > 0.2, 'the head turns with the blow');

  const arm = fixture(33);
  arm.run(0.5);
  const target = arm.particle('SL').lerp(arm.particle('EL'), 0.5).addScaledVector(side, 0.04);
  const events = arm.sweep(target, forward, side.clone().negate(), 1.6, 4, { before: 0.12, length: 0.24 });
  assert.ok(events.some(event => event.part === 'upperArmL') && events.every(event => ['graze', 'armor'].includes(event.type)), events.map(event => `${event.type}:${event.part}`).join());
  const a = arm.trooper.reaction;
  assert.ok(Math.abs(a.varmL) + Math.abs(a.vflareL) > 0.3, 'that arm is flung');
  assert.equal(a.varmR, 0, 'the other one is not');
  assert.ok(Math.abs(a.vheadYaw) < 1e-6, 'nor is his head');

  const leg = fixture(35);
  leg.run(0.5);
  const shin = leg.particle('KR').lerp(leg.particle('AR'), 0.5).addScaledVector(side, -0.05);
  const kicks = leg.sweep(shin, forward, side, 1.6, 4, { before: 0.12, length: 0.24 });
  assert.ok(kicks.some(event => event.part === 'shinR'), kicks.map(event => `${event.type}:${event.part}`).join());
  const l = leg.trooper.reaction;
  assert.ok(l.vdipR + l.dipR > 0.1 && Math.abs(l.vdipL) < 1e-6, 'the struck leg gives');
  leg.run(0.4);
  const ankle = leg.trooper.joints.ankleR.getWorldPosition(new THREE.Vector3());
  assert.ok(ankle.y < 0.12, 'his feet stay planted');
});

// Cuts a joint with a blade moving at `velocity`, lying along `direction`, and
// follows the severed body through its flight.
function throwPiece({ joint, particle, body, velocity, direction = new THREE.Vector3(0, 1, 0), seed = 41 }) {
  const state = fixture(seed);
  state.run(0.4);
  const { trooper } = state;
  const piece = () => trooper.bodies[body].indices.map(index => trooper.ragdoll.particles[index].position);
  const centre = () => piece().reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(piece().length);
  const frame = () => new THREE.Quaternion().setFromRotationMatrix(trooper.ragdoll.frame(trooper.bodies[body], new THREE.Matrix4()));
  const pelvis = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  trooper.cut(joint, { velocity, point: state.particle(particle), direction: direction.clone().normalize() });
  const start = centre();
  let peak = start.y, turned = 0, previous = frame(), airborne = 0;
  for (let i = 0; i < 180; i++) {
    state.run(1 / 60);
    const c = centre();
    peak = Math.max(peak, c.y);
    const now = frame();
    turned += previous.angleTo(now);
    previous = now;
    if (Math.min(...piece().map(p => p.y)) > 0.08) airborne++;
  }
  const end = centre();
  return { state, trooper, start, end, peak, turned, airborne, pelvis, travel: end.clone().setY(0).sub(start.clone().setY(0)) };
}

test('a severed hand is thrown up in an arc, tumbling, and lands near him', () => {
  const sweep = new THREE.Vector3(6, 0, 0);
  const result = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: sweep });
  assert.ok(result.peak > result.start.y + 0.2, `it rises (${(result.peak - result.start.y).toFixed(2)} m)`);
  assert.ok(result.airborne > 15, `and stays in the air a while (${result.airborne} frames)`);
  assert.ok(result.turned > Math.PI, `spinning (${(result.turned * 180 / Math.PI).toFixed(0)}°)`);
  const distance = result.travel.length();
  assert.ok(distance > 0.5 && distance < 2.5, `lands near him, not at his feet nor across the room (${distance.toFixed(2)} m)`);
  assert.ok(result.travel.dot(sweep) > 0, 'carried along the blade\'s swing');
  assert.ok(result.end.y < 0.15, 'on the floor');
  const still = Math.max(...result.trooper.bodies.handL.indices.map(index => result.trooper.ragdoll.velocity(index).length()));
  assert.ok(still < 0.1, `then at rest (${still.toFixed(2)} m/s)`);
  assert.ok(result.state.finite());
  assert.ok(result.trooper.joints.pelvis.getWorldPosition(new THREE.Vector3()).distanceTo(result.pelvis) < 0.1, 'he is not thrown with it');
});

test('the throw follows the blade: its direction, its speed and its angle', () => {
  const right = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(6, 0, -1) });
  const left = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(-6, 0, -1) });
  assert.ok(right.travel.x > 0.3 && left.travel.x < right.travel.x - 0.6, `swung right, it flies right; swung left, left (${right.travel.x.toFixed(2)} / ${left.travel.x.toFixed(2)})`);
  const slow = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(2.4, 0, 0) });
  assert.ok(slow.travel.length() < right.travel.length() - 0.3, 'a slow cut throws it less far');
  const upswing = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(3, 6, 0), direction: new THREE.Vector3(0, 0, 1) });
  const chop = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(1, -7, 0.5), direction: new THREE.Vector3(0, 0, 1) });
  assert.ok(upswing.peak - upswing.start.y > 0.5, `an upswing sends it high (${(upswing.peak - upswing.start.y).toFixed(2)} m)`);
  assert.ok(chop.peak - chop.start.y < 0.2 && chop.travel.length() > 0.3, 'a downward chop makes it skip low, never just drop');
  const again = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: new THREE.Vector3(6, 0, -1), seed: 77 });
  assert.ok(again.end.distanceTo(right.end) > 0.05 && again.end.distanceTo(right.end) < 0.8, 'the same blow lands a little differently each time');
});

test('light pieces fly further than heavy ones', () => {
  const sweep = new THREE.Vector3(6, 0, 0);
  const hand = throwPiece({ joint: 'wristL', particle: 'WL', body: 'handL', velocity: sweep });
  const arm = throwPiece({ joint: 'shoulderL', particle: 'SL', body: 'upperArmL', velocity: sweep });
  const leg = throwPiece({ joint: 'hipL', particle: 'HL', body: 'thighL', velocity: sweep });
  assert.ok(hand.travel.length() > arm.travel.length() + 0.3, `a hand flies, a whole arm less (${hand.travel.length().toFixed(2)} / ${arm.travel.length().toFixed(2)})`);
  assert.ok(leg.peak - leg.start.y < hand.peak - hand.start.y, 'a leg barely leaves the ground');
});

test('every hit flashes the struck armour, and a clean cut flares', () => {
  const state = fixture(43);
  state.run(0.4);
  const { trooper, effects } = state;
  const torso = state.particle('W').lerp(state.particle('N'), 0.5);
  state.sweep(torso, new THREE.Vector3(0, 0, 1).applyQuaternion(trooper.root.quaternion), new THREE.Vector3(1, 0, 0), 1.6, 3);
  const glowing = () => { let most = 0; trooper.parts.torso.traverse(child => { if (child.isMesh && child.material.emissive) most = Math.max(most, child.material.emissive.r); }); return most; };
  assert.ok(glowing() > 0.05, 'the armour flashes');
  state.run(0.4);
  assert.equal(glowing(), 0, 'and fades back');
  let cloned = 0;
  trooper.parts.head.traverse(child => { if (child.userData.ownMaterial) cloned++; });
  assert.equal(cloned, 0, 'untouched parts keep their shared materials');
  horizontal(state, 1.38);
  state.effects.update(1 / 60);
  assert.ok(effects.bursts > 0, 'a flare and a ring of light');
  state.run(0.6);
  assert.equal(effects.bursts, 0, 'gone in a blink');
});

// A trooper alone, facing the hero at the origin, with a clock and a log of his states.
function standAlone(seed, z = 3) {
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(0, 0, z), heading: Math.PI, random: seeded(seed) });
  trooper.focus = new THREE.Vector3(0, 0, 0);
  const state = { trooper, time: 0, states: [] };
  state.run = seconds => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      state.time += 1 / 60;
      trooper.update(1 / 60, state.time);
      if (state.states.at(-1) !== trooper.state) state.states.push(trooper.state);
    }
  };
  state.run(0.3);
  return state;
}

test('a Force push throws him off his feet: he tumbles, slides, lies stunned, gets up and sways — alive', () => {
  const { trooper, run, states } = standAlone(3);
  const start = trooper.particle('W').position.clone();
  trooper.forcePush(new THREE.Vector3(0, 3, 7.5));
  assert.ok(trooper.fallen && !trooper.dead, 'off his feet, not killed');
  let peak = 0, travel = 0;
  for (let i = 0; i < 90; i++) {
    run(1 / 60);
    peak = Math.max(peak, trooper.particle('W').position.y);
  }
  travel = trooper.particle('W').position.clone().setY(0).distanceTo(start.clone().setY(0));
  assert.ok(peak > 0.6, `thrown up (${peak.toFixed(2)} m)`);
  assert.ok(travel > 2, `and back (${travel.toFixed(2)} m)`);
  run(9);
  assert.ok(!trooper.dead && !trooper.fallen, `back on his feet: ${states.join(' > ')}`);
  for (const state of ['stunned', 'rising', 'dazed']) assert.ok(states.includes(state), `${state} on the way: ${states.join(' > ')}`);
  for (const [name, part] of Object.entries(trooper.parts)) if (name !== 'blaster') assert.ok(part.parent !== trooper.debris && part.matrixAutoUpdate, `${name} is his again`);
  assert.ok(trooper.bodies.torso.indices.every(index => trooper.ragdoll.particles[index].kinematic), 'the pose drives him again');
  const pelvis = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  assert.ok(pelvis.y > 0.75, `standing tall (${pelvis.y.toFixed(2)} m)`);
  assert.ok(trooper.ragdoll.particles.every(particle => Number.isFinite(particle.position.x + particle.position.y + particle.position.z)));
});

test('knocked down near his rifle, he gets up and picks it up', () => {
  const { trooper, run, states } = standAlone(5);
  trooper.forcePush(new THREE.Vector3(0, 1.6, 2.2));
  assert.equal(trooper.holding, false, 'the rifle flies from his hands');
  run(10);
  assert.ok(states.includes('rearming'), states.join(' > '));
  assert.ok(trooper.holding && trooper.parts.blaster.parent?.name === 'Blaster holder', 'the rifle is back in his hands');
  assert.equal(trooper.state, 'standing');
});

test('a Force pull: explosive start, very fast, slowing right down in front of the hero', () => {
  const { trooper, run } = standAlone(7, 6);
  const stop = new THREE.Vector3(0, 0, 1.15);
  assert.ok(trooper.forcePull(stop));
  assert.equal(trooper.state, 'pulled');
  const speeds = [];
  let last = trooper.root.position.clone().setY(0);
  for (let i = 0; i < 50; i++) {
    run(1 / 60);
    const now = trooper.root.position.clone().setY(0);
    speeds.push(now.distanceTo(last) * 60);
    last = now;
  }
  const top = Math.max(...speeds), at = speeds.indexOf(top);
  assert.ok(at <= 6 && top > 12, `bursts to ${top.toFixed(1)} m/s within ${at} frames`);
  assert.ok(speeds[0] < top * 0.5, 'but builds up over a few frames rather than jumping');
  const moving = speeds.filter(speed => speed > 0.05);
  assert.ok(moving.at(-1) < top * 0.1, 'slows right down on arrival');
  for (let i = at + 1; i < moving.length; i++) assert.ok(moving[i] <= moving[i - 1] + 0.05, 'decelerating all the way');
  run(1.5);
  const landed = trooper.fallen ? trooper.particle('W').position.clone().setY(0) : trooper.root.position.clone().setY(0);
  assert.ok(landed.distanceTo(stop) < (trooper.fallen ? 1.2 : 0.1), `lands before the hero (${landed.distanceTo(stop).toFixed(2)} m off)`);
  assert.ok(!trooper.dead);
});

test('a body on the floor is hauled in by the Force', () => {
  const state = fixture(37);
  state.run(0.5);
  horizontal(state, 1.38);
  state.run(5);
  const { trooper } = state;
  const before = state.particle('W');
  const to = trooper.root.position.clone().add(new THREE.Vector3(3, 0, 0));
  assert.ok(trooper.forcePull(to));
  state.run(2);
  const after = state.particle('W');
  assert.ok(after.x - before.x > 1.5, `dragged across the floor (${(after.x - before.x).toFixed(2)} m)`);
  assert.ok(state.finite());
});

test('his armour comes apart progressively and the pieces fly, bounce and come to rest', () => {
  const state = fixture(41);
  state.run(0.4);
  const { trooper } = state;
  const full = trooper.armour;
  assert.equal(full, 19, 'a full suit: helmet, plates, belt, pauldrons, guards');
  const counts = [full];
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(trooper.root.quaternion), forward = new THREE.Vector3(0, 0, 1).applyQuaternion(trooper.root.quaternion);
  for (let i = 0; i < 6; i++) {
    // Slow touches across his chest and arms: they scorch, they do not cut.
    const point = state.particle('W').lerp(state.particle('N'), 0.3 + i * 0.1).addScaledVector(side, (i % 3 - 1) * 0.15);
    state.sweep(point, forward, side, 1.8, 4, { before: 0.3, length: 0.45 });
    state.run(0.4);
    counts.push(trooper.armour);
  }
  assert.ok(counts.at(-1) < full - 1, `pieces come off one blow after another (${counts.join(' → ')})`);
  assert.ok(!trooper.dead && !trooper.fallen && trooper.severed.size === 0, 'without a cut');
  const loose = trooper.ragdoll.bodies.filter(body => body.debris);
  assert.ok(loose.length >= full - counts.at(-1));
  state.run(3);
  for (const body of loose) for (const index of body.indices) assert.ok(trooper.ragdoll.particles[index].position.y < 0.25, 'each piece lies on the floor');
  assert.ok(state.finite());
});

test('no two sprays of sparks are alike', () => {
  const state = fixture(43);
  state.run(0.4);
  const counts = [];
  const sparks = state.effects.sparks;
  state.effects.sparks = (...args) => { counts.push(args[3]?.count); return sparks(...args); };
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(state.trooper.root.quaternion), side = new THREE.Vector3(1, 0, 0).applyQuaternion(state.trooper.root.quaternion);
  for (let i = 0; i < 6; i++) {
    state.sweep(state.particle('W').lerp(state.particle('N'), 0.5), forward, side, 1.6, 4, { before: 0.3, length: 0.45 });
    state.run(0.4);
  }
  assert.ok(counts.length >= 5 && new Set(counts).size >= 4, `spark counts: ${counts.join(', ')}`);
});

test('a body thrown into a standing trooper knocks him over', () => {
  const scene = new THREE.Scene();
  const thrown = createStormtrooper({ scene, position: new THREE.Vector3(0, 0, 0), heading: 0, random: seeded(4) });
  const standing = createStormtrooper({ scene, position: new THREE.Vector3(0, 0, 1.4), heading: 0, random: seeded(6) });
  let time = 0;
  const run = seconds => { for (let frame = 0; frame < Math.round(seconds * 60); frame++) { time += 1 / 60; thrown.update(1 / 60, time); standing.update(1 / 60, time); collideSquad([thrown, standing]); } };
  run(0.3);
  thrown.forcePush(new THREE.Vector3(0, 2.5, 7));
  run(1.5);
  assert.ok(standing.fallen && !standing.dead, 'bowled over, alive');
});

// A blade swept straight across at `height`, moving along +x at about 7 m/s.
function sweepAcross(trooper, clock, height, frames = 8) {
  const events = [];
  for (let frame = 0; frame < frames; frame++) {
    const x0 = -0.5 + frame * 0.12, x1 = x0 + 0.12;
    clock.time += 1 / 60;
    trooper.update(1 / 60, clock.time);
    events.push(...trooper.strike(new THREE.Vector3(x0, height, -0.5), new THREE.Vector3(x0, height, 0.5), new THREE.Vector3(x1, height, -0.5), new THREE.Vector3(x1, height, 0.5), 1 / 60, clock.time));
  }
  return events;
}

test('blows move him: a hit shoves him back and turns him, a felled body is thrown along the blade', () => {
  const clock = { time: 0 };
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(0, 0, 0), heading: 0, random: seeded(53) });
  const run = seconds => { for (let frame = 0; frame < Math.round(seconds * 60); frame++) { clock.time += 1 / 60; trooper.update(1 / 60, clock.time); } };
  run(0.3);
  // A slash across his chest, short of killing: he is shoved along it.
  const events = [];
  for (let frame = 0; frame < 4; frame++) {
    const x0 = 0.02 + frame * 0.05, x1 = x0 + 0.05;
    clock.time += 1 / 60;
    trooper.update(1 / 60, clock.time);
    events.push(...trooper.strike(new THREE.Vector3(x0, 1.15, 0.25), new THREE.Vector3(x0, 1.15, -0.2), new THREE.Vector3(x1, 1.15, 0.25), new THREE.Vector3(x1, 1.15, -0.2), 1 / 60, clock.time));
  }
  assert.ok(events.some(event => event.type === 'slash') && !trooper.fallen, events.map(event => event.type).join());
  const heading = trooper.root.rotation.y;
  run(0.8);
  assert.ok(trooper.root.position.x > 0.2, `shoved along the blade (${trooper.root.position.x.toFixed(2)} m)`);
  assert.ok(Math.abs(trooper.root.rotation.y - heading) > 0.02 || Math.abs(trooper.root.rotation.y) > 0.02, 'and turned');
  // Cut down at the knees by the same sweep: the body goes with the blow.
  const felled = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(0, 0, 0), heading: 0, random: seeded(55) });
  const clock2 = { time: 0 };
  for (let frame = 0; frame < 18; frame++) { clock2.time += 1 / 60; felled.update(1 / 60, clock2.time); }
  const cuts = sweepAcross(felled, clock2, 0.6);
  assert.ok(cuts.some(event => event.type === 'cut') && felled.fallen);
  for (let frame = 0; frame < 180; frame++) { clock2.time += 1 / 60; felled.update(1 / 60, clock2.time); }
  const body = felled.particle('W').position;
  assert.ok(body.x > 1, `not where it was struck: thrown ${body.x.toFixed(2)} m along the blow`);
  assert.ok(body.x < 4, 'nor across the room');
});

test('held by the Force he hangs before the hero, following him; let go, he drops onto his feet and runs away', () => {
  const { trooper, run, states } = standAlone(9, 5);
  const point = new THREE.Vector3(0, 0.5, 1.25);
  assert.ok(trooper.forcePull(point.clone(), { hold: true }));
  for (let frame = 0; frame < 60; frame++) { trooper.hold(point, Math.PI); run(1 / 60); }
  assert.equal(trooper.state, 'held');
  assert.ok(trooper.root.position.distanceTo(point) < 0.15 && trooper.root.position.y > 0.35, 'up in the air before the hero');
  // The hero moves: the trooper follows, still held.
  for (let frame = 0; frame < 40; frame++) { point.x = Math.min(1, frame / 20); trooper.hold(point, Math.PI); run(1 / 60); }
  assert.ok(trooper.root.position.distanceTo(point) < 0.2, `he follows (${trooper.root.position.distanceTo(point).toFixed(2)} m off)`);
  // Struck while held, he reacts but stays in the Force's grip.
  const blade = trooper.particle('W').position.clone().lerp(trooper.particle('N').position, 0.5);
  const events = [];
  for (let frame = 0; frame < 3; frame++) {
    trooper.hold(point, Math.PI);
    run(1 / 60);
    const x0 = blade.x - 0.12 + frame * 0.04;
    events.push(...trooper.strike(new THREE.Vector3(x0, blade.y, blade.z - 0.4), new THREE.Vector3(x0, blade.y, blade.z + 0.4), new THREE.Vector3(x0 + 0.04, blade.y, blade.z - 0.4), new THREE.Vector3(x0 + 0.04, blade.y, blade.z + 0.4), 1 / 60, 99 + frame));
  }
  assert.ok(events.length > 0, 'the blade reaches him');
  for (let frame = 0; frame < 30; frame++) { trooper.hold(point, Math.PI); run(1 / 60); }
  assert.equal(trooper.state, 'held');
  // Let go.
  trooper.drop();
  const start = trooper.root.position.clone().setY(0);
  run(0.6);
  assert.ok(trooper.root.position.y === 0 && !trooper.fallen, 'back on his feet');
  run(2.5);
  assert.ok(states.includes('fleeing'), states.join(' > '));
  const away = trooper.root.position.clone().setY(0).sub(start);
  assert.ok(away.length() > 2.5 && away.dot(start.clone().normalize()) > 0, `he ran away from the hero (${away.length().toFixed(2)} m)`);
  run(2);
  assert.ok(['standing', 'dazed', 'wounded'].includes(trooper.state), trooper.state);
  const toHero = Math.atan2(-trooper.root.position.x, -trooper.root.position.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(toHero - trooper.root.rotation.y), Math.cos(toHero - trooper.root.rotation.y))) < 0.4, 'then turns back to face the hero');
});

test('caught by the Force pull he drops his rifle, clutches his throat and struggles frantically', () => {
  const { trooper, run } = standAlone(61, 5);
  const point = new THREE.Vector3(0, 0.5, 1.25);
  assert.ok(trooper.holding);
  trooper.forcePull(point.clone(), { hold: true });
  assert.equal(trooper.holding, false, 'the rifle falls as his hands go to his throat');
  run(1);
  assert.equal(trooper.state, 'held');
  const throat = trooper.joints.spine.localToWorld(new THREE.Vector3(0, 0.29, 0.1));
  for (const side of ['L', 'R']) {
    const wrist = trooper.joints[`wrist${side}`].getWorldPosition(new THREE.Vector3());
    assert.ok(wrist.distanceTo(throat) < 0.16, `${side} hand at his throat (${wrist.distanceTo(throat).toFixed(2)} m)`);
  }
  // He fights: head, body and legs keep moving, fast and irregularly.
  const samples = { hip: [], knee: [], neck: [], spine: [], pelvisYaw: [], pelvisPitch: [] };
  for (let frame = 0; frame < 90; frame++) {
    run(1 / 60);
    samples.hip.push(trooper.joints.hipL.rotation.x);
    samples.knee.push(trooper.joints.kneeR.rotation.x);
    samples.neck.push(trooper.joints.neck.rotation.y);
    samples.spine.push(trooper.joints.spine.rotation.z);
    samples.pelvisYaw.push(trooper.joints.pelvis.rotation.y);
    samples.pelvisPitch.push(trooper.joints.pelvis.rotation.x);
  }
  const range = values => Math.max(...values) - Math.min(...values);
  const reversals = values => values.slice(2).filter((value, i) => Math.sign(value - values[i + 1]) !== Math.sign(values[i + 1] - values[i])).length;
  assert.ok(range(samples.hip) > 0.25 && range(samples.knee) > 0.25, `the legs kick (${range(samples.hip).toFixed(2)}, ${range(samples.knee).toFixed(2)} rad)`);
  const kicks = reversals(samples.hip) / 1.5;
  assert.ok(kicks >= 2 && kicks <= 7, `at a struggling pace, not a blur: ${kicks.toFixed(1)} changes of direction a second`);
  assert.ok(range(samples.pelvisYaw) > 0.2 && range(samples.pelvisPitch) > 0.15, `the hips twist and thrust (${range(samples.pelvisYaw).toFixed(2)}, ${range(samples.pelvisPitch).toFixed(2)} rad)`);
  assert.ok(range(samples.neck) > 0.15 && range(samples.spine) > 0.15, 'the head jerks and the chest writhes');
  // Let go: the hands leave his throat.
  trooper.drop();
  run(1.2);
  assert.ok(trooper.reaction.choke < 0.05, 'he breathes again');
});

test('thrown by the Force he stays alive in every limb: braced in the air, squirming on the floor — unlike the dead', () => {
  // How much his limbs move relative to his trunk, over a stretch of time.
  const limbMotion = (trooper, run, seconds) => {
    const rel = () => ['WL', 'WR', 'AL', 'AR', 'HT'].map(name => trooper.particle(name).position.clone().sub(trooper.particle('W').position));
    let total = 0, last = rel();
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      run(1 / 60);
      const now = rel();
      total += now.reduce((sum, v, i) => sum + v.distanceTo(last[i]), 0);
      last = now;
    }
    return total;
  };
  const alive = standAlone(71, 3);
  alive.trooper.forcePush(new THREE.Vector3(0, 3, 6));
  const flight = limbMotion(alive.trooper, alive.run, 0.5);
  // While airborne his arms come out in front of him, to break the fall.
  alive.run(0.6);
  const lying = limbMotion(alive.trooper, alive.run, 1);
  assert.ok(['stunned', 'rising'].includes(alive.trooper.state), alive.trooper.state);
  const dead = standAlone(71, 3);
  dead.trooper.die('slash');
  dead.run(0.4);
  dead.trooper.forcePush(new THREE.Vector3(0, 3, 6));
  dead.run(0.5);
  dead.run(0.6);
  const still = limbMotion(dead.trooper, dead.run, 1);
  assert.ok(lying > still * 3 && lying > 0.5, `alive, he squirms on the floor (${lying.toFixed(2)} vs ${still.toFixed(2)} for the dead)`);
  assert.ok(flight > 0.5, `and works his limbs in the air (${flight.toFixed(2)})`);
});

test('pulled while down but alive, he is hauled to his feet first, then brought in', () => {
  const { trooper, run } = standAlone(73, 3);
  trooper.forcePush(new THREE.Vector3(0, 2, 4));
  run(1.5);
  assert.ok(trooper.fallen && !trooper.dead, trooper.state);
  const point = new THREE.Vector3(0, 0.5, 1.25);
  assert.ok(trooper.forcePull(point.clone(), { hold: true }));
  assert.equal(trooper.state, 'pulled');
  let tallest = 0;
  for (let frame = 0; frame < 30; frame++) { run(1 / 60); tallest = Math.max(tallest, trooper.particle('N').position.y - trooper.particle('W').position.y); }
  assert.ok(!trooper.fallen, 'upright again within half a second');
  assert.ok(tallest > 0.3, 'his trunk stands up (not dragged lying)');
  for (let frame = 0; frame < 90; frame++) { trooper.hold(point, Math.PI); run(1 / 60); }
  assert.equal(trooper.state, 'held');
  assert.ok(trooper.root.position.distanceTo(point) < 0.2, 'and brought in, hanging before the hero');
  assert.ok(trooper.reaction.choke > 0.9, 'choking');
});
