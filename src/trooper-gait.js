import * as THREE from 'three';
import { MOCAP_BONES, MOCAP_CLIPS } from './mocap-clips.js';

/**
 * Motion capture for the stormtroopers. The Jedi's captured idle, walk and
 * run are played on each trooper's own skeleton: walk and run share one gait
 * phase whose rate follows his real ground speed (so the planted foot stays
 * put), the gaits cross-fade with the pace, and a fast turn on the spot
 * becomes a few steps rather than a skid. Walking backwards plays the walk in
 * reverse. Each trooper starts at his own point of the cycles, so the squad
 * never moves in step.
 *
 * Retargeting: both skeletons stand +Z forward with identity rest rotations,
 * so the trunk and legs copy the captured rotations (the trooper's single
 * spine joint takes the captured Spine→Spine2 chain, his neck takes Neck and
 * Head). His arms rest hanging down where the capture's rest is a T-pose: a
 * fixed quarter turn about Z maps one rest onto the other, so the captured
 * swing and twist carry over and the elbows still bend forward.
 */
const COUNT = MOCAP_BONES.length;
const INDEX = Object.fromEntries(MOCAP_BONES.map((name, index) => [name, index]));
const PARENT = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
};
const CLIPS = Object.fromEntries(Object.entries(MOCAP_CLIPS).map(([name, clip]) => [name, {
  ...clip,
  rotations: clip.rotations.map(frame => Float32Array.from(frame)),
  duration: clip.frames / clip.fps,
}]));
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
// Trooper arm rest (hanging) → captured arm rest (T-pose).
const ARM_REST = { L: new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2), R: new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2) };
const ARM_REST_INVERSE = { L: ARM_REST.L.clone().invert(), R: ARM_REST.R.clone().invert() };
/** The trooper joints the gait drives. */
export const GAIT_JOINTS = ['pelvis', 'spine', 'neck', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR'];

function createPose() { return { q: new Float32Array(COUNT * 4), hips: new THREE.Vector3(), ground: 0 }; }
const next = new THREE.Vector3();
function sample(clip, phase, out) {
  const position = (((phase % 1) + 1) % 1) * clip.frames;
  const i = Math.floor(position) % clip.frames, j = (i + 1) % clip.frames, t = position - Math.floor(position);
  const a = clip.rotations[i], b = clip.rotations[j];
  for (let k = 0; k < COUNT; k++) THREE.Quaternion.slerpFlat(out.q, k * 4, a, k * 4, b, k * 4, t);
  out.hips.fromArray(clip.hips[i]).lerp(next.fromArray(clip.hips[j]), t);
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
const smooth = u => u * u * (3 - 2 * u);
const clamp = THREE.MathUtils.clamp;
const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));

/**
 * One trooper's gait. legLength: hip to ankle on his skeleton.
 * update(dt, { speed, backward, turnRate }) then the joint rotations are in
 * `rotations` (local, per trooper joint), the pelvis offset in `hips`, and
 * the captured height of the soles above the floor in `ground`.
 */
export function createGait({ legLength = 0.71, offset = Math.random() } = {}) {
  const scale = legLength / CLIPS.walk.legLength;
  // Ground covered by a full cycle on his legs.
  const cycle = { walk: CLIPS.walk.speed * CLIPS.walk.duration * scale, run: CLIPS.run.speed * CLIPS.run.duration * scale };
  const idlePose = createPose(), walkPose = createPose(), runPose = createPose(), gaitPose = createPose(), pose = createPose();
  const world = Array.from({ length: COUNT }, () => new THREE.Quaternion());
  const local = Array.from({ length: COUNT }, () => new THREE.Quaternion());
  const rotations = Object.fromEntries(GAIT_JOINTS.map(name => [name, new THREE.Quaternion()]));
  const state = { phase: offset % 1, idleTime: (offset * 7.31 % 1) * CLIPS.idle.duration, motion: 0, running: 0, direction: 1, speed: 0 };
  const hips = new THREE.Vector3();
  const q = new THREE.Quaternion(), counter = new THREE.Quaternion();

  function update(dt, { speed = 0, backward = false, turnRate = 0 } = {}) {
    dt = clamp(dt, 0, 0.05);
    // Turning on the spot steps round; a stagger steps too.
    const pace = Math.max(speed, Math.min(0.9, Math.abs(turnRate) * 0.32));
    state.speed = pace;
    state.motion = damp(state.motion, smooth(clamp(pace / 0.5, 0, 1)), pace > 0.1 ? 9 : 6, dt);
    state.running = damp(state.running, smooth(clamp((pace - 1.7) / 1.4, 0, 1)), 7, dt);
    state.direction = backward ? -1 : 1;
    const distance = THREE.MathUtils.lerp(cycle.walk, cycle.run, state.running);
    state.phase = (state.phase + state.direction * Math.max(pace, 0.45 * state.motion) / distance * dt + 1) % 1;
    state.idleTime += dt;
    sample(CLIPS.idle, state.idleTime / CLIPS.idle.duration, idlePose);
    sample(CLIPS.walk, state.phase, walkPose);
    sample(CLIPS.run, state.phase, runPose);
    blend(gaitPose, walkPose, runPose, smooth(state.running));
    blend(pose, idlePose, gaitPose, state.motion);

    // Captured rotations, relative to his root.
    for (let k = 0; k < COUNT; k++) {
      local[k].fromArray(pose.q, k * 4);
      const parent = PARENT[MOCAP_BONES[k]];
      if (parent) world[k].multiplyQuaternions(world[INDEX[parent]], local[k]);
      else world[k].copy(local[k]);
    }
    const W = name => world[INDEX[name]], L = name => local[INDEX[name]];
    rotations.pelvis.copy(W('Hips'));
    rotations.spine.copy(W('Hips')).invert().multiply(W('Spine2'));
    rotations.neck.copy(W('Spine2')).invert().multiply(W('Head'));
    for (const [side, name] of [['L', 'Left'], ['R', 'Right']]) {
      rotations[`hip${side}`].copy(L(`${name}UpLeg`));
      rotations[`knee${side}`].copy(L(`${name}Leg`));
      rotations[`ankle${side}`].copy(L(`${name}Foot`));
      rotations[`shoulder${side}`].copy(W('Spine2')).invert().multiply(W(`${name}Arm`)).multiply(ARM_REST[side]);
      rotations[`elbow${side}`].copy(ARM_REST_INVERSE[side]).multiply(L(`${name}ForeArm`)).multiply(ARM_REST[side]);
      rotations[`wrist${side}`].copy(ARM_REST_INVERSE[side]).multiply(L(`${name}Hand`)).multiply(ARM_REST[side]);
    }
    hips.copy(pose.hips).multiplyScalar(scale);
    return api;
  }
  /** Turns the legs (pelvis) by `yaw` about the vertical and the trunk back, so the chest keeps its heading. */
  function twist(yaw) {
    if (Math.abs(yaw) < 1e-4) return;
    const pelvis = rotations.pelvis;
    // The chest (pelvis · spine) stays as it was: spine' = pelvis⁻¹ · yaw⁻¹ · pelvis · spine.
    q.setFromAxisAngle(UP, -yaw);
    counter.copy(pelvis).invert().multiply(q).multiply(pelvis);
    rotations.spine.premultiply(counter);
    pelvis.premultiply(q.setFromAxisAngle(UP, yaw));
  }
  const api = { update, twist, rotations, hips, state, cycle, scale, get ground() { return pose.ground * scale; } };
  return api;
}
