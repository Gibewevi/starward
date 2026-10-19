import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createNav } from '../src/nav.js';
import { createStormtrooper, collideSquad } from '../src/stormtrooper.js';
import { createSquadMind } from '../src/trooper-ai.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function room() {
  const scene = new THREE.Scene(), lab = createLab(scene);
  createArena(scene, { lab });
  return { scene, lab, nav: createNav(lab, ARENA) };
}

test('the navigation grid finds a way round a crate, and never through one', () => {
  const { lab, nav } = room();
  const crate = lab.obstacles.find(box => box.kind === 'crate' && box.min.y === 0);
  const a = new THREE.Vector3(crate.centre.x, 0, crate.min.z - 1.2), b = new THREE.Vector3(crate.centre.x, 0, crate.max.z + 1.2);
  assert.equal(nav.lineFree(a, b), false, 'not straight through');
  const way = nav.path(a, b);
  assert.ok(way && way.length >= 2, 'a way round');
  assert.ok(way.at(-1).distanceTo(b) < 1e-6, 'to the very spot');
  let from = a;
  for (const point of way) { assert.ok(nav.lineFree(from, point), 'every leg walkable'); from = point; }
  // Into a wall: the nearest reachable point.
  const end = nav.path(a, new THREE.Vector3(ARENA.minX - 2, 0, 0)).at(-1);
  assert.ok(end.x > ARENA.minX, 'kept inside the room');
});

test('in the room the squad fights hard: rushes, flanks, kneels, fires blind over crates, chases a hero who hides, never stuck, never through a squadmate', () => {
  const { lab, nav } = room();
  const spots = [[-5.3, -2.6], [-3.3, -4.8], [-0.9, -5.9], [-6, 1.2], [2, -7]];
  const troopers = spots.map(([x, z], index) => createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(x, 0, z), heading: 0.7, random: seeded(30 + index), lab }));
  const squad = createSquadMind({ troopers, lab, nav, random: seeded(11) });
  const hero = new THREE.Vector3(0.5, 0, 0.6);
  squad.minds[0].awareness = 1;
  const roles = new Set(), tactics = new Set();
  let time = 0, shots = 0, blind = 0, kneeling = 0, pursued = false;
  const travelled = troopers.map(() => 0), last = troopers.map(trooper => trooper.root.position.clone());
  for (let frame = 0; frame < 60 * 24; frame++) {
    time += 1 / 60;
    // At 14 s the hero slips away behind the far crates.
    if (frame === 60 * 14) hero.set(5.5, 0, 4.5);
    const thought = squad.update(1 / 60, { hero });
    for (const shot of thought.shots) {
      shots++;
      if (shot.blind) blind++;
      const line = new THREE.Line3(shot.from, shot.from.clone().addScaledVector(shot.direction, 8)), point = new THREE.Vector3();
      for (const other of troopers) {
        if (other === shot.trooper || other.fallen) continue;
        const chest = other.root.position.clone().setY(1.05);
        line.closestPointToPoint(chest, true, point);
        assert.ok(point.distanceTo(chest) > 0.3 || point.distanceTo(shot.from) > chest.distanceTo(hero.clone().setY(1.05)) + 1, 'not through a squadmate');
      }
    }
    for (const mind of squad.minds) {
      if (mind.role) roles.add(mind.role);
      tactics.add(mind.tactic);
      if (mind.tactic === 'fire' && mind.stance === 'kneel' && mind.trooper.reaction.crouch > 0.7) kneeling++;
      if (frame > 60 * 14 && mind.tactic === 'pursue') pursued = true;
    }
    for (const trooper of troopers) trooper.update(1 / 60, time);
    collideSquad(troopers);
    troopers.forEach((trooper, index) => { travelled[index] += trooper.root.position.distanceTo(last[index]); last[index].copy(trooper.root.position); });
  }
  assert.ok(['rusher', 'flanker', 'anchor'].every(role => roles.has(role)), `parts: ${[...roles]}`);
  assert.ok(shots >= 40, `aggressive: ${shots} shots in 24 s`);
  assert.ok(blind >= 3, `blind bursts over crates (${blind} shots)`);
  assert.ok(kneeling > 10, 'kneeling to fire');
  assert.ok(pursued, 'after the hero when he slips away');
  assert.ok(travelled.every(distance => distance > 2), `everyone moved (${travelled.map(d => d.toFixed(1))})`);
  assert.ok(troopers.every(trooper => !trooper.dead), 'nobody hurt himself');
});
