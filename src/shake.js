import * as THREE from 'three';

/**
 * Camera shake driven by trauma: every blow adds some (0 → 1), it drains away
 * over time, and the shake grows with its square — a light hit barely
 * trembles the view, a grenade at his feet rocks it hard. The motion is smooth
 * noise (not white jitter), fast for small shakes, with a slower sway and a
 * touch of roll for the big ones. Offsets are in world units along the
 * camera's right and up axes, sized for the pixel grid (a render pixel is
 * about 0.04 m at the default zoom), so even a small shake moves whole pixels.
 */
export function createShake({ maxOffset = 0.34, maxRoll = 0.022, decay = 1.25, random = Math.random } = {}) {
  let trauma = 0, time = 0;
  // Three smooth noise channels (x, y, roll), each a sum of detuned sines with random phases.
  const channels = [0, 1, 2].map(() => [
    { rate: 17 + random() * 4, phase: random() * 100, weight: 0.6 },
    { rate: 29 + random() * 6, phase: random() * 100, weight: 0.3 },
    { rate: 5 + random() * 2, phase: random() * 100, weight: 0.45 },
  ]);
  const noise = (channel, t, slow) => {
    let sum = 0, total = 0;
    for (const { rate, phase, weight } of channels[channel]) {
      // The slow sway only comes in with heavy trauma.
      const w = rate < 10 ? weight * slow : weight;
      sum += Math.sin(t * rate + phase) * w;
      total += w;
    }
    return total ? sum / total : 0;
  };
  const out = { offset: new THREE.Vector2(), roll: 0, amount: 0 };
  return {
    /** A blow: adds trauma (it never goes past 1). */
    add(amount) { trauma = Math.min(1, trauma + Math.max(0, amount)); },
    /** At least this much (a blow that should not stack with the last). */
    atLeast(amount) { trauma = Math.max(trauma, Math.min(1, amount)); },
    /** Real seconds (it rings through hit stops). */
    update(dt) {
      time += dt;
      trauma = Math.max(0, trauma - decay * dt);
      const shake = trauma * trauma, slow = THREE.MathUtils.smoothstep(trauma, 0.35, 0.9);
      out.amount = shake;
      out.offset.set(noise(0, time, slow), noise(1, time, slow)).multiplyScalar(maxOffset * shake);
      out.roll = noise(2, time, slow) * maxRoll * shake * slow;
      return out;
    },
    clear() { trauma = 0; out.offset.set(0, 0); out.roll = 0; out.amount = 0; },
    get trauma() { return trauma; },
  };
}
