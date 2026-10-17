import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../src/character.js';
import { createCoat } from '../src/coat.js';
import { MotionController, WALK_SPEED, RUN_SPEED } from '../src/motion.js';

function fixture() {
  const scene = new THREE.Scene();
  const character = createCharacter();
  scene.add(character.root);
  const coat = createCoat({ scene, character });
  const vertices = coat.mesh.geometry.attributes.position;
  const hem = Array.from({ length: coat.columns }, (_, column) => (coat.rows - 1) * coat.columns + column);
  const waist = Array.from({ length: coat.columns }, (_, column) => column);
  const waistLocal = waist.map(index => character.rig.bones.Hips.worldToLocal(new THREE.Vector3().fromBufferAttribute(vertices, index)));
  return { scene, character, coat, vertices, hem, waist, waistLocal };
}

function assertSafe({ character, vertices, waist, waistLocal }) {
  const point = new THREE.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i);
    assert.ok(Number.isFinite(point.x + point.y + point.z), 'cloth positions remain finite');
    assert.ok(point.y >= 0.029, 'cloth stays above the floor');
    assert.ok(Math.hypot(point.x - character.root.position.x, point.z - character.root.position.z) < 1.6, 'cloth stays with the character');
  }
  waist.forEach((index, i) => {
    point.fromBufferAttribute(vertices, index);
    const expected = character.rig.bones.Hips.localToWorld(waistLocal[i].clone());
    assert.ok(point.distanceTo(expected) < 1e-4, 'the waist row is sewn to the moving pelvis');
  });
}

function trailing({ character, vertices, hem }) {
  const center = new THREE.Vector3(), point = new THREE.Vector3();
  for (const index of hem) center.add(point.fromBufferAttribute(vertices, index));
  center.divideScalar(hem.length).sub(character.root.position);
  return center.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(character.root.quaternion));
}

test('the long coat follows the captured pelvis, trails in a run and settles after braking', () => {
  const state = fixture();
  const motion = new MotionController();
  const velocity = new THREE.Vector3();
  let standing = 0, running = 0;
  try {
    for (let frame = 0; frame < 1500; frame++) {
      const dt = [1 / 60, 1 / 80, 1 / 45, 1 / 60, 1 / 120][frame % 5];
      const time = frame / 60;
      const sprint = time > 6 && time < 14;
      const moving = time > 2 && time < 14;
      const turn = time > 10 && time < 13 ? Math.sin(time * 2) : 0;
      motion.update(dt, moving ? Math.sin(1 + turn) : 0, moving ? Math.cos(1 + turn) : 0, sprint);
      state.character.root.position.set(motion.x, 0, motion.z);
      state.character.root.rotation.y = motion.heading;
      state.character.update({ dt, time, speed: motion.speed, runBlend: motion.runBlend, sprintIntent: sprint, turnRate: motion.turnRate, forwardAccel: motion.forwardAccel });
      velocity.set(motion.vx, 0, motion.vz);
      state.coat.update({ dt, time, velocity });
      assertSafe(state);
      if (time > 1 && time < 2) standing = Math.max(standing, trailing(state));
      if (time > 8 && time < 10) running = Math.max(running, trailing(state));
    }
    assert.ok(motion.speed < 0.01);
    assert.ok(running > standing + 0.15, `the tails fly back in a run (${standing} → ${running})`);
    assert.ok(trailing(state) < running * 0.6, 'the coat falls back around the legs after stopping');
  } finally {
    state.coat.dispose();
  }
});

test('the coat hangs open at the front over the trousers', () => {
  const state = fixture();
  for (let frame = 0; frame < 120; frame++) {
    state.character.update({ dt: 1 / 60, time: frame / 60, speed: 0 });
    state.coat.update({ dt: 1 / 60, time: frame / 60, velocity: new THREE.Vector3() });
  }
  const point = new THREE.Vector3();
  let blocked = 0, wrapped = 0;
  for (let i = 0; i < state.vertices.count; i++) {
    point.fromBufferAttribute(state.vertices, i);
    state.character.root.worldToLocal(point);
    // The panels meet under the belt and part lower down, over the thighs.
    if (point.z > 0.1 && Math.abs(point.x) < 0.025 && point.y > 0.3 && point.y < 0.6) blocked++;
    if (point.z < -0.1) wrapped++;
  }
  assert.equal(blocked, 0, 'nothing closes the front opening');
  assert.ok(wrapped > 100, 'the coat wraps the back of the legs');
  state.coat.dispose();
});

test('walking keeps the tailored shape while a sprint lets it go', () => {
  for (const [speed, expectRise] of [[WALK_SPEED, false], [RUN_SPEED, true]]) {
    const state = fixture();
    const point = new THREE.Vector3();
    let rise = 0;
    for (let frame = 0; frame < 240; frame++) {
      state.character.root.position.z += speed / 60;
      state.character.update({ dt: 1 / 60, time: frame / 60, speed, runBlend: speed > WALK_SPEED ? 1 : 0, sprintIntent: speed > WALK_SPEED });
      state.coat.update({ dt: 1 / 60, time: frame / 60, velocity: new THREE.Vector3(0, 0, speed) });
      if (frame < 120) continue;
      let y = 0;
      for (const index of state.hem) y += point.fromBufferAttribute(state.vertices, index).y / state.hem.length;
      rise = Math.max(rise, y);
    }
    if (expectRise) assert.ok(rise > 0.3, `sprint airflow lifts the hem: ${rise}`);
    else assert.ok(rise < 0.3, `a walk keeps the hem low: ${rise}`);
    state.coat.dispose();
  }
});

test('teleportation and a long paused frame safely reset the cloth', () => {
  const state = fixture();
  try {
    state.character.root.position.set(-12, 0, 21);
    state.character.root.rotation.y = 2.2;
    state.character.update({ dt: 1 / 60, time: 1, speed: 0 });
    state.coat.update({ dt: 1 / 60, time: 1, velocity: new THREE.Vector3() });
    assertSafe(state);
    state.character.root.position.set(7, 0, -9);
    state.character.update({ dt: 1 / 60, time: 10, speed: 0 });
    state.coat.update({ dt: 2, time: 10, velocity: new THREE.Vector3() });
    assertSafe(state);
    assert.ok(Math.abs(trailing(state)) < 0.2, 'reset leaves a hanging coat');
  } finally {
    state.coat.dispose();
  }
});
