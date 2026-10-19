import * as THREE from 'three';
import { createKit, frameOf, blink, createFloorLights, glowTexture, RED, AMBER, WHITE } from './kit.js';

/**
 * The AI laboratory: crates, stacked crates, barrels and low barriers on the
 * steel floor — no walls — with red light panels and red neon strips set into
 * the floor, as in the reference. Every obstacle is an axis-aligned box the
 * game can query: push a walker out of it, cast a bolt or a line of sight
 * against it, and find cover behind it from a threat.
 *
 * Coordinates: the camera looks down along (-8, -8.2, -10), so "up" on screen
 * is the floor direction (-8, 0, -10) and "right" is (10, 0, -8).
 */
const SCREEN_UP = new THREE.Vector3(-8, 0, -10).normalize(), SCREEN_RIGHT = new THREE.Vector3(10, 0, -8).normalize();
/** A floor point from screen-aligned coordinates: u to the right, v up the screen. */
export const onScreen = (u, v) => SCREEN_RIGHT.clone().multiplyScalar(u).addScaledVector(SCREEN_UP, v);

// Obstacles: kind, screen position (u, v), size [x, height, z] in world axes,
// raised (stacked on the one before). Tall enough to hide a crouching trooper.
const LAYOUT = [
  ['crate', -3.4, 3.7, [1.1, 1.2, 1.1]],
  ['crate', -1.2, 4.4, [1.3, 1.15, 0.9]],
  ['crate', 1.4, 3.6, [1.1, 1.2, 1.1]],
  ['crate', 1.4, 3.6, [0.8, 0.6, 0.8], 1],
  ['barrel', 3.4, 4.1, [0.62, 1.05, 0.62]],
  ['barrel', 4.05, 4.6, [0.62, 1.05, 0.62]],
  ['barrier', -2.6, 6.6, [2.6, 1.2, 0.5]],
  ['crate', 2.5, 6.5, [1.3, 1.3, 1.2]],
  ['barrier', 0.2, 1.9, [0.5, 1.15, 1.8]],
  ['crate', -5, 1, [1, 1.15, 1]],
  ['barrel', 4.6, 1.2, [0.62, 1.05, 0.62]],
  ['crate', 5.8, 5.4, [1, 1.15, 1]],
  ['crate', -6.2, 5.2, [1, 1.15, 1]],
  ['crate', -6.2, 5.2, [0.7, 0.55, 0.7], 1],
  ['crate', -3, -2.7, [1.1, 1.15, 1.1]],
  ['barrier', 3.2, -2.4, [2.2, 1.15, 0.5]],
  ['barrel', 6.6, 2.4, [0.62, 1.05, 0.62]],
];

export function createLab(scene) {
  const group = new THREE.Group();
  group.name = 'AI lab';
  // Gunmetal cases, as in the reference: dark sides, lids and frames that
  // catch the light from above, recessed panels, black vents, X braces, pale
  // stencils; white light bars, and only small red and amber diodes.
  const M = {
    metal: new THREE.MeshStandardMaterial({ name: 'shell', color: 0x1b2026, roughness: 0.45, metalness: 0.65 }),
    trim: new THREE.MeshStandardMaterial({ name: 'frame', color: 0x3b424c, roughness: 0.4, metalness: 0.7 }),
    cap: new THREE.MeshStandardMaterial({ name: 'caps', color: 0x59626e, roughness: 0.36, metalness: 0.66 }),
    lid: new THREE.MeshStandardMaterial({ name: 'lids', color: 0x2c323a, roughness: 0.32, metalness: 0.72 }),
    panel: new THREE.MeshStandardMaterial({ name: 'panels', color: 0x181c22, roughness: 0.55, metalness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ name: 'vents', color: 0x090a0d, roughness: 0.75, metalness: 0.4 }),
    stencil: new THREE.MeshStandardMaterial({ name: 'stencils', color: 0x6a717c, roughness: 0.7, metalness: 0.2 }),
    light: new THREE.MeshBasicMaterial({ name: 'white lights', color: WHITE, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ name: 'red diodes', color: RED, toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ name: 'amber diodes', color: AMBER, toneMapped: false }),
  };
  const kit = createKit();

  const obstacles = [];
  for (const [kind, u, v, [sx, sy, sz], raised = 0] of LAYOUT) {
    const centre = onScreen(u, v);
    const base = raised ? obstacles.at(-1).max.y : 0;
    const min = new THREE.Vector3(centre.x - sx / 2, base, centre.z - sz / 2), max = new THREE.Vector3(centre.x + sx / 2, base + sy, centre.z + sz / 2);
    obstacles.push({ kind, min, max, centre: new THREE.Vector3(centre.x, base + sy / 2, centre.z) });
    if (kind === 'barrel') dressBarrel(kit, M, min, max);
    else dressCase(kit, M, min, max, kind === 'barrier', obstacles.length % 3 === 1);
  }
  kit.build(group, { name: 'Lab cases' });

  // Short white light panels set into the floor along the deck's lanes,
  // wherever no case stands on them.
  const floorLights = createFloorLights(group);
  for (const [from, to] of [[[-9, -4.3], [5, -4.3]], [[-6.2, -9], [-6.2, 2.5]], [[4.6, -9], [4.6, 0.5]], [[-9, -8.2], [7, -8.2]], [[-1.8, 2.4], [3.4, 2.4]]]) {
    floorLights.add(new THREE.Vector3(from[0], 0, from[1]), new THREE.Vector3(to[0], 0, to[1]), { every: 2.4 });
  }
  floorLights.spots.splice(0, floorLights.spots.length, ...floorLights.spots.filter(({ at }) => !obstacles.some(box => at.x > box.min.x - 0.4 && at.x < box.max.x + 0.4 && at.z > box.min.z - 0.4 && at.z < box.max.z + 0.4)));
  floorLights.build();
  // Red hatched warning panels before a few cases: lit from beneath, they
  // breathe slowly — the one red light on the floor.
  const markings = [];
  for (const index of [1, 7, 15, 9]) {
    const box = obstacles[index];
    if (!box || box.min.y > 0) continue;
    const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, box.max.z + 0.42);
    const length = box.max.x - box.min.x;
    if (obstacles.some(other => other !== box && centre.x + length / 2 > other.min.x && centre.x - length / 2 < other.max.x && centre.z + 0.2 > other.min.z && centre.z - 0.2 < other.max.z)) continue;
    markings.push(warningPanel(group, centre, length, 0.36, markings.length * 0.29));
  }
  // A soft warm light over the cases, so their lids read as in the reference.
  const lights = [onScreen(-2.2, 3.9), onScreen(2.6, 4.4), onScreen(0, 6.6)].map(at => {
    const light = new THREE.PointLight(0xffe2c0, 1.6, 5.5, 1.6);
    light.position.copy(at).setY(2.2);
    group.add(light);
    return light;
  });
  scene.add(group);
  function update(time) {
    for (const marking of markings) marking.update(time);
  }

  const temp = new THREE.Vector3();
  /** Pushes a walker (a circle on the floor) out of every obstacle; returns the corrected point. */
  function pushOut(position, radius = 0.3) {
    for (const box of obstacles) {
      if (box.min.y > 1.2) continue;
      const nx = THREE.MathUtils.clamp(position.x, box.min.x, box.max.x), nz = THREE.MathUtils.clamp(position.z, box.min.z, box.max.z);
      const dx = position.x - nx, dz = position.z - nz, distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance > 1e-6) {
        position.x = nx + dx / distance * radius;
        position.z = nz + dz / distance * radius;
      } else {
        // Inside: out through the nearest side.
        const exits = [[box.min.x - radius - position.x, 0], [box.max.x + radius - position.x, 0], [0, box.min.z - radius - position.z], [0, box.max.z + radius - position.z]];
        exits.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        position.x += exits[0][0];
        position.z += exits[0][1];
      }
    }
    return position;
  }
  /**
   * First obstacle a segment crosses: { t (0..1), point, normal, box } or null
   * (slab method). skip: a box to ignore, or a test that rejects boxes.
   */
  function segmentHit(a, b, skip = null) {
    let best = null;
    const d = temp.subVectors(b, a);
    for (const box of obstacles) {
      if (box === skip || (typeof skip === 'function' && skip(box))) continue;
      let enter = 0, exit = 1, axis = -1, sign = 0;
      let ok = true;
      for (const [k, i] of [['x', 0], ['y', 1], ['z', 2]]) {
        if (Math.abs(d[k]) < 1e-9) {
          if (a[k] < box.min[k] || a[k] > box.max[k]) { ok = false; break; }
          continue;
        }
        let t0 = (box.min[k] - a[k]) / d[k], t1 = (box.max[k] - a[k]) / d[k];
        let s = -1;
        if (t0 > t1) { [t0, t1] = [t1, t0]; s = 1; }
        if (t0 > enter) { enter = t0; axis = i; sign = s; }
        exit = Math.min(exit, t1);
        if (enter > exit) { ok = false; break; }
      }
      if (!ok || (best && enter >= best.t)) continue;
      const normal = new THREE.Vector3();
      if (axis >= 0) normal.setComponent(axis, sign);
      best = { t: enter, point: a.clone().addScaledVector(d, enter), normal, box };
    }
    return best;
  }
  const clear = (a, b) => !segmentHit(a, b);
  /**
   * Places to hide from `threat`: just outside each face of each obstacle,
   * where the obstacle stands between the threat and a crouching trooper.
   */
  function coverSpots(threat, { minDistance = 3 } = {}) {
    const spots = [];
    const eye = threat.clone().setY(1.2);
    for (const box of obstacles) {
      if (box.min.y > 0.5 || box.max.y < 0.75 || box.kind === 'wall' || box.kind === 'rail') continue;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, hx = (box.max.x - box.min.x) / 2, hz = (box.max.z - box.min.z) / 2;
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const offset of [-0.3, 0.3]) {
          const spot = new THREE.Vector3(cx + nx * (hx + 0.42) + (nz ? offset * hx : 0), 0, cz + nz * (hz + 0.42) + (nx ? offset * hz : 0));
          if (spot.distanceTo(threat.clone().setY(0)) < minDistance) continue;
          if (obstacles.some(other => spot.x > other.min.x - 0.25 && spot.x < other.max.x + 0.25 && spot.z > other.min.z - 0.25 && spot.z < other.max.z + 0.25)) continue;
          // Covered when crouching: the line from the threat to his head meets this obstacle.
          const hit = segmentHit(eye, spot.clone().setY(0.72));
          if (!hit || hit.box !== box && !(hit.box.min.y > 0.5 && hit.box.centre.distanceTo(box.centre) < 1.5)) continue;
          spots.push({ position: spot, box, tall: box.max.y > 1.3 || obstacles.some(other => other.min.y > 0.5 && Math.abs(other.centre.x - cx) < 0.1 && Math.abs(other.centre.z - cz) < 0.1), facing: new THREE.Vector3(-nx, 0, -nz) });
        }
      }
    }
    return spots;
  }
  return { group, obstacles, lights, floorLights, markings, pushOut, segmentHit, clear, coverSpots, update };
}

/** A case seen from the camera (+X, +Z and its lid): frame, caps, panels, vents, handles, lights. */
function dressCase(kit, M, min, max, barrier, braced = false) {
  const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2, t = 0.07;
  kit.box(M.metal, sx - 0.04, sy - 0.03, sz - 0.04, [cx, cy - 0.015, cz]);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) kit.box(M.trim, t, sy, t, [cx + dx * (sx / 2 - t / 2), cy, cz + dz * (sz / 2 - t / 2)]);
  for (const y of [min.y + t / 2, max.y - t / 2]) {
    for (const dz of [-1, 1]) kit.box(M.trim, sx, t, t, [cx, y, cz + dz * (sz / 2 - t / 2)]);
    for (const dx of [-1, 1]) kit.box(M.trim, t, t, sz, [cx + dx * (sx / 2 - t / 2), y, cz]);
  }
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) kit.box(M.cap, 0.13, 0.05, 0.13, [cx + dx * (sx / 2 - 0.055), max.y - 0.015, cz + dz * (sz / 2 - 0.055)]);
  // The lid: an inset panel, a raised spine, two latches.
  kit.box(M.lid, sx - 0.1, 0.02, sz - 0.1, [cx, max.y - 0.006, cz]);
  kit.box(M.trim, sx > sz ? sx - 0.36 : 0.05, 0.02, sx > sz ? 0.05 : sz - 0.36, [cx, max.y + 0.004, cz]);
  for (const side of [-1, 1]) kit.box(M.cap, 0.09, 0.03, 0.05, [cx + side * sx * 0.25, max.y + 0.008, cz + sz / 2 - 0.1]);
  const faces = [
    { origin: new THREE.Vector3(cx, min.y, max.z), along: new THREE.Vector3(1, 0, 0), width: sx, main: true },
    { origin: new THREE.Vector3(max.x, min.y, cz), along: new THREE.Vector3(0, 0, -1), width: sz, main: false },
  ];
  for (const { origin, along, width, main } of faces) {
    const f = frameOf(origin, along);
    const long = barrier && width > 1.2;
    // Recessed panels (segmented along a long barrier), ribbed below.
    const count = long ? Math.max(2, Math.round(width / 0.75)) : 1, span = (width - 0.16) / count;
    for (let i = 0; i < count; i++) {
      const a = -width / 2 + 0.08 + span * (i + 0.5);
      kit.box(M.panel, span - 0.07, sy * 0.58, 0.02, [a, sy * 0.44, 0.004], null, f);
      for (let r = 0; r < 3; r++) kit.box(M.trim, span - 0.14, 0.022, 0.018, [a, sy * (0.22 + r * 0.075), 0.016], null, f);
    }
    if (long) {
      // A white light bar along the long side, a red diode at one end, amber at the other.
      kit.box(M.dark, width * 0.42, 0.07, 0.016, [width * 0.12, sy - 0.16, 0.006], null, f);
      kit.box(M.light, width * 0.38, 0.03, 0.012, [width * 0.12, sy - 0.16, 0.016], null, f);
      kit.box(M.glow, 0.05, 0.022, 0.014, [-(width / 2 - 0.14), sy - 0.16, 0.016], null, f);
      kit.box(M.amber, 0.03, 0.022, 0.014, [width / 2 - 0.13, sy - 0.16, 0.016], null, f);
      continue;
    }
    if (main) {
      // A vent, a short white light bar, amber diodes and stencilled marks.
      kit.box(M.dark, width * 0.3, 0.2, 0.012, [-width * 0.2, sy * 0.68, 0.01], null, f);
      for (let i = 0; i < 5; i++) kit.box(M.trim, width * 0.27, 0.014, 0.022, [-width * 0.2, sy * 0.68 - 0.08 + i * 0.04, 0.016], null, f);
      kit.box(M.dark, width * 0.3, 0.06, 0.016, [width * 0.18, sy * 0.8, 0.006], null, f);
      kit.box(M.light, width * 0.25, 0.026, 0.012, [width * 0.18, sy * 0.8, 0.016], null, f);
      for (let i = 0; i < 2; i++) kit.box(M.amber, 0.03, 0.022, 0.012, [width * 0.06 + i * 0.05, sy * 0.69, 0.016], null, f);
      for (let i = 0; i < 3; i++) kit.box(M.stencil, 0.05 + (i % 2) * 0.03, 0.018, 0.006, [width * 0.08 + i * 0.075, sy * 0.13, 0.016], null, f);
    } else {
      if (braced) {
        // An X brace across the side panel.
        const w = width - 0.2, h = sy * 0.58, angle = Math.atan2(h, w), span = Math.hypot(w, h);
        for (const turn of [angle, -angle]) kit.box(M.trim, span, 0.045, 0.03, [0, sy * 0.44, 0.028], [0, 0, turn], f);
      }
      // A thin red diode in its housing, a handle on standoffs.
      kit.box(M.dark, 0.06, sy * 0.3, 0.016, [width * 0.33, sy * 0.55, 0.006], null, f);
      kit.box(M.glow, 0.022, sy * 0.24, 0.012, [width * 0.33, sy * 0.55, 0.016], null, f);
      kit.box(M.cap, 0.24, 0.026, 0.026, [-width * 0.12, sy * 0.78, 0.05], null, f);
      for (const side of [-1, 1]) kit.box(M.trim, 0.026, 0.026, 0.05, [-width * 0.12 + side * 0.1, sy * 0.78, 0.025], null, f);
      kit.box(M.amber, 0.03, 0.022, 0.012, [width * 0.33, sy * 0.78, 0.016], null, f);
    }
  }
}

/** A drum: ribbed, banded at the foot, a red light band near the top, a lid with a valve. */
function dressBarrel(kit, M, min, max) {
  const r = (max.x - min.x) / 2, sy = max.y - min.y, cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2, n = 20;
  kit.cylinder(M.metal, r - 0.008, r, sy - 0.02, n, [cx, min.y + sy / 2 - 0.01, cz]);
  kit.cylinder(M.dark, r + 0.006, r + 0.006, 0.06, n, [cx, min.y + 0.03, cz]);
  for (const y of [0.22, 0.5]) kit.cylinder(M.trim, r + 0.014, r + 0.014, 0.045, n, [cx, min.y + sy * y, cz]);
  kit.cylinder(M.dark, r + 0.008, r + 0.008, 0.06, n, [cx, min.y + sy * 0.82, cz]);
  kit.cylinder(M.glow, r + 0.012, r + 0.012, 0.024, n, [cx, min.y + sy * 0.82, cz]);
  kit.cylinder(M.trim, r - 0.004, r - 0.004, 0.03, n, [cx, max.y - 0.01, cz]);
  kit.cylinder(M.lid, r * 0.8, r * 0.8, 0.012, n, [cx, max.y + 0.008, cz]);
  kit.cylinder(M.cap, 0.035, 0.035, 0.06, 10, [cx + r * 0.4, max.y + 0.03, cz + r * 0.25]);
  kit.box(M.stencil, 0.12, 0.02, 0.006, [cx, min.y + sy * 0.36, cz + r + 0.004]);
}

/**
 * A red hatched warning panel set into the floor, lit from beneath: dim red
 * stripes that breathe slowly, and a faint red glow on the steel around.
 */
export function warningPanel(parent, centre, length, width, phase = 0, { along = new THREE.Vector3(1, 0, 0), y = 0 } = {}) {
  const angle = Math.atan2(along.z, along.x) * -1;
  const material = new THREE.MeshBasicMaterial({ map: hatchTexture(), color: RED.clone(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(length, width), material);
  panel.rotation.set(-Math.PI / 2, 0, angle);
  panel.position.copy(centre).setY(y + 0.005);
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: RED.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(length + 0.8, width + 0.9), glowMaterial);
  glow.rotation.copy(panel.rotation);
  glow.position.copy(centre).setY(y + 0.013);
  glow.renderOrder = 2;
  parent.add(panel, glow);
  return {
    panel,
    update(time) {
      const k = blink(time, phase, 4.6);
      material.color.copy(RED).multiplyScalar(0.3 + 0.38 * k);
      glowMaterial.color.copy(RED).multiplyScalar(0.07 * k);
    },
  };
}

let hatch = null;
/** Diagonal stripes inside a thin frame, worn at random. */
function hatchTexture() {
  if (hatch) return hatch;
  const w = 96, h = 16, data = new Uint8Array(w * h * 4);
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const frame = y === 0 || y === h - 1 || x === 0 || x === w - 1;
    const stripe = Math.floor((x + y) / 4) % 2 === 0;
    const alpha = frame ? 200 : stripe && random() > 0.12 ? 210 : 0;
    data.set([255, 255, 255, alpha], (y * w + x) * 4);
  }
  hatch = new THREE.DataTexture(data, w, h);
  hatch.magFilter = THREE.NearestFilter;
  hatch.minFilter = THREE.LinearFilter;
  hatch.needsUpdate = true;
  return hatch;
}
