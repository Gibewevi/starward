import * as THREE from 'three';
import { MOCAP_BONES } from './mocap-clips.js';

// Mixamo-compatible humanoid hierarchy. Rest rotations are identity and the
// rest geometry is a +Z facing T-pose, the convention of src/mocap-clips.js,
// so captured local rotations apply directly to these stylised proportions.
// Offsets are metres relative to the parent joint.
export const RIG_LAYOUT = [
  ['Hips', null, [0, 0.765, 0]],
  ['Spine', 'Hips', [0, 0.075, 0.002]],
  ['Spine1', 'Spine', [0, 0.075, -0.004]],
  ['Spine2', 'Spine1', [0, 0.07, -0.008]],
  ['Neck', 'Spine2', [0, 0.13, -0.016]],
  ['Head', 'Neck', [0, 0.06, 0.012]],
  ['LeftShoulder', 'Spine2', [0.045, 0.085, -0.016]],
  ['LeftArm', 'LeftShoulder', [0.11, -0.012, -0.01]],
  ['LeftForeArm', 'LeftArm', [0.235, 0, 0]],
  ['LeftHand', 'LeftForeArm', [0.205, 0, 0]],
  ['RightShoulder', 'Spine2', [-0.045, 0.085, -0.016]],
  ['RightArm', 'RightShoulder', [-0.11, -0.012, -0.01]],
  ['RightForeArm', 'RightArm', [-0.235, 0, 0]],
  ['RightHand', 'RightForeArm', [-0.205, 0, 0]],
  ['LeftUpLeg', 'Hips', [0.09, -0.06, -0.008]],
  ['LeftLeg', 'LeftUpLeg', [0, -0.305, 0.004]],
  ['LeftFoot', 'LeftLeg', [0, -0.31, -0.022]],
  ['LeftToeBase', 'LeftFoot', [0, -0.065, 0.105]],
  ['RightUpLeg', 'Hips', [-0.09, -0.06, -0.008]],
  ['RightLeg', 'RightUpLeg', [0, -0.305, 0.004]],
  ['RightFoot', 'RightLeg', [0, -0.31, -0.022]],
  ['RightToeBase', 'RightFoot', [0, -0.065, 0.105]],
];

// The body is sculpted and bound with relaxed, lowered arms: the shoulders
// then deform least in the poses the character actually spends time in.
export const BIND_ARM_DROP = 1.0;

export const LEG_LENGTH = 0.305 + 0.31;
export const ANKLE_HEIGHT = 0.09;

export function createRig() {
  const root = new THREE.Group();
  const bones = {};
  for (const [name, parent, offset] of RIG_LAYOUT) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(offset);
    (parent ? bones[parent] : root).add(bone);
    bones[name] = bone;
  }
  const list = MOCAP_BONES.map(name => bones[name]);
  const restPositions = list.map(bone => bone.position.clone());
  function restPose() {
    list.forEach((bone, index) => { bone.position.copy(restPositions[index]); bone.quaternion.identity(); });
  }
  function bindPose() {
    restPose();
    bones.LeftArm.rotation.set(0, 0, -BIND_ARM_DROP);
    bones.RightArm.rotation.set(0, 0, BIND_ARM_DROP);
    root.updateMatrixWorld(true);
  }
  return { root, bones, list, restPositions, restPose, bindPose };
}
