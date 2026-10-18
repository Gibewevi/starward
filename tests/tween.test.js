import test from 'node:test';
import assert from 'node:assert/strict';
import { approach, createTweens, ease, hitStopScale, kick } from '../src/tween.js';

test('easing curves start at 0, end at 1, and keep their character', () => {
  for (const [name, curve] of Object.entries(ease)) {
    assert.ok(Math.abs(curve(0)) < 1e-9 && Math.abs(curve(1) - 1) < 1e-9, name);
  }
  for (const name of ['outQuad', 'outCubic', 'outQuart', 'outSnap', 'inOutCubic', 'inOutSine', 'outExpo', 'inQuad', 'inCubic']) {
    let last = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) { assert.ok(ease[name](t) >= last - 1e-9, `${name} rises steadily`); last = ease[name](t); }
  }
  assert.ok(ease.outCubic(0.25) > 0.25 && ease.inQuad(0.25) < 0.25, 'fast start / slow start');
  assert.ok(Math.max(...Array.from({ length: 21 }, (_, i) => ease.outBack(i / 20))) > 1.05, 'outBack overshoots');
});

test('tweens run their course, can be cut short, and always finish cleanly', () => {
  const tweens = createTweens();
  const seen = [];
  let done = 0;
  tweens.add({ duration: 0.2, delay: 0.1, curve: ease.linear, update: value => seen.push(value), complete: () => done++ });
  tweens.update(0.05);
  assert.equal(seen.length, 0, 'waits out its delay');
  for (let i = 0; i < 10; i++) tweens.update(0.05);
  assert.equal(done, 1);
  assert.equal(seen.at(-1), 1);
  assert.equal(tweens.count, 0);
  let restored = false;
  const flash = tweens.add({ duration: 1, update: () => {}, complete: () => { restored = true; } });
  tweens.cancel(flash);
  assert.ok(restored);
  tweens.add({ duration: 1, update: () => {}, complete: () => done++ });
  tweens.clear();
  assert.equal(done, 2, 'clear() finishes what was running');
});

test('a hit stop freezes, then eases back to full speed; a kick rings out to rest', () => {
  const stop = { hold: 0.04, recover: 0.1 };
  assert.ok(hitStopScale(0.02, stop) < 0.1);
  const ramp = [0.05, 0.08, 0.11, 0.14].map(age => hitStopScale(age, stop));
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i] > ramp[i - 1]);
  assert.equal(hitStopScale(0.2, stop), 1);
  assert.equal(kick(0), 0);
  assert.ok(Math.abs(kick(0.02)) > 0.5, 'hits at once');
  assert.equal(kick(Infinity), 0, 'at rest, never NaN');
  assert.ok(Math.abs(kick(0.27)) < 0.05, 'and dies away');
  assert.equal(approach(0, 1, 0.3), 0.3);
  assert.equal(approach(0.9, 1, 0.3), 1);
  assert.equal(approach(0.5, 0, 0.3), 0.2);
});
