import * as THREE from 'three';
import { capsule, clamp, ellipsoid, polygonize, roundedBox, smooth, union, along } from './sdf.js';
import { gradeCharacterMaterial } from './character-shading.js';

/**
 * One continuous, closed, skinned surface for the dressed Jedi: long coat over
 * the torso and sleeves, light tunic in the front opening, hands, trousers and
 * boots. It is sculpted around the rig's bind pose (lowered arms) and every
 * vertex blends between neighbouring bones, so shoulders, spine, elbows, hips,
 * knees and ankles bend without seams. The coat skirt is simulated separately.
 */
export const PALETTE = {
  coat: '#5a3b2e', coatShade: '#46302a', coatEdge: '#6a4a3c', collar: '#604236',
  tunic: '#8c7a66', tunicShade: '#6f5f50', skin: '#c28a68',
  trousers: '#34261f', boot: '#2b1d18', bootCuff: '#44302a', sole: '#171210', lining: '#2a1d19',
};

export function createAvatarSurface({ bones, list }) {
  const names = list.map(bone => bone.name);
  const ids = Object.fromEntries(names.map((name, index) => [name, index]));
  const p = name => bones[name].getWorldPosition(new THREE.Vector3());
  const sides = [['Left', 1], ['Right', -1]].map(([side, sign]) => {
    const arm = p(`${side}Arm`), fore = p(`${side}ForeArm`), hand = p(`${side}Hand`);
    const direction = hand.clone().sub(fore).normalize();
    return {
      side, sign, clavicle: p(`${side}Shoulder`), arm, fore, hand, direction,
      cuff: hand.clone().addScaledVector(direction, -0.035),
      fist: hand.clone().addScaledVector(direction, 0.05),
      hip: p(`${side}UpLeg`), knee: p(`${side}Leg`), ankle: p(`${side}Foot`), toe: p(`${side}ToeBase`),
      bootTop: p(`${side}Foot`).add(new THREE.Vector3(0, 0.15, 0.004)),
    };
  });

  // Coat torso: elliptical sections [height, half width, half depth, centre z].
  const profile = [
    [0.60, 0.135, 0.105, 0], [0.70, 0.155, 0.115, 0], [0.80, 0.162, 0.118, 0.004],
    [0.88, 0.178, 0.126, 0.008], [0.96, 0.192, 0.13, 0.006], [1.02, 0.196, 0.128, -0.002],
    [1.07, 0.178, 0.118, -0.008], [1.11, 0.135, 0.1, -0.012], [1.15, 0.085, 0.075, -0.014],
  ];
  function section(y) {
    if (y <= profile[0][0]) return profile[0];
    for (let i = 1; i < profile.length; i++) {
      if (y <= profile[i][0]) {
        const a = profile[i - 1], b = profile[i], t = (y - a[0]) / (b[0] - a[0]);
        return [y, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
      }
    }
    return profile.at(-1);
  }
  function torsoField(x, y, z) {
    const [, rx, rz, cz] = section(y);
    const radial = (Math.hypot(x / rx, (z - cz) / rz) - 1) * Math.min(rx, rz);
    let distance = Math.max(radial, 0.60 - y, y - 1.16);
    for (const s of sides) {
      // Rounded coat shoulders that slope into the sleeves.
      distance = union(distance, ellipsoid(x, y, z, s.sign * 0.165, 1.035, -0.006, 0.078, 0.062, 0.09), 0.04);
    }
    // A bunched hood rests around the back and sides of the neck.
    const front = smooth(-0.01, 0.08, z);
    const ring = Math.hypot(Math.hypot(x, (z + 0.02) * 1.12) - 0.1, (y - 1.148) * 1.05) - (0.05 - 0.026 * front);
    distance = union(distance, ring, 0.03);
    distance = union(distance, ellipsoid(x, y, z, 0, 1.15, -0.1, 0.125, 0.06, 0.062), 0.03);
    const neck = capsule(x, y, z, { x: 0, y: 1.08, z: -0.012 }, { x: 0, y: 1.215, z: -0.006 }, 0.056);
    return union(distance, neck, 0.02);
  }
  function armField(x, y, z, s) {
    let distance = capsule(x, y, z, s.arm, s.fore, 0.066, 0.058);
    distance = union(distance, capsule(x, y, z, s.fore, s.cuff, 0.058, 0.066), 0.02);
    // Cuff hem: the sleeve ends in a flat ring, the wrist continues inside.
    distance = Math.max(distance, along(x, y, z, s.fore, s.cuff) * 0.225 - 0.225);
    distance = union(distance, capsule(x, y, z, s.cuff, s.hand, 0.034), 0.01);
    const fist = capsule(x, y, z, s.hand, s.fist, 0.041, 0.039);
    distance = union(distance, fist, 0.014);
    const thumb = ellipsoid(x, y, z, s.hand.x + s.direction.x * 0.03, s.hand.y + s.direction.y * 0.03, s.hand.z + 0.035, 0.018, 0.028, 0.02);
    return union(distance, thumb, 0.012);
  }
  function legField(x, y, z, s) {
    let distance = capsule(x, y, z, s.hip, s.knee, 0.086, 0.068, 1.05);
    distance = union(distance, capsule(x, y, z, s.knee, s.ankle, 0.068, 0.056), 0.02);
    // Leather boots: a shaft wider than the trousers, a flat sole and a round toe.
    distance = union(distance, capsule(x, y, z, s.ankle, s.bootTop, 0.062, 0.066), 0.012);
    const foot = roundedBox(x, y, z, s.ankle.x, 0.044, s.ankle.z + 0.04, 0.05, 0.044, 0.108, 0.036);
    distance = union(distance, foot, 0.03);
    return Math.max(distance, -y);
  }
  const fields = (x, y, z) => [
    torsoField(x, y, z), armField(x, y, z, sides[0]), armField(x, y, z, sides[1]),
    legField(x, y, z, sides[0]), legField(x, y, z, sides[1]),
  ];
  function field(x, y, z) {
    const [torso, armL, armR, legL, legR] = fields(x, y, z);
    let distance = union(torso, armL, 0.03);
    distance = union(distance, armR, 0.03);
    distance = union(distance, legL, 0.035);
    return union(distance, legR, 0.035);
  }

  const bounds = { minX: -0.56, minY: -0.03, minZ: -0.22, maxX: 0.56, maxY: 1.27, maxZ: 0.26 };
  const { positions, indices, normals } = polygonize(field, bounds, 0.024);
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3), skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  const palette = Object.fromEntries(Object.entries(PALETTE).map(([key, value]) => [key, new THREE.Color(value)]));
  const color = new THREE.Color();

  const spineCenters = [['Hips', 0.80], ['Spine', 0.877], ['Spine1', 0.95], ['Spine2', 1.05], ['Neck', 1.15], ['Head', 1.20]];
  function torsoWeights(add, x, y, w) {
    // Coat shoulders follow the clavicles; the rest blends linearly between
    // the centres of consecutive spine segments.
    const shoulder = smooth(0.09, 0.19, Math.abs(x)) * smooth(0.95, 1.04, y) * 0.75;
    add(x >= 0 ? 'LeftShoulder' : 'RightShoulder', w * shoulder);
    w *= 1 - shoulder;
    if (y <= spineCenters[0][1]) { add('Hips', w); return; }
    for (let i = 1; i < spineCenters.length; i++) {
      const [name, center] = spineCenters[i];
      if (y <= center || i === spineCenters.length - 1) {
        const t = clamp((y - spineCenters[i - 1][1]) / (center - spineCenters[i - 1][1]), 0, 1);
        add(spineCenters[i - 1][0], w * (1 - t));
        add(name, w * t);
        return;
      }
    }
  }
  function armWeights(add, x, y, z, s, w) {
    const upper = along(x, y, z, s.arm, s.fore);
    const lower = along(x, y, z, s.fore, s.hand);
    const root = smooth(-0.35, 0.25, upper);
    const elbow = smooth(0.84, 1.12, upper);
    const wrist = smooth(0.82, 1.02, lower);
    add(`${s.side}Shoulder`, w * (1 - root));
    add(`${s.side}Arm`, w * root * (1 - elbow));
    add(`${s.side}ForeArm`, w * root * elbow * (1 - wrist));
    add(`${s.side}Hand`, w * root * elbow * wrist);
  }
  function legWeights(add, x, y, z, s, w) {
    const thigh = along(x, y, z, s.hip, s.knee);
    const root = smooth(-0.3, 0.22, thigh);
    const knee = smooth(0.86, 1.12, thigh);
    const ankle = 1 - smooth(s.ankle.y - 0.005, s.ankle.y + 0.07, y);
    const toe = smooth(s.toe.z - 0.035, s.toe.z + 0.015, z) * (1 - smooth(0.05, 0.09, y));
    add('Hips', w * (1 - root));
    add(`${s.side}UpLeg`, w * root * (1 - knee));
    add(`${s.side}Leg`, w * root * knee * (1 - ankle));
    add(`${s.side}Foot`, w * root * knee * ankle * (1 - toe));
    add(`${s.side}ToeBase`, w * root * knee * ankle * toe);
  }

  function torsoColor(x, y, z) {
    color.copy(palette.coat);
    // Soft vertical folds on the coat body.
    color.lerp(palette.coatShade, 0.25 + 0.25 * Math.sin(x * 34 + y * 3) * smooth(0.82, 1.0, y));
    const front = smooth(0.03, 0.085, z);
    // Tunic in the coat's V opening, crossed at the neck like a Jedi tabard.
    const half = 0.034 + smooth(0.83, 1.12, y) * 0.056;
    const opening = (1 - smooth(half - 0.006, half + 0.004, Math.abs(x))) * front * smooth(0.815, 0.83, y);
    const lapel = (1 - smooth(0.006, 0.02, Math.abs(Math.abs(x) - half - 0.012))) * front * smooth(0.82, 0.86, y) * (1 - smooth(1.10, 1.14, y));
    color.lerp(palette.coatEdge, lapel * 0.8);
    color.lerp(palette.tunic, opening);
    const cross = 1 - smooth(0.004, 0.012, Math.abs(Math.abs(x) - (1.13 - y) * 0.55));
    color.lerp(palette.tunicShade, opening * cross * smooth(0.98, 1.06, y) * 0.9);
    color.lerp(palette.tunicShade, opening * (1 - smooth(0.85, 0.9, y)) * 0.5);
    // Hood and collar, then the skin of the neck above them.
    const hood = Math.max(smooth(1.09, 1.12, y) * (1 - front * 0.6), smooth(1.12, 1.15, y));
    color.lerp(palette.collar, hood * (1 - opening));
    color.lerp(palette.skin, smooth(1.185, 1.2, y) * (Math.hypot(x, z + 0.01) < 0.066 ? 1 : 0));
    // Below the belt only trousers and lining remain, inside the simulated skirt.
    color.lerp(z > 0.02 ? palette.trousers : palette.lining, 1 - smooth(0.76, 0.775, y));
  }
  function armColor(x, y, z, s) {
    color.copy(palette.coat);
    const upper = along(x, y, z, s.arm, s.fore), lower = along(x, y, z, s.fore, s.hand);
    color.lerp(palette.coatShade, 0.3 * smooth(0.2, 0.9, upper) * (1 - smooth(1, 1.4, upper)));
    color.lerp(palette.coatEdge, smooth(0.72, 0.8, lower) * 0.6);
    color.lerp(palette.skin, smooth(0.83, 0.86, lower));
  }
  function legColor(x, y, z, s) {
    color.copy(palette.trousers);
    color.lerp(palette.boot, 1 - smooth(s.bootTop.y - 0.01, s.bootTop.y + 0.01, y));
    const cuff = smooth(s.bootTop.y - 0.045, s.bootTop.y - 0.025, y) * (1 - smooth(s.bootTop.y - 0.004, s.bootTop.y + 0.01, y));
    color.lerp(palette.bootCuff, cuff * 0.85);
    color.lerp(palette.sole, 1 - smooth(0.012, 0.026, y));
  }

  const weights = new Float32Array(names.length);
  const add = (name, value) => { weights[ids[name]] += value; };
  for (let vertex = 0; vertex < count; vertex++) {
    const x = positions[vertex * 3], y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
    const distances = fields(x, y, z);
    const nearest = Math.min(...distances);
    const memberships = distances.map(distance => Math.pow(Math.max(0, 1 - (distance - nearest) / 0.05), 3));
    const total = memberships.reduce((sum, value) => sum + value, 0);
    weights.fill(0);
    torsoWeights(add, x, y, memberships[0] / total);
    armWeights(add, x, y, z, sides[0], memberships[1] / total);
    armWeights(add, x, y, z, sides[1], memberships[2] / total);
    legWeights(add, x, y, z, sides[0], memberships[3] / total);
    legWeights(add, x, y, z, sides[1], memberships[4] / total);
    const strongest = Array.from(weights, (weight, index) => ({ weight, index })).sort((a, b) => b.weight - a.weight).slice(0, 4);
    const sum = strongest.reduce((acc, entry) => acc + entry.weight, 0);
    strongest.forEach((entry, slot) => { skinIndex[vertex * 4 + slot] = entry.index; skinWeight[vertex * 4 + slot] = entry.weight / sum; });

    const part = memberships.indexOf(1);
    if (part === 0) torsoColor(x, y, z);
    else if (part <= 2) armColor(x, y, z, sides[part - 1]);
    else legColor(x, y, z, sides[part - 3]);
    colors[vertex * 3] = color.r; colors[vertex * 3 + 1] = color.g; colors[vertex * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
  const body = new THREE.SkinnedMesh(geometry, material);
  body.name = 'Jedi — continuous dressed body';
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  body.bind(new THREE.Skeleton(list), new THREE.Matrix4());
  return { body, geometry, material, metadata: { vertices: count, triangles: indices.length / 3, unifiedSurface: true } };
}
