import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../src/character.js';
import { createCoat } from '../src/coat.js';
import { createSaber } from '../src/saber.js';
import { createFinisher } from '../src/duel-finisher.js';

function finite(object) {
  let ok = true;
  object.traverse(child => { if (!child.matrixWorld.elements.every(Number.isFinite)) ok = false; });
  return ok;
}

test('each decisive cut separates posed 3D geometry and restores the fighter on retry', () => {
  const scene = new THREE.Scene();
  const character = createCharacter();
  scene.add(character.root);
  const coat = createCoat({ scene, character });
  const saber = createSaber({ socket: character.saberSocket, scene, color: 'red' });
  const fighter = { character, coat, saber, clock: 0 };
  character.update({ dt: 0, time: 0 });
  const bones = character.rig.bones;
  for (const kind of ['head', 'arm', 'torso']) {
    const before = scene.children.length;
    const hipsBefore = bones.Hips.getWorldPosition(new THREE.Vector3());
    const finish = createFinisher(scene, fighter, kind, new THREE.Vector3(9, 0, 0));
    assert.ok(scene.children.length > before, kind);
    const piece = finish.pieces.find(object => object.name === `Jedi severed ${kind}`);
    assert.ok(piece, `${kind}: a piece comes off`);
    const pieceStart = piece.getWorldPosition(new THREE.Vector3());
    const fallenSaber = scene.getObjectByName('Fallen lightsaber');
    assert.ok(fallenSaber, `the saber leaves the hand after the ${kind} cut`);
    const startingPoint = fallenSaber.getWorldPosition(new THREE.Vector3());
    if (kind === 'torso') {
      assert.equal(character.root.visible, false, kind);
      assert.equal(coat.mesh.visible, false, kind);
    } else {
      // The body stays the skinned body, on a limp ragdoll; the severed bone folds away under the stump.
      assert.equal(character.root.visible, true, kind);
      assert.equal(coat.mesh.visible, true, kind);
      assert.ok(bones[kind === 'head' ? 'Head' : 'RightArm'].scale.x < 0.01, `${kind}: the part is gone from the body`);
      assert.ok(finish.corpse?.dead, `${kind}: the body is a dead ragdoll`);
    }
    for (let frame = 0; frame < 90; frame++) finish.update(1 / 30);
    scene.updateMatrixWorld(true);
    assert.ok(finite(scene), `${kind}: no broken transforms`);
    assert.ok(fallenSaber.getWorldPosition(new THREE.Vector3()).distanceTo(startingPoint) > 0.15, `${kind}: saber falls independently`);
    const hiltBounds = new THREE.Box3().makeEmpty();
    for (const mesh of fallenSaber.children[0].children) {
      if (!mesh.isMesh) continue;
      hiltBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    assert.ok(hiltBounds.min.y > -0.06, `${kind}: fallen hilt stays on the floor (${hiltBounds.min.y})`);
    // A head, an arm: thrown along the blade's sweep (+x). The upper body through the waist mostly drops. Both land near him.
    const thrown = piece.getWorldPosition(new THREE.Vector3()).sub(pieceStart);
    assert.ok((kind === 'torso' ? thrown.length() > 0.2 : thrown.x > 0.25) && thrown.length() < 4, `${kind}: thrown with the blade (${thrown.x.toFixed(2)})`);
    if (kind !== 'torso') assert.ok(bones.Hips.getWorldPosition(new THREE.Vector3()).y < hipsBefore.y - 0.4, `${kind}: the body has collapsed`);
    finish.dispose();
    assert.equal(character.root.visible, true, kind);
    assert.equal(coat.mesh.visible, true, kind);
    assert.equal(bones.Head.scale.x, 1, kind);
    assert.equal(bones.RightArm.scale.x, 1, kind);
    assert.equal(scene.children.length, before, kind);
    character.update({ dt: 0, time: 0 });
  }
  coat.dispose();
});
