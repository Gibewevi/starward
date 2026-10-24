import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacter } from './character.js';
import { createRig, LEG_LENGTH } from './rig.js';
import { MOCAP_BONES } from './mocap-clips.js';
import { createSaber } from './saber.js';
import { createStage } from './stage.js';
import { createLab } from './lab.js';
import { createArena, ARENA } from './arena.js';
import { createTransformer } from './transformer.js';
import { MotionController } from './motion.js';
import { FEEL } from './feel.js';
import { MOVES, STANCES, CombatController } from './combat.js';

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

// ---- The lab: deck, crates, room, the transformer; its obstacles ----------------------------------
async function bakeLab() {
  const scene = new THREE.Scene();
  const stage = createStage(scene, { bounds: ARENA });
  const lab = createLab(scene);
  const arena = createArena(scene, { lab, floorMaterial: stage.material });
  const transformer = createTransformer(scene, { lab, at: new THREE.Vector3(7.4, 0, -10.675), facing: new THREE.Vector3(0, 0, 1) });
  lab.update(0);
  arena.update(0);
  const level = new THREE.Group();
  level.name = 'Lab';
  for (const child of [...scene.children]) level.add(child);
  const emitters = await glb('assets/baked/lab.glb', level);
  await json('assets/data/lab.json', {
    bounds: ARENA,
    obstacles: lab.obstacles.map(box => ({ kind: box.kind, min: toArray(box.min), max: toArray(box.max) })),
    emitters,
    transformer: { socket: toArray(transformer.socket), approach: toArray(transformer.approach), facing: toArray(transformer.facing) },
  });
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

// bake.html?only=combat,data cooks only those parts (the models, and the glow table, are left as they are).
const ONLY = new URLSearchParams(location.search).get('only')?.split(',') ?? null;
async function run() {
  for (const [name, label, bake] of [['data', 'données', bakeData], ['hero', 'héros', bakeHero], ['saber', 'sabre', bakeSaber], ['combat', 'combat', bakeCombat], ['lab', 'labo', bakeLab]]) {
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
