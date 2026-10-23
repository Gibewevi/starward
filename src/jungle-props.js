import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './kit.js';

/**
 * The marsh ruins' made things: the wooden walkways on stilts over the water
 * (planks laid across, a little uneven, railings of posts and a rail, stilts
 * going down into the marsh), the cargo speeder at the landing, the prison
 * cage and the comms dish at the command post, and the waterfalls pouring off
 * the cores' islands (a falling sheet, foam where it lands, the water stirred
 * and spattered there — `update`).
 */
const WOOD = [0.24, 0.16, 0.09], DARK_WOOD = [0.12, 0.08, 0.05];

/** A box of the colour `rgb` (vertex colours), turned `yaw` about the vertical, at (x, y, z). */
function piece(w, h, d, x, y, z, yaw, rgb) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.rotateY(yaw);
  geometry.translate(x, y, z);
  const colours = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) colours.set(rgb, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry;
}
const shadeOf = (rgb, k) => rgb.map(value => value * k);

/** The walkways: { a, b, width } each, its deck at `deck` m. Decoration only (the water under is walkable). */
export function buildWalkways(group, walkways, { deck = 0.06, random = Math.random } = {}) {
  const parts = [];
  for (const { a, b, width } of walkways) {
    const along = b.clone().sub(a), length = along.length(), yaw = Math.atan2(along.x, along.z);
    along.divideScalar(length);
    const side = new THREE.Vector3(along.z, 0, -along.x);
    const at = (t, s, y) => a.clone().addScaledVector(along, t).addScaledVector(side, s).setY(y);
    // The planks, across, a little uneven; now and then one missing.
    for (let t = 0.1; t < length; t += 0.24) {
      if (random() < 0.04) continue;
      const p = at(t, (random() - 0.5) * 0.05, deck - 0.025 + random() * 0.012);
      parts.push(piece(width, 0.05, 0.2, p.x, p.y, p.z, yaw + (random() - 0.5) * 0.05, shadeOf(WOOD, 0.75 + random() * 0.5)));
    }
    // The two beams under them, the stilts down into the water, the railing.
    for (const s of [-1, 1]) {
      const beam = at(length / 2, s * (width / 2 - 0.12), deck - 0.09);
      parts.push(piece(0.12, 0.1, length, beam.x, beam.y, beam.z, yaw, DARK_WOOD));
      for (let t = 0.3; t < length; t += 2) {
        const stilt = at(t, s * (width / 2 - 0.06), -0.25);
        parts.push(piece(0.13, 0.65, 0.13, stilt.x, stilt.y, stilt.z, yaw, shadeOf(DARK_WOOD, 0.8 + random() * 0.4)));
      }
      for (let t = 0.3; t < length; t += 1.6) {
        const post = at(t, s * (width / 2 + 0.03), deck + 0.38);
        parts.push(piece(0.08, 0.8, 0.08, post.x, post.y, post.z, yaw, shadeOf(WOOD, 0.7)));
      }
      const rail = at(length / 2, s * (width / 2 + 0.03), deck + 0.74);
      parts.push(piece(0.06, 0.07, length - 0.4, rail.x, rail.y, rail.z, yaw, shadeOf(WOOD, 0.9)));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ name: 'walkway wood', vertexColors: true, roughness: 0.78, metalness: 0 }));
  mesh.name = 'Walkways';
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** The cargo speeder the hero landed in: a long low hull, fins, a canopy, engines still glowing. */
export function buildSpeeder(group, { x, z, w, h, d }) {
  const hull = [0.33, 0.34, 0.33], trim = [0.13, 0.14, 0.15], rust = [0.32, 0.2, 0.12];
  const parts = [
    piece(w, h * 0.55, d, x, h * 0.42, z, 0, hull),
    piece(w * 0.92, h * 0.25, d * 0.86, x, h * 0.82, z, 0, shadeOf(hull, 0.85)),
    piece(w * 0.3, h * 0.3, d * 0.62, x - w * 0.28, h * 1.05, z, 0, trim),
    piece(w * 1.04, 0.12, d * 1.04, x, h * 0.16, z, 0, trim),
    piece(0.5, 0.5, 0.12, x + w * 0.42, h * 0.95, z - d / 2 - 0.05, 0, rust),
    piece(0.5, 0.5, 0.12, x + w * 0.42, h * 0.95, z + d / 2 + 0.05, 0, rust),
    // Cargo crates strapped on its back.
    piece(0.9, 0.6, 0.8, x + w * 0.18, h * 1.25, z - d * 0.18, 0.2, [0.4, 0.37, 0.3]),
    piece(0.7, 0.5, 0.7, x + w * 0.22, h * 1.2, z + d * 0.22, -0.1, [0.36, 0.33, 0.27]),
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ name: 'speeder', vertexColors: true, roughness: 0.55, metalness: 0.45 }));
  mesh.name = 'Speeder';
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  // Its engines, still warm.
  const engines = new THREE.Mesh(mergeGeometries([piece(0.08, 0.3, 0.5, x + w / 2 + 0.05, h * 0.5, z - d * 0.25, 0, [1, 1, 1]), piece(0.08, 0.3, 0.5, x + w / 2 + 0.05, h * 0.5, z + d * 0.25, 0, [1, 1, 1])]),
    new THREE.MeshBasicMaterial({ name: 'speeder engines', color: new THREE.Color(2.4, 0.9, 0.35), toneMapped: false }));
  engines.name = 'Speeder engines';
  group.add(engines);
  return { kind: 'crate', min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2), centre: new THREE.Vector3(x, h / 2, z) };
}

/** The prison cage: a frame of dark iron, bars all round, a red lamp inside. */
export function buildCage(group, { x, z, w, d, h }) {
  const iron = [0.09, 0.09, 0.1], parts = [];
  parts.push(piece(w + 0.1, 0.12, d + 0.1, x, 0.06, z, 0, iron), piece(w + 0.1, 0.12, d + 0.1, x, h, z, 0, iron));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(piece(0.12, h, 0.12, x + sx * w / 2, h / 2, z + sz * d / 2, 0, iron));
  for (let t = -w / 2 + 0.2; t < w / 2; t += 0.22) for (const sz of [-1, 1]) parts.push(piece(0.035, h, 0.035, x + t, h / 2, z + sz * d / 2, 0, iron));
  for (let t = -d / 2 + 0.2; t < d / 2; t += 0.22) for (const sx of [-1, 1]) parts.push(piece(0.035, h, 0.035, x + sx * w / 2, h / 2, z + t, 0, iron));
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ name: 'cage iron', vertexColors: true, roughness: 0.5, metalness: 0.7 }));
  mesh.name = 'Prison cage';
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return {
    obstacle: { kind: 'crate', min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2), centre: new THREE.Vector3(x, h / 2, z) },
    lamp: { position: new THREE.Vector3(x, h - 0.4, z), color: new THREE.Color(1, 0.15, 0.1), base: 3, intensity: 3, zone: 'command' },
  };
}

/** The comms dish on its block, a mast with a red light winking on top. */
export function buildDish(group, { x, z }) {
  const steel = [0.2, 0.21, 0.22], parts = [piece(1.1, 0.9, 1.1, x, 0.45, z, 0, [0.1, 0.105, 0.11]), piece(0.1, 1.1, 0.1, x, 1.45, z, 0, steel), piece(0.05, 2.4, 0.05, x + 0.4, 2.1, z - 0.35, 0, steel)];
  // The dish: a shallow bowl tipped back to the sky.
  const dish = new THREE.SphereGeometry(0.75, 12, 4, 0, Math.PI * 2, Math.PI * 0.78, Math.PI * 0.22);
  dish.rotateX(0.75);
  dish.rotateY(Math.PI * 0.25);
  dish.translate(x, 2.55, z);
  const colours = new Float32Array(dish.attributes.position.count * 3).fill(0.26);
  dish.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  parts.push(dish.toNonIndexed());
  for (const part of parts) part.deleteAttribute('uv');
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ name: 'dish', vertexColors: true, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide }));
  mesh.name = 'Comms dish';
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return {
    obstacle: { kind: 'crate', min: new THREE.Vector3(x - 0.55, 0, z - 0.55), max: new THREE.Vector3(x + 0.55, 0.9, z + 0.55), centre: new THREE.Vector3(x, 0.45, z) },
    lamp: { position: new THREE.Vector3(x + 0.4, 3.4, z - 0.35), color: new THREE.Color(1, 0.15, 0.1), base: 2.5, intensity: 2.5, zone: 'command' },
  };
}

/**
 * The waterfalls: { at, facing, width, height } — a ruin wall the water spills
 * over, a sheet of white water falling from it (streaks running down), foam
 * where it lands. update(dt, time, water) stirs and spatters the water there.
 */
export function buildFalls(group, falls, { random = Math.random } = {}) {
  const sheets = [], obstacles = [], foam = [];
  const material = new THREE.ShaderMaterial({
    name: 'waterfall', transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; varying vec2 vUv;
      float n(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // Streaks running down, faster lower, thinning at the sides.
        float x = vUv.x * 14.0, fall = time * (2.2 + (1.0 - vUv.y) * 2.5);
        float streak = n(vec2(x, vUv.y * 10.0 + fall)) * 0.6 + n(vec2(x * 2.3, vUv.y * 22.0 + fall * 1.6)) * 0.4;
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        vec3 colour = mix(vec3(0.05, 0.16, 0.18), vec3(0.62, 0.78, 0.8), smoothstep(0.35, 0.95, streak));
        gl_FragColor = vec4(colour, edge * (0.45 + 0.4 * streak) * (0.75 + 0.25 * vUv.y));
        #include <colorspace_fragment>
      }`,
  });
  for (const fall of falls) {
    const { at, facing, width, height } = fall;
    // The wall it pours over, behind.
    const back = at.clone().addScaledVector(facing, -0.55);
    obstacles.push({ kind: 'pillar', min: new THREE.Vector3(back.x - 0.9, 0, back.z - 0.9), max: new THREE.Vector3(back.x + 0.9, height + 0.3, back.z + 0.9), centre: new THREE.Vector3(back.x, height / 2, back.z) });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, height + 0.1), material);
    sheet.position.copy(at).setY(height / 2);
    sheet.lookAt(at.clone().add(facing).setY(height / 2));
    sheet.name = 'Waterfall';
    sheet.renderOrder = 3;
    group.add(sheet);
    sheets.push(sheet);
    const pool = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.55, 0.7, 0.72), transparent: true, depthWrite: false, opacity: 0.55 }));
    pool.position.copy(at).addScaledVector(facing, 0.25).setY(0.15);
    pool.scale.set(width * 1.6, 0.6, 1);
    group.add(pool);
    foam.push({ fall, clock: 0 });
  }
  function update(dt, time, water) {
    material.uniforms.time.value = time;
    for (const entry of foam) {
      const { at, facing, width } = entry.fall;
      // The water stirred where it lands, and spattered.
      if (!water) continue;
      const x = at.x + facing.x * 0.3, z = at.z + facing.z * 0.3, across = (random() - 0.5) * width;
      water.disturb(x + facing.z * across, z - facing.x * across, 0.2, 0.012);
      if ((entry.clock -= dt) <= 0) { entry.clock = 0.1 + random() * 0.12; water.splash(new THREE.Vector3(x + facing.z * across, 0, z - facing.x * across), 0.25, facing); }
    }
  }
  return { sheets, obstacles, update };
}
