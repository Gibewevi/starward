import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obstacleQueries } from './lab.js';
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
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => valueNoise(x, z) * 0.6 + valueNoise(x * 2.1 + 5, z * 2.1 - 3) * 0.3 + valueNoise(x * 4.3 - 7, z * 4.3 + 1) * 0.1;
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

// ---- The ground: painted once, wet sand, earth, moss, slabs; darker and teal under the water ----
function paintGround(width, length, scale = 40) {
  // Without a page (the tests), no paint.
  if (typeof document === 'undefined') return null;
  const W = Math.round(width * scale), H = Math.round(length * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(W, H), px = image.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = B.minX + (i + 0.5) / scale, z = B.minZ + (j + 0.5) / scale;
    const n = fbm(x * 0.6, z * 0.6), grain = hash(i, j), wet = Math.max(0, 1 - waterDepth(x, z) * 0 - Math.min(1, Math.max(0, (dist2water(x, z) - 0.2) / 1.6)));
    // Sand, darker earth in patches, moss here and there.
    let r = 0.42 + 0.08 * n, g = 0.34 + 0.07 * n, b = 0.24 + 0.05 * n;
    const earth = THREE.MathUtils.smoothstep(n, 0.45, 0.7);
    r = r * (1 - earth) + 0.22 * earth; g = g * (1 - earth) + 0.18 * earth; b = b * (1 - earth) + 0.12 * earth;
    const moss = THREE.MathUtils.smoothstep(fbm(x * 1.3 + 11, z * 1.3), 0.58, 0.75);
    r = r * (1 - moss) + 0.16 * moss; g = g * (1 - moss) + 0.26 * moss; b = b * (1 - moss) + 0.1 * moss;
    if (slabs(x, z)) {
      // Slabs: grey stone, joints, cracks, moss in the joints.
      const sx = ((x - B.minX) / 1.2) % 1, sz = ((z - B.minZ + (Math.floor((x - B.minX) / 1.2) % 2) * 0.4) / 0.8) % 1;
      const joint = sx < 0.05 || sz < 0.07;
      const stone = 0.3 + 0.08 * hash(Math.floor((x - B.minX) / 1.2), Math.floor((z - B.minZ) / 0.8)) + 0.05 * n;
      r = joint ? 0.12 : stone * 0.95; g = joint ? 0.17 : stone; b = joint ? 0.09 : stone * 0.98;
      if (!joint && fbm(x * 3, z * 3) > 0.7) { r *= 0.7; g *= 0.85; b *= 0.6; }
    }
    // Pebbles and grit; wet sand darker near the water.
    const pebble = grain > 0.985 ? 0.12 : grain < 0.02 ? -0.06 : 0;
    const dark = 1 - wet * 0.45;
    px.set([Math.min(255, (r + pebble) * dark * 255), Math.min(255, (g + pebble) * dark * 255), Math.min(255, (b + pebble) * dark * 255), 255], (j * W + i) * 4);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.flipY = false;
  return texture;
}
/** Roughly how far from the water a point is (m), by stepping out a few rings. */
function dist2water(x, z) {
  if (waterDepth(x, z) > 0) return 0;
  for (const r of [0.3, 0.6, 1, 1.5, 2]) for (let a = 0; a < 8; a++) if (waterDepth(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r) > 0) return r;
  return 3;
}

// ---- The ruins: stone blocks, moss, lit strips -------------------------------------------
// [x, z, width (x), height, depth (z), lit faces ('+z' '-z' '+x' '-x'), kind]
const RUINS = [
  // The back wall of the clearing: pillars, lit, along the far sides.
  ...[-10.4, -7.2, -4, -0.8, 2.4, 5.6, 8.8].map((x, i) => [x, -8.4, 1.3, 3.4 + (i % 3) * 0.5, 1.2, i % 2 ? ['+z'] : [], 'wall']),
  ...[-5.4, -2.2, 1, 4.2, 7.4].map((z, i) => [-11.4, z, 1.2, 3 + (i % 2) * 0.6, 1.3, i % 2 ? [] : ['+x'], 'wall']),
  // Blocks in the clearing: cover.
  [-6.4, -5.2, 1.4, 1.2, 1.4, ['+z'], 'block'],
  [-2.4, -6.1, 2.4, 0.9, 1, [], 'block'],
  [3, -5.4, 1.2, 1.7, 1.2, ['+x'], 'block'],
  [7.2, -4.4, 1.4, 1.1, 1.4, [], 'block'],
  [-8.4, -2.6, 1.2, 1.4, 1.2, ['+z'], 'block'],
  [1.6, -2.4, 1, 1, 1, [], 'block'],
  [5.2, 0.6, 2.4, 0.8, 0.9, [], 'block'],
  [-4.6, 0.2, 1.3, 1.2, 1.3, ['+x'], 'block'],
  [-5.4, 7.4, 1.3, 1.25, 1.3, [], 'block'],
  [9.6, 7.6, 1.2, 1.5, 1.2, ['-x'], 'block'],
  [10.2, -1.4, 1.3, 1.3, 1.3, ['-x'], 'block'],
];
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

function stoneTexture() {
  if (typeof document === 'undefined') return null;
  const S = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const course = Math.floor(j / 16), brick = Math.floor((i + (course % 2) * 12) / 24);
    const joint = j % 16 === 0 || (i + (course % 2) * 12) % 24 === 0;
    const v = joint ? 0.14 : 0.36 + 0.1 * hash(brick, course) + 0.05 * hash(i, j);
    const moss = !joint && hash(i * 3, j * 7) > 0.93 ? 0.06 : 0;
    image.data.set([(v - moss) * 255, (v + moss) * 255, (v * 0.95 - moss) * 255, 255], (j * S + i) * 4);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
/** A box, its UVs in metres (so the stone courses keep their size on any block). */
function block(w, h, d, x, y, z) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv, normal = geometry.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
    const sx = nx > 0.5 ? d : w, sy = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx / 1.2, uv.getY(i) * sy / 1.2);
  }
  geometry.translate(x, y, z);
  return geometry;
}

export function createJungle(scene, { renderer = null, random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'Jungle';
  scene.add(group);
  const width = B.maxX - B.minX, length = B.maxZ - B.minZ;

  // ---- Water ---------------------------------------------------------------------
  const water = createWater(scene, { rect: B, depthAt: waterDepth, random });

  // ---- The ground: lower under the water (seen through it), wet near it ------------------
  const groundMaterial = new THREE.MeshStandardMaterial({ map: paintGround(width, length), roughness: 0.92, metalness: 0, envMapIntensity: 0.25 });
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.tDepth = { value: water.depthTexture };
    shader.uniforms.time = { value: 0 };
    groundMaterial.userData.shader = shader;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGround; uniform sampler2D tDepth; uniform float time;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 uvw = (vGround.xz - vec2(${B.minX.toFixed(2)}, ${B.minZ.toFixed(2)})) / vec2(${width.toFixed(2)}, ${length.toFixed(2)});
        float under = texture2D(tDepth, uvw).r;
        if (under > 0.01) {
          // The stream's bed: darker, tinted by the water over it, crossed by the light the ripples gather.
          float caustic = pow(abs(sin(vGround.x * 3.1 + time * 0.9 + sin(vGround.z * 2.7 + time * 0.7)) * sin(vGround.z * 3.4 - time * 0.8 + sin(vGround.x * 2.2))), 6.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.75, 0.72), smoothstep(0.0, 0.6, under)) * (1.0 - 0.35 * under) + vec3(0.18, 0.4, 0.38) * caustic * (1.0 - under * 0.5);
        }
      }`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, length), groundMaterial);
  ground.name = 'Jungle ground';
  ground.rotation.x = -Math.PI / 2;
  // The canvas rows run along +z (flipY off): the plane's v must too.
  ground.scale.y = -1;
  ground.position.set(B.minX + width / 2, -0.005, B.minZ + length / 2);
  ground.receiveShadow = true;
  group.add(ground);
  // Beyond the clearing: dark earth under the jungle, to the horizon.
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: 0x1d2a16 }));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = -0.03;
  group.add(beyond);

  // ---- Ruins, rocks, and the edges of the clearing (the obstacles) --------------------------
  const obstacles = [];
  const stoneMaterial = new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0xc4ccc0, roughness: 0.95, metalness: 0.05 });
  const mossMaterial = new THREE.MeshLambertMaterial({ color: 0x40692c });
  const stripMaterial = new THREE.MeshBasicMaterial({ name: 'ruin light strips', color: new THREE.Color(2.2, 1.9, 1.45), toneMapped: false });
  const diodeMaterial = new THREE.MeshBasicMaterial({ name: 'red diodes', color: new THREE.Color(2.4, 0.15, 0.1), toneMapped: false });
  const stone = [], moss = [], strips = [], diodes = [];
  const lamps = [];
  for (const [x, z, w, h, d, lit, kind] of RUINS) {
    stone.push(block(w, h, d, x, h / 2, z));
    obstacles.push({ kind: kind === 'wall' ? 'pillar' : 'crate', min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2), centre: new THREE.Vector3(x, h / 2, z) });
    // Moss in cushions over the top (the stone showing between), and running down the sides.
    for (let n = 0; n < 3; n++) {
      const mw = w * (0.35 + random() * 0.5), md = d * (0.35 + random() * 0.5);
      moss.push(block(mw, 0.05 + random() * 0.06, md, x + (random() - 0.5) * (w - mw), h + 0.03, z + (random() - 0.5) * (d - md)));
    }
    for (let n = 0; n < 3; n++) {
      const side = random() < 0.5 ? -1 : 1, alongX = random() < 0.5, run = 0.3 + random() * h * 0.6;
      const offset = (random() - 0.5) * (alongX ? w : d) * 0.8;
      if (alongX) moss.push(block(0.12 + random() * 0.15, run, 0.03, x + offset, h - run / 2, z + side * (d / 2 + 0.01)));
      else moss.push(block(0.03, run, 0.12 + random() * 0.15, x + side * (w / 2 + 0.01), h - run / 2, z + offset));
    }
    for (const face of lit) {
      // A vertical strip of light set into the face, a red diode under it, a warm lamp in front.
      const sign = face[0] === '+' ? 1 : -1, axis = face[1];
      const fx = axis === 'x' ? x + sign * (w / 2 + 0.012) : x, fz = axis === 'z' ? z + sign * (d / 2 + 0.012) : z;
      const tall = Math.min(1.1, h * 0.5);
      strips.push(axis === 'x' ? block(0.03, tall, 0.09, fx, h * 0.55, fz) : block(0.09, tall, 0.03, fx, h * 0.55, fz));
      diodes.push(axis === 'x' ? block(0.03, 0.05, 0.05, fx, h * 0.55 - tall / 2 - 0.12, fz + 0.15) : block(0.05, 0.05, 0.03, fx + 0.15, h * 0.55 - tall / 2 - 0.12, fz));
      const lamp = new THREE.PointLight(0xffc48a, 3.2, 5.5, 1.6);
      lamp.position.set(fx + (axis === 'x' ? sign * 0.5 : 0), h * 0.55, fz + (axis === 'z' ? sign * 0.5 : 0));
      group.add(lamp);
      lamps.push(lamp);
    }
  }
  for (const [geometries, material, name, shadows] of [[stone, stoneMaterial, 'Ruins', true], [moss, mossMaterial, 'Moss', true], [strips, stripMaterial, 'Ruin lights', false], [diodes, diodeMaterial, 'Ruin diodes', false]]) {
    if (!geometries.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }
  // Rocks: lumpy, dark, mossy on top.
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f38, roughness: 0.9, flatShading: true, vertexColors: true });
  for (const [x, z, r] of ROCKS) {
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    const position = geometry.attributes.position, colors = [];
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      p.multiplyScalar(0.8 + 0.4 * hash(p.x * 9 + x, p.z * 9 + z));
      p.y = Math.max(-r * 0.2, p.y * 0.75);
      position.setXYZ(i, p.x, p.y, p.z);
      const top = p.y > r * 0.35;
      colors.push(...(top ? [0.42, 0.62, 0.32] : [0.75, 0.78, 0.72]));
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
    const target = { grass: 2600, reed: 300, fern: 190, broadleaf: 80 }[kind];
    for (let tries = 0; plants.length < target && tries < target * 30; tries++) {
      const x = B.minX + 0.3 + random() * (width - 0.6), z = B.minZ + 0.3 + random() * (length - 0.6);
      const wet = waterDepth(x, z), edge = Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
      if (inside(x, z, kind === 'grass' ? 0.12 : 0.3)) continue;
      // Clumps, thicker towards the edges of the clearing; sparse on the slabs and kept off the middle of the paths.
      const clump = fbm(x * 0.45 + 3, z * 0.45 - 2) + (edge < 2.2 ? 0.35 : 0) - (slabs(x, z) ? 0.35 : 0);
      if (kind === 'reed') {
        if (wet > 0.32 || (wet === 0 && dist2water(x, z) > 0.6)) continue;
        plants.push({ x, z, height: 0.9 + random() * 0.75, size: 0.9 + random() * 0.4 });
      } else if (wet > 0.04) continue;
      else if (kind === 'grass') {
        if (random() > clump * 1.3) continue;
        // Short in the open, tall in the clumps.
        plants.push({ x, z, height: 0.18 + random() * 0.35 + clump * 0.6 * random(), size: 0.7 + random() * 0.6 });
      } else {
        if (random() > clump * 1.1 - 0.2 + (edge < 2 ? 0.4 : 0)) continue;
        plants.push(kind === 'fern' ? { x, z, height: 0.45 + random() * 0.5, size: 0.7 + random() * 0.5 } : { x, z, height: 0.65 + random() * 0.7, size: 0.85 + random() * 0.6 });
      }
    }
    // Beyond the edges, the jungle itself: thick and tall at the back, lower on
    // the near sides so as not to hide the clearing; the trail kept clear.
    const ring = { grass: 1300, fern: 340, broadleaf: 280 }[kind] ?? 0;
    for (let n = 0, tries = 0; n < ring && tries < ring * 20; tries++) {
      const x = B.minX - 3 + random() * (width + 8), z = B.minZ - 3 + random() * (length + 8);
      if (x > B.minX - 0.1 && x < B.maxX + 0.1 && z > B.minZ - 0.1 && z < B.maxZ + 0.1) continue;
      if (Math.abs(x - PASSAGE.x) < PASSAGE.width / 2 + 0.3 && z < B.minZ) continue;
      const grow = x > B.maxX || z > B.maxZ ? 0.75 : 1.5;
      if (kind === 'grass') plants.push({ x, z, height: 0.5 + random() * 0.6, size: 1 + random() * 0.6 });
      else if (kind === 'fern') plants.push({ x, z, height: (0.6 + random() * 0.6) * grow, size: (1 + random() * 0.7) * grow });
      else plants.push({ x, z, height: (0.9 + random() * 0.9) * grow, size: (1 + random() * 0.8) * grow });
      n++;
    }
    return plants;
  };
  const vegetation = createVegetation(scene, { place, random });

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
  water.setGlints(lamps.map(lamp => ({ position: lamp.position, color: new THREE.Color(1, 0.75, 0.5), intensity: 0.9 })));

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
  function update(dt, { time = 0, actors = [], stirs = [], fog = null } = {}) {
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
  return { bounds: B, start, lab, arena, stage, posts, vegetation, water, air, prints, lamps, step, cut, blast, bolt, landing, update, reset, inWater, waterDepth, slabs };
}

/**
 * Night under the canopy, from the lab's lighting: a low cold moon (the key
 * light, casting the shadows), a green-blue sky, earth below; the studio
 * strips over the hero dimmed to a soft glow; the air dark and green-blue.
 */
export function jungleLighting(scene, lighting) {
  scene.background = new THREE.Color(0x09130f);
  scene.fog = new THREE.FogExp2(0x0c1a17, 0.026);
  scene.environmentIntensity = 0.18;
  scene.traverse(object => { if (object.isHemisphereLight) { object.color.set(0x35596a); object.groundColor.set(0x1c150b); object.intensity = 1.05; } });
  lighting.keyLight.color.set(0xa9c6ea);
  lighting.keyLight.intensity = 2.3;
  lighting.rimLight.color.set(0x6f9a8f);
  lighting.rimLight.intensity = 0.8;
  lighting.whiteStrip.intensity = 2.6;
  lighting.whiteStrip.color.set(0xbfd8d0);
  lighting.redStrip.intensity = 0;
}
