import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createImpactEffects } from '../src/impact-effects.js';

test('a hex-coloured saber impact keeps every light channel finite', () => {
  const scene = new THREE.Scene();
  const effects = createImpactEffects(scene);
  const lights = scene.children.filter(child => child.isPointLight);
  assert.equal(lights.length, 2);

  effects.flash(new THREE.Vector3(0, 1, 0), 1.5, { color: 0xff3b41 });
  effects.update(0.08);
  for (const light of lights) {
    for (const channel of ['r', 'g', 'b']) assert.ok(Number.isFinite(light.color[channel]), `${channel} must stay finite`);
  }
  assert.ok(lights[0].intensity > 0);
  assert.ok(lights[0].color.r > lights[0].color.b, 'the flash cools towards red');

  effects.clear();
  for (const light of lights) {
    assert.equal(light.intensity, 0);
    for (const channel of ['r', 'g', 'b']) assert.ok(Number.isFinite(light.color[channel]));
  }
});
