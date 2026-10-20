import * as THREE from 'three';
import { createKit, frameOf, glowTexture, createFloorLights, RED, AMBER, WHITE, EMBER } from './kit.js';
import { deckGeometry } from './stage.js';

/**
 * The room around the lab, after the reference: the deck is closed at the
 * back by two tall walls meeting in a corner — pillars carrying short light
 * bars, consoles with blinking indicators, a window onto a dim control room,
 * vents, a great door with a round boss, pipes along the top — and open at
 * the front, where a railing runs along the edge of the deck above a lower
 * level. Sober, as in the reference: gunmetal, warm white light bars and
 * floor lights, a few grates glowing amber from below, worn hazard edging —
 * red only as accents (the lights flanking the door, small diodes).
 *
 * The great door opens: its two leaves slide into the wall onto a lit
 * corridor, from where reinforcements march in (see reinforcements.js);
 * arena.door: open(), close(), openness, and where to stand inside and out.
 *
 * Walls, consoles and railings join the lab's obstacles (kinds 'wall' and
 * 'rail'): walkers, bodies, bolts and grenades meet them; no one takes cover
 * behind them. update(time) runs the lights and the door.
 */
export const ARENA = { minX: -10.4, maxX: 8.4, minZ: -11.2, maxZ: 7.4, height: 5.4, drop: 2.8 };
// The ground tier's cornice; above it the wall goes on up, darker, out of sight.
const TIER = 3.6;

export function createArena(scene, { lab = null, floorMaterial = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Room';
  const { minX, maxX, minZ, maxZ, height: H, drop } = ARENA;
  const M = {
    wall: new THREE.MeshStandardMaterial({ name: 'wall', color: 0x181c22, roughness: 0.6, metalness: 0.55 }),
    panel: new THREE.MeshStandardMaterial({ name: 'wall panels', color: 0x232830, roughness: 0.46, metalness: 0.62 }),
    trim: new THREE.MeshStandardMaterial({ name: 'wall trim', color: 0x353c46, roughness: 0.38, metalness: 0.7 }),
    cap: new THREE.MeshStandardMaterial({ name: 'bright trim', color: 0x4a525d, roughness: 0.34, metalness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ name: 'recesses', color: 0x08090c, roughness: 0.75, metalness: 0.4 }),
    pipe: new THREE.MeshStandardMaterial({ name: 'pipes', color: 0x22272e, roughness: 0.28, metalness: 0.88 }),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: 0x0a0e14, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.45, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ name: 'white lights', color: WHITE, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ name: 'red lights', color: RED, toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ name: 'amber lights', color: AMBER, toneMapped: false }),
    screen: new THREE.MeshBasicMaterial({ name: 'screens', color: new THREE.Color(0.05, 0.085, 0.11), toneMapped: false }),
    room: new THREE.MeshBasicMaterial({ name: 'control room light', color: new THREE.Color(0.04, 0.055, 0.07), toneMapped: false }),
  };
  const kit = createKit();
  const obstacles = [];
  const block = (kind, min, max) => { const box = { kind, min, max, centre: min.clone().add(max).multiplyScalar(0.5) }; obstacles.push(box); return box; };
  const indicators = [], lights = [];
  // The door's own lamp, so it can blink on its own.
  M.doorLamp = new THREE.MeshBasicMaterial({ name: 'door lamp', color: AMBER.clone(), toneMapped: false });
  let door = null;
  const floorLights = createFloorLights(group);

  // ---- The back walls ---------------------------------------------------------
  // One along x at minZ (facing +z), one along z at minX (facing +x).
  const walls = [
    { origin: new THREE.Vector3(minX, 0, minZ), along: new THREE.Vector3(1, 0, 0), length: maxX - minX + 0.6, bays: ['console', 'window', 'vent', 'door', 'console', 'vent'] },
    { origin: new THREE.Vector3(minX, 0, maxZ + 0.6), along: new THREE.Vector3(0, 0, -1), length: maxZ - minZ + 0.6, bays: ['vent', 'console', 'window', 'console', 'vent', 'window'] },
  ];
  const pitch = 3.2;
  let doorWall = null;
  for (const wall of walls) {
    const f = frameOf(wall.origin, wall.along), L = wall.length;
    const toWorld = (a, y, n) => new THREE.Vector3(a, y, n).applyMatrix4(f);
    const pillars = [];
    for (let a = 0.45; a < L - 0.3; a += pitch) pillars.push(a);
    const doorBay = wall.bays.indexOf('door'), redPillars = new Set(doorBay >= 0 ? [doorBay, doorBay + 1] : []);
    // Bays between the pillars; the wall slab is built bay by bay so windows can open in it.
    for (let i = 0; i < pillars.length; i++) {
      const from = pillars[i] + 0.31, to = (pillars[i + 1] ?? L) - (pillars[i + 1] ? 0.31 : 0), w = to - from, mid = (from + to) / 2;
      const kind = wall.bays[i % wall.bays.length];
      if (kind === 'window') {
        kit.box(M.wall, w + 0.62, 1.05, 0.5, [mid, 0.525, -0.25], null, f);
        kit.box(M.wall, w + 0.62, H - 2.45, 0.5, [mid, (H + 2.45) / 2, -0.25], null, f);
        for (const side of [from, to]) kit.box(M.dark, 0.04, 1.4, 1.5, [side, 1.75, -0.75], null, f);
        // The control room behind the glass: dim, cold, consoles in silhouette.
        kit.box(M.room, w, 1.4, 0.04, [mid, 1.75, -1.5], null, f);
        for (let k = 0; k < 2; k++) kit.box(M.light, w * 0.25, 0.025, 0.02, [from + w * (0.3 + k * 0.4), 2.38, -1.2], null, f);
        kit.box(M.dark, w, 0.04, 1.5, [mid, 1.05, -0.75], null, f);
        kit.box(M.dark, w, 0.04, 1.5, [mid, 2.45, -0.75], null, f);
        for (let k = 0; k < 3; k++) {
          const at = from + w * (0.2 + k * 0.3);
          kit.box(M.dark, w * 0.2, 0.32, 0.35, [at, 1.22, -1.1], null, f);
          kit.box(M.screen, w * 0.12, 0.08, 0.01, [at, 1.42, -0.92], [-0.6, 0, 0], f);
        }
        kit.box(M.glass, w, 1.4, 0.02, [mid, 1.75, -0.08], null, f);
        kit.box(M.trim, w, 0.1, 0.16, [mid, 1.03, 0.04], null, f);
        kit.box(M.trim, w, 0.08, 0.1, [mid, 2.47, 0.0], null, f);
        for (let k = 1; k < 3; k++) kit.box(M.trim, 0.05, 1.4, 0.06, [from + w * k / 3, 1.75, -0.06], null, f);
        lights.push(pointLight(toWorld(mid, 1.75, 0.5), 1.4, 3.2));
      } else if (kind !== 'door') {
        kit.box(M.wall, w + 0.62, H, 0.5, [mid, H / 2, -0.25], null, f);
      }
      // Grooves, a kick plate, a cornice: the wall's rhythm (not across the doorway).
      if (kind !== 'door') {
        for (const y of [1.0, 2.25]) if (kind !== 'window' || y < 1) kit.box(M.dark, w, 0.025, 0.02, [mid, y, 0.005], null, f);
        kit.box(M.trim, w, 0.22, 0.08, [mid, 0.11, 0.04], null, f);
      }
      kit.box(M.trim, w, 0.18, 0.24, [mid, TIER - 0.09, 0.12], null, f);
      kit.box(M.dark, w, 0.05, 0.2, [mid, TIER - 0.2, 0.08], null, f);
      // The upper tier: plain dark panels, a gantry, a white light bar.
      kit.box(M.dark, w, 0.03, 0.02, [mid, TIER + 0.6, 0.005], null, f);
      kit.box(M.trim, w, 0.08, 0.5, [mid, TIER + 0.35, 0.25], null, f);
      kit.box(M.pipe, w, 0.03, 0.03, [mid, TIER + 0.85, 0.48], null, f);
      kit.box(M.dark, 0.5, 0.07, 0.03, [mid, TIER + 1.2, 0.015], null, f);
      kit.box(M.light, 0.44, 0.03, 0.02, [mid, TIER + 1.2, 0.03], null, f);
      // A white light bar at mid height on plain bays, as on the reference's walls.
      if (kind === 'vent' || kind === 'console') kit.box(M.dark, 0.5, 0.08, 0.03, [to - 0.45, 2.75, 0.015], null, f), kit.box(M.light, 0.42, 0.035, 0.02, [to - 0.45, 2.75, 0.03], null, f);
      if (kind === 'console') {
        // A desk with a sloping top, screens and blinking indicators; a monitor above.
        kit.box(M.panel, w * 0.82, 0.82, 0.5, [mid, 0.41, 0.27], null, f);
        kit.box(M.cap, w * 0.82, 0.06, 0.46, [mid, 0.86, 0.3], [0.42, 0, 0], f);
        for (let k = 0; k < 3; k++) kit.box(M.screen, w * 0.18, 0.012, 0.16, [from + w * (0.22 + k * 0.28), 0.892, 0.314], [0.42, 0, 0], f);
        for (let k = 0; k < 12; k++) indicators.push({ at: toWorld(from + w * 0.13 + k * w * 0.06, 0.66, 0.525), turn: -Math.atan2(wall.along.z, wall.along.x), period: 0.4 + (k * 37 % 11) / 6, phase: (k * 0.37) % 1, color: k % 5 === 1 ? RED : k % 3 === 0 ? AMBER : WHITE.clone().multiplyScalar(0.55) });
        kit.box(M.dark, w * 0.5, 0.62, 0.06, [mid, 1.75, 0.03], null, f);
        kit.box(M.screen, w * 0.44, 0.5, 0.01, [mid, 1.75, 0.065], null, f);
        for (let k = 0; k < 4; k++) kit.box(M.dark, w * 0.36 * (0.5 + (k % 3) * 0.25), 0.025, 0.004, [mid - w * 0.04, 1.62 + k * 0.08, 0.072], null, f);
        block('wall', toWorld(from + w * 0.09, 0, 0).min(toWorld(to - w * 0.09, 0.9, 0.55)), toWorld(from + w * 0.09, 0, 0).max(toWorld(to - w * 0.09, 0.9, 0.55)));
      } else if (kind === 'vent') {
        // A tall grille between two vertical pipes.
        kit.box(M.trim, w * 0.62, 1.5, 0.06, [mid, 1.35, 0.03], null, f);
        kit.box(M.dark, w * 0.56, 1.38, 0.02, [mid, 1.35, 0.065], null, f);
        for (let k = 0; k < 11; k++) kit.box(k % 2 ? M.pipe : M.trim, w * 0.55, 0.045, 0.05, [mid, 0.73 + k * 0.124, 0.08], [0.5, 0, 0], f);
        for (const side of [-1, 1]) {
          kit.cylinder(M.pipe, 0.07, 0.07, TIER - 0.3, 14, [mid + side * w * 0.4, (TIER - 0.3) / 2, 0.14], null, f);
          for (const y of [0.6, 1.8, 2.8]) kit.box(M.trim, 0.2, 0.06, 0.2, [mid + side * w * 0.4, y, 0.1], null, f);
        }
      } else if (kind === 'door') {
        // The great door: jambs and lintel, a white bar and an amber lamp
        // above; the wall round the doorway; a lit corridor behind; two
        // leaves (a round boss split across them) that slide into the wall.
        const left = from + 0.22, right = to - 0.22, ow = right - left, oh = 2.9;
        kit.box(M.wall, left - (mid - (w + 0.62) / 2), H, 0.5, [(mid - (w + 0.62) / 2 + left) / 2, H / 2, -0.25], null, f);
        kit.box(M.wall, mid + (w + 0.62) / 2 - right, H, 0.5, [(right + mid + (w + 0.62) / 2) / 2, H / 2, -0.25], null, f);
        kit.box(M.wall, ow, H - oh, 0.5, [mid, (H + oh) / 2, -0.25], null, f);
        kit.box(M.trim, 0.22, 3.05, 0.26, [from + 0.11, 1.525, 0.13], null, f);
        kit.box(M.trim, 0.22, 3.05, 0.26, [to - 0.11, 1.525, 0.13], null, f);
        kit.box(M.trim, w, 0.3, 0.26, [mid, 3.0, 0.13], null, f);
        kit.box(M.cap, ow, 0.05, 0.3, [mid, 0.025, -0.1], null, f);
        kit.box(M.dark, w * 0.6, 0.08, 0.02, [mid, 3.0, 0.27], null, f);
        kit.box(M.light, w * 0.55, 0.04, 0.012, [mid, 3.0, 0.28], null, f);
        kit.box(M.doorLamp, 0.12, 0.08, 0.05, [to - 0.32, 2.75, 0.28], null, f);
        // The corridor: floor, walls, ceiling, a light down its middle and one at its end.
        const depth = 4.4, back = -0.5 - depth;
        kit.box(M.panel, ow + 0.6, 0.04, depth, [mid, -0.02, -0.5 - depth / 2], null, f);
        for (const side of [-1, 1]) kit.box(M.wall, 0.25, oh + 0.1, depth, [mid + side * (ow / 2 + 0.125), (oh + 0.1) / 2, -0.5 - depth / 2], null, f);
        kit.box(M.wall, ow + 0.6, 0.2, depth, [mid, oh + 0.1, -0.5 - depth / 2], null, f);
        kit.box(M.wall, ow + 0.6, oh + 0.2, 0.25, [mid, (oh + 0.2) / 2, back - 0.125], null, f);
        kit.box(M.light, 0.07, 0.02, depth - 0.6, [mid, oh - 0.01, -0.5 - depth / 2], null, f);
        kit.box(M.light, ow * 0.5, 0.06, 0.02, [mid, 2.4, back + 0.01], null, f);
        // Light strips down both of its walls, seen through the doorway.
        for (const side of [-1, 1]) for (const n of [-1.1, -2.4, -3.7]) kit.box(M.light, 0.02, 0.9, 0.06, [mid + side * (ow / 2 - 0.005), 1.6, n], null, f);
        for (const side of [-1, 1]) kit.box(M.trim, 0.04, oh, 0.08, [mid + side * (ow / 2 - 0.02), oh / 2, -1.6], null, f), kit.box(M.trim, 0.04, oh, 0.08, [mid + side * (ow / 2 - 0.02), oh / 2, -3.2], null, f);
        lights.push(pointLight(toWorld(mid, 2.4, -2.6), 1.1, 4.5));
        floorLights.add(toWorld(mid, 0, -1.2), toWorld(mid, 0, back + 0.6), { every: 1.6 });
        // The leaves, each its own group, recessed a hand behind the wall face.
        const root = new THREE.Group();
        root.name = 'Door';
        f.decompose(root.position, root.quaternion, root.scale);
        const leaves = [-1, 1].map(side => {
          const leaf = new THREE.Group();
          const part = (geometry, material, x, y, z, rx = 0, rz = 0) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            mesh.rotation.set(rx, 0, rz);
            mesh.castShadow = mesh.receiveShadow = true;
            leaf.add(mesh);
          };
          const half = ow / 2 + 0.03, edge = -side * half / 2;
          part(new THREE.BoxGeometry(half, oh - 0.04, 0.1), M.panel, 0, (oh - 0.04) / 2, -0.12);
          // Half the boss: the half on this leaf's side of the seam.
          const arc = side < 0 ? Math.PI : 0;
          part(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 40, 1, false, arc, Math.PI), M.cap, edge, 1.75, -0.05, Math.PI / 2);
          part(new THREE.CylinderGeometry(0.82, 0.82, 0.07, 40, 1, false, arc, Math.PI), M.dark, edge, 1.75, -0.045, Math.PI / 2);
          part(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 6, 1, false, arc, Math.PI), M.trim, edge, 1.75, -0.04, Math.PI / 2);
          for (let k = 0; k < 6; k++) {
            const x = Math.sin(k * Math.PI / 3 + 0.0001) * 0.66;
            if (Math.sign(x) !== side) continue;
            part(new THREE.BoxGeometry(0.05, 0.3, 0.08), M.trim, edge + x, 1.75 + Math.cos(k * Math.PI / 3) * 0.66, -0.04, 0, -k * Math.PI / 3);
          }
          part(new THREE.BoxGeometry(0.03, oh - 0.04, 0.12), M.dark, edge, (oh - 0.04) / 2, -0.1);
          leaf.userData = { closed: mid + side * half / 2, open: mid + side * (half / 2 + half + 0.12) };
          leaf.position.x = leaf.userData.closed;
          root.add(leaf);
          return leaf;
        });
        group.add(root);
        hazard(toWorld(mid, 0, 0.55), wall.along, w - 0.3, 0.3);
        lights.push(pointLight(toWorld(mid, 2.6, 0.9), 1.4, 4));
        const out = new THREE.Vector3(0, 0, 1).transformDirection(f);
        // Closed, the door is a wall; open, a way through.
        const shut0 = toWorld(left, 0, -0.17), shut1 = toWorld(right, oh, 0.01);
        door = {
          leaves, openness: 0, target: 0, from: left, to: right, wallFrame: f,
          shut: { kind: 'wall', min: shut0.clone().min(shut1), max: shut0.clone().max(shut1), centre: shut0.clone().add(shut1).multiplyScalar(0.5) },
          centre: toWorld(mid, 0, 0), out, along: wall.along.clone(), width: ow,
          // Where men stand in the corridor, deepest first, in two files.
          inside: [toWorld(mid - 0.45, 0, back + 0.7), toWorld(mid + 0.45, 0, back + 0.7), toWorld(mid - 0.45, 0, back + 1.6), toWorld(mid + 0.45, 0, back + 1.6)],
        };
        doorWall = { wallIndex: walls.indexOf(wall), left, right };
        // The corridor's walls stop the hero; its end too.
        for (const side of [-1, 1]) { const c0 = toWorld(mid + side * (ow / 2 + 0.25), 0, -0.5), c1 = toWorld(mid + side * ow / 2, oh, back); block('wall', c0.clone().min(c1), c0.clone().max(c1)); }
        { const c0 = toWorld(mid - ow / 2, 0, back), c1 = toWorld(mid + ow / 2, oh, back - 0.25); block('wall', c0.clone().min(c1), c0.clone().max(c1)); }
      }
      // Pipes running along the top, held by brackets.
      kit.cylinder(M.pipe, 0.06, 0.06, w + 0.02, 14, [mid, TIER - 0.48, 0.16], [0, 0, Math.PI / 2], f);
      kit.cylinder(M.pipe, 0.042, 0.042, w + 0.02, 12, [mid, TIER - 0.66, 0.12], [0, 0, Math.PI / 2], f);
    }
    // Pillars: a short white light (red beside the door) in a dark housing, on a heavy base.
    for (const [index, a] of pillars.entries()) {
      const red = redPillars.has(index);
      kit.box(M.panel, 0.62, H, 0.34, [a, H / 2, 0.17], null, f);
      for (const side of [-1, 1]) kit.box(M.trim, 0.06, H, 0.06, [a + side * 0.28, H / 2, 0.33], null, f);
      kit.box(M.cap, 0.74, 0.4, 0.42, [a, 0.2, 0.21], null, f);
      kit.box(M.cap, 0.74, 0.2, 0.42, [a, TIER - 0.3, 0.21], null, f);
      kit.box(M.dark, 0.14, red ? 1.5 : 0.95, 0.03, [a, red ? 1.75 : 2.15, 0.35], null, f);
      kit.box(red ? M.glow : M.light, red ? 0.045 : 0.06, red ? 1.38 : 0.82, 0.02, [a, red ? 1.75 : 2.15, 0.365], null, f);
      kit.box(M.amber, 0.04, 0.04, 0.02, [a, 0.55, 0.43], null, f);
      if (index % 2 === 0) lights.push(pointLight(toWorld(a, 2.1, 0.8), 1.3, 4.2));
    }
    // Walkers, bodies and bolts meet the wall and its pillars, on their real
    // faces — the wall in two pieces either side of a doorway.
    const spans = doorWall && doorWall.wallIndex === walls.indexOf(wall) ? [[-0.6, doorWall.left], [doorWall.right, L + 0.6]] : [[-0.6, L + 0.6]];
    for (const [a, b] of spans) { const a0 = toWorld(a, 0, -0.6), a1 = toWorld(b, H, 0.01); block('wall', a0.clone().min(a1), a0.clone().max(a1)); }
    for (const a of pillars) { const p0 = toWorld(a - 0.37, 0, 0), p1 = toWorld(a + 0.37, H, 0.43); block('wall', p0.clone().min(p1), p0.clone().max(p1)); }
    // Light panels in the floor along its foot.
    floorLights.add(toWorld(1.2, 0, 0.9), toWorld(L - 0.8, 0, 0.9), { every: 2.6 });
  }
  // The corner where the walls meet: a broad column with its own light.
  kit.box(M.panel, 1.0, H + 0.2, 1.0, [minX + 0.3, (H + 0.2) / 2, minZ + 0.3]);
  kit.box(M.dark, 0.03, 2.2, 0.24, [minX + 0.81, 1.7, minZ + 0.45]);
  kit.box(M.light, 0.02, 0.9, 0.08, [minX + 0.825, 2.2, minZ + 0.45]);
  block('wall', new THREE.Vector3(minX - 0.2, 0, minZ - 0.2), new THREE.Vector3(minX + 0.8, H + 0.2, minZ + 0.8));

  // ---- The front edge: a railing above the lower level ---------------------------
  const edges = [
    { origin: new THREE.Vector3(minX + 0.36, 0, maxZ), along: new THREE.Vector3(1, 0, 0), length: maxX - minX - 0.36 },
    { origin: new THREE.Vector3(maxX, 0, maxZ), along: new THREE.Vector3(0, 0, -1), length: maxZ - minZ - 0.36 },
  ];
  for (const edge of edges) {
    // Here the frame's +z points out over the drop.
    const f = frameOf(edge.origin, edge.along), L = edge.length;
    const toWorld = (a, y, n) => new THREE.Vector3(a, y, n).applyMatrix4(f);
    kit.box(M.trim, L, 0.4, 0.3, [L / 2, -0.18, 0], null, f);
    kit.box(M.cap, L, 0.04, 0.3, [L / 2, 0.01, 0], null, f);
    for (let a = 0.05; a <= L; a += 1.25) {
      kit.box(M.trim, 0.06, 1.06, 0.06, [a, 0.55, 0.02], null, f);
      kit.box(M.cap, 0.12, 0.05, 0.12, [a, 0.04, 0.02], null, f);
    }
    kit.box(M.cap, L, 0.05, 0.09, [L / 2, 1.09, 0.02], null, f);
    kit.box(M.trim, L, 0.035, 0.04, [L / 2, 0.62, 0.02], null, f);
    kit.box(M.panel, L, 0.14, 0.03, [L / 2, 0.11, 0.02], null, f);
    // The face of the drop: panels, ribs and a red light line.
    kit.box(M.wall, L, drop - 0.38, 0.2, [L / 2, -(drop + 0.38) / 2, 0.06], null, f);
    for (let a = 0.8; a < L; a += 1.6) kit.box(M.trim, 0.08, drop - 0.4, 0.06, [a, -(drop + 0.4) / 2, 0.19], null, f);
    for (let a = 1.6; a < L - 0.5; a += 3.2) kit.box(M.light, 0.4, 0.03, 0.02, [a, -0.7, 0.2], null, f);
    floorLights.add(toWorld(0.6, 0, -0.45), toWorld(L - 0.4, 0, -0.45), { every: 2.2 });
    const r0 = toWorld(-0.1, 0, -0.04), r1 = toWorld(L + 0.1, 1.12, 0.06);
    block('rail', r0.clone().min(r1), r0.clone().max(r1));
  }
  hazard(new THREE.Vector3(maxX - 0.9, 0, maxZ - 0.75), new THREE.Vector3(1, 0, 0), 1.3, 0.28);
  hazard(new THREE.Vector3(maxX - 0.75, 0, maxZ - 1.6), new THREE.Vector3(0, 0, 1), 1.3, 0.28);

  // The lower level: the same plates, darker, a few machines and red lines down there.
  const lowerBounds = [
    { minX: minX - 2, maxX: maxX + 7, minZ: maxZ + 0.2, maxZ: maxZ + 8 },
    { minX: maxX + 0.2, maxX: maxX + 8, minZ: minZ - 2, maxZ: maxZ + 0.2 },
  ];
  const lowerMaterial = floorMaterial ? floorMaterial.clone() : new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.6 });
  lowerMaterial.color = new THREE.Color(0x6c727d);
  for (const bounds of lowerBounds) {
    const deck = deckGeometry(bounds);
    const lower = new THREE.Mesh(deck.geometry, lowerMaterial);
    lower.rotation.x = -Math.PI / 2;
    lower.position.copy(deck.centre).setY(-drop);
    lower.receiveShadow = true;
    group.add(lower);
  }
  for (const [x, z, w, h, d] of [[2, maxZ + 2.6, 1.6, 0.9, 1.1], [-4.5, maxZ + 3.4, 2.4, 0.7, 0.9], [maxX + 2.4, -2, 1.1, 1.0, 1.8], [maxX + 3.1, 3.5, 1.4, 0.8, 1.2], [maxX + 2.2, -7.5, 1.2, 1.2, 1.2]]) {
    kit.box(M.panel, w, h, d, [x, -drop + h / 2, z]);
    kit.box(M.trim, w + 0.04, 0.06, d + 0.04, [x, -drop + h - 0.03, z]);
    kit.box(M.light, w * 0.3, 0.03, 0.012, [x, -drop + h * 0.7, z + d / 2 + 0.008]);
  }
  for (const [a, b] of [[[minX, maxZ + 4.6], [maxX + 4.6, maxZ + 4.6]], [[maxX + 4.6, minZ], [maxX + 4.6, maxZ + 4.6]]]) {
    floorLights.add(new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(b[0], 0, b[1]), { y: -drop, every: 3 });
  }
  const veil = new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.42, depthWrite: false });
  for (const bounds of lowerBounds) {
    const deck = deckGeometry(bounds), shade = new THREE.Mesh(deck.geometry, veil);
    shade.rotation.x = -Math.PI / 2;
    shade.position.copy(deck.centre).setY(-1.1);
    shade.renderOrder = 3;
    group.add(shade);
  }

  // ---- Grates, wherever the floor is clear: a few glow amber from below ----------
  const grateMaterial = new THREE.MeshBasicMaterial({ map: grateTexture(), color: EMBER.clone(), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // As rough as the deck around it: glossier, a lamp shining from beyond lit it up as one flat bright sheet.
  const darkGrate = new THREE.MeshStandardMaterial({ map: grateTexture(), color: 0x3a4049, roughness: 0.75, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const grateGlow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: EMBER.clone().multiplyScalar(0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const clearOf = (x, z, hx, hz) => !(lab?.obstacles ?? []).concat(obstacles).some(box => x + hx > box.min.x - 0.3 && x - hx < box.max.x + 0.3 && z + hz > box.min.z - 0.3 && z - hz < box.max.z + 0.3);
  const grates = [];
  for (const [x, z, across] of [[-7.6, -9.9, true], [-2.2, -9.8, true], [3.6, -9.9, true], [-9.0, -6.3, false], [-9.0, 0.8, false], [-3.2, 6.0, true], [6.8, 5.6, true], [7.1, -5.2, false], [-1.6, -6.2, true], [1.8, 0.4, false]]) {
    const hx = across ? 0.8 : 0.45, hz = across ? 0.45 : 0.8;
    if (!clearOf(x, z, hx, hz)) continue;
    const lit = grates.length % 3 === 0;
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), lit ? grateMaterial : darkGrate);
    grate.rotation.set(-Math.PI / 2, 0, across ? 0 : Math.PI / 2);
    grate.position.set(x, 0.003, z);
    group.add(grate);
    if (lit) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), grateGlow);
      glow.rotation.copy(grate.rotation);
      glow.position.set(x, 0.013, z);
      glow.renderOrder = 2;
      group.add(glow);
    }
    grates.push(grate);
  }

  // ---- Lights, haze, indicators --------------------------------------------------
  function pointLight(at, intensity, distance) {
    const light = new THREE.PointLight(0xffe4c4, intensity, distance, 1.6);
    light.position.copy(at);
    light.userData.base = intensity;
    group.add(light);
    return light;
  }
  function hazard(centre, along, length, width) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, width), hazardMaterial());
    mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(along.z, along.x) * -1);
    mesh.position.copy(centre).setY(0.004);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.022, 0.012), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, indicators.length));
  lamp.name = 'Console indicators';
  const lampMatrix = new THREE.Matrix4(), lampColor = new THREE.Color();
  indicators.forEach((indicator, index) => {
    lamp.setMatrixAt(index, lampMatrix.makeRotationY(indicator.turn).setPosition(indicator.at));
    lamp.setColorAt(index, indicator.color);
  });
  lamp.count = indicators.length;
  group.add(lamp);

  floorLights.build();
  kit.build(group, { name: 'Room' });
  scene.add(group);
  if (door) obstacles.push(door.shut);
  if (lab) lab.obstacles.push(...obstacles);
  const allObstacles = lab ? lab.obstacles : obstacles;

  let lastTime = null;
  function update(time) {
    const dt = lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
    lastTime = time;
    if (door) {
      // The leaves glide: a heavy start, a soft stop. The lamp blinks while it moves or stands open.
      const before = door.openness;
      door.openness = THREE.MathUtils.clamp(door.openness + Math.sign(door.target - door.openness) * dt / 1.3, 0, 1);
      const k = THREE.MathUtils.smootherstep(door.openness, 0, 1);
      for (const leaf of door.leaves) leaf.position.x = THREE.MathUtils.lerp(leaf.userData.closed, leaf.userData.open, k);
      const shut = allObstacles.includes(door.shut);
      if (door.openness > 0.6 && shut) allObstacles.splice(allObstacles.indexOf(door.shut), 1);
      if (door.openness <= 0.6 && before > door.openness && !shut) allObstacles.push(door.shut);
      const busy = door.target > 0 || door.openness > 0 || door.alarm;
      M.doorLamp.color.copy(AMBER).multiplyScalar(busy ? (Math.sin(time * 9) > 0 ? 1.4 : 0.15) : 0.6);
    }
    indicators.forEach((indicator, index) => {
      const on = Math.sin((time / indicator.period + indicator.phase) * Math.PI * 2) > -0.2;
      lamp.setColorAt(index, lampColor.copy(indicator.color).multiplyScalar(on ? 1 : 0.12));
    });
    if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
  }
  if (door) Object.assign(door, {
    open() { door.target = 1; },
    close() { door.target = 0; },
    /** Shut at once (a restart). */
    reset() { door.target = door.openness = 0; door.alarm = false; for (const leaf of door.leaves) leaf.position.x = leaf.userData.closed; if (!allObstacles.includes(door.shut)) allObstacles.push(door.shut); },
    alarm: false,
  });
  if (door) Object.defineProperties(door, {
    isOpen: { get: () => door.openness >= 1 },
    isClosed: { get: () => door.openness <= 0 },
  });
  return { group, obstacles, floorLights, grates, lights, door, update, bounds: ARENA };
}

let grate = null;
/** Bars over a glowing pit: white slots (tinted red by the material), dark bars. */
function grateTexture() {
  if (grate) return grate;
  const w = 64, h = 36, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rim = x < 3 || x >= w - 3 || y < 3 || y >= h - 3;
    const bar = (x - 3) % 6 < 2 || (y - 3) % 10 < 1;
    const depth = 0.55 + 0.45 * Math.sin((x / w) * Math.PI) * Math.sin((y / h) * Math.PI);
    const value = rim ? 22 : bar ? 14 : Math.round(255 * depth);
    data.set([value, value, value, 255], (y * w + x) * 4);
  }
  grate = new THREE.DataTexture(data, w, h);
  grate.magFilter = grate.minFilter = THREE.NearestFilter;
  grate.needsUpdate = true;
  return grate;
}

let hazardShared = null;
/** Worn yellow-and-black diagonal stripes, painted on the deck. */
function hazardMaterial() {
  if (hazardShared) return hazardShared;
  const w = 128, h = 16, data = new Uint8Array(w * h * 4);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const stripe = Math.floor((x + y) / 8) % 2 === 0;
    const worn = random() < 0.22 || (y === 0 || y === h - 1) && random() < 0.5;
    const colour = stripe ? [122, 84, 22] : [16, 16, 18];
    data.set([...colour, worn ? 0 : 230], (y * w + x) * 4);
  }
  const map = new THREE.DataTexture(data, w, h);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  hazardShared = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.7, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return hazardShared;
}
