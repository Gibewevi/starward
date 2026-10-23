import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obstacleQueries } from './lab.js';
import { hash, fbm, createFloorLayout, paintJungleFloor, scatterStones } from './jungle-ground.js';
import { buildRuins } from './jungle-ruins.js';
import { buildWalkways, buildSpeeder, buildCage, buildDish, buildFalls } from './jungle-props.js';
import { createVegetation } from './vegetation.js';
import { createWater } from './water.js';
import { createJungleAir } from './jungle-air.js';
import { createFootprints } from './footprints.js';
import { createTransformer } from './transformer.js';
import {
  MAP, ISLANDS, landAt, waterDepth, zoneAt, slabs, WALKWAYS, DECK, deckAt, pathAt, toSegment, GENERATORS, ruinBlocks,
  CAGE, DISH, SPEEDER, lampPosts, FALLS, POSTS, START, GATE, SHAFTS,
} from './jungle-map.js';

/**
 * Stage 2 — the marsh ruins (the map: jungle-map.js). A flooded jungle of old
 * ruins at night, semi open: from the landing at the entry, the hero goes
 * where he likes — up the walkways, round by the ruin core, or wading through
 * the reeds — to four generators to destroy, each in its core, the last in
 * the command post. Each one blown cuts its zone's light.
 *
 * It answers the game as the lab does (obstacles and their queries, posts
 * for the squad, a floor material, a gate for reinforcements), and adds its
 * own life:
 * - the plants sway in the wind, bend away from whoever goes through, are cut
 *   by the blade, swept by the Force and blown outward by explosions (vegetation.js);
 * - the water ripples under every step, wake and body, splashes; the Force
 *   drives it over the banks; blasts open craters it pours into (water.js);
 * - soles stay pressed into the sand (prints); the walkways' planks take none;
 * - moonlight shafts and lamps light the drifting dust, fireflies (jungle-air.js);
 * - waterfalls pour off the cores' islands (jungle-props.js).
 *
 * The ruins' lamps are many: the stage lends a few real lights to the nearest
 * of them (the rest glow, unlit).
 *
 * step(at, along, side, size, speed) — a foot comes down; cut(a0, b0, a1, b1, speed)
 * — the blade swept; blast(at, power, reach); force(kind, at, direction); bolt(at);
 * landing(at, speed); seen(at) — how visible the hero is there (1 in the open);
 * buildGenerators(effects); sabotaged(generator); update(dt, { time, actors, stirs, focus }).
 */
export const JUNGLE = MAP;
const B = MAP;
/** How many real lights the lamps share (the nearest to the view are lit). */
const LIGHTS = 8;

/**
 * The trail out through the jungle behind the command post, as the game's
 * "door": nothing to slide, but the same promise — open(), close(),
 * openness, an alarm, where men wait (inside), and closed it stops the hero
 * from walking off into the dark.
 */
function createGate(obstacles) {
  const G = GATE, x0 = B.minX - G.depth;
  const shut = { kind: 'wall', min: new THREE.Vector3(B.minX - 0.6, 0, G.z - G.width / 2), max: new THREE.Vector3(B.minX - 0.3, 3, G.z + G.width / 2), centre: new THREE.Vector3(B.minX - 0.45, 1.5, G.z) };
  const door = {
    openness: 0, target: 0, alarm: false, shut, width: G.width,
    centre: new THREE.Vector3(B.minX + 0.2, 0, G.z), out: G.out.clone(), along: new THREE.Vector3(0, 0, 1),
    inside: [new THREE.Vector3(x0 + 0.7, 0, G.z - 0.45), new THREE.Vector3(x0 + 0.7, 0, G.z + 0.45), new THREE.Vector3(x0 + 1.6, 0, G.z - 0.45), new THREE.Vector3(x0 + 1.6, 0, G.z + 0.45)],
    open() { door.target = 1; },
    close() { door.target = 0; },
    reset() { door.target = door.openness = 0; door.alarm = false; if (!obstacles.includes(shut)) obstacles.push(shut); },
    update(dt) {
      const before = door.openness;
      door.openness = THREE.MathUtils.clamp(door.openness + Math.sign(door.target - door.openness) * dt / 1.3, 0, 1);
      const closed = obstacles.includes(shut);
      if (door.openness > 0.6 && closed) obstacles.splice(obstacles.indexOf(shut), 1);
      if (door.openness <= 0.6 && before > door.openness && !closed) obstacles.push(shut);
    },
  };
  Object.defineProperties(door, { isOpen: { get: () => door.openness >= 1 }, isClosed: { get: () => door.openness <= 0 } });
  obstacles.push(shut);
  return door;
}
const ROCKS = [[-6, 12, 0.6], [5.6, 9.6, 0.5], [-9.8, -2, 0.55], [9, -7.5, 0.5], [-3.5, -9, 0.45], [19.5, -6, 0.6], [-19.5, 7, 0.5], [6, 16.5, 0.55], [-2.4, 19, 0.5], [9.6, -20, 0.45]];

export function createJungle(scene, { renderer = null, random = Math.random, night = false } = {}) {
  const group = new THREE.Group();
  group.name = 'Jungle';
  scene.add(group);
  const width = B.maxX - B.minX, length = B.maxZ - B.minZ;

  // ---- Water ---------------------------------------------------------------------
  const water = createWater(scene, { rect: B, depthAt: waterDepth, cell: 0.12, random });
  // The water is not mirrored by the floor below it (the game's camera sees layer 1, the mirror does not).
  water.group.traverse(object => object.layers.set(1));

  // ---- The ground: mud, wet sand, moss, puddles, slabs; what is wet shines -----------------
  // Where explosions dug it (m, below 0 a crater, a little above at its rim).
  const CRATER_CELL = 0.12, CW = Math.ceil(width / CRATER_CELL), CH = Math.ceil(length / CRATER_CELL);
  const craters = new Float32Array(CW * CH);
  const craterTexture = new THREE.DataTexture(craters, CW, CH, THREE.RedFormat, THREE.FloatType);
  craterTexture.magFilter = craterTexture.minFilter = THREE.LinearFilter;
  craterTexture.needsUpdate = true;
  const layout = createFloorLayout({ bounds: B, waterDepth, slabs, paths: pathAt });
  const floor = paintJungleFloor({ bounds: B, waterDepth, slabs, layout, scale: 24, grates: [[-14, -14, 1.6, 1.1], [0.5, 0.5, 1.2, 0.9], [12.5, -14, 1.2, 0.9]] });
  const groundMaterial = new THREE.MeshStandardMaterial({
    name: 'jungle floor', map: floor.map, roughnessMap: floor.roughnessMap, bumpMap: floor.bumpMap, bumpScale: 0.11,
    roughness: 1, metalness: 0.08, envMapIntensity: 0.25,
  });
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.tDepth = { value: water.depthTexture };
    shader.uniforms.time = { value: 0 };
    shader.uniforms.tCrater = { value: craterTexture };
    groundMaterial.userData.shader = shader;
    const rectUv = `/ vec2(${width.toFixed(2)}, ${length.toFixed(2)})`, origin = `vec2(${B.minX.toFixed(2)}, ${B.minZ.toFixed(2)})`;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround; varying float vCrater; uniform sampler2D tCrater;')
      // The craters: the floor dug (its local z is the world's height), its slope for the light.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec2 craterUv = ((modelMatrix * vec4(position, 1.0)).xz - ${origin}) ${rectUv};
        vec2 craterStep = vec2(${(1 / CW).toFixed(6)}, ${(1 / CH).toFixed(6)});
        vCrater = texture2D(tCrater, craterUv).r;
        float craterX = (texture2D(tCrater, craterUv + vec2(craterStep.x, 0.0)).r - texture2D(tCrater, craterUv - vec2(craterStep.x, 0.0)).r) / ${(2 * CRATER_CELL).toFixed(3)};
        float craterZ = (texture2D(tCrater, craterUv + vec2(0.0, craterStep.y)).r - texture2D(tCrater, craterUv - vec2(0.0, craterStep.y)).r) / ${(2 * CRATER_CELL).toFixed(3)};
        objectNormal = normalize(vec3(-craterX, -craterZ, 1.0));`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += vCrater;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGround; varying float vCrater; uniform sampler2D tDepth; uniform float time;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      // Blasted earth: scorched dark in the crater, turned over and lighter on its rim.
      diffuseColor.rgb *= 1.0 - 0.6 * smoothstep(-0.015, -0.13, vCrater);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.15, 0.1), smoothstep(0.004, 0.035, vCrater) * 0.5);
      float under = texture2D(tDepth, (vGround.xz - ${origin}) ${rectUv}).r;
      if (under > 0.01) {
        // The marsh's bed: dark, tinted by the water over it, crossed by the light the ripples gather.
        float caustic = pow(abs(sin(vGround.x * 3.1 + time * 0.9 + sin(vGround.z * 2.7 + time * 0.7)) * sin(vGround.z * 3.4 - time * 0.8 + sin(vGround.x * 2.2))), 6.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.65, 0.7), smoothstep(0.0, 0.5, under)) * (1.0 - 0.35 * under) + vec3(0.025, 0.065, 0.075) * caustic * (1.0 - under * 0.6);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      // Under the water the bed is wet, the surface does the shining.
      roughnessFactor = mix(roughnessFactor, 0.5, step(0.01, under));
      roughnessFactor = mix(roughnessFactor, 0.95, smoothstep(-0.01, -0.06, vCrater) * step(under, 0.01));`);
  };
  // Fine enough for a crater to be dug in it (a vertex every 16 cm).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, length, Math.round(width * 6), Math.round(length * 6)), groundMaterial);
  ground.name = 'Jungle ground';
  ground.rotation.x = -Math.PI / 2;
  // The canvas rows run along +z (flipY off): the plane's v must too.
  ground.scale.y = -1;
  ground.position.set(B.minX + width / 2, -0.005, B.minZ + length / 2);
  ground.receiveShadow = true;
  group.add(ground);
  // What the game mirrors (main.js): the same rectangle, its v along +z, and where it is wet.
  const mirrorGeometry = new THREE.PlaneGeometry(width, length);
  const mirrorUv = mirrorGeometry.attributes.uv;
  for (let i = 0; i < mirrorUv.count; i++) mirrorUv.setY(i, 1 - mirrorUv.getY(i));
  const mirror = { geometry: mirrorGeometry, centre: new THREE.Vector3(B.minX + width / 2, 0, B.minZ + length / 2), roughnessTexture: floor.roughnessMap, craterTexture, size: [width, length] };
  // Beyond the map: dark earth under the jungle, to the horizon.
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshLambertMaterial({ color: 0x10170c }));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = -0.03;
  group.add(beyond);

  // ---- Ruins, walkways, the made things, rocks, and the map's edges (the obstacles) ------------
  const blocks = ruinBlocks();
  // The walls the waterfalls pour over.
  for (const fall of FALLS) {
    const back = fall.at.clone().addScaledVector(fall.facing, -0.75);
    blocks.push([back.x, back.z, 1.5, fall.height + 0.25, 1.5, [], 'wall', zoneAt(back.x, back.z)]);
  }
  const ruins = buildRuins(group, { blocks, posts: lampPosts().map(position => ({ position, zone: zoneAt(position.x, position.z) })), random });
  const obstacles = [...ruins.obstacles], lamps = ruins.lamps;
  buildWalkways(group, WALKWAYS, { deck: DECK, random });
  obstacles.push(buildSpeeder(group, SPEEDER));
  for (const made of [buildCage(group, CAGE), buildDish(group, DISH)]) {
    obstacles.push(made.obstacle);
    lamps.push(made.lamp);
    ruins.zones.get(made.lamp.zone)?.lamps.push(made.lamp);
  }
  const falls = buildFalls(group, FALLS, { random });
  // Rocks: lumpy, dark, wet, mossy on top — in the marsh and by the shores.
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x2e322d, roughness: 0.5, flatShading: true, vertexColors: true });
  for (const [x, z, r] of ROCKS) {
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    const position = geometry.attributes.position, colors = [];
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      p.multiplyScalar(0.8 + 0.4 * hash(p.x * 9 + x, p.z * 9 + z));
      p.y = Math.max(-r * 0.2, p.y * 0.75);
      position.setXYZ(i, p.x, p.y, p.z);
      const top = p.y > r * 0.35;
      colors.push(...(top ? [0.36, 0.55, 0.24] : [0.75 + 0.2 * hash(i, x), 0.78, 0.72]));
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const rock = new THREE.Mesh(geometry, rockMaterial);
    rock.position.set(x, r * 0.2, z);
    rock.rotation.y = random() * Math.PI;
    rock.castShadow = rock.receiveShadow = true;
    group.add(rock);
    obstacles.push({ kind: 'rock', min: new THREE.Vector3(x - r * 0.8, 0, z - r * 0.8), max: new THREE.Vector3(x + r * 0.8, r * 0.8, z + r * 0.8), centre: new THREE.Vector3(x, r * 0.4, z) });
  }
  // The edges: unseen walls (the jungle too thick to go through), but for the
  // trail behind the command post, where the squad's men come from.
  const G = GATE;
  const wall = (x0, z0, x1, z1) => ({ kind: 'wall', min: new THREE.Vector3(x0, 0, z0), max: new THREE.Vector3(x1, 3, z1), centre: new THREE.Vector3((x0 + x1) / 2, 1.5, (z0 + z1) / 2) });
  obstacles.push(
    wall(B.minX - 1, B.minZ - 1, B.maxX + 1, B.minZ), wall(B.minX - 1, B.maxZ, B.maxX + 1, B.maxZ + 1), wall(B.maxX, B.minZ, B.maxX + 1, B.maxZ),
    wall(B.minX - 1, B.minZ, B.minX, G.z - G.width / 2), wall(B.minX - 1, G.z + G.width / 2, B.minX, B.maxZ),
    // The trail's sides and its far end.
    wall(B.minX - G.depth, G.z - G.width / 2 - 0.3, B.minX, G.z - G.width / 2), wall(B.minX - G.depth, G.z + G.width / 2, B.minX, G.z + G.width / 2 + 0.3),
    wall(B.minX - G.depth - 0.3, G.z - G.width / 2, B.minX - G.depth, G.z + G.width / 2),
  );
  const door = createGate(obstacles);
  const queries = obstacleQueries(obstacles);
  // Where things stand, on a grid of 25 cm (for planting fast): the obstacles, the generators and their approaches.
  const OCC = 0.25, OW = Math.ceil(width / OCC), OH = Math.ceil(length / OCC), occupied = new Uint8Array(OW * OH);
  const mark = (x0, z0, x1, z1) => {
    for (let j = Math.max(0, Math.floor((z0 - B.minZ) / OCC)); j <= Math.min(OH - 1, Math.floor((z1 - B.minZ) / OCC)); j++) {
      for (let i = Math.max(0, Math.floor((x0 - B.minX) / OCC)); i <= Math.min(OW - 1, Math.floor((x1 - B.minX) / OCC)); i++) occupied[j * OW + i] = 1;
    }
  };
  for (const box of obstacles) if (box.kind !== 'wall') mark(box.min.x - 0.15, box.min.z - 0.15, box.max.x + 0.15, box.max.z + 0.15);
  for (const g of GENERATORS) mark(g.at.x - 1.6, g.at.z - 1.6, g.at.x + 2.2, g.at.z + 2.2);
  mark(START.x - 1.2, START.z - 1.2, START.x + 1.2, START.z + 1.2);
  const inside = (x, z) => {
    const i = Math.floor((x - B.minX) / OCC), j = Math.floor((z - B.minZ) / OCC);
    return i >= 0 && j >= 0 && i < OW && j < OH && occupied[j * OW + i] === 1;
  };
  const onWalkway = (x, z, margin = 0.2) => WALKWAYS.some(walk => toSegment(x, z, walk.a, walk.b) < walk.width / 2 + margin);

  // ---- Plants -----------------------------------------------------------------------
  // How thick the cover is on each metre (tall plants), for hiding in it.
  const COVER = 1, VW = Math.ceil(width / COVER), VH = Math.ceil(length / COVER), cover = new Float32Array(VW * VH);
  const shelter = (plant, weight) => {
    const i = Math.floor((plant.x - B.minX) / COVER), j = Math.floor((plant.z - B.minZ) / COVER);
    if (i >= 0 && j >= 0 && i < VW && j < VH) cover[j * VW + i] += weight * plant.height;
  };
  const place = kind => {
    const plants = [];
    const target = { grass: 6400, reed: 1700, fern: 1900, broadleaf: 260 }[kind];
    for (let tries = 0; plants.length < target && tries < target * 25; tries++) {
      const x = B.minX + 0.3 + random() * (width - 0.6), z = B.minZ + 0.3 + random() * (length - 0.6);
      if (inside(x, z) || onWalkway(x, z)) continue;
      const wet = waterDepth(x, z), land = landAt(x, z), edge = Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
      // Clumps, thick in the jungle round the marsh; sparse on the slabs, the paths and the puddles left open mud.
      const open = Math.max(layout.path(x, z), layout.puddle(x, z) * 1.5);
      const clump = fbm(x * 0.45 + 3, z * 0.45 - 2) + (edge < 3.5 ? 0.45 : 0) - (slabs(x, z) ? 0.45 : 0) - open * 0.9;
      if (kind === 'reed') {
        // In the shallows and along the shores — thick on the stealth route's side.
        if (wet > 0.55 || land > 0.7) continue;
        if (random() > 0.35 + fbm(x * 0.3 - 7, z * 0.3 + 4) * 0.8 + (x < 0 && z > 0 ? 0.25 : 0)) continue;
        plants.push({ x, z, height: 0.8 + random() * 0.8, size: 0.85 + random() * 0.45 });
      } else if (wet > 0.04) continue;
      else if (kind === 'grass') {
        if (random() > clump * 1.3) continue;
        // Short in the open, tall in the clumps.
        plants.push({ x, z, height: 0.14 + random() * 0.24 + clump * 0.35 * random(), size: 0.75 + random() * 0.6 });
      } else {
        if (random() > clump * 1.1 - 0.2 + (edge < 3 ? 0.5 : 0)) continue;
        if (open > 0.55) continue;
        const grow = edge < 3 ? 1.6 : 1;
        plants.push(kind === 'fern' ? { x, z, height: (0.4 + random() * 0.5) * grow, size: (0.5 + random() * 0.45) * grow } : { x, z, height: (0.4 + random() * 0.45) * grow, size: (0.5 + random() * 0.5) * grow });
      }
    }
    // Beyond the edges, the jungle itself: thick and tall, lower on the near sides so as not to hide the map; the trail kept clear.
    const ring = { grass: 1500, fern: 900, broadleaf: 600 }[kind] ?? 0;
    for (let n = 0, tries = 0; n < ring && tries < ring * 20; tries++) {
      const x = B.minX - 3 + random() * (width + 6), z = B.minZ - 3 + random() * (length + 6);
      if (x > B.minX - 0.1 && x < B.maxX + 0.1 && z > B.minZ - 0.1 && z < B.maxZ + 0.1) continue;
      if (Math.abs(z - G.z) < G.width / 2 + 0.3 && x < B.minX) continue;
      const grow = x > B.maxX || z > B.maxZ ? 0.6 : 1.5, shade = 0.45 + random() * 0.25;
      if (kind === 'grass') plants.push({ x, z, height: 0.5 + random() * 0.6, size: 1 + random() * 0.6, shade });
      else if (kind === 'fern') plants.push({ x, z, height: (0.6 + random() * 0.6) * grow, size: (1 + random() * 0.7) * grow, shade });
      else plants.push({ x, z, height: (0.9 + random() * 0.9) * grow, size: (1 + random() * 0.8) * grow, shade });
      n++;
    }
    for (const plant of plants) shelter(plant, kind === 'grass' ? 0.08 : kind === 'reed' ? 0.5 : 0.6);
    return plants;
  };
  const vegetation = createVegetation(scene, { place, random });
  // The plants are not mirrored by the wet floor (dark, and many: layer 1, which the game's camera and the moon's shadow see).
  vegetation.group.traverse(object => object.layers.set(1));
  const stones = scatterStones(group, { bounds: B, layout, waterDepth, slabs, avoid: (x, z) => inside(x, z) || onWalkway(x, z, 0.4), random, count: 700 });

  // ---- Trees: trunks rising out of the jungle round the marsh, vines hanging -------------------
  const trunks = [], vines = [];
  for (let n = 0, tries = 0; n < 90 && tries < 600; tries++) {
    const x = B.minX - 3 + random() * (width + 6), z = B.minZ - 3 + random() * (length + 6);
    const edge = Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
    // In the jungle band round the map, the near sides kept low (no trunk between the view and the marsh).
    if (edge > 2.2 || x > B.maxX - 4 || z > B.maxZ - 4) continue;
    if (Math.abs(z - G.z) < 2.2 && x < B.minX + 3) continue;
    n++;
    const r = 0.22 + random() * 0.4, tall = 7 + random() * 4;
    const trunk = new THREE.CylinderGeometry(r * 0.7, r * 1.25, tall, 7, 1);
    trunk.translate(x, tall / 2, z);
    trunks.push(trunk);
    // Buttress roots flaring at the foot.
    for (let k = 0; k < 3; k++) {
      const a = random() * Math.PI * 2, root = new THREE.BoxGeometry(0.08, r * 2.4, r * 1.8);
      root.rotateY(a);
      root.translate(x + Math.sin(a) * r * 0.9, r * 1.1, z + Math.cos(a) * r * 0.9);
      trunks.push(root.index ? root.toNonIndexed() : root);
    }
    for (let k = 0; k < 2; k++) {
      const drop = 1.5 + random() * 3.5, at = new THREE.Vector3(x + (random() - 0.5) * 1.6, tall - 1 - random() * 2, z + (random() - 0.5) * 1.6);
      const vine = new THREE.BoxGeometry(0.035, drop, 0.035);
      vine.translate(at.x, at.y - drop / 2, at.z);
      vines.push(vine);
    }
  }
  for (const [geometries, color, name] of [[trunks.map(g => (g.index ? g.toNonIndexed() : g)), 0x2b231a, 'Jungle trunks'], [vines, 0x1e3818, 'Vines']]) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- The real lights, lent to the nearest lamps ---------------------------------------
  const lights = Array.from({ length: LIGHTS }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 6.5, 1.7);
    group.add(light);
    return light;
  });
  const lit = [];
  function lendLights(focus) {
    lit.length = 0;
    for (const lamp of lamps) if (lamp.intensity > 0.05) lit.push(lamp);
    if (focus) lit.sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus));
    lights.forEach((light, i) => {
      const lamp = lit[i];
      if (!lamp) { light.intensity = 0; return; }
      light.position.copy(lamp.position);
      light.color.copy(lamp.color);
      // Faded in by distance, so that one changing hands far off is not seen to.
      const far = focus ? lamp.position.distanceTo(focus) : 0;
      light.intensity = lamp.intensity * THREE.MathUtils.clamp((18 - far) / 4, 0, 1);
    });
  }
  lendLights(null);

  // ---- Air, prints ------------------------------------------------------------------
  const shafts = SHAFTS.map(([x, z, strength]) => {
    const forward = new THREE.Vector3(0.22, -1, 0.12).normalize();
    return { at: new THREE.Vector3(x, 0, z).addScaledVector(forward, -9), forward, length: 10.5, strength };
  });
  const air = createJungleAir(scene, { bounds: B, shafts, lamps, night, random });
  const prints = createFootprints(scene, { max: 900, tint: new THREE.Color(0.1, 0.075, 0.05), linger: [240, 300], name: 'Sand footprints' });

  // ---- The generators (built once the game's effects exist) -----------------------------
  const generators = [];
  function buildGenerators(effects) {
    for (const g of GENERATORS) {
      const t = createTransformer(scene, { lab, effects, at: g.at, facing: g.facing, random });
      Object.assign(t, { name: g.name, label: g.label, zone: g.zone });
      generators.push(t);
    }
    return generators;
  }
  /** A generator blown: its zone's light dies. */
  function sabotaged(generator) { ruins.setZone(generator.zone, 0); }

  // ---- The game's hooks ---------------------------------------------------------------
  const inWater = at => water.depth(at.x, at.z) > 0.05 && deckAt(at.x, at.z) === null;
  /** A foot comes down: a print in the sand, a splash in the water, nothing on the planks. Returns 'water', 'wood' or 'sand'. */
  function step(at, along, side, size, speed = 1.5) {
    if (deckAt(at.x, at.z) !== null) return 'wood';
    if (inWater(at)) { water.splash(at, 0.15 + Math.min(speed, 6) * 0.07); return 'water'; }
    if (!slabs(at.x, at.z)) prints.stamp(at, along, side, 0.85, size);
    return 'sand';
  }
  /** The blade swept: plants in its way are cut; its tip through the water throws it up. Returns plants cut. */
  function cut(a0, b0, a1, b1, speed) {
    const count = vegetation.cut(a0, b0, a1, b1, speed);
    if (speed > 4 && b1.y < water.level + 0.05 && inWater(b1)) water.splash(b1, Math.min(1, speed / 12), b1.clone().sub(b0).setY(0).normalize());
    return count;
  }
  /** How high the ground is at (x, z): a walkway's deck, or below 0 in a crater (m). */
  function groundAt(x, z) {
    const deck = deckAt(x, z);
    if (deck !== null) return deck;
    const i = Math.floor((x - B.minX) / CRATER_CELL), j = Math.floor((z - B.minZ) / CRATER_CELL);
    return i < 0 || j < 0 || i >= CW || j >= CH ? 0 : Math.min(0, craters[j * CW + i]);
  }
  /** Digs a crater at `at`: a bowl `depth` deep, a rim thrown up round it. */
  function dig(at, radius, depth) {
    const reach = radius * 1.4, ci = (at.x - B.minX) / CRATER_CELL, cj = (at.z - B.minZ) / CRATER_CELL, r = reach / CRATER_CELL;
    for (let j = Math.max(0, Math.floor(cj - r)); j <= Math.min(CH - 1, Math.ceil(cj + r)); j++) {
      for (let i = Math.max(0, Math.floor(ci - r)); i <= Math.min(CW - 1, Math.ceil(ci + r)); i++) {
        // A little ragged, not a perfect bowl.
        const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj) * CRATER_CELL / (radius * (0.88 + 0.24 * fbm(i * 0.21, j * 0.21)));
        if (d > 1.4) continue;
        const bowl = d < 1 ? -depth * (1 - d * d) ** 1.4 : 0, rim = depth * 0.3 * Math.exp(-(((d - 1) / 0.2) ** 2));
        const k = j * CW + i;
        craters[k] = THREE.MathUtils.clamp(craters[k] + bowl + rim * (craters[k] < -0.02 ? 0.3 : 1), -0.4, 0.09);
      }
    }
    craterTexture.needsUpdate = true;
  }
  /**
   * A grenade went off at `at`: the plants within its reach thrown outward (the
   * nearer the harder) and torn up where it dug its crater, the stones there
   * blown away; the water heaved — blown open if it went off in it, poured into
   * the crater if that opened on the bank. Returns the crater's radius.
   */
  function blast(at, power = 1, reach = 5) {
    const radius = 0.9 + 0.35 * power, wet = inWater(at);
    if (deckAt(at.x, at.z) === null) dig(at, radius, (wet ? 0.12 : 0.17) * power);
    vegetation.blast(at, 1.6 * power, reach);
    vegetation.uproot(at, radius * 0.95);
    stones.clear(at, radius);
    water.disturb(at.x, at.z, Math.min(3, reach * 0.6), 0.05 * power);
    if (wet) water.splash(at, 2 * power);
    water.crater(at, radius);
    return radius;
  }
  /**
   * The Force from the hero at `at` along `direction`: through the plants and the
   * water in its cone — a push drives them out, a pull draws them in — and the
   * dust in the air with them.
   */
  const forceStirs = [];
  function force(kind, at, direction, { range = 6, cone = 0.95 } = {}) {
    const push = kind === 'push', dir = direction.clone().setY(0).normalize();
    vegetation.gust(at, dir, { range: range * 1.15, cone: cone + 0.1, power: push ? 1.5 : -1.15 });
    water.shove(at, dir, { range: range * 1.2, cone: cone + 0.1, power: push ? 1 : -0.85 });
    for (let n = 1; n <= 5; n++) forceStirs.push({ at: at.clone().addScaledVector(dir, n * range / 5).setY(0.9), speed: push ? 9 : 6, life: 0.25 + n * 0.05 });
  }
  /** A bolt into the floor at `at`: into the water, a splash. True if it was water. */
  function bolt(at) { if (!inWater(at)) return false; water.splash(at, 0.45); return true; }
  /** A body landing at `at`: in the water, a big splash. */
  function landing(at, speed) { if (inWater(at)) water.splash(at, THREE.MathUtils.clamp(speed / 5, 0.4, 1.6)); }
  /**
   * How visible the hero is at `at` (1 in the open): down in the water, in among
   * the reeds and ferns, a trooper sees him only closer.
   */
  function seen(at) {
    const i = Math.floor((at.x - B.minX) / COVER), j = Math.floor((at.z - B.minZ) / COVER);
    const thick = i >= 0 && j >= 0 && i < VW && j < VH ? cover[j * VW + i] : 0;
    const wading = deckAt(at.x, at.z) === null ? THREE.MathUtils.smoothstep(water.depth(at.x, at.z), 0.15, 0.6) : 0;
    return Math.min(1 - 0.4 * wading, 1 - 0.45 * THREE.MathUtils.smoothstep(thick, 0.8, 3));
  }
  /** What glints on the water: the lights burning now (the blade, a blast), then the lamps lit nearest the view. */
  function glints(dynamic) {
    water.setGlints([...dynamic.filter(light => light.intensity > 0.05), ...lit].slice(0, 6).map(light => ({ position: light.position, color: light.color, intensity: Math.min(2.5, light.intensity / 5) })));
  }
  function update(dt, { time = 0, actors = [], stirs = [], fog = null, lights: dynamic = [], focus = null } = {}) {
    ruins.update(time, dt);
    lendLights(focus);
    glints(dynamic);
    if (groundMaterial.userData.shader) groundMaterial.userData.shader.uniforms.time.value = time;
    vegetation.update(dt, { time, pushers: actors });
    water.update(dt, { time, fog, focus, waders: actors.filter(actor => actor.wades !== false && deckAt(actor.x, actor.z) === null) });
    falls.update(dt, time, water);
    for (let n = forceStirs.length - 1; n >= 0; n--) if ((forceStirs[n].life -= dt) <= 0) forceStirs.splice(n, 1);
    air.update(dt, { time, stirs: forceStirs.length ? [...stirs, ...forceStirs] : stirs });
    prints.update(dt);
  }
  function reset() {
    vegetation.reset(); water.reset(); prints.clear(); door.reset(); craters.fill(0); craterTexture.needsUpdate = true; stones.reset(); forceStirs.length = 0;
    for (const zone of ruins.zones.keys()) ruins.setZone(zone, 1);
  }

  const lab = { group, obstacles, lights: lamps, floorLights: { spots: [] }, markings: [], update() {}, ...queries };
  let lastTime = null;
  const arena = {
    group: new THREE.Group(), obstacles: [], floorLights: [], grates: [], lights: [], door, bounds: B,
    update(time) { door.update(lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime))); lastTime = time; },
  };
  const stage = { floor: ground, material: groundMaterial, roughnessTexture: null, bounds: B, update() {} };
  /** For the squad's way-finding: the marsh is slow going (they keep to the walkways and the islands). */
  const navCost = point => (deckAt(point.x, point.z) !== null ? 1 : 1 + 4 * waterDepth(point.x, point.z));
  return {
    bounds: B, night, start: START, lab, arena, stage, mirror, layout, posts: POSTS, vegetation, water, air, prints, lamps, lights, ruins, falls,
    generators, buildGenerators, sabotaged, navCost, islands: ISLANDS,
    step, cut, blast, force, groundAt, bolt, landing, seen, update, reset, inWater, waterDepth, slabs,
  };
}

/**
 * Night under the canopy, from the lab's lighting: dark, the light where it
 * burns — a cold moon picking out the edges, a dim blue-green sky, earth
 * below; the ruins' amber lamps, the blade and the blasts provide local
 * colour. A faint cold fill preserves the hero's silhouette.
 */
export function jungleLighting(scene, lighting, { night = false } = {}) {
  scene.background = new THREE.Color(night ? 0x020406 : 0x061015);
  scene.fog = new THREE.FogExp2(night ? 0x04080b : 0x0c1c22, night ? 0.03 : 0.023);
  scene.environmentIntensity = night ? 0.08 : 0.22;
  scene.traverse(object => {
    if (!object.isHemisphereLight) return;
    object.color.set(night ? 0x2b3a58 : 0x668892);
    object.groundColor.set(night ? 0x09090d : 0x29251f);
    object.intensity = night ? 0.42 : 1.15;
  });
  lighting.keyLight.color.set(night ? 0x7d95c4 : 0xa9bfdc);
  lighting.keyLight.intensity = night ? 0.5 : 3.1;
  lighting.keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(lighting.keyLight.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  lighting.keyLight.shadow.camera.updateProjectionMatrix();
  // The plants (layer 1) cast their shadows in the moonlight.
  lighting.keyLight.shadow.camera.layers.enable(1);
  lighting.rimLight.color.set(0x6b9693);
  lighting.rimLight.intensity = night ? 0.3 : 0.8;
  lighting.whiteStrip.intensity = night ? 0.2 : 0.7;
  lighting.whiteStrip.color.set(0x9fc2c8);
  lighting.redStrip.intensity = 0;
}
