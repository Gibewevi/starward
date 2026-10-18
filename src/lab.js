import * as THREE from 'three';

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
  const metal = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.55 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x343a44, roughness: 0.5, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.7, metalness: 0.3 });
  // Red light, like the panels and floor strips of the reference. The frame is
  // tone-mapped (ACES) after the bloom: brighter than this, red turns orange.
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.78, 0.008, 0.008), toneMapped: false });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.004, 0.004), toneMapped: false });
  const piece = (geometry, material, position, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const obstacles = [];
  for (const [kind, u, v, [sx, sy, sz], raised = 0] of LAYOUT) {
    const centre = onScreen(u, v);
    const base = raised ? obstacles.at(-1).max.y : 0;
    const min = new THREE.Vector3(centre.x - sx / 2, base, centre.z - sz / 2), max = new THREE.Vector3(centre.x + sx / 2, base + sy, centre.z + sz / 2);
    obstacles.push({ kind, min, max, centre: new THREE.Vector3(centre.x, base + sy / 2, centre.z) });
    const at = new THREE.Vector3(centre.x, base + sy / 2, centre.z);
    if (kind === 'barrel') {
      const radius = sx / 2;
      piece(new THREE.CylinderGeometry(radius, radius, sy, 12), metal, at);
      for (const y of [0.18, 0.55]) piece(new THREE.CylinderGeometry(radius + 0.015, radius + 0.015, 0.05, 12), panel, at.clone().setY(base + sy * y));
      piece(new THREE.CylinderGeometry(radius + 0.01, radius + 0.01, 0.035, 12), glow, at.clone().setY(base + sy * 0.82));
      piece(new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, 0.02, 12), dark, at.clone().setY(base + sy + 0.005));
      continue;
    }
    // Crates and barriers: a dark shell, framed edges, inset panels, red light.
    piece(new THREE.BoxGeometry(sx, sy, sz), metal, at);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      piece(new THREE.BoxGeometry(0.06, sy + 0.01, 0.06), panel, new THREE.Vector3(at.x + dx * (sx / 2 - 0.02), at.y, at.z + dz * (sz / 2 - 0.02)));
    }
    piece(new THREE.BoxGeometry(sx - 0.12, 0.03, sz - 0.12), panel, new THREE.Vector3(at.x, base + sy + 0.012, at.z));
    // Light panels on the faces the camera sees (+X and +Z).
    if (kind === 'barrier') {
      const long = sx > sz;
      piece(new THREE.BoxGeometry(long ? sx - 0.2 : 0.012, 0.05, long ? 0.012 : sz - 0.2), glow, new THREE.Vector3(at.x + (long ? 0 : sx / 2 + 0.006), base + sy - 0.12, at.z + (long ? sz / 2 + 0.006 : 0)));
    } else {
      piece(new THREE.BoxGeometry(sx * 0.42, 0.06, 0.012), glow, new THREE.Vector3(at.x - sx * 0.15, base + sy * 0.7, at.z + sz / 2 + 0.006));
      piece(new THREE.BoxGeometry(0.012, sy * 0.35, sz * 0.18), glow, new THREE.Vector3(at.x + sx / 2 + 0.006, base + sy * 0.55, at.z + sz * 0.25));
      piece(new THREE.BoxGeometry(sx * 0.7, sy * 0.5, 0.01), dark, new THREE.Vector3(at.x + sx * 0.05, base + sy * 0.4, at.z + sz / 2 + 0.004));
    }
  }

  // Red neon strips set into the floor, along the grid, like the reference.
  for (const [from, to] of [[[-9, -4.3], [5, -4.3]], [[-6.2, -9], [-6.2, 2.5]], [[4.6, -9], [4.6, 0.5]], [[-9, -8.2], [7, -8.2]], [[-1.8, 2.4], [3.4, 2.4]]]) {
    const a = new THREE.Vector3(from[0], 0.006, from[1]), b = new THREE.Vector3(to[0], 0.006, to[1]);
    const length = a.distanceTo(b), along = b.clone().sub(a).normalize();
    const strip = piece(new THREE.BoxGeometry(along.x ? length : 0.05, 0.008, along.z ? length : 0.05), neon, a.clone().add(b).multiplyScalar(0.5));
    strip.castShadow = false;
  }
  // Red light spills onto the troopers and the floor around the crates.
  const lights = [onScreen(-2.2, 3.9), onScreen(2.6, 4.4), onScreen(0, 6.6)].map(at => {
    const light = new THREE.PointLight(0xff3328, 3.2, 5.5, 1.6);
    light.position.copy(at).setY(0.9);
    group.add(light);
    return light;
  });
  scene.add(group);

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
  /** First obstacle a segment crosses: { t (0..1), point, normal, box } or null (slab method). */
  function segmentHit(a, b, skip = null) {
    let best = null;
    const d = temp.subVectors(b, a);
    for (const box of obstacles) {
      if (box === skip) continue;
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
      if (box.min.y > 0.5 || box.max.y < 0.75) continue;
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
  return { group, obstacles, lights, pushOut, segmentHit, clear, coverSpots };
}
