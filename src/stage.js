import * as THREE from 'three';

/**
 * The deck: a floor of heavy steel plates, painted procedurally in whole
 * pixels — 2.4 m plates with dark recessed seams and a bright bevel, corner
 * bolts, some split in two, some tread plate, some service hatches with
 * handles — worn along the edges, grimy in the seams, and wet: puddles are
 * painted into the roughness map (smooth where wet), so the PBR highlights and
 * the planar reflection (main.js) both shine there.
 *
 * One texture tile covers 9.6 m; UVs are world coordinates / 9.6, so the
 * floor and its reflection line up whatever the deck's size.
 * createStage(scene, { bounds }) — bounds { minX, maxX, minZ, maxZ } in metres.
 */
export const TILE = 9.6;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvasLayer(size, fill) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  return { canvas, ctx };
}

/** Smooth tiling value noise in [0, 1] (period `cells`). */
function tilingNoise(seed, cells) {
  const random = seededRandom(seed), grid = Array.from({ length: cells * cells }, () => random());
  const at = (x, y) => grid[((y % cells) + cells) % cells * cells + ((x % cells) + cells) % cells];
  return (u, v) => {
    const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function paintSteelAtlas() {
  const size = 768, plate = 192, seam = 5;
  const albedo = canvasLayer(size, '#14171c');
  const roughness = canvasLayer(size, '#9a9a9a');
  const height = canvasLayer(size, '#808080');
  const color = (r, g = r, b = r) => `rgb(${r | 0},${g | 0},${b | 0})`;
  const steel = (tone, ctx = albedo.ctx) => { ctx.fillStyle = color(tone - 3, tone, tone + 6); };

  for (let row = 0; row < size / plate; row++) {
    for (let column = 0; column < size / plate; column++) {
      const random = seededRandom(91813 + row * 7919 + column * 104729);
      const x = column * plate, y = row * plate, inner = plate - seam;
      const kind = random(), tone = 33 + Math.floor(random() * 16);
      steel(tone);
      albedo.ctx.fillRect(x + seam, y + seam, inner - 1, inner - 1);
      roughness.ctx.fillStyle = color(150 + random() * 40);
      roughness.ctx.fillRect(x + seam, y + seam, inner - 1, inner - 1);
      height.ctx.fillStyle = '#a0a0a0';
      height.ctx.fillRect(x + seam, y + seam, inner - 1, inner - 1);

      // Mottled wear: rectangular patches of polish and oxidation.
      for (let patch = 0; patch < 70; patch++) {
        const px = x + 6 + Math.floor(random() * (inner - 20)), py = y + 6 + Math.floor(random() * (inner - 14));
        const w = 3 + Math.floor(random() * 18), h = 1 + Math.floor(random() * 6), t = tone - 5 + Math.floor(random() * 11);
        steel(t);
        albedo.ctx.fillRect(px, py, w, h);
      }
      if (kind < 0.18) {
        // Tread plate: raised diamonds in rows.
        steel(tone - 6);
        albedo.ctx.fillRect(x + seam, y + seam, inner - 1, inner - 1);
        for (let ty = 8; ty < inner - 8; ty += 8) {
          for (let tx = 8 + (ty % 16 ? 4 : 0); tx < inner - 8; tx += 8) {
            const flip = ((tx + ty) >> 3) % 2;
            steel(tone + 10);
            albedo.ctx.fillRect(x + tx, y + ty, flip ? 4 : 1, flip ? 1 : 4);
            height.ctx.fillStyle = '#c8c8c8';
            height.ctx.fillRect(x + tx, y + ty, flip ? 4 : 1, flip ? 1 : 4);
          }
        }
      } else if (kind < 0.36) {
        // Service hatch: a recessed inner panel with two handles.
        const m = 30;
        albedo.ctx.fillStyle = '#0c0e11';
        albedo.ctx.fillRect(x + m - 2, y + m - 2, plate - 2 * m + 4, plate - 2 * m + 4);
        steel(tone - 4);
        albedo.ctx.fillRect(x + m, y + m, plate - 2 * m, plate - 2 * m);
        height.ctx.fillStyle = '#5a5a5a';
        height.ctx.fillRect(x + m - 2, y + m - 2, plate - 2 * m + 4, 2);
        height.ctx.fillRect(x + m - 2, y + m - 2, 2, plate - 2 * m + 4);
        for (const hx of [x + m + 18, x + plate - m - 34]) {
          albedo.ctx.fillStyle = '#0d0f12';
          albedo.ctx.fillRect(hx, y + plate / 2 - 4, 16, 8);
          steel(tone + 16);
          albedo.ctx.fillRect(hx + 2, y + plate / 2 - 1, 12, 2);
        }
      } else if (kind < 0.62) {
        // Split plate: a second seam across.
        const across = random() < 0.5, at = Math.floor(plate * (0.35 + random() * 0.3));
        albedo.ctx.fillStyle = '#0a0c0f';
        if (across) albedo.ctx.fillRect(x + seam, y + at, inner, 2); else albedo.ctx.fillRect(x + at, y + seam, 2, inner);
        steel(tone + 14);
        if (across) albedo.ctx.fillRect(x + seam, y + at + 2, inner, 1); else albedo.ctx.fillRect(x + at + 2, y + seam, 1, inner);
        height.ctx.fillStyle = '#404040';
        if (across) height.ctx.fillRect(x + seam, y + at, inner, 2); else height.ctx.fillRect(x + at, y + seam, 2, inner);
      }

      // Bright bevel on the lit edges, a shadowed one opposite, worn scratches along the edges.
      steel(tone + 30);
      albedo.ctx.fillRect(x + seam, y + seam, inner - 1, 2);
      albedo.ctx.fillRect(x + seam, y + seam, 2, inner - 1);
      steel(tone - 12);
      albedo.ctx.fillRect(x + seam, y + plate - 2, inner, 2);
      albedo.ctx.fillRect(x + plate - 2, y + seam, 2, inner);
      for (let scratch = 0; scratch < 14; scratch++) {
        const along = random() < 0.5, offset = 4 + Math.floor(random() * 10), start = Math.floor(random() * (inner - 40)), length = 6 + Math.floor(random() * 30);
        steel(tone + 12 + random() * 10);
        if (along) albedo.ctx.fillRect(x + seam + start, y + (random() < 0.5 ? seam + offset : plate - offset - 2), length, 1);
        else albedo.ctx.fillRect(x + (random() < 0.5 ? seam + offset : plate - offset - 2), y + seam + start, 1, length);
      }
      // Bolts in the corners.
      for (const [bx, by] of [[10, 10], [plate - 12, 10], [10, plate - 12], [plate - 12, plate - 12]]) {
        albedo.ctx.fillStyle = '#0b0d10';
        albedo.ctx.fillRect(x + bx - 1, y + by - 1, 4, 4);
        steel(tone + 24);
        albedo.ctx.fillRect(x + bx, y + by, 2, 2);
        height.ctx.fillStyle = '#d0d0d0';
        height.ctx.fillRect(x + bx, y + by, 2, 2);
      }
      // The seams: a dark groove, grime spreading a few pixels around it.
      albedo.ctx.fillStyle = '#07080a';
      albedo.ctx.fillRect(x, y, plate, seam);
      albedo.ctx.fillRect(x, y, seam, plate);
      height.ctx.fillStyle = '#202020';
      height.ctx.fillRect(x, y, plate, seam);
      height.ctx.fillRect(x, y, seam, plate);
      roughness.ctx.fillStyle = '#d0d0d0';
      roughness.ctx.fillRect(x, y, plate, seam);
      roughness.ctx.fillRect(x, y, seam, plate);
    }
  }

  // Puddles: smooth (wet) where the noise is high, a little darker too.
  const wet = tilingNoise(4242, 6), detail = tilingNoise(777, 24);
  const rough = roughness.ctx.getImageData(0, 0, size, size), base = albedo.ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const u = (i % size) / size, v = Math.floor(i / size) / size;
    const puddle = Math.min(1, Math.max(0, (wet(u, v) * 0.8 + detail(u, v) * 0.2 - 0.47) / 0.12));
    if (puddle <= 0) continue;
    const k = i * 4;
    const r = rough.data[k] * (1 - puddle) + 62 * puddle;
    rough.data[k] = rough.data[k + 1] = rough.data[k + 2] = r;
    for (let c = 0; c < 3; c++) base.data[k + c] *= 1 - 0.18 * puddle;
  }
  roughness.ctx.putImageData(rough, 0, 0);
  albedo.ctx.putImageData(base, 0, 0);

  const texture = (canvas, isColor = false) => {
    const result = new THREE.CanvasTexture(canvas);
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    // Mipmapped, so the fine wear does not crawl as the camera moves.
    result.magFilter = THREE.NearestFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.anisotropy = 4;
    result.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return result;
  };
  return {
    colorTexture: texture(albedo.canvas, true),
    roughnessTexture: texture(roughness.canvas),
    heightTexture: texture(height.canvas),
  };
}

/** A floor rectangle, flat in XY (to be laid down), with world-space UVs (metres / TILE). */
export function deckGeometry({ minX, maxX, minZ, maxZ }) {
  const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  // Laid down (rotation.x = -π/2) at (cx, cz): local x → world x, local y → world -z.
  for (let i = 0; i < position.count; i++) uv.setXY(i, (cx + position.getX(i)) / TILE, (position.getY(i) - cz) / TILE);
  return { geometry, centre: new THREE.Vector3(cx, 0, cz) };
}

export function createStage(scene, { bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } } = {}) {
  const textures = paintSteelAtlas();
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8dce7,
    map: textures.colorTexture,
    roughnessMap: textures.roughnessTexture,
    roughness: 0.95,
    metalness: 0.62,
    bumpMap: textures.heightTexture,
    bumpScale: 0.014,
    // The puddles mirror the room itself (main.js), not a generic studio.
    envMapIntensity: 0.18,
  });
  const deck = deckGeometry(bounds);
  const floor = new THREE.Mesh(deck.geometry, material);
  floor.name = 'Laboratoire — pont en plaques d’acier';
  floor.rotation.x = -Math.PI / 2;
  // Planar reflections can sit at y=0.002, above this base floor at -0.005.
  floor.position.copy(deck.centre).setY(-0.005);
  floor.receiveShadow = true;
  scene.add(floor);

  return {
    floor,
    material,
    bounds,
    ...textures,
    update() {},
    dispose() {
      scene.remove(floor);
      floor.geometry.dispose();
      material.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
    },
  };
}
