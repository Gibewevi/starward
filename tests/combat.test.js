import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CombatController, MOVES, GUARD_SPEED, sampleMove } from '../src/combat.js';
import { createCharacter } from '../src/character.js';
import { createBladeTrail } from '../src/blade-trail.js';
import { createSaber, IGNITE_TIME } from '../src/saber.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function run(combat, seconds, { press = () => false, guard = false, speed = 0, hold = false } = {}) {
  const started = [];
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    if (press(frame)) combat.attack({ speed });
    combat.update(1 / 60, { guard, speed, hold });
    const name = combat.takeStart();
    if (name) started.push(name);
  }
  return started;
}
const strikes = Object.keys(MOVES).filter(name => !MOVES[name].free && !MOVES[name].utility);

test('every move is well formed and every strike can follow another', () => {
  for (const [name, move] of Object.entries(MOVES)) {
    assert.ok(move.keys.length >= 3 && move.keys[0].t === 0 && move.keys.at(-1).t === 1, `${name} keys span the move`);
    for (let i = 1; i < move.keys.length; i++) assert.ok(move.keys[i].t > move.keys[i - 1].t, `${name} keys are ordered`);
    for (const twirl of move.twirls ?? []) assert.ok(Number.isInteger(twirl[2]), `${name} twirls end where they began`);
    if (move.spin) assert.ok(Number.isInteger(move.spin[2]), `${name} spins whole turns, so the facing is kept`);
  }
  // From each side a blade can end on, some link and some finisher can start.
  for (const side of new Set(strikes.map(name => MOVES[name].to))) {
    for (const role of ['link', 'finisher']) {
      assert.ok(strikes.some(name => MOVES[name].role.includes(role) && MOVES[name].from.includes(side)), `${role} from ${side}`);
    }
  }
});

test('combos are varied: random flowing chains, no immediate repeats, a finisher at the end', () => {
  const combat = new CombatController({ random: seeded(11) });
  const sequence = run(combat, 40, { press: frame => frame % 9 === 0 });
  assert.ok(sequence.length > 50);
  assert.ok(new Set(sequence).size >= 12, `distinct strikes: ${new Set(sequence).size}`);
  for (let i = 1; i < sequence.length; i++) assert.notEqual(sequence[i], sequence[i - 1], 'never the same strike twice in a row');
  // Split into combos at the finishers: lengths vary between three and six.
  const lengths = [];
  let count = 0;
  for (const name of sequence) {
    count++;
    if (MOVES[name].role.includes('finisher')) { lengths.push(count); count = 0; }
  }
  assert.ok(lengths.length >= 6 && lengths.every(length => length >= 2 && length <= 6), `combo lengths ${lengths}`);
  assert.ok(new Set(lengths).size >= 2, 'combo lengths change');
  // Consecutive strikes inside a combo start where the previous one ended.
  for (let i = 1; i < sequence.length; i++) {
    const previous = MOVES[sequence[i - 1]], next = MOVES[sequence[i]];
    if (previous.role.includes('finisher') || next.role.includes('opener') && !next.role.includes('link')) continue;
    if (next.role.includes('link') || next.role.includes('finisher')) assert.ok(next.from.includes(previous.to), `${sequence[i - 1]} → ${sequence[i]}`);
  }
});

test('a single press plays one strike and hands the arms back to locomotion', () => {
  const combat = new CombatController({ random: seeded(5) });
  combat.attack();
  const first = combat.takeStart();
  run(combat, MOVES[first].duration * 0.5);
  assert.ok(combat.busy && combat.output.weight === 1);
  assert.deepEqual(run(combat, 1.4), []);
  assert.ok(!combat.busy && combat.output.weight === 0, 'the strike ends and its pose fades out');
});

test('running opens with a dashing move that carries the hero forward', () => {
  for (const seed of [1, 2, 3, 4]) {
    const combat = new CombatController({ random: seeded(seed) });
    combat.attack({ speed: 4 });
    const name = combat.takeStart();
    assert.ok(MOVES[name].role.includes('run'), name);
    let travelled = 0;
    for (let frame = 0; frame < 30; frame++) travelled += combat.update(1 / 60).drive / 60;
    assert.ok(travelled > 0.8, `${name} distance ${travelled}`);
  }
});

test('moulinets spin the blade full circles and the wrist circles with it', () => {
  const pose = { hand: new THREE.Vector3(), blade: new THREE.Vector3(), left: new THREE.Vector3(), grip: 0, yaw: 0, pitch: 0, crouch: 0 };
  for (const name of ['twirlThrust', 'helicopter', 'lunge', 'draw']) {
    const move = MOVES[name];
    const [from, to] = move.twirls[0];
    let turned = 0, previous = null;
    const hands = [];
    for (let i = 0; i <= 200; i++) {
      const t = from + (to - from) * i / 200;
      sampleMove(move, t, pose);
      if (previous) turned += previous.angleTo(pose.blade);
      previous = pose.blade.clone();
      if (i > 60 && i < 140) hands.push(pose.hand.clone());
    }
    // In the middle of the twirl the hand only circles with the wrist.
    const centre = hands.reduce((sum, hand) => sum.add(hand), new THREE.Vector3()).divideScalar(hands.length);
    const wrist = Math.max(...hands.map(hand => hand.distanceTo(centre)));
    assert.ok(turned > Math.PI * 2 * 0.8 * Math.abs(move.twirls[0][2]) * 0.5, `${name} turns the blade (${turned.toFixed(1)} rad)`);
    assert.ok(wrist > 0.01 && wrist < 0.06, `${name} wrist circle ${wrist}`);
  }
});

test('spins turn whole circles; finishers leap, land and shake the view', () => {
  const combat = new CombatController({ random: seeded(9) });
  combat.start('spin');
  let spin = 0;
  for (let frame = 0; frame < 60 && combat.busy; frame++) spin = Math.max(spin, combat.update(1 / 60).spin);
  assert.ok(Math.abs(spin - Math.PI * 2) < 1e-6, 'one full turn');
  for (const name of ['slam', 'spinSlam', 'risingLeap']) {
    combat.reset();
    combat.start(name);
    let lift = 0, shake = 0;
    while (combat.busy) {
      const out = combat.update(1 / 60);
      lift = Math.max(lift, out.lift); shake = Math.max(shake, out.shake);
    }
    assert.ok(lift > 0.15 && shake > 0.4, `${name} leaps and lands`);
    assert.equal(combat.output.lift, 0);
  }
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

test('the draw twirl keeps the legs free and gives way to a strike', () => {
  const combat = new CombatController({ random: seeded(4) });
  assert.ok(combat.flourish());
  combat.update(1 / 60);
  assert.equal(combat.takeStart(), 'draw');
  const out = combat.update(1 / 60);
  assert.ok(!combat.busy && out.inputScale === 1 && out.turnScale === 1 && out.drive === 0 && out.engaged);
  combat.attack();
  assert.ok(combat.busy && combat.takeStart() !== 'draw', 'an attack interrupts the flourish');
  assert.equal(combat.flourish(), false, 'no flourish over a strike');
});

test('the blade shoots out of the emitter, overshoots slightly and settles', () => {
  const scene = new THREE.Scene();
  const socket = new THREE.Object3D();
  scene.add(socket);
  const saber = createSaber({ socket, scene });
  assert.equal(saber.update(1, 0), null);
  assert.equal(saber.update(0, 0.1), 'retract');
  for (let time = 0.1; time < 0.6; time += 1 / 60) saber.update(0, time);
  assert.equal(saber.blade.visible, false, 'retracted into the hilt');
  assert.equal(saber.update(1, 0.62), 'ignite');
  let peak = 0;
  for (let time = 0.62; time < 0.62 + IGNITE_TIME * 1.5; time += 1 / 60) {
    saber.update(1, time);
    peak = Math.max(peak, saber.blade.scale.y);
  }
  assert.ok(peak > 1.02 && peak < 1.1, `overshoot ${peak}`);
  assert.ok(Math.abs(saber.blade.scale.y - 1) < 1e-6);
  // The beam is widest at the emitter and tapers to the tip.
  const core = saber.blade.children[0].geometry.parameters;
  assert.ok(core.radiusBottom > core.radiusTop * 1.5);
});

test('the rig follows the choreography: the sword hand and blade hit their marks', () => {
  const character = createCharacter();
  const combat = new CombatController({ random: seeded(21) });
  character.root.position.set(2, 0, -1);
  const hand = new THREE.Vector3(), target = new THREE.Vector3(), shoulder = new THREE.Vector3();
  const blade = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  combat.attack();
  let checked = 0;
  for (let frame = 0; frame < 400; frame++) {
    if (frame % 9 === 4) combat.attack();
    const action = combat.update(1 / 60, { guard: frame > 370 });
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
  assert.ok(checked > 100);
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
  const positions = trail.mesh.geometry.attributes.position;
  for (let i = 0; i < trail.samples; i++) assert.ok(Math.abs(Math.hypot(positions.getX(i * 2 + 1), positions.getZ(i * 2 + 1)) - 1) < 1e-3);
  for (let frame = 0; frame < 20; frame++) trail.update(1 / 60, base, tip, 0);
  assert.equal(trail.samples, 0);
  assert.equal(trail.mesh.visible, false);
});

test('moulinets are rolled at shoulder height in a near-vertical circle', () => {
  const pose = { hand: new THREE.Vector3(), blade: new THREE.Vector3(), left: new THREE.Vector3(), grip: 0, yaw: 0, pitch: 0, crouch: 0 };
  for (const name of ['draw', 'twirlThrust', 'lunge']) {
    const [from, to, , axis] = MOVES[name].twirls[0];
    const normal = new THREE.Vector3(...axis).normalize();
    assert.ok(Math.abs(normal.y) < 0.2, `${name}: the circle's plane is within about 10° of vertical`);
    for (let i = 0; i <= 50; i++) {
      sampleMove(MOVES[name], from + (to - from) * (0.2 + 0.6 * i / 50), pose);
      assert.ok(pose.hand.y > 1.05 && pose.hand.y < 1.2, `${name}: hand at shoulder height (${pose.hand.y.toFixed(2)})`);
      assert.ok(pose.hand.x < -0.15, `${name}: on the sword side`);
      assert.ok(Math.abs(pose.blade.dot(normal)) < 0.02, `${name}: the blade stays in the circle`);
    }
  }
});

test('a Force power cuts a strike short, fires mid-gesture, and B picks the combo up afterwards', () => {
  const combat = new CombatController({ random: seeded(17) });
  combat.attack();
  combat.takeStart();
  run(combat, 0.15);
  assert.ok(combat.busy);
  assert.ok(combat.power('forcePush'));
  assert.equal(combat.takeStart(), 'forcePush');
  let fired = null, at = 0;
  for (let frame = 0; frame < 60 && !fired; frame++) { combat.update(1 / 60); at += 1 / 60; fired = combat.takeForce(); }
  assert.equal(fired, 'forcePush');
  assert.ok(Math.abs(at / MOVES.forcePush.duration - 0.42) < 0.06, `released at the thrust (${(at / MOVES.forcePush.duration).toFixed(2)})`);
  assert.ok(combat.output.inputScale > 0.3, 'the hero can still move a little');
  run(combat, 0.5);
  combat.attack();
  const next = combat.takeStart();
  assert.ok(MOVES[next].role.includes('link') || MOVES[next].role.includes('finisher'), `the combo goes on with ${next}`);
  assert.ok(combat.power('forcePull') && combat.takeStart() === 'forcePull', 'and a pull can cut that one short too');
});

test('RB parries out of a strike, high, left or right, then holds the guard', () => {
  const combat = new CombatController({ random: seeded(19) });
  const parries = new Set();
  for (let i = 0; i < 6; i++) {
    combat.attack();
    run(combat, 0.1);
    assert.ok(combat.parry());
    const name = combat.takeStart();
    assert.ok(name.startsWith('parry'), name);
    parries.add(name);
    run(combat, 0.6, { guard: i % 2 === 0 });
  }
  assert.ok(parries.size >= 2, 'the parries vary');
  combat.parry();
  run(combat, 0.6, { guard: true });
  assert.ok(combat.guarding, 'held, it becomes the guard');
});

test('strikes are quicker and cover every direction', () => {
  for (const name of ['overhead', 'reverseDiagonal']) assert.ok(MOVES[name], name);
  const combat = new CombatController({ random: seeded(23) });
  combat.attack();
  const first = combat.takeStart();
  assert.ok(combat.action.duration < MOVES[first].duration, 'played faster than written');
});

test('holding a trooper up with the Force keeps the free hand out, even through strikes', () => {
  const combat = new CombatController({ random: seeded(29) });
  run(combat, 0.4, { hold: true });
  assert.equal(combat.output.name, 'forceHold');
  assert.ok(combat.output.weight > 0.95 && combat.output.left.z > 0.4 && combat.output.grip < 0.05, 'the free hand reaches out');
  combat.attack();
  for (let frame = 0; frame < 20; frame++) {
    const out = combat.update(1 / 60, { hold: true });
    assert.ok(out.left.z > 0.4, 'still out mid-strike');
  }
  run(combat, 1.5);
  assert.ok(combat.output.weight < 0.05, 'let go, the arms return to the captured motion');
});
