import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SaberControl, bladeFor, twirlAngle } from '../src/saber-control.js';
import { createCharacter } from '../src/character.js';
import { createStormtrooper } from '../src/stormtrooper.js';

const UP = new THREE.Vector3(0, 1, 0);
const S = Math.SQRT1_2;
// Drives a controller frame by frame; `stick(frame)` gives the right stick
// (x to his right, y up) and the options of that frame. Blades are recorded
// in his own frame (+X his left, +Z ahead).
function rig(heading = 0) {
  const control = new SaberControl();
  const state = { control, heading, frames: [] };
  state.run = (frames, stick = () => ({})) => {
    for (let i = 0; i < frames; i++) {
      const { x = 0, y = 0, ...options } = stick(i);
      const before = control.output.blade.clone();
      const out = control.update(1 / 60, { active: true, stickX: x, stickY: y, heading: state.heading, blade: new THREE.Vector3(0, 0.3, 1).normalize(), ...options });
      state.heading = out.heading;
      state.frames.push({ blade: out.blade.clone(), rate: before.angleTo(out.blade) * 60, yaw: out.yaw, power: out.power, trail: out.trail, weight: out.weight, drive: out.drive });
    }
    return control.output;
  };
  state.hold = (x, y, frames = 40) => state.run(frames, () => ({ x, y }));
  return state;
}

test('the stick places the blade around him: up, down, left, right, the corners, a guard in the middle', () => {
  const state = rig();
  const at = (x, y) => state.hold(x, y).blade.clone();
  const centre = at(0, 0), up = at(0, 1), down = at(0, -1), right = at(1, 0), left = at(-1, 0);
  assert.ok(centre.z > 0.9 && centre.y > 0, 'centred: a middle guard pointing ahead');
  assert.ok(up.y > 0.85, 'up: raised high');
  assert.ok(down.y < -0.75, 'down: lowered towards the floor ahead');
  assert.ok(right.x < -0.85 && Math.abs(right.y) < 0.15, 'right: out to his right, level');
  assert.ok(left.x > 0.85 && Math.abs(left.y) < 0.15, 'left: out to his left, level');
  const corners = [[S, S], [-S, S], [S, -S], [-S, -S]].map(([x, y]) => at(x, y));
  assert.ok(corners[0].x < -0.5 && corners[0].y > 0.5, 'high right');
  assert.ok(corners[1].x > 0.5 && corners[1].y > 0.5, 'high left');
  assert.ok(corners[2].x < -0.5 && corners[2].y < -0.3, 'low right');
  assert.ok(corners[3].x > 0.5 && corners[3].y < -0.3, 'low left');
  const all = [centre, up, down, right, left, ...corners];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(all[i].angleTo(all[j]) > 0.5, `nine distinct positions (${i}, ${j})`);
  // The lowest blade stays clear of the floor: hand height minus the blade's drop.
  assert.ok(state.hold(0, -1).hand.y - 0.9 * -bladeFor(0, -1).y > 0.03);
});

test('it answers at once, carries inertia and follows through past its mark', () => {
  const state = rig();
  state.hold(0, 1);
  state.frames.length = 0;
  state.hold(0, -1);
  const quick = state.frames.findIndex(frame => frame.blade.y < 0);
  assert.ok(quick >= 0 && quick <= 6, `answers within a few frames (${quick})`);
  const lowest = Math.min(...state.frames.map(frame => frame.blade.y)), rest = state.frames.at(-1).blade.y;
  assert.ok(lowest < rest - 0.02, `the chop goes past its mark (${lowest.toFixed(2)} vs ${rest.toFixed(2)})`);
  assert.ok(Math.abs(state.frames.at(-2).blade.y - rest) < 0.005, 'then settles');
});

test('strokes run between the places: across is a slash, down an overhead chop, corner to corner a diagonal', () => {
  const stroke = (from, to) => {
    const state = rig();
    state.hold(...from);
    state.frames.length = 0;
    state.run(30, i => (i === 0 ? { x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 } : { x: to[0], y: to[1] }));
    return state.frames;
  };
  const slash = stroke([1, 0], [-1, 0]);
  assert.ok(slash.every(frame => Math.abs(frame.blade.y) < 0.3), 'right to left stays level: a horizontal slash');
  assert.ok(slash.some(frame => frame.blade.z > 0.95), 'through the front');
  assert.ok(slash.at(-1).blade.x > 0.85);
  const chop = stroke([0, 1], [0, -1]);
  assert.ok(chop.every(frame => Math.abs(frame.blade.x) < 0.05), 'up to down stays upright: an overhead chop');
  const diagonal = stroke([S, S], [-S, -S]);
  assert.ok(diagonal.at(0).blade.x < 0 && diagonal.at(0).blade.y > 0 && diagonal.at(-1).blade.x > 0.4 && diagonal.at(-1).blade.y < -0.3, 'high right to low left: a diagonal');
  const circle = rig();
  circle.hold(0, 1);
  circle.frames.length = 0;
  circle.run(60, i => ({ x: Math.sin(i * 0.2), y: Math.cos(i * 0.2) }));
  const directions = circle.frames.map(frame => Math.atan2(-frame.blade.x, frame.blade.y));
  let swept = 0;
  for (let i = 1; i < directions.length; i++) swept += Math.atan2(Math.sin(directions[i] - directions[i - 1]), Math.cos(directions[i] - directions[i - 1]));
  assert.ok(swept > Math.PI * 1.5, 'round the rim, the blade circles in front of him');
});

test('the stick sets the stroke: a slow move repositions, a flick strikes hard and lights the trail', () => {
  const sweep = seconds => {
    const state = rig();
    state.hold(1, 0);
    state.frames.length = 0;
    const frames = Math.round(seconds * 60);
    state.run(frames + 30, i => { const p = Math.min(1, i / frames); return { x: Math.cos(Math.PI * p), y: Math.sin(Math.PI * p) * 0.4 }; });
    return state.frames;
  };
  const slow = sweep(1.4), fast = sweep(0.1);
  const peak = frames => Math.max(...frames.map(frame => frame.rate));
  assert.ok(peak(slow) * 0.6 < 2.2, `slow: mid-blade under ${(peak(slow) * 0.6).toFixed(1)} m/s, it only repositions`);
  assert.ok(Math.max(...slow.map(frame => frame.power)) < 0.1 && Math.max(...slow.map(frame => frame.trail)) < 0.05);
  assert.ok(peak(fast) * 0.6 > 6, `fast: mid-blade at ${(peak(fast) * 0.6).toFixed(1)} m/s`);
  assert.ok(Math.max(...fast.map(frame => frame.power)) > 0.8 && Math.max(...fast.map(frame => frame.trail)) > 0.8, 'with power and a trail');
});

test('letting go of the stick brings the blade back to the guard gently, without a stroke', () => {
  const state = rig();
  state.hold(1, 0);
  state.frames.length = 0;
  // The stick springs back to the centre on its own.
  state.run(40, i => (i === 0 ? { x: 0.4, y: 0 } : { x: 0.02, y: -0.01 }));
  assert.ok(Math.max(...state.frames.map(frame => frame.power)) < 0.05, 'no stroke');
  assert.ok(Math.max(...state.frames.map(frame => frame.trail)) < 0.05, 'no trail');
  assert.ok(state.frames.at(-1).blade.z > 0.95, 'back in the guard');
  // A flick straight across the centre still cuts through.
  const flick = rig();
  flick.hold(1, 0);
  flick.frames.length = 0;
  flick.run(20, i => (i === 0 ? { x: 0.05, y: 0 } : { x: -1, y: 0 }));
  assert.ok(Math.max(...flick.frames.map(frame => frame.power)) > 0.8 && flick.frames.at(-1).blade.x > 0.85);
});

test('the body winds up, then twists into the swing and follows through; a hard stroke steps in', () => {
  const state = rig();
  state.hold(1, 0.1);
  const before = state.frames.at(-1).yaw;
  state.frames.length = 0;
  // A flick across from his right to his left.
  state.run(30, i => (i < 3 ? { x: 1 - i * 0.6, y: 0.2 } : { x: -1, y: 0.1 }));
  const yaws = state.frames.map(frame => frame.yaw);
  assert.ok(before < -0.3, 'turned towards the blade on his right');
  assert.ok(Math.min(...yaws.slice(0, 4)) < before - 0.05, `the body first coils further back (${(Math.min(...yaws.slice(0, 4)) - before).toFixed(2)} rad)`);
  assert.ok(state.frames[2].blade.x > -0.9, 'while the blade is already on its way');
  assert.ok(yaws.at(-1) > 0.3, 'then it twists towards his left');
  assert.ok(Math.max(...yaws) > yaws.at(-1) + 0.02, 'following through past it');
  assert.ok(Math.max(...state.frames.map(frame => frame.drive)) > 0.5, 'and steps in');
});

test('the right stick never turns him: the blade moves with him, the left stick steers', () => {
  const state = rig();
  state.hold(1, 0);
  assert.equal(state.heading, 0, 'he does not turn');
  const local = state.control.output.blade.clone();
  state.run(40, i => ({ x: 1, y: 0, heading: -1.2 * Math.min(1, i / 20) }));
  assert.ok(Math.abs(state.heading + 1.2) < 1e-9);
  assert.ok(state.control.output.blade.angleTo(local) < 0.01, 'the blade keeps its place at his side as he turns');
  assert.equal(state.control.output.turnScale, 1);
});

test('R3 rolls the blade a full eased turn around the wrist, lit, and gives it back to the stick', () => {
  assert.ok(Math.abs(twirlAngle(0)) < 1e-9 && Math.abs(twirlAngle(1) - Math.PI * 2) < 1e-9);
  assert.ok(Math.max(...Array.from({ length: 41 }, (_, i) => twirlAngle(i / 40))) > Math.PI * 2.05, 'a little exaggerated: it overshoots, then settles');
  assert.ok(twirlAngle(0.15) < Math.PI * 0.2 && twirlAngle(0.5) > Math.PI * 0.8, 'slow start, fast middle');
  const state = rig();
  state.hold(0.5, 0.5);
  const before = state.control.output.blade.clone();
  state.frames.length = 0;
  state.run(1, () => ({ x: 0.5, y: 0.5, twirl: true }));
  assert.ok(state.control.twirling);
  state.run(40, () => ({ x: 0.5, y: 0.5 }));
  let turned = 0;
  for (let i = 1; i < state.frames.length; i++) turned += state.frames[i - 1].blade.angleTo(state.frames[i].blade);
  assert.ok(turned > Math.PI * 2, `a whole turn (${(turned * 180 / Math.PI).toFixed(0)}°)`);
  assert.ok(!state.control.twirling, 'over in about half a second');
  assert.ok(state.control.output.blade.angleTo(before) < 0.05, 'back where the stick holds it');
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
  const held = new THREE.Vector3(-0.5, -0.4, 0.6).normalize();
  const out = control.update(1 / 60, { active: true, stickX: 0.6, stickY: -0.5, heading: 0.3, blade: held });
  assert.ok(out.blade.clone().applyAxisAngle(UP, 0.3).angleTo(held) < 0.25, 'it starts from the blade where it was');
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
  character.root.rotation.y = 0.6;
  const target = new THREE.Vector3(), hand = new THREE.Vector3(), shoulder = new THREE.Vector3(), blade = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  let checked = 0;
  for (let frame = 0; frame < 240; frame++) {
    const a = frame * 0.07, tilt = (frame % 80) / 80;
    const out = control.update(1 / 60, { active: true, stickX: Math.sin(a) * tilt, stickY: Math.cos(a) * tilt, heading: 0.6, blade: new THREE.Vector3(0, 1, 0), twirl: frame === 150 });
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
  assert.ok(checked > 150, `${checked} frames checked`);
});

test('strokes cut a stormtrooper in front of him; a slow pass only grazes', () => {
  const outcome = (from, to, seconds) => {
    const scene = new THREE.Scene();
    const character = createCharacter();
    scene.add(character.root);
    const control = new SaberControl();
    let seed = 5;
    const trooper = createStormtrooper({ scene, position: new THREE.Vector3(0, 0, 0.95), heading: Math.PI, random: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const base = new THREE.Vector3(), tip = new THREE.Vector3(), lastBase = new THREE.Vector3(), lastTip = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    let time = 0, ready = false;
    const events = [];
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let frame = 0; frame < 60 + frames + 30; frame++) {
      const p = Math.min(1, Math.max(0, (frame - 60) / frames));
      // Along the rim when slow (a reposition), straight across when quick.
      const x = from[0] + (to[0] - from[0]) * p, y = from[1] + (to[1] - from[1]) * p;
      const out = control.update(1 / 60, { active: true, stickX: x, stickY: y, heading: 0, blade: new THREE.Vector3(0, 1, 0) });
      character.update({ dt: 1 / 60, time, speed: 0, action: out });
      time += 1 / 60;
      trooper.update(1 / 60, time);
      character.saberSocket.getWorldPosition(base);
      tip.set(0, 1, 0).applyQuaternion(character.saberSocket.getWorldQuaternion(quaternion)).multiplyScalar(0.9).add(base);
      if (ready && frame >= 60) events.push(...trooper.strike(lastBase, lastTip, base, tip, 1 / 60, time));
      ready = true;
      lastBase.copy(base); lastTip.copy(tip);
    }
    return events.filter(event => event.type !== 'fall');
  };
  const describe = events => events.map(event => `${event.type}:${event.joint ?? event.part}:${event.speed.toFixed(1)}`).join();
  const slash = outcome([1, 0], [-1, 0], 0.05), chop = outcome([0, 1], [0, -1], 0.05), soft = outcome([1, 0], [-1, 0], 2.5);
  assert.ok(slash.some(event => event.type === 'cut'), `a horizontal slash cuts: ${describe(slash)}`);
  assert.ok(chop.some(event => event.type === 'cut' || event.type === 'slash'), `an overhead chop cuts: ${describe(chop)}`);
  assert.ok(soft.length > 0 && soft.every(event => event.type === 'graze'), `a slow pass grazes: ${describe(soft)}`);
});
