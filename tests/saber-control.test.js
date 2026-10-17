import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SaberControl, twirlAngle } from '../src/saber-control.js';
import { createCharacter } from '../src/character.js';
import { createStormtrooper } from '../src/stormtrooper.js';
import { angleDelta } from '../src/motion.js';

const UP = new THREE.Vector3(0, 1, 0);
// Drives a controller frame by frame; `stick(frame)` gives the right stick on
// the floor (x, z) and the options of that frame.
function rig(heading = 0) {
  const control = new SaberControl();
  const state = { control, heading, frames: [] };
  state.world = (out = control.output) => out.blade.clone().applyAxisAngle(UP, state.heading);
  state.run = (frames, stick = () => ({})) => {
    for (let i = 0; i < frames; i++) {
      const { x = 0, z = 0, ...options } = stick(i);
      const before = state.world();
      const out = control.update(1 / 60, { active: true, aimX: x, aimZ: z, heading: state.heading, blade: new THREE.Vector3(-0.5, -0.6, 0.6).normalize(), ...options });
      state.heading = out.heading;
      const now = state.world(out);
      state.frames.push({ blade: now, rate: before.angleTo(now) * 60, yaw: out.yaw, power: out.power, trail: out.trail, weight: out.weight, drive: out.drive });
    }
    return control.output;
  };
  return state;
}
const sweep = seconds => {
  // A quarter and a half round the hero at full tilt, from his right to his front-left.
  const state = rig();
  state.run(40, () => ({ x: 1, z: 0 }));
  state.frames.length = 0;
  const frames = Math.round(seconds * 60);
  state.run(frames + 30, i => { const a = Math.PI / 2 - Math.min(1, i / frames) * Math.PI * 0.75; return { x: Math.sin(a), z: Math.cos(a) }; });
  return state;
};

test('centred, the blade stands raised in front; pushed, it leans that way around the hero', () => {
  const state = rig();
  let out = state.run(30);
  assert.ok(out.weight > 0.99 && out.engaged);
  assert.ok(out.blade.y > 0.9, 'raised');
  out = state.run(40, () => ({ x: 1, z: 0 }));
  const blade = state.world(out);
  assert.ok(blade.x > 0.85 && blade.y < 0 && blade.y > -0.6, `levelled towards the stick, just below the horizon (${blade.toArray().map(v => v.toFixed(2))})`);
  out = state.run(40, () => ({ x: 0, z: 0.55 }));
  const half = state.world(out);
  assert.ok(half.z > 0.4 && half.y > 0.1 && half.y < 0.9, 'half tilt: half raised');
});

test('it answers at once, then carries inertia and follows through past its mark', () => {
  const state = rig();
  state.run(30);
  state.frames.length = 0;
  state.run(40, () => ({ x: 0, z: 1 }));
  const quick = state.frames.findIndex(frame => frame.blade.z > 0.7);
  assert.ok(quick >= 0 && quick <= 5, `answers within a few frames (${quick})`);
  const lowest = Math.min(...state.frames.map(frame => frame.blade.y)), rest = state.frames.at(-1).blade.y;
  assert.ok(lowest < rest - 0.1, `a chop dips past its mark (${lowest.toFixed(2)} vs ${rest.toFixed(2)})`);
  assert.ok(Math.abs(state.frames.at(-2).blade.y - rest) < 0.01, 'then settles');
});

test('the stick sets the stroke: a slow turn repositions, a flick strikes hard and lights the trail', () => {
  const slow = sweep(1.2), fast = sweep(0.1);
  const peak = state => Math.max(...state.frames.map(frame => frame.rate));
  assert.ok(peak(slow) * 1.2 < 3, `slow: the blade end moves under ${(peak(slow) * 1.2).toFixed(1)} m/s, it does not cut`);
  assert.ok(Math.max(...slow.frames.map(frame => frame.power)) < 0.1 && Math.max(...slow.frames.map(frame => frame.trail)) < 0.05);
  assert.ok(peak(fast) * 0.6 > 6, `fast: mid-blade at ${(peak(fast) * 0.6).toFixed(1)} m/s`);
  assert.ok(Math.max(...fast.frames.map(frame => frame.power)) > 0.8, 'with power');
  assert.ok(Math.max(...fast.frames.map(frame => frame.trail)) > 0.8, 'and a trail');
  const end = fast.frames.at(-1).blade;
  assert.ok(new THREE.Vector3(Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)).dot(end.clone().setY(0).normalize()) > 0.97, 'and it lands where the stick went');
});

test('the body winds up, twists into the swing and turns to keep the blade in reach', () => {
  const state = rig();
  state.run(40, () => ({ x: -1, z: 0.2 }));
  const before = state.frames.at(-1).yaw;
  state.frames.length = 0;
  // A flick across to his left (+x when facing +z).
  state.run(30, i => (i < 4 ? { x: -1 + i * 0.5, z: 0.6 } : { x: 1, z: 0.2 }));
  const yaws = state.frames.map(frame => frame.yaw);
  assert.ok(Math.min(...yaws.slice(0, 4)) < before - 0.05, `the body first coils the other way (${(Math.min(...yaws.slice(0, 4)) - before).toFixed(2)} rad)`);
  assert.ok(state.frames[2].blade.x > -0.9, 'while the blade is already on its way');
  assert.ok(yaws.at(-1) > 0.3, 'then it twists towards the blade on his left');
  assert.ok(Math.max(...yaws) > yaws.at(-1) + 0.02, 'following through past it');
  const behind = rig();
  behind.run(60, () => ({ x: 0, z: -1 }));
  assert.ok(Math.abs(angleDelta(behind.heading, behind.control.azimuth)) <= 1.76, 'he turns to keep the blade within reach');
  assert.ok(Math.abs(angleDelta(0, behind.heading)) > 1, 'so he has turned round');
});

test('a hard forward stroke steps in', () => {
  const state = rig();
  state.run(30);
  state.frames.length = 0;
  state.run(20, () => ({ x: 0, z: 1 }));
  assert.ok(Math.max(...state.frames.map(frame => frame.drive)) > 0.5);
});

test('R3 rolls the blade a full eased turn around the wrist, lit, and gives it back to the stick', () => {
  assert.ok(Math.abs(twirlAngle(0)) < 1e-9 && Math.abs(twirlAngle(1) - Math.PI * 2) < 1e-9);
  assert.ok(Math.max(...Array.from({ length: 41 }, (_, i) => twirlAngle(i / 40))) > Math.PI * 2.05, 'a little exaggerated: it overshoots, then settles');
  assert.ok(twirlAngle(0.15) < Math.PI * 0.2 && twirlAngle(0.5) > Math.PI * 0.8, 'slow start, fast middle');
  const state = rig();
  state.run(30, () => ({ x: 0.5, z: 0.5 }));
  const before = state.world();
  state.frames.length = 0;
  state.run(1, () => ({ x: 0.5, z: 0.5, twirl: true }));
  assert.ok(state.control.twirling);
  let turned = 0;
  state.run(40, () => ({ x: 0.5, z: 0.5 }));
  for (let i = 1; i < state.frames.length; i++) turned += state.frames[i - 1].blade.angleTo(state.frames[i].blade);
  assert.ok(turned > Math.PI * 2, `a whole turn (${(turned * 180 / Math.PI).toFixed(0)}°)`);
  assert.ok(!state.control.twirling, 'over in about half a second');
  assert.ok(state.world().angleTo(before) < 0.05, 'back where the stick holds it');
  assert.ok(Math.max(...state.frames.map(frame => frame.trail)) > 0.95, 'with a blue trail');
  // Without LT, R3 takes the blade for the turn, then lets go.
  const solo = new SaberControl();
  let out = solo.update(1 / 60, { twirl: true, blade: new THREE.Vector3(0, -0.6, 0.8) });
  for (let i = 0; i < 25; i++) out = solo.update(1 / 60, { blade: new THREE.Vector3(0, -0.6, 0.8) });
  assert.ok(out.weight > 0.9 && solo.twirling);
  for (let i = 0; i < 40; i++) out = solo.update(1 / 60, {});
  assert.ok(out.weight === 0 && !out.engaged);
});

test('taking and releasing the blade is seamless', () => {
  const control = new SaberControl();
  const held = new THREE.Vector3(-0.5, -0.6, 0.6).normalize();
  const out = control.update(1 / 60, { active: true, heading: 0.3, blade: held });
  assert.ok(out.blade.clone().applyAxisAngle(UP, out.heading).angleTo(held) < 0.25, 'it starts from the blade where it was');
  assert.ok(out.weight > 0 && out.weight < 0.4, 'and eases in');
  for (let i = 0; i < 30; i++) control.update(1 / 60, { active: true, heading: 0.3 });
  const weights = [];
  for (let i = 0; i < 24; i++) weights.push(control.update(1 / 60, { active: false, heading: 0.3 }).weight);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1]);
  assert.ok(weights[3] > 0.5 && weights.at(-1) === 0, 'and eases out');
});

test('the rig follows the free blade: hand on its mark, blade aimed as asked', () => {
  const character = createCharacter();
  const control = new SaberControl();
  character.root.position.set(1, 0, -2);
  const target = new THREE.Vector3(), hand = new THREE.Vector3(), shoulder = new THREE.Vector3(), blade = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  let heading = 0.6, checked = 0;
  for (let frame = 0; frame < 240; frame++) {
    const a = frame * 0.06;
    const out = control.update(1 / 60, { active: true, aimX: Math.sin(a) * (frame % 80) / 80, aimZ: Math.cos(a) * (frame % 80) / 80, heading, blade: new THREE.Vector3(0, 1, 0), twirl: frame === 150 });
    heading = out.heading;
    character.root.rotation.y = heading;
    character.update({ dt: 1 / 60, time: frame / 60, speed: 0, action: out });
    assert.ok([...character.skeleton.boneMatrices].every(Number.isFinite));
    if (out.weight < 0.999) continue;
    blade.set(0, 1, 0).applyQuaternion(character.saberSocket.getWorldQuaternion(quaternion));
    assert.ok(blade.angleTo(out.blade.clone().applyQuaternion(character.root.quaternion)) < 0.01, 'the blade points as asked');
    target.copy(out.hand).applyMatrix4(character.root.matrixWorld);
    character.rig.bones.RightArm.getWorldPosition(shoulder);
    character.rig.bones.RightHand.getWorldPosition(hand);
    if (shoulder.distanceTo(target) < 0.42) { assert.ok(hand.distanceTo(target) < 0.01, 'the hand reaches its mark'); checked++; }
  }
  assert.ok(checked > 120, `${checked} frames checked`);
});

test('a hard stroke through a stormtrooper cuts; a slow pass only grazes', () => {
  const outcome = seconds => {
    const scene = new THREE.Scene();
    const character = createCharacter();
    scene.add(character.root);
    const control = new SaberControl();
    let seed = 5;
    const trooper = createStormtrooper({ scene, position: new THREE.Vector3(0, 0, 1.05), heading: Math.PI, random: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const base = new THREE.Vector3(), tip = new THREE.Vector3(), lastBase = new THREE.Vector3(), lastTip = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    let heading = 0, time = 0, ready = false;
    const events = [];
    const frames = Math.round(seconds * 60);
    for (let frame = 0; frame < 60 + frames + 30; frame++) {
      // Blade levelled to his right, then swept across his front to his left.
      const p = Math.min(1, Math.max(0, (frame - 60) / frames));
      const a = -Math.PI / 2 + p * Math.PI;
      const out = control.update(1 / 60, { active: true, aimX: Math.sin(a) * 0.75, aimZ: Math.cos(a) * 0.75, heading, blade: new THREE.Vector3(0, 1, 0) });
      heading = out.heading;
      character.root.rotation.y = heading;
      character.update({ dt: 1 / 60, time, speed: 0, action: out });
      time += 1 / 60;
      trooper.update(1 / 60, time);
      character.saberSocket.getWorldPosition(base);
      tip.set(0, 1, 0).applyQuaternion(character.saberSocket.getWorldQuaternion(quaternion)).multiplyScalar(0.9).add(base);
      if (ready && frame >= 60) events.push(...trooper.strike(lastBase, lastTip, base, tip, 1 / 60, time));
      ready = true;
      lastBase.copy(base); lastTip.copy(tip);
    }
    return events;
  };
  const hard = outcome(0.12), soft = outcome(2.2);
  assert.ok(hard.some(event => event.type === 'cut'), hard.map(event => `${event.type}:${event.joint ?? event.part}`).join());
  assert.ok(soft.length > 0 && soft.every(event => event.type === 'graze'), soft.map(event => `${event.type}:${event.part}:${event.speed.toFixed(1)}`).join());
});
