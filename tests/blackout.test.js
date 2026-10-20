import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena } from '../src/arena.js';
import { createPower } from '../src/power.js';
import { createTransformer } from '../src/transformer.js';
import { createFlashlights } from '../src/flashlights.js';
import { createImpactEffects } from '../src/impact-effects.js';
import { createStormtrooper } from '../src/stormtrooper.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function room() {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1.4));
  scene.environmentIntensity = 0.43;
  return { scene, lab, arena };
}

test('the power cut: every light of the room dims to the level (a blinking one on top of its blink), and back', () => {
  const { scene, lab, arena } = room();
  const power = createPower({ scene, roots: [lab.group, arena.group] });
  assert.ok(power.emitters.length > 5 && power.lamps.length >= 3, 'lights found');
  assert.ok(power.fixtures.length > 20, `fittings to spark (${power.fixtures.length})`);
  const bright = power.emitters.map(entry => entry.material.color.r + entry.material.color.g + entry.material.color.b);
  power.level = 0;
  for (let i = 0; i < 3; i++) { arena.update(i / 60); lab.update(i / 60); power.apply(); }
  const dark = power.emitters.map(entry => entry.material.color.r + entry.material.color.g + entry.material.color.b);
  assert.ok(dark.every(value => value < 1e-6), 'every light out, the animated ones too');
  assert.ok(power.lamps.every(entry => entry.light.intensity === 0), 'every lamp out');
  let hemisphere = null;
  scene.traverse(object => { if (object.isHemisphereLight) hemisphere = object; });
  assert.ok(Math.abs(hemisphere.intensity - FEEL.blackout.night.hemisphere) < 1e-6 && Math.abs(scene.environmentIntensity - FEEL.blackout.night.environment) < 1e-6, 'a cold trace of light left');
  power.level = 1;
  for (let i = 0; i < 3; i++) { arena.update(1 + i / 60); lab.update(1 + i / 60); power.apply(); }
  // Back as they would be: the same room never cut, at the same moment (the blinking ones mid-blink).
  const twin = room(), twinPower = createPower({ scene: twin.scene, roots: [twin.lab.group, twin.arena.group] });
  for (let i = 0; i < 3; i++) { twin.arena.update(i / 60); twin.lab.update(i / 60); }
  for (let i = 0; i < 3; i++) { twin.arena.update(1 + i / 60); twin.lab.update(1 + i / 60); }
  power.emitters.forEach((entry, i) => assert.ok(entry.material.color.equals(twinPower.emitters[i].material.color), `${entry.material.name || 'a light'} back as it was`));
  assert.ok(bright.length === power.emitters.length);
  const near = power.fixturesFrom(new THREE.Vector3(7, 0, -10));
  assert.ok(near[0].distanceTo(new THREE.Vector3(7, 0, -10)) <= near.at(-1).distanceTo(new THREE.Vector3(7, 0, -10)), 'nearest first');
});

test('battery-backed: the cases’ diodes and the red floor panels stay faintly on in the dark', () => {
  const { scene, lab, arena } = room();
  const power = createPower({ scene, roots: [{ group: lab.group, keep: FEEL.blackout.keep }, arena.group] });
  power.level = 0;
  for (let i = 0; i < 3; i++) { arena.update(i / 60); lab.update(i / 60); power.apply(); }
  const kept = power.emitters.filter(entry => entry.floor > 0);
  assert.ok(kept.length >= 3, `some kept (${kept.map(entry => entry.material.name)})`);
  for (const entry of kept) assert.ok(entry.material.color.r + entry.material.color.g + entry.material.color.b > 1e-4, `${entry.material.name} faintly on`);
  assert.ok(power.emitters.filter(entry => !entry.floor).every(entry => entry.material.color.r + entry.material.color.g + entry.material.color.b < 1e-6), 'the rest out');
});

test('the transformer: in the way like a crate; the blade in, it surges, blows, and spits in the dark', () => {
  const { scene, lab } = room();
  const effects = createImpactEffects(scene, { random: seeded(3) });
  const transformer = createTransformer(scene, { lab, effects, at: new THREE.Vector3(7.4, 0, -10.675), random: seeded(4) });
  assert.ok(lab.obstacles.includes(transformer.box), 'an obstacle');
  assert.ok(transformer.reachable(transformer.approach) && !transformer.reachable(new THREE.Vector3(0, 0, 0)), 'reached from before it only');
  assert.ok(transformer.begin());
  assert.equal(transformer.begin(), false, 'once');
  let burst = null, last = 0, sparks = 0;
  for (let t = 0; t < 3 && burst === null; t += 1 / 60) {
    const state = transformer.update(1 / 60, { blade: { base: transformer.approach.clone().setY(1), tip: transformer.socket.clone() } });
    assert.ok(state.progress >= last - 1e-9 || state.burst, 'the surge only builds');
    last = state.progress;
    sparks = Math.max(sparks, effects.live);
    if (state.burst) burst = t;
  }
  assert.ok(burst !== null && Math.abs(burst - FEEL.sabotage.surge) < 0.05, `blows after the surge (${burst?.toFixed(2)} s)`);
  assert.ok(sparks > 40, 'sparks pouring out');
  assert.equal(transformer.state, 'dead');
  assert.ok(!transformer.reachable(transformer.approach), 'nothing more to do there');
  let spits = 0;
  for (let t = 0; t < 12; t += 1 / 30) if (transformer.update(1 / 30).spit) spits++;
  assert.ok(spits >= 3, `spits in the dark (${spits})`);
  transformer.reset();
  assert.equal(transformer.state, 'ready');
});

test('in the dark the troopers switch on their rifle lamps one by one; the nearest ones really light', () => {
  const { scene, lab } = room();
  const troopers = [0, 1, 2, 3, 4, 5, 6].map(i => createStormtrooper({ scene, position: new THREE.Vector3(i * 1.5 - 4, 0, -2), heading: 0, random: seeded(10 + i), lab }));
  const lamps = createFlashlights(scene, { random: seeded(5) });
  const hero = new THREE.Vector3(0, 1, 2);
  lamps.update(1 / 60, { troopers, hero, night: 0 });
  assert.equal(lamps.on, 0, 'off by day');
  lamps.darkness(troopers);
  const clicked = [];
  let time = 0;
  for (; time < 3; time += 1 / 60) {
    for (const trooper of troopers) trooper.update(1 / 60, time);
    for (const trooper of lamps.update(1 / 60, { troopers, hero, night: 1 })) clicked.push([trooper, time]);
  }
  assert.equal(clicked.length, troopers.length, 'each one clicks his on, once');
  const times = clicked.map(([, at]) => at);
  assert.ok(Math.max(...times) - Math.min(...times) > 0.3, 'one after another');
  assert.ok(Math.min(...times) >= FEEL.blackout.onAfter[0] - 0.05, 'after a moment');
  assert.equal(lamps.on, troopers.length, 'all beams showing');
  assert.ok(lamps.motes > 8, `dust in the beams (${lamps.motes})`);
  assert.ok([...lamps.beams.values()].every(beam => beam.cone.layers.mask === 2 && beam.glint.layers.mask === 2) && lamps.dust.layers.mask === 2, 'beams and dust out of the floor’s reflection (layer 1)');
  const lit = lamps.pool.filter(light => light.intensity > 0);
  assert.equal(lit.length, FEEL.blackout.lamps, 'a fixed number of real lights, never more');
  assert.equal(lamps.pool.filter(light => light.castShadow).length, FEEL.blackout.shadows);
  // The real lights go to the rifles nearest the hero.
  const nearest = [...troopers].sort((a, b) => a.muzzle.distanceTo(hero) - b.muzzle.distanceTo(hero)).slice(0, FEEL.blackout.lamps);
  for (const light of lit) assert.ok(nearest.some(trooper => trooper.muzzle.distanceTo(light.position) < 0.2), 'on a near rifle');
  lamps.clear();
  assert.equal(lamps.on, 0);
});

test('the dust hangs in the air: a lamp turning lights other motes, it does not drag them along', () => {
  const { scene, lab } = room();
  const trooper = createStormtrooper({ scene, position: new THREE.Vector3(0, 0, 0), heading: 0, random: seeded(21), lab });
  const lamps = createFlashlights(scene, { random: seeded(22) });
  const hero = new THREE.Vector3(0, 1, 6);
  lamps.darkness([trooper], [0, 0]);
  // Rifle up, aiming level across the room.
  trooper.order.aim = true;
  trooper.order.aimAt = new THREE.Vector3(0, 1.1, 8);
  let time = 0;
  for (; time < 1.5; time += 1 / 60) { trooper.update(1 / 60, time); lamps.update(1 / 60, { troopers: [trooper], hero, night: 1 }); }
  const beam = lamps.beams.get(trooper);
  // The motes the beam lights now (well inside its cone).
  const inBeam = () => lamps.air.map((at, i) => {
    const local = at.clone().sub(beam.lens), along = local.dot(beam.forward) / FEEL.blackout.beam.length;
    return along > 0.1 && along < beam.reach * 0.9 && local.addScaledVector(beam.forward, -along * FEEL.blackout.beam.length).length() < FEEL.blackout.beam.radius * along * 0.7 ? i : -1;
  }).filter(i => i >= 0);
  const before = inBeam(), still = lamps.air.map(at => at.clone());
  assert.ok(before.length >= 3 && lamps.motes >= 3, `motes in the beam (${before.length}, ${lamps.motes} glowing)`);
  // He swings his rifle round: the beam sweeps on, the dust stays where it hangs.
  trooper.root.rotation.y += 1.2;
  lamps.update(1 / 60, { troopers: [trooper], hero, night: 1 });
  // (Past the floor or the ceiling, one may come back in from the other side: not dragged.)
  const dragged = lamps.air.filter((at, i) => at.distanceTo(still[i]) > 0.01 && at.distanceTo(still[i]) < 1);
  assert.equal(dragged.length, 0, 'no mote dragged along');
  const after = inBeam();
  assert.ok(after.length >= 3 && lamps.motes >= 3, 'other motes lit');
  assert.ok(after.filter(i => before.includes(i)).length < before.length / 3, 'mostly new ones');
  // The hero walking through pushes them aside.
  const through = beam.lens.clone().addScaledVector(beam.forward, 1.5), near = lamps.air.map((at, i) => [i, at.distanceTo(through)]).filter(([, d]) => d < 0.5).map(([i]) => i);
  const there = near.map(i => lamps.air[i].clone());
  for (let i = 0; i < 20; i++) lamps.update(1 / 60, { troopers: [trooper], hero, night: 1, stirs: [{ at: through, speed: 5 }] });
  const gained = near.map((i, k) => lamps.air[i].distanceTo(through) - there[k].distanceTo(through));
  assert.ok(near.length && gained.reduce((sum, d) => sum + d, 0) / near.length > 0.05, `pushed aside (${near.length} motes)`);
});

test('in the dark a trooper sees the hero only close by — further if his blade is lit, or in the beam of his lamp', () => {
  const { lab } = room();
  const make = () => {
    const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(-4, 0, 4.5), heading: Math.PI / 2, random: seeded(7), lab });
    const squad = createSquadMind({ troopers: [trooper], lab, random: seeded(8) });
    trooper.update(1 / 60, 0);
    return { trooper, squad };
  };
  const look = (hero, { saber, darkness }) => {
    const { squad } = make();
    for (let i = 0; i < 90; i++) squad.update(1 / 60, { hero, saber, darkness });
    return squad.minds[0].mode;
  };
  // 7 m ahead, a little off his line of sight (outside the beam).
  const hero = new THREE.Vector3(2, 0, 8.5);
  assert.notEqual(look(hero, { saber: 0, darkness: 0 }), 'calm', 'by day, seen');
  assert.equal(look(hero, { saber: 0, darkness: 1 }), 'calm', 'in the dark, blade off: unseen');
  assert.notEqual(look(hero, { saber: 1, darkness: 1 }), 'calm', 'blade lit: seen');
  // Straight down his beam, blade off, still seen.
  assert.notEqual(look(new THREE.Vector3(3, 0, 4.5), { saber: 0, darkness: 1 }), 'calm', 'in the beam: seen');
});
