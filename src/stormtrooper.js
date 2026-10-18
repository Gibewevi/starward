import * as THREE from 'three';
import { Ragdoll } from './ragdoll.js';
import { aimBone, solveTwoBone } from './ik.js';
import { approach, createTweens, ease } from './tween.js';
import { FEEL, curve, pick } from './feel.js';
import { createGait, GAIT_JOINTS } from './trooper-gait.js';

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
 * Every hit flashes the struck armour white for an instant, and his armour
 * comes apart progressively: helmet, plates, pauldrons and guards come off
 * under the blade and in hard landings, and fly as physical pieces.
 *
 * Blows move him: each one shoves him back along the blade and turns him
 * away from it, and a felled body carries the blow's momentum and slides.
 *
 * The Force moves him. A push throws him off his feet — it never kills — to
 * tumble, bounce, roll and slide; a pull drags him in, explosive at first and
 * slowing on arrival. Caught by it, he drops his rifle and clutches at his
 * throat, choking, head thrown back, his chest and hips twisting as he fights
 * it, legs kicking. Held, he hangs in the air before the hero, following
 * him; let go, he drops onto his feet and runs away. Down but alive, a pull
 * hauls him upright first, then brings him in.
 *
 * Alive, he never goes limp: thrown, his muscles keep working — arms out to
 * break the fall, chin tucked, knees drawn — and once down he curls up and
 * squirms before getting back up. Only the dead are rag dolls. Knocked down unhurt, he lies stunned, gets up (muscles
 * drive the ragdoll into a crouch, then upright), sways, and fetches his
 * rifle if it lies close by.
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
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), X_AXIS = new THREE.Vector3(1, 0, 0), ORIGIN = new THREE.Vector3();
// The rifle at low ready across the belly; shouldered, its stock against the right shoulder.
const LOW_READY = { position: new THREE.Vector3(-0.02, 0.1, 0.24), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.4, 0, 'YXZ')) };
const SHOULDERED = new THREE.Vector3(-0.125, 0.27, 0.23);
// Throwing a grenade, the left hand's path in the spine's frame: from the
// rifle's foregrip, wound up behind the shoulder, swung over the top, released
// in front, following through across the body.
const THROW = { grip: new THREE.Vector3(0.05, 0.12, 0.3), wind: new THREE.Vector3(0.2, 0.56, -0.2), release: new THREE.Vector3(0.11, 0.6, 0.3), follow: new THREE.Vector3(-0.03, 0.06, 0.34) };
// The muzzle, in the rifle's frame.
const MUZZLE = new THREE.Vector3(0, 0.012, 0.37);
// The soles in the ankle's frame: heel and toe.
const SOLES = [new THREE.Vector3(0, -0.1, -0.05), new THREE.Vector3(0, -0.1, 0.16)];
// Walking and running paces (m/s) and how fast he gets going, slows and turns.
export const PACE = { walk: 1.35, run: 3.7, accelerate: 5.5, brake: 9, turn: 5.5 };
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
// Floor behaviour of loose pieces: hard and light, they clatter and skid.
const LOOSE = { bounce: 0.38, friction: 0.05 };

const materials = {
  armor: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, roughness: 0.55, metalness: 0 }),
  shade: new THREE.MeshStandardMaterial({ color: 0x6d727b, roughness: 0.6, metalness: 0.05 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8, metalness: 0 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.18, metalness: 0.1 }),
};

// Joint hierarchy in the rest pose: name, parent, offset (metres).
// A compact, sturdy build: short thick legs, broad hips and shoulders.
const JOINTS = [
  ['pelvis', null, [0, 0.78, 0]],
  ['spine', 'pelvis', [0, 0.13, 0]],
  ['neck', 'spine', [0, 0.35, -0.01]],
  ['shoulderL', 'spine', [0.235, 0.27, -0.01]],
  ['elbowL', 'shoulderL', [0.01, -0.255, 0]],
  ['wristL', 'elbowL', [0, -0.23, 0.01]],
  ['shoulderR', 'spine', [-0.235, 0.27, -0.01]],
  ['elbowR', 'shoulderR', [-0.01, -0.255, 0]],
  ['wristR', 'elbowR', [0, -0.23, 0.01]],
  ['hipL', 'pelvis', [0.115, -0.06, 0]],
  ['kneeL', 'hipL', [0, -0.325, 0.01]],
  ['ankleL', 'kneeL', [0, -0.305, -0.01]],
  ['hipR', 'pelvis', [-0.115, -0.06, 0]],
  ['kneeR', 'hipR', [0, -0.325, 0.01]],
  ['ankleR', 'kneeR', [0, -0.305, -0.01]],
];
// Hip to ankle.
const LEG = 0.325 + 0.305;

// Ragdoll particles: name, joint, local position, radius, mass.
const PARTICLES = [
  ['N', 'neck', [0, 0, 0], 0.065, 1], ['HT', 'neck', [0, 0.31, 0], 0.14, 1.5], ['HF', 'neck', [0, 0.16, 0.14], 0.11, 1],
  ['W', 'spine', [0, 0, 0], 0.14, 3],
  ['HL', 'hipL', [0, 0, 0], 0.11, 2], ['HR', 'hipR', [0, 0, 0], 0.11, 2],
  ['B0', 'holder', [0, 0, -0.13], 0.035, 0.6], ['B1', 'holder', [0, 0, 0.33], 0.03, 0.6], ['B2', 'holder', [0, 0.07, 0.05], 0.03, 0.4],
];
for (const [side, sign] of SIDES) {
  PARTICLES.push(
    [`S${side}`, `shoulder${side}`, [0, 0, 0], 0.09, 2],
    [`E${side}`, `elbow${side}`, [0, 0, 0], 0.062, 1], [`UA${side}`, `shoulder${side}`, [0, -0.125, 0.075], 0.058, 0.5],
    [`W${side}`, `wrist${side}`, [0, 0, 0], 0.055, 0.8], [`FA${side}`, `elbow${side}`, [0, -0.115, 0.07], 0.056, 0.5],
    [`HT${side}`, `wrist${side}`, [0, -0.1, 0], 0.045, 0.3], [`HP${side}`, `wrist${side}`, [sign * 0.01, -0.05, 0.055], 0.04, 0.3],
    [`K${side}`, `knee${side}`, [0, 0, 0], 0.075, 1.5], [`TH${side}`, `hip${side}`, [0, -0.16, 0.1], 0.08, 0.8],
    [`SH${side}`, `knee${side}`, [0, -0.15, 0.07], 0.06, 0.5],
    [`A${side}`, `ankle${side}`, [0, 0, 0], 0.065, 1], [`T${side}`, `ankle${side}`, [0, -0.055, 0.16], 0.04, 0.6], [`HE${side}`, `ankle${side}`, [0, -0.06, -0.05], 0.045, 0.4],
  );
}
// Bodies: name (= part), particles (the first three define its frame), capsule.
const BODIES = [
  // The head's capsule runs from the face to the crown: the big helmet, not the throat below it.
  ['head', ['N', 'HT', 'HF'], ['HF', 'HT', 0.15]],
  ['torso', ['W', 'N', 'SL', 'SR'], ['W', 'N', 0.18]],
  ['pelvis', ['W', 'HL', 'HR'], ['HL', 'HR', 0.16]],
  ['blaster', ['B0', 'B1', 'B2'], ['B0', 'B1', 0.045]],
];
for (const side of ['L', 'R']) {
  BODIES.push(
    [`upperArm${side}`, [`S${side}`, `E${side}`, `UA${side}`], [`S${side}`, `E${side}`, 0.08]],
    [`forearm${side}`, [`E${side}`, `W${side}`, `FA${side}`], [`E${side}`, `W${side}`, 0.072]],
    [`hand${side}`, [`W${side}`, `HT${side}`, `HP${side}`], [`W${side}`, `HT${side}`, 0.055]],
    [`thigh${side}`, [`H${side}`, `K${side}`, `TH${side}`], [`H${side}`, `K${side}`, 0.1]],
    [`shin${side}`, [`K${side}`, `A${side}`, `SH${side}`], [`K${side}`, `A${side}`, 0.085]],
    [`foot${side}`, [`A${side}`, `T${side}`, `HE${side}`], [`HE${side}`, `T${side}`, 0.07]],
  );
}
// Predefined separations: the shared particle, which side comes away, cap size
// and facing. Lethal ones kill; a lost leg fells him alive.
const CUTS = {
  neck: { particle: 'N', parent: 'torso', child: 'head', lethal: true, radius: 0.065, normal: [0, 1, 0] },
  waist: { particle: 'W', parent: 'torso', child: 'pelvis', lethal: true, radius: 0.15, normal: [0, -1, 0] },
};
for (const [side, sign] of SIDES) {
  Object.assign(CUTS, {
    [`shoulder${side}`]: { particle: `S${side}`, parent: 'torso', child: `upperArm${side}`, radius: 0.075, normal: [sign, 0, 0] },
    [`elbow${side}`]: { particle: `E${side}`, parent: `upperArm${side}`, child: `forearm${side}`, radius: 0.058, normal: [0, -1, 0] },
    [`wrist${side}`]: { particle: `W${side}`, parent: `forearm${side}`, child: `hand${side}`, radius: 0.048, normal: [0, -1, 0] },
    [`hip${side}`]: { particle: `H${side}`, parent: 'pelvis', child: `thigh${side}`, radius: 0.088, normal: [0, -1, 0] },
    [`knee${side}`]: { particle: `K${side}`, parent: `thigh${side}`, child: `shin${side}`, radius: 0.07, normal: [0, -1, 0] },
    [`ankle${side}`]: { particle: `A${side}`, parent: `shin${side}`, child: `foot${side}`, radius: 0.058, normal: [0, -1, 0] },
  });
}
// How hard the muscles hold each particle to the crawl: hands firmly, the
// trunk steadily, the legs barely — they drag.
const MUSCLE = { W: 1, N: 1.2, SL: 1, SR: 1, HT: 1.2, HF: 1.2, HL: 0.7, HR: 0.7 };
// Reflexes in flight and on the floor: the trunk is left to physics, the
// limbs and head are held in a live pose relative to it.
const REFLEX = { W: 0, N: 0, SL: 0, SR: 0, HT: 0.7, HF: 0.7, HL: 0.5, HR: 0.5 };
for (const side of ['L', 'R']) {
  Object.assign(REFLEX, {
    [`S${side}`]: 0, [`UA${side}`]: 1.2, [`E${side}`]: 1.4, [`FA${side}`]: 1.4, [`W${side}`]: 1.6, [`HT${side}`]: 1.4, [`HP${side}`]: 1.4,
    [`TH${side}`]: 0.9, [`K${side}`]: 1.1, [`SH${side}`]: 1, [`A${side}`]: 1.1, [`T${side}`]: 0.8, [`HE${side}`]: 0.8,
  });
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
  // A detachable piece of armour: a group of meshes that can come off whole.
  const plate = (owner, name) => {
    const group = Object.assign(new THREE.Group(), { name });
    group.userData.armour = true;
    owner.add(group);
    pieces[name] = group;
    return group;
  };
  const lathe = (profile, segments, start, length) => new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments, start, length);

  // Helmet: broad and massive, a dome that flares out over the neck at the
  // back and sides; a brow ridge; big black lenses slanting down and out; a
  // nose ridge; a frowning grille between cheek "tears"; breathers under it;
  // round ear caps with side vents.
  const head = part('head');
  add(head, cylinder(0.062, 0.068, 0.1), black, [0, 0.03, 0]);
  // Under the helmet, a black balaclava.
  add(head, new THREE.SphereGeometry(0.125, 8, 6), black, [0, 0.19, 0.01]);
  const helmet = plate(head, 'helmet');
  add(helmet, lathe([[0.142, 0.055], [0.167, 0.085], [0.177, 0.14], [0.178, 0.2], [0.168, 0.258], [0.138, 0.303], [0.088, 0.333], [0.001, 0.342]], 12), armor).scale.set(1, 1, 1.06);
  add(helmet, lathe([[0.128, 0.03], [0.186, 0.045], [0.18, 0.1]], 12, Math.PI * 0.33, Math.PI * 1.34), armor);
  // The face: cheeks and jaw stand proud of the dome, narrowing to the chin.
  add(helmet, frustum(0.22, 0.15, 0.09, 0.07, 0.13), armor, [0, 0.115, 0.122], [0.14, 0, 0]);
  // The brow ridge follows the dome round: a centre and two swept-back wings.
  add(helmet, new THREE.BoxGeometry(0.11, 0.032, 0.04), armor, [0, 0.25, 0.168]);
  add(helmet, new THREE.BoxGeometry(0.1, 0.012, 0.012), shade, [0, 0.262, 0.189]);
  for (const sign of [-1, 1]) {
    add(helmet, new THREE.BoxGeometry(0.075, 0.03, 0.036), armor, [sign * 0.088, 0.248, 0.146], [0, sign * 0.55, 0]);
    add(helmet, new THREE.BoxGeometry(0.07, 0.011, 0.011), shade, [sign * 0.094, 0.26, 0.163], [0, sign * 0.55, 0]);
  }
  add(helmet, new THREE.BoxGeometry(0.034, 0.075, 0.03), armor, [0, 0.168, 0.19]);
  // Mouth: a frown — the grille widens towards the bottom — with its teeth.
  add(helmet, frustum(0.07, 0.11, 0.03, 0.03, 0.046), black, [0, 0.1, 0.17], [0.14, 0, 0]);
  for (let i = -1.5; i <= 1.5; i++) add(helmet, new THREE.BoxGeometry(0.008, 0.036, 0.012), shade, [i * 0.021, 0.099, 0.186], [0.14, 0, 0]);
  for (const sign of [-1, 1]) {
    // A big lens, slanting down towards the outside, set into the curve of the dome.
    add(helmet, new THREE.BoxGeometry(0.082, 0.058, 0.03), lens, [sign * 0.058, 0.2, 0.177], [0.08, sign * 0.38, -sign * 0.32]);
    add(helmet, new THREE.BoxGeometry(0.018, 0.06, 0.012), shade, [sign * 0.09, 0.13, 0.168], [0.1, sign * 0.5, -sign * 0.3]);
    add(helmet, cylinder(0.013, 0.013, 0.045, 6), shade, [sign * 0.062, 0.08, 0.16], [0.6, 0, 0]);
    add(helmet, cylinder(0.044, 0.044, 0.026, 10), armor, [sign * 0.178, 0.168, -0.005], [0, 0, Math.PI / 2]);
    add(helmet, cylinder(0.024, 0.024, 0.03, 8), shade, [sign * 0.181, 0.168, -0.005], [0, 0, Math.PI / 2]);
    add(helmet, new THREE.BoxGeometry(0.012, 0.05, 0.05), black, [sign * 0.17, 0.11, 0.085], [0, sign * 0.45, 0]);
  }
  add(helmet, new THREE.BoxGeometry(0.2, 0.02, 0.02), shade, [0, 0.13, -0.19]);

  // Torso: a broad chest plate over the black suit, sloping up to the collar;
  // a ribbed belly plate; the back plate and its pack.
  const torso = part('torso');
  add(torso, frustum(0.36, 0.3, 0.24, 0.21, 0.37), black, [0, 0.165, 0]);
  const chest = plate(torso, 'chestPlate');
  add(chest, frustum(0.5, 0.4, 0.29, 0.25, 0.19), armor, [0, 0.255, 0.012]);
  add(chest, frustum(0.3, 0.46, 0.2, 0.27, 0.045), armor, [0, 0.37, 0.004]);
  for (const sign of [-1, 1]) add(chest, new THREE.BoxGeometry(0.07, 0.04, 0.012), shade, [sign * 0.088, 0.29, 0.155]);
  add(chest, new THREE.BoxGeometry(0.03, 0.09, 0.012), shade, [0, 0.235, 0.15]);
  const belly = plate(torso, 'abPlate');
  add(belly, frustum(0.34, 0.31, 0.24, 0.22, 0.11), armor, [0, 0.095, 0.012]);
  for (const y of [0.075, 0.112]) add(belly, new THREE.BoxGeometry(0.25, 0.012, 0.012), shade, [0, y, 0.13]);
  const back = plate(torso, 'backPlate');
  add(back, new THREE.BoxGeometry(0.38, 0.22, 0.035), armor, [0, 0.25, -0.135]);
  add(back, new THREE.BoxGeometry(0.2, 0.12, 0.05), shade, [0, 0.24, -0.165]);
  add(torso, cylinder(0.088, 0.098, 0.05, 10), black, [0, 0.35, -0.01]);

  const pelvis = part('pelvis');
  add(pelvis, frustum(0.33, 0.28, 0.22, 0.2, 0.2), black, [0, 0.02, 0]);
  const belt = plate(pelvis, 'belt');
  add(belt, new THREE.BoxGeometry(0.4, 0.07, 0.27), armor, [0, 0.085, 0]);
  add(belt, new THREE.BoxGeometry(0.11, 0.05, 0.012), shade, [0, 0.085, 0.137]);
  for (const sign of [-1, 1]) {
    add(belt, new THREE.BoxGeometry(0.055, 0.055, 0.035), armor, [sign * 0.14, 0.085, 0.13]);
    add(belt, new THREE.BoxGeometry(0.035, 0.055, 0.06), armor, [sign * 0.2, 0.085, 0.02]);
  }
  add(plate(pelvis, 'codPlate'), frustum(0.2, 0.1, 0.055, 0.045, 0.12), armor, [0, -0.015, 0.11]);
  add(plate(pelvis, 'rearPlate'), frustum(0.27, 0.2, 0.055, 0.045, 0.13), armor, [0, -0.005, -0.11]);

  // Limbs: thick, armoured, with the black suit showing at the joints.
  for (const [side, sign] of SIDES) {
    const upperArm = part(`upperArm${side}`);
    add(plate(upperArm, `pauldron${side}`), new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), armor, [sign * 0.012, -0.002, 0]).scale.set(0.102, 0.078, 0.108);
    add(upperArm, cylinder(0.058, 0.056, 0.255), black, [0, -0.128, 0]);
    add(plate(upperArm, `bicep${side}`), cylinder(0.07, 0.064, 0.15), armor, [0, -0.13, 0]);

    const forearm = part(`forearm${side}`);
    add(forearm, new THREE.SphereGeometry(0.058, 8, 6), black);
    add(plate(forearm, `bracer${side}`), cylinder(0.066, 0.054, 0.16), armor, [0, -0.12, 0]);
    add(forearm, cylinder(0.05, 0.05, 0.04), black, [0, -0.215, 0]);

    const hand = part(`hand${side}`);
    add(hand, new THREE.BoxGeometry(0.072, 0.095, 0.085), black, [0, -0.052, 0.005]);
    add(hand, new THREE.BoxGeometry(0.028, 0.055, 0.028), black, [-sign * 0.036, -0.036, 0.04]);

    const thigh = part(`thigh${side}`);
    add(thigh, cylinder(0.082, 0.076, 0.325), black, [0, -0.162, 0]);
    add(plate(thigh, `thighPlate${side}`), cylinder(0.1, 0.086, 0.23), armor, [0, -0.15, 0.004]);
    if (side === 'R') add(thigh, new THREE.BoxGeometry(0.06, 0.13, 0.07), black, [-0.108, -0.11, 0.01]);

    const shin = part(`shin${side}`);
    add(shin, new THREE.SphereGeometry(0.072, 8, 6), black);
    add(shin, cylinder(0.068, 0.06, 0.305), black, [0, -0.152, 0]);
    add(plate(shin, `kneePad${side}`), frustum(0.105, 0.1, 0.06, 0.06, 0.09), armor, [0, -0.03, 0.065]);
    add(plate(shin, `shinPlate${side}`), cylinder(0.082, 0.068, 0.19), armor, [0, -0.175, 0.006]);

    const foot = part(`foot${side}`);
    add(foot, new THREE.BoxGeometry(0.13, 0.15, 0.25), armor, [0, -0.025, 0.05]);
    add(foot, new THREE.BoxGeometry(0.135, 0.022, 0.255), black, [0, -0.09, 0.05]);
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

export function createStormtrooper({ scene, position = new THREE.Vector3(), heading = 0, effects = null, random = Math.random, lab = null } = {}) {
  const trooper = { root: null, debris: null, dead: false, fallen: false, holding: true, severed: new Set(), events: [] };
  let joints, parts, pieces, holder, ragdoll, particleIndex, particleSpec, bodies, caps, marks, base, feet;
  // Time, a pending collapse, the crawl, death throes, and muscle twitches.
  let clock = 0, collapse = null, crawl = null, spasm = null, twitches = [];
  // Crawl muscles: per particle, where it should be over the current frame.
  let muscles = [], muscleState = new Map(), driveClock = 0, driveSpan = 1 / 60;
  // Knocked down unhurt and getting back up; dragged by the Force; fetching
  // the rifle; a slippery spell on the floor; landings; news for the game.
  let recover = null, towing = null, pickup = null, slick = null, mounts = null, landed = 0;
  // Held up by the Force, dropping back down, running away, turning back.
  let levitating = null, dropping = null, flee = null, turnBack = null;
  // Down but alive and pulled: the Force first hauls him upright.
  let lifting = null;
  // Throwing a grenade (the left hand), and the grenade in that hand.
  let throwing = null, heldGrenade = null;
  // Walking over to his rifle.
  let fetching = null;
  // Motion capture drives his steps; inertia carries his body.
  const loco = { velocity: new THREE.Vector3(), turnRate: 0, hipYaw: 0, backward: false, lean: 0, bank: 0, lastYaw: heading };
  const inverseRoot = new THREE.Matrix4(), rootInverse = new THREE.Quaternion(), aimMatrix = new THREE.Matrix4(), euler = new THREE.Euler(), offsetQuaternion = new THREE.Quaternion();
  const feed = [];
  const reaction = {};
  const tweens = createTweens(), flashes = new Map();
  const seed = random() * 100;
  const gait = createGait({ legLength: LEG, offset: seed * 0.6180339 });
  // Struggle noise: a few unrelated sines, so the movement never repeats or looks mechanical.
  const jitter = (t, a, b, c) => Math.sin(t * a + seed) * 0.5 + Math.sin(t * b + seed * 1.7 + 1.3) * 0.3 + Math.sin(t * c + seed * 2.3 + 2.1) * 0.2;
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
    holder.position.copy(LOW_READY.position);
    holder.rotation.set(0.35, 0.4, 0, 'YXZ');
    joints.spine.add(holder);
    joints.holder = holder;
    ({ parts, pieces } = buildParts());
    heldGrenade = add(parts.handL, new THREE.SphereGeometry(0.062, 8, 6), materials.shade, [0, -0.1, 0.035], [0, 0, 0], 'Grenade in hand');
    heldGrenade.visible = false;
    mounts = { head: 'neck', torso: 'spine', pelvis: 'pelvis', blaster: 'holder' };
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
    ragdoll.boxes = lab?.obstacles ?? [];

    const debris = new THREE.Group();
    debris.name = 'Stormtrooper parts';
    root.position.copy(position);
    root.rotation.set(0, heading, 0);
    scene.add(root, debris);
    Object.assign(trooper, { root, debris, dead: false, fallen: false, holding: true, severed: new Set(), parts, pieces, joints, bodies, ragdoll, caps });
    marks = [];
    collapse = crawl = spasm = recover = towing = pickup = slick = levitating = dropping = flee = turnBack = lifting = fetching = throwing = null;
    feed.length = 0;
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
      kneel: 0, yank: 0, daze: 0, reachFor: null,
      knock: new THREE.Vector3(), spin: 0, run: 0, dangle: 0, stride: 0, choke: 0,
      gait: 1, crouch: 0, aim: 0, attention: 0, recoil: 0, vrecoil: 0,
    });
    Object.assign(reaction.linear, { crouch: 0, aim: 0 });
    // Orders from his brain: how to move, where to face, what to aim at, whether to crouch.
    trooper.order = { velocity: new THREE.Vector3(), face: null, aimAt: null, aim: false, crouch: false, look: null };
    Object.assign(loco, { turnRate: 0, hipYaw: 0, backward: false, lean: 0, bank: 0, lastYaw: heading });
    loco.velocity.set(0, 0, 0);
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
  /** His heading, read from the root whatever its Euler angles say; face() sets it. */
  const headingOf = () => { temp2.set(0, 0, 1).applyQuaternion(trooper.root.quaternion); return Math.atan2(temp2.x, temp2.z); };
  const face = angle => trooper.root.rotation.set(0, angle, 0);
  const turnTo = (angle, rate, dt) => face(headingOf() + wrap(angle - headingOf()) * (1 - Math.exp(-rate * dt)));
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
    // The rifle's kick: sharp, and gone in a moment.
    spring('recoil', 320, 20);
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
      grips[side] = !armCut(side) && !r.wound && r.letGo[side] <= 0 && !(r.press && r.pressHand === side) && !(throwing && side === 'L');
    }
    if (trooper.holding && !grips.L && !grips.R) dropBlaster(new THREE.Vector3());
    glide('holdL', trooper.holding && grips.L ? 1 : 0, 0.25, ease.inOutSine);
    glide('holdR', trooper.holding && grips.R ? 1 : 0, 0.25, ease.inOutSine);
    const toward = r.wound ? (r.wound.side === 'L' ? 1 : -1) : 0;
    const gasp = Math.sin(time * 4.2) * 0.025 * r.hurt, rock = Math.sin(time * 1.3) * 0.035 * r.hurt;
    const pressSide = r.pressHand === 'L' ? 1 : -1;

    // Dazed after getting up: he sways and his head lolls for a moment.
    r.daze = Math.max(0, r.daze - dt);
    const dazed = Math.min(1, r.daze / 0.6), sway = Math.sin(time * 2.6) * 0.1 * dazed, loll = Math.sin(time * 3.1 + 1) * 0.16 * dazed;
    const kneel = r.kneel, yank = r.yank;
    // Held in the air the legs dangle and kick.
    r.dangle += ((levitating ? 1 : 0) - r.dangle) * (1 - Math.exp(-8 * dt));
    const dangle = r.dangle;
    // Choked by the Force while it pulls or holds him: the hands fly to the
    // throat at once and let go slowly. He fights in bursts.
    const choking = Boolean(levitating || towing?.kind === 'stand' || lifting);
    r.choke += ((choking ? 1 : 0) - r.choke) * (1 - Math.exp(-(choking ? 14 : 4) * dt));
    const choke = r.choke, fight = choke * (0.7 + 0.3 * Math.sin(time * 1.9 + seed) * Math.sin(time * 0.83 + seed));
    const writhe = (a, b, c) => jitter(time, a, b, c) * fight;
    const breathe = Math.sin(time * 1.7);
    // His orders: crouched behind cover, the rifle shouldered and aimed, eyes on something.
    const o = trooper.order;
    const able = !towing && !levitating && !dropping && !lifting && !pickup && !fetching && !flee;
    glide('crouch', able && o.crouch && !r.wound ? 1 : 0, 0.3, ease.inOutCubic);
    const aimTarget = o.aimAt;
    glide('aim', able && o.aim && aimTarget && trooper.holding && !r.wound && r.daze < 0.3 ? 1 : 0, o.aim ? 0.24 : 0.4, ease.outCubic);
    const lookAt = o.look ?? (o.aim ? aimTarget : null);
    r.attention = approach(r.attention, lookAt && !choking ? 1 : 0, dt / 0.3);
    const crouch = r.crouch, aim = r.aim, attend = r.attention;
    const look = (Math.sin(time * 0.33) * 0.22 + Math.sin(time * 0.71) * 0.08) * (1 - r.hurt) * (1 - r.pressing * 0.7) * (1 - dazed) * (1 - kneel) * (1 - attend);
    const dip = r.dipL + r.dipR, tilt = r.dipR - r.dipL;

    // Base layer: the captured gait, on his feet (not while he hangs in the
    // Force's grip or is dragged through the air).
    const grounded = !levitating && towing?.kind !== 'stand' && !dropping && !lifting;
    r.gait = approach(r.gait, grounded ? 1 : 0, dt / (grounded ? 0.25 : 0.1));
    const g = r.gait, keep = 1 - g;
    gait.update(dt, { speed: loco.velocity.length() + r.knock.length() * 0.6, backward: loco.backward, turnRate: loco.turnRate });
    gait.twist(loco.hipYaw * g);
    for (const name of GAIT_JOINTS) joints[name].quaternion.identity().slerp(gait.rotations[name], g);
    joints.pelvis.position.copy(base).addScaledVector(gait.hips, g);
    trooper.root.updateWorldMatrix(true, false);
    inverseRoot.copy(trooper.root.matrixWorld).invert();
    rootInverse.copy(trooper.root.quaternion).invert();
    if (g > 0) {
      // Ground pass: the lowest sole meets the floor (the run's flight lifts it).
      let lowest = Infinity;
      for (const side of ['L', 'R']) {
        const ankle = joints[`ankle${side}`];
        ankle.updateWorldMatrix(true, false);
        for (const sole of SOLES) lowest = Math.min(lowest, temp.copy(sole).applyMatrix4(ankle.matrixWorld).applyMatrix4(inverseRoot).y);
      }
      joints.pelvis.position.y += (gait.ground - lowest) * g;
      // Where the steps put his feet: the legs keep them there while the body
      // reacts. Crouched, one foot steps forward and the other well back.
      for (const [side, sign] of SIDES) {
        const ankle = joints[`ankle${side}`];
        ankle.updateWorldMatrix(true, false);
        feet[side].position.setFromMatrixPosition(ankle.matrixWorld).applyMatrix4(inverseRoot);
        feet[side].quaternion.copy(rootInverse).multiply(ankle.getWorldQuaternion(quaternion));
        // At rest he stands square, feet apart; crouched, one foot steps forward and the other well back.
        feet[side].position.x += sign * 0.05 * (1 - gait.state.motion) * (1 - crouch);
        if (crouch > 0) feet[side].position.add(temp.set(sign * 0.04, 0, side === 'L' ? 0.1 : -0.24).multiplyScalar(crouch));
      }
    }
    // Where he aims and looks, from his chest.
    let aimYaw = 0, aimPitch = 0, lookYaw = 0, lookPitch = 0;
    if (aimTarget && aim > 0) {
      trooper.root.worldToLocal(temp.copy(aimTarget));
      aimYaw = THREE.MathUtils.clamp(Math.atan2(temp.x, temp.z), -0.9, 0.9) * aim;
      aimPitch = THREE.MathUtils.clamp(-Math.atan2(temp.y - 1.35, Math.hypot(temp.x, temp.z)), -0.4, 0.5) * aim;
    }
    if (lookAt) {
      trooper.root.worldToLocal(temp.copy(lookAt));
      lookYaw = THREE.MathUtils.clamp(Math.atan2(temp.x, temp.z) - aimYaw, -1.2, 1.2);
      lookPitch = THREE.MathUtils.clamp(-Math.atan2(temp.y - 1.5, Math.hypot(temp.x, temp.z)) - aimPitch, -0.5, 0.6);
    }
    // Throwing: the torso winds up (left shoulder back), whips round as the
    // arm comes over, and follows through; the hand travels its path.
    let throwYaw = 0, throwPitch = 0, throwWeight = 0;
    const throwHand = new THREE.Vector3();
    if (throwing) {
      const p = Math.min(1, throwing.age / throwing.duration);
      if (p < 0.38) {
        const u = ease.inOutCubic(p / 0.38);
        throwHand.lerpVectors(THROW.grip, THROW.wind, u);
        throwYaw = 0.5 * u; throwPitch = -0.12 * u;
      } else if (p < 0.52) {
        const u = ease.inQuad((p - 0.38) / 0.14);
        throwHand.lerpVectors(THROW.wind, THROW.release, u);
        throwYaw = 0.5 - 0.95 * u; throwPitch = -0.12 + 0.36 * u;
      } else {
        const u = ease.outCubic((p - 0.52) / 0.48);
        throwHand.lerpVectors(THROW.release, THROW.follow, u);
        throwYaw = -0.45 * (1 - u); throwPitch = 0.24 * (1 - u);
      }
      throwWeight = p < 0.85 ? Math.min(1, p / 0.08) : Math.max(0, 1 - (p - 0.85) / 0.15);
    }
    heldGrenade.visible = Boolean(throwing && !throwing.released);
    // Reactions on top, in each joint's own frame.
    const off = (joint, x, y, z) => joint.quaternion.multiply(offsetQuaternion.setFromEuler(euler.set(x, y, z)));
    joints.pelvis.position.x += Math.sin(time * 0.5) * 0.008 + r.offset.x;
    joints.pelvis.position.y -= 0.015 * keep + r.buckle * 0.07 + r.hurt * 0.035 + dip * 0.05 + r.limp * 0.15 + kneel * 0.42 + dazed * 0.025 + crouch * 0.38 + 0.02 * g;
    joints.pelvis.position.z += r.offset.z - kneel * 0.05 - crouch * 0.05;
    // Choking, the hips swing and thrust as he fights the grip.
    off(joints.pelvis, r.pitch * 0.3 + yank * 0.15 + crouch * 0.22 + writhe(4.3, 7.1, 2.3) * 0.28, r.yaw * 0.4 + writhe(3.7, 6.3, 1.9) * 0.34, r.roll * 0.4 + tilt * 0.22 + writhe(4.1, 6.9, 2.7) * 0.24);
    off(joints.spine, -0.03 * keep + breathe * 0.012 + r.pitch * 0.7 + r.hurt * 0.26 + gasp + rock + r.pressing * 0.14 + r.limp * 0.45 + kneel * 0.75 + yank * 0.4 + dazed * 0.12 - dangle * 0.1 - choke * 0.14 + writhe(5.1, 8.3, 2.9) * 0.24 + crouch * 0.18 + loco.lean + aimPitch * 0.6 - r.recoil * 0.05 + throwPitch * throwWeight,
      r.yaw * 0.6 + toward * r.hurt * 0.2 + writhe(4.3, 7.7, 2.1) * 0.32 + aimYaw + throwYaw * throwWeight, r.roll * 0.6 + toward * r.hurt * 0.06 - tilt * 0.16 + sway + writhe(4.9, 8.1, 3.1) * 0.26 + loco.bank);
    // Aiming, his cheek goes down onto the stock.
    off(joints.neck, 0.05 * keep + r.head * 0.6 + r.hurt * 0.38 + r.pressing * 0.32 - kneel * 0.5 - yank * 0.35 * (1 - choke) + dazed * 0.15 - choke * 0.5 + writhe(19.7, 29.3, 9.1) * 0.18 + ((lookPitch - aimPitch * 0.4) * attend + aim * 0.12 - crouch * 0.28) * (1 - choke),
      (look + lookYaw * attend - r.yaw * 0.5 + r.head * 0.3 + r.headYaw + toward * r.hurt * 0.35 + pressSide * r.pressing * 0.3) * (1 - choke) + writhe(16.3, 25.9, 7.7) * 0.32, r.roll * -0.3 + r.headRoll + loll - aim * 0.14 + writhe(17.3, 27.1, 8.9) * 0.2);
    for (const [side, sign] of SIDES) {
      // In the air the legs kick frantically and out of step; slower while only dangling.
      const kick = (Math.sin(time * 4.6 + sign * 1.3) * 0.3 * (1 - choke) + jitter(time + sign * 3.1, 7.9, 12.1, 4.3) * 0.5 * fight) * dangle;
      off(joints[`hip${side}`], -0.06 * keep - r.buckle * 0.5 - r.hurt * 0.22 - 0.25 * dangle + kick, 0, sign * 0.06 * keep);
      off(joints[`knee${side}`], 0.12 * keep + r.buckle * 0.9 + r.hurt * 0.38 + yank * 0.6 + (0.45 + kick) * dangle, 0, 0);
      off(joints[`ankle${side}`], -0.06 * keep + 0.55 * dangle, 0, -sign * 0.06 * keep);
      // Without the rifle the arms swing with his steps, flung by the hits —
      // back while he is dragged, forward towards the floor while he crouches —
      // held a little out from the bulky armour.
      off(joints[`shoulder${side}`], -0.15 * keep + r[`arm${side}`] + yank * 0.9 - kneel * 0.9 - Math.sin(time * 3.7 + sign) * 0.35 * dangle, 0, sign * (0.12 * keep + 0.1 * g + Math.abs(r[`arm${side}`]) * 0.5 + yank * 0.35) + r[`flare${side}`]);
      off(joints[`elbow${side}`], -0.35 * keep - 0.12 * g - r.limp * 0.4 - kneel * 0.4, 0, 0);
    }
    // The rifle: at low ready, or shouldered and aimed — with the recoil's kick.
    holder.position.lerpVectors(LOW_READY.position, SHOULDERED, aim);
    holder.quaternion.copy(LOW_READY.quaternion);
    if (aimTarget && aim > 0.001) {
      joints.spine.updateWorldMatrix(true, false);
      joints.spine.worldToLocal(temp.copy(aimTarget)).sub(SHOULDERED);
      aimMatrix.lookAt(temp, ORIGIN, UP);
      holder.quaternion.slerp(quaternion.setFromRotationMatrix(aimMatrix), aim);
    }
    holder.position.z -= r.recoil * 0.05;
    holder.quaternion.multiply(offsetQuaternion.setFromAxisAngle(X_AXIS, -r.recoil * 0.3));
    trooper.root.updateMatrixWorld(true);
    // Feet stay where the steps put them: the knees take up every dip and
    // sway (unless he is off the ground).
    const rootQuaternion = trooper.root.quaternion;
    if (dangle < 0.5 && g > 0.3) for (const [side, sign] of SIDES) {
      const knee = joints[`knee${side}`], ankle = joints[`ankle${side}`];
      solveTwoBone(joints[`hip${side}`], knee, ankle, trooper.root.localToWorld(temp.copy(feet[side].position)), trooper.root.localToWorld(temp2.set(sign * 0.12, 0.5, 0.8).applyAxisAngle(UP, loco.hipYaw)));
      knee.getWorldQuaternion(quaternion).invert();
      ankle.quaternion.copy(quaternion.multiply(solved.copy(rootQuaternion).multiply(feet[side].quaternion)));
      ankle.updateMatrixWorld(true);
    }
    // Rifle in hand: each hand reaches its grip.
    for (const [side, sign, grip] of [['R', -1, gripRight], ['L', 1, gripLeft]]) {
      if (armCut(side)) continue;
      reach(side, holder.localToWorld(temp.copy(grip)), joints[`shoulder${side}`].localToWorld(temp2.set(sign * 0.35, -0.3, -0.3)), r[`hold${side}`]);
    }
    // The throwing hand on its path, elbow out and back.
    if (throwWeight > 0.01 && !armCut('L')) reach('L', joints.spine.localToWorld(throwHand), joints.shoulderL.localToWorld(temp2.set(0.45, -0.05, -0.35)), throwWeight);
    // The wounded arm is drawn in — a forearm across the belly, an upper arm
    // tucked to his side — and the other hand holds the stump, trembling.
    const wound = r.wound;
    if (wound && r.clutch > 0.01) {
      const side = wound.side, sign = side === 'L' ? 1 : -1, kind = wound.joint.slice(0, -1);
      if (kind === 'wrist') {
        const target = joints.spine.localToWorld(new THREE.Vector3(-sign * 0.03, 0.16 + Math.sin(time * 2.1) * 0.01, 0.28));
        reach(side, target, joints[`shoulder${side}`].localToWorld(temp2.set(sign * 0.5, -0.2, -0.4)), r.clutch);
      } else if (kind === 'elbow') {
        aimArm(side, joints.spine.localToWorld(new THREE.Vector3(sign * 0.2, 0.07, 0.17)), r.clutch);
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
    // Choking: both hands at his throat, tugging at the grip he cannot see.
    if (choke > 0.01) {
      for (const [side, sign] of SIDES) {
        if (armCut(side)) continue;
        const tug = jitter(time + sign * 1.7, 24.1, 37.7, 15.3) * 0.022 * (0.4 + fight);
        const target = joints.spine.localToWorld(new THREE.Vector3(sign * (0.085 + tug * 0.4), 0.27 + tug, 0.155 + tug * 0.6));
        reach(side, target, joints[`shoulder${side}`].localToWorld(temp2.set(sign * 0.45, -0.35, 0.05)), choke);
      }
    }
    // Fetching the rifle: the right hand goes to it.
    if (r.reachFor) reach('R', r.reachFor.point, joints.shoulderR.localToWorld(temp2.set(-0.35, -0.3, 0.2)), r.reachFor.weight);
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

  /** Bounds of an object's meshes in its own frame. */
  function localBox(object) {
    object.updateMatrixWorld(true);
    const inverse = object.matrixWorld.clone().invert(), box = new THREE.Box3(), part = new THREE.Box3(), relative = new THREE.Matrix4();
    object.traverse(child => {
      if (!child.isMesh) return;
      child.geometry.computeBoundingBox();
      box.union(part.copy(child.geometry.boundingBox).applyMatrix4(relative.multiplyMatrices(inverse, child.matrixWorld)));
    });
    return box;
  }

  function knockOff(piece, velocity) {
    if (!piece || !piece.parent || piece.userData.loose) return null;
    piece.userData.loose = true;
    trooper.root.updateMatrixWorld(true);
    trooper.debris.attach(piece);
    piece.updateMatrixWorld(true);
    const box = localBox(piece), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    // Sized to the piece, so a helmet rolls on its dome and a plate lies flat.
    const radius = THREE.MathUtils.clamp(Math.min(size.x, size.y, size.z) * 0.5, 0.025, 0.11);
    const indices = [[0, 0, 0], [size.x * 0.5, 0, 0], [0, size.y * 0.5, 0]].map(offset => ragdoll.addParticle({
      position: piece.localToWorld(new THREE.Vector3(...offset).add(centre)), radius, mass: 0.3 + radius * 2, name: piece.name,
    }));
    const body = ragdoll.addBody({ name: piece.name, indices, object: piece });
    body.debris = true;
    loosen(indices);
    for (const index of indices) ragdoll.particles[index].ghost = true;
    ragdoll.bind(body, piece.matrixWorld);
    piece.matrixAutoUpdate = false;
    for (const index of indices) ragdoll.particles[index].kinematic = false;
    body.dynamic = true;
    // Off and away from him: along the blow, outwards, and up.
    const away = piece.localToWorld(centre.clone()).sub(trooper.particle('W').position).setY(0);
    if (away.lengthSq() > 1e-6) away.normalize().multiplyScalar(1.2);
    ragdoll.push(indices, temp.copy(velocity).clampLength(0, 6).multiplyScalar(0.3).add(away).add(temp2.set(0, 1.1, 0)));
    const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(9);
    const middle = ragdoll.particles[indices[0]].position;
    for (const index of indices) ragdoll.push([index], temp.subVectors(ragdoll.particles[index].position, middle).cross(axis).negate());
    feed.push({ type: 'armor', piece: piece.name, point: ragdoll.particles[indices[0]].position.clone() });
    return body;
  }

  /** Progressive destruction: the plate nearest the blow may come away. */
  function chip(body, point, velocity, chance) {
    if (!body?.object || random() >= chance) return null;
    let best = null, nearest = 0.28;
    const centre = new THREE.Vector3();
    body.object.traverse(child => {
      if (!child.userData.armour || child.userData.loose || child === body.object) return;
      localBox(child).getCenter(centre);
      const distance = child.localToWorld(centre).distanceTo(point);
      if (distance < nearest) { nearest = distance; best = child; }
    });
    return best ? knockOff(best, velocity) : null;
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
    // Shoved back along the blow and turned away from it, around where it landed.
    r.knock.addScaledVector(world(push), FEEL.hit.knockback * force * (region === 'arm' ? 0.55 : region === 'head' ? 0.7 : 1));
    r.spin += (at.z * push.x - at.x * push.z) / Math.max(0.12, Math.hypot(at.x, at.z)) * FEEL.hit.spin * force + (random() - 0.5) * 0.5 * force;
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
  /** Knocked out of a throw before letting go: the grenade drops at his feet. */
  function abortThrow() {
    if (throwing && !throwing.released && heldGrenade) {
      trooper.root.updateMatrixWorld(true);
      feed.push({ type: 'grenade', from: heldGrenade.getWorldPosition(new THREE.Vector3()), dropped: true });
    }
    throwing = null;
    if (heldGrenade) heldGrenade.visible = false;
  }
  /** Pulls the pin and throws at `target` (left hand, rifle kept in the right). */
  function throwGrenade(target) {
    if (!free() || throwing || armCut('L') || reaction.wound) return false;
    throwing = { age: 0, duration: 0.95, target: target.clone(), released: false };
    return true;
  }
  function throwStep(dt) {
    const t = throwing;
    t.age += dt;
    if (!t.released && t.age >= t.duration * 0.5) {
      t.released = true;
      trooper.root.updateMatrixWorld(true);
      feed.push({ type: 'grenade', from: heldGrenade.getWorldPosition(new THREE.Vector3()), target: t.target.clone() });
    }
    if (t.age >= t.duration) throwing = null;
  }

  function fall(cause, velocity = new THREE.Vector3(), cutChild = null) {
    if (trooper.fallen) return;
    abortThrow();
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
      case 'force':
      case 'pull':
        break;
      default:
        ragdoll.push(indicesOf(upper), along.clone().multiplyScalar(topple));
        ragdoll.push(knees, buckle);
    }
    // A twist through the shoulders so no two falls match.
    const twist = forward.clone().cross(UP).multiplyScalar((random() - 0.5) * 2.2);
    ragdoll.push([particleIndex.SL], twist);
    ragdoll.push([particleIndex.SR], twist.clone().negate());
    // A body felled by the blade carries the blow and the shove already under
    // way: it does not drop where it was struck, it is thrown and slides.
    if (cause !== 'force' && cause !== 'pull') {
      const carry = new THREE.Vector3().copy(velocity).setY(0).multiplyScalar(FEEL.hit.carry).clampLength(0, FEEL.hit.maxCarry).add(reaction.knock);
      if (carry.lengthSq() > 0.04) {
        carry.y = 0.35 + carry.length() * 0.12;
        const indices = joinedIndices();
        ragdoll.push(indices, carry);
        slip(indices, FEEL.hit.slide);
      }
    }
    levitating = dropping = flee = turnBack = fetching = null;
    reaction.run = reaction.dangle = 0;
    reaction.knock.set(0, 0, 0);
    if (!trooper.dead) {
      // Knocked down unhurt, he will get back up; with a leg gone, he crawls.
      if (injured()) startCrawl();
      else startRecovery();
    }
    trooper.events.push({ type: 'fall', cause });
  }
  const injured = () => [...trooper.severed].some(name => /^(shoulder|elbow|wrist|hip|knee|ankle)/.test(name));
  function startCrawl() {
    // Alive on the floor: a moment of agony, then he tries to crawl.
    recover = null;
    crawl = { age: 0, stage: 'down', effort: 0, stamina: 9 + random() * 5, origin: new THREE.Vector3(), heading: 0, roll: 0, turn: 0, stroke: null, plant: {}, hand: {}, pause: 0, strain: 0, lean: 0, look: 0, slump: 1, kick: { L: 0, R: 0 } };
    crawl.staminaTotal = crawl.stamina;
    spasm = { left: 1.2, total: 1.2, amplitude: 0.6, next: 0.1 };
  }
  function startRecovery() {
    crawl = null;
    muscles = [];
    recover = { stage: 'tumble', age: 0, stun: pick(FEEL.recovery.stun, random), effort: 0 };
    if (!spasm || spasm.left < 0.6) spasm = { left: 0.7, total: 0.7, amplitude: 0.4, next: 0.25 };
  }

  /**
   * Death. A beheaded body stays up for a heartbeat before it collapses, and
   * twitches for a few seconds on the floor; other deaths shudder briefly.
   */
  function die(cause, velocity = new THREE.Vector3(), cutChild = null, { delay = 0 } = {}) {
    if (trooper.dead) return;
    trooper.dead = true;
    crawl = recover = lifting = null;
    flee = turnBack = null;
    reaction.run = 0;
    if (towing?.kind === 'stand') towing = null;
    muscles = [];
    if (pickup) dropPickup();
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

  /** On the floor and alive: a hit makes him writhe and stop crawling (or getting up) for a moment. */
  function suffer(strength) {
    if (lifting) return;
    if (recover) {
      if (injured()) { startCrawl(); return; }
      muscles = [];
      Object.assign(recover, { stage: 'stunned', age: 0, stun: Math.max(recover.stun, 0.5) + 0.4 * strength, effort: 0 });
      if (!spasm || spasm.left < 0.5) spasm = { left: 0.5, total: 0.5, amplitude: 0.7 * strength, next: 0 };
      return;
    }
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
      if (pickup) dropPickup();
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

  /** Muscle targets for every particle of his body: the crawl or the rise, frame to frame. */
  function aimMuscles(dt, mode = 'crawl') {
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
          muscle = { index, weight: 0, from: new THREE.Vector3(), to: joints[joint].localToWorld(new THREE.Vector3(...offset)) };
          muscle.from.copy(muscle.to);
          muscleState.set(index, muscle);
        } else {
          muscle.from.copy(muscle.to);
          joints[joint].localToWorld(muscle.to.fromArray(offset));
        }
        // Getting up takes every muscle; crawling lets the legs drag.
        muscle.weight = mode === 'strong' || mode === true ? 3 : mode === 'reflex' ? REFLEX[particleName] ?? 0.5 : MUSCLE[particleName] ?? 0.5;
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
    const effort = trooper.dead ? 0 : lifting ? lifting.effort : crawl ? crawl.effort : recover ? recover.effort : 0;
    // How much of his weight the muscles bear: all of it to get up, a little in reflexes.
    const support = lifting ? 1 : crawl ? 1 : recover?.support ?? 1;
    // A body hauled by the Force: steered towards where the pull carries it, weightless.
    if (towing?.kind === 'body' && towing.velocity) {
      for (const index of towing.indices) {
        const particle = ragdoll.particles[index];
        if (particle.kinematic) continue;
        particle.position.y -= ragdoll.gravity * h * h;
        motion.subVectors(particle.position, particle.previous).lerp(stride.copy(towing.velocity).multiplyScalar(h), 0.35);
        particle.previous.subVectors(particle.position, motion);
      }
    }
    if (effort > 0.01 && muscles.length) {
      driveClock += h;
      const f = Math.min(1, driveClock / driveSpan);
      const weight = ragdoll.gravity * h * h * effort;
      for (const muscle of muscles) {
        const particle = ragdoll.particles[muscle.index];
        if (particle.kinematic) continue;
        const k = Math.min(0.4, muscle.weight * 0.035 * effort);
        if (k <= 0) continue;
        // Limply held parts (the dragging legs) keep most of their weight.
        particle.position.y -= weight * Math.min(1, muscle.weight) * support;
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

  // ---- The Force, and getting back up ----------------------------------------

  /** Bodies still joined to him (whatever has not been cut away). */
  const joinedBodies = () => [...new Set([...subtree('torso'), ...subtree('pelvis')])];
  const joinedIndices = () => [...new Set(indicesOf(joinedBodies()))];
  const centroid = indices => indices.reduce((sum, index) => sum.add(ragdoll.particles[index].position), new THREE.Vector3()).divideScalar(indices.length);

  /** Thrown or shoved on the floor: slippery and bouncy for a while, so he slides, rolls and bounces. */
  function slip(indices, seconds) {
    if (slick) settle();
    slick = { indices, until: clock + seconds };
    for (const index of indices) Object.assign(ragdoll.particles[index], { friction: FEEL.push.friction, bounce: FEEL.push.bounce });
  }
  function settle() {
    if (!slick) return;
    for (const index of slick.indices) { delete ragdoll.particles[index].friction; delete ragdoll.particles[index].bounce; }
    slick = null;
  }

  /**
   * Force push (velocity in m/s): thrown off his feet with a tumble — never
   * killed by it — or, already down, shoved along the floor.
   */
  function forcePush(velocity) {
    const v = velocity.clone();
    if (pickup) dropPickup();
    levitating = dropping = flee = turnBack = null;
    if (lifting) { lifting = null; muscles = []; if (!trooper.dead) startRecovery(); }
    if (!trooper.fallen) {
      towing = null;
      reaction.yank = 0;
      fall('force', v);
    } else {
      if (towing?.kind === 'body') towing = null;
      v.multiplyScalar(0.75);
      if (crawl) { crawl.pause = Math.max(crawl.pause, 1.4); crawl.effort = 0; }
      if (recover) { muscles = []; Object.assign(recover, { stage: 'tumble', age: 0, effort: 0 }); }
    }
    // Hit in the chest: the upper body flies a touch faster, the whole body
    // tumbles about an axis across the push, each throw a little different.
    const flat = temp.copy(v).setY(0);
    const across = new THREE.Vector3().crossVectors(UP, flat.lengthSq() > 1e-6 ? flat.normalize() : temp.set(1, 0, 0));
    const tumble = across.multiplyScalar(pick(FEEL.push.tumble, random) * (random() < 0.7 ? 1 : -0.6));
    const indices = joinedIndices(), centre = centroid(indices);
    const upper = new Set(indicesOf(['head', 'torso', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR'].filter(name => joinedBodies().includes(name))));
    for (const index of indices) {
      const particle = ragdoll.particles[index];
      ragdoll.push([index], temp2.copy(v).multiplyScalar((upper.has(index) ? 1.1 : 0.85) * (0.92 + random() * 0.16))
        .add(temp.crossVectors(tumble, new THREE.Vector3().subVectors(particle.position, centre))));
    }
    slip(indices, 3.2);
    feed.push({ type: 'pushed', point: centre });
  }

  /**
   * Force pull towards `to` (a point before the hero): explosive at first,
   * very fast, slowing right down on arrival — eased. Standing, he is dragged
   * off his feet and lands staggering, maybe disarmed or felled; on the floor,
   * the body is hauled along.
   */
  function forcePull(to, { duration = pick(FEEL.pull.duration, random), hold = false } = {}) {
    if (trooper.dead && !trooper.fallen) return false;
    abortThrow();
    if (pickup) dropPickup();
    flee = turnBack = dropping = fetching = null;
    reaction.run = 0;
    if (!trooper.fallen) {
      const from = trooper.root.position.clone(), target = to.clone().setY(hold ? to.y : 0);
      const toward = new THREE.Vector3().subVectors(target, from).setY(0);
      if (toward.length() < 0.2 && !hold) return false;
      // The curve peaks at about 3.2 × the mean speed: keep it under the top speed.
      duration = Math.max(duration, 3.2 * toward.length() / FEEL.pull.topSpeed);
      towing = {
        kind: 'stand', from, to: target, age: 0, duration, lift: pick(FEEL.pull.lift, random),
        fromHeading: headingOf(), toHeading: Math.atan2(toward.x, toward.z) + (random() - 0.5) * FEEL.pull.spin,
        disarm: trooper.holding && random() < FEEL.pull.dropChance, falls: random() < FEEL.pull.fallChance, direction: toward.normalize(), hold,
      };
      levitating = null;
      // His hands go to his throat: the rifle falls where he stood.
      if (trooper.holding) dropBlaster(toward.clone().multiplyScalar(0.6));
      towing.disarm = false;
    } else if (!trooper.dead) {
      // Down but alive: the Force hauls him upright where he lies, into the
      // air, choking — and only then brings him in.
      const hips = trooper.particle('HL').position.clone().add(trooper.particle('HR').position).multiplyScalar(0.5).setY(0);
      const toward = to.clone().setY(0).sub(hips);
      lifting = { age: 0, duration: 0.42, at: hips, heading: Math.atan2(toward.x, toward.z), to: to.clone(), hold, effort: 0 };
      crawl = recover = towing = null;
      spasm = null;
      twitches = [];
      settle();
      muscles = [];
      muscleState = new Map();
      for (const key of ['yaw', 'pitch', 'roll', 'head', 'headYaw', 'headRoll', 'buckle', 'armL', 'armR', 'flareL', 'flareR', 'dipL', 'dipR']) { reaction[key] = 0; reaction[`v${key}`] = 0; }
      Object.assign(reaction, { kneel: 0, yank: 0, imbalance: 0, press: null, daze: 0 });
      reaction.knock.set(0, 0, 0);
    } else {
      const indices = joinedIndices(), from = centroid(indices);
      towing = { kind: 'body', indices, from, to: to.clone().setY(hold ? to.y + 0.3 : from.y), age: 0, duration: duration * 1.15, lift: 0.35, last: from.clone(), velocity: null, hold };
      if (crawl) { crawl.pause = Math.max(crawl.pause, duration + 0.8); crawl.effort = 0; }
      if (recover) { muscles = []; Object.assign(recover, { stage: 'tumble', age: 0, effort: 0 }); }
    }
    feed.push({ type: 'pulled', point: trooper.particle('W').position.clone() });
    return true;
  }

  /** Hauled upright by the Force: the muscles take him from lying to standing in the air. */
  function liftStep(dt, time) {
    const l = lifting;
    l.age += dt;
    const p = Math.min(1, l.age / l.duration);
    trooper.root.position.set(l.at.x, ease.outCubic(p) * 0.35, l.at.z);
    face(l.heading);
    reaction.choke = 1;
    pose(time, dt);
    aimMuscles(dt, 'strong');
    l.effort = ease.outCubic(Math.min(1, l.age / 0.12));
    if (p < 1) return;
    const { to, hold, heading } = l;
    stand(trooper.root.position.clone(), heading);
    reaction.daze = 0;
    forcePull(to, { hold });
  }

  /** Dragged on his feet along the eased path, leaning into it, legs trailing. */
  function towStanding(dt) {
    const t = towing;
    t.age += dt;
    const p = Math.min(1, t.age / t.duration), e = curve(FEEL.pull.curve)(p);
    trooper.root.position.lerpVectors(t.from, t.to, e);
    trooper.root.position.y = t.from.y + (t.to.y - t.from.y) * e + t.lift * Math.sin(Math.PI * p) * (t.hold ? 0.5 : 1);
    face(t.fromHeading + wrap(t.toHeading - t.fromHeading) * ease.outCubic(Math.min(1, p * 1.6)));
    reaction.yank = Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 0.6;
    if (p < 1) return;
    if (t.hold) {
      // Held: he stays up there, before the hero, as long as the Force holds him.
      towing = null;
      reaction.yank = 0;
      levitating = { point: t.to.clone(), heading: t.toHeading, age: 0, next: 0.2 };
      if (t.disarm) dropBlaster(t.direction.clone().multiplyScalar(1.5));
      feed.push({ type: 'held', point: trooper.root.position.clone() });
      return;
    }
    // Arrival: he lands staggering — whiplash, buckled knees — maybe disarmed, maybe felled.
    towing = null;
    reaction.yank = 0;
    trooper.root.position.y = 0;
    Object.assign(reaction, { vpitch: reaction.vpitch - 3.5 - random() * 2, vbuckle: reaction.vbuckle + 3, vhead: reaction.vhead - 4 });
    reaction.varmL += (random() - 0.5) * 8;
    reaction.varmR += (random() - 0.5) * 8;
    reaction.imbalance += 0.45;
    if (t.disarm) dropBlaster(t.direction.clone().multiplyScalar(2.5));
    feed.push({ type: 'arrived', point: trooper.root.position.clone() });
    if (t.falls) fall('pull', t.direction.clone().multiplyScalar(2.2));
  }

  /** A body on the floor hauled by the Force. */
  function towBody(dt) {
    const t = towing;
    t.age += dt;
    const p = Math.min(1, t.age / t.duration), e = curve(FEEL.pull.curve)(p);
    const target = new THREE.Vector3().lerpVectors(t.from, t.to, e);
    target.y = t.from.y + t.lift * Math.sin(Math.PI * p);
    if (t.hold && p >= 1) target.copy(t.to).y += Math.sin(t.age * 2.2) * FEEL.pull.hold.bob;
    t.velocity = new THREE.Vector3().subVectors(target, t.last).divideScalar(Math.max(dt, 1e-4)).addScaledVector(temp.subVectors(target, centroid(t.indices)), 5);
    t.last.copy(target);
    if (p >= 1 && !t.hold) towing = null;
  }

  /** Keeps a pulled trooper (or body) up where the Force holds him; heading: where he should face. */
  function hold(point, heading = null) {
    if (levitating) {
      levitating.point.copy(point);
      if (heading !== null) levitating.heading = heading;
    } else if (towing?.hold) {
      towing.to.copy(point);
      if (towing.kind === 'body') towing.to.y = point.y + 0.3;
      if (heading !== null && towing.kind === 'stand') towing.toHeading = heading;
    }
  }
  /** Let go: he drops back to the floor (a body just falls). */
  function drop() {
    if (towing?.hold) {
      if (towing.kind === 'body') towing = null;
      else { towing.hold = false; towing.to.y = 0; }
    }
    if (!levitating) return;
    levitating = null;
    dropping = { speed: 0 };
  }
  /** Hanging in the Force's grip: following the point, choking, writhing and jerking. */
  function levitateStep(dt, time) {
    const l = levitating;
    l.age += dt;
    // The whole body jerks with his struggle, on top of a slow bob.
    const target = temp.copy(l.point);
    target.y += Math.sin(time * 2.2) * FEEL.pull.hold.bob + jitter(time, 7.3, 11.1, 17.9) * 0.035;
    target.x += jitter(time + 5, 6.1, 9.7, 15.3) * 0.02;
    target.z += jitter(time + 9, 5.3, 10.9, 14.1) * 0.02;
    trooper.root.position.lerp(target, 1 - Math.exp(-FEEL.pull.hold.follow * dt));
    const heading = l.heading + jitter(time, 2.3, 4.1, 7.7) * 0.25;
    turnTo(heading, 6, dt);
    // Now and then a convulsion runs through him.
    if ((l.next -= dt) <= 0) {
      l.next = 0.25 + random() * 0.5;
      reaction.vpitch += (random() - 0.4) * 3;
      reaction.vroll += (random() - 0.5) * 2.5;
      reaction.vbuckle += random() * 2;
    }
  }
  /** Dropped: he falls onto his feet, buckles, and runs for it. */
  function dropStep(dt) {
    dropping.speed += 11 * dt;
    trooper.root.position.y -= dropping.speed * dt;
    if (trooper.root.position.y > 0) return;
    trooper.root.position.y = 0;
    if ([...trooper.severed].some(name => /^(hip|knee|ankle)/.test(name))) { dropping = null; fall('leg', new THREE.Vector3()); return; }
    reaction.vbuckle += 2.5 + dropping.speed * 0.6;
    reaction.vpitch += 1.5;
    reaction.varmL += (random() - 0.5) * 6;
    reaction.varmR += (random() - 0.5) * 6;
    dropping = null;
    feed.push({ type: 'land', point: trooper.root.position.clone(), speed: 2 });
    // Away from the hero, a little off to one side.
    const away = trooper.root.position.clone().sub(trooper.focus ?? temp.set(0, 0, 0)).setY(0);
    if (away.lengthSq() < 1e-4) away.set(Math.sin(headingOf() + Math.PI), 0, Math.cos(headingOf() + Math.PI));
    away.normalize().applyAxisAngle(UP, (random() - 0.5) * 1.1);
    flee = { direction: away, speed: pick(FEEL.flee.speed, random), left: pick(FEEL.flee.time, random), age: 0, delay: 0.25 };
  }
  /** Running away: a quick start, he runs, then slows, stops and turns back. */
  function fleeStep(dt) {
    const f = flee;
    f.age += dt;
    if (f.age < f.delay) { locomote(dt, temp.set(0, 0, 0), null); return; }
    f.left -= dt;
    const pace = f.left > 0 ? 1 : Math.max(0, 1 + f.left / 0.5);
    locomote(dt, temp.copy(f.direction).multiplyScalar(f.speed * pace), null, { accelerate: 9 });
    trooper.root.position.x = THREE.MathUtils.clamp(trooper.root.position.x, -30, 30);
    trooper.root.position.z = THREE.MathUtils.clamp(trooper.root.position.z, -30, 30);
    if (pace > 0 || loco.velocity.length() > 0.3) return;
    flee = null;
    // He stops and turns back to face the hero, warily.
    if (trooper.focus) turnBack = Math.atan2(trooper.focus.x - trooper.root.position.x, trooper.focus.z - trooper.root.position.z);
  }
  /**
   * Walking and running with a body's inertia: he speeds up, slows down and
   * turns at human rates, leans into a start and banks into a turn. His legs
   * turn towards where he goes while his chest keeps facing where he looks
   * (`faceHeading`), and he backs away with his steps reversed.
   */
  function locomote(dt, desired, faceHeading, { accelerate = PACE.accelerate } = {}) {
    const v = loco.velocity, before = motion.copy(v);
    const rate = desired.lengthSq() > v.lengthSq() ? accelerate : PACE.brake;
    v.add(stride.subVectors(desired, v).setY(0).clampLength(0, rate * dt));
    trooper.root.position.addScaledVector(v, dt);
    const speed = v.length();
    const target = faceHeading ?? (speed > 0.25 ? Math.atan2(v.x, v.z) : null);
    if (target !== null) {
      const turn = wrap(target - headingOf()), limit = PACE.turn * dt;
      face(headingOf() + THREE.MathUtils.clamp(turn * (1 - Math.exp(-9 * dt)), -limit, limit));
    }
    // Legs towards the steps; backwards when he backs away.
    const heading = headingOf();
    let hip = 0;
    if (speed > 0.15) {
      const angle = wrap(Math.atan2(v.x, v.z) - heading);
      loco.backward = Math.abs(angle) > (loco.backward ? 1.75 : 1.95);
      hip = THREE.MathUtils.clamp(loco.backward ? wrap(angle + Math.PI) : angle, -1.1, 1.1) * smooth(Math.min(1, speed / 0.6));
    } else loco.backward = false;
    loco.hipYaw += (hip - loco.hipYaw) * (1 - Math.exp(-8 * dt));
    // Leaning into a start (and back on braking), more forward at a run.
    const forwardAccel = (v.x - before.x) * Math.sin(heading) + (v.z - before.z) * Math.cos(heading);
    const lean = THREE.MathUtils.clamp(forwardAccel / Math.max(dt, 1e-4) * 0.025, -0.14, 0.18) * (loco.backward ? -0.5 : 1) + Math.min(speed, PACE.run) * 0.035;
    loco.lean += (lean - loco.lean) * (1 - Math.exp(-6 * dt));
    loco.bank += (THREE.MathUtils.clamp(-loco.turnRate * speed * 0.035, -0.18, 0.18) - loco.bank) * (1 - Math.exp(-6 * dt));
  }
  /** Free to act: his brain's orders move him. */
  function obey(dt) {
    const o = trooper.order;
    // Dazed, or crouched behind cover, he stays put.
    const desired = reaction.daze > 0.25 || (o.crouch && reaction.crouch > 0.3) ? temp.set(0, 0, 0) : temp.copy(o.velocity).setY(0).clampLength(0, PACE.run * 1.05);
    locomote(dt, desired, o.face);
  }

  /** On the floor unhurt: tumbling to a stop, lying stunned, then getting up. */
  function recoverStep(dt, time) {
    const r = recover;
    r.age += dt;
    if (r.stage === 'tumble' || r.stage === 'stunned') {
      // Alive all the way: braced in the air, then curled and squirming on the floor.
      const airborne = r.stage === 'tumble' && (trooper.particle('W').position.y > 0.42 || restlessness() > 2.2);
      poseReflex(time, airborne ? 'brace' : 'writhe');
      aimMuscles(dt, 'reflex');
      r.effort += ((airborne ? 0.8 : 0.55) - r.effort) * (1 - Math.exp(-10 * dt));
      r.support = airborne ? 0.3 : 0.45;
    }
    if (r.stage === 'tumble') {
      if ((r.age > 0.45 && restlessness() < 0.45) || r.age > 4) { settle(); Object.assign(r, { stage: 'stunned', age: 0 }); }
    } else if (r.stage === 'stunned') {
      if (r.age >= r.stun && !towing) beginRise();
    } else if (r.stage === 'rising') {
      const p = r.age / r.duration;
      // From a deep crouch up to standing, eased; the muscles do the work.
      reaction.kneel = 1 - curve(FEEL.recovery.riseCurve)(THREE.MathUtils.clamp((p - 0.15) / 0.85, 0, 1));
      trooper.root.position.copy(r.at);
      face(r.heading);
      pose(time, dt);
      aimMuscles(dt, 'strong');
      r.effort = ease.outCubic(Math.min(1, r.age / 0.22));
      r.support = 1;
      let error = 0;
      for (const muscle of muscles) error = Math.max(error, ragdoll.particles[muscle.index].position.distanceTo(muscle.to));
      if ((p >= 1 && error < 0.09) || p > 1.7) { const { at, heading } = recover; recover = null; stand(at, heading); }
    }
  }

  /**
   * A live pose laid over his body as it lies or flies: the skeleton is
   * fitted to the trunk (left to physics), and the limbs and head are set
   * relative to it — braced for the fall (arms out in front, chin tucked,
   * knees drawn), or, once down, curled up, hands to his belly, squirming.
   */
  function poseReflex(time, kind) {
    const w = trooper.particle('W').position, n = trooper.particle('N').position;
    const up = new THREE.Vector3().subVectors(n, w).normalize();
    const left = new THREE.Vector3().subVectors(trooper.particle('SL').position, trooper.particle('SR').position);
    left.addScaledVector(up, -left.dot(up)).normalize();
    if (!Number.isFinite(left.x) || left.lengthSq() < 0.5) return;
    const front = new THREE.Vector3().crossVectors(left, up);
    for (const joint of Object.values(joints)) if (joint !== holder) joint.rotation.set(0, 0, 0);
    joints.pelvis.position.copy(base);
    const n3 = (a, b, c) => jitter(time, a, b, c);
    const curl = kind === 'brace' ? 0.3 : 0.55;
    joints.spine.rotation.set(curl + n3(1.7, 2.9, 0.9) * 0.12, n3(1.2, 2.3, 0.6) * 0.2, n3(1.5, 2.6, 0.8) * 0.15);
    joints.neck.rotation.set((kind === 'brace' ? 0.45 : 0.5) + n3(2.1, 3.3, 1.1) * 0.2, n3(1.9, 3.1, 0.9) * 0.35, 0);
    for (const [side, sign] of SIDES) {
      const own = (a, b, c) => jitter(time + sign * 2.7, a, b, c);
      if (kind === 'brace') {
        joints[`shoulder${side}`].rotation.set(-1.15 + own(4.1, 6.7, 2.3) * 0.35, 0, sign * (0.55 + own(3.3, 5.9, 2.1) * 0.2));
        joints[`elbow${side}`].rotation.set(-0.5 + own(3.9, 6.1, 1.7) * 0.2, 0, 0);
        joints[`hip${side}`].rotation.set(-0.55 + own(3.7, 6.1, 1.9) * 0.35, 0, sign * 0.12);
        joints[`knee${side}`].rotation.set(0.9 + own(3.1, 5.3, 1.3) * 0.35, 0, 0);
      } else {
        joints[`shoulder${side}`].rotation.set(-0.7 + own(1.3, 2.3, 0.7) * 0.3, 0, sign * 0.25);
        joints[`elbow${side}`].rotation.set(-1.6 + own(1.1, 2.1, 0.6) * 0.25, 0, 0);
        joints[`hip${side}`].rotation.set(-1 + own(1.4, 2.4, 0.8) * 0.4, 0, sign * 0.15);
        joints[`knee${side}`].rotation.set(1.5 + own(1.2, 2.2, 0.7) * 0.35, 0, 0);
      }
      joints[`ankle${side}`].rotation.set(0.3, 0, 0);
    }
    // Fit the skeleton so its spine lies where his trunk is.
    joints.pelvis.updateMatrix();
    joints.spine.updateMatrix();
    const spineInRoot = new THREE.Matrix4().multiplyMatrices(joints.pelvis.matrix, joints.spine.matrix);
    const trunk = new THREE.Matrix4().makeBasis(left, up, front).setPosition(w);
    const rootMatrix = trunk.multiply(spineInRoot.invert());
    rootMatrix.decompose(trooper.root.position, trooper.root.quaternion, temp);
    trooper.root.scale.set(1, 1, 1);
    trooper.root.updateMatrixWorld(true);
  }
  function beginRise() {
    const hips = trooper.particle('HL').position.clone().add(trooper.particle('HR').position).multiplyScalar(0.5).setY(0);
    // He gets up facing the threat if he knows of one, else the way his chest faces.
    let heading;
    if (trooper.focus) heading = Math.atan2(trooper.focus.x - hips.x, trooper.focus.z - hips.z);
    else {
      const front = new THREE.Vector3().subVectors(trooper.particle('SL').position, trooper.particle('SR').position).cross(temp.subVectors(trooper.particle('N').position, trooper.particle('W').position)).setY(0);
      heading = front.lengthSq() > 1e-6 ? Math.atan2(front.x, front.z) : 0;
    }
    Object.assign(recover, { stage: 'rising', age: 0, duration: pick(FEEL.recovery.rise, random), at: hips, heading, effort: 0 });
    for (const key of ['yaw', 'pitch', 'roll', 'head', 'headYaw', 'headRoll', 'buckle', 'armL', 'armR', 'flareL', 'flareR', 'dipL', 'dipR']) { reaction[key] = 0; reaction[`v${key}`] = 0; }
    Object.assign(reaction, { kneel: 1, yank: 0, imbalance: 0, wound: null, press: null });
    reaction.push.set(0, 0, 0); reaction.offset.set(0, 0, 0);
    muscleState = new Map();
  }
  /** Back on his feet (at `at`, which may be up in the air): the parts return to the skeleton and the pose drives them again. */
  function stand(at, heading) {
    recover = null;
    lifting = null;
    muscles = [];
    muscleState = new Map();
    twitches = [];
    spasm = null;
    settle();
    trooper.fallen = false;
    trooper.root.position.copy(at);
    face(heading);
    loco.velocity.set(0, 0, 0);
    loco.lastYaw = heading;
    const joined = new Set(joinedBodies());
    if (trooper.holding) joined.add('blaster');
    for (const [name, body] of Object.entries(bodies)) {
      if (!body.dynamic || !joined.has(name)) continue;
      body.dynamic = false;
      for (const index of body.indices) ragdoll.particles[index].kinematic = true;
      const object = body.object;
      joints[mounts[name]].add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.set(1, 1, 1);
      object.matrixAutoUpdate = true;
    }
    Object.assign(reaction, { kneel: 0, daze: pick(FEEL.recovery.daze, random) });
    pose(clock, 0);
    trooper.root.updateMatrixWorld(true);
    placeParticles(1 / 60);
    placeParticles(1 / 60);
    feed.push({ type: 'up', point: at.clone() });
  }

  /** Up and unarmed: he walks over to his rifle if it lies close enough, and bends down for it. */
  function lookForRifle() {
    if (trooper.holding || pickup || fetching || trooper.dead || towing || reaction.daze > 0.25 || reaction.wound || armCut('L') || armCut('R')) return;
    const blaster = bodies.blaster;
    if (!blaster.dynamic) return;
    const at = centroid(blaster.indices);
    const distance = at.clone().setY(0).distanceTo(trooper.root.position.clone().setY(0));
    if (distance > FEEL.recovery.reach || blaster.indices.some(index => ragdoll.velocity(index, temp).length() > 0.3)) return;
    if (distance > 0.7) { fetching = { at: at.setY(0), age: 0 }; return; }
    // The rifle leaves the physics: it is carried by the hand from here.
    blaster.dynamic = false;
    for (const index of blaster.indices) ragdoll.particles[index].kinematic = true;
    const from = new THREE.Matrix4().copy(blaster.object.matrixWorld);
    pickup = { age: 0, duration: FEEL.recovery.pickup, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
    from.decompose(pickup.position, pickup.quaternion, pickup.scale);
  }
  function pickupStep(dt) {
    const k = pickup;
    k.age += dt;
    const p = Math.min(1, k.age / k.duration);
    reaction.kneel = 0.62 * Math.sin(Math.PI * Math.min(1, p * 1.1));
    trooper.root.updateMatrixWorld(true);
    holder.updateMatrixWorld(true);
    const goalPosition = new THREE.Vector3(), goalQuaternion = new THREE.Quaternion();
    holder.matrixWorld.decompose(goalPosition, goalQuaternion, temp);
    // Lifted from the floor in an arc, eased, into his hands.
    const q = ease.inOutCubic(THREE.MathUtils.clamp((p - 0.3) / 0.65, 0, 1));
    const position = k.position.clone().lerp(goalPosition, q).addScaledVector(UP, 0.12 * Math.sin(Math.PI * q));
    const turn = k.quaternion.clone().slerp(goalQuaternion, q);
    parts.blaster.matrix.compose(position, turn, temp.set(1, 1, 1));
    parts.blaster.matrixWorldNeedsUpdate = true;
    reaction.reachFor = { point: position, weight: Math.sin(Math.PI * Math.min(1, p * 1.3)) * (1 - q * 0.6) };
    if (p < 1) return;
    pickup = null;
    reaction.reachFor = null;
    reaction.kneel = 0;
    holder.add(parts.blaster);
    parts.blaster.position.set(0, 0, 0);
    parts.blaster.quaternion.identity();
    parts.blaster.matrixAutoUpdate = true;
    trooper.holding = true;
    reaction.letGo.L = reaction.letGo.R = 0;
    feed.push({ type: 'rearmed', point: position });
  }
  /** A few steps to his rifle, briskly, then he stops by it. */
  function fetchStep(dt) {
    const f = fetching;
    f.age += dt;
    const toward = f.at.clone().sub(trooper.root.position).setY(0), distance = toward.length();
    if ((distance < 0.62 && loco.velocity.length() < 0.4) || f.age > 5) { fetching = null; return; }
    toward.divideScalar(Math.max(distance, 1e-4));
    locomote(dt, toward.multiplyScalar(distance < 0.6 ? 0 : Math.min(1.6, 0.4 + distance * 1.2)), null);
  }
  /** Interrupted while fetching the rifle: it falls again. */
  function dropPickup() {
    if (!pickup) return;
    pickup = null;
    reaction.reachFor = null;
    reaction.kneel = 0;
    bodies.blaster.dynamic = false;
    release(['blaster']);
  }

  /** Hard landings: a piece of armour may come away where he hits the floor. */
  function landings(before) {
    if (clock - landed < 0.12) return;
    for (const [index, vy] of before) {
      const particle = ragdoll.particles[index];
      if (vy > -FEEL.armor.landingSpeed || particle.position.y > particle.radius + 0.006) continue;
      landed = clock;
      const body = particle.bodies.find(owner => !owner.debris && owner.name !== 'blaster');
      chip(body, particle.position, ragdoll.velocity(index, temp).setY(1.5), FEEL.armor.landing);
      feed.push({ type: 'land', point: particle.position.clone(), speed: -vy });
      return;
    }
  }

  function update(dt, time) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    tweens.update(dt);
    if (!trooper.fallen && dt > 0) {
      if (towing?.kind === 'stand') towStanding(dt);
      else if (levitating) levitateStep(dt, time);
      else if (dropping) dropStep(dt);
      else if (flee) fleeStep(dt);
      else if (fetching) fetchStep(dt);
      else if (turnBack !== null) {
        locomote(dt, temp.set(0, 0, 0), turnBack);
        if (Math.abs(wrap(turnBack - headingOf())) < 0.05) turnBack = null;
      } else if (!pickup) obey(dt);
      if (towing || levitating || dropping) loco.velocity.set(0, 0, 0);
      if (throwing) throwStep(dt);
      if (pickup) pickupStep(dt);
      else if (!levitating && !dropping && !flee && !towing && !fetching) lookForRifle();
      // Shoved by the blows: he slides back, turning away, then catches himself.
      const r = reaction;
      if (!towing) {
        trooper.root.position.x += r.knock.x * dt;
        trooper.root.position.z += r.knock.z * dt;
        face(headingOf() + r.spin * dt);
      }
      r.knock.multiplyScalar(Math.exp(-5.5 * dt));
      r.spin *= Math.exp(-6 * dt);
      // Crates and barrels: he walks round them, he is not pushed through them.
      if (!towing && !levitating) lab?.pushOut(trooper.root.position, 0.3);
      // How fast he is turning: a quick turn on the spot takes steps.
      const yaw = headingOf();
      loco.turnRate += (wrap(yaw - loco.lastYaw) / dt - loco.turnRate) * (1 - Math.exp(-14 * dt));
      loco.lastYaw = yaw;
    }
    if (!trooper.fallen) {
      pose(time, dt);
      placeParticles(dt);
      if (collapse && clock >= collapse.at) { const { cause, velocity, cutChild } = collapse; fall(cause, velocity, cutChild); }
    } else if (lifting && dt > 0) {
      liftStep(dt, time);
    } else {
      if (towing?.kind === 'body' && dt > 0) towBody(dt);
      if (crawl && !trooper.dead && dt > 0) crawlStep(dt, time);
      else if (recover && !trooper.dead && dt > 0) recoverStep(dt, time);
      convulse(dt);
    }
    const before = trooper.fallen && dt > 0 ? joinedIndices().map(index => [index, ragdoll.velocity(index, temp).y]) : null;
    if (dt > 0) ragdoll.step(dt);
    if (before) landings(before);
    if (slick && clock > slick.until) settle();
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
      // Never twice the same spray.
      effects?.sparks(hit.point, sparkDirection, hit.normal, { count: Math.round(pick(FEEL.sparks.graze, random) * (speed < 0.6 ? 0.4 : 1)), speed: 1.5 + speed });
      if (speed > 0.6) flashPart(body, 0.35);
      if (speed > 0.6) {
        if (alive && standing) react(hit.velocity, hit.point, 0.35, name);
        else if (alive) suffer(0.4);
        else if (speed > 1.2) jolt(body, hit);
      }
      if (speed > 1.2 && chip(body, hit.point, hit.velocity, FEEL.armor.graze)) event.type = 'armor';
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
    // The faster the blade, the bigger the spray — never twice the same.
    effects?.sparks(hit.point, sparkDirection, hit.normal, { count: Math.round(pick(FEEL.sparks.cut, random) * THREE.MathUtils.clamp(0.5 + speed / 12, 0.6, 1.2)), speed: 2 + Math.min(speed, 8) * 0.5 });
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
      chip(bodies[CUTS[joint].parent], hit.point, hit.velocity, FEEL.armor.cut);
      if (trooper.fallen) ragdoll.push(body.indices, hit.velocity.clone().clampLength(0, 6).multiplyScalar(0.1));
    } else if (name === 'torso' || name === 'pelvis') {
      event.type = 'slash';
      scorch(body, hit);
      effects?.burst(hit.point, { normal: hit.normal, power: 0.3 });
      effects?.sparks(hit.point, sparkDirection, hit.normal, { count: Math.round(pick(FEEL.sparks.slash, random)), speed: 1.5 + Math.min(speed, 8) * 0.4 });
      chip(body, hit.point, hit.velocity, FEEL.armor.slash);
      if (alive && standing) {
        if (speed > SLASH_LETHAL_SPEED) die('slash', hit.velocity);
        else { react(hit.velocity, hit.point, 1.2, name); pressWound(hit.point); }
      } else if (alive) die('slash');
      if (trooper.fallen) jolt(body, hit);
    } else {
      chip(body, hit.point, hit.velocity, FEEL.armor.graze);
      if (alive && standing) react(hit.velocity, hit.point, 0.8, name);
      else if (alive) { suffer(0.7); jolt(body, hit); }
      else jolt(body, hit);
    }
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
    return { x: at.x, z: at.z, radius: 0.36 };
  }

  /** Free to act on his own: up, alive, not in the Force's grip, not running off, rearming or reeling. */
  const free = () => !trooper.dead && !trooper.fallen && !towing && !levitating && !dropping && !flee && !fetching && !pickup && !lifting && !collapse && turnBack === null;

  /** Pulls the trigger: a bolt leaves the muzzle along the barrel (null when he cannot fire). */
  function fire() {
    if (!trooper.holding || !free() || reaction.aim < 0.75 || reaction.wound) return null;
    holder.updateWorldMatrix(true, false);
    const from = holder.localToWorld(MUZZLE.clone());
    const direction = new THREE.Vector3(0, 0, 1).transformDirection(holder.matrixWorld);
    // The kick: the muzzle jumps, the shoulder and head take it.
    reaction.vrecoil += 9;
    reaction.vpitch -= 0.25;
    reaction.vhead -= 0.5;
    feed.push({ type: 'shot', point: from.clone() });
    return { from, direction };
  }

  /** A blaster bolt travelling from a to b: the part of him it hits first (or null). */
  function boltHit(a, b, radius = 0.025) {
    let best = null;
    for (const body of ragdoll.bodies) {
      if (!body.capsule || body.name === 'blaster') continue;
      const p0 = ragdoll.particles[body.indices[body.capsuleSlots[0]]].position;
      const p1 = ragdoll.particles[body.indices[body.capsuleSlots[1]]].position;
      const result = closest(a, b, p0, p1);
      if (result.distance > body.capsule[2] + radius || (best && result.s >= best.s)) continue;
      best = { body, s: result.s, t: result.t, point: result.c1, axisPoint: result.c2 };
    }
    return best;
  }
  /** A round, glowing burn where a bolt struck the armour. */
  function burn(body, point, axisPoint) {
    const normal = temp.subVectors(point, axisPoint);
    if (normal.lengthSq() < 1e-8) return;
    normal.normalize();
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), material);
    mark.name = 'Blaster burn';
    mark.quaternion.setFromUnitVectors(temp2.set(0, 0, 1), normal);
    mark.position.copy(axisPoint).addScaledVector(normal, body.capsule[2] * 0.97);
    trooper.debris.add(mark);
    mark.updateMatrixWorld(true);
    body.object.attach(mark);
    marks.push(mark);
    effects?.glow(material, 3);
  }
  /**
   * Struck by a bolt (one the blade sent back): it burns into the armour and
   * throws him back. In the head or chest it kills; in a limb it staggers him,
   * an arm loses the rifle, a leg gives way. Returns the event.
   */
  function shot(hit, velocity) {
    const { body } = hit;
    const name = body.name;
    const along = velocity.clone().normalize(), speed = velocity.length();
    const event = { type: 'shot', part: name, point: hit.point.clone(), velocity: velocity.clone(), speed };
    const wasDead = trooper.dead, wasStanding = !trooper.fallen && !trooper.dead;
    effects?.sparks(hit.point, along.clone().negate().add(temp.set(0, 0.4, 0)).normalize(), temp2.set(along.z, 0, -along.x).normalize(), { count: Math.round(pick(FEEL.sparks.slash, random)), speed: 3 });
    effects?.flash(hit.point, 0.9);
    effects?.burst(hit.point, { normal: along.clone().negate(), power: 0.5 });
    flashPart(body, 1);
    burn(body, hit.point, hit.axisPoint);
    chip(body, hit.point, velocity, FEEL.armor.slash);
    const blow = along.clone().multiplyScalar(4.5);
    pending = null;
    if (wasStanding) {
      if (name === 'head' || name === 'torso' || (name === 'pelvis' && random() < 0.5)) die('bolt', blow);
      else if (/^(thigh|shin|foot)/.test(name)) { react(blow, hit.point, 1.2, name); reaction.imbalance += 0.7; }
      else {
        react(blow, hit.point, 1.1, name);
        if (/^(upperArm|forearm|hand)/.test(name)) dropBlaster(blow);
        else pressWound(hit.point);
      }
    } else if (!trooper.dead) { suffer(1); jolt(body, { velocity: blow }); }
    else jolt(body, { velocity: blow });
    if (pending) stagger(pending);
    if (!wasDead && trooper.dead) event.lethal = true;
    if (wasStanding && trooper.fallen) event.felled = true;
    return event;
  }

  trooper.particle = name => ragdoll.particles[particleIndex[name]];
  trooper.indexOf = name => particleIndex[name];
  /** Slows his flying body (it hit something). */
  trooper.slow = factor => {
    for (const index of joinedIndices()) {
      const particle = ragdoll.particles[index];
      if (!particle.kinematic) particle.previous.lerp(particle.position, 1 - factor);
    }
  };
  /** Where the threat is (the hero), so that he gets up facing it. */
  trooper.focus = null;
  build();
  Object.assign(trooper, { update, strike, reset, dispose, blocker, cut, die, fall, forcePush, forcePull, hold, drop, fire, boltHit, shot, throwGrenade });
  Object.defineProperties(trooper, {
    reaction: { get: () => reaction },
    /** In the middle of throwing a grenade. */
    throwing: { get: () => Boolean(throwing) },
    /** On his feet and his own master: his brain can move him. */
    free: { get: free },
    /** How he is moving (world, m/s). */
    velocity: { get: () => loco.velocity },
    /** His heading (rad). */
    heading: { get: headingOf },
    /** Where a bolt would leave his rifle. */
    muzzle: { get: () => { holder.updateWorldMatrix(true, false); return holder.localToWorld(MUZZLE.clone()); } },
    /** Where his eyes are. */
    eye: { get: () => joints.neck.localToWorld(new THREE.Vector3(0, 0.19, 0.09)) },
    /** Where his rifle lies, if it is on the floor (null in his hands, or when he cannot hold one). */
    rifle: { get: () => (trooper.holding || !bodies.blaster.dynamic || armCut('L') || armCut('R') ? null : centroid(bodies.blaster.indices).setY(0)) },
    crawl: { get: () => crawl },
    recovery: { get: () => recover },
    towing: { get: () => towing },
    spasm: { get: () => spasm },
    /** News for the game since the last call: landings, armour lost, pulled, up, rearmed. */
    news: { get: () => feed.splice(0) },
    /** Armour still on him. */
    armour: { get: () => Object.values(pieces).filter(piece => !piece.userData.loose).length },
    /**
     * 'standing', 'wounded', 'pulled', 'held', 'dropping', 'fleeing', 'dazed',
     * 'rearming', 'stunned', 'rising', 'down', 'crawling' or 'dead'.
     */
    state: {
      get: () => {
        if (trooper.dead) return 'dead';
        if (!trooper.fallen) return towing ? 'pulled' : levitating ? 'held' : dropping ? 'dropping' : flee ? 'fleeing' : pickup || fetching ? 'rearming' : reaction.daze > 0.2 ? 'dazed' : reaction.wound ? 'wounded' : 'standing';
        if (lifting) return 'pulled';
        if (recover) return recover.stage === 'rising' ? 'rising' : 'stunned';
        return crawl?.stage === 'crawl' ? 'crawling' : 'down';
      },
    },
  });
  return trooper;
}

/**
 * The squad's bodies meet: a body thrown into a standing trooper knocks him
 * over (and is slowed), and bodies on the floor shove each other aside.
 */
export function collideSquad(troopers) {
  const speed = new THREE.Vector3();
  for (const a of troopers) {
    if (!a.fallen) continue;
    for (const b of troopers) {
      if (a === b) continue;
      if (!b.fallen) {
        const block = b.blocker();
        if (!block || b.dead) continue;
        for (const name of ['W', 'N', 'HT', 'HL', 'HR']) {
          const index = a.indexOf(name), particle = a.ragdoll.particles[index];
          if (particle.kinematic || particle.position.y > 1.7) continue;
          if (Math.hypot(particle.position.x - block.x, particle.position.z - block.z) > block.radius + particle.radius) continue;
          a.ragdoll.velocity(index, speed);
          if (speed.length() < 2.2) continue;
          b.forcePush(speed.clone().multiplyScalar(0.65).setY(1.4));
          a.slow(0.45);
          break;
        }
      } else if (troopers.indexOf(a) < troopers.indexOf(b)) {
        for (const p of a.ragdoll.particles) {
          if (p.kinematic) continue;
          for (const q of b.ragdoll.particles) {
            if (q.kinematic) continue;
            const reach = p.radius + q.radius;
            const dx = q.position.x - p.position.x, dy = q.position.y - p.position.y, dz = q.position.z - p.position.z;
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared >= reach * reach || squared < 1e-10) continue;
            const distance = Math.sqrt(squared), push = (reach - distance) * 0.5 / distance;
            // Apart without adding speed: bodies piled up stay calm.
            for (const [particle, sign] of [[p, -1], [q, 1]]) {
              particle.position.x += dx * push * sign; particle.position.y += dy * push * sign; particle.position.z += dz * push * sign;
              particle.previous.x += dx * push * sign; particle.previous.y += dy * push * sign; particle.previous.z += dz * push * sign;
            }
          }
        }
      }
    }
  }
}
