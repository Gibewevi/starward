import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper } from '../src/stormtrooper.js';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createNav } from '../src/nav.js';
import { createSquadMind, patrolRounds } from '../src/trooper-ai.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function room() {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab });
  return { scene, lab, arena, nav: createNav(lab, ARENA) };
}

test('rounds through the room: each in its own part of it, a loop of free spots clear of the crates', () => {
  const { lab, nav } = room();
  const rounds = patrolRounds({ lab, nav, bounds: ARENA });
  assert.ok(rounds.length >= 4, `${rounds.length} rounds`);
  const middles = rounds.map(round => round.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(round.length));
  for (const [index, round] of rounds.entries()) {
    assert.ok(round.length >= 2, 'a loop of a few spots');
    for (const point of round) {
      assert.ok(nav.walkable(point), 'where a man can walk');
      assert.ok(lab.pushOut(point.clone(), 0.55).distanceTo(point) < 1e-3, 'clear of the crates');
    }
    for (const [other, middle] of middles.entries()) if (other !== index) assert.ok(middle.distanceTo(middles[index]) > 2.5, 'each in its own part of the room');
  }
});

test('a man of the escort marches in, then walks his round through the room — he does not stand by the door', () => {
  const { scene, lab, arena, nav } = room();
  const door = arena.door;
  const rounds = patrolRounds({ lab, nav, bounds: ARENA });
  const squad = createSquadMind({ troopers: [], lab, nav, random: seeded(5) });
  const heading = Math.atan2(door.out.x, door.out.z);
  const newcomer = createStormtrooper({ scene, position: door.inside[0], heading, random: seeded(6), lab });
  const threshold = door.centre.clone().addScaledVector(door.out, 0.7), post = nav.nearest(door.centre.clone().addScaledVector(door.out, 2.5));
  const mind = squad.add(newcomer, { position: post, heading, route: rounds[0] }, { entering: [threshold, ...nav.path(threshold, post)] });
  // The Jedi far off and out of sight.
  const hero = new THREE.Vector3(-30, 0, -30);
  door.open();
  let time = 0, furthest = 0, reached = 0, last = mind.routeIndex;
  for (let frame = 0; frame < 60 * 40; frame++) {
    time += 1 / 60;
    arena.update(time);
    squad.update(1 / 60, { hero });
    newcomer.update(1 / 60, time);
    furthest = Math.max(furthest, newcomer.root.position.distanceTo(post));
    if (mind.routeIndex !== last) { reached++; last = mind.routeIndex; }
  }
  assert.equal(mind.entering, null, 'in');
  assert.equal(mind.mode, 'calm');
  assert.ok(furthest > 4, `off on his round (${furthest.toFixed(1)} m from the door)`);
  assert.ok(reached >= 2, `spot after spot (${reached})`);
});

test('marching in on bodies, the escort searches the room first, then each goes off on his round', () => {
  const { scene, lab, arena, nav } = room();
  const door = arena.door;
  const rounds = patrolRounds({ lab, nav, bounds: ARENA });
  // Two of the first squad lie dead in the room.
  const dead = [new THREE.Vector3(-0.9, 0, -5.9), new THREE.Vector3(1.5, 0, -7)].map((position, index) => {
    const body = createStormtrooper({ scene, position, heading: 0, random: seeded(80 + index), lab });
    body.die('slash', new THREE.Vector3(0, 0, 1));
    return body;
  });
  const squad = createSquadMind({ troopers: [...dead], lab, nav, random: seeded(7) });
  const heading = Math.atan2(door.out.x, door.out.z), threshold = door.centre.clone().addScaledVector(door.out, 0.7);
  const escort = [0, 1, 2].map(index => {
    const trooper = createStormtrooper({ scene, position: door.inside[index], heading, random: seeded(90 + index), lab });
    const post = nav.nearest(door.centre.clone().addScaledVector(door.out, 2.3).addScaledVector(door.along, (index - 1) * 0.9));
    return squad.add(trooper, { position: post, heading, route: rounds[index % rounds.length] }, { entering: [threshold, ...(nav.path(threshold, post) ?? [post])] });
  });
  const hero = new THREE.Vector3(-40, 0, -40);
  door.open();
  let time = 0, searched = false;
  const moves = escort.map(() => 0), last = escort.map(mind => mind.trooper.root.position.clone()), laps = escort.map(() => 0), index = escort.map(mind => mind.routeIndex);
  for (let frame = 0; frame < 60 * 70; frame++) {
    time += 1 / 60;
    arena.update(time);
    squad.update(1 / 60, { hero });
    for (const trooper of [...dead, ...escort.map(mind => mind.trooper)]) trooper.update(1 / 60, time);
    escort.forEach((mind, at) => {
      if (mind.mode === 'sweep') searched = true;
      if (mind.mode === 'calm') {
        moves[at] += mind.trooper.root.position.distanceTo(last[at]);
        if (mind.routeIndex !== index[at]) { laps[at]++; index[at] = mind.routeIndex; }
      }
      last[at].copy(mind.trooper.root.position);
    });
  }
  assert.ok(searched, 'they searched first');
  for (const [at, mind] of escort.entries()) {
    assert.equal(mind.mode, 'calm', 'nothing found: calm again');
    assert.ok(laps[at] >= 1 && moves[at] > 3, `then on his round (${laps[at]} spots, ${moves[at].toFixed(1)} m)`);
  }
});
