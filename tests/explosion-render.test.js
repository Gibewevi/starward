import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplosions } from '../src/explosions.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≈ ${expected}`);

test('an atlas that finishes loading after detonation reveals the active explosion at its current time', () => {
  const explosions = createExplosions(new THREE.Scene());
  const slot = explosions.spawn(new THREE.Vector3());
  explosions.update(0.25);
  assert.equal(slot.billboard.visible, false);
  const texture = new THREE.Texture();
  explosions.configure({ texture });
  assert.equal(slot.billboard.visible, true);
  assert.equal(slot.reflection.visible, true);
  assert.equal(slot.age, 0.25, 'loading does not restart the effect');
  explosions.clear();
  explosions.configure({ texture });
  assert.ok(explosions.pool.every(item => !item.billboard.visible && !item.reflection.visible), 'loading never revives a cleared explosion');
});

function fixture({ slots = 2, data = {} } = {}) {
  const scene = new THREE.Scene();
  const explosions = createExplosions(scene, { slots, random: () => 0.5 });
  const texture = new THREE.DataTexture(new Uint8Array([255, 160, 30, 255]), 1, 1);
  const camera = new THREE.OrthographicCamera(-7, 7, 4.1, -4.1, 0.1, 100);
  camera.position.set(8, 8.8, 10);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld();
  explosions.configure({ texture, data: { frames: 96, columns: 12, rows: 8, size: 256, width: 7.2, centre: 1.9, duration: 3.2, playback: 'linear', ...data } });
  return { scene, explosions, texture, camera };
}

test('explosion clip follows its metadata duration and preserves linear fire/smoke timing in both views', () => {
  const { explosions, camera } = fixture();
  const slot = explosions.spawn(new THREE.Vector3());
  assert.equal(explosions.duration, 3.2);
  explosions.update(0.8, camera);
  for (const mesh of [slot.billboard, slot.reflection]) {
    const u = mesh.material.uniforms;
    assert.equal(u.frameA.value, 23);
    assert.equal(u.frameB.value, 24);
    near(u.blend.value, 0.75, 'quarter of the clip');
  }
  explosions.update(0.8, camera);
  for (const mesh of [slot.billboard, slot.reflection]) {
    const u = mesh.material.uniforms;
    assert.equal(u.frameA.value, 47);
    assert.equal(u.frameB.value, 48);
    near(u.blend.value, 0.5, 'half of the clip');
  }
  explosions.update(1.59, camera);
  assert.equal(explosions.active, 1, 'the smoke survives beyond the old 2.3 second cutoff');
  explosions.update(0.02, camera);
  assert.equal(explosions.active, 0);
  assert.equal(slot.billboard.visible, false);
  assert.equal(slot.reflection.visible, false);
  assert.equal(slot.light.intensity, 0);
  assert.equal(slot.heat.visible, true, 'floor embers outlive the smoke');
});

test('densely sampled burst frames retain their real timing instead of stretching the attack over the clip', () => {
  const { explosions, camera } = fixture({ data: {
    frames: 11, columns: 4, rows: 3,
    frameTimes: [0, 0.02, 0.04, 0.08, 0.12, 0.2, 0.4, 0.8, 1.4, 2.2, 3.2],
  } });
  const slot = explosions.spawn(new THREE.Vector3());
  for (const [dt, frameA, blend] of [[0.03, 1, 0.5], [0.27, 5, 0.5], [2.8, 9, 0.9]]) {
    explosions.update(dt, camera);
    for (const mesh of [slot.billboard, slot.reflection]) {
      assert.equal(mesh.material.uniforms.frameA.value, frameA);
      near(mesh.material.uniforms.blend.value, blend, 'render timestamp interpolation');
    }
  }
  explosions.update(0.101, camera);
  assert.equal(explosions.active, 0);
  assert.equal(slot.billboard.material.uniforms.frameA.value, 10);
});

test('resizing a blast scales the baked physical centre together with its width and floor reflection', () => {
  const { explosions, camera } = fixture({ data: { depthBias: 0.65 } });
  const at = new THREE.Vector3(2, 0.4, -3);
  const small = explosions.spawn(at, { power: 0.8 });
  const large = explosions.spawn(at, { power: 2 });
  explosions.update(0.2, camera);
  const view = camera.getWorldDirection(new THREE.Vector3());
  for (const slot of [small, large]) {
    const scale = slot.billboard.scale.x / 7.2;
    const physicalCentre = slot.billboard.position.clone().addScaledVector(view, 0.65);
    near(physicalCentre.x, at.x, 'blast X remains fixed');
    near(physicalCentre.z, at.z, 'blast Z remains fixed');
    near(physicalCentre.y, 1.9 * scale, 'centre scales with the rendered width');
    const reflection = slot.reflection.material.uniforms;
    near(reflection.centre.value.distanceTo(physicalCentre), 0, 'reflection uses the same physical centre');
    near(reflection.width.value, slot.billboard.scale.x, 'reflection uses the same rendered width');
    const projected = slot.billboard.position.clone().project(camera);
    const projectedPhysical = physicalCentre.clone().project(camera);
    near(projected.x, projectedPhysical.x, 'depth bias does not shift screen X');
    near(projected.y, projectedPhysical.y, 'depth bias does not shift screen Y');
  }
  assert.ok(large.billboard.scale.x > small.billboard.scale.x);
});

test('clearing and recycling pooled explosions removes every old visual and restarts the reflection clock', () => {
  const { scene, explosions, camera, texture } = fixture();
  const first = explosions.spawn(new THREE.Vector3(1, 0, 1));
  const second = explosions.spawn(new THREE.Vector3(-2, 0, 3));
  const childCount = scene.children.length;
  explosions.update(0.2, camera);
  assert.ok(first.light.intensity > 0 && second.light.intensity > 0);
  explosions.clear();
  assert.equal(explosions.active, 0);
  for (const slot of explosions.pool) {
    for (const name of ['billboard', 'reflection', 'flare', 'shock', 'dust', 'heat']) assert.equal(slot[name].visible, false, `${name} hidden`);
    assert.equal(slot.light.intensity, 0);
  }
  const again = explosions.spawn(new THREE.Vector3(4, 0, -2));
  assert.equal(again, first, 'the existing slot is reused');
  assert.equal(again.age, 0);
  assert.equal(again.heatAge, 0);
  assert.equal(again.reflection.material.uniforms.time.value, 0);
  assert.equal(again.billboard.material.uniforms.map.value, texture, 'the atlas remains loaded');
  explosions.update(0, camera);
  assert.equal(again.billboard.material.uniforms.frameA.value, 0);
  for (let i = 0; i < 8; i++) {
    explosions.spawn(new THREE.Vector3(i, 0, 0));
    explosions.update(1 / 60, camera);
    assert.ok(explosions.active <= 2);
  }
  assert.equal(scene.children.length, childCount, 'replaying does not accumulate render objects');
});

test('separate fire emission masks configure every pooled billboard and reflection, with legacy fallback', () => {
  const { explosions, texture } = fixture();
  const heatTexture = new THREE.DataTexture(new Uint8Array([180]), 1, 1, THREE.RedFormat);
  explosions.configure({ texture, heatTexture });
  for (const slot of explosions.pool) for (const mesh of [slot.billboard, slot.reflection]) {
    const u = mesh.material.uniforms;
    assert.equal(u.map.value, texture);
    assert.equal(u.heatMap.value, heatTexture);
    assert.equal(u.hasHeat.value, 1);
    assert.equal(u.cellSize.value, 256);
    assert.equal(u.columns.value, 12);
    assert.equal(u.rows.value, 8);
  }
  explosions.configure({ texture });
  for (const slot of explosions.pool) for (const mesh of [slot.billboard, slot.reflection]) {
    const u = mesh.material.uniforms;
    assert.equal(u.hasHeat.value, 0, 'legacy RGB heat detection re-enabled');
    assert.equal(u.heatMap.value, texture, 'sampler retains a valid texture');
  }
  assert.equal(explosions.duration, 3.2, 'replacing only the maps preserves clip metadata');
});
