import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena, ARENA } from '../src/arena.js';
import { createBlasters } from '../src/blasters.js';
import { blink } from '../src/kit.js';

function room() {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab });
  return { scene, lab, arena };
}

test('the room closes the deck: walls at the back, a railing along the front edge', () => {
  const { lab, arena } = room();
  const walls = lab.obstacles.filter(box => box.kind === 'wall'), rails = lab.obstacles.filter(box => box.kind === 'rail');
  assert.ok(walls.length >= 4 && rails.length === 2, `${walls.length} walls, ${rails.length} rails`);
  // Walking into the back corner, or off the front edge, he is stopped.
  const back = lab.pushOut(new THREE.Vector3(ARENA.minX + 0.1, 0, ARENA.minZ + 0.1), 0.3);
  assert.ok(back.x > ARENA.minX + 0.3 && back.z > ARENA.minZ + 0.3, `kept off the back walls (${back.x.toFixed(2)}, ${back.z.toFixed(2)})`);
  const edge = lab.pushOut(new THREE.Vector3(0, 0, ARENA.maxZ - 0.1), 0.3);
  assert.ok(edge.z < ARENA.maxZ - 0.2, `kept on the deck (${edge.z.toFixed(2)})`);
  // Nobody takes cover against a wall or a railing.
  const spots = lab.coverSpots(new THREE.Vector3(0, 0, 0), { minDistance: 1 });
  assert.ok(spots.length > 0 && spots.every(spot => spot.box.kind !== 'wall' && spot.box.kind !== 'rail'));
  assert.ok(arena.strips.length >= 4 && arena.grates.length >= 4, 'red strips and grates');
});

test('a bolt strikes the back wall and scorches it there; one flies between the railing bars, over the drop', () => {
  const { scene, lab } = room();
  const blasters = createBlasters(scene, { lab, random: () => 0.5 });
  const events = [];
  blasters.fire(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1));
  for (let i = 0; i < 90; i++) events.push(...blasters.update(1 / 60));
  const impact = events.find(event => event.type === 'impact');
  assert.ok(impact && Math.abs(impact.point.z - ARENA.minZ) < 0.6, `on the wall (${impact?.point.z.toFixed(2)})`);
  events.length = 0;
  blasters.fire(new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 0, 1));
  for (let i = 0; i < 90; i++) events.push(...blasters.update(1 / 60));
  assert.ok(!events.some(event => event.type === 'impact' && event.point.z > ARENA.maxZ - 0.5), 'not stopped by the railing');
});

test('the floor lights blink slowly: fully on and nearly off within a few seconds, never black', () => {
  const values = Array.from({ length: 400 }, (_, i) => blink(i * 0.01));
  assert.ok(Math.max(...values) > 0.97 && Math.min(...values) < 0.2 && Math.min(...values) > 0.15);
  const { arena } = room();
  arena.update(0.3);
  arena.update(2.0);
});
