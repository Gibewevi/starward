import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CombatController, COMBO, ATTACKS, GUARD_SPEED } from '../src/combat.js';
import { createCharacter } from '../src/character.js';
import { createBladeTrail } from '../src/blade-trail.js';

function run(combat, seconds, { press = () => false, guard = false, speed = 0 } = {}) {
  const started = [];
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    if (press(frame)) combat.attack({ speed });
    combat.update(1 / 60, { guard });
    const name = combat.takeStart();
    if (name) started.push(name);
  }
  return started;
}

test('repeated presses chain the four strikes, then the combo starts over', () => {
  const combat = new CombatController();
  combat.attack();
  const started = [combat.takeStart(), ...run(combat, 4, { press: frame => frame % 8 === 4 })];
  assert.deepEqual(started.slice(0, 5), [...COMBO, 'slash']);
});

test('a single press plays one strike and hands the arms back to locomotion', () => {
  const combat = new CombatController();
  combat.attack();
  combat.takeStart();
  run(combat, ATTACKS.slash.duration * 0.5);
  assert.ok(combat.busy && combat.output.weight === 1);
  const started = run(combat, 1.2);
  assert.deepEqual(started, []);
  assert.ok(!combat.busy && combat.output.weight === 0, 'the strike ends and its pose fades out');
});

test('a press shortly after a strike continues the combo; a late one restarts it', () => {
  const quick = new CombatController();
  quick.attack(); quick.takeStart();
  run(quick, ATTACKS.slash.duration + 0.1);
  quick.attack();
  assert.equal(quick.takeStart(), 'backhand');
  const late = new CombatController();
  late.attack(); late.takeStart();
  run(late, ATTACKS.slash.duration + 0.6);
  late.attack();
  assert.equal(late.takeStart(), 'slash');
});

test('running opens with a dashing cut that carries the hero forward', () => {
  const combat = new CombatController();
  combat.attack({ speed: 4 });
  assert.equal(combat.takeStart(), 'dash');
  let travelled = 0;
  for (let frame = 0; frame < 30; frame++) travelled += combat.update(1 / 60).drive / 60;
  assert.ok(travelled > 1, `dash distance ${travelled}`);
});

test('the spin turns a full circle and the slam leaps, lands and shakes the view', () => {
  const combat = new CombatController();
  combat.start('spin', 2);
  let spin = 0;
  for (let frame = 0; frame < 40; frame++) spin = Math.max(spin, combat.update(1 / 60).spin);
  assert.ok(Math.abs(spin - Math.PI * 2) < 1e-6, 'one full turn');
  combat.start('slam', 3);
  let lift = 0, shake = 0, trail = 0;
  for (let frame = 0; frame < 60; frame++) {
    const out = combat.update(1 / 60);
    lift = Math.max(lift, out.lift); shake = Math.max(shake, out.shake); trail = Math.max(trail, out.trail);
  }
  assert.ok(lift > 0.15, 'the hero leaves the ground');
  assert.equal(combat.output.lift, 0, 'and lands');
  assert.ok(shake > 0.9 && trail > 0.9);
});

test('holding guard raises a two-handed guard that caps the pace and blocks attacks', () => {
  const combat = new CombatController();
  run(combat, 0.5, { guard: true });
  assert.ok(combat.guarding);
  const out = combat.output;
  assert.ok(out.grip > 0.99 && out.blade.y > 0.9, 'blade upright, both hands on the hilt');
  assert.ok(Math.abs(out.maxSpeed - GUARD_SPEED) < 0.05 && out.engaged);
  assert.equal(combat.attack(), false);
  run(combat, 0.6);
  assert.ok(!combat.guarding && combat.output.maxSpeed === Infinity, 'releasing restores full speed');
});

test('the rig follows the choreography: the sword hand and blade hit their marks', () => {
  const character = createCharacter();
  const combat = new CombatController();
  character.root.position.set(2, 0, -1);
  const hand = new THREE.Vector3(), target = new THREE.Vector3(), shoulder = new THREE.Vector3();
  const blade = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  combat.attack();
  let checked = 0;
  for (let frame = 0; frame < 200; frame++) {
    if (frame % 9 === 4) combat.attack();
    const action = combat.update(1 / 60, { guard: frame > 170 });
    character.root.rotation.y = 0.4 + action.spin;
    character.update({ dt: 1 / 60, time: frame / 60, speed: 0, action });
    assert.ok([...character.skeleton.boneMatrices].every(Number.isFinite));
    if (action.weight < 0.999) continue;
    target.copy(action.hand).applyMatrix4(character.root.matrixWorld);
    character.rig.bones.RightArm.getWorldPosition(shoulder);
    character.rig.bones.RightHand.getWorldPosition(hand);
    if (shoulder.distanceTo(target) < 0.42) { assert.ok(hand.distanceTo(target) < 0.01, 'the hand reaches its mark'); checked++; }
    blade.set(0, 1, 0).applyQuaternion(character.saberSocket.getWorldQuaternion(quaternion));
    assert.ok(blade.angleTo(action.blade.clone().applyQuaternion(character.root.quaternion)) < 0.01, 'the blade points as choreographed');
  }
  assert.ok(checked > 60);
});

test('the blade trail sweeps an arc and fades away', () => {
  const scene = new THREE.Scene();
  const trail = createBladeTrail(scene);
  const base = new THREE.Vector3(0, 1, 0), tip = new THREE.Vector3();
  for (let frame = 0; frame < 12; frame++) {
    const angle = frame * 0.3;
    tip.set(Math.sin(angle), 1, Math.cos(angle));
    trail.update(1 / 60, base, tip, 1);
  }
  assert.ok(trail.samples > 30, 'sub-steps fill fast swings');
  assert.ok(trail.mesh.visible && trail.mesh.geometry.attributes.position.array.every(Number.isFinite));
  // Every outer vertex stays on the circle swept by the tip.
  const positions = trail.mesh.geometry.attributes.position;
  for (let i = 0; i < trail.samples; i++) assert.ok(Math.abs(Math.hypot(positions.getX(i * 2 + 1), positions.getZ(i * 2 + 1)) - 1) < 1e-3);
  for (let frame = 0; frame < 20; frame++) trail.update(1 / 60, base, tip, 0);
  assert.equal(trail.samples, 0);
  assert.equal(trail.mesh.visible, false);
});
