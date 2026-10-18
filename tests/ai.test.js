import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper, collideSquad, PACE } from '../src/stormtrooper.js';
import { createLab } from '../src/lab.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { createAlerts } from '../src/alerts.js';
import { createBlasters } from '../src/blasters.js';
import { returnDirection } from '../src/deflect.js';
import { createGait, GAIT_JOINTS } from '../src/trooper-gait.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
// An empty floor: nothing in the way, nowhere to hide.
const open = { obstacles: [], clear: () => true, segmentHit: () => null, coverSpots: () => [], pushOut: point => point };
function solo({ position = new THREE.Vector3(), heading = 0, seed = 7, lab = null } = {}) {
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position, heading, random: seeded(seed), lab });
  const clock = { time: 0 };
  const run = (seconds, each = null) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      clock.time += 1 / 60;
      each?.(frame);
      trooper.update(1 / 60, clock.time);
    }
  };
  return { trooper, run, clock };
}
const ankle = (trooper, side) => trooper.root.worldToLocal(trooper.joints[`ankle${side}`].getWorldPosition(new THREE.Vector3()));

test('the lab: crates stop walkers and bolts, and hide a crouching man from a threat', () => {
  const lab = createLab(new THREE.Scene());
  const box = lab.obstacles[0];
  const walker = box.centre.clone().setY(0);
  lab.pushOut(walker, 0.3);
  const outside = walker.x <= box.min.x - 0.29 || walker.x >= box.max.x + 0.29 || walker.z <= box.min.z - 0.29 || walker.z >= box.max.z + 0.29;
  assert.ok(outside, 'a walker inside a crate is put out of it');
  const half = (box.max.x - box.min.x) / 2 + 0.4;
  const hit = lab.segmentHit(box.centre.clone().add(new THREE.Vector3(-half, 0, 0)), box.centre.clone().add(new THREE.Vector3(half, 0, 0)));
  assert.equal(hit.box, box, 'a bolt meets the crate');
  assert.deepEqual(hit.normal.toArray(), [-1, 0, 0], 'on the face it hit');
  const threat = new THREE.Vector3(0, 0, 0);
  const spots = lab.coverSpots(threat);
  assert.ok(spots.length >= 8, `cover all around (${spots.length} spots)`);
  for (const spot of spots) {
    assert.ok(lab.segmentHit(threat.clone().setY(1.2), spot.position.clone().setY(0.72)), 'every spot is hidden from the threat');
    assert.ok(spot.position.distanceTo(threat) >= 3, 'and not on top of it');
  }
});

test('captured steps on his skeleton: unit rotations, a phase that follows his speed, walking backwards reversed', () => {
  const gait = createGait({ offset: 0.2 });
  gait.update(1 / 60, { speed: 0 });
  for (const name of GAIT_JOINTS) assert.ok(Math.abs(gait.rotations[name].length() - 1) < 1e-4, name);
  const phase = () => gait.state.phase;
  const tenth = options => { for (let i = 0; i < 6; i++) gait.update(1 / 60, options); };
  for (let i = 0; i < 60; i++) gait.update(1 / 60, { speed: PACE.walk });
  let before = phase();
  tenth({ speed: PACE.walk });
  const walking = (phase() - before + 1) % 1;
  for (let i = 0; i < 90; i++) gait.update(1 / 60, { speed: PACE.run });
  before = phase();
  tenth({ speed: PACE.run });
  const running = (phase() - before + 1) % 1;
  assert.ok(walking > 0.05 && running > walking, `steps come faster at a run (${walking.toFixed(3)} / ${running.toFixed(3)} of a cycle in 0.1 s)`);
  // The cycle covers as much ground as he does: the planted foot does not skate.
  assert.ok(Math.abs(PACE.walk * 0.1 / gait.cycle.walk - walking) < 0.03, 'phase rate matches the ground covered');
  before = phase();
  tenth({ speed: PACE.walk, backward: true });
  assert.ok((before - phase() + 1) % 1 < 0.5, 'backing away plays the steps in reverse');
});

test('ordered to walk, he gets going with inertia, strides on captured steps, turns to his way and slows to a stop', () => {
  const { trooper, run } = solo();
  trooper.order.velocity.set(PACE.walk, 0, 0);
  run(1 / 60);
  assert.ok(trooper.velocity.length() < 0.2, 'no instant start');
  const strides = [], heights = [];
  run(1.5, () => { const l = ankle(trooper, 'L'), r = ankle(trooper, 'R'); strides.push(l.z - r.z); heights.push(Math.min(l.y, r.y)); });
  assert.ok(Math.abs(trooper.velocity.length() - PACE.walk) < 0.1, `up to pace (${trooper.velocity.length().toFixed(2)} m/s)`);
  assert.ok(Math.abs(wrap(trooper.heading - Math.PI / 2)) < 0.1, `facing his way (${trooper.heading.toFixed(2)})`);
  const later = strides.slice(30);
  const swaps = later.slice(1).filter((value, i) => Math.sign(value) !== Math.sign(later[i])).length;
  assert.ok(Math.max(...later) - Math.min(...later) > 0.35 && swaps >= 2, `the feet pass each other (${swaps} times)`);
  assert.ok(Math.min(...heights) < 0.14, 'a foot is down on the floor');
  trooper.order.velocity.set(0, 0, 0);
  run(0.05);
  assert.ok(trooper.velocity.length() > 0.5, 'he does not stop dead');
  run(1);
  assert.ok(trooper.velocity.length() < 0.02, 'but he stops');
  assert.ok(trooper.ragdoll.particles.every(particle => Number.isFinite(particle.position.x + particle.position.y + particle.position.z)));
});

test('ordered to aim he shoulders the rifle on the target and fires along the barrel; crouched, he is lower', () => {
  const { trooper, run } = solo();
  const target = new THREE.Vector3(1, 1.05, 6);
  assert.equal(trooper.fire(), null, 'not before he aims');
  trooper.order.aim = true;
  trooper.order.aimAt = target;
  run(0.5);
  const shot = trooper.fire();
  assert.ok(shot, 'aimed, he can fire');
  const toward = target.clone().sub(shot.from).normalize();
  assert.ok(shot.direction.angleTo(toward) < 0.12, `along the barrel, at the target (${shot.direction.angleTo(toward).toFixed(3)} rad off)`);
  assert.ok(shot.from.y > 1.08, `from the shoulder (${shot.from.y.toFixed(2)} m)`);
  assert.ok(trooper.news.some(item => item.type === 'shot'));
  run(1 / 60);
  assert.ok(trooper.reaction.recoil > 0.005, 'the rifle kicks');
  const standing = trooper.particle('HT').position.y;
  trooper.order.aim = false;
  trooper.order.crouch = true;
  run(0.7);
  assert.ok(trooper.particle('HT').position.y < standing - 0.35, `crouched behind cover (${trooper.particle('HT').position.y.toFixed(2)} m)`);
  assert.ok(!trooper.fallen, 'on his feet');
});

test('a bolt sent back: in the chest it kills, in the arm it staggers him and knocks the rifle away', () => {
  const chest = solo({ seed: 11 });
  chest.run(0.3);
  // High on the chest, above the rifle and the hands holding it.
  const point = chest.trooper.particle('W').position.clone().lerp(chest.trooper.particle('N').position, 0.78);
  const hit = chest.trooper.boltHit(point.clone().add(new THREE.Vector3(0, 0, 0.8)), point.clone().add(new THREE.Vector3(0, 0, -0.2)));
  assert.equal(hit?.body.name, 'torso');
  const event = chest.trooper.shot(hit, new THREE.Vector3(0, 0, -15));
  assert.ok(event.lethal && chest.trooper.dead, 'dead');
  chest.run(1.5);
  assert.ok(chest.trooper.fallen && chest.trooper.particle('W').position.z < -0.1, 'thrown back along the bolt');
  const arm = solo({ seed: 13 });
  arm.run(0.3);
  const elbow = arm.trooper.particle('EL').position.clone();
  const side = arm.trooper.boltHit(elbow.clone().add(new THREE.Vector3(0.8, 0, 0)), elbow.clone().add(new THREE.Vector3(-0.05, 0, 0)));
  assert.ok(/^(upperArm|forearm|hand)L$/.test(side?.body.name), side?.body.name);
  arm.trooper.shot(side, new THREE.Vector3(-15, 0, 0));
  arm.run(0.5);
  assert.ok(!arm.trooper.dead && !arm.trooper.holding, 'alive, disarmed');
});

test('he sees the hero in front of him, not behind his back; a sprint behind him makes him wonder and turn', () => {
  const look = (heroAt, seconds = 1.6, noisy = null) => {
    const { trooper, run } = solo({ heading: 0 });
    const alerts = createAlerts(new THREE.Scene());
    const squad = createSquadMind({ troopers: [trooper], lab: open, alerts, random: seeded(3) });
    const cues = [];
    let clock = 0;
    run(seconds, () => {
      clock += 1 / 60;
      const noises = noisy && Math.round(clock * 60) % 18 === 0 ? [{ position: noisy.clone(), radius: 7, from: noisy.clone() }] : [];
      cues.push(...squad.update(1 / 60, { hero: heroAt, noises }).cues);
      alerts.update(1 / 60, () => trooper.particle('HT').position);
    });
    return { trooper, squad, alerts, cues };
  };
  const seen = look(new THREE.Vector3(0.5, 0, 5));
  assert.equal(seen.squad.minds[0].mode, 'combat', 'spotted');
  assert.ok(seen.cues.some(cue => cue.type === 'suspicious') && seen.cues.some(cue => cue.type === 'alert'), 'a "?" first, then a "!"');
  const behind = look(new THREE.Vector3(0, 0, -6));
  assert.equal(behind.squad.minds[0].mode, 'calm', 'not seen behind his back');
  // Footsteps behind him, the hero himself out of sight far off.
  const heard = look(new THREE.Vector3(0, 0, -40), 2.2, new THREE.Vector3(0, 0, -4));
  assert.equal(heard.squad.minds[0].mode, 'suspicious');
  assert.equal(heard.alerts.kindOf(heard.trooper), '?');
  assert.ok(Math.abs(wrap(heard.trooper.heading - Math.PI)) < 0.6, `he turns towards the noise (${heard.trooper.heading.toFixed(2)})`);
});

test('in a fight the squad calls it out, takes cover behind crates, and fires in bursts — a couple at a time', () => {
  const lab = createLab(new THREE.Scene());
  const at = (x, z) => new THREE.Vector3(x, 0, z);
  const spots = [at(-5.3, -2.6), at(-3.3, -4.8), at(-0.9, -5.9)];
  const troopers = spots.map((position, index) => createStormtrooper({ scene: new THREE.Scene(), position, heading: 0.7, random: seeded(20 + index), lab }));
  const squad = createSquadMind({ troopers, lab, random: seeded(5) });
  const hero = new THREE.Vector3(0.5, 0, 0.6);
  let time = 0, shots = 0, together = 0, hidden = 0;
  squad.minds[0].awareness = 1;
  for (let frame = 0; frame < 60 * 9; frame++) {
    time += 1 / 60;
    const thought = squad.update(1 / 60, { hero });
    shots += thought.shots.length;
    for (const shot of thought.shots) assert.ok(shot.direction.angleTo(hero.clone().setY(1.05).sub(shot.from)) < 0.35, 'shots go at the hero (or just past him)');
    together = Math.max(together, squad.minds.filter(mind => mind.token).length);
    for (const trooper of troopers) trooper.update(1 / 60, time);
    collideSquad(troopers);
    hidden = Math.max(hidden, squad.minds.filter(mind => mind.tactic === 'hide' && mind.trooper.reaction.crouch > 0.8 && lab.segmentHit(hero.clone().setY(1.45), mind.trooper.root.position.clone().setY(1.0))).length);
  }
  assert.ok(squad.minds.every(mind => mind.mode === 'combat'), 'the call went round');
  assert.ok(hidden >= 2, `crouched behind crates, out of his sight (${hidden})`);
  assert.ok(shots >= 4, `bursts fired (${shots} shots)`);
  assert.ok(together <= FEEL.blaster.firing, `never more than ${FEEL.blaster.firing} shooting at once`);
  assert.ok(troopers.every(trooper => !trooper.dead), 'nobody hurt himself');
});

test('a bolt the blade sends back is never aimed by chance, and nearly always aimed with full precision', () => {
  const at = new THREE.Vector3(0, 1.1, 0), incoming = new THREE.Vector3(0, 0, -1);
  const enemies = [{ point: new THREE.Vector3(0.4, 1.1, 8), shooter: true }, { point: new THREE.Vector3(-5, 1.1, 5) }];
  const random = seeded(9);
  for (let i = 0; i < 200; i++) {
    const { aim, target } = returnDirection({ at, incoming, precision: 0, enemies, random });
    assert.equal(target, null);
    const angle = new THREE.Vector3(aim.x, 0, aim.z).angleTo(new THREE.Vector3(0, 0, 1));
    assert.ok(angle > FEEL.deflect.yaw[0] - 0.01 && angle < FEEL.deflect.yaw[1] + 0.01, 'thrown off to one side, back out');
  }
  let aimed = 0;
  for (let i = 0; i < 200; i++) {
    const { aim, target } = returnDirection({ at, incoming, precision: 0.95, enemies, random });
    if (!target) continue;
    aimed++;
    assert.ok(aim.angleTo(target.point.clone().sub(at)) < 0.05, 'straight at him');
    assert.ok(target.shooter, 'the shooter first');
  }
  assert.ok(aimed > 170, `${aimed}/200 sent at an enemy`);
});

test('bolts fly straight, burst on crates, and the blade can send them back', () => {
  const scene = new THREE.Scene(), lab = createLab(scene);
  const blasters = createBlasters(scene, { lab, random: seeded(4) });
  const box = lab.obstacles[0];
  const from = box.centre.clone().add(new THREE.Vector3(-4, 0, 0));
  blasters.fire(from, new THREE.Vector3(1, 0, 0), { speed: 12 });
  const events = [];
  for (let i = 0; i < 60 && !events.length; i++) events.push(...blasters.update(1 / 60));
  assert.equal(events[0]?.type, 'impact');
  assert.ok(Math.abs(events[0].point.x - box.min.x) < 0.01, 'on the crate\'s face');
  assert.equal(blasters.live.length, 0);
  const bolt = blasters.fire(new THREE.Vector3(0, 1, 30), new THREE.Vector3(0, 0, 1), { speed: 12 });
  let first = true;
  const answer = () => { if (!first) return null; first = false; blasters.deflect(bolt, new THREE.Vector3(0, 1, 30), new THREE.Vector3(0, 0.1, -1), 15); return 'deflected'; };
  blasters.update(1 / 60, answer);
  assert.ok(bolt.deflected && bolt.velocity.z < -14, 'sent back, faster');
  blasters.update(1 / 60);
  assert.ok(bolt.position.z < 30, 'and away it goes');
});

test('a "!" pops: it bursts in oversized, overshoots and settles; it leaves by shrinking away', () => {
  const alerts = createAlerts(new THREE.Scene());
  const owner = {}, head = () => new THREE.Vector3(0, 1.7, 0);
  alerts.show(owner, '!', { hold: 1.2 });
  const sizes = [];
  for (let i = 0; i < 100; i++) { alerts.update(1 / 60, head); sizes.push(alerts.entries.get(owner).icon.scale.y); }
  const settled = sizes[45];
  assert.ok(Math.max(...sizes.slice(0, 12)) > settled * 1.3, 'bursts in oversized');
  assert.ok(Math.min(...sizes.slice(8, 25)) < settled * 0.97, 'and springs back past its size');
  assert.ok(Math.abs(sizes[40] - settled) < settled * 0.04, 'then settles');
  assert.equal(alerts.kindOf(owner), null, 'gone after its time');
});
