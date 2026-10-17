// Frame-rate independent movement, kept separate from rendering for verification.
// Paced for the hero's short legs, so captured steps keep a natural cadence.
export const SLOW_WALK_SPEED = 0.6;
export const WALK_SPEED = 1.7;
export const RUN_SPEED = 3.3;
export const SPRINT_SPEED = 4.5;
export const IDLE_SABER_DELAY = 1;
export const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);

/** Analogue stick: slow walk → brisk walk → run → sprint at full tilt, continuously. */
export function speedForTilt(tilt) {
  tilt = clamp01(tilt);
  if (tilt <= 0) return 0;
  if (tilt < 0.5) return SLOW_WALK_SPEED + (WALK_SPEED - SLOW_WALK_SPEED) * ease(tilt / 0.5);
  if (tilt < 0.8) return WALK_SPEED + (RUN_SPEED - WALK_SPEED) * ease((tilt - 0.5) / 0.3);
  if (tilt < 0.95) return RUN_SPEED + (SPRINT_SPEED - RUN_SPEED) * ease((tilt - 0.8) / 0.15);
  return SPRINT_SPEED;
}

export class MotionController {
  constructor() { this.reset(); }
  reset() {
    this.x = this.z = this.vx = this.vz = this.speed = this.runBlend = this.sprint = 0;
    this.heading = 1.85;
    this.turnRate = 0;
    this.forwardAccel = 0;
    this.idleTime = 0;
    this.saber = 1;
  }
  /**
   * options: true/false (keyboard sprint), or { sprint, analog, maxSpeed,
   * inputScale, drive (m/s pushed along the facing), turnScale, engaged }.
   */
  update(dt, inputX, inputZ, options = false) {
    const { sprint = false, analog = false, maxSpeed = Infinity, inputScale = 1, drive = 0, turnScale = 1, engaged = false } =
      typeof options === 'object' ? options : { sprint: options };
    dt = Math.min(Math.max(dt, 0), 1 / 20);
    const magnitude = Math.min(1, Math.hypot(inputX, inputZ));
    const rawLength = Math.hypot(inputX, inputZ);
    if (rawLength > 0) { inputX /= rawLength; inputZ /= rawLength; }
    const desired = Math.min(maxSpeed, analog ? speedForTilt(magnitude) : magnitude * (sprint ? SPRINT_SPEED : WALK_SPEED)) * inputScale;
    const targetX = inputX * desired + Math.sin(this.heading) * drive;
    const targetZ = inputZ * desired + Math.cos(this.heading) * drive;
    const previousVx = this.vx, previousVz = this.vz;
    const responsiveness = drive ? 30 : magnitude > 0.01 ? 18 : 24;
    this.vx = damp(this.vx, targetX, responsiveness, dt);
    this.vz = damp(this.vz, targetZ, responsiveness, dt);
    if (magnitude < 0.01 && !drive && Math.hypot(this.vx, this.vz) < 0.015) this.vx = this.vz = 0;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const bound = 32;
    if (Math.abs(this.x) > bound) { this.x = Math.sign(this.x) * bound; this.vx = 0; }
    if (Math.abs(this.z) > bound) { this.z = Math.sign(this.z) * bound; this.vz = 0; }
    this.speed = Math.hypot(this.vx, this.vz);
    const previousHeading = this.heading;
    if (magnitude > 0.04 && turnScale > 0) {
      const targetHeading = Math.atan2(inputX, inputZ);
      this.heading += angleDelta(this.heading, targetHeading) * (1 - Math.exp(-18 * turnScale * dt));
    }
    this.turnRate = damp(this.turnRate, dt ? angleDelta(previousHeading, this.heading) / dt : 0, 12, dt);
    // Acceleration informs posture: the body pitches into a launch and absorbs
    // braking, instead of a run loop being played on a rigid upright figure.
    const projectedAccel = dt > 0 ? ((this.vx - previousVx) * Math.sin(this.heading) + (this.vz - previousVz) * Math.cos(this.heading)) / dt : 0;
    this.forwardAccel = damp(this.forwardAccel, Math.max(-35, Math.min(35, projectedAccel)), 18, dt);
    // The gait changes from walking to running near 2 m/s on these legs.
    this.runBlend = damp(this.runBlend, clamp01((this.speed - 1.9) / 1.1), 18, dt);
    this.sprint = damp(this.sprint, clamp01((this.speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED)), 18, dt);
    this.idleTime = this.speed < 0.04 && magnitude < 0.01 && !engaged ? this.idleTime + dt : 0;
    const targetSaber = this.idleTime >= IDLE_SABER_DELAY ? 0 : 1;
    this.saber = damp(this.saber, targetSaber, targetSaber ? 38 : 34, dt);
    if (this.saber < 0.003) this.saber = 0;
    if (this.saber > 0.997) this.saber = 1;
    return this;
  }
  /** Turns towards an angle immediately (attacks re-aim at their start). */
  face(angle) { this.heading = this.heading + angleDelta(this.heading, angle); }
}
