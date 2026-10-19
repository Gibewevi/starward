import * as THREE from 'three';

/**
 * Burn marks that stay. A blast leaves a ragged star of soot on the floor,
 * tempered-steel brown around it, and black licks up the sides of the crates,
 * barriers and barrels that stood near it; a bolt leaves a small scorch
 * wherever it strikes, on the floor or on a crate (on a barrel, on its curve).
 * Nothing fades: the oldest marks are only recycled once there are hundreds.
 *
 * The textures are drawn here, procedurally (no canvas, so the tests run them
 * too): value noise for the mottling and the ragged edges. Every kind of mark
 * is one instanced mesh, so a room covered in scorches costs a few draw calls.
 *
 * blast(at, power), bolt(at, normal, box), clear(); emberTexture() is the
 * glowing heart a blast leaves for a few seconds (see explosions.js).
 */
export function createScorchMarks(scene, { random = Math.random, lab = null, limits = {} } = {}) {
  const { floor: floorMax = 24, walls: wallMax = 48, bolts: boltMax = 260 } = limits;
  const unitQuad = new THREE.PlaneGeometry(1, 1);
  // Wall soot: its origin at the bottom of the mark, on the floor.
  const standing = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  // The same on a barrel: a third of a cylinder, centred on +Z.
  const curved = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true, -Math.PI / 3.2, Math.PI / 1.6).translate(0, 0.5, 0);

  const floor = decals(unitQuad, blastTexture(7), floorMax, 'Blast burns', -4);
  const walls = decals(standing, sootTexture(11), wallMax, 'Blast soot');
  const barrels = decals(curved, sootTexture(23), Math.ceil(wallMax / 2), 'Blast soot (barrels)');
  const bolts = decals(unitQuad, boltTexture(5), boltMax, 'Bolt scorches', -2);

  function decals(geometry, texture, max, name, offset = -3) {
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(mesh);
    let next = 0;
    const matrix = new THREE.Matrix4(), shade = new THREE.Color();
    return {
      mesh,
      add(transform, darkness = 1) {
        mesh.setMatrixAt(next, transform);
        mesh.setColorAt(next, shade.setScalar(darkness));
        next = (next + 1) % max;
        mesh.count = Math.min(max, mesh.count + 1);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      },
      clear() { mesh.count = 0; next = 0; },
      matrix,
    };
  }

  const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const position = new THREE.Vector3(), turn = new THREE.Quaternion(), spin = new THREE.Quaternion(), scale = new THREE.Vector3();
  const across = new THREE.Vector3(), basis = new THREE.Matrix4();
  /** A flat mark lying on a surface of normal `normal`, turned by `angle` about it. */
  function flat(set, at, normal, size, angle, lift, darkness) {
    turn.setFromUnitVectors(Z, normal);
    spin.setFromAxisAngle(Z, angle);
    turn.multiply(spin);
    position.copy(at).addScaledVector(normal, lift);
    set.add(set.matrix.compose(position, turn, scale.set(size, size, 1)), darkness);
  }
  /** Soot standing on the floor against an upright face of normal `normal`. */
  function upright(set, base, normal, width, height, darkness) {
    across.crossVectors(UP, normal).normalize();
    basis.makeBasis(across, UP, normal).setPosition(base);
    set.add(set.matrix.copy(basis).scale(scale.set(width, height, 1)), darkness);
  }

  /** A blast on the floor at `at`: its burn, and soot on what stood around it. */
  function blast(at, power = 1) {
    flat(floor, position.set(at.x, 0, at.z), UP, (2 + random() * 0.5) * power, random() * Math.PI * 2, 0.004, 0.85 + random() * 0.15);
    if (!lab) return;
    const reach = 1.7 * power;
    for (const box of lab.obstacles) {
      if (box.min.y > 0.3) continue;
      const nearestX = THREE.MathUtils.clamp(at.x, box.min.x, box.max.x), nearestZ = THREE.MathUtils.clamp(at.z, box.min.z, box.max.z);
      const distance = Math.hypot(at.x - nearestX, at.z - nearestZ);
      if (distance > reach) continue;
      const strength = 1 - distance / reach, tall = box.max.y - box.min.y;
      if (box.kind === 'barrel') {
        // On its curve, centred on the side facing the blast.
        const radius = (box.max.x - box.min.x) / 2 + 0.012;
        const facing = Math.atan2(at.x - box.centre.x, at.z - box.centre.z);
        turn.setFromAxisAngle(UP, facing);
        position.set(box.centre.x, box.min.y, box.centre.z);
        barrels.add(barrels.matrix.compose(position, turn, scale.set(radius, Math.min(tall, 0.45 + 0.75 * strength), radius)), 0.75 + 0.25 * strength);
        continue;
      }
      // Every face that sees the blast: soot rising from the floor, as wide as the blast reached.
      for (const [axis, side] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
        const plane = side > 0 ? box.max[axis] : box.min[axis];
        const away = (at[axis] - plane) * side;
        if (away < -0.05 || away > reach) continue;
        const along = axis === 'x' ? 'z' : 'x';
        const span = box.max[along] - box.min[along];
        const width = Math.min(span, (0.9 + 1.3 * strength) * power * (0.85 + random() * 0.3));
        const centre = THREE.MathUtils.clamp(at[along], box.min[along] + width / 2, box.max[along] - width / 2);
        const normal = new THREE.Vector3().setComponent(axis === 'x' ? 0 : 2, side);
        const base = new THREE.Vector3().setComponent(axis === 'x' ? 0 : 2, plane + side * 0.014).setComponent(axis === 'x' ? 2 : 0, centre).setY(box.min.y);
        const face = 1 - Math.max(0, away) / reach;
        upright(walls, base, normal, width, Math.min(tall, (0.45 + 0.8 * face) * power), 0.7 + 0.3 * face);
      }
    }
  }

  /** A bolt struck at `at`, on a surface of normal `normal` (the floor, a crate, a barrel's box); returns where the mark went. */
  function bolt(at, normal, box = null) {
    let surface = normal;
    position.copy(at);
    if (box?.kind === 'barrel' && Math.abs(normal.y) < 0.5) {
      // A barrel is round: the scorch goes on its curve, not on its bounding box.
      const radius = (box.max.x - box.min.x) / 2;
      surface = new THREE.Vector3(at.x - box.centre.x, 0, at.z - box.centre.z);
      if (surface.lengthSq() < 1e-8) surface.copy(normal);
      surface.normalize();
      position.set(box.centre.x, at.y, box.centre.z).addScaledVector(surface, radius);
    }
    const where = position.clone();
    flat(bolts, where, surface, 0.17 + random() * 0.1, random() * Math.PI * 2, 0.005, 0.8 + random() * 0.2);
    return { position: where, normal: surface };
  }

  function clear() { for (const set of [floor, walls, barrels, bolts]) set.clear(); }
  return {
    blast, bolt, clear,
    get count() { return floor.mesh.count + walls.mesh.count + barrels.mesh.count + bolts.mesh.count; },
    meshes: { floor: floor.mesh, walls: walls.mesh, barrels: barrels.mesh, bolts: bolts.mesh },
  };
}

// ---- Procedural textures ----------------------------------------------------------

function seeded(seed) {
  let state = seed * 9301 + 49297;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}
function valueNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(noise, x, y, octaves = 4) {
  let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) { sum += amplitude * noise(x * frequency, y * frequency); total += amplitude; frequency *= 2.03; amplitude *= 0.5; }
  return sum / total;
}
const clamp01 = value => Math.min(1, Math.max(0, value));
const smooth = (edge0, edge1, x) => { const t = clamp01((x - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); };
// On dark steel black alone hardly shows: soot comes with pale ash and the
// rust-brown of tempered metal around it.
const SOOT = [0.012, 0.01, 0.009], ASH = [0.5, 0.47, 0.43], SMOKE = [0.3, 0.28, 0.26], TEMPER = [0.42, 0.18, 0.07], DEEP_TEMPER = [0.2, 0.09, 0.06];

function texture(width, height, shader) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = shader((x + 0.5) / width, (y + 0.5) / height);
    data.set([r, g, b, a].map(value => Math.round(clamp01(value) * 255)), (y * width + x) * 4);
  }
  const map = new THREE.DataTexture(data, width, height);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}
/** Layers painted one over the other ([colour, alpha] pairs, bottom first): colour and alpha. */
function paint(...layers) {
  const sum = [0, 0, 0];
  let alpha = 0;
  for (const [colour, a] of layers) {
    const k = clamp01(a);
    for (let i = 0; i < 3; i++) sum[i] = colour[i] * k + sum[i] * (1 - k);
    alpha = k + alpha * (1 - k);
  }
  return alpha > 0 ? [sum[0] / alpha, sum[1] / alpha, sum[2] / alpha, alpha] : [0, 0, 0, 0];
}
const mixed = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
/** The blast's spikes: how far the burn reaches at that angle (0..1 of the radius). */
function reachAt(angle, spikes, base) {
  let edge = base;
  for (const spike of spikes) {
    const off = Math.abs(Math.atan2(Math.sin(angle - spike.angle), Math.cos(angle - spike.angle)));
    edge = Math.max(edge, spike.from + spike.length * Math.max(0, 1 - off / spike.width) ** 1.6);
  }
  return edge;
}

/** A blast's burn: a black heart, blotchy soot streaking out in rays, a ring of pale ash, rust-brown temper, specks thrown out. */
function blastTexture(seed) {
  const noise = valueNoise(seed), rand = seeded(seed);
  const spikes = Array.from({ length: 11 }, () => ({ angle: rand() * Math.PI * 2, width: 0.06 + rand() * 0.12, length: 0.1 + rand() * 0.3, from: 0.3 }));
  return texture(128, 128, (s, t) => {
    const u = s * 2 - 1, v = t * 2 - 1, r = Math.hypot(u, v), angle = Math.atan2(v, u), c = Math.cos(angle), n = Math.sin(angle);
    const mottle = fbm(noise, u * 5 + 3, v * 5 + 3, 4);
    // Rays depend on the angle only, so they streak out from the heart.
    const rays = fbm(noise, c * 7 + 1, n * 7 + 1, 3), fine = noise(c * 22 + 5, n * 22 + 5);
    const edge = Math.min(0.88, reachAt(angle, spikes, 0.36 + 0.3 * (fbm(noise, c * 1.8 + 7, n * 1.8 + 7, 3) - 0.5)) * (0.85 + 0.35 * rays));
    let soot = (1 - smooth(edge * 0.35, edge, r + (mottle - 0.5) * 0.12)) * (0.55 + 0.45 * mottle) * (0.8 + 0.3 * fine);
    soot = Math.max(soot, 1 - smooth(0.08, 0.28, r));
    const ring = smooth(edge * 0.7, edge * 0.95, r) * (1 - smooth(edge * 1.05, edge * 1.3, r));
    const ash = ring * (0.25 + 0.5 * smooth(0.45, 0.7, mottle)) + smooth(0.6, 0.8, rays) * smooth(0.2, 0.4, r) * (1 - smooth(edge * 0.8, edge, r)) * 0.4;
    const temper = smooth(edge * 0.6, edge * 0.9, r) * (1 - smooth(edge * 1.15, Math.min(0.97, edge * 1.6), r)) * (0.4 + 0.35 * mottle);
    // A few specks thrown beyond the edge.
    if (r > edge && r < Math.min(0.94, edge * 1.6) && noise(u * 34 + 1, v * 34 + 1) > 0.87) soot = Math.max(soot, 0.65);
    const colour = paint(
      [mixed(DEEP_TEMPER, TEMPER, mottle), temper],
      [ASH, ash * 0.75],
      [SOOT, Math.min(0.96, soot)],
    );
    colour[3] *= 1 - smooth(0.9, 1, r);
    return colour;
  });
}
/** Soot licking up a wall from the floor: black at the bottom, ragged tongues, smoke-grey and temper-brown above. */
function sootTexture(seed) {
  const noise = valueNoise(seed);
  return texture(64, 128, (s, t) => {
    const u = s * 2 - 1, v = t;
    const tongues = fbm(noise, u * 3.2 + 5, 0.7, 3);
    const top = 0.35 + 0.75 * tongues * (1 - u * u * 0.6);
    const streaks = fbm(noise, u * 9 + 2, v * 1.6, 3);
    const height = v / Math.max(0.12, top * (0.75 + 0.5 * streaks));
    const across = 1 - smooth(0.45, 1, Math.abs(u));
    const grain = fbm(noise, u * 10 + 11, v * 10, 3);
    const soot = (1 - smooth(0.15, 0.8, height + (grain - 0.5) * 0.25)) * across * (0.6 + 0.55 * grain);
    const smoke = (1 - smooth(0.45, 1.3, height)) * (1 - smooth(0.55, 1, Math.abs(u))) * (0.3 + 0.4 * streaks);
    const temper = smooth(0.35, 0.65, height) * (1 - smooth(0.75, 1.05, height)) * across * (0.4 + 0.4 * grain);
    return paint([SMOKE, smoke * 0.6], [mixed(DEEP_TEMPER, TEMPER, grain), temper * 0.8], [SOOT, Math.min(0.94, soot * 1.1)]);
  });
}
/** A bolt's scorch: a black pit, a few short splashes, a rust-brown ring. */
function boltTexture(seed) {
  const noise = valueNoise(seed), rand = seeded(seed);
  const spikes = Array.from({ length: 6 }, () => ({ angle: rand() * Math.PI * 2, width: 0.12 + rand() * 0.16, length: 0.25 + rand() * 0.45, from: 0.2 }));
  return texture(32, 32, (s, t) => {
    const u = s * 2 - 1, v = t * 2 - 1, r = Math.hypot(u, v), angle = Math.atan2(v, u);
    const edge = reachAt(angle, spikes, 0.32 + 0.12 * (noise(Math.cos(angle) * 2 + 3, Math.sin(angle) * 2 + 3) - 0.5));
    const soot = (1 - smooth(edge * 0.45, Math.min(0.95, edge * 0.9), r)) * (0.85 + 0.15 * noise(u * 6, v * 6));
    const temper = (1 - smooth(edge * 0.8, Math.min(0.98, edge * 1.45), r)) * 0.6;
    const ash = smooth(0.3, 0.45, r) * (1 - smooth(0.5, 0.7, r)) * 0.3;
    const colour = paint([TEMPER, temper], [ASH, ash], [SOOT, soot]);
    colour[3] *= 1 - smooth(0.85, 1, r);
    return colour;
  });
}
/** The glowing heart a blast leaves for a few seconds: hot blotches and embers, white on black. */
export function emberTexture(seed = 3) {
  const noise = valueNoise(seed);
  const map = texture(64, 64, (s, t) => {
    const u = s * 2 - 1, v = t * 2 - 1, r = Math.hypot(u, v);
    const blotch = fbm(noise, u * 4 + 9, v * 4 + 9, 3);
    let heat = (1 - smooth(0.1, 0.62, r)) * smooth(0.3, 0.75, blotch);
    if (r < 0.85 && noise(u * 26, v * 26) > 0.86) heat = Math.max(heat, 0.8 * (1 - r));
    return [heat, heat, heat, 1];
  });
  map.colorSpace = THREE.NoColorSpace;
  return map;
}
