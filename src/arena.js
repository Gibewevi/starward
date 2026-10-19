import * as THREE from 'three';
import { createKit, frameOf, glowTexture, blink, RED, AMBER } from './kit.js';
import { floorStrip } from './lab.js';
import { deckGeometry } from './stage.js';

/**
 * The room around the lab, after the reference: the deck is closed at the
 * back by two tall walls meeting in a corner — pillars carrying red light
 * columns, consoles with blinking indicators, a window onto a red-lit control
 * room, vents, a great octagonal door, pipes along the top — and open at the
 * front, where a railing runs along the edge of the deck above a lower level.
 * Red strips in the floor along the walls and the edge, grates glowing red
 * from below, worn hazard stripes. The floor lights blink slowly; haze hangs
 * round the light columns.
 *
 * Walls, consoles and railings join the lab's obstacles (kinds 'wall' and
 * 'rail'): walkers, bodies, bolts and grenades meet them; no one takes cover
 * behind them. update(time) runs the lights.
 */
export const ARENA = { minX: -10.4, maxX: 8.4, minZ: -11.2, maxZ: 7.4, height: 5.4, drop: 2.8 };
// The ground tier's cornice; above it the wall goes on up, darker, out of sight.
const TIER = 3.6;

export function createArena(scene, { lab = null, floorMaterial = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Room';
  const { minX, maxX, minZ, maxZ, height: H, drop } = ARENA;
  const M = {
    wall: new THREE.MeshStandardMaterial({ name: 'wall', color: 0x12151a, roughness: 0.62, metalness: 0.6 }),
    panel: new THREE.MeshStandardMaterial({ name: 'wall panels', color: 0x1b1f26, roughness: 0.45, metalness: 0.72 }),
    trim: new THREE.MeshStandardMaterial({ name: 'wall trim', color: 0x2d333c, roughness: 0.34, metalness: 0.8 }),
    cap: new THREE.MeshStandardMaterial({ name: 'bright trim', color: 0x3c434e, roughness: 0.3, metalness: 0.82 }),
    dark: new THREE.MeshStandardMaterial({ name: 'recesses', color: 0x08090c, roughness: 0.75, metalness: 0.4 }),
    pipe: new THREE.MeshStandardMaterial({ name: 'pipes', color: 0x22272e, roughness: 0.28, metalness: 0.88 }),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: 0x0a0e14, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.45, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ name: 'red lights', color: RED, toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ name: 'amber lights', color: AMBER, toneMapped: false }),
    screen: new THREE.MeshBasicMaterial({ name: 'screens', color: new THREE.Color(0.32, 0.012, 0.01), toneMapped: false }),
    room: new THREE.MeshBasicMaterial({ name: 'control room light', color: new THREE.Color(0.42, 0.02, 0.016), toneMapped: false }),
  };
  const kit = createKit();
  const obstacles = [];
  const block = (kind, min, max) => { const box = { kind, min, max, centre: min.clone().add(max).multiplyScalar(0.5) }; obstacles.push(box); return box; };
  const indicators = [], hazes = [], strips = [], lights = [];

  // ---- The back walls ---------------------------------------------------------
  // One along x at minZ (facing +z), one along z at minX (facing +x).
  const walls = [
    { origin: new THREE.Vector3(minX, 0, minZ), along: new THREE.Vector3(1, 0, 0), length: maxX - minX + 0.6, bays: ['console', 'window', 'vent', 'door', 'console', 'vent'] },
    { origin: new THREE.Vector3(minX, 0, maxZ + 0.6), along: new THREE.Vector3(0, 0, -1), length: maxZ - minZ + 0.6, bays: ['vent', 'console', 'window', 'console', 'vent', 'window'] },
  ];
  const pitch = 3.2;
  for (const wall of walls) {
    const f = frameOf(wall.origin, wall.along), L = wall.length;
    const toWorld = (a, y, n) => new THREE.Vector3(a, y, n).applyMatrix4(f);
    const pillars = [];
    for (let a = 0.45; a < L - 0.3; a += pitch) pillars.push(a);
    // Bays between the pillars; the wall slab is built bay by bay so windows can open in it.
    for (let i = 0; i < pillars.length; i++) {
      const from = pillars[i] + 0.31, to = (pillars[i + 1] ?? L) - (pillars[i + 1] ? 0.31 : 0), w = to - from, mid = (from + to) / 2;
      const kind = wall.bays[i % wall.bays.length];
      if (kind === 'window') {
        kit.box(M.wall, w + 0.62, 1.05, 0.5, [mid, 0.525, -0.25], null, f);
        kit.box(M.wall, w + 0.62, H - 2.45, 0.5, [mid, (H + 2.45) / 2, -0.25], null, f);
        for (const side of [from, to]) kit.box(M.dark, 0.04, 1.4, 1.5, [side, 1.75, -0.75], null, f);
        // The control room behind the glass: red-lit back wall, consoles in silhouette.
        kit.box(M.room, w, 1.4, 0.04, [mid, 1.75, -1.5], null, f);
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
      } else {
        kit.box(M.wall, w + 0.62, H, 0.5, [mid, H / 2, -0.25], null, f);
      }
      // Grooves, a kick plate, a cornice: the wall's rhythm.
      for (const y of [1.0, 2.25]) if (kind !== 'window' || y < 1) kit.box(M.dark, w, 0.025, 0.02, [mid, y, 0.005], null, f);
      kit.box(M.trim, w, 0.22, 0.08, [mid, 0.11, 0.04], null, f);
      kit.box(M.trim, w, 0.18, 0.24, [mid, TIER - 0.09, 0.12], null, f);
      kit.box(M.dark, w, 0.05, 0.2, [mid, TIER - 0.2, 0.08], null, f);
      // The upper tier: plain dark panels, a gantry, small red lamps.
      kit.box(M.dark, w, 0.03, 0.02, [mid, TIER + 0.6, 0.005], null, f);
      kit.box(M.trim, w, 0.08, 0.5, [mid, TIER + 0.35, 0.25], null, f);
      kit.box(M.pipe, w, 0.03, 0.03, [mid, TIER + 0.85, 0.48], null, f);
      for (let k = 0; k < 3; k++) kit.box(M.glow, 0.05, 0.05, 0.02, [from + w * (0.2 + k * 0.3), TIER + 1.2, 0.02], null, f);
      if (kind === 'console') {
        // A desk with a sloping top, screens and blinking indicators; a monitor above.
        kit.box(M.panel, w * 0.82, 0.82, 0.5, [mid, 0.41, 0.27], null, f);
        kit.box(M.cap, w * 0.82, 0.06, 0.46, [mid, 0.86, 0.3], [0.42, 0, 0], f);
        for (let k = 0; k < 3; k++) kit.box(M.screen, w * 0.18, 0.012, 0.16, [from + w * (0.22 + k * 0.28), 0.892, 0.314], [0.42, 0, 0], f);
        for (let k = 0; k < 12; k++) indicators.push({ at: toWorld(from + w * 0.13 + k * w * 0.06, 0.66, 0.525), turn: -Math.atan2(wall.along.z, wall.along.x), period: 0.4 + (k * 37 % 11) / 6, phase: (k * 0.37) % 1, color: k % 4 === 1 ? AMBER : RED });
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
        // The great door: two leaves, an octagonal boss across both, a red bar and an amber lamp above.
        kit.box(M.trim, 0.22, 3.05, 0.26, [from + 0.11, 1.525, 0.13], null, f);
        kit.box(M.trim, 0.22, 3.05, 0.26, [to - 0.11, 1.525, 0.13], null, f);
        kit.box(M.trim, w, 0.3, 0.26, [mid, 3.0, 0.13], null, f);
        for (const side of [-1, 1]) kit.box(M.panel, w / 2 - 0.24, 2.84, 0.1, [mid + side * (w / 4 - 0.01), 1.42, 0.05], null, f);
        kit.add(M.cap, new THREE.CylinderGeometry(0.95, 0.95, 0.06, 8), [mid, 1.45, 0.12], [Math.PI / 2, Math.PI / 8, 0], f);
        kit.add(M.dark, new THREE.CylinderGeometry(0.7, 0.7, 0.07, 8), [mid, 1.45, 0.13], [Math.PI / 2, Math.PI / 8, 0], f);
        kit.box(M.dark, 0.035, 2.84, 0.16, [mid, 1.42, 0.08], null, f);
        kit.box(M.dark, w * 0.6, 0.08, 0.02, [mid, 3.0, 0.27], null, f);
        kit.box(M.glow, w * 0.55, 0.04, 0.012, [mid, 3.0, 0.28], null, f);
        kit.box(M.amber, 0.12, 0.08, 0.05, [to - 0.32, 2.75, 0.28], null, f);
        hazard(toWorld(mid, 0, 0.55), wall.along, w - 0.3, 0.4);
        lights.push(pointLight(toWorld(mid, 2.6, 0.9), 1.8, 4));
      }
      // Pipes running along the top, held by brackets.
      kit.cylinder(M.pipe, 0.06, 0.06, w + 0.02, 14, [mid, TIER - 0.48, 0.16], [0, 0, Math.PI / 2], f);
      kit.cylinder(M.pipe, 0.042, 0.042, w + 0.02, 12, [mid, TIER - 0.66, 0.12], [0, 0, Math.PI / 2], f);
    }
    // Pillars: a light column each, in a dark housing, on a heavy base.
    for (const [index, a] of pillars.entries()) {
      kit.box(M.panel, 0.62, H, 0.34, [a, H / 2, 0.17], null, f);
      for (const side of [-1, 1]) kit.box(M.trim, 0.06, H, 0.06, [a + side * 0.28, H / 2, 0.33], null, f);
      kit.box(M.cap, 0.74, 0.4, 0.42, [a, 0.2, 0.21], null, f);
      kit.box(M.cap, 0.74, 0.2, 0.42, [a, TIER - 0.3, 0.21], null, f);
      kit.box(M.dark, 0.2, 1.95, 0.03, [a, 1.6, 0.35], null, f);
      kit.box(M.glow, 0.08, 1.8, 0.02, [a, 1.6, 0.365], null, f);
      kit.box(M.amber, 0.05, 0.05, 0.02, [a, 0.55, 0.43], null, f);
      hazes.push(haze(toWorld(a, 1.6, 0.6), index * 0.31));
      if (index % 2 === 0) lights.push(pointLight(toWorld(a, 1.5, 0.7), 2.2, 4.2));
    }
    // Walkers, bodies and bolts meet the wall and its pillars, on their real faces.
    const a0 = toWorld(-0.6, 0, -0.6), a1 = toWorld(L + 0.6, H, 0.01);
    block('wall', a0.clone().min(a1), a0.clone().max(a1));
    for (const a of pillars) { const p0 = toWorld(a - 0.37, 0, 0), p1 = toWorld(a + 0.37, H, 0.43); block('wall', p0.clone().min(p1), p0.clone().max(p1)); }
    // A strip in the floor along its foot.
    strips.push(floorStrip(group, toWorld(0.8, 0, 0.75), toWorld(L - 0.6, 0, 0.75), strips.length * 0.23));
  }
  // The corner where the walls meet: a broad column with its own light.
  kit.box(M.panel, 1.0, H + 0.2, 1.0, [minX + 0.3, (H + 0.2) / 2, minZ + 0.3]);
  kit.box(M.dark, 0.03, 2.2, 0.24, [minX + 0.81, 1.7, minZ + 0.45]);
  kit.box(M.glow, 0.02, 2.0, 0.1, [minX + 0.825, 1.7, minZ + 0.45]);
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
    kit.box(M.dark, L, 0.08, 0.03, [L / 2, -1.25, 0.18], null, f);
    kit.box(M.glow, L, 0.035, 0.02, [L / 2, -1.25, 0.2], null, f);
    strips.push(floorStrip(group, toWorld(0.4, 0, -0.42), toWorld(L - 0.3, 0, -0.42), strips.length * 0.23));
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
    kit.box(M.glow, w * 0.5, 0.04, 0.012, [x, -drop + h * 0.7, z + d / 2 + 0.008]);
  }
  for (const [a, b] of [[[minX, maxZ + 4.6], [maxX + 4.6, maxZ + 4.6]], [[maxX + 4.6, minZ], [maxX + 4.6, maxZ + 4.6]]]) {
    strips.push(floorStrip(group, new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(b[0], 0, b[1]), 0.5 + strips.length * 0.11, { y: -drop }));
  }
  const veil = new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.42, depthWrite: false });
  for (const bounds of lowerBounds) {
    const deck = deckGeometry(bounds), shade = new THREE.Mesh(deck.geometry, veil);
    shade.rotation.x = -Math.PI / 2;
    shade.position.copy(deck.centre).setY(-1.1);
    shade.renderOrder = 3;
    group.add(shade);
  }

  // ---- Grates glowing red from below, wherever the floor is clear ---------------
  const grateMaterial = new THREE.MeshBasicMaterial({ map: grateTexture(), color: RED.clone(), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const grateGlow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: RED.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const clearOf = (x, z, hx, hz) => !(lab?.obstacles ?? []).concat(obstacles).some(box => x + hx > box.min.x - 0.3 && x - hx < box.max.x + 0.3 && z + hz > box.min.z - 0.3 && z - hz < box.max.z + 0.3);
  const grates = [];
  for (const [x, z, across] of [[-7.6, -9.9, true], [-2.2, -9.8, true], [3.6, -9.9, true], [-9.0, -6.3, false], [-9.0, 0.8, false], [-3.2, 6.0, true], [6.8, 5.6, true], [7.1, -5.2, false], [-1.6, -6.2, true], [1.8, 0.4, false]]) {
    const hx = across ? 0.8 : 0.45, hz = across ? 0.45 : 0.8;
    if (!clearOf(x, z, hx, hz)) continue;
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), grateMaterial);
    grate.rotation.set(-Math.PI / 2, 0, across ? 0 : Math.PI / 2);
    grate.position.set(x, 0.003, z);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.2), grateGlow);
    glow.rotation.copy(grate.rotation);
    glow.position.set(x, 0.013, z);
    glow.renderOrder = 2;
    group.add(grate, glow);
    grates.push(grate);
  }

  // ---- Lights, haze, indicators --------------------------------------------------
  function pointLight(at, intensity, distance) {
    const light = new THREE.PointLight(0xff2a20, intensity, distance, 1.6);
    light.position.copy(at);
    light.userData.base = intensity;
    group.add(light);
    return light;
  }
  function haze(at, phase) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: RED.clone().multiplyScalar(0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.position.copy(at);
    sprite.scale.set(1.1, 2.8, 1);
    group.add(sprite);
    return { sprite, phase };
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

  kit.build(group, { name: 'Room' });
  scene.add(group);
  if (lab) lab.obstacles.push(...obstacles);

  function update(time) {
    for (const strip of strips) strip.update(time);
    const k = blink(time, 0.6, 4.1);
    grateMaterial.color.copy(RED).multiplyScalar(0.25 + 0.75 * k);
    grateGlow.color.copy(RED).multiplyScalar(0.45 * k);
    for (const { sprite, phase } of hazes) sprite.material.color.copy(RED).multiplyScalar(0.3 + 0.08 * Math.sin(time * 1.3 + phase * 6));
    // One light column flickers, as a failing tube does.
    if (hazes[3]) hazes[3].sprite.material.color.multiplyScalar(Math.sin(time * 23) > 0.6 && Math.sin(time * 1.7) > 0.2 ? 0.25 : 1);
    indicators.forEach((indicator, index) => {
      const on = Math.sin((time / indicator.period + indicator.phase) * Math.PI * 2) > -0.2;
      lamp.setColorAt(index, lampColor.copy(indicator.color).multiplyScalar(on ? 1 : 0.12));
    });
    if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
  }
  return { group, obstacles, strips, grates, lights, update, bounds: ARENA };
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
    const colour = stripe ? [150, 104, 22] : [16, 16, 18];
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
