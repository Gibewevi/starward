import * as THREE from 'three';

/**
 * The jungle's floor, painted once into three textures laid out alike over
 * the clearing (32 texels a metre, pixel art at the game's scale):
 * - colour: dark mud, wet sand along the banks and the trodden paths, moss,
 *   leaf litter, pebbles lit from the moon's side, black puddles; at the back
 *   the old slabs, their joints full of moss, and an iron grate;
 * - roughness: what is wet shines — the puddles most, then the mud by the
 *   water, the paths, rain lying on the slabs; moss and dry earth stay dull
 *   (the game mirrors the shining parts, main.js, and the lamps glint on them);
 * - height, for the bump: pebbles, ruts, the slabs' bevels.
 *
 * paintJungleFloor({ bounds, waterDepth, slabs }) → { map, roughnessMap,
 * bumpMap, puddle(x, z), path(x, z), wetness(x, z) } — puddle and path also
 * keep the plants off the open mud.
 */
export function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, z) => valueNoise(x, z) * 0.6 + valueNoise(x * 2.1 + 5, z * 2.1 - 3) * 0.3 + valueNoise(x * 4.3 - 7, z * 4.3 + 1) * 0.1;
const smooth = THREE.MathUtils.smoothstep;
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const MUD = [0.29, 0.235, 0.17], DARK_MUD = [0.15, 0.13, 0.105], SAND = [0.52, 0.43, 0.31], MOSS = [0.12, 0.19, 0.095];
const PUDDLE = [0.055, 0.08, 0.095], SLAB = [0.21, 0.25, 0.29], JOINT = [0.045, 0.065, 0.055];
/** The iron grate on the slabs: [x, z, width, depth]. */
export const GRATE = [-1.4, -7.4, 1.4, 0.9];

export function createFloorLayout({ bounds: B, waterDepth, slabs }) {
  // How far each point is from the water, on a grid of 12.5 cm (a chamfer distance, two passes).
  const G = 8, GW = Math.round((B.maxX - B.minX) * G), GH = Math.round((B.maxZ - B.minZ) * G);
  const far = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) far[j * GW + i] = waterDepth(B.minX + (i + 0.5) / G, B.minZ + (j + 0.5) / G) > 0 ? 0 : 1e9;
  const relax = (k, other, w) => { if (far[other] + w < far[k]) far[k] = far[other] + w; };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (i > 0) relax(k, k - 1, 1);
    if (j > 0) { relax(k, k - GW, 1); if (i > 0) relax(k, k - GW - 1, 1.414); if (i < GW - 1) relax(k, k - GW + 1, 1.414); }
  }
  for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) {
    const k = j * GW + i;
    if (i < GW - 1) relax(k, k + 1, 1);
    if (j < GH - 1) { relax(k, k + GW, 1); if (i < GW - 1) relax(k, k + GW + 1, 1.414); if (i > 0) relax(k, k + GW - 1, 1.414); }
  }
  const toWater = (x, z) => {
    const i = THREE.MathUtils.clamp(Math.floor((x - B.minX) * G), 0, GW - 1), j = THREE.MathUtils.clamp(Math.floor((z - B.minZ) * G), 0, GH - 1);
    return far[j * GW + i] / G;
  };
  /** Wet earth by the water: 1 at the bank, 0 a metre and a half off. */
  const wetness = (x, z) => 1 - smooth(toWater(x, z), 0.1, 1.5);
  /** The trodden paths: winding bands of bare wet sand. */
  const path = (x, z) => {
    if (slabs(x, z)) return 0;
    const worn = 1 - smooth(Math.abs(fbm(x * 0.21 + 40, z * 0.21 - 13) - 0.5), 0.025, 0.06);
    // A legible entrance from the spawn, continuing over the shallows into
    // the clearing. Foliage clusters frame the hero instead of covering him.
    const centre = 2 + Math.sin((7.6 - z) * 0.45) * 0.8;
    const entrance = (1 - smooth(Math.abs(x - centre), 0.65, 1.3)) * smooth(z, -2, 0);
    return Math.max(worn, entrance);
  };
  /** Puddles in the low mud and on the slabs (0 dry → 1 standing water). */
  const puddle = (x, z) => {
    if (waterDepth(x, z) > 0) return 0;
    const low = fbm(x * 0.85 + 17, z * 0.85 - 4) + path(x, z) * 0.08 + (slabs(x, z) ? 0.05 : 0);
    return smooth(low, 0.66, 0.7);
  };
  return { toWater, wetness, path, puddle };
}

export function paintJungleFloor({ bounds: B, waterDepth, slabs, layout, scale = 32 }) {
  if (typeof document === 'undefined') return { map: null, roughnessMap: null, bumpMap: null };
  const W = Math.round((B.maxX - B.minX) * scale), H = Math.round((B.maxZ - B.minZ) * scale);
  const canvases = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; });
  const images = canvases.map(c => c.getContext('2d').createImageData(W, H));
  const [colour, rough, height] = images.map(image => image.data);
  const [gx, gz, gw, gd] = GRATE;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = B.minX + (i + 0.5) / scale, z = B.minZ + (j + 0.5) / scale, k = (j * W + i) * 4;
    const n = fbm(x * 0.7, z * 0.7), grain = hash(i * 1.3, j * 0.7), fine = hash(i, j);
    const wet = layout.wetness(x, z), trail = layout.path(x, z), pool = layout.puddle(x, z);
    // Mud, darker in its hollows, ruts and grit.
    let c = mixRGB(MUD, DARK_MUD, smooth(n, 0.35, 0.75));
    let r = 0.8 - 0.1 * fbm(x * 2, z * 2), h = 0.35 + 0.3 * fbm(x * 3.1, z * 3.1);
    // Wet sand: along the banks and the paths.
    const sand = Math.max(wet * smooth(fbm(x * 1.7 - 3, z * 1.7 + 8), 0.25, 0.6), trail * 0.85);
    c = mixRGB(c, SAND, sand * (0.75 + 0.25 * n));
    r = r * (1 - sand) + 0.42 * sand;
    // Moss in patches away from the water.
    const moss = smooth(fbm(x * 1.2 + 11, z * 1.2), 0.56, 0.72) * (1 - wet) * (1 - trail);
    c = mixRGB(c, MOSS, moss);
    r = Math.max(r, 0.92 * moss + r * (1 - moss));
    // The mud by the water: darker and glossy.
    c = mixRGB(c, [c[0] * 0.7, c[1] * 0.76, c[2] * 0.8], wet * 0.75);
    r -= wet * 0.4;
    if (slabs(x, z)) {
      // Slabs: dark stone, a shade each, mossy joints, cracks; rain lies on them.
      const ti = Math.floor((x - B.minX) / 1.2), row = Math.floor((z - B.minZ) / 0.8);
      const sx = ((x - B.minX) / 1.2) - ti, sz = ((z - B.minZ) / 0.8) - row;
      const joint = sx < 0.04 || sz < 0.06, bevel = sx < 0.08 || sz < 0.11;
      const shade = 0.8 + 0.4 * hash(ti, row) + 0.15 * (n - 0.5);
      c = joint ? (hash(i * 0.3, j * 0.2) > 0.5 ? MOSS : JOINT) : SLAB.map(v => v * shade * (bevel ? 1.25 : 1));
      if (!joint && fbm(x * 4, z * 4) > 0.72) c = c.map(v => v * 0.75);
      r = joint ? 0.9 : 0.55 - 0.15 * hash(ti * 3, row * 5);
      h = joint ? 0 : bevel ? 0.55 : 0.7;
      if (x > gx - gw / 2 && x < gx + gw / 2 && z > gz - gd / 2 && z < gz + gd / 2) {
        // The grate: iron bars over the dark.
        const bar = ((x - gx) * 12.5 % 1 + 1) % 1 < 0.38 || Math.abs(z - gz) > gd / 2 - 0.06 || Math.abs(x - gx) > gw / 2 - 0.06;
        c = bar ? [0.15, 0.15, 0.15] : [0.02, 0.02, 0.025];
        r = bar ? 0.4 : 0.9;
        h = bar ? 0.75 : 0;
      }
    } else {
      // Leaf litter and pebbles, a lit edge on the moon's side and a shadow under.
      if (grain > 0.992 - moss * 0.01) c = mixRGB(c, [0.26, 0.17, 0.07], 0.8);
      // Pebbles: one now and then in a jittered grid of 7 texels, round-ish, of every size.
      const ci = Math.floor(i / 7), cj = Math.floor(j / 7), cell = hash(ci * 3.1, cj * 1.7);
      if (cell > 0.8 - trail * 0.1) {
        const cx = ci * 7 + 1.5 + hash(ci, cj * 2.3) * 4, cz = cj * 7 + 1.5 + hash(ci * 1.9, cj) * 4, radius = 0.7 + hash(cj, ci) * 1.6;
        const dx = i + 0.5 - cx, dz = j + 0.5 - cz;
        if (dx * dx + dz * dz * 1.3 < radius * radius) {
          const stone = 0.2 + 0.14 * hash(ci * 7, cj * 5);
          c = [stone * 1.05, stone, stone * 0.9].map(v => v * (dx + dz < -radius * 0.4 ? 1.45 : dx + dz > radius * 0.5 ? 0.55 : 1));
          r = 0.45; h = 0.95;
        }
      }
      if (fine < 0.015) c = c.map(v => v * 0.6);
    }
    // Small wet grooves also catch the light along the trodden paths.
    const rut = trail * (1 - smooth(Math.abs(Math.sin(x * 18 + z * 7 + n * 5)), 0.08, 0.26));
    if (!slabs(x, z)) { r -= rut * 0.22; h -= rut * 0.06; }
    // Puddles: dark standing water with a soft wet rim.
    if (pool > 0) {
      c = mixRGB(c, PUDDLE, pool * 0.75);
      r = r * (1 - pool) + 0.03 * pool;
      h = h * (1 - pool) + 0.1 * pool;
    }
    r = THREE.MathUtils.clamp(r, 0.03, 1);
    colour.set([Math.min(255, c[0] * 255), Math.min(255, c[1] * 255), Math.min(255, c[2] * 255), 255], k);
    rough.set([r * 255, r * 255, r * 255, 255], k);
    height.set([h * 255, h * 255, h * 255, 255], k);
  }
  const textures = canvases.map((canvas, index) => {
    canvas.getContext('2d').putImageData(images[index], 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    if (index === 0) texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.flipY = false;
    return texture;
  });
  return { map: textures[0], roughnessMap: textures[1], bumpMap: textures[2] };
}

/**
 * Stones strewn over the mud and along the banks, half sunk in the water:
 * small, lumpy, wet (they catch the lamps), mossy on top. One instanced mesh.
 */
export function scatterStones(group, { bounds: B, layout, waterDepth, slabs, avoid, random, count = 260 }) {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    position.setXYZ(i, p.x * (0.85 + 0.3 * hash(p.x * 7, p.z * 3)), Math.max(-0.3, p.y * 0.55), p.z * (0.85 + 0.3 * hash(p.z * 5, p.y * 9)));
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 0.42, metalness: 0, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'Stones';
  mesh.castShadow = mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), colour = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 40; tries++) {
    const x = B.minX + 0.3 + random() * (B.maxX - B.minX - 0.6), z = B.minZ + 0.3 + random() * (B.maxZ - B.minZ - 0.6);
    if (slabs(x, z) || avoid(x, z)) continue;
    const bank = layout.wetness(x, z), deep = waterDepth(x, z);
    // Thicker along the banks and in the shallows, a few anywhere.
    if (random() > 0.12 + bank * 0.6 - deep * 0.5) continue;
    const size = (0.05 + random() * random() * 0.22) * (1 + bank * 0.4);
    rotation.setFromEuler(new THREE.Euler((random() - 0.5) * 0.5, random() * Math.PI * 2, (random() - 0.5) * 0.5));
    mesh.setMatrixAt(n, matrix.compose(new THREE.Vector3(x, size * 0.15 - deep * 0.03, z), rotation, new THREE.Vector3(size, size * (0.7 + random() * 0.5), size * (0.8 + random() * 0.4))));
    mesh.setColorAt(n, colour.setRGB(0.6 + random() * 0.35, 0.6 + random() * 0.4, 0.55 + random() * 0.3));
    n++;
  }
  mesh.count = n;
  group.add(mesh);
  const original = new Float32Array(mesh.instanceMatrix.array), place = new THREE.Vector3();
  return {
    mesh,
    /** A blast at `at`: the stones in its crater are blown away. */
    clear(at, radius) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        place.setFromMatrixPosition(matrix);
        if (Math.hypot(place.x - at.x, place.z - at.z) < radius) mesh.setMatrixAt(i, matrix.makeScale(0, 0, 0));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    reset() { mesh.instanceMatrix.array.set(original); mesh.instanceMatrix.needsUpdate = true; },
  };
}
