import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacter } from './character.js';
import { createRig, LEG_LENGTH } from './rig.js';
import { MOCAP_BONES, MOCAP_CLIPS } from './mocap-clips.js';
import { createSaber } from './saber.js';
import { createStage } from './stage.js';
import { createLab, onScreen } from './lab.js';
import { createArena, ARENA } from './arena.js';
import { createTransformer } from './transformer.js';
import { MotionController } from './motion.js';
import { FEEL } from './feel.js';
import { MOVES, STANCES, CombatController } from './combat.js';
import { createStormtrooper, collideSquad } from './stormtrooper.js';
import { buildTrooperParts } from './trooper-model.js';
import { createGait, GAIT_JOINTS } from './trooper-gait.js';
import { Ragdoll } from './ragdoll.js';
import { createNav } from './nav.js';
import { createSquadMind, patrolRounds } from './trooper-ai.js';
import { createScorchMarks, emberTexture } from './scorch-marks.js';
import { createGrenades } from './grenades.js';
import { createDebris } from './debris.js';
import { returnDirection } from './deflect.js';

/**
 * Cooks the game for Godot (docs/MIGRATION_GODOT.md): builds each model with
 * the game's own code — here, in the browser, where the textures can be
 * painted — exports it as binary glTF, and sends it with the data the Godot
 * port reads (motion capture, FEEL, obstacles) and reference traces its
 * parity tests replay, to scripts/bake-server.mjs, which writes them into godot/.
 */
const SERVER = 'http://127.0.0.1:5199/save/';
const out = document.querySelector('#log');
const log = line => { out.textContent += `${line}\n`; };
async function save(path, body) {
  const response = await fetch(SERVER + path, { method: 'POST', body });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  log(`✔ ${path} (${Math.round((body.byteLength ?? body.length) / 1024)} Ko)`);
}
const json = (path, data) => save(path, new TextEncoder().encode(JSON.stringify(data)));
const round = value => Math.round(value * 1e5) / 1e5;
const toArray = vector => vector.toArray().map(round);

/**
 * Instanced meshes become one plain mesh each, every instance's copy merged
 * in, its colour (instanceColor) carried as vertex colours: Godot's glTF
 * importer does not read EXT_mesh_gpu_instancing.
 */
function expandInstances(root) {
  const instanced = [];
  root.traverse(node => { if (node.isInstancedMesh) instanced.push(node); });
  const matrix = new THREE.Matrix4(), colour = new THREE.Color();
  for (const mesh of instanced) {
    const parts = [];
    for (let i = 0; i < mesh.count; i++) {
      const part = mesh.geometry.clone();
      mesh.getMatrixAt(i, matrix);
      part.applyMatrix4(matrix);
      if (mesh.instanceColor) {
        mesh.getColorAt(i, colour);
        const count = part.attributes.position.count, base = part.attributes.color;
        const colours = new Float32Array(count * 3);
        for (let v = 0; v < count; v++) colours.set(base ? [base.getX(v) * colour.r, base.getY(v) * colour.g, base.getZ(v) * colour.b] : [colour.r, colour.g, colour.b], v * 3);
        part.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      }
      parts.push(part.index ? part.toNonIndexed() : part);
    }
    const parent = mesh.parent;
    parent.remove(mesh);
    if (!parts.length) continue;
    const material = mesh.instanceColor ? [].concat(mesh.material).map(m => Object.assign(m.clone(), { vertexColors: true }))[0] : mesh.material;
    const plain = new THREE.Mesh(mergeGeometries(parts), material);
    plain.name = mesh.name;
    plain.position.copy(mesh.position); plain.quaternion.copy(mesh.quaternion); plain.scale.copy(mesh.scale);
    plain.castShadow = mesh.castShadow; plain.receiveShadow = mesh.receiveShadow;
    plain.visible = mesh.visible;
    parent.add(plain);
  }
}

/**
 * Exports `object` as .glb. Materials drawn brighter than white (glowing
 * strips, lamps: unlit, not tone mapped) lose that in glTF: each is named
 * and listed with its real colour, for Godot to give it back as emission.
 */
const glowing = {};
async function glb(path, object, emitters = []) {
  const scene = new THREE.Scene();
  scene.add(object);
  expandInstances(object);
  object.traverse(node => {
    const materials = node.material ? [].concat(node.material) : [];
    for (const material of materials) {
      if (!material.isMeshBasicMaterial || material.toneMapped !== false) continue;
      material.name ||= `emitter ${emitters.length}`;
      if (!emitters.some(entry => entry.name === material.name)) emitters.push({ name: material.name, color: material.color.toArray().map(round), additive: material.blending === THREE.AdditiveBlending });
    }
  });
  const data = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
  await save(path, data);
  glowing[path.split('/').pop()] = emitters;
  return emitters;
}

// ---- The hero: the skinned Jedi in his rest pose (T-pose, identity rotations), the saber socket in his hand ----
async function bakeHero() {
  const hero = createCharacter();
  const rig = createRig();
  const list = MOCAP_BONES.map(name => hero.rig.bones[name]);
  list.forEach((bone, index) => { bone.position.copy(rig.restPositions[index]); bone.quaternion.identity(); });
  hero.root.position.set(0, 0, 0);
  hero.root.rotation.set(0, 0, 0);
  hero.root.updateMatrixWorld(true);
  await glb('assets/baked/hero.glb', hero.root);
  // The motion capture as the animator uses it (strides widened), and what it measured on this rig.
  const clips = Object.fromEntries(Object.entries(hero.animator.clips).map(([name, clip]) => [name, {
    fps: clip.fps, frames: clip.frames, loop: clip.loop, legLength: clip.legLength,
    rotations: clip.rotations.map(frame => Array.from(frame, round)), hips: clip.hips.map(h => h.map(round)), ground: clip.ground.map(round),
  }]));
  await json('assets/data/mocap.json', {
    bones: MOCAP_BONES, rest: rig.restPositions.map(toArray), legLength: LEG_LENGTH, scale: round(hero.animator.scale),
    cycle: { walk: round(hero.animator.cycle.walk), run: round(hero.animator.cycle.run) }, clips,
  });
  // A reference trace for the animator's port: the pose after each step of a scripted run.
  const fresh = createCharacter();
  const steps = [], frames = [];
  for (let i = 0; i < 240; i++) {
    const t = i / 60, speed = i < 40 ? 0 : i < 120 ? 1.7 : i < 200 ? 4.2 : 0.8;
    const step = { dt: 1 / 60, time: t, speed, runBlend: speed > 2 ? 1 : 0, sprintIntent: speed > 3.5 ? 1 : 0, turnRate: i > 150 && i < 180 ? 2 : 0, forwardAccel: i === 41 ? 12 : 0 };
    fresh.update(step);
    steps.push(step);
    if (i % 10 === 9) {
      frames.push({
        step: i, quaternions: MOCAP_BONES.map(name => toArray(fresh.rig.bones[name].quaternion)),
        hips: toArray(fresh.rig.bones.Hips.position), phase: round(fresh.animator.state.phase),
      });
    }
  }
  await json('assets/data/animator-reference.json', { steps, frames });
}

// ---- The sword work: the moves and stances, a trace of the combat controller, and of the arms it drives ----
// The script both traces play: at a step, calls on the controller (a strike pressed, a parry, a power…), and
// what is held (the guard, B kept down, a trooper held by the Force), where the target is, the blade's lead.
const COMBAT_SCRIPT = {
  10: [['flourish']], 60: [['attack', { speed: 0 }]], 75: [['attack', { speed: 0 }]], 100: [['attack', { speed: 0 }]],
  130: [['attack', { speed: 0 }]], 175: [['attack', { speed: 0 }]], 230: [['attack', { speed: 0 }]], 300: [['parry']],
  312: [['parry']], 330: [['power', 'forcePush']], 345: [['power', 'forcePull']], 380: [['power', 'forcePull']],
  470: [['twirl']], 520: [['attack', { speed: 4 }]], 545: [['attack', { speed: 0, aim: { angle: 1.2, distance: 2 } }]],
  600: [['attack', { speed: 0, aim: { angle: 2.8, distance: 1.5 } }]], 660: [['attack', { speed: 0, aim: { angle: -2.5, distance: 3 } }]],
  710: [['deflect', 'left']], 722: [['deflect', 'back']], 735: [['deflect', 'back']], 760: [['impale']], 830: [['unpin']],
  880: [['plunge']], 905: [['loose']], 990: [['plunge']], 1000: [['uncock']], 1030: [['cancel']],
};
const combatHeld = i => ({
  guard: (i >= 200 && i < 260) || (i >= 1040 && i < 1080), speed: i >= 500 && i < 540 ? 4 : i >= 1040 ? 1.5 : 0,
  hold: i >= 390 && i < 460, charging: (i >= 140 && i < 200) || (i >= 1080 && i < 1100), lead: i >= 545 && i < 580 ? 0.4 : 0,
  ...(i === 440 ? { aim: { angle: 0.3, distance: 2 } } : {}),
});
// Uneven frame times, as the motion trace.
const combatDt = i => (i % 7 === 0 ? 0.0311 : 0.0163);
// The draws the controller makes, from a fixed list (the Godot test draws the same).
const DRAWS = Array.from({ length: 97 }, (_, i) => round((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1);
function scriptedCombat() {
  let draw = 0;
  return new CombatController({ random: () => DRAWS[draw++ % DRAWS.length] });
}
function playCombat(combat, i) {
  const results = [];
  for (const [call, argument] of COMBAT_SCRIPT[i] ?? []) results.push(Boolean(combat[call](argument)));
  return results;
}
const poseOut = out => ({
  hand: toArray(out.hand), blade: toArray(out.blade), left: toArray(out.left),
  grip: round(out.grip), yaw: round(out.yaw), pitch: round(out.pitch), crouch: round(out.crouch), weight: round(out.weight), lift: round(out.lift),
});
async function bakeCombat() {
  await json('assets/data/combat.json', { moves: MOVES, guard: STANCES.guard, hold: STANCES.hold, parries: STANCES.parries });
  const combat = scriptedCombat(), states = [];
  for (let i = 0; i < 1100; i++) {
    const results = playCombat(combat, i);
    const out = combat.update(combatDt(i), combatHeld(i));
    states.push({
      ...poseOut(out), results, started: combat.takeStart(), fired: combat.takeForce(),
      name: out.name, guard: round(out.guard), spin: round(out.spin), drive: round(out.drive), trail: round(out.trail), flare: round(out.flare), shake: round(out.shake),
      inputScale: round(out.inputScale), turnScale: round(out.turnScale), maxSpeed: Number.isFinite(out.maxSpeed) ? round(out.maxSpeed) : -1, engaged: out.engaged,
      hits: combat.hits, sequence: combat.sequence, side: combat.side ?? null,
    });
  }
  await json('assets/data/combat-reference.json', { draws: DRAWS, script: COMBAT_SCRIPT, steps: Array.from({ length: 1100 }, (_, i) => ({ dt: combatDt(i), ...combatHeld(i) })), states });
  // The arms: the same play fed to the Jedi (walking now and then), the bones and the blade's socket after each step.
  const hero = createCharacter(), arms = scriptedCombat(), steps = [], frames = [];
  for (let i = 0; i < 1100; i++) {
    playCombat(arms, i);
    const action = arms.update(combatDt(i), combatHeld(i));
    const speed = i >= 500 && i < 540 ? 4 : i >= 1040 ? 1.5 : 0;
    const step = { dt: combatDt(i), time: round(i / 60), speed, runBlend: speed > 2 ? 1 : 0, sprintIntent: 0, turnRate: 0, forwardAccel: 0, action: poseOut(action) };
    hero.update({ ...step, action });
    steps.push(step);
    if (i % 10 === 9) {
      frames.push({
        step: i, quaternions: MOCAP_BONES.map(name => toArray(hero.rig.bones[name].quaternion)),
        hips: toArray(hero.rig.bones.Hips.position), socket: toArray(hero.saberSocket.quaternion),
      });
    }
  }
  await json('assets/data/arms-reference.json', { steps, frames });
}

// ---- The saber: hilt and blade ----------------------------------------------------------
async function bakeSaber() {
  const socket = new THREE.Group();
  const scene = new THREE.Scene();
  createSaber({ socket, scene });
  await glb('assets/baked/saber.glb', socket);
}

// The squad's posts in the lab, as main.js: sentries and patrols among the crates.
// Screen directions as headings: down (towards the camera) 0.68, up -2.47, left -0.9, right 2.24.
function labPosts() {
  const posts = [
    { position: onScreen(-2.4, 5.4), heading: -0.9 },
    { position: onScreen(0.3, 5.7), route: [onScreen(0.3, 5.7), onScreen(4.7, 6.2), onScreen(4.9, 7.6), onScreen(0.8, 7.9)] },
    { position: onScreen(4.1, 8.4), heading: -2.47 },
    { position: onScreen(-5.6, 2.7), route: [onScreen(-5.6, 2.7), onScreen(-5.4, 7.2)] },
    { position: onScreen(-0.6, 8.1), heading: 2.24 },
  ];
  for (const post of posts) post.heading ??= Math.atan2(post.route[1].x - post.route[0].x, post.route[1].z - post.route[0].z);
  return posts;
}

// ---- The lab: deck, crates, room, the transformer; its obstacles, the great door, the squad's posts ------------
async function bakeLab() {
  const scene = new THREE.Scene();
  const stage = createStage(scene, { bounds: ARENA });
  const lab = createLab(scene);
  const arena = createArena(scene, { lab, floorMaterial: stage.material });
  const transformer = createTransformer(scene, { lab, at: new THREE.Vector3(7.4, 0, -10.675), facing: new THREE.Vector3(0, 0, 1) });
  lab.update(0);
  arena.update(0);
  // The door's leaves are named, for Godot to slide them.
  const door = arena.door;
  door.leaves.forEach((leaf, index) => { leaf.name = `Door leaf ${index}`; });
  const level = new THREE.Group();
  level.name = 'Lab';
  for (const child of [...scene.children]) level.add(child);
  const emitters = await glb('assets/baked/lab.glb', level);
  await json('assets/data/lab.json', {
    bounds: ARENA,
    obstacles: lab.obstacles.map(box => ({ kind: box.kind, min: toArray(box.min), max: toArray(box.max) })),
    emitters,
    transformer: { socket: toArray(transformer.socket), approach: toArray(transformer.approach), facing: toArray(transformer.facing) },
    door: {
      centre: toArray(door.centre), out: toArray(door.out), along: toArray(door.along), width: round(door.width),
      inside: door.inside.map(toArray), shut: lab.obstacles.indexOf(door.shut),
      leaves: door.leaves.map(leaf => ({ name: leaf.name, closed: round(leaf.userData.closed), open: round(leaf.userData.open) })),
    },
    posts: labPosts().map(post => ({ position: toArray(post.position), heading: round(post.heading), ...(post.route ? { route: post.route.map(toArray) } : {}) })),
  });
}

// ---- The stormtrooper: his parts, the raw capture his gait plays, and traces of him, his ragdoll, his squad ----
const trooperMaterials = () => ({
  armor: new THREE.MeshStandardMaterial({ name: 'armour', color: 0xcbd0d6, roughness: 0.48, metalness: 0 }),
  shade: new THREE.MeshStandardMaterial({ name: 'shade', color: 0x44494f, roughness: 0.6, metalness: 0.05 }),
  black: new THREE.MeshStandardMaterial({ name: 'suit', color: 0x15161a, roughness: 0.8, metalness: 0 }),
  lens: new THREE.MeshStandardMaterial({ name: 'lens', color: 0x07080b, roughness: 0.18, metalness: 0.1 }),
});
/** A group's own meshes (not its armour plates) as one: a primitive per material, in the group's frame. */
function mergeOwn(group, name) {
  const byMaterial = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal') geometry.deleteAttribute(key);
    if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
    byMaterial.get(child.material).push(geometry);
    group.remove(child);
  }
  if (!byMaterial.size) return;
  const materials = [...byMaterial.keys()];
  const mesh = new THREE.Mesh(mergeGeometries(materials.map(material => mergeGeometries(byMaterial.get(material))), true), materials);
  mesh.name = name;
  group.add(mesh);
}
// The draws a trace's troopers and squad make, from the fixed list (each its own run through it).
const drawsFrom = start => { let draw = start; return Object.assign(() => DRAWS[draw++ % DRAWS.length], { restart: () => { draw = start; } }); };
const vector = values => new THREE.Vector3(...values);

/**
 * The trooper's trace: one man (no obstacles) taken through what can happen
 * to him, a scene at a time (reset between them): walking, running, aiming,
 * crouching, firing, a grenade; blows of the blade, slow and fast, a wound,
 * a limb off, a fall and the crawl; the Force's push, getting back up and
 * fetching the rifle; pulled, held up and let go, running off; hauled up off
 * the floor; run through; beheaded; a bolt in the body, treated.
 * Each step: its dt and time, his orders if they change, calls on him, the
 * blade where it is (struck with the step before's).
 */
function trooperScript() {
  const steps = [];
  let time = 0;
  const add = (count, make = () => ({})) => {
    for (let k = 0; k < count; k++) {
      const dt = combatDt(steps.length);
      time += dt;
      steps.push({ dt, time: round(time), ...make(k) });
    }
  };
  const order = (fields = {}) => ({ velocity: [0, 0, 0], face: null, aimAt: null, aim: false, crouch: false, blind: false, over: null, look: null, drag: null, tend: null, ...fields });
  const scene = (name, focus = [0, 0, 3]) => ({ scene: name, calls: [['reset']], order: order(), focus });
  // A blade swung round the hero's hand in front of him (the hero just before the trooper, facing him):
  // horizontal at `height`, from angle a0 to a1 over `frames` steps (a tilt `dip` makes it diagonal).
  // Placed where the trooper stands when it starts (see aimSweep); the script keeps where it went.
  // With a `target` joint, the sweep goes through it: its height, and angles a0, a1 from where it lies.
  const sweep = (blow, height, a0, a1, frames, { dip = 0, length = 1.5, z = 0.9, target = null } = {}) => k => ({ sweep: { blow, height, a0, a1, frames, k, dip, length, z, target } });
  // Walking, running, aiming, crouched, blind fire, looking, backing away; a shot and a grenade.
  add(1, () => scene('walk'));
  add(29);
  add(90, k => (k === 0 ? { order: order({ velocity: [1, 0, 0.6] }) } : {}));
  add(80, k => (k === 0 ? { order: order({ velocity: [0, 0, 3.6], aim: true, aimAt: [3, 1.2, 8] }) } : k === 40 ? { calls: [['fire']] } : {}));
  add(30, k => (k === 0 ? { order: order({ crouch: true, aim: true, aimAt: [2, 1.1, -3] }) } : {}));
  add(30, k => (k === 0 ? { order: order({ crouch: true, blind: true, over: 1.0, aimAt: [2, 1.1, -3] }) } : k === 20 ? { calls: [['fire']] } : {}));
  add(40, k => (k === 0 ? { order: order({ look: [-3, 1.5, 2] }) } : k === 10 ? { calls: [['throwGrenade', [4, 0, 4]]] } : {}));
  add(60, k => (k === 0 ? { order: order({ velocity: [-1.2, 0, 0], face: 1.57, aim: true, aimAt: [4, 1.2, 1] }) } : {}));
  // The blade: a slow graze, a wounding slash, an arm off, a leg — he falls, alive, and crawls.
  add(1, () => scene('blows', [0, 0, 1]));
  add(19);
  add(70, sweep(1, 1.25, 0.9, -0.9, 70, { length: 0.95, z: 0.75 }));
  add(20);
  add(7, sweep(2, 1.2, 1.0, -1.0, 7));
  add(12);
  add(6, sweep(3, 0, 0.45, -0.03, 6, { target: 'elbowL' }));
  add(40);
  add(7, sweep(4, 0.45, 1.2, -1.2, 7));
  add(600);
  // The Force's push: thrown, stunned, back up, dazed; he goes for his rifle.
  add(1, () => scene('push', [0, 0, 4]));
  add(9);
  add(1, () => ({ calls: [['forcePush', [0.5, 3, -7]]] }));
  add(560);
  // Pulled and held up before the hero, following him; let go, he lands and runs off.
  add(1, () => scene('pull', [0, 0, 3.5]));
  add(9);
  add(1, () => ({ calls: [['forcePull', [0, 0.5, 2.25], { hold: true }]] }));
  add(130, k => ({ calls: [['hold', [Math.sin(k * 0.03) * 0.6, 0.5, 2.25], Math.PI]] }));
  add(1, () => ({ calls: [['drop']] }));
  add(260);
  // Pushed down, then hauled up off the floor and in.
  add(1, () => scene('lift', [0, 0, 4]));
  add(9);
  add(1, () => ({ calls: [['forcePush', [0, 2.6, -6]]] }));
  add(70);
  add(1, () => ({ calls: [['forcePull', [0, 0, 2.6]]] }));
  add(200);
  // Run through: he struggles on the blade, dies and hangs from it; then slides off.
  add(1, () => scene('impale', [0, 0, 1]));
  add(9);
  add(1, () => ({ calls: [['impale', [0, 1.1, 0.05], Math.PI]] }));
  add(300, k => ({ calls: [['skewer', [Math.sin(k * 0.05) * 0.05, 1.1, 0.05], Math.PI]] }));
  add(1, () => ({ calls: [['slideOff', [0, -0.3, -0.4]]] }));
  add(150);
  // Beheaded (after a first, wounding blow): he stands a heartbeat, collapses, twitches.
  add(1, () => scene('neck', [0, 0, 1]));
  add(9);
  add(7, sweep(5, 1.2, 1.0, -1.0, 7));
  add(12);
  add(6, sweep(6, 1.62, 1.1, -1.1, 6));
  add(240);
  // A bolt in the body: down and hurt; tended, dragged a little, treated; he gets up.
  add(1, () => scene('bolt', [0, 0, 5]));
  add(9);
  add(1, () => ({ calls: [['shot', [0.3, 1.0, 4], [-0.1, 1.0, -2], 12.5]] }));
  add(120, () => ({ calls: [['attend']] }));
  add(60, k => ({ calls: [['attend'], ['drag', [0, 0.45, round(-0.4 - k * 0.012)], [0, 0, -0.72]]] }));
  add(1, () => ({ calls: [['drag', null], ['heal']] }));
  add(220);
  return steps;
}
/** A sweep's blade this step, in the world: round where the trooper stood (and faced) as it started. */
function aimSweep(step, trooper, anchor) {
  const s = step.sweep;
  if (s.k === 0) {
    Object.assign(anchor, { at: trooper.root.position.clone().setY(0), turn: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), trooper.heading), height: s.height, a0: s.a0, a1: s.a1 });
    if (s.target) {
      const local = trooper.joints[s.target].getWorldPosition(new THREE.Vector3()).sub(anchor.at).applyQuaternion(anchor.turn.clone().invert());
      const along = Math.atan2(local.x, s.z - local.z);
      Object.assign(anchor, { height: local.y, a0: along + s.a0, a1: along + s.a1 });
    }
  }
  const a = anchor.a0 + (anchor.a1 - anchor.a0) * Math.min(1, s.k / (s.frames - 1));
  const direction = new THREE.Vector3(Math.sin(a), s.dip * (s.k / (s.frames - 1) - 0.5), -Math.cos(a)).normalize().applyQuaternion(anchor.turn);
  const base = new THREE.Vector3(0, anchor.height, s.z).applyQuaternion(anchor.turn).add(anchor.at);
  step.blade = [...toArray(base), ...toArray(base.clone().addScaledVector(direction, s.length))];
  step.blow = s.blow;
  delete step.sweep;
}
const trooperArgument = value => (Array.isArray(value) ? vector(value) : value);
function playTrooper(trooper, step) {
  const results = [];
  for (const [call, ...args] of step.calls ?? []) {
    if (call === 'reset') { trooper.reset(); continue; }
    if (call === 'shot') {
      const [a, b, speed] = args, hit = trooper.boltHit(vector(a), vector(b));
      results.push(hit ? trooper.shot(hit, vector(b).sub(vector(a)).normalize().multiplyScalar(speed)).type : null);
      continue;
    }
    if (call === 'forcePull') { results.push(Boolean(trooper.forcePull(vector(args[0]), args[1] ?? {}))); continue; }
    if (call === 'fire') { const shot = trooper.fire(); results.push(shot ? [...toArray(shot.from), ...toArray(shot.direction)] : null); continue; }
    const value = trooper[call](...args.map(trooperArgument));
    results.push(value === undefined || value === null ? null : typeof value === 'object' ? true : value);
  }
  if (step.order) {
    const o = trooper.order, given = step.order;
    o.velocity.fromArray(given.velocity);
    Object.assign(o, { face: given.face, aim: given.aim, crouch: given.crouch, blind: given.blind, over: given.over });
    for (const key of ['aimAt', 'look', 'drag', 'tend']) o[key] = given[key] ? vector(given[key]) : null;
  }
  if (step.focus) trooper.focus = vector(step.focus);
  return results;
}
const TROOPER_JOINTS = ['pelvis', 'spine', 'neck', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR', 'holder'];

async function bakeTrooper() {
  // The model: each part a mesh (a primitive per material) at its joint's origin, its plates as pieces of their own.
  const { parts } = buildTrooperParts(trooperMaterials());
  // Each plate's bounds in its own frame, as stormtrooper.js's localBox() measures them
  // (each mesh's box carried into the plate's frame): where its loose particles go.
  const plates = {};
  for (const part of Object.values(parts)) {
    part.updateMatrixWorld(true);
    for (const piece of part.children) {
      if (!piece.userData.armour) continue;
      const inverse = piece.matrixWorld.clone().invert(), box = new THREE.Box3(), bounds = new THREE.Box3(), relative = new THREE.Matrix4();
      piece.traverse(child => {
        if (!child.isMesh) return;
        child.geometry.computeBoundingBox();
        box.union(bounds.copy(child.geometry.boundingBox).applyMatrix4(relative.multiplyMatrices(inverse, child.matrixWorld)));
      });
      plates[piece.name] = { min: toArray(box.min), max: toArray(box.max) };
    }
  }
  const model = new THREE.Group();
  model.name = 'Stormtrooper';
  for (const [name, part] of Object.entries(parts)) {
    mergeOwn(part, `${name} skin`);
    for (const piece of part.children) if (piece.userData.armour) mergeOwn(piece, `${piece.name} skin`);
    model.add(part);
  }
  await glb('assets/baked/stormtrooper.glb', model);
  // The capture his gait plays, as captured (not widened as the hero's).
  const clips = Object.fromEntries(['idle', 'walk', 'run'].map(name => {
    const clip = MOCAP_CLIPS[name];
    return [name, { fps: clip.fps, frames: clip.frames, speed: clip.speed, legLength: clip.legLength, rotations: clip.rotations, hips: clip.hips, ground: clip.ground }];
  }));
  await json('assets/data/trooper.json', { clips, plates });

  // The gait: a scripted walk, run (the legs twisted), turn on the spot and backing away.
  const gait = createGait({ legLength: 0.63, offset: 0.37 }), gaitSteps = [], gaitFrames = [];
  for (let i = 0; i < 360; i++) {
    const step = { dt: combatDt(i), speed: i < 40 ? 0 : i < 120 ? 1.35 : i < 200 ? 3.7 : i < 260 ? 0 : 1.1, backward: i >= 300, turnRate: i >= 220 && i < 260 ? 2.4 : 0, twist: i >= 120 && i < 200 ? 0.35 : 0 };
    gait.update(step.dt, step);
    gait.twist(step.twist);
    gaitSteps.push(step);
    if (i % 5 === 4) gaitFrames.push({ step: i, rotations: GAIT_JOINTS.map(name => toArray(gait.rotations[name])), hips: toArray(gait.hips), ground: round(gait.ground), phase: round(gait.state.phase), motion: round(gait.state.motion), running: round(gait.state.running) });
  }
  await json('assets/data/gait-reference.json', { legLength: 0.63, offset: 0.37, joints: GAIT_JOINTS, steps: gaitSteps, frames: gaitFrames });

  // The ragdoll alone: a trooper's particles, bodies, joint ranges; thrown against a crate, a joint cut, shoved again.
  const sample = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(0.2, 0, -0.3), heading: 0.4, random: drawsFrom(3) });
  const source = sample.ragdoll;
  const layout = {
    particles: source.particles.map(p => ({ name: p.name, position: toArray(p.position), radius: p.radius, mass: round(1 / p.inverseMass) })),
    bodies: source.bodies.map(body => ({ name: body.name, indices: body.indices })),
    limits: source.constraints.filter(c => !c.body).map(c => ({ a: c.a, b: c.b, min: round(c.min), max: Number.isFinite(c.max) ? round(c.max) : -1, tag: c.tag })),
    adjacent: [...source.adjacent].map(key => key.split(':').map(Number)).filter(([a, b]) => a < b),
    boxes: [{ min: [0.6, 0, -2.4], max: [1.7, 1.2, -1.3] }],
  };
  const ragdoll = new Ragdoll();
  for (const p of layout.particles) ragdoll.addParticle({ name: p.name, position: vector(p.position), radius: p.radius, mass: p.mass });
  for (const body of layout.bodies) ragdoll.addBody(body);
  for (const limit of layout.limits) ragdoll.addLimit(limit.a, limit.b, limit.min, limit.max < 0 ? Infinity : limit.max, limit.tag);
  for (const [a, b] of layout.adjacent) ragdoll.connect(ragdoll.bodies[a], ragdoll.bodies[b]);
  ragdoll.boxes = layout.boxes.map(box => ({ min: vector(box.min), max: vector(box.max) }));
  const frames = [];
  const shoulder = layout.particles.findIndex(p => p.name === 'SL'), arm = ['upperArmL', 'forearmL', 'handL'].map(name => ragdoll.bodies.find(body => body.name === name));
  ragdoll.release(ragdoll.bodies);
  for (let i = 0; i < 240; i++) {
    if (i === 0) {
      ragdoll.push(ragdoll.particles.map((_, index) => index), new THREE.Vector3(1.2, 2.6, -3.1));
      ragdoll.particles.forEach((particle, index) => { if (index % 5 === 0) Object.assign(particle, { friction: 0.05, bounce: 0.38 }); });
    }
    if (i === 60) ragdoll.sever(shoulder, arm, 'shoulderL');
    if (i === 100) ragdoll.push(arm.flatMap(body => body.indices), new THREE.Vector3(-2, 3, 1));
    ragdoll.step(combatDt(i));
    if (i % 5 === 4) frames.push({ step: i, positions: ragdoll.particles.map(p => toArray(p.position)) });
  }
  await json('assets/data/ragdoll-reference.json', { layout, sever: { particle: shoulder, bodies: ['upperArmL', 'forearmL', 'handL'], tag: 'shoulderL', at: 60 }, frames });

  // The trooper himself, through every scene of his script. Between steps the scene's
  // world matrices are brought up to date, as the game's renderer does every frame.
  // Each scene draws from the start of the list again, so that one scene's chance
  // (a body lying a little differently) does not change the next.
  const stage = new THREE.Scene(), draws = drawsFrom(0);
  const trooper = createStormtrooper({ scene: stage, position: new THREE.Vector3(), heading: 0, random: draws });
  const script = trooperScript(), samples = [];
  let events = [], news = [], previous = null;
  const at = new THREE.Vector3(), anchor = {};
  for (const [i, step] of script.entries()) {
    if (step.scene) draws.restart();
    if (step.sweep) aimSweep(step, trooper, anchor);
    const results = playTrooper(trooper, step);
    trooper.update(step.dt, step.time);
    if (step.blade && previous) {
      const [b0, b1, b2, t0, t1, t2] = previous, [c0, c1, c2, d0, d1, d2] = step.blade;
      for (const event of trooper.strike(new THREE.Vector3(b0, b1, b2), new THREE.Vector3(t0, t1, t2), new THREE.Vector3(c0, c1, c2), new THREE.Vector3(d0, d1, d2), step.dt, step.time, step.blow)) {
        events.push(`${event.type}:${event.part}${event.joint ? `:${event.joint}` : ''}${event.lethal ? ':lethal' : ''}${event.felled ? ':felled' : ''}`);
      }
    }
    previous = step.blade ?? null;
    stage.updateMatrixWorld();
    for (const item of trooper.news) news.push(item.type);
    if (results.length) events.push(`calls:${JSON.stringify(results.map(value => (typeof value === 'number' ? round(value) : Array.isArray(value) ? value.map(round) : value)))}`);
    if (i % 5 !== 4) continue;
    const r = trooper.reaction;
    samples.push({
      step: i, root: toArray(trooper.root.position), quaternion: toArray(trooper.root.quaternion), state: trooper.state,
      fallen: trooper.fallen, dead: trooper.dead, holding: trooper.holding, severed: [...trooper.severed].sort(), armour: trooper.armour,
      reaction: [r.aim, r.crouch, r.blind, r.hurt, r.clutch, r.kneel, r.choke, r.gait, r.dangle, r.yank].map(round),
      joints: trooper.fallen ? null : TROOPER_JOINTS.map(name => toArray(trooper.joints[name].getWorldPosition(at))),
      particles: trooper.ragdoll.particles.map(p => toArray(p.position)),
      events, news,
    });
    events = [];
    news = [];
  }
  await json('assets/data/trooper-reference.json', { script, joints: TROOPER_JOINTS, samples });
}

/**
 * The squad in the lab: its navigation grid (paths, nearest spots, clear
 * lines), the cover the crates give, the escort's rounds — and a trace of
 * the five men at their posts, their minds and bodies, as the hero walks in,
 * is spotted and fought, hides, and is searched for.
 */
async function bakeSquad() {
  const scene = new THREE.Scene();
  const lab = createLab(scene);
  createArena(scene, { lab });
  createTransformer(scene, { lab, at: new THREE.Vector3(7.4, 0, -10.675), facing: new THREE.Vector3(0, 0, 1) });
  // The boxes as lab.json gives them to Godot (rounded), so that both work from the same numbers.
  for (const box of lab.obstacles) {
    box.min.fromArray(toArray(box.min));
    box.max.fromArray(toArray(box.max));
    box.centre = box.min.clone().add(box.max).multiplyScalar(0.5);
  }
  const nav = createNav(lab, ARENA);
  const probes = [[0, 0], [-4, -6], [5, -3], [-8, 4], [3, 5], [-2, -9], [6, 4], [0.5, -4.5], [-6.5, -2]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const paths = [];
  for (const from of probes) for (const to of probes) if (from !== to) paths.push({ from: toArray(from), to: toArray(to), path: nav.path(from, to)?.map(toArray) ?? null });
  const blocked = [];
  for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) blocked.push(nav.walkable(new THREE.Vector3(ARENA.minX + 0.35 + (i + 0.5) * nav.cell, 0, ARENA.minZ + 0.35 + (j + 0.5) * nav.cell)) ? 0 : 1);
  const cover = probes.slice(0, 4).map(threat => ({ threat: toArray(threat), spots: lab.coverSpots(threat, { minDistance: 2.5 }).map(spot => ({ position: toArray(spot.position), box: lab.obstacles.indexOf(spot.box), tall: spot.tall, facing: toArray(spot.facing) })) }));
  const lines = [];
  for (const from of probes) for (const to of probes) {
    if (from === to) continue;
    const hit = lab.segmentHit(from.clone().setY(1.1), to.clone().setY(0.8));
    lines.push({ from: toArray(from), to: toArray(to), free: nav.lineFree(from, to), hit: hit ? { t: round(hit.t), box: lab.obstacles.indexOf(hit.box), normal: toArray(hit.normal) } : null });
  }
  const nearest = probes.map(point => { const spot = nav.nearest(point.clone().add(new THREE.Vector3(0.3, 0, 0.2))); return spot ? toArray(spot) : null; });
  const rounds = patrolRounds({ lab, nav, bounds: ARENA }).map(points => points.map(toArray));
  await json('assets/data/nav-reference.json', { cols: nav.cols, rows: nav.rows, blocked: blocked.join(''), paths, cover, lines, nearest, rounds });

  // The squad: five men at their posts; the hero walks in, is seen, fights from the open, hides behind a crate, is lost.
  const posts = labPosts();
  const troopers = posts.map((post, index) => createStormtrooper({ scene, lab, position: post.position, heading: post.heading, random: drawsFrom(index * 11) }));
  const squad = createSquadMind({ troopers, lab, nav, posts, random: drawsFrom(60), cameraRight: new THREE.Vector3(10, 0, -8).normalize() });
  const way = [[0, 0, 0], [2, 0, 0], [6, -3.2, -3.6], [9, -3.2, -3.6], [10.5, -1.6, -1.2], [14, -1.6, -1.2], [15, 0.6, 0.4], [22, 0.6, 0.4]];
  const heroAt = t => {
    for (let k = 1; k < way.length; k++) {
      const [t0, x0, z0] = way[k - 1], [t1, x1, z1] = way[k];
      if (t <= t1) { const u = (t - t0) / (t1 - t0); return new THREE.Vector3(x0 + (x1 - x0) * u, 0, z0 + (z1 - z0) * u); }
    }
    return new THREE.Vector3(way.at(-1)[1], 0, way.at(-1)[2]);
  };
  const steps = [], frames = [];
  let time = 0, shots = [], cues = [];
  let noises = [];
  for (let i = 0; i < 1200; i++) {
    const dt = combatDt(i);
    const before = heroAt(time);
    time += dt;
    const hero = heroAt(time), heroVelocity = hero.clone().sub(before).divideScalar(dt);
    const saber = time > 2 ? 1 : 0;
    // What the squad hears: his running steps, his blade's hum close by (and, below, the shots).
    if (heroVelocity.length() > 2.4 && i % 18 === 0) noises.push({ position: hero.clone(), radius: 3.2, from: hero.clone() });
    if (saber && i % 36 === 0) noises.push({ position: hero.clone(), radius: 1.4, from: hero.clone(), strength: 0.6 });
    steps.push({
      dt, time: round(time), hero: toArray(hero), velocity: toArray(heroVelocity), saber,
      noises: noises.map(n => ({ position: toArray(n.position), radius: n.radius, from: toArray(n.from), strength: n.strength ?? 1, alarm: Boolean(n.alarm), source: n.source ? troopers.indexOf(n.source) : -1 })),
    });
    const thoughts = squad.update(dt, { hero, heroVelocity, saber, noises });
    noises = [];
    for (const shot of thoughts.shots) {
      shots.push(troopers.indexOf(shot.trooper));
      noises.push({ position: shot.from.clone(), radius: 12, alarm: true, from: hero.clone(), source: shot.trooper });
    }
    for (const cue of thoughts.cues) cues.push(`${cue.type}${cue.radio ? `:${cue.radio}` : ''}:${troopers.indexOf(cue.trooper)}`);
    for (const trooper of troopers) { trooper.focus = hero; trooper.update(dt, time); }
    collideSquad(troopers);
    // As the game's renderer does every frame.
    scene.updateMatrixWorld();
    if (i % 10 !== 9) continue;
    frames.push({
      step: i, shots, cues,
      minds: squad.minds.map(mind => ({
        mode: mind.mode, tactic: mind.tactic, role: mind.role, awareness: round(mind.awareness), seen: Number.isFinite(mind.seen) ? round(mind.seen) : -1,
        at: toArray(mind.trooper.root.position), heading: round(mind.trooper.heading), velocity: toArray(mind.trooper.order.velocity), state: mind.trooper.state,
      })),
    });
    shots = [];
    cues = [];
  }
  await json('assets/data/squad-reference.json', { draws: { troopers: 11, squad: 60 }, steps, frames });
}

// ---- Data: the game's feel, and a trace of the motion controller to replay ----------------------
async function bakeData() {
  await json('assets/data/feel.json', FEEL);
  const motion = new MotionController(), steps = [], states = [];
  for (let i = 0; i < 600; i++) {
    const phase = Math.floor(i / 60);
    const step = {
      // Uneven frame times, none landing a threshold (the saber's idle second) on the dot.
      dt: i % 7 === 0 ? 0.0311 : 0.0163,
      x: [0, 1, 1, 0, -0.6, 0, 0.3, 0, 1, 0][phase], z: [0, 0, 1, 1, -0.8, 0, 0.2, -1, 0, 0][phase],
      sprint: phase === 2 || phase === 8, analog: phase === 6, drive: phase === 9 ? 3 : 0,
    };
    motion.update(step.dt, step.x, step.z, { sprint: step.sprint, analog: step.analog, drive: step.drive });
    steps.push(step);
    states.push([motion.x, motion.z, motion.heading, motion.speed, motion.runBlend, motion.sprint, motion.saber, motion.turnRate, motion.forwardAccel].map(round));
  }
  await json('assets/data/motion-reference.json', { steps, states });
}

// ---- Effects: the burn textures, painted by the game's own code, as PNG ----------------------
/** A DataTexture's pixels as a PNG, its first row at the bottom (three.js's v runs up, Godot's down). */
async function png(path, image) {
  const { data, width, height } = image;
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++) pixels.data.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  context.putImageData(pixels, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await save(path, new Uint8Array(await blob.arrayBuffer()));
}
/**
 * The effects' references, for Godot's tests: grenades thrown into the lab
 * (bouncing off the floor and the crates, rolling, pushed by the Force,
 * going off), the lab's loose objects strewn and thrown by a blast, and
 * where the blade sends bolts back.
 */
async function bakeFx() {
  const { meshes } = createScorchMarks(new THREE.Scene());
  for (const [name, mesh] of Object.entries(meshes)) await png(`assets/fx/scorch-${name}.png`, mesh.material.map.image);
  await png('assets/fx/embers.png', emberTexture().image);
  // The lab's boxes as lab.json gives them to Godot (rounded).
  const scene = new THREE.Scene();
  const lab = createLab(scene);
  createArena(scene, { lab });
  createTransformer(scene, { lab, at: new THREE.Vector3(7.4, 0, -10.675), facing: new THREE.Vector3(0, 0, 1) });
  for (const box of lab.obstacles) {
    box.min.fromArray(toArray(box.min));
    box.max.fromArray(toArray(box.max));
    box.centre = box.min.clone().add(box.max).multiplyScalar(0.5);
  }
  // Grenades: four throws (one into a crate, one dropped), a Force push, then they go off.
  const grenades = createGrenades(scene, { lab, random: drawsFrom(5), reach: FEEL.grenade.reach });
  const throws = [
    { at: 0, from: [2, 1.3, 2], to: [-1, 0, -1], fuse: 2.2 },
    { at: 10, from: [-2, 1.4, 0.5], to: [-4.9, 0, -0.8], fuse: 2.4 },
    { at: 25, from: [3, 0.9, -2], fuse: 1.6 },
    { at: 40, from: [-6, 1.3, 4], to: [-6.5, 0, -2], fuse: 3 },
  ];
  const push = { at: 70, from: [-1.5, 0, 1.5], direction: toArray(new THREE.Vector3(1, 0, -1.2).normalize()) };
  const steps = [];
  for (let i = 0; i < 260; i++) {
    for (const t of throws) if (t.at === i) {
      if (t.to) grenades.throwAt(vector(t.from), vector(t.to), { fuse: t.fuse });
      else grenades.drop(vector(t.from), { fuse: t.fuse });
    }
    if (i === push.at) grenades.push(vector(push.from), vector(push.direction), { range: FEEL.push.range, cone: FEEL.push.cone });
    const dt = i % 5 === 0 ? 1 / 45 : 1 / 60;
    const blasts = grenades.update(dt).map(toArray);
    steps.push({ dt, live: grenades.pool.map(g => (g.live ? toArray(g.position) : null)), blasts });
  }
  // Debris: strewn about the lab, then a blast and its fragments.
  const debris = createDebris(scene, { lab, random: drawsFrom(17) });
  debris.scatter(30);
  const strewn = debris.bodies.map(body => ({ name: body.name, position: toArray(body.position), quaternion: body.quaternion.toArray().map(round) }));
  const blastAt = [-3.8, 0, -1.6];
  debris.blast(vector(blastAt));
  debris.fragments(vector(blastAt), 12);
  const flight = [];
  for (let i = 0; i < 90; i++) {
    debris.update(1 / 60);
    flight.push(debris.bodies.map(body => toArray(body.position)));
  }
  // Bolts sent back: near and far, trained or not, perfect, with men about (one of them down).
  const draws = drawsFrom(29), returns = [];
  const enemies = [{ point: [3, 1.1, -4], shooter: true, down: false }, { point: [-2, 0.4, -5], shooter: false, down: true }, { point: [1, 1.2, 4], shooter: false, down: false }];
  for (let k = 0; k < 24; k++) {
    const at = [Math.sin(k) * 0.4, 1.1, Math.cos(k * 1.3) * 0.4];
    const incoming = toArray(new THREE.Vector3(1.5 - (k % 5) * 0.7, (k % 3 - 1) * 0.1, -2 + (k % 4)).normalize());
    const options = { precision: (k % 6) / 6, closeness: ((k * 7) % 11) / 10, perfect: k % 8 === 7 };
    const result = returnDirection({ at: vector(at), incoming: vector(incoming), ...options, enemies: enemies.map(e => ({ ...e, point: vector(e.point) })), random: draws });
    returns.push({ at, incoming, ...options, aim: toArray(result.aim), target: result.target ? enemies.findIndex(e => e.point.join() === toArray(result.target.point).join()) : -1 });
  }
  await json('assets/data/fx-reference.json', { draws: { grenades: 5, debris: 17, returns: 29 }, throws, push, steps, debris: { strewn, blast: blastAt, flight }, enemies, returns });
}

// bake.html?only=combat,data cooks only those parts (the models, and the glow table, are left as they are).
const ONLY = new URLSearchParams(location.search).get('only')?.split(',') ?? null;
async function run() {
  for (const [name, label, bake] of [['data', 'données', bakeData], ['hero', 'héros', bakeHero], ['saber', 'sabre', bakeSaber], ['combat', 'combat', bakeCombat], ['lab', 'labo', bakeLab], ['trooper', 'stormtrooper', bakeTrooper], ['squad', 'escouade', bakeSquad], ['fx', 'effets', bakeFx]]) {
    if (ONLY && !ONLY.includes(name)) continue;
    log(`… ${label}`);
    await bake();
  }
  // What glows brighter than white in each model, for Godot to give back (scripts/glow.gd).
  if (!ONLY) await json('assets/data/glow.json', glowing);
  log('Terminé.');
  document.title = 'Cuisson terminée';
}
run().catch(error => { log(`✖ ${error.message}`); document.title = 'Cuisson échouée'; console.error(error); });
