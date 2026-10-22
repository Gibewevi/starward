import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper, collideSquad } from '../src/stormtrooper.js';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createNav } from '../src/nav.js';
import { createSquadMind } from '../src/trooper-ai.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
/** A blade swept straight across at chest height, along +x at about 7 m/s, round a man standing at the origin. */
function sweepAcross(trooper, clock) {
  const events = [];
  for (let frame = 0; frame < 8; frame++) {
    const x0 = -0.5 + frame * 0.12, x1 = x0 + 0.12;
    clock.time += 1 / 60;
    trooper.update(1 / 60, clock.time);
    events.push(...trooper.strike(new THREE.Vector3(x0, 1.15, -0.5), new THREE.Vector3(x0, 1.15, 0.5), new THREE.Vector3(x1, 1.15, -0.5), new THREE.Vector3(x1, 1.15, 0.5), 1 / 60, clock.time));
  }
  return events;
}
const open = { obstacles: [], clear: () => true, segmentHit: () => null, coverSpots: () => [], pushOut: point => point };

test('caught unaware from behind, the first blow kills; facing the Jedi, it only burns him', () => {
  const blow = facingHero => {
    const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(), heading: facingHero ? Math.PI : 0, random: seeded(61) });
    const squad = createSquadMind({ troopers: [trooper], lab: open, random: seeded(3) });
    // The hero a few steps behind him (or before him), walking.
    const hero = new THREE.Vector3(0, 0, -2.2), clock = { time: 0 };
    for (let frame = 0; frame < 90; frame++) {
      clock.time += 1 / 60;
      squad.update(1 / 60, { hero, heroVelocity: new THREE.Vector3(0, 0, 1.2) });
      trooper.update(1 / 60, clock.time);
    }
    const unaware = trooper.unaware;
    const events = sweepAcross(trooper, clock);
    return { trooper, unaware, events };
  };
  const back = blow(false);
  assert.ok(back.unaware, 'walking up behind him, he is not seen');
  assert.ok(back.trooper.dead || back.trooper.severed.size > 0, `the first blow cuts him down (${back.events.map(event => event.type).join()})`);
  const front = blow(true);
  assert.ok(!front.unaware, 'face to face, he sees him');
  assert.ok(!front.trooper.dead && front.trooper.severed.size === 0, 'the first blow only burns him');
});

test('hidden behind a crate he is lost at once; what they hear only tells them roughly where', () => {
  const lab = createLab(new THREE.Scene());
  const box = lab.obstacles.find(candidate => candidate.max.y > 1.3 && candidate.kind !== 'wall' && candidate.kind !== 'rail');
  assert.ok(box, 'a tall crate');
  const centre = box.centre.clone().setY(0);
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position: centre.clone().add(new THREE.Vector3(5, 0, 0)), heading: -Math.PI / 2, random: seeded(62), lab });
  const squad = createSquadMind({ troopers: [trooper], lab, random: seeded(4) });
  const mind = squad.minds[0];
  // In plain sight, then behind the crate (the crate between them).
  const hero = centre.clone().add(new THREE.Vector3(0, 0, 3));
  const behind = centre.clone().add(new THREE.Vector3(-(box.max.x - box.min.x) / 2 - 0.6, 0, 0));
  let time = 0;
  const step = (seconds, noises = []) => { for (let frame = 0; frame < seconds * 60; frame++) { time += 1 / 60; squad.update(1 / 60, { hero, noises: frame ? [] : noises }); trooper.update(1 / 60, time); } };
  mind.awareness = 1;
  step(1);
  assert.equal(mind.mode, 'combat');
  hero.copy(behind);
  step(0.5);
  assert.ok(!mind.sees, 'behind the crate he is not seen');
  assert.ok(mind.lastKnown.distanceTo(behind) > 1, 'nor followed there');
  step(0.1, [{ position: behind.clone(), radius: 6, from: behind.clone() }]);
  assert.ok(mind.lastKnown.distanceTo(behind) > 0.05, 'a sound tells him roughly where, not exactly');
});

test('a squadmate found lying there: the alarm, the squad searches the hiding places, kneels by him; the Jedi seen: the fight', () => {
  const scene = new THREE.Scene(), lab = createLab(scene);
  createArena(scene, { lab });
  const nav = createNav(lab, ARENA);
  const at = (x, z) => new THREE.Vector3(x, 0, z);
  const spots = [at(-5.3, -2.6), at(-3.3, -4.8), at(-0.9, -5.9)];
  const troopers = spots.map((position, index) => createStormtrooper({ scene, position, heading: 0.7, random: seeded(70 + index), lab }));
  const dead = troopers[1];
  dead.die('slash', new THREE.Vector3(0, 0, 1));
  // The others look his way.
  for (const trooper of [troopers[0], troopers[2]]) trooper.root.rotation.y = Math.atan2(spots[1].x - trooper.root.position.x, spots[1].z - trooper.root.position.z);
  const squad = createSquadMind({ troopers, lab, nav, posts: spots.map(position => ({ position })), random: seeded(6) });
  const hero = at(9, 9);
  let time = 0;
  const cues = [], modes = new Set();
  let knelt = false;
  const step = () => {
    time += 1 / 60;
    cues.push(...squad.update(1 / 60, { hero }).cues);
    for (const trooper of troopers) trooper.update(1 / 60, time);
    collideSquad(troopers);
    for (const mind of squad.minds) modes.add(mind.mode);
    if (squad.minds.some(mind => mind.point?.body && mind.point.arrived && mind.trooper.reaction.crouch > 0.6)) knelt = true;
  };
  for (let frame = 0; frame < 60 * 25; frame++) step();
  assert.ok(cues.some(cue => cue.radio === 'down'), 'man down, on the radio');
  assert.ok(modes.has('sweep'), [...modes].join());
  assert.ok(!modes.has('combat'), 'nobody fights a Jedi nobody has seen');
  const searched = squad.plan.sweep ? squad.plan.sweep.points.filter(point => point.done).length : 0;
  assert.ok(searched >= 3 || !squad.plan.sweep, `hiding places searched (${searched})`);
  assert.ok(knelt, 'one kneels by the body');
  // The Jedi steps out before one of them: the fight.
  const searcher = squad.minds.find(mind => !mind.trooper.dead);
  const t = searcher.trooper;
  hero.copy(t.root.position).add(new THREE.Vector3(Math.sin(t.heading), 0, Math.cos(t.heading)).multiplyScalar(4));
  for (let frame = 0; frame < 60 * 3; frame++) step();
  assert.ok(squad.minds.some(mind => mind.mode === 'combat'), 'seen: the fight');
});
