import * as THREE from 'three';

// All surface art is deterministic, painted in whole pixels and sampled without
// interpolation. The stage remains a completely empty, level testing floor.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvasLayer(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d', { alpha: false }) };
}

function paintSteelAtlas() {
  const size = 768;
  const albedo = canvasLayer(size);
  const roughness = canvasLayer(size);
  const height = canvasLayer(size);
  const color = (r, g = r, b = r) => `rgb(${r | 0},${g | 0},${b | 0})`;

  albedo.ctx.fillStyle = '#15191f';
  albedo.ctx.fillRect(0, 0, size, size);
  roughness.ctx.fillStyle = '#888888';
  roughness.ctx.fillRect(0, 0, size, size);
  height.ctx.fillStyle = '#707070';
  height.ctx.fillRect(0, 0, size, size);

  // Rectangular offset steel sheets: the pattern reads as architecture rather
  // than a square board-game grid. One sheet measures 1.6 x 1.2 metres.
  for (let row = 0; row < 8; row += 1) {
    for (let column = -1; column < 7; column += 1) {
      // Edge halves use the same seed, so staggered plates wrap invisibly.
      const random = seededRandom(230945 + row * 911 + ((column + 6) % 6) * 104729);
      const x = column * 128 + (row % 2) * 64;
      const y = row * 96;
      const panelTone = 43 + Math.floor(random() * 13);
      const panelRoughness = 112 + Math.floor(random() * 36);
      albedo.ctx.fillStyle = color(panelTone - 3, panelTone, panelTone + 5);
      albedo.ctx.fillRect(x + 2, y + 2, 124, 92);
      roughness.ctx.fillStyle = color(panelRoughness);
      roughness.ctx.fillRect(x + 2, y + 2, 124, 92);
      height.ctx.fillStyle = '#a4a4a4';
      height.ctx.fillRect(x + 2, y + 2, 124, 92);

      // Broad irregular polishing / oxidation patches vary both highlight size
      // and colour, with sharp pixel clusters instead of photographic noise.
      for (let patch = 0; patch < 48; patch += 1) {
        const patchX = x + 4 + Math.floor(random() * 117);
        const patchY = y + 4 + Math.floor(random() * 85);
        const width = 2 + Math.floor(random() * 13);
        const heightPx = 1 + Math.floor(random() * 5);
        const tone = panelTone - 7 + Math.floor(random() * 15);
        albedo.ctx.fillStyle = color(tone - 3, tone, tone + 5);
        albedo.ctx.fillRect(patchX, patchY, Math.min(width, x + 124 - patchX), heightPx);
        roughness.ctx.fillStyle = color(panelRoughness - 24 + random() * 50);
        roughness.ctx.fillRect(patchX, patchY, Math.min(width, x + 124 - patchX), heightPx);
      }

      // Surface grain is intentionally sparse; the low resolution renderer
      // preserves quiet areas where the blue blade reflection can read clearly.
      for (let fleck = 0; fleck < 540; fleck += 1) {
        const px = x + 4 + Math.floor(random() * 120);
        const py = y + 4 + Math.floor(random() * 88);
        const tone = panelTone - 9 + Math.floor(random() * 19);
        albedo.ctx.fillStyle = color(tone - 3, tone, tone + 5);
        albedo.ctx.fillRect(px, py, random() > 0.86 ? 2 : 1, 1);
      }

      // Single-pixel bevels and restrained recessed fasteners catch the same
      // light direction as the faceted character without large geometric seams.
      albedo.ctx.fillStyle = color(panelTone + 12, panelTone + 15, panelTone + 19);
      albedo.ctx.fillRect(x + 2, y + 2, 123, 1);
      albedo.ctx.fillRect(x + 2, y + 3, 1, 90);
      albedo.ctx.fillStyle = '#1a1e25';
      albedo.ctx.fillRect(x + 3, y + 93, 123, 1);
      albedo.ctx.fillRect(x + 125, y + 3, 1, 91);
      for (const [dx, dy] of [[7, 7], [120, 7], [7, 88], [120, 88]]) {
        albedo.ctx.fillStyle = '#20252b';
        albedo.ctx.fillRect(x + dx - 1, y + dy - 1, 3, 3);
        albedo.ctx.fillStyle = '#555c65';
        albedo.ctx.fillRect(x + dx, y + dy, 1, 1);
        height.ctx.fillStyle = '#646464';
        height.ctx.fillRect(x + dx - 1, y + dy - 1, 3, 3);
      }

      // Hairline directional scratches, not a blanket noisy grunge overlay.
      for (let scratch = 0; scratch < 7; scratch += 1) {
        const px = x + 10 + Math.floor(random() * 90);
        const py = y + 9 + Math.floor(random() * 76);
        const length = 3 + Math.floor(random() * 21);
        const tone = panelTone + 8 + Math.floor(random() * 10);
        albedo.ctx.fillStyle = color(tone, tone + 2, tone + 4);
        albedo.ctx.fillRect(px, py, length, 1);
        roughness.ctx.fillStyle = '#626262';
        roughness.ctx.fillRect(px, py, length, 1);
      }

      // Infrequent faded alignment marks are paint on the floor, never props.
      if ((row * 7 + column + 1) % 13 === 3) {
        for (let segment = 0; segment < 2; segment += 1) {
          for (let py = 0; py < 3; py += 1) {
            for (let px = 0; px < 23; px += 1) {
              if (random() < 0.29) continue;
              const tone = 71 + Math.floor(random() * 15);
              albedo.ctx.fillStyle = color(tone + 3, tone + 1, tone - 7);
              albedo.ctx.fillRect(x + 17 + segment * 70 + px, y + 13 + py, 1, 1);
            }
          }
        }
      }
    }
  }

  const texture = (canvas, isColor = false) => {
    const result = new THREE.CanvasTexture(canvas);
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(80 / 9.6, 80 / 9.6);
    result.magFilter = THREE.NearestFilter;
    result.minFilter = THREE.NearestFilter;
    result.generateMipmaps = false;
    result.anisotropy = 1;
    result.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return result;
  };

  return {
    colorTexture: texture(albedo.canvas, true),
    roughnessTexture: texture(roughness.canvas),
    heightTexture: texture(height.canvas),
  };
}

export function createStage(scene) {
  const textures = paintSteelAtlas();
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8dce7,
    map: textures.colorTexture,
    roughnessMap: textures.roughnessTexture,
    roughness: 0.94,
    metalness: 0.58,
    bumpMap: textures.heightTexture,
    bumpScale: 0.012,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material);
  floor.name = 'Laboratoire — panneaux métalliques';
  floor.rotation.x = -Math.PI / 2;
  // Planar reflections can sit at y=0.002, above this base floor at -0.005.
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  scene.add(floor);

  return {
    floor,
    material,
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
