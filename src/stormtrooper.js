import * as THREE from 'three';
import { Ragdoll } from './ragdoll.js';
import { aimBone, solveTwoBone } from './ik.js';
import { approach, createTweens, ease } from './tween.js';

/**
 * Stormtrooper training dummy. A low-poly trooper in white armour over a black
 * suit, built from rigid parts — helmet, torso, pelvis, upper arms, forearms,
 * hands, thighs, shins, boots, and an E-11 blaster — each hung on a light
 * skeleton while it stands, idle, rifle in hand, feet planted by leg IK. Every
 * part is also a rigid body of a Verlet ragdoll whose particles follow the
 * pose until physics takes over. The blade's real sweep is tested against a
 * capsule per part; where it crosses decides which predefined joint is
 * severed (shoulder, elbow, wrist, hip, knee, ankle, neck, or the waist under
 * a horizontal cut), or an armour plate is knocked off. Cuts are cauterised
 * and glow, nothing gory. A severed piece is thrown with the blade's momentum
 * — along its sweep, up into an arc, spinning about the cut — then simply
 * simulated: it tumbles, bounces, skids and comes to rest near the body.
 * Every hit flashes the struck armour white for an instant.
 *
 * He feels what happens to him, alive or dead:
 * - standing, each hit is answered where it lands (the head snaps, an arm is
 *   flung and lets go of the rifle, a leg buckles, the torso doubles over),
 *   and a hand goes to a fresh scorch;
 * - a lost hand or forearm: he drops the rifle, draws the stump against his
 *   belly and holds it with the other hand, hunched and trembling;
 * - a lost leg, or too many blows: he falls, alive, rolls onto his front and
 *   crawls on his elbows — muscles drive the ragdoll — until he gives out;
 * - beheaded: the body stays up a heartbeat, collapses and twitches for a few
 *   seconds; other deaths shudder briefly, and a corpse still jolts and
 *   twitches when struck.
 *
 * update(dt, time) then strike(previousBase, previousTip, base, tip, dt) each
 * frame; reset() rebuilds him intact. +Z is his front.
 */
export const CUT_SPEED = 2.2;
const SLASH_LETHAL_SPEED = 3.5;
const SIDES = [['L', 1], ['R', -1]];
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
// Floor behaviour of loose pieces: hard and light, they clatter and skid.
const LOOSE = { bounce: 0.38, friction: 0.05 };

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
for (const [side, sign] of SIDES) {
  PARTICLES.push(
    [`S${side}`, `shoulder${side}`, [0, 0, 0], 0.08, 2],
    [`E${side}`, `elbow${side}`, [0, 0, 0], 0.055, 1], [`UA${side}`, `shoulder${side}`, [0, -0.13, 0.07], 0.05, 0.5],
    [`W${side}`, `wrist${side}`, [0, 0, 0], 0.05, 0.8], [`FA${side}`, `elbow${side}`, [0, -0.12, 0.065], 0.05, 0.5],
    [`HT${side}`, `wrist${side}`, [0, -0.1, 0], 0.04, 0.3], [`HP${side}`, `wrist${side}`, [sign * 0.01, -0.05, 0.05], 0.035, 0.3],
    [`K${side}`, `knee${side}`, [0, 0, 0], 0.065, 1.5], [`TH${side}`, `hip${side}`, [0, -0.18, 0.09], 0.07, 0.8],
    [`SH${side}`, `knee${side}`, [0, -0.17, 0.06], 0.05, 0.5],
    [`A${side}`, `ankle${side}`, [0, 0, 0], 0.06, 1], [`T${side}`, `ankle${side}`, [0, -0.055, 0.15], 0.035, 0.6], [`HE${side}`, `ankle${side}`, [0, -0.06, -0.04], 0.04, 0.4],
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
    [`shin${side}`, [`K${side}`, `A${side}`, `SH${side}`], [`K${side}`, `A${side}`, 0.075]],
    [`foot${side}`, [`A${side}`, `T${side}`, `HE${side}`], [`HE${side}`, `T${side}`, 0.065]],
  );
}
// Predefined separations: the shared particle, which side comes away, cap size
// and facing. Lethal ones kill; a lost leg fells him alive.
const CUTS = {
  neck: { particle: 'N', parent: 'torso', child: 'head', lethal: true, radius: 0.055, normal: [0, 1, 0] },
  waist: { particle: 'W', parent: 'torso', child: 'pelvis', lethal: true, radius: 0.13, normal: [0, -1, 0] },
};
for (const [side, sign] of SIDES) {
  Object.assign(CUTS, {
    [`shoulder${side}`]: { particle: `S${side}`, parent: 'torso', child: `upperArm${side}`, radius: 0.065, normal: [sign, 0, 0] },
    [`elbow${side}`]: { particle: `E${side}`, parent: `upperArm${side}`, child: `forearm${side}`, radius: 0.05, normal: [0, -1, 0] },
    [`wrist${side}`]: { particle: `W${side}`, parent: `forearm${side}`, child: `hand${side}`, radius: 0.04, normal: [0, -1, 0] },
    [`hip${side}`]: { particle: `H${side}`, parent: 'pelvis', child: `thigh${side}`, radius: 0.075, normal: [0, -1, 0] },
    [`knee${side}`]: { particle: `K${side}`, parent: `thigh${side}`, child: `shin${side}`, radius: 0.06, normal: [0, -1, 0] },
    [`ankle${side}`]: { particle: `A${side}`, parent: `shin${side}`, child: `foot${side}`, radius: 0.05, normal: [0, -1, 0] },
  });
}
// How hard the muscles hold each particle to the crawl: hands firmly, the
// trunk steadily, the legs barely — they drag.
const MUSCLE = { W: 1, N: 1.2, SL: 1, SR: 1, HT: 1.2, HF: 1.2, HL: 0.7, HR: 0.7 };
for (const side of ['L', 'R']) {
  Object.assign(MUSCLE, {
    [`S${side}`]: 1, [`UA${side}`]: 2, [`E${side}`]: 2.5, [`FA${side}`]: 2.5, [`W${side}`]: 3.5, [`HT${side}`]: 3, [`HP${side}`]: 3,
    [`TH${side}`]: 0.4, [`K${side}`]: 0.35, [`SH${side}`]: 0.3, [`A${side}`]: 0.25, [`T${side}`]: 0.2, [`HE${side}`]: 0.2,
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

  for (const [side, sign] of SIDES) {
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

    const foot = part(`foot${side}`);
    add(foot, new THREE.BoxGeometry(0.11, 0.12, 0.23), armor, [0, -0.03, 0.05]);
    add(foot, new THREE.BoxGeometry(0.115, 0.02, 0.235), black, [0, -0.08, 0.05]);
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

const smooth = u => u * u * (3 - 2 * u);

export function createStormtrooper({ scene, position = new THREE.Vector3(), heading = 0, effects = null, random = Math.random } = {}) {
  const trooper = { root: null, debris: null, dead: false, fallen: false, holding: true, severed: new Set(), events: [] };
  let joints, parts, pieces, holder, ragdoll, particleIndex, particleSpec, bodies, caps, marks, base, feet;
  // Time, a pending collapse, the crawl, death throes, and muscle twitches.
  let clock = 0, collapse = null, crawl = null, spasm = null, twitches = [];
  // Crawl muscles: per particle, where it should be over the current frame.
  let muscles = [], muscleState = new Map(), driveClock = 0, driveSpan = 1 / 60;
  const reaction = {};
  const tweens = createTweens(), flashes = new Map();
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const goal = new THREE.Vector3(), stride = new THREE.Vector3(), motion = new THREE.Vector3(), kick = new THREE.Vector3();
  const forward = new THREE.Vector3(), leftward = new THREE.Vector3(), basis = new THREE.Matrix4(), roll = new THREE.Quaternion();
  const restUpper = new THREE.Quaternion(), restLower = new THREE.Quaternion(), solved = new THREE.Quaternion();
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
    for (const side of ['L', 'R']) Object.assign(mounts, { [`upperArm${side}`]: `shoulder${side}`, [`forearm${side}`]: `elbow${side}`, [`hand${side}`]: `wrist${side}`, [`thigh${side}`]: `hip${side}`, [`shin${side}`]: `knee${side}`, [`foot${side}`]: `ankle${side}` });
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
    particleSpec = [];
    for (const spec of PARTICLES) {
      const [name, joint, local, radius, mass] = spec;
      particleIndex[name] = ragdoll.addParticle({ name, position: joints[joint].localToWorld(new THREE.Vector3(...local)), radius, mass });
      particleSpec[particleIndex[name]] = spec;
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
      ragdoll.addLimit(P(`K${side}`), P(`T${side}`), 0.3, Infinity, `ankle${side}`);
      ragdoll.addLimit(P(`K${side}`), P('N'), 0.45, Infinity, `hip${side}`);
      ragdoll.addLimit(P(`E${side}`), P(side === 'L' ? 'SR' : 'SL'), 0.26, Infinity, `shoulder${side}`);
    }
    ragdoll.connect(bodies.blaster, bodies.handR);
    ragdoll.connect(bodies.blaster, bodies.handL);
    ragdoll.connect(bodies.blaster, bodies.torso);
    ragdoll.drivers.push(drive);

    const debris = new THREE.Group();
    debris.name = 'Stormtrooper parts';
    root.position.copy(position);
    root.rotation.y = heading;
    scene.add(root, debris);
    Object.assign(trooper, { root, debris, dead: false, fallen: false, holding: true, severed: new Set(), parts, pieces, joints, bodies, ragdoll, caps });
    marks = [];
    collapse = crawl = spasm = null;
    twitches = [];
    muscles = [];
    muscleState = new Map();
    Object.assign(reaction, {
      yaw: 0, pitch: 0, roll: 0, head: 0, headYaw: 0, headRoll: 0, buckle: 0, armL: 0, armR: 0, flareL: 0, flareR: 0, dipL: 0, dipR: 0,
      vyaw: 0, vpitch: 0, vroll: 0, vhead: 0, vheadYaw: 0, vheadRoll: 0, vbuckle: 0, varmL: 0, varmR: 0, vflareL: 0, vflareR: 0, vdipL: 0, vdipR: 0,
      offset: new THREE.Vector3(), push: new THREE.Vector3(), imbalance: 0,
      holdL: 1, holdR: 1, letGo: { L: 0, R: 0 }, hurt: 0, clutch: 0, wound: null, woundAge: 0,
      press: null, pressAt: null, pressHand: null, pressing: 0, limp: 0,
      linear: { hurt: 0, clutch: 0, pressing: 0, limp: 0, holdL: 1, holdR: 1 },
    });
    base = joints.pelvis.position.clone();
    // Where his feet stand: leg IK keeps them planted while the body sways.
    joints.pelvis.position.y = base.y - 0.015;
    for (const [side, sign] of SIDES) {
      joints[`hip${side}`].rotation.set(-0.06, 0, sign * 0.06);
      joints[`knee${side}`].rotation.set(0.12, 0, 0);
      joints[`ankle${side}`].rotation.set(-0.06, 0, -sign * 0.06);
    }
    root.updateMatrixWorld(true);
    const inverse = root.quaternion.clone().invert();
    feet = {};
    for (const side of ['L', 'R']) {
      const ankle = joints[`ankle${side}`];
      feet[side] = { position: root.worldToLocal(ankle.getWorldPosition(new THREE.Vector3())), quaternion: inverse.clone().multiply(ankle.getWorldQuaternion(new THREE.Quaternion())) };
    }
    pose(0, 0);
    root.updateMatrixWorld(true);
    placeParticles(1 / 60);
    placeParticles(1 / 60);
  }

  const armCut = side => trooper.severed.has(`shoulder${side}`) || trooper.severed.has(`elbow${side}`) || trooper.severed.has(`wrist${side}`);
  const shiver = (time, scale) => new THREE.Vector3(Math.sin(time * 23) * scale, Math.sin(time * 19 + 1) * scale, Math.sin(time * 29 + 2) * scale);

  /** Two-bone IK of an arm towards a world target, blended in by weight. */
  function reach(side, target, pole, weight) {
    if (weight < 0.01) return;
    const shoulder = joints[`shoulder${side}`], elbow = joints[`elbow${side}`];
    restUpper.copy(shoulder.quaternion); restLower.copy(elbow.quaternion);
    solveTwoBone(shoulder, elbow, joints[`wrist${side}`], target, pole);
    if (weight < 1) {
      shoulder.quaternion.slerpQuaternions(restUpper, solved.copy(shoulder.quaternion), weight);
      elbow.quaternion.slerpQuaternions(restLower, solved.copy(elbow.quaternion), weight);
      shoulder.updateMatrixWorld(true);
    }
  }
  /** Turns an upper arm so its elbow end points at a world target. */
  function aimArm(side, target, weight) {
    const shoulder = joints[`shoulder${side}`];
    restUpper.copy(shoulder.quaternion);
    aimBone(shoulder, shoulder.getWorldPosition(new THREE.Vector3()), joints[`elbow${side}`].getWorldPosition(new THREE.Vector3()), target);
    shoulder.quaternion.slerpQuaternions(restUpper, solved.copy(shoulder.quaternion), weight);
    shoulder.updateMatrixWorld(true);
  }

  function pose(time, dt) {
    const r = reaction;
    // Damped springs: hits kick them, they settle back.
    const spring = (key, k = 55, damping = 7) => { r[`v${key}`] += (-k * r[key] - damping * r[`v${key}`]) * dt; r[key] += r[`v${key}`] * dt; };
    for (const key of ['yaw', 'pitch', 'roll', 'head', 'headYaw', 'headRoll', 'buckle', 'armL', 'armR', 'flareL', 'flareR', 'dipL', 'dipR']) spring(key);
    r.push.multiplyScalar(Math.exp(-5 * dt));
    r.offset.addScaledVector(r.push, dt);
    r.imbalance = Math.max(0, r.imbalance - dt * 0.4);
    // A wound: he hunches over it, looks down at it, and after a moment of
    // shock draws it in and holds it with the other hand.
    if (r.wound) r.woundAge += dt;
    if (r.press && (r.press.age += dt) > r.press.duration) r.press = null;
    // Blends move at a steady pace and are read through easing curves: he
    // doubles over fast and settles slowly, a hand eases off the rifle and
    // onto a wound, the knees give way with gathering speed.
    const glide = (key, target, seconds, curve) => { r.linear[key] = approach(r.linear[key], target, dt / seconds); r[key] = curve(r.linear[key]); };
    glide('hurt', r.wound ? 1 : 0, 0.45, ease.outCubic);
    glide('clutch', r.wound && r.woundAge > 0.35 ? 1 : 0, 0.5, ease.inOutCubic);
    glide('pressing', r.press ? 1 : 0, r.press ? 0.22 : 0.45, ease.inOutSine);
    glide('limp', collapse ? 1 : 0, 0.28, ease.inQuad);
    // Hands on the rifle, unless hurt, flung off it, or pressed on a burn.
    const grips = {};
    for (const side of ['L', 'R']) {
      r.letGo[side] = Math.max(0, r.letGo[side] - dt);
      grips[side] = !armCut(side) && !r.wound && r.letGo[side] <= 0 && !(r.press && r.pressHand === side);
    }
    if (trooper.holding && !grips.L && !grips.R) dropBlaster(new THREE.Vector3());
    glide('holdL', trooper.holding && grips.L ? 1 : 0, 0.25, ease.inOutSine);
    glide('holdR', trooper.holding && grips.R ? 1 : 0, 0.25, ease.inOutSine);
    const toward = r.wound ? (r.wound.side === 'L' ? 1 : -1) : 0;
    const gasp = Math.sin(time * 4.2) * 0.025 * r.hurt, rock = Math.sin(time * 1.3) * 0.035 * r.hurt;
    const pressSide = r.pressHand === 'L' ? 1 : -1;

    const breathe = Math.sin(time * 1.7), look = (Math.sin(time * 0.33) * 0.22 + Math.sin(time * 0.71) * 0.08) * (1 - r.hurt) * (1 - r.pressing * 0.7);
    const dip = r.dipL + r.dipR, tilt = r.dipR - r.dipL;
    joints.pelvis.position.set(base.x + Math.sin(time * 0.5) * 0.008 + r.offset.x, base.y - 0.015 - r.buckle * 0.08 - r.hurt * 0.04 - dip * 0.06 - r.limp * 0.17, base.z + r.offset.z);
    joints.pelvis.rotation.set(r.pitch * 0.3, r.yaw * 0.4, r.roll * 0.4 + tilt * 0.22);
    joints.spine.rotation.set(-0.03 + breathe * 0.012 + r.pitch * 0.7 + r.hurt * 0.26 + gasp + rock + r.pressing * 0.14 + r.limp * 0.45, r.yaw * 0.6 + toward * r.hurt * 0.2, r.roll * 0.6 + toward * r.hurt * 0.06 - tilt * 0.16);
    joints.neck.rotation.set(0.05 + r.head * 0.6 + r.hurt * 0.38 + r.pressing * 0.32, look - r.yaw * 0.5 + r.head * 0.3 + r.headYaw + toward * r.hurt * 0.35 + pressSide * r.pressing * 0.3, r.roll * -0.3 + r.headRoll);
    for (const [side, sign] of SIDES) {
      joints[`hip${side}`].rotation.set(-0.06 - r.buckle * 0.5 - r.hurt * 0.22, 0, sign * 0.06);
      joints[`knee${side}`].rotation.set(0.12 + r.buckle * 0.9 + r.hurt * 0.38, 0, 0);
      joints[`ankle${side}`].rotation.set(-0.06, 0, -sign * 0.06);
      // Without the rifle the arms hang, flung by the hits.
      joints[`shoulder${side}`].rotation.set(-0.15 + r[`arm${side}`], 0, sign * (0.12 + Math.abs(r[`arm${side}`]) * 0.5) + r[`flare${side}`]);
      joints[`elbow${side}`].rotation.set(-0.35 - r.limp * 0.4, 0, 0);
      joints[`wrist${side}`].rotation.set(0, 0, 0);
    }
    trooper.root.updateMatrixWorld(true);
    // Feet stay planted: the knees take up every dip and sway.
    const rootQuaternion = trooper.root.quaternion;
    for (const [side, sign] of SIDES) {
      const knee = joints[`knee${side}`], ankle = joints[`ankle${side}`];
      solveTwoBone(joints[`hip${side}`], knee, ankle, trooper.root.localToWorld(temp.copy(feet[side].position)), trooper.root.localToWorld(temp2.set(sign * 0.12, 0.5, 0.8)));
      knee.getWorldQuaternion(quaternion).invert();
      ankle.quaternion.copy(quaternion.multiply(solved.copy(rootQuaternion).multiply(feet[side].quaternion)));
      ankle.updateMatrixWorld(true);
    }
    // Rifle in hand: each hand reaches its grip.
    for (const [side, sign, grip] of [['R', -1, gripRight], ['L', 1, gripLeft]]) {
      if (armCut(side)) continue;
      reach(side, holder.localToWorld(temp.copy(grip)), joints[`shoulder${side}`].localToWorld(temp2.set(sign * 0.35, -0.3, -0.3)), r[`hold${side}`]);
    }
    // The wounded arm is drawn in — a forearm across the belly, an upper arm
    // tucked to his side — and the other hand holds the stump, trembling.
    const wound = r.wound;
    if (wound && r.clutch > 0.01) {
      const side = wound.side, sign = side === 'L' ? 1 : -1, kind = wound.joint.slice(0, -1);
      if (kind === 'wrist') {
        const target = joints.spine.localToWorld(new THREE.Vector3(-sign * 0.03, 0.16 + Math.sin(time * 2.1) * 0.01, 0.25));
        reach(side, target, joints[`shoulder${side}`].localToWorld(temp2.set(sign * 0.5, -0.2, -0.4)), r.clutch);
      } else if (kind === 'elbow') {
        aimArm(side, joints.spine.localToWorld(new THREE.Vector3(sign * 0.17, 0.07, 0.14)), r.clutch);
      }
      const healthy = side === 'L' ? 'R' : 'L';
      if (!armCut(healthy)) {
        const stump = caps[wound.joint][0].cap;
        let target;
        if (kind === 'shoulder') target = stump.localToWorld(new THREE.Vector3(0, 0, 0.05));
        else {
          const at = stump.getWorldPosition(new THREE.Vector3());
          const inward = joints[`shoulder${healthy}`].getWorldPosition(new THREE.Vector3()).sub(at).setY(0).normalize();
          target = at.addScaledVector(inward, kind === 'wrist' ? 0.05 : 0.04).add(temp.set(0, 0.045, 0));
        }
        target.add(shiver(time, 0.006));
        reach(healthy, target, joints[`shoulder${healthy}`].localToWorld(temp2.set(-sign * 0.4, -0.35, kind === 'wrist' ? -0.2 : 0.1)), r.clutch);
      }
    }
    // A fresh scorch: a hand presses on it for a moment.
    if (r.pressing > 0.01 && r.pressAt && !armCut(r.pressHand)) {
      const outward = new THREE.Vector3(r.pressAt.x, 0, r.pressAt.z).normalize();
      const target = joints.spine.localToWorld(r.pressAt.clone().addScaledVector(outward, 0.07).add(temp.set(0, 0.05, 0))).add(shiver(time, 0.004));
      reach(r.pressHand, target, joints[`shoulder${r.pressHand}`].localToWorld(temp2.set(pressSide * 0.4, -0.3, -0.2)), r.pressing);
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

  function loosen(indices) { for (const index of indices) Object.assign(ragdoll.particles[index], LOOSE); }

  /**
   * Throws a severed piece with the blade's momentum: carried along the sweep
   * and popped up into an arc, spinning about the cut like a struck stick.
   * Light pieces fly further, a heavy one mostly drops, and a touch of
   * controlled chance keeps two throws from matching. From there on it is
   * simulated — gravity, drag, tumbling, bounces — never scripted.
   */
  function launch(names, hit, cutAt) {
    const indices = [...new Set(indicesOf(names))];
    let mass = 0;
    const centre = new THREE.Vector3();
    for (const index of indices) {
      const particle = ragdoll.particles[index], weight = 1 / particle.inverseMass;
      mass += weight;
      centre.addScaledVector(particle.position, weight);
    }
    centre.divideScalar(mass);
    // The sweep: how the blade moved across its own length at the contact.
    const sweep = hit.velocity.clone();
    if (hit.direction) sweep.addScaledVector(hit.direction, -sweep.dot(hit.direction));
    const speed = sweep.length();
    const along = speed > 1e-3 ? sweep.divideScalar(speed) : new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize();
    const vary = (amount = 0.15) => 1 + (random() - 0.5) * 2 * amount;
    const lightness = THREE.MathUtils.clamp(2.2 / mass, 0.22, 1.3);
    // Out along the sweep, a little away from his body, turned a touch at
    // random; never straight down, and never far — it lands near him.
    const throwSpeed = THREE.MathUtils.clamp(speed * 0.3, 0.5, 2.6) * lightness * vary();
    const velocity = new THREE.Vector3(along.x, 0, along.z).multiplyScalar(throwSpeed);
    const away = centre.clone().sub(trooper.particle('W').position).setY(0);
    if (away.lengthSq() > 1e-6) velocity.addScaledVector(away.normalize(), 0.5 * lightness);
    const least = 0.8 * lightness;
    if (velocity.length() < least) velocity.setLength(least);
    velocity.applyAxisAngle(UP, (random() - 0.5) * 0.4);
    // Up into an arc: high off an upswing, a low skip off a downward chop.
    const lift = THREE.MathUtils.clamp(2.6 + along.y * 1.6, 1.2, 4.2) * (0.55 + 0.45 * lightness) * THREE.MathUtils.clamp(0.6 + speed * 0.08, 0.7, 1.2) * vary();
    velocity.y += lift;
    // Spin: the blade drives the cut end, so the piece turns about its centre.
    const lever = new THREE.Vector3().subVectors(cutAt, centre);
    const spin = new THREE.Vector3();
    if (lever.lengthSq() > 1e-4) {
      spin.crossVectors(lever, along).multiplyScalar(THREE.MathUtils.clamp(speed * 0.45, 1.5, 6) * vary(0.25) / lever.lengthSq());
      const rate = THREE.MathUtils.clamp(spin.length(), 3, 15) * (0.6 + 0.4 * lightness);
      if (spin.lengthSq() > 1e-8) spin.setLength(rate);
      spin.addScaledVector(lever.normalize(), (random() - 0.5) * 6);
    }
    for (const index of indices) ragdoll.push([index], temp.crossVectors(spin, temp2.subVectors(ragdoll.particles[index].position, centre)).add(velocity));
    loosen(indices);
    return { velocity, spin, mass };
  }

  /** The struck armour flashes white for an instant, then fades back. */
  function flashPart(body, power = 1) {
    const object = body?.object;
    if (!object) return;
    const meshes = [];
    object.traverse(child => { if (child.isMesh && child.material?.emissive && !child.parent?.name.startsWith('Cut')) meshes.push(child); });
    for (const mesh of meshes) {
      if (mesh.userData.ownMaterial) continue;
      mesh.material = mesh.material.clone();
      mesh.userData.ownMaterial = true;
    }
    tweens.cancel(flashes.get(object));
    flashes.set(object, tweens.add({
      duration: 0.18, curve: ease.outQuad,
      update: eased => { const v = (1 - eased) * power; for (const mesh of meshes) mesh.material.emissive.setRGB(v * 1.3, v * 1.22, v * 1.15); },
      complete: () => { for (const mesh of meshes) mesh.material.emissive.setRGB(0, 0, 0); flashes.delete(object); },
    }));
  }

  function dropBlaster(velocity) {
    if (!trooper.holding) return;
    trooper.holding = false;
    release(['blaster']);
    loosen(bodies.blaster.indices);
    ragdoll.push(bodies.blaster.indices, temp.copy(velocity).clampLength(0, 4).multiplyScalar(0.08).add(temp2.set(0, 0.25, 0)));
    spin(['blaster'], 2.5);
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
    loosen(indices);
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

  /** Staggers the standing trooper where and as hard as he was hit (once per sweep). */
  let pending = null;
  function react(velocity, contact, strength, part = 'torso') {
    if (!pending || strength > pending.strength) pending = { velocity: velocity.clone(), contact: contact.clone(), strength, part };
  }
  function stagger({ velocity, contact, strength, part }) {
    if (trooper.dead || trooper.fallen) return;
    const r = reaction;
    const push = local(velocity).setY(0);
    const force = Math.min(1.6, push.length() / 4) * strength;
    push.normalize();
    const at = local(temp.subVectors(contact, trooper.root.position));
    const side = /[LR]$/.test(part) ? part.slice(-1) : at.x > 0 ? 'L' : 'R', sign = side === 'L' ? 1 : -1;
    const region = part === 'head' ? 'head' : /^(upperArm|forearm|hand)/.test(part) ? 'arm' : /^(thigh|shin|foot|Knee|Shin)/.test(part) ? 'leg' : part === 'pelvis' ? 'pelvis' : 'torso';
    // The whole body answers a little; the struck part answers most.
    r.vpitch += push.z * (region === 'torso' ? 4 : 1.5) * force;
    r.vroll += -push.x * (region === 'torso' ? 4 : 1.5) * force;
    r.vyaw += (at.x > 0 ? 1 : -1) * push.z * (region === 'torso' ? 5 : 2) * force + (random() - 0.5) * 2 * force;
    r.vhead += (random() - 0.3) * 3 * force;
    switch (region) {
      case 'head':
        // The head snaps along the blow.
        r.vhead += push.z * 9 * force;
        r.vheadYaw += push.x * 9 * force;
        r.vheadRoll += -push.x * 6 * force;
        break;
      case 'arm':
        // That arm is flung along the blade and lets go of the rifle.
        r[`varm${side}`] -= push.z * 9 * force + 2 * force;
        r[`vflare${side}`] += push.x * 7 * force;
        r.vyaw += sign * push.z * 3 * force;
        if (force > 0.3 && !r.wound) r.letGo[side] = Math.max(r.letGo[side], 0.6 + random() * 0.6);
        break;
      case 'leg':
        // That leg gives: the hip drops on that side.
        r[`vdip${side}`] += 3.5 * force;
        r.vbuckle += force;
        break;
      case 'pelvis':
        // Doubled over.
        r.vbuckle += 3.5 * force;
        r.vpitch += 2.5 * force;
        break;
      default:
        r.vbuckle += 2.5 * force;
    }
    if (region !== 'arm') {
      r.varmL += (random() - 0.5) * 6 * force;
      r.varmR += (random() - 0.5) * 6 * force;
    }
    r.push.addScaledVector(world(push), 0.22 * force * (region === 'arm' ? 0.4 : region === 'head' ? 0.6 : 1));
    r.imbalance += (region === 'leg' ? 0.3 : 0.2) * force;
    // Too many blows: his legs go and he falls, still alive.
    if (r.imbalance > 1) fall('imbalance', velocity);
  }

  /** A hand goes to a fresh burn on his front, if one is free to. */
  function pressWound(point) {
    const r = reaction;
    trooper.root.updateMatrixWorld(true);
    const at = joints.spine.worldToLocal(point.clone());
    if (at.z < -0.03 || r.wound) return;
    let hand = at.x > 0 ? 'L' : 'R';
    if (armCut(hand)) hand = hand === 'L' ? 'R' : 'L';
    if (armCut(hand)) return;
    Object.assign(r, { press: { age: 0, duration: 1.8 + random() * 1.2 }, pressAt: at, pressHand: hand });
  }

  /** From standing to the floor; the impulses depend on the cause. Alive, he will crawl. */
  function fall(cause, velocity = new THREE.Vector3(), cutChild = null) {
    if (trooper.fallen) return;
    trooper.fallen = true;
    collapse = null;
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
    const buckle = forward.clone().multiplyScalar(0.5 + random() * 0.45);
    const topple = 0.35 + random() * 0.6;
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
    const twist = forward.clone().cross(UP).multiplyScalar((random() - 0.5) * 2.2);
    ragdoll.push([particleIndex.SL], twist);
    ragdoll.push([particleIndex.SR], twist.clone().negate());
    if (!trooper.dead) {
      // Alive on the floor: a moment of agony, then he tries to crawl.
      crawl = { age: 0, stage: 'down', effort: 0, stamina: 9 + random() * 5, origin: new THREE.Vector3(), heading: 0, roll: 0, turn: 0, stroke: null, plant: {}, hand: {}, pause: 0, strain: 0, lean: 0, look: 0, slump: 1, kick: { L: 0, R: 0 } };
      crawl.staminaTotal = crawl.stamina;
      spasm = { left: 1.2, total: 1.2, amplitude: 0.6, next: 0.1 };
    }
    trooper.events.push({ type: 'fall', cause });
  }

  /**
   * Death. A beheaded body stays up for a heartbeat before it collapses, and
   * twitches for a few seconds on the floor; other deaths shudder briefly.
   */
  function die(cause, velocity = new THREE.Vector3(), cutChild = null, { delay = 0 } = {}) {
    if (trooper.dead) return;
    trooper.dead = true;
    crawl = null;
    muscles = [];
    const headless = cause === 'neck', spent = cause === 'exhaustion';
    spasm = { left: headless ? 3.8 : spent ? 1.2 : 1.6, amplitude: headless ? 2.2 : spent ? 0.5 : 1.1, next: headless ? 0.3 : 0.15 };
    spasm.total = spasm.left;
    if (trooper.fallen) return;
    if (trooper.holding) dropBlaster(velocity);
    if (delay > 0) {
      collapse = { at: clock + delay, cause, velocity: velocity.clone(), cutChild };
      // The arms jerk up as the body loses its head.
      reaction.varmL -= 3 + random() * 3;
      reaction.varmR -= 3 + random() * 3;
      reaction.vbuckle += 1.5;
    } else fall(cause, velocity, cutChild);
  }

  /** On the floor and alive: a hit makes him writhe and stop crawling for a moment. */
  function suffer(strength) {
    if (!crawl) return;
    crawl.pause = Math.max(crawl.pause, 0.5 + random() * 0.5);
    crawl.stamina -= 1.5 * strength;
    crawl.effort *= 0.5;
    if (!spasm || spasm.left < 0.6) spasm = { left: 0.7, total: 0.7, amplitude: 0.8 * strength, next: 0 };
  }
  /** A struck body on the floor is jolted along the blade, and its nerves still twitch. */
  function jolt(body, hit) {
    ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.3).add(temp2.set(0, 0.8, 0)));
    if (trooper.dead && (!spasm || spasm.left < 0.6)) spasm = { left: 0.8, total: 0.8, amplitude: 1, next: 0.03 };
  }

  function cut(name, hit) {
    const definition = CUTS[name];
    if (!definition || trooper.severed.has(name)) return false;
    // Only a cut into the living body is felt; a fallen-off piece is just cut.
    const felt = !trooper.dead && subtree('torso').includes(definition.parent);
    const childBodies = subtree(definition.child);
    trooper.severed.add(name);
    ragdoll.sever(particleIndex[definition.particle], childBodies.map(child => bodies[child]), name);
    for (const { cap, ring } of caps[name]) {
      cap.visible = true;
      effects?.glow(ring.material);
      effects?.smoulder(cap);
    }
    release(childBodies);
    // The severed part is thrown by the blade; the body it leaves stays put.
    // Through the waist it is the upper body that slides off, and the legs
    // give way beneath it.
    if (name === 'waist') {
      const upper = subtree('torso').filter(part => !childBodies.includes(part));
      release(upper);
      ragdoll.push(indicesOf(upper), temp.copy(hit.velocity).clampLength(0, 4).multiplyScalar(0.1).add(temp2.set((random() - 0.5) * 0.2, 0.05 + random() * 0.12, (random() - 0.5) * 0.2)));
      spin(['torso'], 0.6 + random() * 1.4);
    } else trooper.lastThrow = launch(childBodies, hit, ragdoll.particles[particleIndex[definition.particle]].position);
    if (felt) {
      const armLost = childBodies.some(child => /^(upperArm|forearm|hand)/.test(child));
      const legLost = childBodies.some(child => /^(thigh|shin|foot)/.test(child));
      if (armLost) dropBlaster(hit.velocity);
      if (definition.lethal) die(name.replace(/[LR]$/, ''), hit.velocity, childBodies, { delay: name === 'neck' && !trooper.fallen ? 0.3 : 0 });
      else if (trooper.fallen) suffer(1);
      else if (legLost) fall('leg', hit.velocity, childBodies);
      else {
        react(hit.velocity, hit.point, 0.6, definition.child);
        if (armLost) Object.assign(reaction, { wound: { joint: name, side: name.slice(-1) }, woundAge: 0, press: null });
      }
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

  // ---- On the floor: muscles, crawl, death throes -------------------------

  const usable = side => !trooper.severed.has(`shoulder${side}`) && !trooper.severed.has(`elbow${side}`);
  const living = () => subtree('torso');
  function restlessness() {
    let sum = 0, count = 0;
    for (const name of living()) for (const index of bodies[name].indices) { sum += ragdoll.velocity(index, temp).length(); count++; }
    return count ? sum / count : 0;
  }
  /** Reads how he lies: along which line, and how far rolled from face down. */
  function orient() {
    const c = crawl, w = trooper.particle('W').position, n = trooper.particle('N').position;
    const along = new THREE.Vector3().subVectors(n, w).setY(0);
    if (along.lengthSq() < 1e-4) along.set(Math.sin(c.heading), 0, Math.cos(c.heading));
    along.normalize();
    c.heading = Math.atan2(along.x, along.z);
    c.origin.copy(w).addScaledVector(along, -0.12).setY(0);
    const front = new THREE.Vector3().subVectors(trooper.particle('SL').position, trooper.particle('SR').position).cross(temp.subVectors(n, w));
    front.addScaledVector(along, -front.dot(along));
    c.roll = front.lengthSq() > 1e-6 ? Math.atan2(along.dot(temp.crossVectors(DOWN, front.normalize())), DOWN.dot(front)) : 0;
  }
  const frame = c => {
    forward.set(Math.sin(c.heading), 0, Math.cos(c.heading));
    leftward.crossVectors(forward, DOWN);
  };
  /** Where a hand rests or reaches, on the floor ahead of its shoulder. */
  const ahead = (c, side, distance, spread) => {
    const sign = side === 'L' ? 1 : -1;
    return c.origin.clone().addScaledVector(forward, 0.4 + distance).addScaledVector(leftward, sign * (0.2 + spread)).setY(0.07);
  };

  /** Advances the crawl: lying in agony, rolling onto his front, pulling himself along, giving out. */
  function crawlStep(dt, time) {
    const c = crawl;
    c.age += dt;
    const arms = ['L', 'R'].filter(usable);
    const tired = 1 - THREE.MathUtils.clamp(c.stamina / c.staminaTotal, 0, 1);
    let effort = 0;
    if (c.stage === 'down') {
      if ((c.age > 1 && restlessness() < 0.35) || c.age > 2.2) { orient(); c.stage = 'turn'; c.turn = 0; }
    }
    if (c.stage !== 'down') frame(c);
    if (c.stage === 'turn') {
      // He rolls onto his front and plants his forearms.
      c.turn += dt;
      c.roll *= Math.exp(-2.6 * dt);
      for (const side of ['L', 'R']) c.hand[side] = ahead(c, side, 0.2, -0.1);
      effort = 1;
      c.slump = Math.max(0, c.slump - dt * 1.5);
      if (c.turn > 1.2) { c.stage = 'crawl'; c.roll = 0; for (const side of ['L', 'R']) c.plant[side] = c.hand[side].clone(); }
    } else if (c.stage === 'crawl') {
      effort = c.pause > 0 ? 0.55 : 1;
      c.stamina -= dt;
      if (!arms.length) c.stamina = Math.min(c.stamina, 2.5);
      if (c.pause > 0) c.pause -= dt;
      else if (arms.length) {
        // Alternate strokes: one arm reaches forward, plants, and pulls him up to it.
        if (!c.stroke || !arms.includes(c.stroke.side)) {
          const side = arms.length === 1 ? arms[0] : c.last === 'L' ? 'R' : c.last === 'R' ? 'L' : arms[Math.floor(random() * 2)];
          const slow = (1 + 1.5 * tired * tired) * (arms.length === 1 ? 1.3 : 1) * (0.9 + random() * 0.25);
          c.stroke = {
            side, phase: 'reach', t: 0, done: 0, from: (c.plant[side] ?? ahead(c, side, 0, 0)).clone(), to: ahead(c, side, 0.4, -0.15),
            reach: 0.45 * slow, pull: 0.65 * slow, length: 0.24 * (arms.length === 1 ? 0.75 : 1) * (1 - 0.35 * tired),
            turn: (side === 'L' ? 1 : -1) * 0.05 * (arms.length === 1 ? 1.5 : 1) + (random() - 0.5) * 0.12,
          };
        }
        const s = c.stroke, sign = s.side === 'L' ? 1 : -1;
        s.t += dt;
        if (s.phase === 'reach') {
          const u = Math.min(1, s.t / s.reach);
          c.hand[s.side] = s.from.clone().lerp(s.to, smooth(u)).addScaledVector(UP, 0.11 * Math.sin(Math.PI * u));
          c.strain *= Math.exp(-6 * dt);
          c.look += (sign * 0.25 - c.look) * (1 - Math.exp(-5 * dt));
          if (u >= 1) { s.phase = 'pull'; s.t = 0; c.plant[s.side] = s.to.clone(); }
        } else {
          const u = Math.min(1, s.t / s.pull), e = smooth(u);
          c.origin.addScaledVector(forward, s.length * (e - s.done));
          c.heading += s.turn * (e - s.done);
          s.done = e;
          c.strain = Math.sin(Math.PI * u);
          c.lean = sign * c.strain;
          if (u >= 1) { c.last = s.side; c.stroke = null; }
        }
        for (const side of arms) if (!(c.stroke?.phase === 'reach' && c.stroke.side === side)) c.hand[side] = c.plant[side] ?? ahead(c, side, 0.2, -0.1);
        c.kick.L = c.stroke?.side === 'L' ? c.strain : c.kick.L * Math.exp(-4 * dt);
        c.kick.R = c.stroke?.side === 'R' ? c.strain : c.kick.R * Math.exp(-4 * dt);
      }
      if (c.stamina <= 0) { c.stage = 'spent'; c.spent = 0; }
    } else if (c.stage === 'spent') {
      // He gives out: the head sinks, the arms go slack, a last breath.
      c.spent += dt;
      effort = 1 - smooth(Math.min(1, c.spent / 2.2));
      c.slump = Math.min(1, c.spent / 1.6);
      c.strain *= Math.exp(-3 * dt);
      if (c.spent > 2.6) { die('exhaustion'); return; }
    }
    c.effort += (effort - c.effort) * (1 - Math.exp(-3 * dt));
    if (c.stage !== 'down') {
      poseCrawl(time);
      aimMuscles(dt);
    }
  }

  /** The crawl pose on the skeleton: prone, chest up on the elbows, legs dragging. */
  function poseCrawl(time) {
    const c = crawl, root = trooper.root;
    basis.makeBasis(leftward, forward, DOWN);
    quaternion.setFromRotationMatrix(basis);
    roll.setFromAxisAngle(forward, c.roll);
    root.quaternion.copy(roll).multiply(quaternion);
    root.position.copy(c.origin).setY(0.11 + 0.12 * Math.abs(Math.sin(c.roll)));
    for (const joint of Object.values(joints)) if (joint !== holder) joint.rotation.set(0, 0, 0);
    const up = 1 - c.slump, pant = Math.sin(time * 3.6) * 0.03 * up;
    joints.pelvis.position.set(0, 0, 0);
    joints.pelvis.rotation.set(0.05, c.lean * 0.1, c.lean * 0.08);
    joints.spine.rotation.set((-0.2 - c.strain * 0.14) * up + pant, c.lean * 0.12, -c.lean * 0.16);
    joints.neck.rotation.set((-0.7 - c.strain * 0.15) * up + 0.15 * c.slump, c.look * up, 0);
    for (const [side, sign] of SIDES) {
      joints[`shoulder${side}`].rotation.set(-0.3, 0, sign * 0.5);
      joints[`elbow${side}`].rotation.set(-0.8, 0, 0);
      // The legs drag flat; the one on the pulling side sweeps out a little.
      const push = trooper.severed.has(`hip${side}`) ? 0 : c.kick[side];
      joints[`hip${side}`].rotation.set(0.04, 0, sign * (0.08 + push * 0.3));
      joints[`knee${side}`].rotation.set(0.06 + push * 0.12, 0, 0);
      joints[`ankle${side}`].rotation.set(1.1, 0, 0);
    }
    root.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      if (!usable(side) || !c.hand[side]) continue;
      const sign = side === 'L' ? 1 : -1;
      const shoulder = joints[`shoulder${side}`].getWorldPosition(new THREE.Vector3());
      const pole = shoulder.addScaledVector(leftward, sign * 0.45).addScaledVector(UP, 0.25).addScaledVector(forward, -0.1);
      reach(side, c.hand[side], pole, 1);
    }
  }

  /** Muscle targets for every particle of his body: the crawl pose, frame to frame. */
  function aimMuscles(dt) {
    muscles = [];
    const seen = new Set();
    for (const name of living()) {
      for (const index of bodies[name].indices) {
        const spec = particleSpec[index];
        if (seen.has(index) || !spec) continue;
        seen.add(index);
        const [particleName, joint, offset] = spec;
        let muscle = muscleState.get(index);
        if (!muscle) {
          muscle = { index, weight: MUSCLE[particleName] ?? 0.5, from: new THREE.Vector3(), to: joints[joint].localToWorld(new THREE.Vector3(...offset)) };
          muscle.from.copy(muscle.to);
          muscleState.set(index, muscle);
        } else {
          muscle.from.copy(muscle.to);
          joints[joint].localToWorld(muscle.to.fromArray(offset));
        }
        muscles.push(muscle);
      }
    }
    driveClock = 0;
    driveSpan = Math.max(dt, 1e-4);
  }

  /**
   * Runs inside every physics step: muscles bear his weight and blend each
   * particle's position and velocity towards its target (no springy
   * overshoot), and twitches add short pulses of velocity.
   */
  function drive(h) {
    const effort = crawl && !trooper.dead ? crawl.effort : 0;
    if (effort > 0.01 && muscles.length) {
      driveClock += h;
      const f = Math.min(1, driveClock / driveSpan);
      const weight = ragdoll.gravity * h * h * effort;
      for (const muscle of muscles) {
        const particle = ragdoll.particles[muscle.index];
        if (particle.kinematic) continue;
        const k = Math.min(0.4, muscle.weight * 0.035 * effort);
        // Limply held parts (the dragging legs) keep most of their weight.
        particle.position.y -= weight * Math.min(1, muscle.weight);
        goal.lerpVectors(muscle.from, muscle.to, f);
        stride.subVectors(muscle.to, muscle.from).multiplyScalar(h / driveSpan);
        motion.subVectors(particle.position, particle.previous).lerp(stride, Math.min(1, k * 6));
        particle.position.lerp(goal, k);
        particle.previous.subVectors(particle.position, motion);
      }
    }
    for (const twitch of twitches) {
      if (twitch.t >= twitch.duration) continue;
      twitch.t += h;
      const weight = Math.PI / 2 * Math.sin(Math.PI * Math.min(1, twitch.t / twitch.duration));
      ragdoll.push(twitch.indices, kick.copy(twitch.direction).multiplyScalar(twitch.dv * weight * h / twitch.duration), h);
    }
  }

  function twitch(indices, direction, dv, duration) {
    twitches.push({ indices: [...indices], direction: direction.clone().normalize(), dv, duration, t: 0 });
  }
  /** Spasms: limbs still joined to the body jerk at random, fading out. */
  function convulse(dt) {
    if (!spasm) return;
    spasm.left -= dt;
    spasm.next -= dt;
    if (spasm.left <= 0) { spasm = null; return; }
    if (spasm.next > 0) return;
    const life = spasm.left / spasm.total;
    spasm.next = (0.04 + random() * 0.14) * (1 + (1 - life) * 2);
    const joined = new Set([...subtree('torso'), ...subtree('pelvis')]);
    const limbs = [...joined].filter(name => /^(upperArm|forearm|hand|thigh|shin|foot)/.test(name));
    if (!limbs.length) return;
    const body = bodies[limbs[Math.floor(random() * limbs.length)]];
    const strength = spasm.amplitude * Math.pow(life, 0.9) * (0.5 + random());
    // Jerks, quicker than gravity and the floor's grip can smother.
    twitch(body.indices.slice(1), temp.set(random() - 0.5, 0.5 + random() * 0.5, random() - 0.5), strength, 0.03 + random() * 0.03);
    // Early on the trunk heaves as well.
    if (random() < 0.3 * life && joined.has('torso')) twitch([particleIndex.W, particleIndex.N], temp.set(random() - 0.5, 1, random() - 0.5), strength * 0.5, 0.05);
  }

  function update(dt, time) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    tweens.update(dt);
    if (!trooper.fallen) {
      pose(time, dt);
      placeParticles(dt);
      if (collapse && clock >= collapse.at) { const { cause, velocity, cutChild } = collapse; fall(cause, velocity, cutChild); }
    } else {
      if (crawl && !trooper.dead && dt > 0) crawlStep(dt, time);
      convulse(dt);
    }
    if (dt > 0) ragdoll.step(dt);
    twitches = twitches.filter(entry => entry.t < entry.duration);
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
   * applies cuts, scorches, armour hits and reactions. Returns the events.
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
    const name = body.name, side = name.slice(-1);
    const wasDead = trooper.dead, wasStanding = !trooper.fallen && !trooper.dead;
    const alive = !trooper.dead, standing = !trooper.fallen;
    if (speed < CUT_SPEED) {
      effects?.sparks(hit.point, sparkDirection, hit.normal, { count: speed < 0.6 ? 6 : 18, speed: 1.5 + speed });
      if (speed > 0.6) flashPart(body, 0.35);
      if (speed > 0.6) {
        if (alive && standing) react(hit.velocity, hit.point, 0.35, name);
        else if (alive) suffer(0.4);
        else if (speed > 1.2) jolt(body, hit);
      }
      if (/^shin/.test(name) && speed > 1.2) {
        if (knockOff(pieces[`kneePad${side}`], hit.velocity) || knockOff(pieces[`shinPlate${side}`], hit.velocity)) event.type = 'armor';
      }
      trooper.events.push(event);
      return;
    }
    let joint = null;
    if (name === 'head') joint = 'neck';
    else if (name === 'torso') joint = hit.s > 0.78 ? 'neck' : hit.s < 0.32 && horizontal ? 'waist' : null;
    else if (name === 'pelvis') joint = horizontal ? 'waist' : hit.s < 0.5 ? 'hipL' : 'hipR';
    else if (/^upperArm/.test(name)) joint = hit.s < 0.42 ? `shoulder${side}` : `elbow${side}`;
    else if (/^forearm/.test(name)) joint = hit.s < 0.45 ? `elbow${side}` : `wrist${side}`;
    else if (/^hand/.test(name)) joint = `wrist${side}`;
    else if (/^thigh/.test(name)) joint = hit.s < 0.35 ? `hip${side}` : `knee${side}`;
    else if (/^shin/.test(name)) joint = hit.s < 0.45 ? `knee${side}` : `ankle${side}`;
    else if (/^foot/.test(name)) joint = `ankle${side}`;
    // The faster the blade, the bigger the spray.
    effects?.sparks(hit.point, sparkDirection, hit.normal, { count: Math.round(THREE.MathUtils.clamp(30 + speed * 6, 40, 95)), speed: 2 + Math.min(speed, 8) * 0.5 });
    effects?.flash(hit.point, Math.min(1.2, speed / 5));
    flashPart(body, 1);
    if (name === 'blaster') {
      event.type = 'disarm';
      if (trooper.holding) dropBlaster(hit.velocity);
      else ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.3));
    } else if (joint && cut(joint, hit)) {
      event.type = 'cut';
      event.joint = joint;
      flashPart(bodies[CUTS[joint].child], 1);
      effects?.burst(hit.point, { normal: hit.normal, power: 0.5 + speed / 10 });
      if (trooper.fallen) ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.1));
    } else if (name === 'torso' || name === 'pelvis') {
      event.type = 'slash';
      scorch(body, hit);
      effects?.burst(hit.point, { normal: hit.normal, power: 0.3 });
      if (alive && standing) {
        if (speed > SLASH_LETHAL_SPEED) die('slash', hit.velocity);
        else { react(hit.velocity, hit.point, 1.2, name); pressWound(hit.point); }
      } else if (alive) die('slash');
      if (trooper.fallen) jolt(body, hit);
    } else if (alive && standing) react(hit.velocity, hit.point, 0.8, name);
    else if (alive) { suffer(0.7); jolt(body, hit); }
    else jolt(body, hit);
    if (!wasDead && trooper.dead) event.lethal = true;
    if (wasStanding && trooper.fallen) event.felled = true;
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
    tweens.clear();
    dispose();
    build();
  }
  /** Where the standing trooper blocks the hero (null once he is down). */
  function blocker() {
    if (trooper.fallen) return null;
    const at = joints.pelvis.getWorldPosition(new THREE.Vector3());
    return { x: at.x, z: at.z, radius: 0.32 };
  }

  trooper.particle = name => ragdoll.particles[particleIndex[name]];
  build();
  Object.assign(trooper, { update, strike, reset, dispose, blocker, cut, die, fall });
  Object.defineProperties(trooper, {
    reaction: { get: () => reaction },
    crawl: { get: () => crawl },
    spasm: { get: () => spasm },
    /** 'standing', 'wounded', 'down' (fallen, alive), 'crawling' or 'dead'. */
    state: { get: () => (trooper.dead ? 'dead' : !trooper.fallen ? (reaction.wound ? 'wounded' : 'standing') : crawl?.stage === 'crawl' ? 'crawling' : 'down') },
  });
  return trooper;
}
