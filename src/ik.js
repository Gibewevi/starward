import * as THREE from 'three';

/**
 * Two-bone IK in world space, independent of the bones' own axes: the upper
 * bone is turned so the middle joint lands where the triangle puts it (bent
 * towards the pole), then the lower bone is turned to reach the target.
 */
const s = new THREE.Vector3(), e = new THREE.Vector3(), h = new THREE.Vector3();
const dir = new THREE.Vector3(), bend = new THREE.Vector3(), elbow = new THREE.Vector3(), reach = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3();
const world = new THREE.Quaternion(), parent = new THREE.Quaternion(), delta = new THREE.Quaternion();

/** Rotates bone so that the direction from → current becomes from → desired. */
export function aimBone(bone, from, current, desired) {
  a.subVectors(current, from).normalize();
  b.subVectors(desired, from).normalize();
  delta.setFromUnitVectors(a, b);
  bone.getWorldQuaternion(world).premultiply(delta);
  bone.parent.getWorldQuaternion(parent);
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

export function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(s); lower.getWorldPosition(e); end.getWorldPosition(h);
  const lengthA = s.distanceTo(e), lengthB = e.distanceTo(h);
  dir.subVectors(target, s);
  const distance = THREE.MathUtils.clamp(dir.length(), Math.abs(lengthA - lengthB) + 1e-3, lengthA + lengthB - 1e-3);
  dir.normalize();
  const cosine = THREE.MathUtils.clamp((lengthA * lengthA + distance * distance - lengthB * lengthB) / (2 * lengthA * distance), -1, 1);
  bend.subVectors(pole, s);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  elbow.copy(s).addScaledVector(dir, lengthA * cosine).addScaledVector(bend, lengthA * Math.sqrt(1 - cosine * cosine));
  reach.copy(s).addScaledVector(dir, distance);
  aimBone(upper, s, e, elbow);
  lower.getWorldPosition(e); end.getWorldPosition(h);
  aimBone(lower, e, h, reach);
}
