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
  const nav = createNav(jungle.lab, jungle.bounds, { cost: jungle.navCost });
  const threshold = door.centre.clone().addScaledVector(door.out, 0.7);
  assert.ok(nav.walkable(threshold) && nav.path(threshold, new THREE.Vector3(-14, 0, -14)), 'from the trail onto the command post');
  assert.ok(!jungle.lab.segmentHit(door.inside[2].clone().setY(1), threshold.clone().setY(1)), 'nothing in the way up the trail');
  door.close();
  for (let i = 0; i < 120; i++) jungle.arena.update(time += 1 / 60);
  assert.ok(door.isClosed && jungle.lab.obstacles.includes(door.shut), 'shut again');
  jungle.reset();
  assert.equal(door.openness, 0);
});

test('the Force drives the water against the bank: it spills over onto the mud, then soaks away', () => {
  const water = pond();
  water.shove(new THREE.Vector3(-1.6, 0, 0), new THREE.Vector3(1, 0, 0), { range: 4, cone: 0.9, power: 1 });
  let most = 0;
  for (let i = 0; i < 60 * 2; i++) { water.update(1 / 60, { time: i / 60 }); most = Math.max(most, water.spilt); }
  assert.ok(most > 0.05, `over the bank (${most.toFixed(3)})`);
  // Spilt on the far side, where it was driven.
  const film = water.surface.material.uniforms.tFilm.value.image;
  let right = 0, left = 0;
  for (let k = 0; k < film.data.length; k++) if (film.data[k] > 1e-4) ((k % film.width) * 0.08 - 2 > 0 ? right++ : left++);
  assert.ok(right > left, `driven to the far bank (${right} cells there, ${left} behind)`);
  for (let i = 0; i < 60 * 8; i++) water.update(1 / 60, { time: i / 60 });
  assert.ok(water.spilt < most * 0.05, 'soaked away');
});

test('a pull draws the water towards the hero', () => {
  const water = pond();
  const heights = water.surface.material.uniforms.tHeight.value.image;
  const at = x => heights.data[Math.floor(1.5 / 0.08) * heights.width + Math.floor((x + 2) / 0.08)];
  water.shove(new THREE.Vector3(-1.9, 0, 0), new THREE.Vector3(1, 0, 0), { range: 3.4, cone: 0.9, power: -1 });
  let near = 0;
  for (let i = 0; i < 30; i++) { water.update(1 / 60, { time: i / 60 }); near = Math.max(near, at(-1.4)); }
  assert.ok(near > 0.01, `heaped up on his side (${near.toFixed(3)})`);
});

test('a blast in the water blows a hole in it; the water rushes back in and meets in a jet', () => {
  const water = pond();
  const heights = water.surface.material.uniforms.tHeight.value.image;
  const centre = () => heights.data[Math.floor(1.5 / 0.08) * heights.width + Math.floor(2 / 0.08)];
  assert.equal(water.crater(new THREE.Vector3(0, 0, 0), 0.8), 'water');
  assert.ok(centre() < -0.4, `a hole (${centre().toFixed(2)})`);
  let jet = false, lowest = 0;
  for (let i = 0; i < 60; i++) { water.update(1 / 60, { time: i / 60 }); if (water.drops > 10) jet = true; lowest = Math.min(lowest, centre()); }
  assert.ok(jet, 'the jet where it meets');
  assert.ok(centre() > -0.2, `filled back in (${centre().toFixed(2)})`);
  for (let i = 0; i < 60 * 8; i++) water.update(1 / 60, { time: i / 60 });
  assert.ok(Math.abs(centre()) < 0.02, 'and calm again');
});

test('the Force through the plants: a push sweeps the cone outward, a pull draws it in', () => {
  const plants = lawn();
  plants.update(1 / 60, { time: 1 });
  plants.gust(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), { range: 5, cone: 0.9, power: 1.5 });
  plants.gust(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), { range: 4, cone: 0.7, power: -1.1 });
  const [push, pull] = plants.uniforms.uGustB.value;
  assert.deepEqual([push.y, push.z], [1.5, 5]);
  assert.ok(Math.abs(push.w - Math.cos(0.9)) < 1e-9);
  assert.equal(pull.y, -1.1);
  assert.deepEqual(plants.uniforms.uGustA.value[0].toArray(), [0, 0, 0, 1]);
  plants.reset();
  assert.ok(plants.uniforms.uGustB.value.every(slot => slot.y === 0));
});

test('by night the moon barely comes through: the dust hangs before the ruins\' lamps instead', () => {
  const day = createJungle(new THREE.Scene(), { random: seeded(18) });
  const night = createJungle(new THREE.Scene(), { random: seeded(18), night: true });
  assert.equal(night.night, true);
  assert.ok(night.air.beams.every((beam, i) => beam.on <= day.air.beams[i].on * 0.25 + 1e-9), 'the shafts faint');
  // Motes lit by the lamps (warm) rather than the shafts: more of them by night, round the lamps.
  const nearLamps = jungle => {
    jungle.air.update(1 / 60, { time: 1 });
    const geometry = jungle.air.group.getObjectByName('Motes').geometry, position = geometry.attributes.position, glow = geometry.attributes.glow;
    let lit = 0;
    for (let i = 0; i < position.count; i++) {
      if (glow.getX(i) < 0.1) continue;
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      if (jungle.lamps.some(lamp => lamp.position.distanceTo(p) < 2.6)) lit++;
    }
    return lit;
  };
  assert.ok(nearLamps(night) > nearLamps(day) * 1.8, `thick before the lamps (${nearLamps(night)} by night, ${nearLamps(day)} by day)`);
});

// ---- The marsh ruins (stage 2's map) ------------------------------------------------------
/** One marsh to look round (built once: a big map), and its way-finding. */
let shared = null;
function marsh() {
  if (shared) return shared;
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(11) });
  const generators = jungle.buildGenerators(null);
  const nav = createNav(jungle.lab, jungle.bounds, { cost: jungle.navCost });
  return (shared = { scene, jungle, generators, nav });
}
const ground = (x, z) => new THREE.Vector3(x, 0, z);

test('the marsh ruins: the hero lands at the entry; every post, every generator and the command post within reach', () => {
  const { jungle, generators, nav } = marsh();
  const start = ground(jungle.start.x, jungle.start.z);
  assert.ok(nav.walkable(start) && !jungle.inWater(start), 'he starts on dry ground');
  assert.equal(generators.length, 4, 'four generators');
  for (const g of generators) {
    assert.ok(nav.walkable(g.approach), `${g.name}: room to stand before it`);
    assert.ok(nav.path(start, g.approach), `${g.name}: a way there`);
    assert.ok(!jungle.inWater(g.approach), `${g.name}: on dry ground`);
  }
  for (const post of jungle.posts) {
    assert.ok(nav.walkable(post.position), 'a post where a man can stand');
    assert.ok(!jungle.inWater(post.position), 'out of the water (or on a walkway)');
    for (const point of post.route ?? []) assert.ok(nav.walkable(point), 'his round on walkable ground');
  }
  assert.ok(patrolRounds({ lab: jungle.lab, nav, bounds: jungle.bounds }).length >= 4, 'rounds for the men who come later');
  const counts = jungle.vegetation.counts;
  assert.ok(counts.grass.plants > 4000 && counts.fern.plants > 800 && counts.reed.plants > 800 && counts.broadleaf.plants > 100, JSON.stringify(counts));
});

test('the squad keeps to the walkways and the islands: the way to the command post goes over the planks, not through the marsh', () => {
  const { jungle, nav } = marsh();
  const way = nav.path(ground(jungle.start.x, jungle.start.z), ground(-14, -14));
  assert.ok(way, 'a way');
  let wet = 0, samples = 0, from = ground(jungle.start.x, jungle.start.z);
  for (const point of way) {
    for (let t = 0; t < 1; t += 0.05) {
      const p = from.clone().lerp(point, t);
      samples++;
      if (jungle.inWater(p) && jungle.waterDepth(p.x, p.z) > 0.5) wet++;
    }
    from = point;
  }
  assert.ok(wet < samples * 0.08, `hardly a step in deep water (${wet} of ${samples})`);
});

test('four generators, each in its core; one blown cuts its zone\'s light, the others burn on; all back on a restart', () => {
  const { jungle, generators } = marsh();
  const centre = generators.find(g => g.name === 'centre');
  const lampsOf = zone => jungle.lamps.filter(lamp => lamp.zone === zone);
  assert.ok(lampsOf('centre').length > 2 && lampsOf('command').length > 2, 'lamps in each zone');
  jungle.sabotaged(centre);
  for (let i = 0; i < 60; i++) jungle.update(1 / 60, { time: i / 60 });
  assert.ok(lampsOf('centre').every(lamp => lamp.intensity === 0), 'the centre dark');
  assert.ok(lampsOf('command').every(lamp => lamp.intensity > 0), 'the command post still lit');
  jungle.reset();
  for (let i = 0; i < 2; i++) jungle.update(1 / 60, { time: i / 60 });
  assert.ok(lampsOf('centre').every(lamp => lamp.intensity > 0), 'lit again');
  // Its lamps share a few real lights, lent to the nearest.
  jungle.update(1 / 60, { time: 1, focus: centre.socket });
  const lit = jungle.lights.filter(light => light.intensity > 0);
  assert.ok(lit.length > 0 && lit.length <= 8, `${lit.length} real lights`);
  assert.ok(lit.every(light => light.position.distanceTo(centre.socket) < 18), 'round the view');
});

test('a foot on the sand leaves a print; in the marsh, a splash; on a walkway\'s planks or the slabs, nothing', () => {
  const { jungle } = marsh();
  const along = new THREE.Vector3(0, 0, 1);
  jungle.prints.clear();
  assert.equal(jungle.step(ground(16, 18.8), along, 'L', FEEL.prints.hero, 1.5), 'sand');
  assert.equal(jungle.prints.count, 1);
  let deep = null;
  for (let x = -10; x < 10 && !deep; x += 0.5) for (let z = 5; z < 20 && !deep; z += 0.5) if (jungle.waterDepth(x, z) > 0.8 && jungle.groundAt(x, z) === 0) deep = ground(x, z);
  assert.equal(jungle.step(deep, along, 'R', FEEL.prints.hero, 3), 'water');
  assert.ok(jungle.water.drops > 0, 'a splash');
  const deck = ground(7.4, 7.4);
  assert.equal(jungle.step(deck, along, 'L', FEEL.prints.hero, 1.5), 'wood');
  assert.ok(jungle.groundAt(deck.x, deck.z) > 0, 'up on the planks');
  jungle.step(ground(0.5, 0.5), along, 'L', FEEL.prints.hero, 1.5);
  assert.equal(jungle.prints.count, 1, 'none in the water, on wood or on stone');
  jungle.reset();
});

test('the floor: puddles and paths of open mud, the banks wet, no puddle in the marsh; the plants keep off the paths', () => {
  const { jungle } = marsh();
  const { layout, waterDepth } = jungle;
  let puddles = 0, paths = 0, wetBanks = 0, samples = 0;
  for (let x = -21; x < 21; x += 0.5) for (let z = -21; z < 21; z += 0.5) {
    samples++;
    if (waterDepth(x, z) > 0) { assert.equal(layout.puddle(x, z), 0, 'no puddle in the marsh'); continue; }
    if (layout.puddle(x, z) > 0.5) puddles++;
    if (layout.path(x, z) > 0.5) paths++;
    if (layout.wetness(x, z) > 0.5) wetBanks++;
  }
  assert.ok(puddles > 0 && puddles < samples * 0.1, `puddles here and there (${puddles} of ${samples})`);
  assert.ok(paths > samples * 0.02, `paths (${paths})`);
  assert.ok(wetBanks > samples * 0.04, `wet banks (${wetBanks})`);
  const matrix = new THREE.Matrix4(), at = new THREE.Vector3();
  let open = 0, all = 0;
  jungle.vegetation.group.traverse(mesh => {
    if (!mesh.isInstancedMesh || mesh.name !== 'Jungle grass') return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      if (Math.abs(at.x) > 24 || Math.abs(at.z) > 24) continue;
      all++;
      if (layout.path(at.x, at.z) > 0.9) open++;
    }
  });
  assert.ok(open < all * 0.03, `${open} of ${all} tufts on the paths`);
});

test('the ruins: their strips lit on the faces the camera sees; cover from the hero behind the blocks; the diodes blink', () => {
  const { scene, jungle } = marsh();
  const strips = jungle.lamps.filter(lamp => lamp.base >= 6);
  assert.ok(strips.length >= 8, `${strips.length} lit strips`);
  for (const lamp of strips) {
    const ruin = jungle.lab.obstacles.find(box => box.kind !== 'wall' && lamp.position.x > box.min.x - 0.6 && lamp.position.x < box.max.x + 0.6 && lamp.position.z > box.min.z - 0.6 && lamp.position.z < box.max.z + 0.6);
    assert.ok(ruin, 'by a ruin');
    assert.ok(lamp.position.x > ruin.max.x - 0.01 || lamp.position.z > ruin.max.z - 0.01, 'on the side the camera sees');
  }
  const cover = jungle.lab.coverSpots(ground(0.5, 0.5));
  assert.ok(cover.length > 3, `cover (${cover.length} spots)`);
  const diodes = scene.getObjectByName('Ruin diodes').material;
  jungle.ruins.update(0.3);
  const before = diodes.color.r;
  jungle.ruins.update(1.1);
  assert.notEqual(diodes.color.r, before);
});

test('hidden in the marsh and the reeds, the hero is seen only closer; in the open, from as far as ever', () => {
  const { jungle } = marsh();
  assert.equal(jungle.seen(ground(0.5, 0.5)), 1, 'on the plaza');
  let wading = null;
  for (let x = -10; x < 0 && !wading; x += 0.5) for (let z = 10; z < 20 && !wading; z += 0.5) if (jungle.waterDepth(x, z) > 0.8 && jungle.groundAt(x, z) === 0) wading = ground(x, z);
  assert.ok(jungle.seen(wading) < 0.75, `wading (${jungle.seen(wading).toFixed(2)})`);
  assert.equal(jungle.seen(ground(7.4, 7.4)), 1, 'up on a walkway');
});

test('a grenade in the marsh blows the water open and heaves it; one on the bank opens a crater the water pours into; the ground is dug, the plants within its reach thrown, none beyond', () => {
  const { jungle } = marsh();
  const { water } = jungle;
  let deep = null;
  for (let x = -10; x < 10 && !deep; x += 0.5) for (let z = 5; z < 20 && !deep; z += 0.5) if (jungle.waterDepth(x, z) > 0.9 && jungle.groundAt(x, z) === 0) deep = ground(x, z);
  jungle.blast(deep, 1, 5);
  assert.ok(water.drops > 20, 'water thrown up');
  jungle.update(0.2, { time: 0.2, focus: deep });
  assert.ok(water.energy > 1, 'and rings');
  assert.equal(jungle.bolt(ground(16, 18.8)), false, 'a bolt into the sand: no splash');
  assert.equal(jungle.bolt(deep), true, 'into the water: one');
  // Just off the centre island's shore, towards the east.
  let bank = null;
  for (let x = 2; x < 9 && !bank; x += 0.05) if (water.depth(x, -4) > 0) bank = x;
  const shore = ground(bank - 0.45, -4);
  assert.equal(water.depth(shore.x, shore.z), 0, 'dry before');
  jungle.blast(shore, 1, 5);
  assert.ok(water.depth(shore.x, shore.z) > 0.3, 'water in the crater');
  assert.ok(jungle.groundAt(shore.x, shore.z) < -0.1, 'dug');
  assert.equal(jungle.groundAt(shore.x - 3, shore.z - 3), 0, 'flat beyond');
  assert.ok(jungle.vegetation.uniforms.uBlastRadius.value.includes(5), 'the blast reaches 5 m');
  jungle.reset();
  assert.equal(jungle.groundAt(shore.x, shore.z), 0, 'all as it was');
  assert.equal(water.depth(shore.x, shore.z), 0);
});
