import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createNav } from '../src/nav.js';
import { createReinforcements } from '../src/reinforcements.js';
import { createStormtrooper } from '../src/stormtrooper.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

test('the great door slides open onto the corridor and shuts again; shut, it is a wall', () => {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab });
  const door = arena.door;
  const inside = door.centre.clone().addScaledVector(door.out, -1.5), outside = door.centre.clone().addScaledVector(door.out, 1.5);
  assert.ok(lab.segmentHit(inside.clone().setY(1), outside.clone().setY(1)), 'shut: nothing gets through');
  door.open();
  let time = 0;
  for (let i = 0; i < 120; i++) arena.update(time += 1 / 60);
  assert.ok(door.isOpen, 'open within two seconds');
  assert.equal(lab.segmentHit(inside.clone().setY(1), outside.clone().setY(1)), null, 'open: a way through');
  const [left, right] = door.leaves;
  assert.ok(Math.abs(left.position.x - left.userData.open) < 1e-6 && Math.abs(right.position.x - right.userData.open) < 1e-6, 'both leaves in the wall');
  door.close();
  for (let i = 0; i < 120; i++) arena.update(time += 1 / 60);
  assert.ok(door.isClosed && lab.segmentHit(inside.clone().setY(1), outside.clone().setY(1)), 'shut again');
});

test('reinforcements: the alarm, the door, three or four men out one by one, the door shut — again and again, sooner when few are left', () => {
  const door = { openness: 0, target: 0, alarm: false, open() { this.target = 1; }, close() { this.target = 0; }, get isOpen() { return this.openness >= 1; }, get isClosed() { return this.openness <= 0; } };
  const waves = createReinforcements({ door, random: seeded(3) });
  const step = dt => { door.openness = THREE.MathUtils.clamp(door.openness + Math.sign(door.target - door.openness) * dt / 1.3, 0, 1); };
  let time = 0, living = 5;
  const log = [];
  for (let i = 0; i < 60 * 90; i++) {
    time += 1 / 60;
    step(1 / 60);
    for (const event of waves.update(1 / 60, { living, entering: 0 })) {
      log.push({ time, event: event.type ?? event });
      if (event.type === 'spawn') living++;
    }
    if (living > 7) living = 3; // the hero cuts them down
  }
  const alarms = log.filter(entry => entry.event === 'alarm');
  assert.ok(alarms.length >= 2, `regularly (${alarms.length} waves in 90 s)`);
  assert.ok(Math.abs(alarms[0].time - FEEL.reinforce.first) < 0.1, 'the first after a while');
  // Each wave: alarm → open → 3 or 4 spawns → close, in that order.
  const first = log.slice(0, log.findIndex(entry => entry.event === 'close') + 1).map(entry => entry.event);
  assert.equal(first[0], 'alarm');
  assert.equal(first[1], 'open');
  const spawns = first.filter(event => event === 'spawn').length;
  assert.ok(spawns >= 2 && spawns <= 4, `${spawns} men (never past the head count)`);
  assert.equal(first.at(-1), 'close');
});

test('a newcomer marches through the door into the room and joins the fight', () => {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab }), nav = createNav(lab, ARENA);
  const door = arena.door;
  const first = createStormtrooper({ scene, position: new THREE.Vector3(-1, 0, -5), heading: 0, random: seeded(4), lab });
  const troopers = [first];
  const squad = createSquadMind({ troopers, lab, nav, random: seeded(5) });
  squad.minds[0].awareness = 1;
  const hero = new THREE.Vector3(0.5, 0, 0.6);
  door.open();
  let time = 0;
  for (let i = 0; i < 120; i++) { time += 1 / 60; arena.update(time); squad.update(1 / 60, { hero }); first.update(1 / 60, time); }
  const heading = Math.atan2(door.out.x, door.out.z);
  const newcomer = createStormtrooper({ scene, position: door.inside[0], heading, random: seeded(6), lab });
  const threshold = door.centre.clone().addScaledVector(door.out, 0.7), post = nav.nearest(door.centre.clone().addScaledVector(door.out, 2.5));
  const mind = squad.add(newcomer, { position: post, heading }, { entering: [threshold, ...nav.path(threshold, post)] });
  assert.equal(troopers.length, 2);
  for (let i = 0; i < 60 * 6 && mind.entering; i++) { time += 1 / 60; arena.update(time); squad.update(1 / 60, { hero }); for (const trooper of troopers) trooper.update(1 / 60, time); }
  assert.equal(mind.entering, null, 'in');
  assert.ok(newcomer.root.position.clone().sub(door.centre).dot(door.out) > 1.5, 'well inside the room');
  assert.equal(mind.mode, 'combat', 'straight into the fight');
  squad.remove(newcomer);
  assert.equal(troopers.length, 1);
  assert.ok(!squad.minds.includes(mind));
});
