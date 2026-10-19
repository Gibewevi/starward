import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createSaberScars } from '../src/saber-scars.js';

test('a blade drawn through a case melts a trail along its face: it glows, cools, and the cut stays', () => {
  const scene = new THREE.Scene(), lab = createLab(scene);
  const scars = createSaberScars(scene, { lab });
  const crate = lab.obstacles.find(box => box.kind === 'crate' && box.min.y === 0);
  const z = crate.max.z;
  // The blade, held level, goes 0.2 m into the +Z face and sweeps along it.
  let contacts = [];
  for (let i = 0; i <= 10; i++) {
    const x = crate.min.x + 0.15 + i * 0.07;
    contacts = scars.cut(new THREE.Vector3(x, 0.7, z + 0.8), new THREE.Vector3(x, 0.7, z - 0.2));
    assert.equal(contacts.length, 1, 'one contact, on the face it enters');
    assert.ok(Math.abs(contacts[0].point.z - z) < 1e-6 && contacts[0].normal.z === 1);
    scars.update(1 / 60);
  }
  assert.equal(scars.scars, 11, 'a stroke a frame, joined to the one before');
  assert.ok(scars.glowing >= 10, 'molten');
  const glow = new THREE.Color();
  scars.meshes.glows.getColorAt(10, glow);
  assert.ok(glow.r > 1, 'white-hot to begin with');
  for (let i = 0; i < 60 * 3; i++) scars.update(1 / 60);
  scars.meshes.glows.getColorAt(10, glow);
  assert.ok(glow.r < 0.5 && glow.g < glow.r * 0.2, `red, dimming (${glow.r.toFixed(2)}, ${glow.g.toFixed(2)})`);
  for (let i = 0; i < 60 * 4; i++) scars.update(1 / 60);
  assert.equal(scars.glowing, 0, 'cooled');
  assert.equal(scars.scars, 11, 'the cut stays');
  // Out of the case: no contact, no new stroke.
  assert.equal(scars.cut(new THREE.Vector3(30, 0.7, 30), new THREE.Vector3(31, 0.7, 30)).length, 0);
});

test('the floor is marked by a strike only; a barrel is cut on its curve', () => {
  const scene = new THREE.Scene(), lab = createLab(scene);
  const scars = createSaberScars(scene, { lab });
  const low = [new THREE.Vector3(20, 0.6, 20), new THREE.Vector3(20, -0.1, 21)];
  assert.equal(scars.cut(...low, 0, { floor: false }).length, 0, 'held low while walking: nothing');
  const strike = scars.cut(...low, 0, { floor: true });
  assert.equal(strike.length, 1);
  assert.ok(Math.abs(strike[0].point.y) < 1e-6 && strike[0].normal.y === 1, 'on the floor');
  const barrel = lab.obstacles.find(box => box.kind === 'barrel');
  const r = (barrel.max.x - barrel.min.x) / 2, cx = (barrel.min.x + barrel.max.x) / 2, cz = (barrel.min.z + barrel.max.z) / 2;
  const hits = scars.cut(new THREE.Vector3(cx + 1, 0.5, cz + 0.05), new THREE.Vector3(cx, 0.5, cz + 0.05));
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(Math.hypot(hits[0].point.x - cx, hits[0].point.z - cz) - r) < 1e-6, 'on the barrel itself, not its box');
  scars.clear();
  assert.equal(scars.scars, 0);
});
