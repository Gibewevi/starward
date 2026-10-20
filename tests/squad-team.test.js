import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createNav } from '../src/nav.js';
import { createStormtrooper, collideSquad } from '../src/stormtrooper.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { createShake } from '../src/shake.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
/** The squad against a hero who walks about the room; every frame is handed to `watch`. */
function fight({ seconds = 20, seed = 11, watch = () => {}, shots = () => {}, hero: path = null } = {}) {
  const scene = new THREE.Scene(), lab = createLab(scene);
  createArena(scene, { lab });
  const nav = createNav(lab, ARENA);
  const spots = [[-5.3, -2.6], [-3.3, -4.8], [-0.9, -5.9], [-6, 1.2], [2, -7]];
  const troopers = spots.map(([x, z], index) => createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(x, 0, z), heading: 0.7, random: seeded(seed * 3 + index), lab }));
  const squad = createSquadMind({ troopers, lab, nav, random: seeded(seed) });
  const hero = new THREE.Vector3(0.5, 0, 0.6);
  squad.minds[0].awareness = 1;
  let time = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    time += 1 / 60;
    path?.(hero, time);
    const thought = squad.update(1 / 60, { hero });
    watch({ squad, troopers, hero, thought, time, lab });
    for (const shot of thought.shots) shots(shot, time);
    for (const trooper of troopers) { trooper.focus = hero; trooper.update(1 / 60, time); }
    collideSquad(troopers);
  }
  return { squad, troopers };
}

test('under fire they move by turns: those who see him cover while the others move; bursts are staggered', () => {
  let over = 0, frames = 0, starts = [];
  const firing = new Map();
  fight({
    seconds: 22,
    watch: ({ squad, time }) => {
      const seers = squad.minds.filter(mind => mind.mode === 'combat' && mind.sees && !mind.trooper.dead);
      // (A short step to get a clear shot is not a move.)
      const moving = seers.filter(mind => squad.plan.movers.has(mind) && ['move', 'advance'].includes(mind.tactic) && !mind.reposition);
      const most = Math.max(1, Math.round(squad.plan.fighting * FEEL.ai.movers));
      frames++;
      // (One who set off while he could not see him may come into sight on his way.)
      if (moving.length > most) over++;
    },
    shots: (shot, time) => {
      // A burst starts with a shot after a pause (the hip shots of a man backing away are not bursts).
      const last = firing.get(shot.trooper) ?? -Infinity;
      if (time - last > 0.5 && !shot.hip) starts.push(time);
      firing.set(shot.trooper, time);
    },
  });
  assert.ok(over / frames < 0.05, `hardly ever more movers in his sight than the plan allows (${over}/${frames} frames)`);
  assert.ok(starts.length >= 8, `bursts (${starts.length})`);
  starts.sort((a, b) => a - b);
  const together = starts.filter((t, i) => i && t - starts[i - 1] < FEEL.ai.stagger - 0.02).length;
  assert.ok(together <= starts.length * 0.15, `bursts start one after another, not all at once (${together}/${starts.length} too close)`);
});

test('every aimed burst is announced: the glint swells at the muzzle before the first shot', () => {
  const charged = new Map();
  let shots = 0, unannounced = 0;
  fight({
    seconds: 16,
    watch: ({ squad, thought }) => {
      for (const shot of thought.shots) {
        shots++;
        const mind = squad.minds.find(other => other.trooper === shot.trooper);
        // The burst's first shot follows a full charge (the rest of the burst follows it).
        if (!(charged.get(mind) >= 0.85)) unannounced++;
      }
      for (const mind of squad.minds) {
        if (mind.charge > 0) charged.set(mind, Math.max(charged.get(mind) ?? 0, mind.charge));
        else if (!['fire', 'evade'].includes(mind.tactic)) charged.set(mind, 0);
      }
    },
  });
  assert.ok(shots >= 20, `shots (${shots})`);
  assert.equal(unannounced, 0, 'no shot without the aim glint first');
});

test('the flankers swing round him on opposite sides', () => {
  let opposite = 0, samples = 0;
  fight({
    seconds: 14,
    watch: ({ squad, time }) => {
      if (time < 4 || Math.round(time * 60) % 30) return;
      const flankers = squad.minds.filter(mind => mind.role === 'flanker' && mind.mode === 'combat' && !mind.trooper.dead);
      if (flankers.length < 2) return;
      samples++;
      if (flankers[0].flankSide && flankers[0].flankSide === -flankers[1].flankSide) opposite++;
    },
  });
  assert.ok(samples > 5 && opposite / samples > 0.9, `one each side (${opposite}/${samples})`);
});

test('the team does not dither: no plan flipped back and forth within a second, nobody standing stuck', () => {
  const last = new Map();
  let flips = 0, changes = 0;
  fight({
    seconds: 24,
    hero: (hero, time) => {
      // He goes round the room: they have to keep reorganising.
      const angle = time * 0.25;
      hero.set(Math.sin(angle) * 3.5, 0, Math.cos(angle) * 3.5 - 1);
    },
    watch: ({ squad, time }) => {
      for (const mind of squad.minds) {
        const h = last.get(mind) ?? [];
        if (h.at(-1)?.tactic !== mind.tactic) {
          changes++;
          h.push({ tactic: mind.tactic, time });
          const n = h.length;
          if (n >= 3 && h[n - 1].tactic === h[n - 3].tactic && time - h[n - 3].time < 1) flips++;
        }
        last.set(mind, h);
      }
    },
  });
  assert.ok(changes > 30, `they keep acting (${changes} changes)`);
  assert.ok(flips <= changes * 0.12, `back-and-forth flips ${flips}/${changes}`);
});

test('the camera shake grows with the square of the trauma and drains away', () => {
  const shake = createShake({ random: seeded(3) });
  let at = shake.update(1 / 60);
  assert.equal(at.offset.length(), 0, 'still at rest');
  shake.add(0.3);
  let small = 0;
  for (let i = 0; i < 20; i++) small = Math.max(small, shake.update(1 / 60).offset.length());
  shake.clear();
  shake.add(1);
  let big = 0, roll = 0;
  for (let i = 0; i < 20; i++) { const out = shake.update(1 / 60); big = Math.max(big, out.offset.length()); roll = Math.max(roll, Math.abs(out.roll)); }
  assert.ok(big > small * 4, `a blast rocks the view far more than a blow (${big.toFixed(3)} vs ${small.toFixed(3)})`);
  assert.ok(big > 0.12, 'several pixels at full trauma');
  assert.ok(roll > 0, 'and rolls it a little');
  for (let i = 0; i < 120; i++) at = shake.update(1 / 60);
  assert.equal(shake.trauma, 0, 'drained');
  assert.equal(at.offset.length(), 0);
});
