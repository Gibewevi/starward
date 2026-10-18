import * as THREE from 'three';
import { approach, ease } from './tween.js';

/**
 * Free saber control: hold LT and the right stick wields the blade, in the
 * hero's own frame, as if seen from behind him.
 *
 *   up: raised high          up-left / up-right: high over a shoulder
 *   left / right: out to his left or right side, level
 *   down: low, towards the floor ahead          down-left / down-right: low corners
 *   centred: a middle guard, pointing ahead
 *
 * Moving the stick from one place to another swings the blade between them:
 * right to left is a horizontal slash, up to down an overhead chop, corner to
 * corner a diagonal, round the rim a circling moulinet. A slow move only
 * repositions the blade; the stick's speed sets the power and pace of the
 * stroke. Letting go of the stick brings the blade back to the guard gently,
 * without a stroke (a flick straight across the centre still cuts through).
 * The right stick never turns the hero: the left stick does.
 *
 * The blade follows the stick through springs: it answers at once, keeps
 * inertia, and follows through past its mark on a hard stroke. The torso
 * coils against a stroke for an instant, then whips into it; the knees bend,
 * a hard stroke steps in. R3 rolls the blade a full, eased turn around the
 * wrist beside the shoulder, then hands it back to the stick.
 *
 * The output is a pose like CombatController's (root space: +Z forward, +X
 * his left), so the animator's IK places the arms and aims the blade — and the
 * real sweep of the blade is what strikes.
 */
const RIGHT = new THREE.Vector3(-1, 0, 0), UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1);
// Below NOISE the stick is at rest (drift); strokes count beyond DEAD.
const NOISE = 0.12, DEAD = 0.2;
const FOLLOW = 1.2;
const TWIRL_TIME = 0.5;
const TWIRLS = {
  R: { axis: new THREE.Vector3(1, 0.15, 0.25).normalize(), hand: new THREE.Vector3(-0.24, 1.12, 0.14) },
  L: { axis: new THREE.Vector3(1, -0.15, -0.25).normalize(), hand: new THREE.Vector3(0.06, 1.1, 0.18) },
};
const clamp = THREE.MathUtils.clamp, clamp01 = value => clamp(value, 0, 1);
const smoothRange = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A full turn, eased in and out, overshooting a little before it settles. */
export const twirlAngle = progress => Math.PI * 2 * (ease.inOutCubic(clamp01(progress)) + 0.08 * Math.sin(Math.PI * clamp01((progress - 0.55) / 0.45)));

/** Blade direction (root space) for a point (u right, v up) of the stick's disc. */
export function bladeFor(u, v, out = new THREE.Vector3()) {
  const reach = Math.min(1, Math.hypot(u, v));
  return out.set(0, 0, 0)
    .addScaledVector(FORWARD, 1.1 - 0.75 * reach)
    .addScaledVector(RIGHT, u)
    .addScaledVector(UP, (v > 0 ? v : v * 0.6) + 0.25 * (1 - reach))
    .normalize();
}

export class SaberControl {
  constructor() {
    this.output = {
      hand: new THREE.Vector3(), blade: new THREE.Vector3(0, 1, 0), left: new THREE.Vector3(), grip: 0, yaw: 0, pitch: 0, crouch: 0,
      weight: 0, guard: 0, lift: 0, spin: 0, drive: 0, inputScale: 1, turnScale: 1, maxSpeed: Infinity, trail: 0, flare: 0, shake: 0,
      name: null, engaged: false, heading: 0, power: 0,
    };
    this.world = new THREE.Vector3();
    this.previousWorld = new THREE.Vector3();
    this.reset();
  }
  reset() {
    Object.assign(this, {
      active: false, auto: false, progress: 0, weight: 0,
      u: 0, v: 0, uSpeed: 0, vSpeed: 0, targetU: 0, targetV: 0, releasing: true, waiting: false, resting: 0,
      lastStick: null, stickSpeed: 0, power: 0, windup: null, lunge: 0, twirl: null, hasPrevious: false, torso: 0, torsoSpeed: 0,
    });
    this.output.weight = 0;
    this.output.engaged = false;
  }
  get engaged() { return this.weight > 0.001; }
  get twirling() { return Boolean(this.twirl); }
  /** Where the blade is on the stick's disc: u to his right, v up. */
  get stick() { return { u: this.u, v: this.v }; }

  /** Takes the blade over from wherever it points (world direction): no jump. */
  engage(direction, heading = 0) {
    const local = direction.clone().applyAxisAngle(UP, -heading);
    let u = -local.x, v = local.y;
    const length = Math.hypot(u, v);
    if (length > 1) { u /= length; v /= length; }
    Object.assign(this, { u, v, targetU: u, targetV: v, uSpeed: 0, vSpeed: 0, lastStick: null, waiting: false, resting: 0 });
  }

  /**
   * dt; active (LT held); stickX/stickY the right stick (right and up
   * positive, length 0..1); heading the hero's facing; twirl a fresh R3
   * press; blade the current world blade direction (to take over smoothly).
   */
  update(dt, { active = false, stickX = 0, stickY = 0, heading = 0, twirl = false, blade = null } = {}) {
    const out = this.output;
    dt = clamp(dt, 0, 0.05);
    // R3 also works outside LT: the blade is taken just for the turn.
    if (twirl && !this.twirl && !active && !this.engaged) this.auto = true;
    if (this.auto && !twirl && !this.twirl) this.auto = false;
    const want = active || this.auto;
    if (want && !this.active && this.weight < 0.05 && blade) this.engage(blade, heading);
    this.active = want;
    if (twirl && !this.twirl) this.twirl = { age: 0, side: this.u < -0.4 ? TWIRLS.L : TWIRLS.R };
    // In quickly, out a little slower, both eased.
    this.progress = approach(this.progress, want ? 1 : 0, dt / (want ? 0.14 : 0.26));
    this.weight = want ? ease.outCubic(this.progress) : ease.inOutSine(this.progress);
    out.weight = this.weight;
    out.engaged = this.weight > 0.01;
    out.heading = heading;
    if (!this.engaged) { out.trail = 0; out.drive = 0; out.power = 0; out.name = null; this.hasPrevious = false; return out; }

    // The stick: where the blade should go — continuous through the centre,
    // so a slow pass never jumps — and how fast it was asked to.
    const tilt = Math.min(1, Math.hypot(stickX, stickY));
    // A stick rushing back towards the centre is either let go or the start
    // of a flick across: the blade holds still for that instant. If the stick
    // comes out the other side, the stroke goes; if it rests in the centre,
    // the blade returns to the guard gently — no stroke.
    const last = this.lastStick, lastTilt = last ? Math.min(1, Math.hypot(last.x, last.y)) : 0;
    const aligned = last && tilt > 1e-4 && lastTilt > 1e-4 ? (stickX * last.x + stickY * last.y) / (tilt * lastTilt) : 1;
    const retracting = Boolean(last) && dt > 0 && (lastTilt - tilt) / dt > 4 && (tilt < DEAD || aligned > 0.85);
    if (active) {
      if (retracting) this.waiting = true;
      else if (this.waiting && (tilt > lastTilt + 0.004 || (tilt >= DEAD && aligned < 0.85))) this.waiting = false;
      this.resting = tilt < NOISE ? this.resting + dt : 0;
      if (this.waiting && this.resting >= 0.04) { this.waiting = false; this.releasing = true; }
      if (!this.waiting) {
        const reach = smoothRange(NOISE, 0.95, tilt);
        if (tilt > 1e-4) { this.targetU = stickX / tilt * reach; this.targetV = stickY / tilt * reach; }
        else this.targetU = this.targetV = 0;
        if (tilt > lastTilt + 0.004) this.releasing = false;
      }
    }
    const moved = last && dt > 0 && tilt >= DEAD && !retracting && !this.waiting ? Math.hypot(stickX - last.x, stickY - last.y) / dt : 0;
    this.lastStick = { x: stickX, y: stickY };
    this.stickSpeed = Math.max(moved, this.stickSpeed * Math.exp(-14 * dt));
    const before = this.power;
    this.power = Math.max(clamp01((this.stickSpeed - 3) / 9), this.power - dt * 2.4);
    // A stroke begins: the body coils for an instant, and a hard one steps in.
    if (before < 0.35 && this.power >= 0.35) {
      this.windup = { age: 0, across: Math.sign(this.targetU - this.u), down: this.targetV < this.v - 0.3 };
      this.lunge = 0.24;
    }

    // Springs: stiff and loose on a hard stroke (fast, follows through), soft
    // and calm when the stick is let go.
    const omega = this.releasing ? 6.5 : 20 + 16 * this.power, zeta = this.releasing ? 1 : 0.7 - 0.2 * this.power;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.uSpeed += (omega * omega * (this.targetU - this.u) - 2 * zeta * omega * this.uSpeed) * h;
      this.vSpeed += (omega * omega * (this.targetV - this.v) - 2 * zeta * omega * this.vSpeed) * h;
      this.u += this.uSpeed * h;
      this.v += this.vSpeed * h;
      const length = Math.hypot(this.u, this.v);
      if (length > FOLLOW) { this.u *= FOLLOW / length; this.v *= FOLLOW / length; }
    }
    const { u, v } = this;
    const reach = Math.min(1, Math.hypot(u, v)), high = Math.max(0, v), low = Math.max(0, -v);

    // The pose, in the hero's root space.
    bladeFor(u, v, out.blade);
    out.hand.set(-0.1 - 0.25 * u, 1 + 0.2 * high - 0.15 * low, 0.26 - 0.08 * reach).addScaledVector(out.blade, 0.08 * this.power);
    out.hand.x = clamp(out.hand.x, -0.48, 0.2);
    out.hand.y = clamp(out.hand.y, 0.8, 1.26);
    // Both hands on the hilt in the guard and overhead; out to the side, the
    // free arm swings the other way to balance.
    out.grip = clamp01(1 - Math.abs(u) * 1.4) * (v > -0.3 ? 1 : 0.5) * (1 - 0.5 * this.power);
    out.left.set(0.3 + 0.06 * Math.max(0, u), 0.96, 0.05);
    // Torso: its own inertia. It turns towards the blade's side and leads the
    // swing; a stroke first kicks it the other way, so the body coils for an
    // instant, then whips into the swing and follows through past it.
    let windup = 0;
    if (this.windup) {
      if (this.windup.age === 0) this.torsoSpeed += this.windup.across * 7;
      this.windup.age += dt;
      windup = Math.sin(Math.PI * clamp01(this.windup.age / 0.12));
      if (this.windup.age > 0.12) this.windup = null;
    }
    const twist = clamp(-u * 0.55, -0.75, 0.75) + clamp(-this.uSpeed * 0.03, -0.3, 0.3);
    for (let i = 0; i < steps; i++) {
      this.torsoSpeed += (196 * (twist - this.torso) - 2 * 0.6 * 14 * this.torsoSpeed) * h;
      this.torso += this.torsoSpeed * h;
    }
    out.yaw = clamp(this.torso, -0.95, 0.95);
    // Leaning back under a raised blade, over a low one, into a hard stroke;
    // an overhead chop rises a touch before it falls.
    out.pitch = -0.1 * high + 0.14 * low + 0.08 * this.power + clamp(-this.vSpeed * 0.02, -0.1, 0.15);
    const rise = this.windup?.down ? windup : 0;
    out.crouch = 0.45 + 0.3 * low + 0.35 * this.power + 0.15 * windup - 0.3 * rise;
    this.lunge = Math.max(0, this.lunge - dt);
    out.drive = this.lunge > 0 ? this.power * 1.3 * Math.sin(Math.PI * this.lunge / 0.24) : 0;

    // R3: a full turn of the wrist beside the shoulder, then back to the stick.
    let twirlTrail = 0;
    if (this.twirl) {
      const twirl = this.twirl;
      twirl.age += dt;
      const progress = clamp01(twirl.age / TWIRL_TIME);
      const hold = smoothRange(0, 0.18, progress) * (1 - smoothRange(0.82, 1, progress));
      out.hand.lerp(twirl.side.hand, hold);
      const flat = out.blade.clone().addScaledVector(twirl.side.axis, -out.blade.dot(twirl.side.axis));
      if (flat.lengthSq() > 1e-6) out.blade.lerp(flat.normalize(), hold).normalize();
      const angle = twirlAngle(progress);
      out.blade.applyAxisAngle(twirl.side.axis, angle);
      // The wrist drives it: the hand circles a little with the blade.
      const a = new THREE.Vector3(0, 1, 0).cross(twirl.side.axis).normalize(), b = new THREE.Vector3().crossVectors(twirl.side.axis, a);
      const circle = 0.03 * Math.sin(Math.PI * progress);
      out.hand.addScaledVector(a, Math.sin(angle) * circle).addScaledVector(b, (1 - Math.cos(angle)) * circle);
      out.grip *= 1 - hold;
      out.crouch += 0.1 * hold;
      twirlTrail = smoothRange(0, 0.06, progress) * (1 - smoothRange(0.9, 1, progress));
      if (progress >= 1) this.twirl = null;
    }

    // The trail lights up with the blade's real angular speed.
    this.world.copy(out.blade).applyAxisAngle(UP, heading);
    const turnRate = this.hasPrevious && dt > 0 ? this.previousWorld.angleTo(this.world) / dt : 0;
    this.previousWorld.copy(this.world);
    this.hasPrevious = true;
    out.trail = Math.max(clamp01((turnRate - 4) / 8), twirlTrail) * this.weight;
    out.power = this.power;
    out.guard = 0; out.lift = 0; out.spin = 0; out.flare = 0; out.shake = 0;
    out.inputScale = 1;
    // The left stick still turns him; the blade never does.
    out.turnScale = 1;
    out.maxSpeed = 2.6;
    out.name = this.twirl ? 'twirl' : this.power > 0.3 ? 'stroke' : 'free';
    return out;
  }
}
