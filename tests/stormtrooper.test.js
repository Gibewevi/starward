import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper } from '../src/stormtrooper.js';
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
  // Sweeps a blade through `point`: the blade lies along `axis`, moves along `motion`.
  state.sweep = (point, axis, motion, speed = 6, frames = 6) => {
    axis = axis.clone().normalize(); motion = motion.clone().normalize();
    const travel = speed * frames / 60;
    const events = [];
    for (let frame = 0; frame < frames; frame++) {
      const at = f => point.clone().addScaledVector(motion, (f / frames - 0.5) * travel).addScaledVector(axis, -0.55);
      const base0 = at(frame), base1 = at(frame + 1);
      state.time += 1 / 60;
      trooper.update(1 / 60, state.time);
      events.push(...trooper.strike(base0, base0.clone().addScaledVector(axis, 0.9), base1, base1.clone().addScaledVector(axis, 0.9), 1 / 60, state.time));
      effects.update(1 / 60);
    }
    return events;
  };
  state.particle = name => trooper.particle(name).position.clone();
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
  assert.ok(state.trooper.dead, 'he falls');
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

test('the saber cuts like butter: the arm drops at his feet and he stays where he stands', () => {
  const state = fixture(21);
  state.run(0.5);
  const { trooper } = state;
  const shoulder = state.particle('SL'), elbow = state.particle('EL');
  const target = shoulder.clone().lerp(elbow, 0.6);
  const before = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  const events = state.sweep(target, new THREE.Vector3(0, -1, 1), new THREE.Vector3(-1, 0, 0).applyQuaternion(trooper.root.quaternion), 3, 3);
  assert.ok(events.some(event => event.type === 'cut' && /^(shoulder|elbow)L$/.test(event.joint)));
  // Slowed frames, as during a hit stop, then normal time.
  for (let i = 0; i < 5; i++) { state.time += 0.0013; trooper.update(0.0013, state.time); }
  state.run(3);
  assert.ok(!trooper.dead, 'one arm lost does not fell him');
  const after = trooper.joints.pelvis.getWorldPosition(new THREE.Vector3());
  assert.ok(before.distanceTo(after) < 0.1, `he stays in place (${before.distanceTo(after).toFixed(2)} m)`);
  for (const name of ['upperArmL', 'forearmL', 'handL']) {
    for (const index of trooper.bodies[name].indices) {
      const p = trooper.ragdoll.particles[index].position;
      assert.ok(Math.hypot(p.x - after.x, p.z - after.z) < 0.9, `${name} lies at his feet`);
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
