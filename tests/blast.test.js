import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper } from '../src/stormtrooper.js';
import { createLab } from '../src/lab.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { createDebris } from '../src/debris.js';
import { createGrenades } from '../src/grenades.js';
import { createExplosions } from '../src/explosions.js';
import { createHeroRagdoll } from '../src/hero-ragdoll.js';
import { createCharacter } from '../src/character.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

test('debris: thrown by a blast it flies, tumbles, bounces, and comes to rest on the floor', () => {
  const debris = createDebris(new THREE.Scene(), { random: seeded(3) });
  const bodies = ['crate', 'plate', 'canister', 'pipe', 'part'].map((name, i) => debris.add(name, new THREE.Vector3(1 + i * 0.4, 0.2, 0)));
  for (let i = 0; i < 60; i++) debris.update(1 / 60);
  assert.ok(bodies.every(body => body.sleeping), 'at rest before');
  debris.blast(new THREE.Vector3(0.5, 0, 0));
  let highest = 0, turned = 0;
  const before = bodies.map(body => body.quaternion.clone());
  for (let i = 0; i < 60 * 7; i++) {
    debris.update(1 / 60);
    highest = Math.max(highest, ...bodies.map(body => body.position.y));
  }
  turned = Math.max(...bodies.map((body, i) => body.quaternion.angleTo(before[i])));
  assert.ok(highest > 0.6, `thrown up (${highest.toFixed(2)} m)`);
  assert.ok(turned > 0.5, 'spinning as it goes');
  assert.ok(bodies.every(body => body.position.x > 1), 'away from the blast');
  assert.ok(bodies.every(body => body.sleeping && body.position.y > 0 && body.position.y < 0.3), 'at rest on the floor again');
  assert.ok(bodies.every(body => [body.position.x, body.position.y, body.position.z].every(Number.isFinite)));
});

test('debris: fragments fly out of a blast, land and are gone after a while; nothing ends inside a crate', () => {
  const lab = createLab(new THREE.Scene());
  const debris = createDebris(new THREE.Scene(), { lab, random: seeded(5) });
  debris.scatter(30);
  const box = lab.obstacles[0];
  const at = box.centre.clone().setY(0).add(new THREE.Vector3(box.max.x - box.centre.x + 1, 0, 0));
  debris.fragments(at, 14);
  assert.ok(debris.awake >= 14);
  for (let i = 0; i < 60 * 6; i++) debris.update(1 / 60);
  const inside = debris.bodies.filter(body => lab.obstacles.some(b => body.position.x > b.min.x + 0.02 && body.position.x < b.max.x - 0.02 && body.position.z > b.min.z + 0.02 && body.position.z < b.max.z - 0.02 && body.position.y < b.max.y - 0.02));
  assert.equal(inside.length, 0, 'nothing went through a crate');
  for (let i = 0; i < 60 * 14; i++) debris.update(1 / 60);
  assert.ok(debris.bodies.length <= 30, 'the fragments are gone, the scattered objects stay');
});

test('a grenade lands near its target, bounces, beeps faster and faster, and goes off at the end of its fuse', () => {
  const beeps = [];
  let clock = 0;
  const grenades = createGrenades(new THREE.Scene(), { random: seeded(7), onBeep: () => beeps.push(clock) });
  const target = new THREE.Vector3(6, 0, 2);
  const grenade = grenades.throwAt(new THREE.Vector3(0, 1.4, 0), target, { fuse: 2.2 });
  let landed = null, bounces = 0, blasts = [];
  for (let i = 0; i < 60 * 3 && !blasts.length; i++) {
    clock += 1 / 60;
    const vy = grenade.velocity.y;
    blasts = grenades.update(1 / 60);
    if (vy < -1.2 && grenade.velocity.y > 0) { bounces++; landed ??= grenade.position.clone(); }
  }
  assert.ok(landed && landed.distanceTo(new THREE.Vector3(6, landed.y, 2)) < 0.8, `lands on target (${landed?.toArray().map(v => v.toFixed(2))})`);
  assert.ok(bounces >= 1, 'bounces');
  assert.equal(blasts.length, 1, 'goes off');
  assert.ok(Math.abs(clock - 2.2) < 0.05, `when its fuse runs out (${clock.toFixed(2)} s)`);
  const gaps = beeps.slice(1).map((time, i) => time - beeps[i]);
  assert.ok(gaps.length > 6 && gaps.at(-1) < gaps[0] * 0.4, `the beeps quicken (${gaps[0].toFixed(2)} → ${gaps.at(-1).toFixed(2)} s)`);
  // The Force sends one back.
  const again = grenades.throwAt(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(2, 0, 0), { fuse: 3 });
  for (let i = 0; i < 70; i++) grenades.update(1 / 60);
  assert.equal(grenades.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)), 1);
  assert.ok(again.velocity.x > 5, 'pushed away by the Force');
});

test('an explosion flashes, rings out over the floor and is gone; it leaves a scorch', () => {
  const explosions = createExplosions(new THREE.Scene());
  const slot = explosions.spawn(new THREE.Vector3(1, 0, 1));
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(9, 9.2, 11);
  camera.lookAt(1, 0.6, 1);
  camera.updateMatrixWorld();
  const light = [];
  for (let i = 0; i < 60 * 3; i++) { explosions.update(1 / 60, camera); light.push(slot.light.intensity); }
  const peak = light.indexOf(Math.max(...light));
  assert.ok(peak < 6 && light[peak] > 20, 'a blinding flash at once');
  assert.ok(light[40] < light[peak] * 0.3, 'that fades fast');
  assert.equal(explosions.active, 0, 'done');
  assert.ok(slot.scorch.visible && slot.scorch.material.opacity > 0.3, 'a scorch stays');
});

test('a trooper throws a grenade with his left hand, rifle kept in the right; knocked over mid-throw, he drops it', () => {
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(0, 0, 0), heading: 0, random: seeded(9) });
  let time = 0;
  const run = seconds => { for (let i = 0; i < Math.round(seconds * 60); i++) { time += 1 / 60; trooper.update(1 / 60, time); } };
  run(0.4);
  assert.ok(trooper.throwGrenade(new THREE.Vector3(0, 0, 7)));
  let grenade = null, leftOff = 1, highest = 0;
  for (let i = 0; i < 60 && !grenade; i++) {
    run(1 / 60);
    leftOff = Math.min(leftOff, trooper.reaction.holdL);
    highest = Math.max(highest, trooper.particle('WL').position.y);
    grenade = trooper.news.find(item => item.type === 'grenade') ?? null;
  }
  assert.ok(grenade && !grenade.dropped, 'it leaves his hand');
  assert.ok(grenade.from.y > 1.2 && grenade.from.z > 0, `over the top, in front (${grenade.from.toArray().map(v => v.toFixed(2))})`);
  assert.ok(leftOff < 0.3 && trooper.reaction.holdR > 0.9 && trooper.holding, 'the left hand left the rifle; the right kept it');
  assert.ok(highest > 1.38, `the arm came up over his shoulder (${highest.toFixed(2)} m)`);
  run(1);
  assert.ok(!trooper.throwing && trooper.reaction.holdL > 0.9, 'and goes back to the rifle');
  // Pushed over before he lets go: it drops at his feet.
  assert.ok(trooper.throwGrenade(new THREE.Vector3(0, 0, 7)));
  run(0.2);
  trooper.forcePush(new THREE.Vector3(0, 2, -6));
  const dropped = trooper.news.find(item => item.type === 'grenade');
  assert.ok(dropped?.dropped, 'dropped');
});

test('a squad facing a hero hidden behind cover flushes him out with a grenade', () => {
  const lab = createLab(new THREE.Scene());
  const troopers = [createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(-5.3, 0, -2.6), heading: 0.7, random: seeded(21), lab })];
  const squad = createSquadMind({ troopers, lab, random: seeded(4) });
  const saved = { ...FEEL.grenade };
  Object.assign(FEEL.grenade, { chance: 1, chanceHidden: 1 });
  const hero = new THREE.Vector3(0.5, 0, 0.6);
  squad.minds[0].awareness = 1;
  let time = 0, thrown = null;
  for (let i = 0; i < 60 * 10 && !thrown; i++) {
    time += 1 / 60;
    squad.update(1 / 60, { hero });
    troopers[0].update(1 / 60, time);
    thrown = troopers[0].news.find(item => item.type === 'grenade') ?? null;
  }
  Object.assign(FEEL.grenade, saved);
  assert.ok(thrown, 'a grenade was thrown');
  assert.ok(thrown.target.distanceTo(hero) < 2.5, 'at the hero');
});

test('blown off his feet, the hero flies, lands, lies still, then gets up and the motion capture takes him back', () => {
  const character = createCharacter();
  const scene = new THREE.Scene();
  scene.add(character.root);
  character.root.position.set(0, 0, 0);
  character.update({ dt: 1 / 60, time: 0 });
  const knockdown = createHeroRagdoll(character, { random: seeded(13) });
  assert.ok(knockdown.knock(new THREE.Vector3(5, 4, 1)));
  let highest = 0, up = null, time = 0, phases = new Set();
  for (let i = 0; i < 60 * 6 && !up; i++) {
    time += 1 / 60;
    up = knockdown.update(1 / 60, time);
    phases.add(knockdown.phase);
    if (knockdown.phase === 'flying') highest = Math.max(highest, knockdown.position.y);
  }
  assert.ok(highest > 1, `thrown up (${highest.toFixed(2)} m)`);
  assert.ok(phases.has('rising'), 'he got up');
  assert.ok(up && up.x > 1, `away from the blast (${up?.x.toFixed(2)} m)`);
  assert.ok(Number.isFinite(up.heading));
  const hips = character.rig.bones.Hips.getWorldPosition(new THREE.Vector3());
  assert.ok(hips.y > 0.6 && hips.y < 0.95, `standing again (${hips.y.toFixed(2)} m)`);
  assert.ok(!knockdown.active);
});
