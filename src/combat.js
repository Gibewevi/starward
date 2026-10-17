import * as THREE from 'three';

/**
 * Lightsaber choreography. B chains a four-strike combo — diagonal cut,
 * rising backhand, spinning sweep, leaping two-handed slam — and a press
 * while running opens with a dashing cut instead. Presses are buffered so the
 * strikes flow into each other. Holding A raises a two-handed guard that the
 * hero can walk or run in.
 *
 * Poses are keyframes in the character's root space (+Z forward, -X is the
 * sword side): the right hand's position, the blade direction, the free hand,
 * a two-handed grip, torso twist and pitch, and a knee bend. They are joined
 * with Catmull-Rom splines, so the blade travels in arcs.
 */
const key = (t, hand, blade, options = {}) => ({ t, hand, blade, left: [0.28, 0.93, 0.02], grip: 0, yaw: 0, pitch: 0, crouch: 0.5, ...options });

export const ATTACKS = {
  slash: {
    duration: 0.46, buffer: 0.18, chain: 0.6, active: [0.36, 0.68], trail: [0.3, 0.8],
    drive: [[0.28, 0.62, 2.1]],
    keys: [
      key(0, [-0.24, 1.18, 0.02], [-0.15, 0.85, -0.5], { left: [0.24, 1.0, 0.24], yaw: -0.45, pitch: -0.05, crouch: 0.4 }),
      key(0.28, [-0.2, 1.27, 0.08], [-0.05, 0.98, -0.2], { left: [0.26, 0.98, 0.18], yaw: -0.55, crouch: 0.5 }),
      key(0.5, [0.0, 1.0, 0.42], [0.45, 0.25, 0.86], { left: [0.3, 0.95, -0.04], yaw: 0.1, pitch: 0.12, crouch: 0.8 }),
      key(0.66, [0.18, 0.78, 0.36], [0.85, -0.35, 0.35], { left: [0.32, 0.93, -0.16], yaw: 0.45, pitch: 0.18, crouch: 0.9 }),
      key(1, [0.16, 0.8, 0.3], [0.75, -0.55, 0.3], { left: [0.3, 0.93, -0.12], yaw: 0.4, pitch: 0.1, crouch: 0.7 }),
    ],
  },
  backhand: {
    duration: 0.44, buffer: 0.15, chain: 0.6, active: [0.36, 0.7], trail: [0.28, 0.82],
    drive: [[0.25, 0.55, 1.8]],
    keys: [
      key(0, [0.16, 0.8, 0.3], [0.75, -0.55, 0.3], { left: [0.3, 0.93, -0.12], yaw: 0.4, pitch: 0.1, crouch: 0.7 }),
      key(0.22, [0.2, 0.78, 0.24], [0.8, -0.45, 0.0], { left: [0.32, 0.95, -0.05], yaw: 0.5, crouch: 0.75 }),
      key(0.48, [-0.08, 1.02, 0.45], [-0.4, 0.45, 0.8], { left: [0.3, 0.98, 0.12], yaw: 0, pitch: 0.1, crouch: 0.6 }),
      key(0.66, [-0.32, 1.22, 0.22], [-0.85, 0.5, -0.1], { left: [0.26, 1.0, 0.22], yaw: -0.45, pitch: -0.05, crouch: 0.4 }),
      key(1, [-0.3, 1.18, 0.15], [-0.6, 0.75, -0.25], { left: [0.26, 0.98, 0.2], yaw: -0.4, crouch: 0.45 }),
    ],
  },
  spin: {
    duration: 0.62, buffer: 0.2, chain: 0.78, active: [0.3, 0.84], trail: [0.25, 0.9],
    drive: [[0.25, 0.8, 1.4]], spin: [0.28, 0.82, 1],
    keys: [
      key(0, [-0.3, 1.18, 0.15], [-0.6, 0.75, -0.25], { left: [0.26, 0.98, 0.2], yaw: -0.4, crouch: 0.45 }),
      key(0.2, [-0.36, 1.0, -0.08], [-0.8, 0.15, -0.55], { left: [0.3, 0.95, 0.2], yaw: -0.6, crouch: 0.8 }),
      key(0.35, [-0.42, 0.98, 0.12], [-0.95, 0.05, 0.3], { left: [0.36, 1.0, -0.05], yaw: -0.1, crouch: 0.85 }),
      key(0.8, [-0.42, 0.98, 0.14], [-0.94, 0.04, 0.34], { left: [0.36, 1.0, -0.05], yaw: 0, crouch: 0.85 }),
      key(1, [-0.25, 0.95, 0.35], [-0.55, 0.2, 0.8], { left: [0.3, 0.95, 0.1], yaw: -0.1, crouch: 0.6 }),
    ],
  },
  slam: {
    duration: 0.84, buffer: 1, chain: 2, active: [0.45, 0.66], trail: [0.38, 0.7],
    drive: [[0.18, 0.6, 2.4]], lift: [0.2, 0.6, 0.22], impact: 0.6,
    keys: [
      key(0, [-0.25, 0.95, 0.35], [-0.55, 0.2, 0.8], { left: [0.3, 0.95, 0.1], yaw: -0.1, crouch: 0.6 }),
      key(0.18, [-0.15, 0.95, 0.18], [-0.35, 0.35, -0.85], { grip: 1, yaw: -0.35, crouch: 1 }),
      key(0.42, [-0.04, 1.42, 0.02], [0, 0.55, -0.83], { grip: 1, yaw: -0.1, pitch: -0.2, crouch: 0.2 }),
      key(0.6, [0, 0.82, 0.48], [0, -0.7, 0.72], { grip: 1, pitch: 0.35, crouch: 1 }),
      key(0.8, [0, 0.72, 0.45], [0.02, -0.8, 0.6], { grip: 1, pitch: 0.3, crouch: 1 }),
      key(1, [-0.12, 0.85, 0.38], [-0.3, -0.45, 0.85], { grip: 0.4, pitch: 0.1, crouch: 0.6 }),
    ],
  },
  dash: {
    duration: 0.5, buffer: 0.18, chain: 0.68, active: [0.45, 0.76], trail: [0.35, 0.85],
    drive: [[0, 0.75, 5.2]],
    keys: [
      key(0, [-0.32, 1.0, 0.05], [-0.75, 0.3, -0.6], { left: [0.26, 0.98, 0.25], yaw: -0.55, crouch: 0.6 }),
      key(0.3, [-0.36, 1.02, 0.12], [-0.9, 0.2, -0.38], { left: [0.28, 0.98, 0.25], yaw: -0.65, pitch: 0.1, crouch: 0.8 }),
      key(0.55, [0, 0.98, 0.46], [0.2, 0.1, 0.97], { left: [0.32, 0.95, 0.02], yaw: 0.05, pitch: 0.18, crouch: 0.9 }),
      key(0.72, [0.3, 0.95, 0.28], [0.95, 0.05, 0.3], { left: [0.32, 0.93, -0.15], yaw: 0.55, pitch: 0.12, crouch: 0.8 }),
      key(1, [0.16, 0.8, 0.3], [0.75, -0.55, 0.3], { left: [0.3, 0.93, -0.12], yaw: 0.4, pitch: 0.1, crouch: 0.7 }),
    ],
  },
};
export const COMBO = ['slash', 'backhand', 'spin', 'slam'];
export const GUARD_SPEED = 2.2;
const GUARD = key(0, [-0.04, 0.98, 0.3], [0.15, 0.96, 0.22], { grip: 1, yaw: 0.2, pitch: 0.04, crouch: 0.55, left: [-0.02, 0.92, 0.3] });

const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);
const window = (t, [from, to], fade = 0.06) => clamp01((t - from + fade) / fade) * clamp01((to + fade - t) / fade);
const VECTORS = ['hand', 'blade', 'left'], SCALARS = ['grip', 'yaw', 'pitch', 'crouch'];
function createPose() {
  return { hand: new THREE.Vector3(), blade: new THREE.Vector3(0, 1, 0), left: new THREE.Vector3(), grip: 0, yaw: 0, pitch: 0, crouch: 0 };
}
function copyPose(out, pose) {
  for (const name of VECTORS) out[name].copy(pose[name]);
  for (const name of SCALARS) out[name] = pose[name];
  return out;
}
function mixPose(out, a, b, weight) {
  for (const name of VECTORS) out[name].lerpVectors(a[name], b[name], weight);
  for (const name of SCALARS) out[name] = a[name] + (b[name] - a[name]) * weight;
  out.blade.normalize();
  return out;
}
const catmull = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
function sampleKeys(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = clamp01((t - k1.t) / (k2.t - k1.t));
  for (const name of VECTORS) out[name].set(...[0, 1, 2].map(axis => catmull(k0[name][axis], k1[name][axis], k2[name][axis], k3[name][axis], u)));
  for (const name of SCALARS) out[name] = catmull(k0[name], k1[name], k2[name], k3[name], u);
  out.blade.normalize();
  return out;
}
const poseOf = keyframe => {
  const pose = createPose();
  for (const name of VECTORS) pose[name].fromArray(keyframe[name]);
  for (const name of SCALARS) pose[name] = keyframe[name];
  pose.blade.normalize();
  return pose;
};

export class CombatController {
  constructor() {
    this.output = { ...createPose(), weight: 0, guard: 0, lift: 0, spin: 0, drive: 0, inputScale: 1, turnScale: 1, maxSpeed: Infinity, trail: 0, flare: 0, shake: 0, name: null, engaged: false };
    this.guardPose = poseOf(GUARD);
    this.actionPose = createPose();
    this.fromPose = createPose();
    this.lastPose = createPose();
    this.mixed = createPose();
    this.swayPose = createPose();
    this.clock = 0;
    this.reset();
  }
  reset() {
    this.action = null;
    this.time = 0;
    this.combo = -1;
    this.queued = false;
    this.recovery = 0;
    this.guard = 0;
    this.cooldown = 0;
    this.started = null;
    this.impacted = false;
    this.output.weight = 0;
    this.output.shake = 0;
    this.output.flare = 0;
  }
  get busy() { return Boolean(this.action); }
  /** Name of the strike that began since the last call, so the hero can re-aim. */
  takeStart() { const name = this.started; this.started = null; return name; }
  /** B pressed. speed lets a running hero open with the dash. */
  attack({ speed = 0 } = {}) {
    if (this.guarding || this.cooldown > 0) return false;
    if (this.action) {
      const t = this.time / this.action.duration;
      if (t >= this.action.buffer) this.queued = true;
      return this.queued;
    }
    // Shortly after a strike the combo continues; otherwise it starts again.
    const next = this.recovery > 0 && this.combo >= 0 && this.combo < COMBO.length - 1 ? this.combo + 1 : 0;
    this.start(next === 0 && speed > 2.6 ? 'dash' : COMBO[next], next);
    return true;
  }
  start(name, comboIndex) {
    copyPose(this.fromPose, this.lastPose);
    this.blendFrom = this.output.weight > 0.5 ? 1 : 0;
    this.action = { name, ...ATTACKS[name] };
    this.combo = name === 'dash' ? 0 : comboIndex;
    this.time = 0;
    this.queued = false;
    this.impacted = false;
    this.started = name;
  }
  update(dt, { guard = false } = {}) {
    const out = this.output;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    out.shake = Math.max(0, out.shake - dt * 4);
    out.flare = Math.max(0, out.flare - dt * 5);
    out.lift = 0; out.spin = 0; out.drive = 0; out.trail = 0;
    if (this.action) {
      const action = this.action;
      this.time += dt;
      let t = this.time / action.duration;
      if (this.queued && t >= action.chain && this.combo < COMBO.length - 1) {
        this.start(COMBO[this.combo + 1], this.combo + 1);
        t = 0;
      } else if (guard && t >= action.active[1]) {
        this.finish();
      } else if (t >= 1) {
        this.finish();
      }
      if (this.action) {
        const current = this.action;
        t = this.time / current.duration;
        sampleKeys(current.keys, t, this.actionPose);
        // Chained strikes start from wherever the previous one left the blade.
        if (this.blendFrom) mixPose(this.actionPose, this.fromPose, this.actionPose, ease(clamp01(this.time / 0.09)));
        copyPose(this.lastPose, this.actionPose);
        out.weight = Math.min(1, out.weight + dt / 0.07);
        for (const [from, to, speed] of current.drive ?? []) if (t >= from && t <= to) out.drive = speed * Math.sin(Math.PI * (t - from) / (to - from)) * 1.25;
        if (current.lift) { const [from, to, height] = current.lift; if (t > from && t < to) out.lift = Math.sin(Math.PI * (t - from) / (to - from)) * height; }
        if (current.spin) { const [from, to, turns] = current.spin; out.spin = ease(clamp01((t - from) / (to - from))) * turns * Math.PI * 2; }
        out.trail = window(t, current.trail);
        if (current.impact && !this.impacted && t >= current.impact) { this.impacted = true; out.shake = 1; out.flare = 1; }
        out.name = current.name;
      }
    }
    if (!this.action) {
      this.recovery = Math.max(0, this.recovery - dt);
      this.guard += ((guard ? 1 : 0) - this.guard) * (1 - Math.exp(-14 * dt));
      // Out of a strike the arms ease back to the captured motion, unless the
      // guard takes over the pose.
      out.weight = Math.max(this.guard, out.weight - dt / 0.3);
      // A held guard is alive: the hands breathe and the blade wavers.
      const guardPose = copyPose(this.swayPose, this.guardPose);
      guardPose.hand.x += Math.sin(this.clock * 1.7) * 0.008;
      guardPose.hand.y += Math.sin(this.clock * 2.3) * 0.006;
      guardPose.blade.x += Math.sin(this.clock * 1.3) * 0.05;
      guardPose.blade.normalize();
      mixPose(this.mixed, this.lastPose, guardPose, out.weight > 0 ? clamp01(this.guard / out.weight) : 1);
      copyPose(this.actionPose, this.mixed);
      copyPose(this.lastPose, this.mixed);
      out.name = this.guard > 0.5 ? 'guard' : null;
    } else {
      this.guard = 0;
    }
    copyPose(out, this.actionPose);
    out.guard = this.guard;
    const attacking = Boolean(this.action);
    out.inputScale = attacking ? 0.15 : 1;
    out.turnScale = attacking ? 0 : this.guard > 0.5 ? 0.6 : 1;
    out.maxSpeed = attacking ? Infinity : this.guard > 0.1 ? GUARD_SPEED + (1 - this.guard) * 3 : Infinity;
    out.engaged = attacking || this.guard > 0.1;
    return out;
  }
  finish() {
    const ended = this.action;
    this.action = null;
    this.recovery = 0.32;
    if (ended.name === 'slam') { this.combo = -1; this.cooldown = 0.2; }
  }
  get guarding() { return this.guard > 0.5 && !this.action; }
}
