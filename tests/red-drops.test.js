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

test('red drops stick to what they hit; on a side they run down, leaving a trail, and may pool at its foot', async () => {
  const { createLab } = await import('../src/lab.js');
  const scene = new THREE.Scene(), lab = createLab(scene);
  const effects = createImpactEffects(scene, { random: seeded(3), lab });
  // Thrown hard at the side of a crate.
  const crate = lab.obstacles.find(box => box.kind === 'crate' && box.min.y === 0);
  const at = new THREE.Vector3(crate.min.x - 0.8, 0.7, crate.centre.z);
  effects.bleed(at, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), { speed: 9, count: 12 });
  for (let t = 0; t < 0.6; t += 1 / 60) effects.update(1 / 60);
  assert.equal(effects.red.flying, 0, 'all stuck somewhere');
  assert.ok(effects.red.walls >= 4, `several on the crate's side (${effects.red.walls})`);
  const position = effects.reds.geometry.attributes.position.array, size = effects.reds.geometry.attributes.size.array;
  const onFace = () => { const ys = []; for (let i = 0; i < size.length; i++) if (size[i] > 0 && Math.abs(position[i * 3] - crate.min.x) < 0.03) ys.push(position[i * 3 + 1]); return ys; };
  const early = onFace();
  for (let t = 0; t < 4; t += 1 / 60) effects.update(1 / 60);
  // They ran down: a streak of specks down the face, longer than the drops were apart.
  const late = onFace();
  assert.ok(late.length > early.length + 20, `a trail of specks (${early.length} → ${late.length})`);
  assert.ok(Math.max(...late) - Math.min(...late) > 0.2, 'down the face');
  assert.ok(Math.min(...late) >= 0, 'never through the floor');
  // Set now: nothing moves any more, and it all stays.
  const settled = [...position];
  for (let t = 0; t < 12; t += 1 / 30) effects.update(1 / 30);
  let moved = 0;
  for (let i = 0; i < size.length; i++) if (size[i] > 0) moved = Math.max(moved, Math.abs(position[i * 3 + 1] - settled[i * 3 + 1]));
  assert.ok(moved < 1e-6, 'set');
  assert.ok(effects.red.lying >= late.length, 'still there 16 s later');
});

test('a sole coming down in red drops takes some of them up; a severed head or body sprays far more than a hand', () => {
  const effects = createImpactEffects(new THREE.Scene(), { random: seeded(5) });
  const at = new THREE.Vector3(0, 0.6, 0);
  effects.bleed(at, new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), { speed: 0.5, count: 30 });
  for (let t = 0; t < 1; t += 1 / 60) effects.update(1 / 60);
  const before = effects.red.lying;
  const found = effects.tread(new THREE.Vector3(0, 0, 0), 0.4);
  effects.update(1 / 60);
  assert.ok(found > 5, `trodden in (${found})`);
  assert.ok(effects.red.lying < before && effects.red.lying > before * 0.5, `a little taken away (${before} → ${effects.red.lying})`);
  assert.equal(effects.tread(new THREE.Vector3(5, 0, 5), 0.4), 0, 'nothing where there is nothing');
  // Sprays by size.
  const count = amount => { const fx = createImpactEffects(new THREE.Scene(), { random: seeded(9) }); fx.bleed(at, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), { amount }); return fx.red.flying; };
  const { parts } = FEEL.severed;
  assert.ok(count(parts.neck) > count(parts.wrist) * 3 && count(parts.waist) > count(parts.ankle) * 3, 'head and body: far more than a hand or a foot');
});

test('red footprints: soles laid along the foot (the left one mirrored), fading after half a minute, all in one draw', async () => {
  const { createFootprints } = await import('../src/footprints.js');
  const scene = new THREE.Scene(), prints = createFootprints(scene, { random: seeded(2) });
  const along = new THREE.Vector3(1, 0, 0);
  const right = prints.stamp(new THREE.Vector3(0, 0, 0), along, 'R', 1);
  const left = prints.stamp(new THREE.Vector3(0.3, 0, 0.2), along, 'L', 0.5);
  prints.update(1 / 60);
  assert.equal(prints.count, 2);
  assert.equal(scene.children.filter(child => child.isInstancedMesh).length, 1, 'one mesh for every print');
  const m = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  prints.mesh.getMatrixAt(right, m); m.decompose(position, rotation, scale);
  const toe = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  assert.ok(toe.angleTo(along) < 1e-3 && position.y > 0 && position.y < 0.01, 'on the floor, toe forward');
  prints.mesh.getMatrixAt(left, m); m.decompose(position, rotation, scale);
  assert.ok(m.determinant() < 0, 'the left sole mirrored');
  const fade = prints.mesh.geometry.getAttribute('fade').array;
  assert.ok(fade[right] > fade[left] && fade[left] > 0, 'fainter when the sole was less red');
  for (let t = 0; t < 20; t += 1 / 30) prints.update(1 / 30);
  assert.equal(prints.count, 2, 'still there 20 s later');
  for (let t = 0; t < 20; t += 1 / 30) prints.update(1 / 30);
  assert.equal(prints.count, 0, 'faded in the end');
  prints.clear();
  assert.equal(prints.mesh.count, 0);
});
