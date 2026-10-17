import * as THREE from 'three';
import { approach, ease } from './tween.js';
import { angleDelta } from './motion.js';

/**
 * Free saber control: hold LT and the right stick wields the blade.
 *
 * The stick is the blade's point seen from above. Centred, the blade stands
 * raised in front of the hero; pushed, it leans towards that direction around
 * him, down to the horizon and a little below at full tilt. So turning the
 * stick sweeps the blade around him (horizontal cuts), a flick out from the
 * centre chops down (vertical cuts), and anything between draws a diagonal.
 * A slow move just repositions the blade; the stick's speed sets the power and
 * the pace of a stroke.
 *
 * The blade follows the stick through springs: it answers at once, yet keeps
 * inertia and follows through past its mark on a hard stroke. The torso winds
 * up against a stroke for an instant, then twists into it; the knees bend, a
 * strong forward stroke steps in, and the body turns to keep the blade within
 * reach. R3 rolls the blade a full, eased turn around the wrist beside the
 * shoulder, then hands it back to the stick.
 *
 * The output is a pose like CombatController's (root space: +Z forward, +X
 * his left), so the animator's IK places the arms and aims the blade — and the
 * real sweep of the blade is what strikes.
 */
const PIVOT = new THREE.Vector3(-0.1, 0.98, 0.12);
// Elevation of the blade with the stick centred and at full tilt (radians).
const RAISED = 1.35, LOWEST = -0.42;
// How far round (rad) the blade may lean before the body turns with it.
const REACH = 1.75;
const DEAD = 0.18;
const TWIRL_TIME = 0.5;
const TWIRLS = {
  R: { axis: new THREE.Vector3(1, 0.15, 0.25).normalize(), hand: new THREE.Vector3(-0.24, 1.12, 0.14) },
  L: { axis: new THREE.Vector3(1, -0.15, -0.25).normalize(), hand: new THREE.Vector3(0.06, 1.1, 0.18) },
};
const clamp = THREE.MathUtils.clamp, clamp01 = value => clamp(value, 0, 1);
const smoothRange = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A full turn, eased in and out, overshooting a little before it settles. */
export const twirlAngle = progress => Math.PI * 2 * (ease.inOutCubic(clamp01(progress)) + 0.08 * Math.sin(Math.PI * clamp01((progress - 0.55) / 0.45)));

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
      azimuth: 0, azimuthSpeed: 0, radius: 0, radiusSpeed: 0, targetAzimuth: 0, targetRadius: 0,
      lastAim: null, stickSpeed: 0, power: 0, windup: null, lunge: 0, twirl: null, hasPrevious: false, torso: 0, torsoSpeed: 0,
    });
    this.output.weight = 0;
    this.output.engaged = false;
  }
  get engaged() { return this.weight > 0.001; }
  get twirling() { return Boolean(this.twirl); }

  /** Takes the blade over from wherever it points (world direction): no jump. */
  engage(direction) {
    this.azimuth = this.targetAzimuth = Math.atan2(direction.x, direction.z);
    const elevation = Math.asin(clamp(direction.y, -1, 1));
    this.radius = this.targetRadius = clamp((RAISED - elevation) / (RAISED - LOWEST), 0, 1.2);
    this.azimuthSpeed = this.radiusSpeed = 0;
    this.lastAim = null;
  }

  /**
   * dt; active (LT held); aimX/aimZ the right stick on the floor in world
   * axes (length 0..1); heading the hero's facing; twirl a fresh R3 press;
   * blade the current world blade direction (to take over smoothly).
   */
  update(dt, { active = false, aimX = 0, aimZ = 0, heading = 0, twirl = false, blade = null } = {}) {
    const out = this.output;
    dt = clamp(dt, 0, 0.05);
    // R3 also works outside LT: the blade is taken just for the turn.
    if (twirl && !this.twirl && !active && !this.engaged) this.auto = true;
    if (this.auto && !twirl && !this.twirl) this.auto = false;
    const want = active || this.auto;
    if (want && !this.active && this.weight < 0.05 && blade) this.engage(blade);
    this.active = want;
    if (twirl && !this.twirl) this.startTwirl(heading);
    // In quickly, out a little slower, both eased.
    this.progress = approach(this.progress, want ? 1 : 0, dt / (want ? 0.14 : 0.26));
    this.weight = want ? ease.outCubic(this.progress) : ease.inOutSine(this.progress);
    out.weight = this.weight;
    out.engaged = this.weight > 0.01;
    out.heading = heading;
    if (!this.engaged) { out.trail = 0; out.drive = 0; out.power = 0; out.name = null; this.hasPrevious = false; return out; }

    // The stick: where the point goes, and how fast it was moved.
    const tilt = Math.min(1, Math.hypot(aimX, aimZ));
    if (active) {
      this.targetRadius = tilt < DEAD ? 0 : 0.15 + 0.85 * smoothRange(DEAD, 0.95, tilt);
      if (tilt >= DEAD) this.targetAzimuth = Math.atan2(aimX, aimZ);
    }
    const aimSpeed = this.lastAim && dt > 0 ? Math.hypot(aimX - this.lastAim.x, aimZ - this.lastAim.z) / dt : 0;
    this.lastAim = { x: aimX, z: aimZ };
    this.stickSpeed = Math.max(aimSpeed, this.stickSpeed * Math.exp(-14 * dt));
    const before = this.power;
    this.power = Math.max(clamp01((this.stickSpeed - 3) / 9), this.power - dt * 2.4);
    // A stroke begins: a quick wind-up of the body, and a step in if it goes forward.
    if (before < 0.35 && this.power >= 0.35) {
      this.windup = { age: 0, sign: Math.sign(angleDelta(this.azimuth, this.targetAzimuth)) || 1 };
      this.lunge = 0.24;
    }

    // Springs: stiffer and looser on a hard stroke, so it lands fast and follows through.
    const omega = 20 + 16 * this.power, zeta = 0.72 - 0.2 * this.power, radialZeta = 0.62 - 0.15 * this.power;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const error = angleDelta(this.azimuth, this.targetAzimuth);
      this.azimuthSpeed += (omega * omega * error - 2 * zeta * omega * this.azimuthSpeed) * h;
      this.azimuthSpeed = clamp(this.azimuthSpeed, -24, 24);
      this.azimuth += this.azimuthSpeed * h;
      this.radiusSpeed += (omega * omega * (this.targetRadius - this.radius) - 2 * radialZeta * omega * this.radiusSpeed) * h;
      this.radius = clamp(this.radius + this.radiusSpeed * h, -0.08, 1.3);
    }
    this.azimuth = Math.atan2(Math.sin(this.azimuth), Math.cos(this.azimuth));

    // The body turns to keep the blade in reach, and slowly faces a held blade.
    let facing = heading;
    const extended = smoothRange(0.15, 0.5, this.radius);
    let rel = angleDelta(facing, this.azimuth);
    if (extended > 0) {
      if (Math.abs(rel) > REACH) facing = this.azimuth - Math.sign(rel) * REACH;
      else facing += rel * (1 - Math.exp(-1.2 * dt)) * extended * (1 - this.power);
      rel = angleDelta(facing, this.azimuth);
    }
    out.heading = facing;

    // The pose, in the hero's root space.
    const reach = clamp01(this.radius);
    const elevation = Math.min(1.5, RAISED + (LOWEST - RAISED) * this.radius);
    out.blade.set(Math.cos(elevation) * Math.sin(rel), Math.sin(elevation), Math.cos(elevation) * Math.cos(rel)).normalize();
    const lean = smoothRange(0, 0.4, reach);
    const towards = new THREE.Vector3(Math.sin(rel), 0, Math.cos(rel)).multiplyScalar(lean).add(new THREE.Vector3(0, 0, 1 - lean)).normalize();
    out.hand.copy(PIVOT).addScaledVector(towards, 0.12 + 0.2 * reach);
    out.hand.y += 0.06 - 0.12 * reach;
    out.hand.x = clamp(out.hand.x, -0.5, 0.22);
    out.hand.z = Math.max(out.hand.z, -0.12);
    // Raised in front, both hands on the hilt; reaching out, the free arm counterbalances.
    out.grip = (1 - smoothRange(0.15, 0.5, reach)) * clamp01(1 - Math.abs(rel) / 1.2);
    out.left.set(0.3, 0.96, 0.05).addScaledVector(towards, -0.06);
    // Torso: it has its own inertia. It turns towards the blade and leads the
    // swing, but a stroke first kicks it the other way: the blade leaves at
    // once while the body coils for an instant, then whips into the swing
    // and follows through past it.
    let windup = 0;
    if (this.windup) {
      if (this.windup.age === 0) this.torsoSpeed -= this.windup.sign * 7;
      this.windup.age += dt;
      windup = Math.sin(Math.PI * clamp01(this.windup.age / 0.12));
      if (this.windup.age > 0.12) this.windup = null;
    }
    const twist = clamp(rel * 0.5, -0.75, 0.75) * smoothRange(0, 0.5, reach) + clamp(this.azimuthSpeed * 0.03, -0.3, 0.3) * reach;
    for (let i = 0; i < steps; i++) {
      this.torsoSpeed += (196 * (twist - this.torso) - 2 * 0.6 * 14 * this.torsoSpeed) * h;
      this.torso += this.torsoSpeed * h;
    }
    out.yaw = clamp(this.torso, -0.95, 0.95);
    out.pitch = -0.04 + 0.12 * reach + 0.08 * this.power + clamp(this.radiusSpeed * 0.02, -0.1, 0.15);
    out.crouch = 0.45 + 0.2 * reach + 0.35 * this.power + Math.abs(windup) * 0.15;
    // A hard forward stroke carries a step.
    this.lunge = Math.max(0, this.lunge - dt);
    out.drive = this.lunge > 0 ? this.power * Math.max(0, Math.cos(rel)) * reach * 1.6 * Math.sin(Math.PI * this.lunge / 0.24) : 0;

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
    this.world.copy(out.blade).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
    const turnRate = this.hasPrevious && dt > 0 ? this.previousWorld.angleTo(this.world) / dt : 0;
    this.previousWorld.copy(this.world);
    this.hasPrevious = true;
    out.trail = Math.max(clamp01((turnRate - 4) / 8), twirlTrail) * this.weight;
    out.power = this.power;
    out.guard = 0; out.lift = 0; out.spin = 0; out.flare = 0; out.shake = 0;
    out.inputScale = 1;
    // A raised blade lets the hero steer as usual; a levelled one sets his facing.
    out.turnScale = 1 - smoothRange(0.1, 0.35, reach);
    out.maxSpeed = 2.6;
    out.name = this.twirl ? 'twirl' : this.power > 0.3 ? 'stroke' : 'free';
    return out;
  }

  startTwirl(heading) {
    const rel = angleDelta(heading, this.azimuth);
    this.twirl = { age: 0, side: this.radius > 0.35 && rel > 0.5 ? TWIRLS.L : TWIRLS.R };
  }
}
