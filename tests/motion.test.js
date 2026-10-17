import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionController, WALK_SPEED, RUN_SPEED, SPRINT_SPEED, SLOW_WALK_SPEED, speedForTilt } from '../src/motion.js';

function advance(controller, seconds, { fps = 60, x = 0, z = 0, sprint = false, ...options } = {}) {
  const settings = Object.keys(options).length ? { sprint, ...options } : sprint;
  const frames = Math.floor(seconds * fps + 1e-8);
  for (let frame = 0; frame < frames; frame++) controller.update(1 / fps, x, z, settings);
  const remainder = seconds - frames / fps;
  if (remainder > 1e-9) controller.update(remainder, x, z, settings);
  return controller;
}

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

test('walking accelerates smoothly to its target speed and brakes to a complete stop', () => {
  const motion = new MotionController();
  motion.update(1 / 60, 0, 1);
  assert.ok(motion.speed > 0 && motion.speed < WALK_SPEED * 0.5, 'the first frame must accelerate rather than jump to full speed');
  const firstSpeed = motion.speed;
  advance(motion, 0.4, { z: 1 });
  assert.ok(motion.speed > firstSpeed && motion.speed > WALK_SPEED * 0.95);
  advance(motion, 1, { z: 1 });
  close(motion.speed, WALK_SPEED, 0.001, 'walking speed');
  const releaseZ = motion.z;
  const releaseSpeed = motion.speed;
  motion.update(1 / 60, 0, 0);
  assert.ok(motion.speed > 0 && motion.speed < releaseSpeed, 'releasing input should brake over time');
  advance(motion, 0.8);
  assert.equal(motion.speed, 0, 'the player should settle without permanent drift');
  assert.ok(motion.z > releaseZ && motion.z - releaseZ < 0.3, 'braking must travel a short, controlled distance');
  const settledZ = motion.z;
  advance(motion, 2);
  assert.equal(motion.z, settledZ);
});

test('sprint blends from walking to running and returns to walking without a velocity jump', () => {
  const motion = advance(new MotionController(), 1, { x: 1 });
  const walkingSpeed = motion.speed;
  motion.update(1 / 60, 1, 0, true);
  assert.ok(motion.speed > walkingSpeed && motion.speed < SPRINT_SPEED);
  advance(motion, 1.3, { x: 1, sprint: true });
  close(motion.speed, SPRINT_SPEED, 0.001, 'sprinting speed');
  assert.ok(motion.runBlend > 0.98, 'a sustained sprint should reach the running animation');
  assert.ok(motion.sprint > 0.98, 'and the sprint posture');
  motion.update(1 / 60, 1, 0, false);
  assert.ok(motion.speed > WALK_SPEED && motion.speed < SPRINT_SPEED);
  advance(motion, 1.3, { x: 1 });
  close(motion.speed, WALK_SPEED, 0.001, 'speed after releasing sprint');
  assert.ok(motion.runBlend < 0.05, 'walk animation should resume after sprint ends');
});

test('diagonal movement has the same speed and travel distance as axial movement', () => {
  for (const sprint of [false, true]) {
    const axial = advance(new MotionController(), 2, { x: 1, sprint });
    const diagonal = advance(new MotionController(), 2, { x: 1, z: 1, sprint });
    close(diagonal.speed, axial.speed, 1e-9, 'diagonal speed');
    close(Math.hypot(diagonal.x, diagonal.z), axial.x, 1e-8, 'diagonal travelled distance');
    close(diagonal.x, diagonal.z, 1e-9, 'equal diagonal components');
  }
});

test('sprint responds within 150 ms and stops within a short controlled step', () => {
  const motion = new MotionController();
  motion.heading = 0;
  advance(motion, 0.15, { z: 1, sprint: true });
  assert.ok(motion.speed > SPRINT_SPEED * 0.9, 'a sprint should feel immediate while retaining acceleration');
  assert.ok(motion.forwardAccel > 0, 'a launch should provide forward weight transfer to the rig');
  advance(motion, 0.8, { z: 1, sprint: true });
  const releaseZ = motion.z;
  advance(motion, 0.1);
  assert.ok(motion.forwardAccel < 0, 'braking should reverse the body weight transfer');
  advance(motion, 0.15);
  assert.equal(motion.speed, 0, 'the character should settle in 250 ms');
  assert.ok(motion.z - releaseZ < 0.26, 'a released sprint must not slide across the floor');
});

test('analogue input supports arbitrary directions and partial walking speed', () => {
  const motion = advance(new MotionController(), 2, { x: 0.3, z: -0.4 });
  close(motion.speed, WALK_SPEED * 0.5, 0.001, 'half-strength analogue speed');
  close(motion.vx / motion.vz, -0.75, 0.001, 'arbitrary input direction');
  assert.ok(motion.x > 0 && motion.z < 0);
});

test('heading crosses the angle seam by the shortest turn and settles smoothly', () => {
  const motion = new MotionController();
  motion.heading = Math.PI - 0.08;
  const target = -Math.PI + 0.08;
  motion.update(1 / 60, Math.sin(target), Math.cos(target));
  assert.ok(motion.heading > Math.PI - 0.08, 'near ±π the short path increases heading through π');
  assert.ok(motion.heading < Math.PI + 0.08, 'the first frame should not snap or overshoot');
  advance(motion, 1, { x: Math.sin(target), z: Math.cos(target) });
  close(motion.heading, Math.PI + 0.08, 0.001, 'final heading on the short path');
  const settledHeading = motion.heading;
  advance(motion, 1);
  assert.equal(motion.heading, settledHeading, 'releasing input should retain the facing direction');
});

test('the blade stays lit for one idle second, retracts, and reignites as soon as movement resumes', () => {
  const motion = advance(new MotionController(), 0.95);
  assert.equal(motion.saber, 1, 'the blade must not retract early');
  advance(motion, 0.15);
  assert.ok(motion.saber > 0 && motion.saber < 0.8, 'retraction should animate after the idle delay');
  advance(motion, 0.15);
  assert.equal(motion.saber, 0, 'the blade must finish retracting');
  motion.update(1 / 60, 1, 0);
  assert.ok(motion.saber > 0, 'movement must start ignition on the first frame');
  assert.equal(motion.idleTime, 0, 'movement should reset the idle timer');
  advance(motion, 0.18, { x: 1 });
  assert.equal(motion.saber, 1, 'ignition must complete quickly');
});

test('a brief pause does not extinguish the blade, and new movement restarts the idle delay', () => {
  const motion = advance(new MotionController(), 0.8);
  advance(motion, 0.1, { z: 1 });
  advance(motion, 0.8);
  assert.equal(motion.saber, 1);
  advance(motion, 1.2);
  assert.equal(motion.saber, 0);
});

test('movement, facing, and saber timing remain consistent at 30, 60, and 144 fps', () => {
  const results = [30, 60, 144].map(fps => {
    const motion = new MotionController();
    advance(motion, 1.2, { fps, x: 1 });
    advance(motion, 0.8, { fps, x: 0.6, z: -0.8, sprint: true });
    advance(motion, 1.4, { fps, z: -1, sprint: true });
    advance(motion, 1, { fps });
    const stopped = { x: motion.x, z: motion.z, heading: motion.heading };
    advance(motion, 3, { fps });
    return { ...stopped, speed: motion.speed, saber: motion.saber };
  });
  const reference = results[1];
  for (const actual of results) {
    assert.ok(Math.hypot(actual.x - reference.x, actual.z - reference.z) < 0.09,
      'different refresh rates should finish the same movement sequence within nine centimetres');
    close(actual.heading, reference.heading, 0.01, 'frame-rate independent heading');
    assert.equal(actual.speed, 0);
    assert.equal(actual.saber, 0);
  }
});

test('all floor boundaries contain the player and allow immediate movement back inside', () => {
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1]]) {
    const motion = advance(new MotionController(), 20, { x, z, sprint: true });
    assert.ok(Math.abs(motion.x) <= 32 && Math.abs(motion.z) <= 32);
    if (x) assert.equal(motion.x, Math.sign(x) * 32);
    if (z) assert.equal(motion.z, Math.sign(z) * 32);
    const edgeX = motion.x, edgeZ = motion.z;
    advance(motion, 0.25, { x: -x, z: -z });
    if (x) assert.ok(Math.abs(motion.x) < Math.abs(edgeX));
    if (z) assert.ok(Math.abs(motion.z) < Math.abs(edgeZ));
  }
});

test('the analogue stick climbs from a slow walk to a sprint with its tilt', () => {
  assert.equal(speedForTilt(0), 0);
  assert.ok(Math.abs(speedForTilt(0.01) - SLOW_WALK_SPEED) < 0.01, 'a light tilt is a slow walk');
  assert.equal(speedForTilt(0.5), WALK_SPEED);
  assert.equal(speedForTilt(0.8), RUN_SPEED);
  assert.equal(speedForTilt(1), SPRINT_SPEED);
  let previous = speedForTilt(0.01);
  for (let tilt = 0.02; tilt <= 1; tilt += 0.01) {
    const speed = speedForTilt(tilt);
    assert.ok(speed >= previous - 1e-12, 'never slower when tilting further');
    assert.ok(speed - previous < 0.12, `no jump in speed at tilt ${tilt.toFixed(2)}`);
    previous = speed;
  }
  for (const [tilt, gait] of [[0.3, 'walk'], [0.85, 'run'], [1, 'sprint']]) {
    const motion = advance(new MotionController(), 1.5, { z: tilt, analog: true });
    close(motion.speed, speedForTilt(tilt), 0.001, `${gait} speed`);
    if (gait === 'walk') assert.ok(motion.runBlend < 0.05 && motion.sprint < 0.05);
    if (gait === 'run') assert.ok(motion.runBlend > 0.95 && motion.sprint < 0.4);
    if (gait === 'sprint') assert.ok(motion.sprint > 0.98);
  }
});

test('a guard caps the pace and an attack lunge drives along the facing', () => {
  const guarded = advance(new MotionController(), 1.5, { z: 1, analog: true, maxSpeed: 2.2 });
  close(guarded.speed, 2.2, 0.001, 'guard speed cap');
  const lunge = new MotionController();
  lunge.face(0);
  advance(lunge, 0.3, { drive: 3, inputScale: 0, engaged: true });
  assert.ok(lunge.z > 0.6 && Math.abs(lunge.x) < 1e-9, 'the lunge carries the hero forward');
  assert.equal(lunge.idleTime, 0, 'combat keeps the blade lit');
});
