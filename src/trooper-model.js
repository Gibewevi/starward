import * as THREE from 'three';

// Geometry only. The groups retain the original joint frames and detachable
// armour names, so animation, weapon grips and ragdoll physics share one model.
// Broad planar faces and small bevels describe the armour; no coloured decals.
function panel(points, depth, bevel = 0.005) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function block(width, height, depth, bevel = 0.005) {
  // Outer dimensions include the bevel.
  const b = Math.min(bevel, width / 5, height / 5, depth / 5);
  const x = width / 2 - b, y = height / 2 - b;
  return panel([[-x, -y], [x, -y], [x, y], [-x, y]], depth - 2 * b, b);
}

// Wrap the visor and cheek plates around the dome, rather than leaving a flat
// mask suspended in front of the temples in the side view.
function wrapFace(geometry, inset = 0.036) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - inset * (Math.abs(p.getX(i)) / 0.15) ** 3);
  geometry.computeVertexNormals();
  return geometry;
}

// Closed superellipse rings, bottom to top. More square than a tube, with a
// softly rounded silhouette. Ring changes form the rolled edges of each shell.
function shell(rings, segments = 16, exponent = 3) {
  const positions = [], indices = [];
  for (const [y, rx, rz, z = 0, x = 0] of rings) {
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      positions.push(x + Math.sign(s) * Math.abs(s) ** (2 / exponent) * rx,
        y, z + Math.sign(c) * Math.abs(c) ** (2 / exponent) * rz);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i, b = row * segments + (i + 1) % segments;
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  }
  const last = (rings.length - 1) * segments;
  for (let i = 1; i < segments - 1; i++) {
    indices.push(0, i + 1, i, last, last + i, last + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function cuff(topX, bottomX, topZ, bottomZ, height, bevel = 0.009) {
  const y = height / 2;
  return shell([
    [-y, bottomX - bevel, bottomZ - bevel],
    [-y + bevel, bottomX, bottomZ],
    [y - bevel, topX, topZ],
    [y, topX - bevel, topZ - bevel],
  ]);
}

/** Authored armour planes, not a rounded loft. The front has two broad
 * surfaces meeting at the pectoral break; the lower hem rises over the belly.
 * Normals are constant within each plane (including both triangles of a quad).
 * They are stored explicitly, rather than using shader derivative flat shading.
 */
function breastplate() {
  const positions = [], normals = [];
  const face = (points, outward) => {
    const p = points.map(point => new THREE.Vector3(...point));
    const normal = new THREE.Vector3();
    for (let i = 0; i < p.length; i++) normal.add(new THREE.Vector3().crossVectors(p[i], p[(i + 1) % p.length]));
    normal.normalize();
    if (normal.dot(new THREE.Vector3(...outward)) < 0) { p.reverse(); normal.negate(); }
    // Project onto the dominant plane to triangulate the concave lower hem.
    const axis = Math.abs(normal.x) > Math.abs(normal.y)
      ? (Math.abs(normal.x) > Math.abs(normal.z) ? 'x' : 'z')
      : (Math.abs(normal.y) > Math.abs(normal.z) ? 'y' : 'z');
    const projected = p.map(v => axis === 'x' ? new THREE.Vector2(v.y, v.z)
      : axis === 'y' ? new THREE.Vector2(v.z, v.x) : new THREE.Vector2(v.x, v.y));
    for (const triangle of THREE.ShapeUtils.triangulateShape(projected, [])) {
      const [a, b, c] = triangle.map(i => p[i]);
      const winding = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const vertices = winding.dot(normal) < 0 ? [a, c, b] : [a, b, c];
      for (const vertex of vertices) { positions.push(...vertex); normals.push(...normal); }
    }
  };

  const collarL = [-0.122, 0.355, 0.113], collarR = [0.122, 0.355, 0.113];
  const upperL = [-0.133, 0.331, 0.14932], upperR = [0.133, 0.331, 0.14932];
  const ridgeL = [-0.142, 0.25, 0.172], ridgeR = [0.142, 0.25, 0.172];
  const hemL = [-0.122, 0.153, 0.12932], hemR = [0.122, 0.153, 0.12932];
  const notchL = [-0.055, 0.17, 0.1368], notchR = [0.055, 0.17, 0.1368];
  const sideTopL = [-0.185, 0.331, 0.07932], sideTopR = [0.185, 0.331, 0.07932];
  const sideRidgeL = [-0.194, 0.25, 0.102], sideRidgeR = [0.194, 0.25, 0.102];
  const sideHemL = [-0.164, 0.118, 0.034], sideHemR = [0.164, 0.118, 0.034];

  face([collarL, collarR, upperR, upperL], [0, 1, 1]);
  face([upperL, upperR, ridgeR, ridgeL], [0, 0, 1]);
  face([ridgeL, ridgeR, hemR, notchR, notchL, hemL], [0, 0, 1]);
  for (const [sign, collar, upper, ridge, hem, top, outer, bottom] of [
    [-1, collarL, upperL, ridgeL, hemL, sideTopL, sideRidgeL, sideHemL],
    [1, collarR, upperR, ridgeR, hemR, sideTopR, sideRidgeR, sideHemR],
  ]) {
    face([collar, top, upper], [sign, 1, 1]);
    face([upper, top, outer, ridge], [sign, 0, 1]);
    face([ridge, outer, hem], [sign, 0, 1]);
    face([outer, bottom, hem], [sign, 0, 1]);
  }

  const outline = [collarL, collarR, sideTopR, sideRidgeR, sideHemR, hemR,
    notchR, notchL, hemL, sideHemL, sideRidgeL, sideTopL];
  // A narrow edge chamfer, then a return toward the ribs. The side walls stay
  // angular; smoothing these normals would turn the whole plate into a pillow.
  const bevel = outline.map(([x, y, z]) => [x * 0.978, 0.24 + (y - 0.24) * 0.978, z - 0.004]);
  const back = outline.map(([x, y]) => [x * 0.94, y, -0.083]);
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    const direction = [outline[i][1] - outline[next][1], outline[next][0] - outline[i][0], 0];
    face([outline[i], outline[next], bevel[next], bevel[i]], direction);
    face([bevel[i], bevel[next], back[next], back[i]], direction);
  }
  face(back, [0, 0, -1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function mesh(owner, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], name = '') {
  const object = new THREE.Mesh(geometry, material);
  object.position.fromArray(position); object.rotation.set(...rotation);
  object.castShadow = true; object.receiveShadow = true; object.name = name;
  owner.add(object); return object;
}

export function buildTrooperParts({ armor, shade, black, lens }) {
  const parts = {}, pieces = {};
  const part = name => (parts[name] = Object.assign(new THREE.Group(), { name }));
  const plate = (owner, name) => {
    const group = Object.assign(new THREE.Group(), { name });
    group.userData.armour = true; owner.add(group); pieces[name] = group;
    return group;
  };
  const sphere = (x, y, z) => new THREE.SphereGeometry(1, 12, 8).scale(x, y, z);
  const tube = (r1, r2, height, segments = 12) => new THREE.CylinderGeometry(r1, r2, height, segments);

  const head = part('head');
  mesh(head, tube(0.065, 0.067, 0.095), black, [0, 0.029, 0]);
  mesh(head, sphere(0.124, 0.14, 0.12), black, [0, 0.19, -0.005]);
  const helmet = plate(head, 'helmet');
  mesh(helmet, shell([
    [0.055, 0.149, 0.136, -0.008], [0.068, 0.171, 0.149, -0.008],
    [0.105, 0.174, 0.15, -0.01], [0.207, 0.174, 0.149, -0.012],
    [0.259, 0.166, 0.14, -0.014], [0.298, 0.142, 0.12, -0.015],
    [0.326, 0.101, 0.09, -0.015], [0.338, 0.054, 0.05, -0.015],
    [0.34, 0.008, 0.008, -0.015],
  ], 24, 2.8), armor, [0, 0, 0], [0, 0, 0], 'Helmet dome');
  mesh(helmet, shell([
    [0.046, 0.158, 0.144, -0.01], [0.057, 0.179, 0.161, -0.01],
    [0.083, 0.181, 0.162, -0.01], [0.094, 0.174, 0.155, -0.01],
  ], 24), armor, [0, 0, 0], [0, 0, 0], 'Helmet lower rim');

  // A single unbroken T, with swept cheek edges and a protected chin below.
  const visorOutline = [[-0.143, 0.234], [-0.10, 0.234], [-0.05, 0.234], [0, 0.234], [0.05, 0.234], [0.10, 0.234], [0.143, 0.234],
    [0.143, 0.19], [0.10, 0.175], [0.053, 0.16], [0.037, 0.112], [-0.037, 0.112], [-0.053, 0.16], [-0.10, 0.175], [-0.143, 0.19]];
  mesh(helmet, wrapFace(panel(visorOutline, 0.012, 0.002)), lens, [0, 0, 0.153], [0, 0, 0], 'Continuous T visor');
  const browX = [-0.146, -0.10, -0.05, 0, 0.05, 0.10, 0.146];
  mesh(helmet, wrapFace(panel([...browX.map(x => [x, -0.005]), ...[...browX].reverse().map(x => [x, 0.005])], 0.012, 0.002)), armor,
    [0, 0.245, 0.146], [0, 0, 0], 'Brow rim');
  mesh(helmet, panel([[-0.039, -0.028], [0.039, -0.028], [0.046, 0.028], [-0.046, 0.028]], 0.007, 0.002), armor,
    [0, 0.292, 0.117], [-0.57, 0, 0], 'Crown ridge');
  for (const sign of [-1, 1]) {
    const cheek = [[0.051, 0.151], [0.15, 0.184], [0.162, 0.122], [0.135, 0.078], [0.066, 0.077]];
    mesh(helmet, wrapFace(panel(cheek.map(([x, y]) => [x * sign, y]), 0.027, 0.006)), armor,
      [0, 0, 0.136], [0, 0, 0], 'Angular cheek');
    mesh(helmet, wrapFace(panel([[0.114, 0.083], [0.14, 0.09], [0.15, 0.131], [0.126, 0.119]].map(([x, y]) => [sign * x, y]), 0.006, 0.002)), black,
      [0, 0, 0.161], [0, 0, 0], 'Cheek intake');
    mesh(helmet, tube(0.044, 0.044, 0.023, 16), armor, [sign * 0.18, 0.17, -0.012], [0, 0, Math.PI / 2], 'Ear housing');
    mesh(helmet, tube(0.027, 0.027, 0.025, 16), shade, [sign * 0.184, 0.17, -0.012], [0, 0, Math.PI / 2], 'Ear inset');
  }
  mesh(helmet, panel([[-0.055, 0.052], [0.055, 0.052], [0.041, 0.11], [-0.041, 0.11]], 0.03, 0.006), armor,
    [0, 0, 0.161], [-0.04, 0, 0], 'Chin respirator');
  for (const x of [-0.025, 0, 0.025]) mesh(helmet, block(0.012, 0.039, 0.007, 0.002), black,
    [x, 0.079, 0.183], [0, 0, 0], 'Respirator slot');
  mesh(helmet, block(0.172, 0.018, 0.014, 0.003), black, [0, 0.108, -0.168], [0, 0, 0], 'Rear helmet vent');

  const torso = part('torso');
  mesh(torso, cuff(0.176, 0.139, 0.114, 0.105, 0.34, 0.015), black, [0, 0.176, 0]);
  mesh(torso, tube(0.079, 0.089, 0.055), black, [0, 0.349, -0.01]);
  const chest = plate(torso, 'chestPlate');
  mesh(chest, breastplate(), armor, [0, 0, 0], [0, 0, 0], 'Sculpted breastplate');
  // White shoulder bridges carry the chest over the undersuit into the back.
  for (const sign of [-1, 1]) {
    mesh(chest, panel([
      [-0.122, 0.34], [-0.109, 0.366], [-0.024, 0.388], [0.082, 0.377],
      [0.126, 0.35], [0.111, 0.327], [0.07, 0.351], [-0.022, 0.36], [-0.098, 0.343],
    ], 0.067, 0.004), armor, [sign * 0.14, 0, 0], [0, Math.PI / 2, 0], 'Shoulder bridge');
  }
  const abdomen = plate(torso, 'abPlate');
  mesh(abdomen, panel([[-0.095, 0.037], [0.095, 0.037], [0.12, 0.108], [0.09, 0.133], [-0.09, 0.133], [-0.12, 0.108]], 0.047, 0.01), armor,
    [0, 0, 0.097], [0, 0, 0], 'Abdominal guard');
  mesh(abdomen, block(0.091, 0.008, 0.005, 0.001), shade, [0, 0.102, 0.132], [0, 0, 0], 'Abdominal seam');

  const back = plate(torso, 'backPlate');
  mesh(back, panel([[-0.172, 0.165], [0.172, 0.165], [0.174, 0.31], [0.135, 0.35], [-0.135, 0.35], [-0.174, 0.31]], 0.054, 0.012), armor,
    [0, 0, -0.105], [0, 0, 0], 'Back shell');
  mesh(back, block(0.142, 0.231, 0.055, 0.012), armor, [0, 0.255, -0.154], [0, 0, 0], 'Spinal housing');
  for (const y of [0.184, 0.208]) mesh(back, block(0.058, 0.012, 0.008, 0.002), black,
    [0, y, -0.185], [0, 0, 0], 'Back exhaust');
  for (const sign of [-1, 1]) mesh(back, block(0.088, 0.099, 0.067, 0.014), armor,
    [sign * 0.112, 0.12, -0.124], [0, 0, 0], 'Lower back housing');

  const pelvis = part('pelvis');
  mesh(pelvis, cuff(0.16, 0.138, 0.108, 0.094, 0.18), black, [0, 0.015, 0]);
  const belt = plate(pelvis, 'belt');
  mesh(belt, cuff(0.18, 0.18, 0.126, 0.126, 0.07, 0.005), black, [0, 0.084, 0]);
  for (const z of [-0.133, 0.133]) {
    mesh(belt, block(0.103, 0.076, 0.03, 0.009), armor, [0, 0.084, z], [0, 0, 0], 'Belt buckle');
    for (const sign of [-1, 1]) mesh(belt, block(0.063, 0.081, 0.051, 0.008), armor,
      [sign * 0.125, 0.084, z * 0.88], [0, sign * Math.sign(z) * 0.2, 0], 'Belt pouch');
  }
  for (const sign of [-1, 1]) mesh(belt, block(0.044, 0.072, 0.075, 0.008), armor, [sign * 0.182, 0.084, 0]);
  const cod = plate(pelvis, 'codPlate'), rear = plate(pelvis, 'rearPlate');
  mesh(cod, panel([[-0.055, -0.087], [0.055, -0.087], [0.103, 0.026], [-0.103, 0.026]], 0.039, 0.01), armor, [0, 0, 0.108]);
  mesh(rear, panel([[-0.073, -0.08], [0.073, -0.08], [0.125, 0.026], [-0.125, 0.026]], 0.033, 0.01), armor, [0, 0, -0.107]);

  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const upper = part(`upperArm${side}`);
    mesh(upper, sphere(0.064, 0.072, 0.064), black, [0, -0.035, 0]);
    mesh(upper, tube(0.057, 0.055, 0.23), black, [0, -0.135, 0]);
    const pauldron = plate(upper, `pauldron${side}`);
    mesh(pauldron, shell([
      [-0.104, 0.089, 0.091, 0, sign * 0.036], [-0.087, 0.112, 0.111, 0, sign * 0.026],
      [0.013, 0.098, 0.105, 0, sign * 0.012], [0.044, 0.059, 0.071, 0, sign * 0.004],
      [0.05, 0.028, 0.04],
    ], 12, 2.9), armor, [sign * 0.013, 0, 0], [0, 0, sign * 0.14], 'Sloping shoulder shield');
    mesh(plate(upper, `bicep${side}`), cuff(0.073, 0.068, 0.076, 0.068, 0.099), armor, [0, -0.178, 0], [0, 0, 0], 'Upper arm cuff');

    const forearm = part(`forearm${side}`);
    mesh(forearm, sphere(0.055, 0.059, 0.058), black);
    mesh(forearm, tube(0.052, 0.045, 0.23), black, [0, -0.118, 0]);
    const bracer = plate(forearm, `bracer${side}`);
    mesh(bracer, cuff(0.078, 0.057, 0.079, 0.061, 0.174, 0.012), armor, [0, -0.129, 0.005], [0, 0, 0], 'Tapered forearm shell');
    mesh(bracer, block(0.027, 0.052, 0.006, 0.003), shade, [sign * 0.027, -0.096, 0.083], [0.1, 0, 0], 'Forearm recess');

    const hand = part(`hand${side}`);
    mesh(hand, block(0.079, 0.091, 0.079, 0.016), black, [0, -0.049, 0.009]);
    mesh(hand, new THREE.CapsuleGeometry(0.014, 0.033, 2, 8), black, [-sign * 0.037, -0.035, 0.036], [0, 0, -sign * 0.2]);
    mesh(hand, block(0.061, 0.052, 0.016, 0.008), armor, [0, -0.04, -0.033], [0.12, 0, 0], 'Glove backplate');
    for (const x of [-0.022, 0, 0.022]) mesh(hand, block(0.018, 0.03, 0.019, 0.005), black, [x, -0.078, 0.041]);

    const thigh = part(`thigh${side}`);
    mesh(thigh, cuff(0.079, 0.071, 0.081, 0.07, 0.319), black, [0, -0.16, 0]);
    const thighPlate = plate(thigh, `thighPlate${side}`);
    mesh(thighPlate, cuff(0.105, 0.084, 0.111, 0.088, 0.229, 0.014), armor, [0, -0.151, 0.007], [0, 0, 0], 'Thigh shell');
    mesh(thighPlate, block(0.027, 0.094, 0.065, 0.007), armor, [sign * 0.103, -0.116, 0.005], [0, 0, 0], 'Thigh side guard');

    const shin = part(`shin${side}`);
    mesh(shin, sphere(0.068, 0.069, 0.07), black);
    mesh(shin, tube(0.064, 0.055, 0.3), black, [0, -0.15, 0]);
    const knee = plate(shin, `kneePad${side}`);
    mesh(knee, panel([[-0.041, -0.063], [0.041, -0.063], [0.06, -0.023], [0.047, 0.026], [-0.047, 0.026], [-0.06, -0.023]], 0.035, 0.009), armor,
      [0, 0, 0.065], [-0.08, 0, 0], 'Knee shield');
    const shinPlate = plate(shin, `shinPlate${side}`);
    mesh(shinPlate, cuff(0.09, 0.068, 0.09, 0.071, 0.206, 0.012), armor, [0, -0.188, 0.006], [0, 0, 0], 'Calf shell');

    const foot = part(`foot${side}`);
    mesh(foot, shell([
      [-0.087, 0.072, 0.117, 0.051], [-0.066, 0.073, 0.12, 0.05],
      [-0.018, 0.066, 0.102, 0.041], [0.026, 0.058, 0.055, -0.005],
      [0.039, 0.047, 0.047, -0.01],
    ], 12, 3.6), armor, [0, 0, 0], [0, 0, 0], 'Boot shell');
    mesh(foot, block(0.153, 0.021, 0.253, 0.007), black, [0, -0.091, 0.052], [0, 0, 0], 'Boot sole');
  }

  // Compact rifle; its grips and muzzle stay in the existing animation frames.
  const rifle = part('blaster');
  mesh(rifle, block(0.057, 0.068, 0.247, 0.008), black, [0, 0, 0.026], [0, 0, 0], 'Blaster receiver');
  mesh(rifle, tube(0.019, 0.019, 0.232), black, [0, 0.012, 0.254], [Math.PI / 2, 0, 0]);
  for (const z of [0.203, 0.275, 0.346]) mesh(rifle, tube(0.026, 0.026, 0.029), shade, [0, 0.012, z], [Math.PI / 2, 0, 0]);
  mesh(rifle, tube(0.013, 0.013, 0.004), lens, [0, 0.012, 0.372], [Math.PI / 2, 0, 0], 'Muzzle aperture');
  mesh(rifle, block(0.065, 0.055, 0.157, 0.006), armor, [0, 0.012, 0.037], [0, 0, 0], 'Blaster body shell');
  mesh(rifle, block(0.035, 0.075, 0.041, 0.006), black, [0, -0.056, -0.049], [-0.3, 0, 0]);
  mesh(rifle, block(0.043, 0.047, 0.083, 0.005), black, [0, -0.034, 0.157]);
  mesh(rifle, block(0.032, 0.022, 0.123, 0.004), shade, [0, 0.057, 0.028]);
  mesh(rifle, block(0.026, 0.036, 0.073, 0.005), black, [0, 0.015, -0.129]);
  return { parts, pieces };
}
