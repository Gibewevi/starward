import * as THREE from 'three';
import { Ragdoll } from './ragdoll.js';
import { aimBone } from './ik.js';
import { ease } from './tween.js';

/**
 * The hero thrown off his feet by a blast. A Verlet ragdoll is built on his
 * joints where his animated pose has them, launched with the blast's push and
 * a tumble; it flies, hits the floor and the crates, bounces, rolls and
 * slides. He stays alive in it: his muscles tuck his knees and bring his arms
 * in front of his head while he flies, and keep him curled as he slides. His
 * skeleton is fitted to the ragdoll every frame (the skinned body, the coat
 * and the lit saber simply follow). Once he lies still he gets up — onto one
 * knee, then standing, eased — and the motion capture takes him back.
 *
 * knock(velocity) starts it; update(dt) returns null while he is down and
 * { x, z, heading } the moment he is back on his feet.
 *
 * knock(velocity, { dead: true }): he is dead — no muscles, a limp body that
 * falls where the hit throws it and never gets up (a blast still moves it).
 * `hit` ({ at, velocity }): the part nearest `at` takes a push of its own (a
 * bolt through the shoulder twists him round as he goes down).
 */
const JOINTS = [
  ['hips', 'Hips', 0.13, 4], ['chest', 'Spine2', 0.14, 4], ['neck', 'Neck', 0.06, 1], ['head', 'Head', 0.1, 1.5],
  ['shoulderL', 'LeftArm', 0.07, 1.2], ['elbowL', 'LeftForeArm', 0.05, 0.8], ['handL', 'LeftHand', 0.05, 0.5],
  ['shoulderR', 'RightArm', 0.07, 1.2], ['elbowR', 'RightForeArm', 0.05, 0.8], ['handR', 'RightHand', 0.05, 0.5],
  ['hipL', 'LeftUpLeg', 0.08, 2], ['kneeL', 'LeftLeg', 0.065, 1.2], ['footL', 'LeftFoot', 0.055, 0.8], ['toeL', 'LeftToeBase', 0.04, 0.3],
  ['hipR', 'RightUpLeg', 0.08, 2], ['kneeR', 'RightLeg', 0.065, 1.2], ['footR', 'RightFoot', 0.055, 0.8], ['toeR', 'RightToeBase', 0.04, 0.3],
];
const CROWN = new THREE.Vector3(0, 0.2, 0.03);
const BODIES = [
  ['torso', ['hips', 'chest', 'shoulderL', 'shoulderR', 'hipL', 'hipR']], ['neck', ['chest', 'neck']], ['head', ['neck', 'head', 'crown']],
  ['upperArmL', ['shoulderL', 'elbowL']], ['forearmL', ['elbowL', 'handL']], ['upperArmR', ['shoulderR', 'elbowR']], ['forearmR', ['elbowR', 'handR']],
  ['thighL', ['hipL', 'kneeL']], ['shinL', ['kneeL', 'footL']], ['footL', ['footL', 'toeL']],
  ['thighR', ['hipR', 'kneeR']], ['shinR', ['kneeR', 'footR']], ['footR', ['footR', 'toeR']],
];
const LINKS = [['torso', 'neck'], ['neck', 'head'], ['torso', 'upperArmL'], ['upperArmL', 'forearmL'], ['torso', 'upperArmR'], ['upperArmR', 'forearmR'],
  ['torso', 'thighL'], ['thighL', 'shinL'], ['shinL', 'footL'], ['torso', 'thighR'], ['thighR', 'shinR'], ['shinR', 'footR']];
// Ranges that keep the joints anatomical: elbows and knees do not fold flat, the head stays on.
const LIMITS = [['shoulderL', 'handL', 0.14], ['shoulderR', 'handR', 0.14], ['hipL', 'footL', 0.26], ['hipR', 'footR', 0.26], ['crown', 'chest', 0.27], ['head', 'hips', 0.5], ['kneeL', 'chest', 0.22], ['kneeR', 'chest', 0.22]];
const AIMS = [['Neck', 'Head', 'head'], ['LeftArm', 'LeftForeArm', 'elbowL'], ['LeftForeArm', 'LeftHand', 'handL'], ['RightArm', 'RightForeArm', 'elbowR'], ['RightForeArm', 'RightHand', 'handR'],
  ['LeftUpLeg', 'LeftLeg', 'kneeL'], ['LeftLeg', 'LeftFoot', 'footL'], ['LeftFoot', 'LeftToeBase', 'toeL'], ['RightUpLeg', 'RightLeg', 'kneeR'], ['RightLeg', 'RightFoot', 'footR'], ['RightFoot', 'RightToeBase', 'toeR']];
// One knee down, the other up, leaning forward: halfway up from the floor.
const KNEEL = { Hips: [0, 0, 0], Spine: [0.22, 0, 0], Spine1: [0.14, 0, 0], Neck: [-0.22, 0, 0], LeftUpLeg: [-1.45, 0, 0.08], LeftLeg: [1.5, 0, 0], LeftFoot: [-0.05, 0, 0], RightUpLeg: [-0.12, 0, -0.06], RightLeg: [2.15, 0, 0], RightFoot: [0.65, 0, 0], LeftArm: [-0.5, 0, 0.35], LeftForeArm: [0, -0.6, 0] };

export function createHeroRagdoll(character, { lab = null, random = Math.random } = {}) {
  const { root } = character, bones = character.rig.bones;
  const names = Object.keys(bones);
  let ragdoll = null, index = {}, state = null, effort = 0;
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3(), from = new THREE.Vector3(), current = new THREE.Vector3();
  const up = new THREE.Vector3(), left = new THREE.Vector3(), front = new THREE.Vector3(), basis = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const P = name => ragdoll.particles[index[name]].position;

  function build() {
    root.updateMatrixWorld(true);
    ragdoll = new Ragdoll({ gravity: -11, damping: 0.995, friction: 0.3, bounce: 0.18 });
    index = {};
    for (const [name, bone, radius, mass] of JOINTS) index[name] = ragdoll.addParticle({ name, position: bones[bone].getWorldPosition(temp), radius, mass });
    index.crown = ragdoll.addParticle({ name: 'crown', position: bones.Head.localToWorld(temp.copy(CROWN)), radius: 0.1, mass: 1 });
    const bodies = {};
    for (const [name, members] of BODIES) bodies[name] = ragdoll.addBody({ name, indices: members.map(member => index[member]) });
    for (const [a, b] of LINKS) ragdoll.connect(bodies[a], bodies[b]);
    for (const [a, b, min] of LIMITS) ragdoll.addLimit(index[a], index[b], min);
    for (const particle of ragdoll.particles) particle.kinematic = false;
    ragdoll.boxes = lab?.obstacles ?? [];
    ragdoll.drivers.push(muscles);
  }
  /** The torso's frame from its particles: left, up, front. */
  function frame() {
    up.subVectors(P('chest'), P('hips')).normalize();
    left.subVectors(P('shoulderL'), P('shoulderR'));
    left.addScaledVector(up, -left.dot(up)).normalize();
    front.crossVectors(left, up);
    return Number.isFinite(left.x) && left.lengthSq() > 0.5;
  }
  /** Alive: knees tucked, forearms up before the face, chin in — held loosely. */
  const targets = [
    ['kneeL', 'hips', [0.13, -0.12, 0.3]], ['kneeR', 'hips', [-0.13, -0.12, 0.3]], ['footL', 'hips', [0.15, -0.42, 0.05]], ['footR', 'hips', [-0.15, -0.42, 0.05]],
    ['handL', 'chest', [0.16, 0.12, 0.3]], ['handR', 'chest', [-0.16, 0.1, 0.32]], ['elbowL', 'chest', [0.24, -0.04, 0.16]], ['elbowR', 'chest', [-0.24, -0.04, 0.16]],
    ['head', 'chest', [0, 0.2, 0.08]],
  ];
  function muscles() {
    if (!state || state.dead || state.phase === 'rising' || effort <= 0 || !frame()) return;
    for (const [name, anchor, [x, y, z]] of targets) {
      const target = temp.copy(P(anchor)).addScaledVector(left, x).addScaledVector(up, y).addScaledVector(front, z);
      P(name).lerp(target, 0.035 * effort);
    }
  }

  function knock(velocity, { spin = 4 + random() * 4, dead = false, hit = null } = {}) {
    dead ||= Boolean(state?.dead);
    if (state?.phase === 'rising') state = null;
    if (!state) build();
    const all = ragdoll.particles.map((_, i) => i);
    const centre = all.reduce((sum, i) => sum.add(ragdoll.particles[i].position), new THREE.Vector3()).divideScalar(all.length);
    // Thrown, and tumbling about an axis across the push.
    const flat = temp2.copy(velocity).setY(0);
    const axis = new THREE.Vector3(0, 1, 0).cross(flat.lengthSq() > 1e-6 ? flat.normalize() : flat.set(1, 0, 0)).multiplyScalar(spin * (random() < 0.75 ? 1 : -0.7));
    for (const i of all) {
      const particle = ragdoll.particles[i];
      ragdoll.push([i], temp.crossVectors(axis, new THREE.Vector3().subVectors(particle.position, centre)).add(velocity).multiplyScalar(0.93 + random() * 0.14));
    }
    if (hit) {
      let nearest = 0;
      ragdoll.particles.forEach((particle, i) => { if (particle.position.distanceToSquared(hit.at) < ragdoll.particles[nearest].position.distanceToSquared(hit.at)) nearest = i; });
      ragdoll.push([nearest], hit.velocity);
    }
    state = { phase: 'flying', age: 0, still: 0, dead };
    effort = dead ? 0 : 1;
    return true;
  }

  /** The skeleton laid over the ragdoll. */
  function fit() {
    if (!frame()) return;
    const hips = P('hips');
    root.position.set(hips.x, 0, hips.z);
    root.quaternion.identity();
    bones.Hips.position.set(0, hips.y, 0);
    bones.Hips.quaternion.setFromRotationMatrix(basis.makeBasis(left, up, front));
    for (const name of ['Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder']) bones[name].quaternion.identity();
    root.updateMatrixWorld(true);
    for (const [bone, child, particle] of AIMS) aimBone(bones[bone], bones[bone].getWorldPosition(from), bones[child].getWorldPosition(current), P(particle));
    aimBone(bones.Head, bones.Head.getWorldPosition(from), bones.Head.localToWorld(current.copy(CROWN)), P('crown'));
    character.skeleton.update();
  }

  const snapshot = () => names.map(name => ({ q: bones[name].quaternion.clone(), p: bones[name].position.clone() }));
  function restore(pose) { names.forEach((name, i) => { bones[name].quaternion.copy(pose[i].q); bones[name].position.copy(pose[i].p); }); }
  /** From lying still to getting up: facing his feet if he lies on his back, his head if face down. */
  function beginRise(time) {
    frame();
    const onBack = front.y > 0;
    const direction = onBack ? temp.subVectors(P('hips'), P('chest')) : temp.subVectors(P('chest'), P('hips'));
    const heading = Math.atan2(direction.x, direction.z);
    // The hips, re-expressed in the turned root.
    const hipsWorld = bones.Hips.quaternion.clone(), hipsAt = bones.Hips.position.clone();
    root.rotation.set(0, heading, 0);
    root.updateMatrixWorld(true);
    const inverse = root.quaternion.clone().invert();
    bones.Hips.quaternion.copy(inverse).multiply(hipsWorld);
    bones.Hips.position.copy(hipsAt.applyQuaternion(inverse));
    const lying = snapshot();
    // Standing: what the motion capture would show right now. Kneeling: from it.
    character.update({ dt: 0, time, speed: 0, runBlend: 0, turnRate: 0 });
    const standing = snapshot();
    const kneeling = standing.map(entry => ({ q: entry.q.clone(), p: entry.p.clone() }));
    names.forEach((name, i) => {
      const bend = KNEEL[name];
      if (bend) kneeling[i].q.multiply(quaternion.setFromEuler(new THREE.Euler(...bend)));
    });
    const hips = names.indexOf('Hips');
    kneeling[hips].p.y -= 0.36;
    kneeling[hips].p.z -= 0.05;
    restore(lying);
    character.skeleton.update();
    state = { phase: 'rising', age: 0, duration: 1.1 + random() * 0.25, lying, kneeling, standing, heading };
  }
  function riseStep(dt) {
    const s = state;
    s.age += dt;
    const p = Math.min(1, s.age / s.duration);
    const [a, b, u] = p < 0.45 ? [s.lying, s.kneeling, ease.inOutCubic(p / 0.45)] : [s.kneeling, s.standing, ease.inOutCubic((p - 0.45) / 0.55)];
    names.forEach((name, i) => {
      bones[name].quaternion.slerpQuaternions(a[i].q, b[i].q, u);
      bones[name].position.lerpVectors(a[i].p, b[i].p, u);
    });
    root.updateMatrixWorld(true);
    character.skeleton.update();
    return p >= 1;
  }

  function update(dt, time = 0) {
    if (!state || !(dt > 0)) return null;
    // Dead and lying still: nothing more to work out.
    if (state.dead && state.still > 1.5) return null;
    if (state.phase === 'rising') {
      if (!riseStep(dt)) return null;
      const result = { x: root.position.x, z: root.position.z, heading: state.heading };
      state = null;
      ragdoll = null;
      return result;
    }
    state.age += dt;
    ragdoll.step(dt);
    // Flying he braces; down, he stays curled, his effort easing off.
    const airborne = P('hips').y > 0.35;
    if (!state.dead) effort += ((airborne ? 1 : 0.18) - effort) * (1 - Math.exp(-4 * dt));
    let fastest = 0;
    for (let i = 0; i < ragdoll.particles.length; i++) fastest = Math.max(fastest, ragdoll.velocity(i, temp).length());
    state.still = fastest < 0.5 ? state.still + dt : 0;
    fit();
    if (!state.dead && ((state.age > 0.9 && state.still > 0.3) || state.age > 2.6)) beginRise(time);
    return null;
  }
  /** Back on his feet at once (the hero is reset). */
  function stop() { state = null; ragdoll = null; }
  return {
    knock, update, stop,
    get active() { return Boolean(state); },
    get dead() { return Boolean(state?.dead); },
    /** How long he has lain still (s). */
    get still() { return state?.still ?? 0; },
    get phase() { return state?.phase ?? null; },
    /** Where his hips are (the camera follows them). */
    get position() { return ragdoll && state?.phase !== 'rising' ? P('hips') : root.position; },
    get velocity() { return ragdoll && state?.phase !== 'rising' ? ragdoll.velocity(index.hips, new THREE.Vector3()) : new THREE.Vector3(); },
  };
}
