import * as THREE from 'three';
import { createRig, LEG_LENGTH } from './rig.js';
import { createAvatarSurface } from './avatar-surface.js';
import { createJediHead } from './jedi-head.js';
import { createAnimator } from './animator.js';
import { gradeCharacterMaterial } from './character-shading.js';

/** Skinned Jedi animated from motion capture. Caller owns root placement; +Z is forward.
 * update accepts seconds, m/s, rad/s, forwardAccel in m/s², immediate sprintIntent.
 * saberSocket +Y is the blade axis. Skeleton is updated before update returns. */
export function createCharacter({ palette = null } = {}) {
  const rig = createRig();
  const { root, bones, list } = rig;
  root.name = 'Jedi';
  rig.bindPose();
  const { body } = createAvatarSurface({ bones, list, palette });
  root.add(body);
  bones.Head.add(createJediHead());

  // Leather belt with a metal buckle and pouches, worn on the pelvis.
  const leather = gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0x241914 }));
  const metal = new THREE.MeshStandardMaterial({ color: 0xa8a29c, roughness: 0.42, metalness: 0.7 });
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.048, 28).scale(0.172, 1, 0.128), leather);
  belt.name = 'Belt';
  belt.position.set(0, 0.035, 0.004);
  bones.Hips.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.036, 0.014), metal);
  buckle.name = 'Belt buckle';
  buckle.position.set(0, 0.035, 0.133);
  bones.Hips.add(buckle);
  for (const side of [-1, 1]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.046, 0.032), leather);
    pouch.position.set(side * 0.128, 0.03, 0.095);
    pouch.rotation.y = side * 0.75;
    bones.Hips.add(pouch);
  }
  for (const part of [belt, buckle]) { part.castShadow = true; part.receiveShadow = true; }

  // The hilt sits in the right fist; the animator aims the blade.
  const saberSocket = new THREE.Object3D();
  saberSocket.name = 'Saber socket';
  saberSocket.position.set(-0.05, -0.004, 0.006);
  bones.RightHand.add(saberSocket);

  const animator = createAnimator({ root, bones, list, restPositions: rig.restPositions, legLength: LEG_LENGTH, saberSocket });
  function update(options = {}) {
    animator.update(options);
    body.skeleton.update();
  }
  update({ dt: 0, time: 0 });
  return {
    root, saberSocket, update, body, skeleton: body.skeleton, animator, belt,
    rig: { bones, legLength: LEG_LENGTH, height: 1.62 },
  };
}
