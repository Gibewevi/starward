import * as THREE from 'three';
import { MOCAP_BONES, MOCAP_CLIPS } from './mocap-clips.js';

/**
 * Motion capture playback for the Jedi rig. Captured idle, walk and run are
 * blended by speed with a shared gait phase, so steps never restart when the
 * pace changes. Light procedural layers sit on top: leaning into acceleration
 * and turns, a sprint crouch, arms held clear of the coat, a head that looks
 * into turns, the sword hand, and a ground pass that plants the soles.
 */
const COUNT = MOCAP_BONES.length;
const CLIPS = Object.fromEntries(Object.entries(MOCAP_CLIPS).map(([name, clip]) => [name, {
  ...clip,
  rotations: clip.rotations.map(frame => Float32Array.from(frame)),
  duration: clip.frames / clip.fps,
}]));

// Short stylised legs need longer strides than the captured performer's to
// cover ground at a natural cadence: the thigh swing is widened around its
// mean, and the ground pass lowers the hips into the longer stride.
export const STRIDE = { walk: 1.25, run: 1.3 };
for (const [name, gain] of Object.entries(STRIDE)) {
  for (const bone of ['LeftUpLeg', 'RightUpLeg']) {
    const k = MOCAP_BONES.indexOf(bone) * 4;
    const frames = CLIPS[name].rotations;
    const mean = new THREE.Quaternion(0, 0, 0, 0), q = new THREE.Quaternion();
    for (const frame of frames) {
      q.fromArray(frame, k);
      if (mean.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      mean.set(mean.x + q.x, mean.y + q.y, mean.z + q.z, mean.w + q.w);
    }
    mean.normalize();
    for (const frame of frames) mean.clone().slerp(q.fromArray(frame, k), gain).toArray(frame, k);
  }
}

function createPose() { return { q: new Float32Array(COUNT * 4), hips: new THREE.Vector3(), ground: 0 }; }
function sample(clip, phase, out) {
  const position = (((phase % 1) + 1) % 1) * clip.frames;
  const i = Math.floor(position) % clip.frames, j = (i + 1) % clip.frames, t = position - Math.floor(position);
  const a = clip.rotations[i], b = clip.rotations[j];
  for (let k = 0; k < COUNT; k++) THREE.Quaternion.slerpFlat(out.q, k * 4, a, k * 4, b, k * 4, t);
  out.hips.fromArray(clip.hips[i]).lerp(new THREE.Vector3().fromArray(clip.hips[j]), t);
  out.ground = clip.ground[i] + (clip.ground[j] - clip.ground[i]) * t;
  return out;
}
function blend(out, a, b, weight) {
  if (weight <= 0) { out.q.set(a.q); out.hips.copy(a.hips); out.ground = a.ground; return out; }
  if (weight >= 1) { out.q.set(b.q); out.hips.copy(b.hips); out.ground = b.ground; return out; }
  for (let k = 0; k < COUNT; k++) THREE.Quaternion.slerpFlat(out.q, k * 4, a.q, k * 4, b.q, k * 4, weight);
  out.hips.lerpVectors(a.hips, b.hips, weight);
  out.ground = a.ground + (b.ground - a.ground) * weight;
  return out;
}

export function createAnimator({ root, bones, list, restPositions, legLength, saberSocket }) {
  const scale = legLength / CLIPS.walk.legLength;
  const idlePose = createPose(), walkPose = createPose(), runPose = createPose(), gaitPose = createPose(), pose = createPose();
  const hipsIndex = MOCAP_BONES.indexOf('Hips');
  const hipsRest = restPositions[hipsIndex];
  const clamp = THREE.MathUtils.clamp;
  const damp = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
  const smooth = value => value * value * (3 - 2 * value);
  const offset = new THREE.Quaternion(), euler = new THREE.Euler();
  const pre = (bone, x, y, z) => bone.quaternion.premultiply(offset.setFromEuler(euler.set(x, y, z)));
  const soles = [
    ['LeftFoot', [0, -0.09, -0.035]], ['LeftFoot', [0, -0.09, 0.07]], ['LeftToeBase', [0, -0.025, 0.02]],
    ['RightFoot', [0, -0.09, -0.035]], ['RightFoot', [0, -0.09, 0.07]], ['RightToeBase', [0, -0.025, 0.02]],
  ].map(([name, local]) => ({ bone: bones[name], local: new THREE.Vector3(...local) }));
  const point = new THREE.Vector3(), inverseRoot = new THREE.Matrix4();
  const bladeDirection = new THREE.Vector3(), bladeTarget = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const handQuaternion = new THREE.Quaternion(), rootQuaternion = new THREE.Quaternion(), bladeQuaternion = new THREE.Quaternion();
  const handPosition = new THREE.Vector3(), shoulderPosition = new THREE.Vector3(), reach = new THREE.Vector3();
  const idleBlade = new THREE.Vector3(-0.52, -0.6, 0.6).normalize();
  const walkBlade = new THREE.Vector3(-0.5, -0.75, -0.2).normalize();
  const runBlade = new THREE.Vector3(-0.3, -0.36, -0.88).normalize();
  const state = { phase: 0, idleTime: 0, motion: 0, running: 0, sprint: 0, bank: 0, lean: 0, look: 0, groundOffset: 0 };

  function applyPose(pose, { motion, running, sprint, bank, lean, look }, action = null) {
    list.forEach((bone, index) => {
      bone.quaternion.fromArray(pose.q, index * 4);
      bone.position.copy(restPositions[index]);
    });
    bones.Hips.position.set(hipsRest.x + pose.hips.x * scale, hipsRest.y + pose.hips.y * scale, hipsRest.z + pose.hips.z * scale);

    // Torso: forward pitch into acceleration and sprint, roll into turns. The
    // neck and head take back most of it, so the gaze stays on the horizon.
    const pitch = lean + sprint * 0.24 * motion + running * 0.08;
    pre(bones.Hips, pitch * 0.25, 0, bank * 0.35);
    pre(bones.Spine, pitch * 0.35, 0, bank * 0.4);
    pre(bones.Spine1, pitch * 0.3, look * 0.2, bank * 0.3);
    pre(bones.Spine2, pitch * 0.2, look * 0.2, 0);
    pre(bones.Neck, -pitch * 0.45, look * 0.25, -bank * 0.4);
    pre(bones.Head, -pitch * 0.35, look * 0.35, -bank * 0.4);
    // The tailored coat is bulkier than the captured performer: hold the arms
    // clear of it. At rest the hands hang out to the sides, ready, as drawn.
    const ready = 1 - motion;
    pre(bones.LeftArm, 0, 0, 0.2 + ready * 0.16 - running * 0.06);
    pre(bones.RightArm, -0.1 * ready, 0, -(0.24 + ready * 0.18 - running * 0.05));
    pre(bones.LeftForeArm, 0, -0.38 * ready, 0);
    pre(bones.RightForeArm, 0, 0.45 * ready, 0);
    // A wider, grounded stance at rest.
    pre(bones.LeftUpLeg, 0, 0, 0.12 * ready);
    pre(bones.RightUpLeg, 0, 0, -0.12 * ready);
    pre(bones.LeftFoot, 0, 0, -0.12 * ready);
    pre(bones.RightFoot, 0, 0, 0.12 * ready);
    bones.Hips.position.y -= sprint * motion * 0.035;

    // Sword work: the torso twists and pitches into the strike, the gaze stays
    // on the target, and the knees bend into a fighting stance.
    const weight = action?.weight ?? 0;
    if (weight > 0) {
      const { yaw, pitch: strike, crouch } = action;
      pre(bones.Spine, strike * 0.35 * weight, yaw * 0.35 * weight, 0);
      pre(bones.Spine1, strike * 0.35 * weight, yaw * 0.35 * weight, 0);
      pre(bones.Spine2, strike * 0.3 * weight, yaw * 0.3 * weight, 0);
      pre(bones.Neck, -strike * 0.4 * weight, -yaw * 0.3 * weight, 0);
      pre(bones.Head, -strike * 0.4 * weight, -yaw * 0.3 * weight, 0);
      const bend = crouch * 0.42 * weight;
      for (const side of ['Left', 'Right']) {
        pre(bones[`${side}UpLeg`], -bend, 0, 0);
        pre(bones[`${side}Leg`], bend * 2, 0, 0);
        pre(bones[`${side}Foot`], -bend, 0, 0);
      }
    }

    // Ground pass: the lowest sole meets the floor, except during the run's
    // captured flight phase.
    root.updateMatrixWorld(true);
    inverseRoot.copy(root.matrixWorld).invert();
    let lowest = Infinity;
    for (const sole of soles) {
      point.copy(sole.local).applyMatrix4(sole.bone.matrixWorld).applyMatrix4(inverseRoot);
      lowest = Math.min(lowest, point.y);
    }
    const correction = pose.ground * scale - lowest;
    state.groundOffset = correction;
    bones.Hips.position.y += correction + (action?.lift ?? 0) * weight;
    root.updateMatrixWorld(true);

    return correction;
  }

  // Ground covered by one cycle on this rig. While a sole is planted it slides
  // back under the body at the body's speed; flight phases continue at that
  // speed. Measured once, on the real proportions, so the cadence always
  // matches the speed without the feet sliding.
  function measureCycle(name) {
    const layers = { motion: 1, running: name === 'run' ? 1 : 0, sprint: name === 'run' ? 1 : 0, bank: 0, lean: 0, look: 0 };
    const samples = 96;
    let travel = 0, contact = 0, previous = null;
    for (let i = 0; i <= samples; i++) {
      sample(CLIPS[name], i / samples, pose);
      applyPose(pose, layers);
      let lowest = null;
      for (const sole of soles) {
        point.copy(sole.local).applyMatrix4(sole.bone.matrixWorld).applyMatrix4(inverseRoot);
        if (!lowest || point.y < lowest.y) lowest = { y: point.y, z: point.z, bone: sole.bone.name.startsWith('Left') };
      }
      if (previous && previous.bone === lowest.bone && lowest.y < 0.03) { travel += Math.max(0, previous.z - lowest.z); contact++; }
      previous = lowest;
    }
    return travel * samples / Math.max(1, contact);
  }
  const cycle = { walk: measureCycle('walk'), run: measureCycle('run') };

  // Two-bone arm IK, solved in world space: the elbow bends towards the pole.
  const ik = { s: new THREE.Vector3(), e: new THREE.Vector3(), h: new THREE.Vector3(), dir: new THREE.Vector3(), bend: new THREE.Vector3(), elbow: new THREE.Vector3(), reach: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() };
  const worldQuaternion = new THREE.Quaternion(), parentQuaternion = new THREE.Quaternion(), delta = new THREE.Quaternion();
  function aim(bone, from, current, desired) {
    ik.a.subVectors(current, from).normalize();
    ik.b.subVectors(desired, from).normalize();
    delta.setFromUnitVectors(ik.a, ik.b);
    bone.getWorldQuaternion(worldQuaternion).premultiply(delta);
    bone.parent.getWorldQuaternion(parentQuaternion);
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion));
    bone.updateMatrixWorld(true);
  }
  function solveArm(upper, lower, end, target, pole) {
    upper.getWorldPosition(ik.s); lower.getWorldPosition(ik.e); end.getWorldPosition(ik.h);
    const a = ik.s.distanceTo(ik.e), b = ik.e.distanceTo(ik.h);
    ik.dir.subVectors(target, ik.s);
    const d = clamp(ik.dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    ik.dir.normalize();
    const cosine = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    ik.bend.subVectors(pole, ik.s);
    ik.bend.addScaledVector(ik.dir, -ik.bend.dot(ik.dir));
    if (ik.bend.lengthSq() < 1e-8) ik.bend.set(0, -1, 0);
    ik.bend.normalize();
    ik.elbow.copy(ik.s).addScaledVector(ik.dir, a * cosine).addScaledVector(ik.bend, a * Math.sqrt(1 - cosine * cosine));
    ik.reach.copy(ik.s).addScaledVector(ik.dir, d);
    aim(upper, ik.s, ik.e, ik.elbow);
    lower.getWorldPosition(ik.e); end.getWorldPosition(ik.h);
    aim(lower, ik.e, ik.h, ik.reach);
  }
  const arms = ['Right', 'Left'].map(side => ({
    upper: bones[`${side}Arm`], lower: bones[`${side}ForeArm`], end: bones[`${side}Hand`],
    pole: new THREE.Vector3(side === 'Right' ? -0.55 : 0.55, -0.35, -0.45),
    fk: [new THREE.Quaternion(), new THREE.Quaternion()],
  }));
  const target = new THREE.Vector3(), poleWorld = new THREE.Vector3(), actionBlade = new THREE.Vector3(), grip = new THREE.Vector3();
  function applyArm(arm, goal, weight) {
    arm.fk[0].copy(arm.upper.quaternion);
    arm.fk[1].copy(arm.lower.quaternion);
    arm.upper.getWorldPosition(poleWorld);
    poleWorld.add(ik.a.copy(arm.pole).applyQuaternion(rootQuaternion));
    solveArm(arm.upper, arm.lower, arm.end, goal, poleWorld);
    if (weight < 1) {
      arm.upper.quaternion.slerpQuaternions(arm.fk[0], arm.upper.quaternion.clone(), weight);
      arm.lower.quaternion.slerpQuaternions(arm.fk[1], arm.lower.quaternion.clone(), weight);
      arm.upper.updateMatrixWorld(true);
    }
  }

  function update({ dt = 1 / 60, time = 0, speed = 0, runBlend = 0, sprintIntent = runBlend, turnRate = 0, forwardAccel = 0, action = null } = {}) {
    dt = clamp(dt, 0, 0.05);
    state.motion = damp(state.motion, smooth(clamp(speed / 0.45, 0, 1)), speed > 0.1 ? 10 : 7, dt);
    state.running = damp(state.running, clamp(runBlend, 0, 1), 9, dt);
    state.sprint = damp(state.sprint, clamp(Number(sprintIntent), 0, 1), 18, dt);
    state.bank = damp(state.bank, clamp(-turnRate * speed * 0.016, -0.2, 0.2), 8, dt);
    state.lean = damp(state.lean, clamp(forwardAccel / 22, -1, 1) * 0.12, 10, dt);
    state.look = damp(state.look, clamp(turnRate * 0.05, -0.32, 0.32), 6, dt);

    // One phase drives both gaits. Its rate follows the real ground speed, so
    // the planted foot stays under the body; very slow steps keep a minimum pace.
    const distance = THREE.MathUtils.lerp(cycle.walk, cycle.run, state.running);
    state.phase = (state.phase + Math.max(speed, 0.5 * state.motion) / distance * dt) % 1;
    state.idleTime += dt;
    sample(CLIPS.idle, state.idleTime / CLIPS.idle.duration, idlePose);
    sample(CLIPS.walk, state.phase, walkPose);
    sample(CLIPS.run, state.phase, runPose);
    blend(gaitPose, walkPose, runPose, smooth(state.running));
    blend(pose, idlePose, gaitPose, state.motion);
    applyPose(pose, state, action);
    root.getWorldQuaternion(rootQuaternion);
    const weight = action?.weight ?? 0;
    if (weight > 0) {
      // Strikes and guard place the sword hand and aim the blade; the other
      // hand counterbalances or joins it on the hilt.
      applyArm(arms[0], target.copy(action.hand).applyMatrix4(root.matrixWorld), weight);
      actionBlade.copy(action.blade).applyQuaternion(rootQuaternion).normalize();
      saberSocket?.getWorldPosition(grip).addScaledVector(actionBlade, -0.1);
      target.copy(action.left).applyMatrix4(root.matrixWorld).lerp(grip, action.grip);
      applyArm(arms[1], target, weight);
    }

    if (saberSocket) {
      const { motion, running } = state, ready = 1 - motion;
      // The blade is carried low, then trails behind in a run; it follows the
      // swing of the captured sword arm instead of being locked in place.
      bladeTarget.copy(idleBlade).lerp(walkBlade, motion).lerp(runBlade, smooth(running) * motion);
      bones.RightHand.getWorldPosition(handPosition);
      bones.RightArm.getWorldPosition(shoulderPosition);
      reach.copy(handPosition).sub(shoulderPosition).applyQuaternion(rootQuaternion.clone().invert());
      bladeTarget.z += (reach.z - 0.02) * 1.2 * (1 - 0.8 * smooth(running));
      bladeTarget.y += Math.sin(time * 1.3) * 0.02 * ready;
      bladeDirection.copy(bladeTarget).normalize().applyQuaternion(rootQuaternion);
      if (weight > 0) bladeDirection.lerp(actionBlade, weight).normalize();
      bones.RightHand.getWorldQuaternion(handQuaternion);
      bladeQuaternion.setFromUnitVectors(up, bladeDirection);
      saberSocket.quaternion.copy(handQuaternion.invert()).multiply(bladeQuaternion);
      saberSocket.updateMatrixWorld(true);
    }
  }
  return { update, state, scale, cycle, clips: CLIPS };
}
