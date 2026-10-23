import * as THREE from 'three';
import { hash, valueNoise, fbm } from './jungle-ground.js';

/**
 * Stage 2 — the marsh ruins: the map. A flooded jungle of old ruins, seen in
 * the game's iso view (screen up is the world's −x −z, screen right +x −z):
 *
 * - at the bottom of the screen the ENTRY, a landing ground where a cargo
 *   speeder stands, the hero's start;
 * - in the middle the CENTRE island, ruins round a plaza, its generator;
 * - on the left the MARSH CORE island (generator 1), a waterfall off its edge;
 * - on the right the RUIN CORE island (generator 2), another waterfall;
 * - at the top the COMMAND POST: a walled plateau, a gate flanked by red
 *   banners, a prison cage, a comms dish — and the last generator inside.
 *
 * Between them the marsh: water everywhere the islands are not, crossed by
 * wooden walkways on stilts — the main route straight up from the entry
 * through the centre to the command post; an alternate route round the
 * right, by the ruin core; and no walkway at all on the left: the stealth
 * route, wading through the reeds to the marsh core.
 *
 * Everything here is data and the shape of the land: islands (where it is
 * dry), the water's depth, the walkways, the paths, the ruins' blocks, the
 * lamps, the generators, the squad's posts and rounds.
 */
export const MAP = { minX: -24, maxX: 24, minZ: -24, maxZ: 24, height: 6, drop: 0 };
const B = MAP;
const v = (x, z) => new THREE.Vector3(x, 0, z);
/** Towards the camera, and so the way the generators' fronts face. */
const FRONT = new THREE.Vector3(1, 0, 1).normalize();

// ---- The land ----------------------------------------------------------------------------
export const ISLANDS = [
  { zone: 'entry', x: 15, z: 15, r: 7.5 },
  { zone: 'centre', x: 0.5, z: 0.5, r: 5 },
  { zone: 'marsh', x: -14, z: 12.5, r: 6 },
  { zone: 'ruin', x: 12.5, z: -14, r: 6 },
  { zone: 'command', x: -14, z: -14, r: 8 },
  // Islets: stepping stones of the walkways, and cover on the way through the marsh.
  { zone: 'entry', x: 16, z: 1.8, r: 2.2 },
  { zone: 'ruin', x: 0.6, z: -14.4, r: 2.3 },
  { zone: 'centre', x: -6.4, z: 6.2, r: 1.8 },
  { zone: 'marsh', x: -1.5, z: 15.5, r: 1.9 },
  { zone: 'marsh', x: -18, z: 1, r: 1.7 },
];
/** How far inside the land a point is (m; below 0, out in the water). */
export function landAt(x, z) {
  let best = -Infinity;
  for (const island of ISLANDS) {
    const dx = x - island.x, dz = z - island.z, angle = Math.atan2(dz, dx);
    // A ragged shore.
    const r = island.r * (0.9 + 0.18 * valueNoise(Math.cos(angle) * 2.2 + island.x, Math.sin(angle) * 2.2 + island.z));
    best = Math.max(best, r - Math.hypot(dx, dz));
  }
  // The jungle round the marsh: dry ground from a little inside the map's edge.
  const edge = Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z) - (2.6 + 1.2 * fbm(x * 0.2, z * 0.2));
  return Math.max(best, -edge);
}
/** How deep the water is (0 dry → 1 at the deepest, a metre and a half out from the shore). */
export function waterDepth(x, z) {
  const land = landAt(x, z);
  return land >= 0 ? 0 : Math.min(1, -land / 1.6);
}
/** The zone a point belongs to: the nearest island's. */
export function zoneAt(x, z) {
  let best = null, bestD = Infinity;
  for (const island of ISLANDS) {
    const d = Math.hypot(x - island.x, z - island.z) - island.r;
    if (d < bestD) { bestD = d; best = island.zone; }
  }
  return best;
}
/** Old stone slabs: the plazas of the ruins. */
const PLAZAS = [[0.5, 0.5, 3.6], [-14, 12.5, 4.2], [12.5, -14, 4.2], [-14, -14, 6]];
export const slabs = (x, z) => PLAZAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r * (0.9 + 0.2 * valueNoise(x * 0.7, z * 0.7)));

// ---- The walkways and paths --------------------------------------------------------------------
/** Wooden walkways on stilts over the water: from a to b, this wide. */
export const WALKWAYS = [
  // The main route: entry → centre → command post.
  { a: v(10.6, 10.6), b: v(4.2, 4.2), width: 1.7 },
  { a: v(-3.1, -3.1), b: v(-8.6, -8.6), width: 1.7 },
  // The alternate route: entry → islet → ruin core → islet → command post.
  { a: v(18, 8.4), b: v(16.6, 3.6), width: 1.5 },
  { a: v(15.6, 0), b: v(13.6, -8.2), width: 1.5 },
  { a: v(6.8, -14.2), b: v(2.7, -14.4), width: 1.5 },
  { a: v(-1.5, -14.4), b: v(-6.3, -14.2), width: 1.5 },
  // The marsh core to the centre, by its islet.
  { a: v(-9.4, 8.7), b: v(-7.7, 7.3), width: 1.4 },
  { a: v(-5.1, 5.1), b: v(-3.4, 3.8), width: 1.4 },
];
/** The trodden paths on the islands: [from, to] (bare wet sand, the plants keep off). */
export const PATHS = [
  [v(18, 19.5), v(10.6, 10.6)], [v(18, 19.5), v(18, 8.4)], [v(16.6, 3.6), v(15.6, 0)],
  [v(4.2, 4.2), v(-3.1, -3.1)], [v(0.5, 0.5), v(-3.4, 3.8)], [v(0.5, 0.5), v(2.6, -1.4)],
  [v(-9.4, 8.7), v(-14, 12.5)], [v(-14, 12.5), v(-14.6, 10.2)],
  [v(13.6, -8.2), v(12.5, -14)], [v(12.5, -14), v(6.8, -14.2)], [v(2.7, -14.4), v(-1.5, -14.4)],
  [v(-8.6, -8.6), v(-14, -14)], [v(-6.3, -14.2), v(-14, -14)], [v(-14, -14), v(-23.5, -14)],
];
/** Distance from (x, z) to the segment a b, on the ground. */
export function toSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
/** On a walkway's deck: its height (m), or null. */
export function deckAt(x, z) {
  for (const walk of WALKWAYS) if (toSegment(x, z, walk.a, walk.b) < walk.width / 2) return DECK;
  return null;
}
export const DECK = 0.06;
/** How much a point is on a trodden path (0 → 1). */
export const pathAt = (x, z) => PATHS.reduce((best, [a, b]) => Math.max(best, 1 - THREE.MathUtils.smoothstep(toSegment(x, z, a, b), 0.55, 1.1)), 0);

// ---- The generators ---------------------------------------------------------------------
/** The four generators, each in its core: where it stands (its front to the view), and the zone it powers. */
export const GENERATORS = [
  { name: 'marsh', label: 'CŒUR DU MARAIS', at: v(-15.4, 11.1), zone: 'marsh' },
  { name: 'ruin', label: 'CŒUR DES RUINES', at: v(11.2, -15.4), zone: 'ruin' },
  { name: 'centre', label: 'CŒUR CENTRAL', at: v(2.4, -2.4), zone: 'centre' },
  { name: 'command', label: 'POSTE DE COMMANDEMENT', at: v(-17, -17), zone: 'command' },
].map(generator => ({ ...generator, facing: FRONT.clone() }));

// ---- The ruins: blocks [x, z, width (x), height, depth (z), lit faces, kind, zone] ---------
/**
 * The ruins round each island: a ring of blocks along its shore, open where
 * a walkway or a path comes in; a few pillars standing tall; cover in the
 * plazas; the core behind each generator; the command post's walls, gate and
 * towers. Made from the map, the same every time (`seed`).
 */
export function ruinBlocks(seed = 7) {
  let s = seed;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const blocks = [];
  const openings = [...WALKWAYS.flatMap(walk => [walk.a, walk.b]), ...PATHS.flat(), v(-23.5, -14)];
  const clearOf = (x, z, w, d, margin = 0.5) => !blocks.some(([bx, bz, bw, , bd]) => Math.abs(bx - x) < (bw + w) / 2 + margin && Math.abs(bz - z) < (bd + d) / 2 + margin);
  const keepClear = (x, z, reach) => openings.some(point => Math.hypot(point.x - x, point.z - z) < reach)
    || WALKWAYS.some(walk => toSegment(x, z, walk.a, walk.b) < walk.width / 2 + 0.9)
    || PATHS.some(([a, b]) => toSegment(x, z, a, b) < 1.2)
    || GENERATORS.some(g => Math.hypot(g.at.x - x, g.at.z - z) < 2.6);
  // The cores: a tall block behind each generator, lit red on the faces the camera sees.
  for (const g of GENERATORS) {
    const back = g.at.clone().addScaledVector(g.facing, -1.25);
    blocks.push([back.x, back.z, 1.5, 3.4, 1.5, ['+x', '+z'], 'core', g.zone]);
  }
  // The rings of blocks along the big islands' shores.
  for (const island of ISLANDS.filter(island => island.r >= 5)) {
    const ring = island.r - 1.1, count = Math.round(ring * 2.1);
    for (let n = 0; n < count; n++) {
      const angle = (n / count) * Math.PI * 2 + random() * 0.25;
      const x = island.x + Math.cos(angle) * ring, z = island.z + Math.sin(angle) * ring;
      if (keepClear(x, z, 2.4) || landAt(x, z) < 0.4) continue;
      const tall = random() < 0.25, w = 1 + random() * 0.9, d = 1 + random() * 0.9, h = tall ? 2.6 + random() * 1.8 : 0.9 + random() * 0.8;
      if (!clearOf(x, z, w, d, 0.15)) continue;
      // Lit on a face the camera sees, now and then.
      const lit = random() < 0.35 ? [random() < 0.5 ? '+x' : '+z'] : [];
      blocks.push([x, z, w, h, d, lit, tall ? 'wall' : 'block', island.zone]);
    }
    // Cover in the plaza.
    for (let n = 0; n < Math.round(island.r * 0.7); n++) {
      const angle = random() * Math.PI * 2, reach = random() * (island.r - 2.4);
      const x = island.x + Math.cos(angle) * reach, z = island.z + Math.sin(angle) * reach;
      const w = 0.75 + random() * 0.6;
      if (keepClear(x, z, 1.6) || !clearOf(x, z, w, w, 0.9)) continue;
      blocks.push([x, z, w, 0.8 + random() * 0.4, w, random() < 0.2 ? ['+z'] : [], 'crate', island.zone]);
    }
  }
  // The command post: its gate's two towers (banners), its back wall, the prison cage.
  blocks.push([-10.9, -8.2, 1.3, 4.6, 1.3, ['+z'], 'tower', 'command'], [-8.2, -10.9, 1.3, 4.6, 1.3, ['+x'], 'tower', 'command']);
  for (const [x, z, w, d] of [[-20.6, -9, 1.4, 4.2], [-20.6, -18.6, 1.4, 4.2], [-9, -20.6, 4.2, 1.4], [-18.6, -20.6, 4.2, 1.4]]) blocks.push([x, z, w, 3 + random() * 0.8, d, [], 'wall', 'command']);
  return blocks;
}
/** The prison cage, and the comms dish's base, at the command post. */
export const CAGE = { x: -19.2, z: -13.6, w: 2.6, d: 2.2, h: 2.3 };
export const DISH = { x: -12.2, z: -19.6 };
/** The cargo speeder the hero came in on: a box to take cover behind. */
export const SPEEDER = { x: 20.2, z: 15.2, w: 3.2, h: 1.6, d: 1.9 };

// ---- Lamps on posts along the walkways and paths ---------------------------------------------
export function lampPosts() {
  const posts = [];
  for (const walk of WALKWAYS) {
    const along = walk.b.clone().sub(walk.a), length = along.length();
    along.divideScalar(length);
    const side = new THREE.Vector3(-along.z, 0, along.x);
    for (let t = 1.2, k = 0; t < length - 0.6; t += 3.6, k++) posts.push(walk.a.clone().addScaledVector(along, t).addScaledVector(side, (k % 2 ? 1 : -1) * (walk.width / 2 + 0.12)));
  }
  for (const [a, b] of PATHS) {
    const along = b.clone().sub(a), length = along.length();
    if (length < 3) continue;
    along.divideScalar(length);
    const side = new THREE.Vector3(-along.z, 0, along.x);
    for (let t = 2, k = 1; t < length - 1; t += 5, k++) posts.push(a.clone().addScaledVector(along, t).addScaledVector(side, (k % 2 ? 1 : -1) * 1.15));
  }
  // None in the water, none in a wall.
  return posts.filter(point => waterDepth(point.x, point.z) < 0.6 || deckAt(point.x, point.z) !== null || WALKWAYS.some(walk => toSegment(point.x, point.z, walk.a, walk.b) < walk.width / 2 + 0.3));
}

// ---- The waterfalls ----------------------------------------------------------------------
/** Off the marsh core's far side, and the ruin core's: where the water falls from, and its fall's facing. */
export const FALLS = [
  { at: v(-20.4, 16.6), facing: new THREE.Vector3(0.55, 0, 0.84).normalize(), width: 1.6, height: 3.2 },
  { at: v(17.6, -19.2), facing: new THREE.Vector3(0.84, 0, 0.55).normalize(), width: 1.4, height: 3 },
];

// ---- The squad --------------------------------------------------------------------------------
const route = (...points) => ({ position: points[0], route: points });
/** The men posted round the map: sentries (a heading) and rounds, by zone. */
export const POSTS = [
  // On the main walkway, and at the alternate route's start.
  route(v(9.4, 9.4), v(5.2, 5.2), v(1.8, 1.4), v(5.2, 5.2)),
  { position: v(17.2, 6.4), heading: -2.6 },
  // The centre.
  { position: v(-1.6, -0.6), heading: 0.8 },
  { position: v(3.4, 1.2), heading: 2.3 },
  route(v(-1.2, 3.6), v(-4.8, 5.4), v(-6.6, 6.4), v(-4.8, 5.4)),
  // The marsh core.
  { position: v(-12.4, 10.2), heading: 0.9 },
  { position: v(-15.6, 14.6), heading: 0.4 },
  route(v(-11.2, 13.8), v(-13.8, 15.9), v(-17.2, 12.6), v(-14.4, 9.2)),
  // The ruin core.
  { position: v(10.4, -12.2), heading: 0.7 },
  { position: v(14.2, -16.2), heading: 0.9 },
  route(v(13.9, -9.6), v(9.2, -11.6), v(8.8, -15.6), v(12.2, -17.6)),
  // The command post: the gate, inside, the cage, a round.
  { position: v(-9.6, -10.8), heading: 0.8 },
  { position: v(-14.6, -13.2), heading: 0.8 },
  { position: v(-17.6, -12.2), heading: 1.4 },
  route(v(-12, -16.8), v(-16.4, -18.4), v(-18.4, -15.6), v(-15.2, -11)),
];
for (const post of POSTS) post.heading ??= Math.atan2(post.route[1].x - post.route[0].x, post.route[1].z - post.route[0].z);

/** The hero's start, by the speeder at the entry, facing up the main route. */
export const START = { x: 17.6, z: 18.8, heading: Math.atan2(-1, -1) };
/** The way reinforcements come: through the jungle behind the command post (the map's west edge). */
export const GATE = { x: B.minX, z: -14, width: 2, depth: 3.6, out: new THREE.Vector3(1, 0, 0) };

/** Moonlight shafts through gaps in the canopy, over the marsh. */
export const SHAFTS = [[-6, -2, 1], [5, 6, 0.8], [11, -6, 1], [-10, 6, 0.7], [-4, 15, 0.9], [8, 14, 0.7], [-12, -6, 0.8], [3, -10, 0.9], [-19, 4, 0.6], [18, -2, 0.7], [-2, -19, 0.6], [12, 20, 0.5]];

export { hash };
