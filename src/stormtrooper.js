import * as THREE from 'three';
import { Ragdoll } from './ragdoll.js';
import { solveTwoBone } from './ik.js';

/**
 * Stormtrooper training dummy. A low-poly trooper in white armour over a black
 * suit, built from rigid parts — helmet, torso, pelvis, upper arms, forearms,
 * hands, thighs, legs with boots, and an E-11 blaster — each hung on a light
 * skeleton while it stands, idle, rifle in hand. Every part is also a rigid
 * body of a Verlet ragdoll whose particles follow the pose until physics takes
 * over. The blade's real sweep is tested against a capsule per part; where it
 * crosses decides which predefined joint is severed (shoulder or elbow, elbow
 * or wrist, hip or knee, neck, a horizontal cut through the waist), or an
 * armour plate is knocked off. Cuts are cauterised and glow, nothing gory.
 * Light hits stagger him in proportion to their force; severe ones, or enough
 * accumulated imbalance, drop him into the ragdoll with impulses that depend
 * on where and how he was struck, so no two falls are alike.
 *
 * update(dt, time) then strike(previousBase, previousTip, base, tip, dt) each
 * frame; reset() rebuilds him intact. +Z is his front.
 */
export const CUT_SPEED = 2.2;
const SLASH_LETHAL_SPEED = 3.5;

const materials = {
  armor: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, roughness: 0.55, metalness: 0 }),
  shade: new THREE.MeshStandardMaterial({ color: 0x6d727b, roughness: 0.6, metalness: 0.05 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8, metalness: 0 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.18, metalness: 0.1 }),
};

// Joint hierarchy in the rest pose: name, parent, offset (metres).
const JOINTS = [
  ['pelvis', null, [0, 0.86, 0]],
  ['spine', 'pelvis', [0, 0.12, 0]],
  ['neck', 'spine', [0, 0.35, -0.01]],
  ['shoulderL', 'spine', [0.205, 0.28, -0.01]],
  ['elbowL', 'shoulderL', [0.01, -0.27, 0]],
  ['wristL', 'elbowL', [0, -0.245, 0.01]],
  ['shoulderR', 'spine', [-0.205, 0.28, -0.01]],
  ['elbowR', 'shoulderR', [-0.01, -0.27, 0]],
  ['wristR', 'elbowR', [0, -0.245, 0.01]],
  ['hipL', 'pelvis', [0.1, -0.06, 0]],
  ['kneeL', 'hipL', [0, -0.37, 0.01]],
  ['ankleL', 'kneeL', [0, -0.34, -0.01]],
  ['hipR', 'pelvis', [-0.1, -0.06, 0]],
  ['kneeR', 'hipR', [0, -0.37, 0.01]],
  ['ankleR', 'kneeR', [0, -0.34, -0.01]],
];

// Ragdoll particles: name, joint, local position, radius, mass.
const PARTICLES = [
  ['N', 'neck', [0, 0, 0], 0.06, 1], ['HT', 'neck', [0, 0.3, 0], 0.12, 1.5], ['HF', 'neck', [0, 0.15, 0.12], 0.1, 1],
  ['W', 'spine', [0, 0, 0], 0.12, 3],
  ['HL', 'hipL', [0, 0, 0], 0.1, 2], ['HR', 'hipR', [0, 0, 0], 0.1, 2],
  ['B0', 'holder', [0, 0, -0.13], 0.035, 0.6], ['B1', 'holder', [0, 0, 0.33], 0.03, 0.6], ['B2', 'holder', [0, 0.07, 0.05], 0.03, 0.4],
];
for (const [side, sign] of [['L', 1], ['R', -1]]) {
  PARTICLES.push(
    [`S${side}`, `shoulder${side}`, [0, 0, 0], 0.08, 2],
    [`E${side}`, `elbow${side}`, [0, 0, 0], 0.055, 1], [`UA${side}`, `shoulder${side}`, [0, -0.13, 0.07], 0.05, 0.5],
    [`W${side}`, `wrist${side}`, [0, 0, 0], 0.05, 0.8], [`FA${side}`, `elbow${side}`, [0, -0.12, 0.065], 0.05, 0.5],
    [`HT${side}`, `wrist${side}`, [0, -0.1, 0], 0.04, 0.3], [`HP${side}`, `wrist${side}`, [sign * 0.01, -0.05, 0.05], 0.035, 0.3],
    [`K${side}`, `knee${side}`, [0, 0, 0], 0.065, 1.5], [`TH${side}`, `hip${side}`, [0, -0.18, 0.09], 0.07, 0.8],
    [`A${side}`, `ankle${side}`, [0, 0, 0], 0.06, 1], [`T${side}`, `ankle${side}`, [0, -0.055, 0.15], 0.035, 0.6],
  );
}
// Bodies: name (= part), particles (the first three define its frame), capsule.
const BODIES = [
  ['head', ['N', 'HT', 'HF'], ['N', 'HT', 0.13]],
  ['torso', ['W', 'N', 'SL', 'SR'], ['W', 'N', 0.17]],
  ['pelvis', ['W', 'HL', 'HR'], ['HL', 'HR', 0.14]],
  ['blaster', ['B0', 'B1', 'B2'], ['B0', 'B1', 0.045]],
];
for (const side of ['L', 'R']) {
  BODIES.push(
    [`upperArm${side}`, [`S${side}`, `E${side}`, `UA${side}`], [`S${side}`, `E${side}`, 0.07]],
    [`forearm${side}`, [`E${side}`, `W${side}`, `FA${side}`], [`E${side}`, `W${side}`, 0.065]],
    [`hand${side}`, [`W${side}`, `HT${side}`, `HP${side}`], [`W${side}`, `HT${side}`, 0.05]],
    [`thigh${side}`, [`H${side}`, `K${side}`, `TH${side}`], [`H${side}`, `K${side}`, 0.085]],
    [`shin${side}`, [`K${side}`, `A${side}`, `T${side}`], [`K${side}`, `A${side}`, 0.075]],
  );
}
// Predefined separations: the shared particle, which side comes away, cap size and facing.
const CUTS = {
  neck: { particle: 'N', parent: 'torso', child: 'head', lethal: true, radius: 0.055, normal: [0, 1, 0] },
  waist: { particle: 'W', parent: 'torso', child: 'pelvis', lethal: true, radius: 0.13, normal: [0, -1, 0] },
};
for (const [side, sign] of [['L', 1], ['R', -1]]) {
  Object.assign(CUTS, {
    [`shoulder${side}`]: { particle: `S${side}`, parent: 'torso', child: `upperArm${side}`, radius: 0.065, normal: [sign, 0, 0] },
    [`elbow${side}`]: { particle: `E${side}`, parent: `upperArm${side}`, child: `forearm${side}`, radius: 0.05, normal: [0, -1, 0] },
    [`wrist${side}`]: { particle: `W${side}`, parent: `forearm${side}`, child: `hand${side}`, radius: 0.04, normal: [0, -1, 0] },
    [`hip${side}`]: { particle: `H${side}`, parent: 'pelvis', child: `thigh${side}`, lethal: true, radius: 0.075, normal: [0, -1, 0] },
    [`knee${side}`]: { particle: `K${side}`, parent: `thigh${side}`, child: `shin${side}`, lethal: true, radius: 0.06, normal: [0, -1, 0] },
  });
}

function frustum(wTop, wBottom, dTop, dBottom, height) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wTop : wBottom), p.getY(i) * height, p.getZ(i) * (top ? dTop : dBottom));
  }
  geometry.computeVertexNormals();
  return geometry;
}
const cylinder = (top, bottom, height, segments = 8) => new THREE.CylinderGeometry(top, bottom, height, segments);
// Faceted low-poly look with normals baked per face: shading derivatives can
// yield NaN on tiny distant triangles, which the bloom would spread.
function facet(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.computeVertexNormals();
  return flat;
}
function add(group, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], name = '') {
  const mesh = new THREE.Mesh(facet(geometry), material);
  mesh.position.fromArray(position);
  mesh.rotation.set(...rotation);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildParts() {
  const { armor, shade, black, lens } = materials;
  const parts = {}, pieces = {};
  const part = name => (parts[name] = Object.assign(new THREE.Group(), { name }));

  const head = part('head');
  add(head, cylinder(0.05, 0.055, 0.1), black, [0, 0.03, 0]);
  const dome = new THREE.LatheGeometry([[0.11, 0.075], [0.128, 0.1], [0.136, 0.15], [0.138, 0.21], [0.128, 0.26], [0.1, 0.3], [0.06, 0.32], [0.001, 0.325]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
  add(head, dome, armor).scale.set(1, 1, 1.07);
  add(head, frustum(0.19, 0.15, 0.07, 0.06, 0.12), armor, [0, 0.125, 0.095]);
  for (const sign of [-1, 1]) {
    add(head, new THREE.BoxGeometry(0.055, 0.04, 0.03), lens, [sign * 0.043, 0.19, 0.126], [0, 0, sign * 0.25]);
    add(head, cylinder(0.011, 0.011, 0.05, 6), shade, [sign * 0.064, 0.125, 0.12], [0.3, 0, 0]);
    add(head, cylinder(0.03, 0.03, 0.02, 8), shade, [sign * 0.137, 0.18, 0], [0, 0, Math.PI / 2]);
  }
  add(head, new THREE.BoxGeometry(0.2, 0.018, 0.03), shade, [0, 0.226, 0.125]);
  add(head, new THREE.BoxGeometry(0.07, 0.03, 0.03), shade, [0, 0.115, 0.13]);

  const torso = part('torso');
  add(torso, frustum(0.3, 0.26, 0.2, 0.18, 0.35), black, [0, 0.175, 0]);
  add(torso, frustum(0.42, 0.34, 0.25, 0.22, 0.17), armor, [0, 0.255, 0.005]);
  add(torso, frustum(0.3, 0.28, 0.21, 0.2, 0.1), armor, [0, 0.1, 0.01]);
  for (const sign of [-1, 1]) add(torso, new THREE.BoxGeometry(0.06, 0.035, 0.012), shade, [sign * 0.075, 0.27, 0.133]);
  add(torso, new THREE.BoxGeometry(0.3, 0.2, 0.03), armor, [0, 0.24, -0.125]);
  add(torso, new THREE.BoxGeometry(0.17, 0.1, 0.045), shade, [0, 0.24, -0.15]);
  add(torso, cylinder(0.08, 0.085, 0.04, 10), black, [0, 0.345, -0.01]);

  const pelvis = part('pelvis');
  add(pelvis, frustum(0.28, 0.24, 0.19, 0.17, 0.18), black, [0, 0.02, 0]);
  add(pelvis, new THREE.BoxGeometry(0.34, 0.065, 0.235), armor, [0, 0.085, 0]);
  add(pelvis, new THREE.BoxGeometry(0.1, 0.045, 0.012), shade, [0, 0.085, 0.121]);
  for (const sign of [-1, 1]) {
    add(pelvis, new THREE.BoxGeometry(0.05, 0.05, 0.03), armor, [sign * 0.12, 0.085, 0.115]);
    add(pelvis, new THREE.BoxGeometry(0.03, 0.05, 0.05), armor, [sign * 0.172, 0.085, 0.02]);
  }
  add(pelvis, frustum(0.18, 0.09, 0.05, 0.04, 0.11), armor, [0, -0.01, 0.1]);
  add(pelvis, frustum(0.24, 0.18, 0.05, 0.04, 0.12), armor, [0, 0, -0.1]);

  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const upperArm = part(`upperArm${side}`);
    add(upperArm, new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), armor, [sign * 0.008, -0.005, 0]).scale.set(0.085, 0.065, 0.09);
    add(upperArm, cylinder(0.05, 0.05, 0.27), black, [0, -0.135, 0]);
    add(upperArm, cylinder(0.058, 0.054, 0.14), armor, [0, -0.13, 0]);

    const forearm = part(`forearm${side}`);
    add(forearm, new THREE.SphereGeometry(0.05, 8, 6), black);
    add(forearm, cylinder(0.056, 0.046, 0.17), armor, [0, -0.13, 0]);
    add(forearm, cylinder(0.044, 0.044, 0.04), black, [0, -0.225, 0]);

    const hand = part(`hand${side}`);
    add(hand, new THREE.BoxGeometry(0.06, 0.09, 0.075), black, [0, -0.05, 0.005]);
    add(hand, new THREE.BoxGeometry(0.025, 0.05, 0.025), black, [-sign * 0.03, -0.035, 0.035]);

    const thigh = part(`thigh${side}`);
    add(thigh, cylinder(0.07, 0.068, 0.37), black, [0, -0.185, 0]);
    add(thigh, cylinder(0.086, 0.072, 0.27), armor, [0, -0.17, 0]);
    if (side === 'R') add(thigh, new THREE.BoxGeometry(0.05, 0.12, 0.06), black, [-0.09, -0.12, 0.01]);

    const shin = part(`shin${side}`);
    add(shin, new THREE.SphereGeometry(0.06, 8, 6), black);
    add(shin, cylinder(0.056, 0.05, 0.34), black, [0, -0.17, 0]);
    pieces[`kneePad${side}`] = add(shin, frustum(0.09, 0.085, 0.05, 0.05, 0.085), armor, [0, -0.03, 0.055], [0, 0, 0], `Knee pad ${side}`);
    pieces[`shinPlate${side}`] = add(shin, cylinder(0.07, 0.058, 0.22), armor, [0, -0.19, 0.004], [0, 0, 0], `Shin plate ${side}`);
    add(shin, new THREE.BoxGeometry(0.11, 0.12, 0.23), armor, [0, -0.37, 0.04]);
    add(shin, new THREE.BoxGeometry(0.115, 0.02, 0.235), black, [0, -0.42, 0.04]);
  }

  const blaster = part('blaster');
  add(blaster, cylinder(0.022, 0.022, 0.42), black, [0, 0, 0.1], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) add(blaster, cylinder(0.027, 0.027, 0.012), shade, [0, 0, 0.05 + i * 0.04], [Math.PI / 2, 0, 0]);
  add(blaster, cylinder(0.018, 0.018, 0.03), shade, [0, 0, 0.32], [Math.PI / 2, 0, 0]);
  add(blaster, new THREE.BoxGeometry(0.045, 0.06, 0.14), black, [0, 0, -0.02]);
  add(blaster, cylinder(0.013, 0.013, 0.13, 6), shade, [0, 0.045, 0.02], [Math.PI / 2, 0, 0]);
  add(blaster, new THREE.BoxGeometry(0.016, 0.035, 0.1), black, [0.035, -0.005, 0.02]);
  add(blaster, new THREE.BoxGeometry(0.03, 0.07, 0.035), black, [0, -0.055, -0.05], [-0.3, 0, 0]);
  add(blaster, new THREE.BoxGeometry(0.012, 0.012, 0.16), shade, [0, 0.035, -0.1]);
  return { parts, pieces };
}

export function createStormtrooper({ scene, position = new THREE.Vector3(), heading = 0, effects = null, random = Math.random } = {}) {
  const trooper = { root: null, debris: null, dead: false, holding: true, severed: new Set(), events: [] };
  let joints, parts, pieces, holder, ragdoll, particleIndex, bodies, caps, marks, base;
  const reaction = {};
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const gripRight = new THREE.Vector3(0, -0.06, -0.045), gripLeft = new THREE.Vector3(0, -0.03, 0.17);

  function build() {
    const root = new THREE.Group();
    root.name = 'Stormtrooper';
    joints = {};
    for (const [name, parent, offset] of JOINTS) {
      const joint = new THREE.Object3D();
      joint.name = name;
      joint.position.fromArray(offset);
      (parent ? joints[parent] : root).add(joint);
      joints[name] = joint;
    }
    // The blaster is carried at low ready, across the belly.
    holder = new THREE.Object3D();
    holder.name = 'Blaster holder';
    holder.position.set(-0.02, 0.1, 0.2);
    holder.rotation.set(0.35, 0.4, 0, 'YXZ');
    joints.spine.add(holder);
    joints.holder = holder;
    ({ parts, pieces } = buildParts());
    const mounts = { head: 'neck', torso: 'spine', pelvis: 'pelvis', blaster: 'holder' };
    for (const side of ['L', 'R']) Object.assign(mounts, { [`upperArm${side}`]: `shoulder${side}`, [`forearm${side}`]: `elbow${side}`, [`hand${side}`]: `wrist${side}`, [`thigh${side}`]: `hip${side}`, [`shin${side}`]: `knee${side}` });
    for (const [name, mount] of Object.entries(mounts)) joints[mount].add(parts[name]);
    root.updateMatrixWorld(true);

    // Cut caps: dark suit inside, a ring that glows when the joint is severed.
    caps = {};
    for (const [name, cut] of Object.entries(CUTS)) {
      const particle = PARTICLES.find(entry => entry[0] === cut.particle);
      const at = joints[particle[1]].getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(...cut.normal);
      caps[name] = [[cut.parent, normal], [cut.child, normal.clone().negate()]].map(([owner, facing]) => {
        const cap = new THREE.Group();
        cap.name = `Cut ${name}`;
        add(cap, new THREE.CircleGeometry(cut.radius * 0.72, 10), materials.black, [0, 0, 0.002]);
        const ring = add(cap, new THREE.RingGeometry(cut.radius * 0.6, cut.radius * 1.08, 12), new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide }));
        cap.position.copy(at);
        cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
        cap.visible = false;
        parts[owner].attach(cap);
        return { cap, ring };
      });
    }

    // Ragdoll particles at the joints of the standing pose.
    ragdoll = new Ragdoll();
    particleIndex = {};
    for (const [name, joint, local, radius, mass] of PARTICLES) {
      particleIndex[name] = ragdoll.addParticle({ name, position: joints[joint].localToWorld(new THREE.Vector3(...local)), radius, mass });
    }
    bodies = {};
    for (const [name, names, capsule] of BODIES) {
      const body = ragdoll.addBody({ name, indices: names.map(key => particleIndex[key]), object: parts[name] });
      body.capsule = capsule;
      body.capsuleSlots = [names.indexOf(capsule[0]), names.indexOf(capsule[1])];
      body.lastHit = -Infinity;
      bodies[name] = body;
    }
    for (const cut of Object.values(CUTS)) ragdoll.connect(bodies[cut.parent], bodies[cut.child]);
    // Joint ranges keep the fall anatomical; each belongs to its joint.
    const P = key => particleIndex[key];
    ragdoll.addLimit(P('HT'), P('W'), 0.6, Infinity, 'neck');
    ragdoll.addLimit(P('HT'), P('SL'), 0.24, Infinity, 'neck');
    ragdoll.addLimit(P('HT'), P('SR'), 0.24, Infinity, 'neck');
    ragdoll.addLimit(P('N'), P('HL'), 0.36, Infinity, 'waist');
    ragdoll.addLimit(P('N'), P('HR'), 0.36, Infinity, 'waist');
    for (const side of ['L', 'R']) {
      ragdoll.addLimit(P(`S${side}`), P(`W${side}`), 0.15, Infinity, `elbow${side}`);
      ragdoll.addLimit(P(`E${side}`), P(`HT${side}`), 0.22, Infinity, `wrist${side}`);
      ragdoll.addLimit(P(`H${side}`), P(`A${side}`), 0.3, Infinity, `knee${side}`);
      ragdoll.addLimit(P(`K${side}`), P('N'), 0.45, Infinity, `hip${side}`);
      ragdoll.addLimit(P(`E${side}`), P(side === 'L' ? 'SR' : 'SL'), 0.26, Infinity, `shoulder${side}`);
    }
    ragdoll.connect(bodies.blaster, bodies.handR);
    ragdoll.connect(bodies.blaster, bodies.handL);
    ragdoll.connect(bodies.blaster, bodies.torso);

    const debris = new THREE.Group();
    debris.name = 'Stormtrooper parts';
    root.position.copy(position);
    root.rotation.y = heading;
    scene.add(root, debris);
    Object.assign(trooper, { root, debris, dead: false, holding: true, severed: new Set(), parts, pieces, joints, bodies, ragdoll, caps });
    marks = [];
    Object.assign(reaction, { yaw: 0, pitch: 0, roll: 0, head: 0, buckle: 0, vyaw: 0, vpitch: 0, vroll: 0, vhead: 0, vbuckle: 0, offset: new THREE.Vector3(), push: new THREE.Vector3(), imbalance: 0, armL: 0, armR: 0, varmL: 0, varmR: 0, hold: 1 });
    base = joints.pelvis.position.clone();
    pose(0, 0);
    root.updateMatrixWorld(true);
    placeParticles(1 / 60);
    placeParticles(1 / 60);
  }

  function pose(time, dt) {
    const r = reaction;
    // Damped springs: hits kick them, they settle back.
    const spring = (key, k = 55, damping = 7) => { r[`v${key}`] += (-k * r[key] - damping * r[`v${key}`]) * dt; r[key] += r[`v${key}`] * dt; };
    for (const key of ['yaw', 'pitch', 'roll', 'head', 'buckle', 'armL', 'armR']) spring(key);
    r.push.multiplyScalar(Math.exp(-5 * dt));
    r.offset.addScaledVector(r.push, dt);
    r.imbalance = Math.max(0, r.imbalance - dt * 0.4);
    r.hold += ((trooper.holding ? 1 : 0) - r.hold) * (1 - Math.exp(-10 * dt));

    const breathe = Math.sin(time * 1.7), look = Math.sin(time * 0.33) * 0.22 + Math.sin(time * 0.71) * 0.08;
    joints.pelvis.position.set(base.x + Math.sin(time * 0.5) * 0.008 + r.offset.x, base.y - 0.015 - r.buckle * 0.08, base.z + r.offset.z);
    joints.pelvis.rotation.set(r.pitch * 0.3, r.yaw * 0.4, r.roll * 0.4);
    joints.spine.rotation.set(-0.03 + breathe * 0.012 + r.pitch * 0.7, r.yaw * 0.6, r.roll * 0.6);
    joints.neck.rotation.set(0.05 + r.head * 0.6, look - r.yaw * 0.5 + r.head * 0.3, r.roll * -0.3);
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      joints[`hip${side}`].rotation.set(-0.06 - r.buckle * 0.5, 0, sign * 0.06);
      joints[`knee${side}`].rotation.set(0.12 + r.buckle * 0.9, 0, 0);
      joints[`ankle${side}`].rotation.set(-0.06, 0, -sign * 0.06);
      // Without the rifle the arms hang, flung by the hits.
      joints[`shoulder${side}`].rotation.set(-0.15 + r[`arm${side}`], 0, sign * (0.12 + Math.abs(r[`arm${side}`]) * 0.5));
      joints[`elbow${side}`].rotation.set(-0.35, 0, 0);
      joints[`wrist${side}`].rotation.set(0, 0, 0);
    }
    trooper.root.updateMatrixWorld(true);
    // Rifle in hand: both arms reach the grips.
    if (r.hold > 0.01) {
      for (const [side, sign, grip] of [['R', -1, gripRight], ['L', 1, gripLeft]]) {
        if (trooper.severed.has(`shoulder${side}`)) continue;
        const shoulder = joints[`shoulder${side}`], elbow = joints[`elbow${side}`], wrist = joints[`wrist${side}`];
        const restUpper = shoulder.quaternion.clone(), restLower = elbow.quaternion.clone();
        const target = holder.localToWorld(temp.copy(grip));
        const pole = shoulder.localToWorld(temp2.set(sign * 0.35, -0.3, -0.3));
        solveTwoBone(shoulder, elbow, wrist, target, pole);
        if (r.hold < 1) {
          shoulder.quaternion.slerpQuaternions(restUpper, shoulder.quaternion.clone(), r.hold);
          elbow.quaternion.slerpQuaternions(restLower, elbow.quaternion.clone(), r.hold);
          shoulder.updateMatrixWorld(true);
        }
      }
    }
  }

  function placeParticles(dt) {
    for (const [name, joint, local] of PARTICLES) {
      const index = particleIndex[name];
      if (ragdoll.particles[index].kinematic) ragdoll.place(index, joints[joint].localToWorld(temp.fromArray(local)), dt);
    }
  }

  function syncObjects() {
    for (const body of ragdoll.bodies) {
      if (!body.dynamic || !body.object) continue;
      ragdoll.objectMatrix(body, body.object.matrix);
      body.object.matrixWorldNeedsUpdate = true;
    }
  }

  function release(names) {
    trooper.root.updateMatrixWorld(true);
    const list = [];
    for (const name of names) {
      const body = typeof name === 'string' ? bodies[name] : name;
      if (body.dynamic) continue;
      const object = body.object;
      trooper.debris.attach(object);
      object.updateMatrixWorld(true);
      ragdoll.bind(body, object.matrixWorld);
      object.matrixAutoUpdate = false;
      list.push(body);
    }
    ragdoll.release(list);
  }

  function subtree(name, out = []) {
    out.push(name);
    for (const [cutName, cut] of Object.entries(CUTS)) if (cut.parent === name && !trooper.severed.has(cutName)) subtree(cut.child, out);
    return out;
  }
  const indicesOf = names => names.flatMap(name => bodies[name].indices);
  const local = vector => vector.clone().applyQuaternion(trooper.root.quaternion.clone().invert());
  const world = vector => vector.clone().applyQuaternion(trooper.root.quaternion);

  /** A tumble: velocities around a random axis through the body's centre. */
  function spin(names, rate) {
    for (const name of names) {
      const body = bodies[name];
      const centre = new THREE.Vector3();
      for (const index of body.indices) centre.add(ragdoll.particles[index].position);
      centre.divideScalar(body.indices.length);
      const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(rate);
      for (const index of body.indices) ragdoll.push([index], temp.subVectors(ragdoll.particles[index].position, centre).cross(axis).negate());
    }
  }

  function dropBlaster(velocity) {
    if (!trooper.holding) return;
    trooper.holding = false;
    release(['blaster']);
    ragdoll.push(bodies.blaster.indices, temp.copy(velocity).clampLength(0, 6).multiplyScalar(0.25).add(temp2.set(0, 0.6, 0)));
    spin(['blaster'], 7);
  }

  function knockOff(piece, velocity) {
    if (!piece || !piece.parent || piece.userData.loose) return null;
    piece.userData.loose = true;
    trooper.root.updateMatrixWorld(true);
    trooper.debris.attach(piece);
    piece.updateMatrixWorld(true);
    piece.geometry.computeBoundingBox();
    const box = piece.geometry.boundingBox, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const indices = [[0, 0, 0], [size.x * 0.5, 0, 0], [0, size.y * 0.5, 0]].map(offset => ragdoll.addParticle({
      position: piece.localToWorld(new THREE.Vector3(...offset).add(centre)), radius: 0.025, mass: 0.3, name: piece.name,
    }));
    const body = ragdoll.addBody({ name: piece.name, indices, object: piece });
    body.debris = true;
    ragdoll.bind(body, piece.matrixWorld);
    piece.matrixAutoUpdate = false;
    for (const index of indices) ragdoll.particles[index].kinematic = false;
    body.dynamic = true;
    ragdoll.push(indices, temp.copy(velocity).clampLength(0, 6).multiplyScalar(0.3).add(temp2.set(0, 1.1, 0)));
    const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(9);
    const middle = ragdoll.particles[indices[0]].position;
    for (const index of indices) ragdoll.push([index], temp.subVectors(ragdoll.particles[index].position, middle).cross(axis).negate());
    return body;
  }

  /** Staggers the standing trooper in proportion to the hit (once per sweep). */
  let pending = null;
  function react(velocity, contact, strength) {
    if (!pending || strength > pending.strength) pending = { velocity: velocity.clone(), contact: contact.clone(), strength };
  }
  function stagger({ velocity, contact, strength }) {
    if (trooper.dead) return;
    const r = reaction;
    const push = local(velocity).setY(0);
    const force = Math.min(1.6, push.length() / 4) * strength;
    push.normalize();
    const side = local(temp.subVectors(contact, trooper.root.position)).x;
    r.vpitch += push.z * 4 * force;
    r.vroll += -push.x * 4 * force;
    r.vyaw += (side > 0 ? 1 : -1) * push.z * 5 * force + (random() - 0.5) * 2 * force;
    r.vhead += (random() - 0.3) * 6 * force;
    r.vbuckle += 2.5 * force;
    r.varmL += (random() - 0.5) * 8 * force;
    r.varmR += (random() - 0.5) * 8 * force;
    r.push.addScaledVector(world(push), 0.9 * force);
    r.imbalance += 0.28 * force;
    if (r.imbalance > 1) die('imbalance', velocity);
  }

  /** From standing to ragdoll; the impulses depend on the cause. */
  function die(cause, velocity = new THREE.Vector3(), cutChild = null) {
    if (trooper.dead) return;
    trooper.dead = true;
    if (trooper.holding) dropBlaster(velocity);
    trooper.root.updateMatrixWorld(true);
    release(Object.keys(bodies));
    const forward = world(new THREE.Vector3(0, 0, 1));
    const shove = temp.copy(velocity).setY(0).clampLength(0, 6);
    const along = shove.lengthSq() > 1e-6 ? shove.clone().normalize() : forward.clone().negate();
    // Every fall carries the stagger already under way.
    ragdoll.push(ragdoll.particles.map((_, index) => index), reaction.push.clone());
    const upper = ['head', 'torso', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR'].filter(name => !cutChild || !cutChild.includes(name));
    const knees = ['KL', 'KR'].map(key => particleIndex[key]);
    const buckle = forward.clone().multiplyScalar(0.8 + random() * 0.9);
    const topple = 0.9 + random() * 1.3;
    switch (cause) {
      case 'neck':
        ragdoll.push(indicesOf(upper.filter(name => name !== 'head')), along.clone().multiplyScalar(0.5));
        ragdoll.push(knees, buckle.multiplyScalar(1.4));
        break;
      case 'waist':
        ragdoll.push(knees, buckle);
        ragdoll.push([particleIndex.W], along.clone().multiplyScalar(-0.3));
        break;
      case 'slash':
        ragdoll.push(indicesOf(upper), along.clone().multiplyScalar(topple * 0.8).add(temp2.set(0, 0.4, 0)));
        ragdoll.push(knees, buckle);
        break;
      default:
        ragdoll.push(indicesOf(upper), along.clone().multiplyScalar(topple));
        ragdoll.push(knees, buckle);
    }
    // A twist through the shoulders so no two falls match.
    const twist = forward.clone().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar((random() - 0.5) * 2.2);
    ragdoll.push([particleIndex.SL], twist);
    ragdoll.push([particleIndex.SR], twist.clone().negate());
    trooper.events.push({ type: 'fall', cause });
  }

  function cut(name, hit) {
    const definition = CUTS[name];
    if (!definition || trooper.severed.has(name)) return false;
    const childBodies = subtree(definition.child);
    trooper.severed.add(name);
    ragdoll.sever(particleIndex[definition.particle], childBodies.map(child => bodies[child]), name);
    for (const { cap, ring } of caps[name]) {
      cap.visible = true;
      effects?.glow(ring.material);
      effects?.smoulder(cap);
    }
    const wasAlive = !trooper.dead;
    release(childBodies);
    // The severed part is carried off by the blade. Through the waist it is
    // the upper body that goes; the legs give way beneath it.
    const flying = name === 'waist' ? subtree('torso').filter(part => !childBodies.includes(part)) : childBodies;
    const fly = temp.copy(hit.velocity).clampLength(0, 6).multiplyScalar(0.32).add(temp2.set(0, 0.35 + random() * 0.5, 0));
    if (name === 'waist') release(flying);
    ragdoll.push(indicesOf(flying), fly);
    spin([name === 'waist' ? 'torso' : definition.child], 3 + random() * 4);
    if (wasAlive) {
      const armLost = childBodies.some(child => /^(upperArm|forearm|hand)/.test(child));
      if (armLost) dropBlaster(hit.velocity);
      if (definition.lethal) die(name.replace(/[LR]$/, ''), hit.velocity, childBodies);
      else react(hit.velocity, hit.point, 1);
    }
    return true;
  }

  /** A glowing scorch across the armour where the blade passed without cutting. */
  function scorch(body, hit) {
    const axisPoint = hit.axisPoint, normal = temp.subVectors(hit.point, axisPoint).normalize();
    const along = hit.velocity.clone().addScaledVector(normal, -hit.velocity.dot(normal)).normalize();
    if (!Number.isFinite(along.x) || along.lengthSq() < 0.5) return;
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.016, 0.012), material);
    mark.name = 'Saber scorch';
    const matrix = new THREE.Matrix4().makeBasis(along, temp2.crossVectors(normal, along), normal);
    mark.quaternion.setFromRotationMatrix(matrix);
    mark.position.copy(axisPoint).addScaledVector(normal, body.capsule[2] * 0.95);
    trooper.debris.add(mark);
    mark.updateMatrixWorld(true);
    body.object.attach(mark);
    marks.push(mark);
    effects?.glow(material, 5);
  }

  function update(dt, time) {
    dt = Math.min(dt, 0.05);
    if (!trooper.dead) {
      pose(time, dt);
      placeParticles(dt);
    }
    if (dt > 0) ragdoll.step(dt);
    syncObjects();
  }

  // Closest points between segments p1q1 and p2q2 (Ericson).
  function closest(p1, q1, p2, q2) {
    const d1 = new THREE.Vector3().subVectors(q1, p1), d2 = new THREE.Vector3().subVectors(q2, p2), r = new THREE.Vector3().subVectors(p1, p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    let s, t;
    if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
    else if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
    else {
      const c = d1.dot(r);
      if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else {
        const b = d1.dot(d2), denominator = a * e - b * b;
        s = denominator > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
      }
    }
    const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
    return { s, t, c1, c2, distance: c1.distanceTo(c2) };
  }

  /**
   * Tests the blade's sweep since the last frame against every part and
   * applies cuts, scorches, armour hits and staggers. Returns the events.
   */
  function strike(previousBase, previousTip, bladeBase, bladeTip, dt, time = 0) {
    trooper.events = [];
    if (!(dt > 0)) return trooper.events;
    const steps = 8;
    const fromDirection = new THREE.Vector3().subVectors(previousTip, previousBase), toDirection = new THREE.Vector3().subVectors(bladeTip, bladeBase);
    const fromLength = fromDirection.length(), toLength = toDirection.length();
    if (fromLength < 0.1 || toLength < 0.1) return trooper.events;
    fromDirection.normalize(); toDirection.normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(fromDirection, toDirection), partial = new THREE.Quaternion();
    const blade = (k, out = {}) => {
      const f = k / steps;
      partial.identity().slerp(turn, f);
      out.base = new THREE.Vector3().lerpVectors(previousBase, bladeBase, f);
      out.direction = fromDirection.clone().applyQuaternion(partial);
      out.length = fromLength + (toLength - fromLength) * f;
      out.tip = out.base.clone().addScaledVector(out.direction, out.length);
      return out;
    };
    const hits = [];
    const done = new Set();
    let before = blade(0);
    for (let k = 1; k <= steps; k++) {
      const now = blade(k);
      for (const body of ragdoll.bodies) {
        if (!body.capsule || done.has(body) || time - body.lastHit < 0.25) continue;
        const radius = body.capsule[2];
        const p0 = ragdoll.particles[body.indices[body.capsuleSlots[0]]].position;
        const p1 = ragdoll.particles[body.indices[body.capsuleSlots[1]]].position;
        const result = closest(now.base, now.tip, p0, p1);
        if (result.distance > radius) continue;
        done.add(body);
        const previousPoint = before.base.clone().addScaledVector(before.direction, before.length * result.s);
        const velocity = result.c1.clone().sub(previousPoint).divideScalar(dt / steps);
        hits.push({ body, s: result.t, point: result.c1, axisPoint: result.c2, velocity, direction: now.direction.clone(), normal: now.direction.clone().cross(velocity).normalize() });
      }
      before = now;
    }
    pending = null;
    for (const hit of hits) resolve(hit, time);
    if (pending) stagger(pending);
    return trooper.events;
  }

  function resolve(hit, time) {
    const { body } = hit;
    body.lastHit = time;
    const speed = hit.velocity.length();
    const horizontal = Math.abs(hit.normal.y) > 0.6;
    const event = { type: 'graze', part: body.name, point: hit.point.clone(), velocity: hit.velocity.clone(), normal: hit.normal.clone(), speed };
    const sparkDirection = speed > 0.01 ? hit.velocity.clone().normalize() : new THREE.Vector3(0, 1, 0);
    if (speed < CUT_SPEED) {
      effects?.sparks(hit.point, sparkDirection, hit.normal, { count: speed < 0.6 ? 4 : 12, speed: 1.5 + speed });
      if (!trooper.dead && speed > 0.6) react(hit.velocity, hit.point, 0.35);
      const name = body.name;
      if (/^shin/.test(name) && speed > 1.2) {
        const side = name.slice(-1);
        if (knockOff(pieces[`kneePad${side}`], hit.velocity) || knockOff(pieces[`shinPlate${side}`], hit.velocity)) event.type = 'armor';
      }
      trooper.events.push(event);
      return;
    }
    let joint = null;
    const name = body.name, side = name.slice(-1);
    if (name === 'head') joint = 'neck';
    else if (name === 'torso') joint = hit.s > 0.78 ? 'neck' : hit.s < 0.32 && horizontal ? 'waist' : null;
    else if (name === 'pelvis') joint = horizontal ? 'waist' : hit.s < 0.5 ? 'hipL' : 'hipR';
    else if (/^upperArm/.test(name)) joint = hit.s < 0.42 ? `shoulder${side}` : `elbow${side}`;
    else if (/^forearm/.test(name)) joint = hit.s < 0.45 ? `elbow${side}` : `wrist${side}`;
    else if (/^hand/.test(name)) joint = `wrist${side}`;
    else if (/^thigh/.test(name)) joint = hit.s < 0.35 ? `hip${side}` : `knee${side}`;
    else if (/^shin/.test(name)) joint = hit.s < 0.4 ? `knee${side}` : null;
    effects?.sparks(hit.point, sparkDirection, hit.normal, { count: 30, speed: 2 + Math.min(speed, 8) * 0.5 });
    effects?.flash(hit.point, Math.min(1, speed / 5));
    if (name === 'blaster') {
      event.type = 'disarm';
      if (trooper.holding) dropBlaster(hit.velocity);
      else ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.3));
    } else if (joint && cut(joint, hit)) {
      event.type = 'cut';
      event.joint = joint;
      event.lethal = Boolean(CUTS[joint].lethal);
    } else if (name === 'torso' || name === 'pelvis' || /^shin/.test(name)) {
      if (/^shin/.test(name)) {
        event.type = knockOff(pieces[`kneePad${side}`], hit.velocity) || knockOff(pieces[`shinPlate${side}`], hit.velocity) ? 'armor' : 'slash';
        if (!trooper.dead) { react(hit.velocity, hit.point, 1.4); if (!trooper.dead) die('leg', hit.velocity); }
      } else {
        event.type = 'slash';
        scorch(body, hit);
        if (!trooper.dead) { if (speed > SLASH_LETHAL_SPEED) die('slash', hit.velocity); else react(hit.velocity, hit.point, 1.2); }
      }
      if (trooper.dead) ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.25));
    } else {
      if (trooper.dead) ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.25));
      else react(hit.velocity, hit.point, 0.8);
    }
    trooper.events.push(event);
  }

  function dispose() {
    for (const group of [trooper.root, trooper.debris]) {
      if (!group) continue;
      group.traverse(object => {
        object.geometry?.dispose();
        if (object.material && !Object.values(materials).includes(object.material)) object.material.dispose();
      });
      group.removeFromParent();
    }
  }
  function reset() {
    dispose();
    build();
  }
  /** Where the standing trooper blocks the hero (null once he has fallen). */
  function blocker() {
    if (trooper.dead) return null;
    const at = joints.pelvis.getWorldPosition(new THREE.Vector3());
    return { x: at.x, z: at.z, radius: 0.32 };
  }

  build();
  return Object.assign(trooper, { update, strike, reset, dispose, blocker, cut, die, get reaction() { return reaction; }, particle: name => ragdoll.particles[particleIndex[name]] });
}
