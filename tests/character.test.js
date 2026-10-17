import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../src/character.js';
import { MOCAP_BONES } from '../src/mocap-clips.js';

const position = object => object.getWorldPosition(new THREE.Vector3());
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}`);
function soleIndices(character) {
  const points = character.body.geometry.attributes.position;
  const indices = [[], []];
  for (let i = 0; i < points.count; i++) {
    if (points.getY(i) < 0.02) indices[points.getX(i) > 0 ? 0 : 1].push(i);
  }
  return indices;
}
function soleHeights(character, indices) {
  const point = new THREE.Vector3();
  return indices.map(vertices => {
    let lowest = Infinity;
    for (const index of vertices) {
      character.body.getVertexPosition(index, point);
      lowest = Math.min(lowest, point.y);
    }
    return lowest;
  });
}

test('the reference silhouette sits on a complete humanoid skeleton', () => {
  const character = createCharacter();
  const size = new THREE.Box3().setFromObject(character.root).getSize(new THREE.Vector3());
  assert.ok(size.y > 1.55 && size.y < 1.68, `Height: ${size.y}`);
  const bones = character.rig.bones;
  assert.deepEqual(character.skeleton.bones.map(bone => bone.name), MOCAP_BONES);
  for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftToeBase', 'RightToeBase']) {
    assert.ok(bones[name]?.isBone, `${name} drives the body`);
  }
  // A big shaggy head over broad coat shoulders, as in the sprite.
  const hair = new THREE.Box3().setFromObject(character.root.getObjectByName('Shaggy hair'));
  const face = new THREE.Box3().setFromObject(character.root.getObjectByName('Face'));
  const chin = position(bones.Head).y + 0.03;
  assert.ok(face.min.y < chin, 'the jaw reaches the chin line');
  const share = (hair.max.y - chin) / size.y;
  assert.ok(share > 0.21 && share < 0.28, `Head share of the height: ${share}`);
  const width = hair.max.x - hair.min.x;
  assert.ok(width > 0.3 && width < 0.38, `Hair volume: ${width}`);
  assert.equal(character.saberSocket.parent, bones.RightHand, 'the sword is in the right hand');
  assert.ok(position(bones.RightHand).x < 0, 'the right hand is on the character’s right (-X when facing +Z)');
  assert.ok(character.root.getObjectByName('Belt'), 'a belt hides the coat seam');
});

test('captured locomotion moves head, shoulders, chest and hips', () => {
  const character = createCharacter();
  const { bones } = character.rig;
  const tracked = ['Head', 'Spine2', 'LeftShoulder', 'Hips'];
  for (const [speed, runBlend] of [[0, 0], [1.7, 0], [4.5, 1]]) {
    const extremes = Object.fromEntries(tracked.map(name => [name, { min: Infinity, max: -Infinity }]));
    for (let frame = 0; frame < 240; frame++) {
      character.update({ dt: 1 / 60, time: frame / 60, speed, runBlend, sprintIntent: runBlend });
      if (frame < 60) continue;
      for (const name of tracked) {
        const angle = new THREE.Euler().setFromQuaternion(bones[name].quaternion, 'YXZ');
        const value = angle.x + angle.y + angle.z;
        extremes[name].min = Math.min(extremes[name].min, value);
        extremes[name].max = Math.max(extremes[name].max, value);
      }
    }
    for (const name of tracked) {
      const range = extremes[name].max - extremes[name].min;
      assert.ok(range > (speed ? 0.04 : 0.002), `${name} must move organically at ${speed} m/s (range ${range})`);
    }
  }
});

test('cadence is calibrated on the rig, so the planted foot does not slide', () => {
  const character = createCharacter();
  const { cycle } = character.animator;
  assert.ok(cycle.walk > 1 && cycle.walk < 1.8, `Walk cycle length: ${cycle.walk}`);
  assert.ok(cycle.run > cycle.walk * 1.2 && cycle.run < 2.6, `Run cycle length: ${cycle.run}`);
  const toes = ['LeftToeBase', 'RightToeBase'].map(name => character.rig.bones[name]);
  const point = new THREE.Vector3();
  for (const [speed, runBlend, tolerance] of [[1.7, 0, 0.12], [4.5, 1, 0.6]]) {
    let slide = 0, planted = 0, previous = null;
    character.root.position.set(0, 0, 0);
    for (let frame = 0; frame < 300; frame++) {
      character.root.position.z += speed / 60;
      character.update({ dt: 1 / 60, time: frame / 60, speed, runBlend, sprintIntent: runBlend });
      if (frame < 90) continue;
      let lowest = null;
      toes.forEach((toe, side) => {
        toe.getWorldPosition(point);
        if (!lowest || point.y < lowest.y) lowest = { side, y: point.y, z: point.z };
      });
      if (previous && previous.side === lowest.side && lowest.y < 0.04) { slide += (lowest.z - previous.z) * 60; planted++; }
      previous = lowest;
    }
    assert.ok(planted > 30, 'feet regularly plant');
    assert.ok(Math.abs(slide / planted) < tolerance, `Planted toe drifts at ${slide / planted} m/s while moving at ${speed} m/s`);
  }
});

test('deformed soles stay grounded when walking and only leave the floor in the run’s flight', () => {
  const character = createCharacter();
  const soles = soleIndices(character);
  for (const [speed, runBlend, clearance, maxFlight] of [[1.7, 0, 0.05, 0.03], [4.5, 1, 0.15, 0.16]]) {
    const high = [0, 0], contacts = [0, 0];
    for (let frame = 0; frame < 300; frame++) {
      character.update({ dt: 1 / 60, time: frame / 60, speed, runBlend, sprintIntent: runBlend });
      if (frame < 60) continue;
      const heights = soleHeights(character, soles);
      heights.forEach((height, side) => {
        assert.ok(height > -0.02, `Deformed sole penetrated the floor: ${height}`);
        high[side] = Math.max(high[side], height);
        if (height < 0.03) contacts[side]++;
      });
      assert.ok(Math.min(...heights) < maxFlight, `Excessive flight at ${speed} m/s`);
    }
    high.forEach(height => assert.ok(height > clearance, `Both feet need swing clearance at ${speed} m/s: ${height}`));
    contacts.forEach(count => assert.ok(count > 25, 'Both feet must regularly plant on the floor'));
  }
});

test('sprint intent leans the hero forward quickly', () => {
  const character = createCharacter();
  const { Hips, Head } = character.rig.bones;
  for (let frame = 0; frame < 60; frame++) character.update({ dt: 1 / 60, time: frame / 60, speed: 0 });
  const standing = position(Head).z - position(Hips).z;
  for (let frame = 0; frame < 120; frame++) character.update({ dt: 1 / 60, time: 1 + frame / 60, speed: 4.5, runBlend: 1, sprintIntent: 1 });
  assert.ok(position(Head).z - position(Hips).z > standing + 0.08, 'head and shoulders lead the hips in a sprint');
});

test('turns and braking keep the surface valid and preserve external placement', () => {
  const character = createCharacter();
  const soles = soleIndices(character);
  character.root.position.set(3, 0, -4);
  character.root.rotation.y = 1.2;
  const points = character.body.geometry.attributes.position;
  const vertex = new THREE.Vector3();
  let previous = position(character.saberSocket), largestStep = 0;
  for (let frame = 0; frame < 420; frame++) {
    const time = frame / 60;
    const speed = time < 1 ? time * 4.5 : time < 3 ? 4.5 : time < 3.4 ? (3.4 - time) * 11.25 : 0;
    character.update({ dt: 1 / 60, time, speed, runBlend: speed > 1.7 ? 1 : 0, sprintIntent: time < 3 ? 1 : 0, turnRate: Math.sin(time * 2) * 7, forwardAccel: time < 1 ? 4.5 : time < 3 ? 0 : time < 3.4 ? -11.25 : 0 });
    assert.ok([...character.skeleton.boneMatrices].every(Number.isFinite), 'GPU bone matrices must be valid');
    for (let index = 0; index < points.count; index += 397) {
      character.body.getVertexPosition(index, vertex);
      assert.ok(vertex.toArray().every(Number.isFinite), 'Deformed surface must remain finite');
    }
    const current = position(character.saberSocket);
    largestStep = Math.max(largestStep, current.distanceTo(previous));
    previous.copy(current);
  }
  assert.ok(largestStep < 0.13, `The sword hand moves continuously: ${largestStep}`);
  assert.deepEqual(character.root.position.toArray(), [3, 0, -4]);
  near(character.root.rotation.y, 1.2, 1e-12, 'Caller controls heading');
  soleHeights(character, soles).forEach(height => near(height, 0, 0.03, 'Standing again, the boots rest on the floor'));
});
