import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeroRagdoll } from '../src/hero-ragdoll.js';
import { createCharacter } from '../src/character.js';
import { createWounds } from '../src/wounds.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function hero() {
  const character = createCharacter();
  const scene = new THREE.Scene();
  scene.add(character.root);
  character.update({ dt: 1 / 60, time: 0 });
  character.root.updateMatrixWorld(true);
  return { character, scene };
}

test('dead, the hero falls limp where the hit throws him and never gets up; a blast still moves the body', () => {
  const { character } = hero();
  const knockdown = createHeroRagdoll(character, { random: seeded(31) });
  // A bolt from +z through the chest: pushed back, the part hit twisted round.
  const chest = character.rig.bones.Spine2.getWorldPosition(new THREE.Vector3());
  assert.ok(knockdown.knock(new THREE.Vector3(0, 0.4, -1.4), { spin: 1.1, dead: true, hit: { at: chest, velocity: new THREE.Vector3(0, 0, -4.5) } }));
  assert.ok(knockdown.dead && knockdown.active);
  let up = null, time = 0;
  for (let i = 0; i < 60 * 8; i++) { time += 1 / 60; up ??= knockdown.update(1 / 60, time); }
  assert.equal(up, null, 'never back on his feet');
  assert.ok(knockdown.dead && knockdown.phase === 'flying', 'still a body on the floor');
  assert.ok(knockdown.still > 1, 'lying still');
  const lying = knockdown.position.clone();
  assert.ok(lying.y < 0.3, `down on the floor (${lying.y.toFixed(2)} m)`);
  assert.ok(lying.z < -0.2, `fell away from the shot (${lying.z.toFixed(2)} m)`);
  // A grenade by the body: thrown again, and still dead.
  knockdown.knock(new THREE.Vector3(3, 2, 0));
  for (let i = 0; i < 60 * 3; i++) { time += 1 / 60; knockdown.update(1 / 60, time); }
  assert.ok(knockdown.dead, 'a body stays a body');
  assert.ok(knockdown.position.x > lying.x + 0.5, 'moved by the blast');
});

test('wounds stick to him where he is hit (a bolt: a charred core in red), go where he goes, and pool under him; all gone for the next try', () => {
  const { character, scene } = hero();
  const wounds = createWounds({ random: seeded(41) });
  wounds.scene = scene;
  const bones = character.rig.bones;
  const chest = bones.Spine2.getWorldPosition(new THREE.Vector3());
  const bolt = wounds.strike(bones, chest.clone().add(new THREE.Vector3(0, 0, 0.3)), new THREE.Vector3(0, 0, 1), 'bolt');
  assert.ok(bolt && bolt.parent === bones.Spine2, 'on the chest');
  const tints = bolt.geometry.attributes.tint.array;
  const charred = [], red = [];
  for (let i = 0; i < tints.length; i += 4) (tints[i] < 0.1 ? charred : red).push(tints[i]);
  assert.ok(charred.length >= 2 && red.length > charred.length, `a charred core (${charred.length}) in red (${red.length})`);
  // On his front, towards the shot.
  bolt.updateMatrixWorld(true);
  const speck = new THREE.Vector3().fromBufferAttribute(bolt.geometry.attributes.position, 0).applyMatrix4(bolt.matrixWorld);
  assert.ok(speck.z > chest.z + 0.05, 'on the side the bolt came from');
  // He moves: the wound with him.
  character.root.position.set(2, 0, 0);
  character.root.updateMatrixWorld(true);
  const moved = new THREE.Vector3().fromBufferAttribute(bolt.geometry.attributes.position, 0).applyMatrix4(bolt.matrixWorld);
  assert.ok(Math.abs(moved.x - speck.x - 2) < 1e-6, 'goes where he goes');
  // A blast: several, here and there.
  wounds.riddle(bones, new THREE.Vector3(-1, 0, 0), 6);
  assert.equal(wounds.count, 7);
  // The pool: from nothing, spreading, slower and slower, to its size.
  const pool = wounds.spill(new THREE.Vector3(2, 0, 0));
  const sizes = [];
  for (let t = 0; t < 7; t += 0.5) { wounds.update(0.5); sizes.push(pool.scale.x); }
  assert.ok(sizes.every((size, i) => i === 0 || size >= sizes[i - 1]), 'only spreads');
  assert.ok(sizes[1] - sizes[0] > sizes.at(-1) - sizes.at(-2), 'slower and slower');
  assert.ok(sizes.at(-1) >= FEEL.death.pool.size[0] - 1e-6 && sizes.at(-1) <= FEEL.death.pool.size[1] + 1e-6, `as big as a pool gets (${sizes.at(-1).toFixed(2)} m)`);
  // Seen from above (it faces up).
  const normal = new THREE.Vector3().crossVectors(
    new THREE.Vector3().fromBufferAttribute(pool.geometry.attributes.position, pool.geometry.index.array[1]),
    new THREE.Vector3().fromBufferAttribute(pool.geometry.attributes.position, pool.geometry.index.array[2]));
  assert.ok(normal.y > 0, 'facing up');
  wounds.clear();
  assert.equal(wounds.count, 0);
  assert.equal(wounds.pools, 0);
  assert.ok(!bones.Spine2.children.some(child => child.isPoints), 'nothing left on him');
});
