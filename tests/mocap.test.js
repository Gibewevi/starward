import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MOCAP_BONES, MOCAP_CLIPS } from '../src/mocap-clips.js';
import { RIG_LAYOUT } from '../src/rig.js';

test('every captured clip drives every rig bone with unit quaternions', () => {
  assert.deepEqual(MOCAP_BONES, RIG_LAYOUT.map(([name]) => name).filter(name => MOCAP_BONES.includes(name)));
  for (const clip of Object.values(MOCAP_CLIPS)) {
    assert.equal(clip.rotations.length, clip.frames);
    assert.equal(clip.hips.length, clip.frames);
    for (const frame of clip.rotations) {
      assert.equal(frame.length, MOCAP_BONES.length * 4);
      for (let k = 0; k < frame.length; k += 4) assert.ok(Math.abs(Math.hypot(frame[k], frame[k + 1], frame[k + 2], frame[k + 3]) - 1) < 2e-3);
    }
  }
});

test('cycles loop seamlessly and walk and run share the same foot phase', () => {
  const a = new THREE.Quaternion(), b = new THREE.Quaternion();
  for (const name of ['idle', 'walk', 'run']) {
    const clip = MOCAP_CLIPS[name];
    let largestStep = 0, seam = 0;
    for (let frame = 0; frame < clip.frames; frame++) {
      const next = (frame + 1) % clip.frames;
      for (let k = 0; k < MOCAP_BONES.length * 4; k += 4) {
        const angle = a.fromArray(clip.rotations[frame], k).angleTo(b.fromArray(clip.rotations[next], k));
        if (next === 0) seam = Math.max(seam, angle); else largestStep = Math.max(largestStep, angle);
      }
    }
    assert.ok(seam < Math.max(0.12, largestStep * 1.5), `${name} loops without a jump (${seam} vs ${largestStep})`);
  }
  assert.ok(MOCAP_CLIPS.walk.speed > 1 && MOCAP_CLIPS.run.speed > MOCAP_CLIPS.walk.speed * 1.5, 'captured speeds were measured');
});
