import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obstacleQueries } from './lab.js';
import { hash, valueNoise, fbm, createFloorLayout, paintJungleFloor, scatterStones } from './jungle-ground.js';
import { buildRuins } from './jungle-ruins.js';
import { createVegetation } from './vegetation.js';
import { createWater } from './water.js';
import { createJungleAir } from './jungle-air.js';
import { createFootprints } from './footprints.js';

/**
 * Level 2 — the jungle: for now a rectangle of it, to try the physics, the
 * new models and the fight in. Night under the canopy: wet sand and dark
 * earth, old stone slabs where ruins stood, a clear turquoise stream winding
 * across with pools, mossy ruin blocks still lit by warm strips of light,
 * rocks, and plants everywhere — grass of every height, ferns, broad leaves,
 * reeds along the water — all of it moving.
 *
 * It answers the game as the lab does (obstacles and their queries, posts
 * for the squad, a floor material), and adds its own life:
 * - the plants sway in the wind, bend away from whoever goes through, are cut
 *   by the blade and blown outward by explosions (vegetation.js);
 * - the water ripples under every step, wake and body, splashes (water.js);
 * - soles stay pressed into the sand (prints);
 * - moonlight shafts and lamps light the drifting dust, fireflies (jungle-air.js).
 *
 * step(at, along, side, size, speed) — a foot comes down; cut(a0, b0, a1, b1, speed)
 * — the blade swept; blast(at, power); bolt(at); landing(at, speed);
 * update(dt, { time, actors, stirs }).
 */
export const JUNGLE = { minX: -12, maxX: 12, minZ: -9, maxZ: 9, height: 6, drop: 0 };
const B = JUNGLE;

// ---- The lie of the land ---------------------------------------------------------------
/** The stream's middle line at x, its half width, and the pools: how deep the water is (0 dry → 1). */
function waterDepth(x, z) {
  const centre = 3.2 + Math.sin(x * 0.32) * 1.4 + Math.sin(x * 0.81 + 1.3) * 0.5;
  const half = 1.25 + 0.45 * Math.sin(x * 0.53 + 2) + 0.25 * valueNoise(x * 0.8, 9);
  let depth = 1 - Math.abs(z - centre) / half;
  for (const [px, pz, r] of [[6.5, 6.4, 2.3], [-8, -0.4, 1.4], [-2.2, 6.6, 1.3]]) depth = Math.max(depth, 1 - Math.hypot(x - px, z - pz) / (r * (0.9 + 0.2 * valueNoise(x * 1.1, z * 1.1))));
  return Math.max(0, Math.min(1, depth * 1.6));
}
/** Old stone slabs where the ruins stood: the back of the clearing. */
const slabs = (x, z) => (z < -4.6 && x < 6) || (x < -8.4 && z < 2);

/** The trail out of the clearing, between the back wall's pillars at x 2.4 and 5.6: x, width, how far back it goes. */
const PASSAGE = { x: 4, width: 1.9, end: -11.8 };
/**
 * The trail as the game's "door": nothing to slide, but the same promise —
 * open(), close(), openness, an alarm, where men wait (inside), and closed it
 * stops the hero from walking off into the dark.
 */
function createPassage(obstacles) {
  const P = PASSAGE, mouth = B.minZ + 0.2;
  const shut = { kind: 'wall', min: new THREE.Vector3(P.x - P.width / 2, 0, B.minZ - 0.6), max: new THREE.Vector3(P.x + P.width / 2, 3, B.minZ - 0.3), centre: new THREE.Vector3(P.x, 1.5, B.minZ - 0.45) };
  const door = {
    openness: 0, target: 0, alarm: false, shut, width: P.width,
    centre: new THREE.Vector3(P.x, 0, mouth), out: new THREE.Vector3(0, 0, 1), along: new THREE.Vector3(1, 0, 0),
    inside: [new THREE.Vector3(P.x - 0.45, 0, P.end + 0.7), new THREE.Vector3(P.x + 0.45, 0, P.end + 0.7), new THREE.Vector3(P.x - 0.45, 0, P.end + 1.6), new THREE.Vector3(P.x + 0.45, 0, P.end + 1.6)],
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
const ROCKS = [[-3, 2.1, 0.55], [2.1, 4.6, 0.45], [10.2, 2.6, 0.6], [-9.6, 4.2, 0.55], [6.4, 8.2, 0.4], [-1, -3.8, 0.4], [8.3, 4, 0.35]];

export function createJungle(scene, { renderer = null, random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'Jungle';
  scene.add(group);
  const width = B.maxX - B.minX, length = B.maxZ - B.minZ;

  // ---- Water ---------------------------------------------------------------------
  const water = createWater(scene, { rect: B, depthAt: waterDepth, random });
  // The water is not mirrored by the floor below it (the game's camera sees layer 1, the mirror does not).
  water.group.traverse(object => object.layers.set(1));

  // ---- The ground: mud, wet sand, moss, puddles, slabs; what is wet shines -----------------
  const layout = createFloorLayout({ bounds: B, waterDepth, slabs });
  const floor = paintJungleFloor({ bounds: B, waterDepth, slabs, layout });
  const groundMaterial = new THREE.MeshStandardMaterial({
    name: 'jungle floor', map: floor.map, roughnessMap: floor.roughnessMap, bumpMap: floor.bumpMap, bumpScale: 1.2,
    roughness: 1, metalness: 0, envMapIntensity: 0.12,
  });
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.tDepth = { value: water.depthTexture };
    shader.uniforms.time = { value: 0 };
    groundMaterial.userData.shader = shader;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGround; uniform sampler2D tDepth; uniform float time;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float under = texture2D(tDepth, (vGround.xz - vec2(${B.minX.toFixed(2)}, ${B.minZ.toFixed(2)})) / vec2(${width.toFixed(2)}, ${length.toFixed(2)})).r;
      if (under > 0.01) {
        // The stream's bed: dark, tinted by the water over it, crossed by the light the ripples gather.
        float caustic = pow(abs(sin(vGround.x * 3.1 + time * 0.9 + sin(vGround.z * 2.7 + time * 0.7)) * sin(vGround.z * 3.4 - time * 0.8 + sin(vGround.x * 2.2))), 6.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.35, 0.6, 0.58), smoothstep(0.0, 0.5, under)) * (1.0 - 0.45 * under) + vec3(0.06, 0.16, 0.15) * caustic * (1.0 - under * 0.6);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      // Under the water the bed is wet, the surface does the shining.
      roughnessFactor = mix(roughnessFactor, 0.5, step(0.01, under));`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, length), groundMaterial);
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
  const mirror = { geometry: mirrorGeometry, centre: new THREE.Vector3(B.minX + width / 2, 0, B.minZ + length / 2), roughnessTexture: floor.roughnessMap, size: [width, length] };
  // Beyond the clearing: dark earth under the jungle, to the horizon.
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: 0x10170c }));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = -0.03;
  group.add(beyond);

  // ---- Ruins, rocks, and the edges of the clearing (the obstacles) --------------------------
  const ruins = buildRuins(group, { random });
  const obstacles = [...ruins.obstacles], lamps = ruins.lamps;
  // Rocks: lumpy, dark, wet, mossy on top.
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
  // trail between two pillars of the back wall, where the squad's men come from.
  const P = PASSAGE;
  const wall = (x0, z0, x1, z1) => ({ kind: 'wall', min: new THREE.Vector3(x0, 0, z0), max: new THREE.Vector3(x1, 3, z1), centre: new THREE.Vector3((x0 + x1) / 2, 1.5, (z0 + z1) / 2) });
  obstacles.push(
    wall(B.minX - 1, B.minZ - 1, P.x - P.width / 2, B.minZ), wall(P.x + P.width / 2, B.minZ - 1, B.maxX + 1, B.minZ),
    wall(B.minX - 1, B.maxZ, B.maxX + 1, B.maxZ + 1), wall(B.minX - 1, B.minZ, B.minX, B.maxZ), wall(B.maxX, B.minZ, B.maxX + 1, B.maxZ),
    // The trail's sides and its far end.
    wall(P.x - P.width / 2 - 0.3, P.end, P.x - P.width / 2, B.minZ), wall(P.x + P.width / 2, P.end, P.x + P.width / 2 + 0.3, B.minZ), wall(P.x - P.width / 2, P.end - 0.3, P.x + P.width / 2, P.end),
  );
  const door = createPassage(obstacles);
  const queries = obstacleQueries(obstacles);
  const inside = (x, z, margin = 0.25) => obstacles.some(box => box.kind !== 'wall' && x > box.min.x - margin && x < box.max.x + margin && z > box.min.z - margin && z < box.max.z + margin);

  // ---- Plants -----------------------------------------------------------------------
  const place = kind => {
    const plants = [];
    const target = { grass: 2500, reed: 280, fern: 600, broadleaf: 40 }[kind];
    for (let tries = 0; plants.length < target && tries < target * 30; tries++) {
      const x = B.minX + 0.3 + random() * (width - 0.6), z = B.minZ + 0.3 + random() * (length - 0.6);
      const wet = waterDepth(x, z), edge = Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
      if (inside(x, z, kind === 'grass' ? 0.12 : 0.3)) continue;
      // Clumps, thicker towards the edges of the clearing; sparse on the slabs, the paths and the puddles left open mud.
      const open = Math.max(layout.path(x, z), layout.puddle(x, z) * 1.5);
      const clump = fbm(x * 0.45 + 3, z * 0.45 - 2) + (edge < 2.2 ? 0.35 : 0) - (slabs(x, z) ? 0.35 : 0) - open * 0.9;
      if (kind === 'reed') {
        if (wet > 0.32 || (wet === 0 && layout.toWater(x, z) > 0.6)) continue;
        plants.push({ x, z, height: 0.9 + random() * 0.75, size: 0.9 + random() * 0.4 });
      } else if (wet > 0.04) continue;
      else if (kind === 'grass') {
        if (random() > clump * 1.3) continue;
        // Short in the open, tall in the clumps.
        plants.push({ x, z, height: 0.18 + random() * 0.35 + clump * 0.6 * random(), size: 0.7 + random() * 0.6 });
      } else {
        if (random() > clump * 1.1 - 0.2 + (edge < 2 ? 0.4 : 0)) continue;
        plants.push(kind === 'fern' ? { x, z, height: 0.4 + random() * 0.55, size: 0.6 + random() * 0.55 } : { x, z, height: 0.45 + random() * 0.4, size: 0.5 + random() * 0.35 });
      }
    }
    // Beyond the edges, the jungle itself: thick and tall at the back, lower on
    // the near sides so as not to hide the clearing; the trail kept clear.
    const ring = { grass: 1300, fern: 420, broadleaf: 220 }[kind] ?? 0;
    for (let n = 0, tries = 0; n < ring && tries < ring * 20; tries++) {
      const x = B.minX - 3 + random() * (width + 8), z = B.minZ - 3 + random() * (length + 8);
      if (x > B.minX - 0.1 && x < B.maxX + 0.1 && z > B.minZ - 0.1 && z < B.maxZ + 0.1) continue;
      if (Math.abs(x - PASSAGE.x) < PASSAGE.width / 2 + 0.3 && z < B.minZ) continue;
      const grow = x > B.maxX || z > B.maxZ ? 0.75 : 1.5;
      const shade = 0.45 + random() * 0.25;
      if (kind === 'grass') plants.push({ x, z, height: 0.5 + random() * 0.6, size: 1 + random() * 0.6, shade });
      else if (kind === 'fern') plants.push({ x, z, height: (0.6 + random() * 0.6) * grow, size: (1 + random() * 0.7) * grow, shade });
      else plants.push({ x, z, height: (0.9 + random() * 0.9) * grow, size: (1 + random() * 0.8) * grow, shade });
      n++;
    }
    return plants;
  };
  const vegetation = createVegetation(scene, { place, random });
  scatterStones(group, { bounds: B, layout, waterDepth, slabs, avoid: (x, z) => inside(x, z, 0.1), random });

  // ---- Trees: trunks rising out of the jungle behind the far sides, vines hanging --------------
  const trunks = [], vines = [];
  for (let n = 0; n < 34; n++) {
    const back = random() < 0.55;
    const x = back ? B.minX - 2 + random() * (width + 4) : B.minX - 1.4 - random() * 2.6;
    const z = back ? B.minZ - 1.4 - random() * 2.6 : B.minZ - 2 + random() * (length + 2);
    if (Math.abs(x - PASSAGE.x) < 1.6 && z < B.minZ) continue;
    const r = 0.22 + random() * 0.4, tall = 7 + random() * 4;
    const trunk = new THREE.CylinderGeometry(r * 0.7, r * 1.25, tall, 7, 1);
    trunk.translate(x, tall / 2, z);
    trunks.push(trunk);
    // Buttress roots flaring at the foot.
    for (let k = 0; k < 3; k++) {
      const a = random() * Math.PI * 2, root = new THREE.BoxGeometry(0.08, r * 2.4, r * 1.8);
      root.rotateY(a);
      root.translate(x + Math.sin(a) * r * 0.9, r * 1.1, z + Math.cos(a) * r * 0.9);
      trunks.push(root);
    }
    for (let k = 0; k < 2; k++) {
      const drop = 1.5 + random() * 3.5, at = new THREE.Vector3(x + (random() - 0.5) * 1.6, tall - 1 - random() * 2, z + (random() - 0.5) * 1.6);
      const vine = new THREE.BoxGeometry(0.035, drop, 0.035);
      vine.translate(at.x, at.y - drop / 2, at.z);
      vines.push(vine);
    }
  }
  for (const [geometries, color, name] of [[trunks, 0x2b231a, 'Jungle trunks'], [vines, 0x1e3818, 'Vines']]) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- Air, prints ------------------------------------------------------------------
  const shafts = [[-6, -2, 1], [0.5, 1, 0.8], [5.5, 4.5, 1], [-2.5, 6, 0.7], [8, -3, 0.8], [-9, 3.5, 0.6]].map(([x, z, strength]) => {
    const forward = new THREE.Vector3(0.22, -1, 0.12).normalize();
    return { at: new THREE.Vector3(x, 0, z).addScaledVector(forward, -9), forward, length: 10.5, strength };
  });
  const air = createJungleAir(scene, { bounds: B, shafts, lamps, random });
  const prints = createFootprints(scene, { max: 900, tint: new THREE.Color(0.1, 0.075, 0.05), linger: [240, 300], name: 'Sand footprints' });

  // ---- The squad's posts: sentries by the ruins, two on rounds ------------------------------------
  const posts = [
    { position: new THREE.Vector3(-6.4, 0, -3.9), heading: 0.5 },
    { position: new THREE.Vector3(-0.5, 0, -4.6), route: [new THREE.Vector3(-0.5, 0, -4.6), new THREE.Vector3(6, 0, -2.8), new THREE.Vector3(8.6, 0, 1.2), new THREE.Vector3(2.6, 0, -0.5)] },
    { position: new THREE.Vector3(4.6, 0, -4.2), heading: 2.6 },
    { position: new THREE.Vector3(-9.4, 0, 1.2), route: [new THREE.Vector3(-9.4, 0, 1.2), new THREE.Vector3(-6.4, 0, 6.2), new THREE.Vector3(-3.8, 0, 7.7), new THREE.Vector3(-5.6, 0, 2)] },
    { position: new THREE.Vector3(8.2, 0, -6.6), heading: -2.4 },
  ];
  for (const post of posts) post.heading ??= Math.atan2(post.route[1].x - post.route[0].x, post.route[1].z - post.route[0].z);

  // ---- The game's hooks ---------------------------------------------------------------
  const inWater = at => water.depth(at.x, at.z) > 0.05;
  /** A foot comes down: a print in the sand, or a splash in the water. Returns 'water' or 'sand'. */
  function step(at, along, side, size, speed = 1.5) {
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
  function blast(at, power = 1) {
    vegetation.blast(at, 1.6 * power);
    water.disturb(at.x, at.z, 3, 0.08 * power);
    if (inWater(at)) water.splash(at, 2 * power);
  }
  /** A bolt into the floor at `at`: into the water, a splash. True if it was water. */
  function bolt(at) { if (!inWater(at)) return false; water.splash(at, 0.45); return true; }
  /** A body landing at `at`: in the water, a big splash. */
  function landing(at, speed) { if (inWater(at)) water.splash(at, THREE.MathUtils.clamp(speed / 5, 0.4, 1.6)); }
  /** What glints on the water: the lights burning now (the blade, a blast), then the lamps nearest the view. */
  function glints(lights, focus) {
    const near = focus ? [...lamps].sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus)) : lamps;
    water.setGlints([...lights.filter(light => light.intensity > 0.05), ...near].slice(0, 6).map(light => ({ position: light.position, color: light.color, intensity: Math.min(2.5, light.intensity / 5) })));
  }
  glints([], null);
  function update(dt, { time = 0, actors = [], stirs = [], fog = null, lights = [], focus = null } = {}) {
    ruins.update(time);
    glints(lights, focus);
    if (groundMaterial.userData.shader) groundMaterial.userData.shader.uniforms.time.value = time;
    vegetation.update(dt, { time, pushers: actors });
    water.update(dt, { time, fog, waders: actors.filter(actor => actor.wades !== false) });
    air.update(dt, { time, stirs });
    prints.update(dt);
  }
  function reset() { vegetation.reset(); water.reset(); prints.clear(); door.reset(); }

  const lab = { group, obstacles, lights: lamps, floorLights: { spots: [] }, markings: [], update() {}, ...queries };
  let lastTime = null;
  const arena = {
    group: new THREE.Group(), obstacles: [], floorLights: [], grates: [], lights: [], door, bounds: B,
    update(time) { door.update(lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime))); lastTime = time; },
  };
  const stage = { floor: ground, material: groundMaterial, roughnessTexture: null, bounds: B, update() {} };
  // The hero comes in from the near side of the stream, the ruins and the squad across it.
  const start = { x: 2, z: 7.6, heading: -2.47 };
  return { bounds: B, start, lab, arena, stage, mirror, layout, posts, vegetation, water, air, prints, lamps, ruins, step, cut, blast, bolt, landing, update, reset, inWater, waterDepth, slabs };
}

/**
 * Night under the canopy, from the lab's lighting: dark, the light where it
 * burns — a low cold moon (the key light, casting the shadows) barely there,
 * a dim blue-green sky, earth below; the ruins' lamps, the blade, the blasts
 * do the lighting. The studio strip over the hero is a faint cold fill.
 */
export function jungleLighting(scene, lighting) {
  scene.background = new THREE.Color(0x040807);
  scene.fog = new THREE.FogExp2(0x060c0b, 0.03);
  scene.environmentIntensity = 0.1;
  scene.traverse(object => { if (object.isHemisphereLight) { object.color.set(0x2c4d5c); object.groundColor.set(0x120d07); object.intensity = 0.55; } });
  lighting.keyLight.color.set(0x87a8dc);
  lighting.keyLight.intensity = 1.9;
  lighting.keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(lighting.keyLight.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  lighting.keyLight.shadow.camera.updateProjectionMatrix();
  lighting.rimLight.color.set(0x3f6c66);
  lighting.rimLight.intensity = 0.45;
  lighting.whiteStrip.intensity = 2;
  lighting.whiteStrip.color.set(0x9fc2c8);
  lighting.redStrip.intensity = 0;
}
