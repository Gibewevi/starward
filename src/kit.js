import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Set dressing helpers. A kit collects static pieces per material and merges
 * them, so a crate with fifty parts — or a whole wall — costs one draw call
 * per material. Pieces are placed in world space or in a local frame (a wall's
 * own axes: along it, up, out of it).
 */
export function createKit() {
  const parts = new Map();
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
  function add(material, geometry, position, rotation = null, frame = null) {
    quaternion.setFromEuler(euler.set(...(rotation ?? [0, 0, 0])));
    matrix.compose(Array.isArray(position) ? at.fromArray(position) : position, quaternion, one);
    if (frame) matrix.premultiply(frame);
    geometry.applyMatrix4(matrix);
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry);
    return geometry;
  }
  return {
    add,
    box: (material, w, h, d, position, rotation = null, frame = null) => add(material, new THREE.BoxGeometry(w, h, d), position, rotation, frame),
    cylinder: (material, top, bottom, h, segments, position, rotation = null, frame = null) => add(material, new THREE.CylinderGeometry(top, bottom, h, segments), position, rotation, frame),
    /** Merges everything into one mesh per material, under `parent`. */
    build(parent, { name = 'Set', shadows = true } = {}) {
      const meshes = [];
      for (const [material, list] of parts) {
        const mesh = new THREE.Mesh(mergeGeometries(list), material);
        mesh.name = `${name} (${material.name || material.type})`;
        mesh.castShadow = shadows && material.type !== 'MeshBasicMaterial';
        mesh.receiveShadow = material.type !== 'MeshBasicMaterial';
        parent.add(mesh);
        meshes.push(mesh);
        for (const geometry of list) geometry.dispose();
      }
      parts.clear();
      return meshes;
    },
  };
}

/** A wall's frame: x along it, y up, z out of it (towards the room), origin at `origin`. */
export function frameOf(origin, along) {
  const up = new THREE.Vector3(0, 1, 0), out = new THREE.Vector3().crossVectors(along, up);
  return new THREE.Matrix4().makeBasis(along, up, out).setPosition(origin);
}

let softGlow = null;
/** A soft round glow (white, alpha falling off), shared by light pools and haze. */
export function glowTexture() {
  if (softGlow) return softGlow;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.min(1, Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1));
    data.set([255, 255, 255, Math.round((1 - d) ** 2.2 * 255)], (y * n + x) * 4);
  }
  softGlow = new THREE.DataTexture(data, n, n);
  softGlow.magFilter = softGlow.minFilter = THREE.LinearFilter;
  softGlow.needsUpdate = true;
  return softGlow;
}

let lineGlow = null;
/** The glow along a strip light: falling off across it, fading at both ends. */
export function lineGlowTexture() {
  if (lineGlow) return lineGlow;
  const w = 32, h = 64, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const across = Math.abs((x + 0.5) / w * 2 - 1), along = (y + 0.5) / h;
    const ends = THREE.MathUtils.smoothstep(along, 0, 0.14) * THREE.MathUtils.smoothstep(1 - along, 0, 0.14);
    data.set([255, 255, 255, Math.round((1 - across) ** 2.4 * ends * 255)], (y * w + x) * 4);
  }
  lineGlow = new THREE.DataTexture(data, w, h);
  lineGlow.magFilter = lineGlow.minFilter = THREE.LinearFilter;
  lineGlow.needsUpdate = true;
  return lineGlow;
}

/**
 * The slow blink of the red floor lights: mostly on or mostly off, fading
 * between the two over about half a second; 0.18 at its darkest.
 */
export function blink(time, phase = 0, period = 3.4) {
  const s = Math.sin((time / period + phase) * Math.PI * 2);
  const t = THREE.MathUtils.smoothstep(s, -0.45, 0.45);
  return 0.18 + 0.82 * t;
}

// Red the bloom keeps red: the frame is tone-mapped (ACES) after the bloom, and
// brighter than this, red turns orange.
export const RED = new THREE.Color(0.78, 0.008, 0.008);
export const AMBER = new THREE.Color(0.8, 0.3, 0.015);
