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

test('the floor: puddles and paths of open mud, the banks wet, no puddle in the stream; the plants keep off the open mud', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(15) });
  const { layout, waterDepth } = jungle;
  let puddles = 0, paths = 0, wetBanks = 0, samples = 0;
  for (let x = -11.5; x < 11.5; x += 0.25) for (let z = -8.5; z < 8.5; z += 0.25) {
    samples++;
    if (waterDepth(x, z) > 0) { assert.equal(layout.puddle(x, z), 0, 'no puddle in the stream'); assert.ok(layout.wetness(x, z) > 0.99); continue; }
    if (layout.puddle(x, z) > 0.5) puddles++;
    if (layout.path(x, z) > 0.5) paths++;
    if (layout.wetness(x, z) > 0.5) wetBanks++;
  }
  assert.ok(puddles > samples * 0.01 && puddles < samples * 0.15, `puddles here and there (${puddles} of ${samples})`);
  assert.ok(paths > samples * 0.03, `paths (${paths})`);
  assert.ok(wetBanks > samples * 0.04, `wet banks (${wetBanks})`);
  // Plants: few on the paths and in the puddles, compared with the ground they cover.
  const grass = jungle.vegetation.group.getObjectByName('Jungle grass'), matrix = new THREE.Matrix4(), at = new THREE.Vector3();
  let open = 0, inside = 0;
  for (let i = 0; i < grass.count; i++) {
    grass.getMatrixAt(i, matrix);
    at.setFromMatrixPosition(matrix);
    if (Math.abs(at.x) > 12 || Math.abs(at.z) > 9) continue;
    inside++;
    if (layout.puddle(at.x, at.z) > 0.5 || layout.path(at.x, at.z) > 0.9) open++;
  }
  assert.ok(open < inside * 0.05, `${open} of ${inside} tufts on open mud`);
});

test('the ruins: a lamp before every lit face, on the faces the camera sees; the blocks stand where the squad finds cover', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(16) });
  assert.ok(jungle.lamps.length >= 8, `${jungle.lamps.length} lamps`);
  for (const lamp of jungle.lamps) {
    // In front of a block's +x or +z face: just outside its box, on that side.
    const ruin = jungle.lab.obstacles.find(box => box.kind !== 'wall' && box.kind !== 'rock' && lamp.position.x > box.min.x - 0.6 && lamp.position.x < box.max.x + 0.6 && lamp.position.z > box.min.z - 0.6 && lamp.position.z < box.max.z + 0.6);
    assert.ok(ruin, 'by a ruin');
    assert.ok(lamp.position.x > ruin.max.x || lamp.position.z > ruin.max.z, 'on the side the camera sees');
  }
  const hero = new THREE.Vector3(jungle.start.x, 0, jungle.start.z);
  const cover = jungle.lab.coverSpots(hero);
  assert.ok(cover.length > 3, `cover from the hero behind the blocks (${cover.length} spots)`);
  // The diodes blink.
  jungle.ruins.update(0.3);
  const led = scene.getObjectByName('Ruin diodes').material.color.r;
  jungle.ruins.update(1.1);
  assert.notEqual(scene.getObjectByName('Ruin diodes').material.color.r, led);
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

test('a grenade on the bank: a crater the stream pours into; in the open, the ground dug, the plants within its reach thrown, none beyond', () => {
  const scene = new THREE.Scene();
  const jungle = createJungle(scene, { random: seeded(17) });
  const { water } = jungle;
  // Just off the bank.
  let bank = null;
  for (let z = 3; z < 7 && !bank; z += 0.05) if (water.depth(-1, z) === 0) bank = z;
  const shore = new THREE.Vector3(-1, 0, bank + 0.45);
  assert.equal(water.depth(shore.x, shore.z), 0, 'dry before');
  jungle.blast(shore, 1, 5);
  assert.ok(water.depth(shore.x, shore.z) > 0.3, 'water in the crater');
  assert.ok(jungle.groundAt(shore.x, shore.z) < -0.1, 'dug');
  // In the open: a crater, the plants in it torn up, the blast reaching 5 m and no further.
  const open = new THREE.Vector3(3.6, 0, -2.2);
  assert.equal(jungle.groundAt(open.x, open.z), 0);
  jungle.blast(open, 1, 5);
  assert.ok(jungle.groundAt(open.x, open.z) < -0.12, 'a bowl');
  assert.equal(jungle.groundAt(open.x + 3, open.z), 0, 'flat beyond');
  const radii = jungle.vegetation.uniforms.uBlastRadius.value;
  assert.ok(radii.includes(5), 'the blast reaches 5 m');
  jungle.reset();
  assert.equal(jungle.groundAt(open.x, open.z), 0, 'all as it was');
  assert.equal(water.depth(shore.x, shore.z), 0);
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
