import * as THREE from 'three';
import { capsule, ellipsoid, polygonize, roundedBox, smooth, subtract, union } from './sdf.js';
import { gradeCharacterMaterial } from './character-shading.js';

/**
 * Head of the reference sprite: a squarish face under thick, shaggy dark
 * brown hair with an uneven fringe, locks over the ears and a full back. Built in
 * the Head bone's space (origin at the top of the neck, +Z forward).
 */
export function createJediHead() {
  const group = new THREE.Group();
  group.name = 'Jedi head';

  function faceField(x, y, z) {
    let d = ellipsoid(x, y, z, 0, 0.175, 0.004, 0.106, 0.14, 0.118);
    // A broad, slightly squared jaw.
    d = union(d, roundedBox(x, y, z, 0, 0.105, 0.03, 0.088, 0.072, 0.082, 0.05), 0.04);
    d = union(d, ellipsoid(x, y, z, 0, 0.128, 0.112, 0.017, 0.03, 0.022), 0.012);
    for (const side of [-1, 1]) d = union(d, ellipsoid(x, y, z, side * 0.104, 0.15, -0.01, 0.018, 0.032, 0.024), 0.01);
    return union(d, capsule(x, y, z, { x: 0, y: -0.04, z: -0.012 }, { x: 0, y: 0.07, z: -0.004 }, 0.052), 0.03);
  }
  const face = polygonize(faceField, { minX: -0.15, minY: -0.06, minZ: -0.15, maxX: 0.15, maxY: 0.34, maxZ: 0.16 }, 0.015);
  const skin = new THREE.Color('#c99171'), cheek = new THREE.Color('#a8745a');
  const stubble = new THREE.Color('#7f5747'), brow = new THREE.Color('#2d1d18');
  const faceColors = new Float32Array(face.positions.length);
  const c = new THREE.Color();
  for (let i = 0; i < face.positions.length; i += 3) {
    const x = face.positions[i], y = face.positions[i + 1], z = face.positions[i + 2];
    c.copy(skin).lerp(cheek, smooth(0.05, 0.1, Math.abs(x)) * 0.6 + (1 - smooth(-0.02, 0.06, z)) * 0.3);
    // Short beard shadow along the jaw and around the mouth.
    c.lerp(stubble, (1 - smooth(0.06, 0.11, y)) * smooth(0.0, 0.05, z) * 0.75);
    c.lerp(brow, (1 - smooth(0.004, 0.01, Math.abs(y - 0.182 + Math.abs(x) * 0.08))) * smooth(0.018, 0.026, Math.abs(x)) * (1 - smooth(0.07, 0.08, Math.abs(x))) * smooth(0.07, 0.09, z));
    faceColors.set([c.r, c.g, c.b], i);
  }
  group.add(mesh('Face', face, faceColors));

  const eyes = new THREE.Group();
  const eyeMaterial = gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0x1d1a1f }));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.012), eyeMaterial);
    eye.position.set(side * 0.043, 0.162, 0.114);
    eye.rotation.y = side * 0.32;
    eyes.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.007, 0.01), gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0x5b3a33 })));
  mouth.position.set(0, 0.08, 0.113);
  eyes.add(mouth);
  eyes.name = 'Eyes and mouth';
  group.add(eyes);

  // Shaggy hair built from tapered locks over a soft cap. Locks fall from the
  // crown to the ears and the nape, the fringe is a row of uneven strands
  // swept to one side, and smooth unions leave grooves between the clumps.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lockList = [];
  const addLock = (root, middle, tip, radii) => lockList.push({ points: [root, middle, tip].map(([x, y, z]) => ({ x, y, z })), radii });
  for (let i = 0; i < 15; i++) {
    const angle = 0.98 + (i + 0.5) / 15 * (Math.PI * 2 - 1.96) + (random() - 0.5) * 0.12;
    const back = smooth(1.6, 3.0, Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))));
    const reach = 0.13 + random() * 0.012;
    addLock(
      [Math.sin(angle) * 0.07, 0.36 + random() * 0.02, Math.cos(angle) * 0.075 - 0.02],
      [Math.sin(angle) * 0.136, 0.262 - random() * 0.02, Math.cos(angle) * 0.145 - 0.03],
      [Math.sin(angle) * reach, 0.125 - back * 0.07 + (random() - 0.5) * 0.035, Math.cos(angle) * reach - 0.04],
      [0.048, 0.042, 0.013 + random() * 0.006]);
  }
  // Fringe strands of uneven length, swept towards the left temple.
  const fringeTips = [0.2, 0.232, 0.178, 0.214, 0.19, 0.226, 0.2];
  fringeTips.forEach((tip, i) => {
    const x = -0.096 + i * 0.031 + (random() - 0.5) * 0.01;
    addLock([x * 0.35 - 0.02, 0.375, 0.015], [x * 0.8 + 0.012, 0.318, 0.104],
      [x + 0.03, tip + (random() - 0.5) * 0.01, 0.124], [0.04, 0.032, 0.01 + random() * 0.005]);
  });
  for (const [x, z, lean] of [[-0.05, -0.04, -1], [0.035, 0.01, 1], [0.0, -0.09, 0]]) {
    addLock([x * 0.5, 0.35, z * 0.5], [x + lean * 0.015, 0.4, z], [x + lean * 0.04, 0.405, z - 0.03], [0.04, 0.034, 0.014]);
  }
  function lockDistance(x, y, z, lock) {
    const [a, b, c] = lock.points, [ra, rb, rc] = lock.radii;
    return union(capsule(x, y, z, a, b, ra, rb), capsule(x, y, z, b, c, rb, rc), 0.012);
  }
  function hairField(x, y, z) {
    // The cap stays back from the forehead: only fringe strands cover it.
    let d = ellipsoid(x, y, z, 0, 0.262, -0.04, 0.134, 0.142, 0.13);
    for (const lock of lockList) d = union(d, lockDistance(x, y, z, lock), 0.018);
    d += Math.sin(x * 61 + y * 23) * Math.sin(z * 47 - y * 31) * 0.003;
    // The face shows below the fringe, framed by the side locks.
    const top = 0.172;
    const window = roundedBox(x, y, z, 0, (top - 0.08) / 2, 0.15, 0.1, (top + 0.08) / 2, 0.13, 0.012);
    d = subtract(d, window, 0.01);
    // Keep the hair clear of the face's surface so neither pokes through.
    return Math.max(d, -faceField(x, y, z) - 0.006);
  }
  const hair = polygonize(hairField, { minX: -0.21, minY: -0.02, minZ: -0.22, maxX: 0.21, maxY: 0.46, maxZ: 0.2 }, 0.013);
  const dark = new THREE.Color('#2e1d16'), mid = new THREE.Color('#4a3125'), light = new THREE.Color('#6b4836');
  const hairColors = new Float32Array(hair.positions.length);
  const tones = lockList.map(() => 0.75 + random() * 0.5);
  for (let i = 0; i < hair.positions.length; i += 3) {
    const x = hair.positions[i], y = hair.positions[i + 1], z = hair.positions[i + 2];
    // Nearest two locks: grooves between clumps are darker, tips catch light.
    let first = Infinity, second = Infinity, owner = 0;
    lockList.forEach((lock, index) => {
      const distance = lockDistance(x, y, z, lock);
      if (distance < first) { second = first; first = distance; owner = index; } else if (distance < second) second = distance;
    });
    const groove = 1 - smooth(0.0, 0.016, second - first);
    const tipY = lockList[owner].points[2].y, rootY = lockList[owner].points[0].y;
    const along = smooth(0.3, 1, (rootY - y) / Math.max(0.05, rootY - tipY));
    c.copy(mid).multiplyScalar(tones[owner]);
    c.lerp(light, smooth(0.55, 0.95, hair.normals[i + 1]) * 0.55 + along * 0.18);
    c.lerp(dark, groove * 0.55 + (1 - smooth(0.04, 0.14, y)) * 0.4);
    hairColors.set([c.r, c.g, c.b], i);
  }
  group.add(mesh('Shaggy hair', hair, hairColors));

  function mesh(name, data, colors) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(data.indices);
    geometry.computeBoundingSphere();
    const value = new THREE.Mesh(geometry, gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })));
    value.name = name;
    value.castShadow = true;
    value.receiveShadow = true;
    return value;
  }
  return group;
}
