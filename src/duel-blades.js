import * as THREE from 'three';

/**
 * The blade's life on top of the choreographed poses, for the duel. A strike
 * coming at him: his guard goes to meet it — the hand towards the side it
 * comes from, the blade laid across its path (high and flat against a blow
 * from above, upright against a cut from the side). Blades meeting: both
 * jump on springs and settle — the attacker's thrown back along its swing,
 * the defender's driven in, the body rocked. Locked in a bind, the two
 * blades press against each other, trembling. A broken guard flings the
 * blade out and the body back. Tired, the guard sags and the shoulders heave.
 *
 * Everything is in the fighter's root space (+Z ahead, −X his sword side),
 * laid over the combat controller's output; the overlays take the arms over
 * (weight 1) while they last.
 *
 * update(dt, base, { meet, bind, broken, fatigue, time }) → the pose to
 * animate. meet: { point, against } (where the strike will cross his front,
 * the direction of the striking blade); bind: { point } (where the blades cross).
 * knock(hand m/s, spin rad/s, lean): a jolt on the springs.
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Z = V(0, 0, 1);
const clamp = THREE.MathUtils.clamp;

function spring(stiffness, damping, value = 0) {
  return { x: typeof value === 'number' ? value : value.clone(), v: typeof value === 'number' ? 0 : V(), stiffness, damping };
}
function stepScalar(s, dt) {
  s.v += (-s.stiffness * s.x - s.damping * s.v) * dt;
  s.x += s.v * dt;
}
function stepVector(s, dt) {
  s.v.addScaledVector(s.x, -s.stiffness * dt).multiplyScalar(Math.max(0, 1 - s.damping * dt));
  s.x.addScaledVector(s.v, dt);
}

export function createLivingBlade() {
  const hand = spring(240, 17, V()), turn = spring(210, 15, V());
  const lean = spring(95, 11), sink = spring(120, 12);
  const weights = { meet: 0, bind: 0, broken: 0 };
  const meetPose = { hand: V(), blade: V(0, 1, 0), left: V(), grip: 0.85, yaw: 0.15, pitch: 0.04, crouch: 0.7 };
  const bindPose = { hand: V(-0.08, 1.12, 0.36), blade: V(0, 0.6, 0.8).normalize(), left: V(0.04, 1.08, 0.36), grip: 1, yaw: 0.1, pitch: 0.18, crouch: 0.95 };
  const brokenPose = { hand: V(-0.46, 0.88, -0.08), blade: V(-0.55, -0.62, -0.55).normalize(), left: V(0.42, 1.12, 0.05), grip: 0, yaw: -0.35, pitch: -0.28, crouch: 1.15 };
  const out = { hand: V(), blade: V(0, 1, 0), left: V(), grip: 0, yaw: 0, pitch: 0, crouch: 0.5 };
  const across = V(), target = V(), axis = V();
  const meetHand = V(), meetBlade = V(0, 1, 0);
  let tracked = false;

  /** Where to hold the blade against a strike crossing his front at `point` with the striking blade along `against`. */
  function aim(point, against) {
    // The hand goes towards the side the blow comes from, between hip and head.
    meetHand.set(clamp(point.x * 0.55 - 0.06, -0.44, 0.3), clamp(point.y * 0.72 + 0.28, 0.86, 1.4), 0.3);
    // The blade across the blow's path: perpendicular to it, in the plane facing him.
    across.crossVectors(against, Z);
    if (across.lengthSq() < 0.02) across.set(1, 0.2, 0);
    across.normalize();
    if (across.y < -0.1) across.negate();
    // Flat (a blow from above): high, the blade across towards his free side.
    if (Math.abs(across.y) < 0.45) {
      if (across.x < 0) across.negate();
      meetHand.y = Math.max(meetHand.y, 1.3);
      across.y = Math.max(across.y, 0.18);
    }
    across.z += 0.18;
    meetBlade.copy(across.normalize());
  }

  function mix(pose, w) {
    if (w <= 1e-4) return;
    out.hand.lerp(pose.hand, w);
    out.blade.lerp(pose.blade, w).normalize();
    out.left.lerp(pose.left, w);
    out.grip += (pose.grip - out.grip) * w;
    out.yaw += (pose.yaw - out.yaw) * w;
    out.pitch += (pose.pitch - out.pitch) * w;
    out.crouch += (pose.crouch - out.crouch) * w;
  }
  const approach = (value, goal, up, down, dt) => value + (goal - value) * (1 - Math.exp(-(goal > value ? up : down) * dt));

  return {
    /** A jolt: the hand pushed (m/s, his space), the blade spun (rad/s about an axis), the body rocked (rad/s of pitch, + leaning in). */
    knock(handVelocity = null, spin = null, rock = 0, drop = 0) {
      if (handVelocity) hand.v.add(handVelocity);
      if (spin) turn.v.add(spin);
      lean.v += rock;
      sink.v += drop;
    },
    reset() {
      hand.x.set(0, 0, 0); hand.v.set(0, 0, 0); turn.x.set(0, 0, 0); turn.v.set(0, 0, 0);
      lean.x = lean.v = sink.x = sink.v = 0;
      weights.meet = weights.bind = weights.broken = 0;
      tracked = false;
    },
    get weights() { return weights; },
    update(dt, base, { meet = null, bind = null, broken = false, fatigue = 0, time = 0 } = {}) {
      stepVector(hand, dt); stepVector(turn, dt); stepScalar(lean, dt); stepScalar(sink, dt);
      if (meet) {
        aim(meet.point, meet.against);
        // Tracking the blow: the guard follows it fast, it does not jump.
        if (!tracked) { meetPose.hand.copy(base.hand); meetPose.blade.copy(base.blade); tracked = true; }
        meetPose.hand.lerp(meetHand, 1 - Math.exp(-22 * dt));
        meetPose.blade.lerp(meetBlade, 1 - Math.exp(-20 * dt)).normalize();
        meetPose.left.copy(meetPose.hand).add(target.set(0.13, -0.04, 0.02));
        meetPose.yaw = clamp(0.12 - meetPose.hand.x * 0.5, -0.3, 0.45);
      } else tracked = false;
      if (bind) {
        target.copy(bind.point).sub(bindPose.hand);
        target.y += 0.25;
        bindPose.blade.copy(target.normalize());
        // Pressing against each other: the hands tremble.
        bindPose.hand.set(-0.08 + Math.sin(time * 31) * 0.008, 1.12 + Math.sin(time * 23) * 0.01, 0.36);
      }
      weights.meet = approach(weights.meet, meet ? 1 : 0, 26, 9, dt);
      weights.bind = approach(weights.bind, bind ? 1 : 0, 30, 10, dt);
      weights.broken = approach(weights.broken, broken ? 1 : 0, 22, 4, dt);

      out.hand.copy(base.hand); out.blade.copy(base.blade); out.left.copy(base.left);
      out.grip = base.grip; out.yaw = base.yaw; out.pitch = base.pitch; out.crouch = base.crouch;
      const baseWeight = base.weight ?? 0;
      // Over a weaker base pose (the mocap's arms), the overlays fade in from what the base would show.
      mix(meetPose, weights.meet);
      mix(bindPose, weights.bind);
      mix(brokenPose, weights.broken);
      // Tired: the guard sags, the blade wavers, the shoulders heave with the breath.
      if (fatigue > 0) {
        const breath = Math.sin(time * Math.PI * 2 * (0.45 + 0.55 * fatigue));
        out.hand.y -= 0.07 * fatigue;
        out.blade.lerp(target.set(out.blade.x * 0.6, out.blade.y * 0.6, Math.max(0.3, out.blade.z)), 0.25 * fatigue).normalize();
        out.blade.x += Math.sin(time * 2.7) * 0.06 * fatigue;
        out.left.y += breath * 0.02 * fatigue;
        out.pitch += 0.06 * fatigue + breath * 0.035 * fatigue;
        out.crouch += 0.12 * fatigue + breath * 0.05 * fatigue;
      }
      // The springs on top: the jolts of blades meeting.
      out.hand.add(hand.x);
      const angle = turn.x.length();
      if (angle > 1e-4) out.blade.applyAxisAngle(axis.copy(turn.x).divideScalar(angle), Math.min(angle, 1.4));
      out.blade.normalize();
      out.pitch += lean.x;
      out.crouch += sink.x;
      const weight = Math.max(baseWeight, weights.meet, weights.bind, weights.broken, Math.min(1, hand.x.length() * 6 + angle * 2));
      return { ...base, ...out, hand: out.hand, blade: out.blade, left: out.left, weight };
    },
  };
}
