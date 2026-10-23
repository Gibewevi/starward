import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hash } from './jungle-ground.js';

/**
 * The ruins in the jungle: old machines of dark metal and stone, half taken
 * by the plants — chamfered blocks plated in panels (grooves that catch the
 * light, seams, rivets, grime), some capped, the tall ones banded; white
 * strips of light still burning in their faces, red diodes blinking under
 * them, a warm lamp pooling on the mud in front; ivy hanging down their faces
 * and over their tops, cushions of moss.
 *
 * buildRuins(group, { random }) → { obstacles, lamps, diodes, update(time) }.
 * The faces the camera sees are +x and +z: that is where the lights are.
 */
// [x, z, width (x), height, depth (z), lit faces, kind]
export const RUINS = [
  // The back wall of the clearing (facing +z) and its left side (facing +x): tall pillars.
  ...[-10.4, -7.2, -4, -0.8, 2.4, 5.6, 8.8].map((x, i) => [x, -8.4, 1.3, 3.4 + (i % 3) * 0.5, 1.2, i % 2 ? ['+z'] : [], 'wall']),
  ...[-5.4, -2.2, 1, 4.2, 7.4].map((z, i) => [-11.4, z, 1.2, 3 + (i % 2) * 0.6, 1.3, i % 2 ? [] : ['+x'], 'wall']),
  // Blocks in the clearing: cover.
  [-6.4, -5.2, 1.4, 1.2, 1.4, ['+z'], 'block'],
  [-2.4, -6.1, 2.4, 0.9, 1, ['+z'], 'block'],
  [3, -5.4, 1.2, 1.7, 1.2, ['+x'], 'block'],
  [7.2, -4.4, 1.4, 1.1, 1.4, ['+z'], 'block'],
  [-8.4, -2.6, 1.2, 1.4, 1.2, ['+x'], 'block'],
  [1.6, -2.4, 1, 1, 1, [], 'block'],
  [5.2, 0.6, 2.4, 0.8, 0.9, [], 'block'],
  [-4.6, 0.2, 1.3, 1.2, 1.3, ['+x'], 'block'],
  [-5.4, 7.4, 1.3, 1.25, 1.3, ['+z'], 'block'],
  [9.6, 7.6, 1.2, 1.5, 1.2, ['+x'], 'block'],
  [10.2, -1.4, 1.3, 1.3, 1.3, ['+z'], 'block'],
];

/** The plating, 32 texels a metre over 2 × 2 m: colour and roughness. */
function plating() {
  if (typeof document === 'undefined') return { map: null, roughnessMap: null };
  const S = 64, make = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const colourCanvas = make(), roughCanvas = make();
  const colour = colourCanvas.getContext('2d').createImageData(S, S), rough = roughCanvas.getContext('2d').createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    // Courses of panels 0.5 m high, seams staggered course to course.
    const course = Math.floor(j / 16), row = j % 16, seam = (i + (course % 2) * 21) % 32;
    const groove = row === 0, lip = row === 1, edge = seam === 0, rivet = (row === 3 || row === 12) && (seam === 3 || seam === 28);
    const panel = hash(Math.floor((i + (course % 2) * 21) / 32), course);
    let v = 0.19 + 0.05 * panel + 0.025 * hash(i * 0.7, j * 1.3);
    // Grime running down from the grooves.
    v *= 1 - 0.25 * Math.max(0, hash(i, course * 7) - 0.6) * (1 - row / 16);
    let r = 0.52 + 0.12 * panel;
    if (groove || edge) { v = 0.035; r = 0.85; }
    else if (lip) { v = 0.34; r = 0.35; }
    else if (rivet) { v = 0.42; r = 0.3; }
    const moss = !groove && hash(i * 3.3, j * 7.1) > 0.965 ? 1 : 0;
    const c = moss ? [0.07, 0.12, 0.04] : [v * 0.72, v * 0.92, v * 1.17];
    colour.data.set(c.map(value => value * 255).concat(255), (j * S + i) * 4);
    rough.data.set([r * 255, r * 255, r * 255, 255], (j * S + i) * 4);
  }
  return [colourCanvas, roughCanvas].reduce((out, canvas, index) => {
    canvas.getContext('2d').putImageData(index ? rough : colour, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    if (!index) texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    out[index ? 'roughnessMap' : 'map'] = texture;
    return out;
  }, {});
}

/** Metal plating laid on in world space (2 m to a tile, whatever the block's size), seen from each side. */
function platedMaterial() {
  const { map, roughnessMap } = plating();
  const material = new THREE.MeshStandardMaterial({ name: 'ruin plating', map, roughnessMap, color: 0xffffff, roughness: 1, metalness: 0.35, flatShading: true, envMapIntensity: 0.4 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTri; varying vec3 vTriN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTri = (modelMatrix * vec4(transformed, 1.0)).xyz; vTriN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTri; varying vec3 vTriN;')
      .replace('#include <map_fragment>', `
        vec3 tn = abs(vTriN);
        vec2 tuv = (tn.y > max(tn.x, tn.z) ? vTri.xz : tn.x > tn.z ? vec2(vTri.z, vTri.y) : vTri.xy) * 0.5;
        #ifdef USE_MAP
          diffuseColor *= texture2D(map, tuv);
        #endif`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D(roughnessMap, tuv).g;
        #endif`);
  };
  return material;
}

/** A small leaf: a diamond, pointed down its stem. */
function leafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.5, 0.45, 0, 0, 1, 0, -0.5, 0.45, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function buildRuins(group, { random = Math.random } = {}) {
  const obstacles = [], lamps = [], plated = [], bands = [], strips = [], frames = [], mossy = [], leds = [];
  const leaves = [];
  const faceNormals = { '+x': new THREE.Vector3(1, 0, 0), '-x': new THREE.Vector3(-1, 0, 0), '+z': new THREE.Vector3(0, 0, 1), '-z': new THREE.Vector3(0, 0, -1) };
  const box = (w, h, d, x, y, z, radius = 0.04) => new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 4, h / 4, d / 4)).translate(x, y, z);
  /** Ivy down one face of a block from its top: strands of leaves, thicker near the corners. */
  function ivy(x, z, w, h, d, face, amount) {
    const normal = faceNormals[face], across = new THREE.Vector3(normal.z, 0, -normal.x);
    const span = face[1] === 'x' ? d : w, out = face[1] === 'x' ? w / 2 : d / 2;
    const strands = Math.round(span * 5 * amount);
    for (let s = 0; s < strands; s++) {
      const t = (random() - 0.5) * span * 0.95, length = h * (0.12 + random() * 0.88 * Math.sqrt(random()));
      for (let y = h + 0.04; y > h - length; y -= 0.045 + random() * 0.03) {
        const wander = Math.sin(y * 5 + s) * 0.04;
        const at = new THREE.Vector3(x, y, z).addScaledVector(normal, out + 0.015 + random() * 0.03).addScaledVector(across, t + wander + (random() - 0.5) * 0.06);
        leaves.push({ at, normal, size: 0.07 + random() * 0.06, droop: 0.4 + random() * 0.6, spin: (random() - 0.5) * 1.6 });
      }
    }
  }
  for (const [x, z, w, h, d, lit, kind] of RUINS) {
    obstacles.push({ kind: kind === 'wall' ? 'pillar' : 'crate', min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2), centre: new THREE.Vector3(x, h / 2, z) });
    plated.push(box(w, h, d, x, h / 2, z, 0.05));
    // Raised corner rails and a bevelled plinth give each ruin a readable
    // silhouette and catch the cold rim light between the ivy strands.
    bands.push(box(w + 0.08, 0.12, d + 0.08, x, 0.12, z, 0.025));
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      bands.push(box(0.07, h - 0.2, 0.07, x + dx * (w / 2 - 0.025), h / 2, z + dz * (d / 2 - 0.025), 0.015));
    }
    if (kind === 'wall') {
      // Bands round the tall ones: plates stacked.
      for (let y = 0.9 + random() * 0.4; y < h - 0.4; y += 0.9 + random() * 0.5) bands.push(box(w + 0.06, 0.1, d + 0.06, x, y, z, 0.03));
    } else if (random() < 0.7) {
      // A cap, set back a little.
      plated.push(box(w - 0.14, 0.14, d - 0.14, x, h + 0.07, z, 0.03));
    }
    // Moss lying on top.
    for (let n = 0; n < 2; n++) {
      const mw = w * (0.25 + random() * 0.4), md = d * (0.25 + random() * 0.4);
      mossy.push(box(mw, 0.04, md, x + (random() - 0.5) * (w - mw), h + 0.02 + (kind === 'block' ? 0.14 : 0), z + (random() - 0.5) * (d - md), 0.02));
    }
    // Ivy over the faces the camera sees, more on the tall ones, and creeping over the top from the edges.
    for (const face of ['+x', '+z']) ivy(x, z, w, h, d, face, kind === 'wall' ? 1.2 : 0.8);
    const top = h + (kind === 'block' ? 0.14 : 0) + 0.01;
    for (let n = Math.round(w * d * 30); n > 0; n--) {
      const u = random() - 0.5, v = random() - 0.5, edge = Math.max(Math.abs(u), Math.abs(v));
      if (random() > edge * 2.2) continue;
      leaves.push({ at: new THREE.Vector3(x + u * w * 0.98, top, z + v * d * 0.98), normal: new THREE.Vector3(0, 1, 0), size: 0.07 + random() * 0.06, droop: 0.1, spin: random() * Math.PI * 2, flat: true });
    }
    for (const face of lit) {
      // A white strip set in a dark frame, diodes beside it, a warm lamp in front.
      const normal = faceNormals[face], across = new THREE.Vector3(normal.z, 0, -normal.x);
      const out = (face[1] === 'x' ? w : d) / 2, span = face[1] === 'x' ? d : w;
      const tall = Math.min(2.4, h * 0.65), mid = Math.min(h * 0.55, h - tall / 2 - 0.15);
      const offset = (random() - 0.5) * span * 0.4;
      const centre = new THREE.Vector3(x, mid, z).addScaledVector(normal, out).addScaledVector(across, offset);
      const flat = (a, b, c) => (face[1] === 'x' ? new THREE.BoxGeometry(c, b, a) : new THREE.BoxGeometry(a, b, c));
      frames.push(flat(0.16, tall + 0.1, 0.04).translate(centre.x, centre.y, centre.z));
      const strip = centre.clone().addScaledVector(normal, 0.022);
      strips.push(flat(0.06, tall, 0.02).translate(strip.x, strip.y, strip.z));
      // Small metal braces break up the luminous panel like the old fixtures
      // in the ruins, while preserving an unbroken pool of light below it.
      for (const t of [-0.27, 0.27]) {
        const brace = strip.clone().addScaledVector(normal, 0.018);
        frames.push(flat(0.13, 0.035, 0.025).translate(brace.x, brace.y + tall * t, brace.z));
      }
      for (let k = 0; k < 3; k++) {
        const led = centre.clone().addScaledVector(normal, 0.012).addScaledVector(across, 0.17).setY(centre.y + tall / 2 - 0.08 - k * 0.09);
        leds.push(flat(0.045, 0.045, 0.02).translate(led.x, led.y, led.z));
      }
      const lamp = new THREE.PointLight(0xffba78, 8.5, 6.5, 1.8);
      lamp.position.copy(centre).addScaledVector(normal, 0.45);
      group.add(lamp);
      lamps.push(lamp);
    }
    // Diodes on most blocks, lit or not: a column of red points.
    if (!lit.length && random() < 0.8) {
      const face = random() < 0.5 ? '+x' : '+z', normal = faceNormals[face], across = new THREE.Vector3(normal.z, 0, -normal.x);
      const out = (face[1] === 'x' ? w : d) / 2, span = face[1] === 'x' ? d : w;
      const flat = (a, b, c) => (face[1] === 'x' ? new THREE.BoxGeometry(c, b, a) : new THREE.BoxGeometry(a, b, c));
      const base = new THREE.Vector3(x, h * 0.6, z).addScaledVector(normal, out + 0.012).addScaledVector(across, (random() - 0.5) * span * 0.6);
      for (let k = 0; k < 2 + Math.floor(random() * 3); k++) leds.push(flat(0.045, 0.045, 0.02).translate(base.x, base.y - k * 0.09, base.z));
    }
  }

  // The open doorway above the reinforcement trail: only overhead dressing,
  // keeping the existing path and collision geometry unchanged.
  plated.push(box(3.2, 0.48, 1.2, 4, 3.85, -8.4, 0.06));
  bands.push(box(3.35, 0.1, 1.3, 4, 4.11, -8.4, 0.025));
  const plating = platedMaterial();
  const ledMaterial = new THREE.MeshBasicMaterial({ name: 'red diodes', color: new THREE.Color(2.6, 0.12, 0.08), toneMapped: false });
  const parts = [
    [plated, plating, 'Ruins', true],
    [bands, plating, 'Ruin bands', true],
    [frames, new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.4, metalness: 0.6 }), 'Ruin light frames', false],
    [strips, new THREE.MeshBasicMaterial({ name: 'ruin light strips', color: new THREE.Color(4.5, 3.05, 1.65), toneMapped: false }), 'Ruin lights', false],
    [leds, ledMaterial, 'Ruin diodes', false],
    [mossy, new THREE.MeshStandardMaterial({ color: 0x2a3d1c, roughness: 0.95 }), 'Moss', true],
  ];
  for (const [geometries, material, name, shadows] of parts) {
    if (!geometries.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geometries.map(g => (g.index ? g.toNonIndexed() : g))), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  // The ivy: one instanced mesh of leaves, each facing out of its wall and drooping.
  const ivyMesh = new THREE.InstancedMesh(leafGeometry(), new THREE.MeshStandardMaterial({ name: 'ivy', side: THREE.DoubleSide, roughness: 0.65 }), Math.max(1, leaves.length));
  ivyMesh.name = 'Ivy';
  ivyMesh.castShadow = ivyMesh.receiveShadow = true;
  const matrix = new THREE.Matrix4(), basis = new THREE.Matrix4(), colour = new THREE.Color(), down = new THREE.Vector3();
  leaves.forEach((leaf, i) => {
    if (leaf.flat) {
      // Lying on a top: flat, turned any way, tipped a little.
      basis.makeRotationFromEuler(new THREE.Euler(-Math.PI / 2 + (random() - 0.5) * 0.6, 0, leaf.spin, 'YXZ'));
      ivyMesh.setMatrixAt(i, matrix.copy(basis).scale(new THREE.Vector3(leaf.size, leaf.size, leaf.size)).setPosition(leaf.at));
      ivyMesh.setColorAt(i, colour.setRGB(0.05 + random() * 0.1, 0.12 + random() * 0.15, 0.04 + random() * 0.04));
      return;
    }
    // The leaf hangs from its point (local y up its blade), leaning out of the wall.
    const side = new THREE.Vector3(leaf.normal.z, 0, -leaf.normal.x);
    down.set(0, -1, 0).applyAxisAngle(leaf.normal, leaf.spin);
    const blade = down.clone().multiplyScalar(-1).addScaledVector(leaf.normal, leaf.droop).normalize();
    const face = new THREE.Vector3().crossVectors(side.applyAxisAngle(leaf.normal, leaf.spin), blade).normalize();
    basis.makeBasis(side, blade, face);
    matrix.copy(basis).scale(new THREE.Vector3(leaf.size, leaf.size, leaf.size)).setPosition(leaf.at.x, leaf.at.y - leaf.size, leaf.at.z);
    ivyMesh.setMatrixAt(i, matrix);
    const shade = random();
    ivyMesh.setColorAt(i, shade > 0.92 ? colour.setRGB(0.32, 0.42, 0.12) : colour.setRGB(0.06 + shade * 0.1, 0.13 + shade * 0.16, 0.04 + shade * 0.05));
  });
  ivyMesh.count = leaves.length;
  group.add(ivyMesh);

  // The diodes blink, each column at its own slow pace.
  function update(time) {
    const on = 0.55 + 0.45 * Math.sin(time * 2.1) * Math.sin(time * 0.7 + 1);
    ledMaterial.color.setRGB(2.6 * (0.45 + 0.55 * on), 0.12, 0.08);
  }
  return { obstacles, lamps, ivy: ivyMesh, update };
}
