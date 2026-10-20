import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createImpactEffects } from '../src/impact-effects.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

test('a limb off: red drops, fewer and bigger than sparks, thrown up and out, fall back fast and stay a long while', () => {
  const effects = createImpactEffects(new THREE.Scene(), { random: seeded(7) });
  const at = new THREE.Vector3(0, 1.1, 0), direction = new THREE.Vector3(1, 0, 0), normal = new THREE.Vector3(0, 0, 1);
  effects.sparks(at, direction, normal, { count: 40, speed: 5 });
  effects.bleed(at, direction, normal, { speed: 5 });
  const { flying } = effects.red;
  assert.ok(flying >= FEEL.severed.red[0] && flying <= FEEL.severed.red[1] && flying < 40, `fewer than the sparks (${flying})`);
  const sizes = effects.reds.geometry.attributes.size;
  effects.update(1 / 60);
  let biggest = 0;
  for (let i = 0; i < sizes.count; i++) biggest = Math.max(biggest, sizes.array[i]);
  assert.ok(biggest > 2.3, 'a little bigger than a spark');
  // Heavy: all on the floor well before the sparks have come down.
  let landed = null;
  for (let t = 1 / 60; t < 2; t += 1 / 60) {
    effects.update(1 / 60);
    if (landed === null && effects.red.flying === 0) landed = t;
  }
  assert.ok(landed !== null && landed < 1, `down fast (${landed?.toFixed(2)} s)`);
  assert.equal(effects.red.lying, flying, 'none bounced away or vanished');
  // They lie there long after the sparks have cooled.
  for (let t = 0; t < 18; t += 1 / 30) effects.update(1 / 30);
  assert.equal(effects.live, 0, 'the sparks are long gone');
  assert.equal(effects.red.lying, flying, 'the red drops are still there after 20 s');
  for (let t = 0; t < FEEL.severed.linger[1] + FEEL.severed.fade; t += 1 / 30) effects.update(1 / 30);
  assert.equal(effects.red.lying, 0, 'and fade in the end');
  // A drip from the cut adds a few more, then stops.
  const cap = new THREE.Object3D();
  cap.position.set(1, 1, 0);
  effects.drip(cap, 0.6);
  for (let t = 0; t < 1.5; t += 1 / 60) effects.update(1 / 60);
  const dripped = effects.red.lying;
  assert.ok(dripped >= 3 && dripped <= 8, `a few drips (${dripped})`);
  effects.clear();
  assert.deepEqual(effects.red, { flying: 0, lying: 0, walls: 0 }, 'cleared on restart');
});

test('red drops stick to what they hit: a wall, a crate, the floor', async () => {
  const { createLab } = await import('../src/lab.js');
  const scene = new THREE.Scene(), lab = createLab(scene);
  const effects = createImpactEffects(scene, { random: seeded(3), lab });
  // Thrown hard at the side of a crate.
  const crate = lab.obstacles.find(box => box.kind === 'crate' && box.min.y === 0);
  const at = new THREE.Vector3(crate.min.x - 0.8, 0.7, crate.centre.z);
  effects.bleed(at, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), { speed: 9, count: 12 });
  for (let t = 0; t < 2; t += 1 / 60) effects.update(1 / 60);
  const { lying, walls } = effects.red;
  assert.equal(lying, 12, 'all stuck somewhere');
  assert.ok(walls >= 4, `several on the crate's side (${walls})`);
  // On the side: they ran down a little and set, and they stay.
  const position = effects.reds.geometry.attributes.position.array, size = effects.reds.geometry.attributes.size.array;
  let onSide = 0;
  for (let i = 0; i < size.length; i++) if (size[i] > 0 && Math.abs(position[i * 3] - crate.min.x) < 0.03 && position[i * 3 + 1] > 0.05) onSide++;
  assert.ok(onSide >= 4, `on the crate's face, above the floor (${onSide})`);
  for (let t = 0; t < 15; t += 1 / 30) effects.update(1 / 30);
  assert.equal(effects.red.lying, 12, 'still there 15 s later');
});
