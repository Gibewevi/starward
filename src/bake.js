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

async function run() {
  for (const [label, bake] of [['données', bakeData], ['héros', bakeHero], ['sabre', bakeSaber], ['labo', bakeLab]]) {
    log(`… ${label}`);
    await bake();
  }
  // What glows brighter than white in each model, for Godot to give back (scripts/glow.gd).
  await json('assets/data/glow.json', glowing);
  log('Terminé.');
  document.title = 'Cuisson terminée';
}
run().catch(error => { log(`✖ ${error.message}`); document.title = 'Cuisson échouée'; console.error(error); });
