import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createJungle } from '../src/jungle.js';
import { createVegetation } from '../src/vegetation.js';
import { createWater } from '../src/water.js';
import { createNav } from '../src/nav.js';
import { patrolRounds } from '../src/trooper-ai.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
/** A lawn: a tuft of grass every 25 cm over 4 × 4 m round the origin. */
function lawn() {
  const scene = new THREE.Scene();
  const place = kind => {
    if (kind !== 'grass') return [];
    const plants = [];
    for (let x = -2; x <= 2; x += 0.25) for (let z = -2; z <= 2; z += 0.25) plants.push({ x, z, height: 0.5, size: 1 });
    return plants;
  };
  return createVegetation(scene, { place, random: seeded(3) });
}

test('the blade sweeping low through the grass cuts it and throws the bits; a sweep overhead cuts nothing', () => {
  const plants = lawn();
  const high = plants.cut(new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1.2, 0), new THREE.Vector3(-1, 1, 0.5), new THREE.Vector3(1, 1.2, 0.5), 9);
  assert.equal(high, 0, 'over the tops');
  const cut = plants.cut(new THREE.Vector3(-0.2, 0.9, -0.6), new THREE.Vector3(-0.9, 0.15, -0.6), new THREE.Vector3(-0.2, 0.9, 0.6), new THREE.Vector3(-0.9, 0.15, 0.6), 9);
  assert.ok(cut >= 3, `${cut} tufts cut`);
  assert.equal(plants.counts.grass.cut, cut);
  assert.ok(plants.bits > 0, 'bits of leaf in the air');
  // A second pass through the same stubs cuts no more (they are already below the blade).
  plants.update(1 / 60, { time: 0 });
  assert.equal(plants.cut(new THREE.Vector3(-0.2, 0.9, -0.6), new THREE.Vector3(-0.9, 0.15, -0.6), new THREE.Vector3(-0.2, 0.9, 0.6), new THREE.Vector3(-0.9, 0.15, 0.6), 9), 0);
  for (let i = 0; i < 60 * 13; i++) plants.update(1 / 60, { time: i / 60 });
  assert.equal(plants.bits, 0, 'the bits come down, lie a while and are gone');
  plants.reset();
  assert.equal(plants.counts.grass.cut, 0, 'all standing again');
});

test('whoever goes through bends the plants (a slot each, up to eight); a blast shakes them from where it went off', () => {
  const plants = lawn();
  const walkers = Array.from({ length: 10 }, (_, i) => ({ x: i * 0.3, z: 0, radius: 0.5, strength: 1 }));
  plants.update(1 / 60, { time: 1, pushers: walkers });
  const slots = plants.uniforms.uPush.value;
  assert.equal(slots.length, 8);
  assert.ok(Math.abs(slots[2].x - 0.6) < 1e-9 && slots[2].y === 0 && slots[2].w === 1, 'x, z, radius, strength');
  assert.ok(slots.every(slot => slot.z === 0.5), 'the first eight walkers');
  plants.update(1 / 60, { time: 2 });
  assert.ok(plants.uniforms.uPush.value.every(slot => slot.z === 0), 'gone, the plants stand back up');
  plants.blast(new THREE.Vector3(1, 0, 1), 1.5);
  const blast = plants.uniforms.uBlast.value.find(slot => slot.w > 0);
  assert.ok(blast, 'a blast registered');
  assert.deepEqual([blast.x, blast.y, blast.w], [1, 1, 1.5]);
});

/** A pond: 4 × 3 m, all water but a dry rim. */
function pond(random = seeded(9)) {
  const scene = new THREE.Scene();
  const rect = { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 };
  const depthAt = (x, z) => (Math.abs(x) < 1.7 && Math.abs(z) < 1.2 ? 1 : 0);
  return createWater(scene, { rect, depthAt, random });
}

test('a splash throws drops and sends rings out across the water, which calms down again', () => {
  const water = pond();
  assert.equal(water.splash(new THREE.Vector3(1.9, 0, 0), 1), false, 'nothing to splash on the bank');
  assert.ok(water.splash(new THREE.Vector3(-0.5, 0, 0), 1), 'into the water');
  assert.ok(water.drops > 6, `${water.drops} drops`);
  const energies = [];
  for (let i = 0; i < 60 * 6; i++) { water.update(1 / 60, { time: i / 60 }); if (i % 30 === 29) energies.push(water.energy); }
  assert.equal(water.drops, 0, 'the drops fall back');
  assert.ok(energies[0] > 0.5, `the water moved (${energies[0].toFixed(2)})`);
  assert.ok(energies.at(-1) < energies[0] * 0.1, `and settled (${energies.map(e => e.toFixed(2)).join(' ')})`);
  assert.ok(energies.every(Number.isFinite), 'and never blew up');
});

test('the rings spread out from the splash: some way off, the water rises and falls a moment later', () => {
  const water = pond();
  const heights = water.surface.material.uniforms.tHeight.value.image;
  const cell = (x, z) => heights.data[Math.floor((z + 1.5) / 0.08) * heights.width + Math.floor((x + 2) / 0.08)];
  water.splash(new THREE.Vector3(-0.8, 0, 0), 0.8);
  let reached = -1;
  for (let i = 0; i < 120 && reached < 0; i++) { water.update(1 / 60, { time: i / 60 }); if (Math.abs(cell(0.4, 0)) > 1e-3) reached = i; }
  assert.ok(reached > 3, `not at once (${reached} frames)`);
  assert.ok(reached < 100, 'but soon');
});

test('wading stirs the water round the legs; standing still in it, or walking on the bank, does not', () => {
  const water = pond();
  for (let i = 0; i < 60; i++) water.update(1 / 60, { time: i / 60, waders: [{ x: 0, z: 0, speed: 0 }, { x: 1.9, z: 0, speed: 3 }] });
  assert.equal(water.energy, 0);
  for (let i = 0; i < 60; i++) water.update(1 / 60, { time: i / 60, waders: [{ x: -1 + i * 0.03, z: 0, speed: 1.8 }] });
  assert.ok(water.energy > 0.1, `a wake (${water.energy.toFixed(2)})`);
  water.reset();
  assert.equal(water.energy, 0);
});

test('the clearing: the squad posted on dry ground clear of the ruins, the hero across the stream, all within reach', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(11) });
  const nav = createNav(jungle.lab, jungle.bounds);
  const start = new THREE.Vector3(jungle.start.x, 0, jungle.start.z);
  assert.ok(nav.walkable(start) && !jungle.inWater(start), 'the hero starts on dry ground');
  for (const post of jungle.posts) {
    assert.ok(nav.walkable(post.position), 'a post where a man can stand');
    assert.ok(jungle.lab.pushOut(post.position.clone(), 0.5).distanceTo(post.position) < 0.06, 'clear of the stones');
    assert.ok(!jungle.inWater(post.position), 'out of the water');
    assert.ok(nav.path(post.position, start), 'and a way to the hero');
    for (const point of post.route ?? []) assert.ok(nav.walkable(point), 'his round on walkable ground');
  }
  assert.ok(patrolRounds({ lab: jungle.lab, nav, bounds: jungle.bounds }).length >= 4, 'rounds for the men who come later');
  // Plants everywhere, none growing out of a stone.
  const counts = jungle.vegetation.counts;
  assert.ok(counts.grass.plants > 1500 && counts.fern.plants > 100 && counts.broadleaf.plants > 50 && counts.reed.plants > 100, JSON.stringify(counts));
});

test('the trail at the back is the squad\'s door: shut, it stops the hero; open, men come through it into the clearing', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(12) });
  const door = jungle.arena.door;
  const out = door.centre.clone().addScaledVector(door.out, -1.4);
  assert.ok(jungle.lab.pushOut(out.clone(), 0.3).distanceTo(out) > 0.05 || jungle.lab.segmentHit(door.centre.clone().setY(1), out.clone().setY(1)), 'shut: no way out');
  door.open();
  let time = 0;
  for (let i = 0; i < 120; i++) jungle.arena.update(time += 1 / 60);
  assert.ok(door.isOpen);
  const nav = createNav(jungle.lab, jungle.bounds);
  const threshold = door.centre.clone().addScaledVector(door.out, 0.7);
  assert.ok(nav.walkable(threshold) && nav.path(threshold, new THREE.Vector3(0, 0, 0)), 'from the trail into the clearing');
  assert.ok(!jungle.lab.segmentHit(door.inside[2].clone().setY(1), threshold.clone().setY(1)), 'nothing in the way up the trail');
  door.close();
  for (let i = 0; i < 120; i++) jungle.arena.update(time += 1 / 60);
  assert.ok(door.isClosed && jungle.lab.obstacles.includes(door.shut), 'shut again');
  jungle.reset();
  assert.equal(door.openness, 0);
});

test('a foot on the sand leaves a print that stays; in the stream, a splash; on the old slabs, nothing', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(13) });
  const along = new THREE.Vector3(0, 0, 1);
  const sand = new THREE.Vector3(jungle.start.x, 0, jungle.start.z);
  assert.equal(jungle.step(sand, along, 'L', FEEL.prints.hero, 1.5), 'sand');
  assert.equal(jungle.prints.count, 1);
  let stream = null;
  for (let x = -8; x < 8 && !stream; x += 0.5) for (let z = -8; z < 8 && !stream; z += 0.25) if (jungle.waterDepth(x, z) > 0.6) stream = new THREE.Vector3(x, 0, z);
  assert.ok(stream, 'there is water');
  assert.equal(jungle.step(stream, along, 'R', FEEL.prints.hero, 3), 'water');
  assert.ok(jungle.water.drops > 0, 'a splash');
  assert.equal(jungle.prints.count, 1, 'no print in the water');
  const slab = new THREE.Vector3(-3.5, 0, -7);
  assert.ok(jungle.slabs(slab.x, slab.z));
  jungle.step(slab, along, 'L', FEEL.prints.hero, 1.5);
  assert.equal(jungle.prints.count, 1, 'none on stone');
  // A minute and more later, the print is still there.
  for (let i = 0; i < 90; i++) jungle.update(1, { time: i });
  assert.equal(jungle.prints.count, 1, 'a print that lasts');
  jungle.reset();
  assert.equal(jungle.prints.count, 0);
});

test('a grenade in the clearing flattens the plants round it and heaves the water', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(14) });
  let stream = null;
  for (let x = -8; x < 8 && !stream; x += 0.5) for (let z = -8; z < 8 && !stream; z += 0.25) if (jungle.waterDepth(x, z) > 0.8) stream = new THREE.Vector3(x, 0, z);
  jungle.blast(stream, 1);
  assert.ok(jungle.vegetation.uniforms.uBlast.value.some(slot => slot.w > 0), 'the plants feel it');
  assert.ok(jungle.water.drops > 20, 'water thrown up');
  jungle.update(0.2, { time: 0.2 });
  assert.ok(jungle.water.energy > 1, 'and rings');
  assert.equal(jungle.bolt(new THREE.Vector3(jungle.start.x, 0, jungle.start.z)), false, 'a bolt into the sand: no splash');
  assert.equal(jungle.bolt(stream), true, 'into the water: one');
});
