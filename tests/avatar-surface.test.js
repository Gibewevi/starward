import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRig } from '../src/rig.js';
import { createAvatarSurface, PALETTE } from '../src/avatar-surface.js';

function fixture() {
  const rig = createRig();
  rig.bindPose();
  const result = createAvatarSurface({ bones: rig.bones, list: rig.list });
  rig.root.add(result.body);
  rig.root.updateMatrixWorld(true);
  result.body.skeleton.update();
  return { ...rig, ...result };
}
const avatar = fixture();

test('the entire dressed body is one closed connected surface, including all joints', () => {
  const geometry = avatar.body.geometry;
  const triangles = geometry.index.array;
  const edges = new Map();
  const neighbours = Array.from({ length: geometry.attributes.position.count }, () => []);
  for (let index = 0; index < triangles.length; index += 3) {
    const face = [triangles[index], triangles[index + 1], triangles[index + 2]];
    assert.equal(new Set(face).size, 3, 'a triangle must have three distinct vertices');
    for (let corner = 0; corner < 3; corner++) {
      const a = face[corner], b = face[(corner + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
  }
  assert.ok([...edges.values()].every(count => count === 2), 'every edge has two faces: no cracks or overlaps');
  const visited = new Set([0]), pending = [0];
  while (pending.length) {
    for (const neighbour of neighbours[pending.pop()]) {
      if (!visited.has(neighbour)) { visited.add(neighbour); pending.push(neighbour); }
    }
  }
  assert.equal(visited.size, geometry.attributes.position.count, 'torso, arms, hands, legs and boots are connected');
  assert.ok(avatar.metadata.triangles > 10000 && avatar.metadata.triangles < 45000, `triangle budget: ${avatar.metadata.triangles}`);
});

test('skin weights are normalised and blend across shoulders, elbows, hips and knees', () => {
  const geometry = avatar.body.geometry;
  const indices = geometry.attributes.skinIndex.array;
  const weights = geometry.attributes.skinWeight.array;
  const names = avatar.body.skeleton.bones.map(bone => bone.name);
  const pairs = [['LeftArm', 'LeftForeArm'], ['RightArm', 'RightForeArm'], ['LeftUpLeg', 'LeftLeg'], ['RightUpLeg', 'RightLeg'],
    ['Spine2', 'LeftShoulder'], ['Hips', 'LeftUpLeg'], ['Spine', 'Spine1']];
  const blended = new Map(pairs.map(pair => [pair.join('/'), 0]));
  for (let vertex = 0; vertex < weights.length / 4; vertex++) {
    const influences = new Map();
    let total = 0;
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights[vertex * 4 + slot];
      assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
      total += weight;
      influences.set(names[indices[vertex * 4 + slot]], (influences.get(names[indices[vertex * 4 + slot]]) ?? 0) + weight);
    }
    assert.ok(Math.abs(total - 1) < 1e-5);
    for (const [a, b] of pairs) if ((influences.get(a) ?? 0) > 0.1 && (influences.get(b) ?? 0) > 0.1) blended.set(`${a}/${b}`, blended.get(`${a}/${b}`) + 1);
  }
  for (const [joint, count] of blended) assert.ok(count > 40, `${joint} needs a soft skinning transition, found ${count} vertices`);
});

test('binding preserves the sculpt, the soles meet the floor and the shoulders stay in proportion', () => {
  const positions = avatar.body.geometry.attributes.position;
  const original = new THREE.Vector3(), transformed = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 17) {
    original.fromBufferAttribute(positions, index);
    avatar.body.applyBoneTransform(index, transformed.copy(original));
    assert.ok(original.distanceTo(transformed) < 1e-5, 'binding must not displace the body');
  }
  const bounds = avatar.body.geometry.boundingBox;
  assert.ok(Math.abs(bounds.min.y) < 1e-5, 'the soles meet the floor at zero');
  let shoulders = 0;
  for (let index = 0; index < positions.count; index++) {
    if (Math.abs(positions.getY(index) - 1.03) < 0.02 && Math.abs(positions.getZ(index)) < 0.05) shoulders = Math.max(shoulders, Math.abs(positions.getX(index)));
  }
  assert.ok(shoulders > 0.2 && shoulders < 0.26, `coat shoulders in proportion with the head: ${shoulders}`);
});

test('the reference outfit: tunic in the coat opening, bare hands, dark trousers and boots', () => {
  const positions = avatar.geometry.attributes.position;
  const colors = avatar.geometry.attributes.color;
  const tunic = new THREE.Color(PALETTE.tunic), skin = new THREE.Color(PALETTE.skin), boot = new THREE.Color(PALETTE.boot);
  const color = new THREE.Color();
  let tunicFront = 0, coatSide = 0, hands = 0, boots = 0;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
    color.fromBufferAttribute(colors, vertex);
    const close = target => Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) < 0.06;
    if (Math.abs(x) < 0.04 && y > 0.88 && y < 1.08 && z > 0.1 && close(tunic)) tunicFront++;
    if (Math.abs(x) > 0.16 && y > 0.88 && y < 1.0 && color.r < tunic.r * 0.7) coatSide++;
    if (Math.abs(x) > 0.3 && y < 0.7 && close(skin)) hands++;
    if (y < 0.15 && y > 0.04 && close(boot)) boots++;
  }
  assert.ok(tunicFront > 20, `a light tunic shows down the chest (${tunicFront})`);
  assert.ok(coatSide > 40, 'the coat covers the sides of the chest');
  assert.ok(hands > 40, 'both hands are bare');
  assert.ok(boots > 80, 'dark boots');
});

test('deep bends keep the skinned surface finite and near the skeleton', () => {
  avatar.bones.LeftLeg.rotation.x = 1.4;
  avatar.bones.RightLeg.rotation.x = 0.9;
  avatar.bones.LeftForeArm.rotation.y = -1.3;
  avatar.bones.RightForeArm.rotation.y = 1.1;
  avatar.bones.Spine1.rotation.x = 0.35;
  avatar.root.updateMatrixWorld(true);
  avatar.body.skeleton.update();
  const position = new THREE.Vector3();
  for (let vertex = 0; vertex < avatar.geometry.attributes.position.count; vertex++) {
    position.fromBufferAttribute(avatar.geometry.attributes.position, vertex);
    avatar.body.applyBoneTransform(vertex, position);
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z));
    assert.ok(position.length() < 2, 'bending must not send any surface far from the skeleton');
  }
  avatar.bindPose();
});
