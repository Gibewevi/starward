// Development studio: the reference sprite next to the real-time character,
// rendered with the game's lighting, tone mapping, bloom and pixel scale.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCharacter } from './character.js';
import { createCoat } from './coat.js';
import { createStage } from './stage.js';
import { createLighting } from './lighting.js';
import { createSaber } from './saber.js';
import { CombatController } from './combat.js';
import { createBladeTrail } from './blade-trail.js';
import { createStormtrooper } from './stormtrooper.js';
import { createImpactEffects } from './impact-effects.js';

const SHEET = encodeURI('/Jedi pixel art et planche d’animations.png');
const FRAMES = { idle: [68, 175, 268, 363, 445], walk: [565, 662, 770, 878, 985], run: [1145, 1250, 1360, 1465] };
const SPEEDS = { idle: 0, walk: 1.7, run: 4.5 };
const SCALE = 5, WIDTH = 90, HEIGHT = 100;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101722);
scene.fog = new THREE.FogExp2(0x111722, 0.018);
const character = createCharacter();
scene.add(character.root);
const coat = createCoat({ scene, character });
const views = [
  { canvas: document.querySelector('#view'), elevation: 0.32, azimuth: 0, height: 2 },
  // Same framing as the game at 1080p with 4× pixels: 8.2 m over 270 pixels.
  { canvas: document.querySelector('#game-view'), elevation: Math.atan2(8.2, Math.hypot(8, 10)), azimuth: Math.atan2(8, 10), height: HEIGHT * 8.2 / 270 },
].map(view => {
  const renderer = new THREE.WebGLRenderer({ canvas: view.canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  const { height } = view;
  camera.top = height / 2; camera.bottom = -height / 2;
  camera.left = -height * WIDTH / HEIGHT / 2; camera.right = height * WIDTH / HEIGHT / 2;
  camera.updateProjectionMatrix();
  const offset = new THREE.Vector3(Math.sin(view.azimuth) * Math.cos(view.elevation), Math.sin(view.elevation), Math.cos(view.azimuth) * Math.cos(view.elevation)).multiplyScalar(15);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH, HEIGHT), 0.45, 0.15, 1.15));
  composer.addPass(new OutputPass());
  composer.setSize(WIDTH, HEIGHT);
  return { ...view, renderer, camera, composer, offset };
});
const lighting = createLighting(scene, views[0].renderer);
createStage(scene);
const saber = createSaber({ socket: character.saberSocket, scene });
const combat = new CombatController();
const trail = createBladeTrail(scene);
const bladeBase = new THREE.Vector3(), bladeTip = new THREE.Vector3(), lastBase = new THREE.Vector3(), lastTip = new THREE.Vector3();
// Training dummy, placed in front of the hero on demand.
const effects = createImpactEffects(scene);
const trooperSpot = new THREE.Vector3(0, 0, 40);
const trooper = createStormtrooper({ scene, position: trooperSpot, heading: Math.PI, effects });
let bladeReady = false;

const state = { gait: 'idle', frame: 1, turn: -0.35, freeze: false, time: 0 };
const reference = document.querySelector('#reference');
function showReference() {
  const centers = FRAMES[state.gait];
  const center = centers[Math.min(state.frame, centers.length - 1)];
  reference.style.backgroundImage = `url("${SHEET}")`;
  reference.style.backgroundSize = `${1536 * SCALE}px ${1024 * SCALE}px`;
  reference.style.backgroundPosition = `${-(center - WIDTH / 2) * SCALE}px ${-528 * SCALE}px`;
}
for (const button of document.querySelectorAll('[data-gait]')) {
  button.addEventListener('click', () => {
    state.gait = button.dataset.gait;
    for (const other of document.querySelectorAll('[data-gait]')) other.setAttribute('aria-pressed', String(other === button));
    showReference();
  });
}
document.querySelector('#frame').addEventListener('input', event => { state.frame = Number(event.target.value); showReference(); });
document.querySelector('#turn').addEventListener('input', event => { state.turn = Number(event.target.value); });
document.querySelector('#freeze').addEventListener('change', event => { state.freeze = event.target.checked; });
document.querySelector('#attack').addEventListener('click', () => combat.attack({ speed }));
document.querySelector('#guard').addEventListener('click', event => {
  state.guard = !state.guard;
  event.target.setAttribute('aria-pressed', String(state.guard));
});
showReference();

const velocity = new THREE.Vector3(), focus = new THREE.Vector3();
let speed = 0, runBlend = 0, last = performance.now();
function step(dt) {
  state.time += dt;
  const target = SPEEDS[state.gait];
  speed += (target - speed) * (1 - Math.exp(-10 * dt));
  runBlend += ((state.gait === 'run' ? 1 : 0) - runBlend) * (1 - Math.exp(-12 * dt));
  // The hero really travels, so the cloth meets real airflow; cameras follow.
  const action = combat.update(dt, { guard: Boolean(state.guard) });
  character.root.rotation.y = state.turn + action.spin;
  velocity.set(Math.sin(state.turn), 0, Math.cos(state.turn)).multiplyScalar(Math.min(speed, action.maxSpeed) * action.inputScale + action.drive);
  character.root.position.addScaledVector(velocity, dt);
  if (character.root.position.length() > 20) { character.root.position.set(0, 0, 0); coat.reset(); }
  character.update({ dt, time: state.time, speed: velocity.length(), runBlend, sprintIntent: state.gait === 'run' && !action.engaged, action });
  coat.update({ dt, time: state.time, velocity });
  if (saber.update(state.ignition ?? 1, state.time, action.flare) === 'ignite') combat.flourish();
  saber.segment(bladeBase, bladeTip);
  trail.update(dt, bladeBase, bladeTip, action.trail);
  trooper.update(dt, state.time);
  if (bladeReady) trooper.strike(lastBase, lastTip, bladeBase, bladeTip, dt, state.time);
  bladeReady = true;
  lastBase.copy(bladeBase); lastTip.copy(bladeTip);
  effects.update(dt);
  lighting.follow(character.root.position);
  for (const view of views) {
    focus.copy(character.root.position).add(new THREE.Vector3(0, 0.8, 0));
    view.camera.position.copy(focus).add(view.offset);
    view.camera.lookAt(focus);
  }
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!state.freeze) step(dt);
  for (const view of views) view.composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Automation hooks for visual regression checks.
window.__ATELIER__ = {
  set(options) { Object.assign(state, options); showReference(); },
  advance(seconds, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) step(dt); for (const view of views) view.composer.render(dt); },
  capture() { return views.map(view => { view.composer.render(0); return view.canvas.toDataURL('image/png'); }); },
  character, coat, scene, saber, views, combat, trooper, effects,
  /** Stands the stormtrooper at (x, z), facing the given heading, intact. */
  placeTrooper(x, z, heading = Math.PI) { trooperSpot.set(x, 0, z); trooper.reset(); trooper.root.rotation.y = heading; effects.clear(); },
};
