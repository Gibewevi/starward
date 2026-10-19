import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createStage } from './stage.js';
import { createLighting } from './lighting.js';
import { createLab, onScreen } from './lab.js';
import { createStormtrooper } from './stormtrooper.js';
import { createExplosions, loadExplosionAssets } from './explosions.js';
import { createImpactEffects } from './impact-effects.js';
import { createDebris } from './debris.js';
import { createScorchMarks } from './scorch-marks.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 120;
let end = 6;
const query = new URLSearchParams(location.search);
let seed = 314159;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101722);
scene.fog = new THREE.FogExp2(0x111722, 0.018);
const at = onScreen(0, -0.5);
const focus = at.clone().setY(1.1);
const camera = new THREE.OrthographicCamera(-7, 7, 4.1, -4.1, 0.1, 100);
camera.position.copy(focus).add(new THREE.Vector3(8, 8.2, 10));
camera.lookAt(focus);
camera.layers.enable(1);
createLighting(scene, renderer).follow(at);
const stage = createStage(scene);
const lab = createLab(scene);

// The same weathered planar mirror as the game. The explosion's own runtime
// reflection handles layer 1, which intentionally stays out of this mirror.
const reflection = new Reflector(new THREE.PlaneGeometry(80, 80), {
  textureWidth: 640, textureHeight: 400, multisample: 0, clipBias: 0.001,
  shader: {
    name: 'WeatheredMetalReflection',
    uniforms: {
      color: { value: new THREE.Color(0x8698ad) }, tDiffuse: { value: null }, textureMatrix: { value: null },
      roughnessMap: { value: stage.roughnessTexture },
    },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 mirrorUv; varying vec2 surfaceUv;
      void main(){mirrorUv=textureMatrix*vec4(position,1.);surfaceUv=uv*8.333333;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D roughnessMap; varying vec4 mirrorUv; varying vec2 surfaceUv;
      void main(){float rough=texture2D(roughnessMap,surfaceUv).r;
      vec2 uv=mirrorUv.xy/mirrorUv.w; float distortion=(rough-.5)*.0025;
      vec3 reflected=texture2D(tDiffuse,uv+vec2(distortion,distortion*.4)).rgb;
      gl_FragColor=vec4(reflected*.85,(1.-rough)*.55);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  },
});
reflection.rotation.x = -Math.PI / 2;
reflection.position.y = 0.002;
reflection.material.transparent = true;
reflection.material.depthWrite = false;
reflection.renderOrder = 1;
reflection.getRenderTarget().texture.magFilter = THREE.NearestFilter;
reflection.getRenderTarget().texture.minFilter = THREE.NearestFilter;
scene.add(reflection);

const effects = createImpactEffects(scene, { random });
const marks = createScorchMarks(scene, { lab, random });
const explosions = createExplosions(scene, { marks, random, slots: 1 });
const debris = createDebris(scene, { lab, random });
const scaleTrooper = createStormtrooper({ scene, position: onScreen(4.15, 0.8), heading: -1.75, random: () => 0.35 });
scaleTrooper.update(1 / 60, 0);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(640, 400), 0.45, 0.15, 1.15));
composer.addPass(new OutputPass());

let time = 0, playing = false, ready = false, accumulator = 0, last = performance.now(), dirty = true;
function reset() {
  effects.clear(); explosions.clear(); debris.clear(); marks.clear();
  seed = 314159;
  // Keep the cloud and particles repeatable when moving backwards in time.
  for (const slot of explosions.pool) slot.reflection.material.uniforms.time.value = 0;
  for (const [kind, u, v] of [['crate', -0.5, -0.2], ['canister', 0.7, -0.8], ['plate', -1.1, 0.1], ['part', 0.2, 0.4], ['pipe', 0.85, -0.2]]) {
    debris.add(kind, at.clone().add(onScreen(u, v)).setY(0.15));
  }
  explosions.spawn(at);
  effects.blast(at.clone().setY(0.25), { sparks: 200, embers: 170, speed: 12 });
  effects.blast(at.clone().setY(0.35), { sparks: 45, embers: 0, speed: 24 });
  debris.blast(at);
  debris.fragments(at, 22);
  time = 0; accumulator = 0;
  explosions.update(0, camera); effects.update(0); debris.update(0);
  dirty = true;
}
function step() {
  explosions.update(STEP, camera); effects.update(STEP); debris.update(STEP);
  time += STEP;
  dirty = true;
}
function sync() {
  $('time').textContent = `${time.toFixed(2).replace('.', ',')} s`;
  $('scrub').value = time;
  $('pause').textContent = playing ? 'Pause' : 'Lire';
}
function seek(value) {
  if (!ready) return;
  playing = false;
  reset();
  const steps = Math.round(THREE.MathUtils.clamp(value, 0, end) / STEP);
  for (let i = 0; i < steps; i++) step();
  sync();
}
function resize() {
  const width = $('stage').clientWidth, height = $('stage').clientHeight;
  const pixels = Number($('pixels').value);
  const w = Math.max(1, Math.floor(width / pixels)), h = Math.max(1, Math.floor(height / pixels));
  renderer.setSize(w, h, false); composer.setSize(w, h); reflection.getRenderTarget().setSize(w, h);
  const viewHeight = width < 700 ? 9.3 : $('framing').value === 'close' ? 6.3 : 8.2;
  camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
  camera.left = -viewHeight * width / height / 2; camera.right = -camera.left;
  camera.updateProjectionMatrix();
  dirty = true;
}
if (['1', '2', '4'].includes(query.get('pixels'))) $('pixels').value = query.get('pixels');
$('pixels').addEventListener('change', resize);
$('framing').addEventListener('change', resize);
new ResizeObserver(resize).observe($('stage'));
$('scale').addEventListener('change', () => { scaleTrooper.root.visible = $('scale').checked; dirty = true; });
$('scrub').addEventListener('input', event => seek(Number(event.target.value)));
for (const button of document.querySelectorAll('[data-time]')) button.addEventListener('click', () => seek(Number(button.dataset.time)));
$('replay').addEventListener('click', () => { reset(); playing = true; sync(); });
$('pause').addEventListener('click', () => { if (time >= end - STEP && !playing) reset(); playing = !playing; accumulator = 0; sync(); });
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || !ready || /INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)) return;
  event.preventDefault(); $('pause').click();
});
document.addEventListener('visibilitychange', () => { last = performance.now(); accumulator = 0; });
$('view').addEventListener('webglcontextlost', event => { event.preventDefault(); playing = false; $('controls').disabled = true; $('notice').textContent = 'L’affichage a été interrompu. Rechargez cette page.'; $('notice').hidden = false; });

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (ready && playing && !document.hidden) {
    accumulator += dt * Number($('speed').value);
    while (accumulator >= STEP && time < end - STEP / 2) { step(); accumulator -= STEP; }
    if (time >= end - STEP / 2) {
      if ($('loop').checked) reset(); else { playing = false; accumulator = 0; }
    }
    sync();
  }
  if (dirty) { composer.render(); dirty = false; }
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);
async function load() {
  try {
    const data = await loadExplosionAssets(explosions, query.get('asset') === 'preview' ? '/fx/preview/' : '/fx/');
    end = Math.ceil(Math.max(6, explosions.duration + 2));
    $('scrub').max = end; $('end').textContent = `${end} s`;
    const phases = document.querySelectorAll('[data-time]');
    phases[1].dataset.time = data.peakTime ?? 0.28;
    phases[2].dataset.time = explosions.duration * 0.57;
    phases[3].dataset.time = Math.min(end - 0.5, explosions.duration + 1);
    ready = true;
    $('controls').disabled = false; $('notice').hidden = true;
    const requestedTime = Number(query.get('time') ?? phases[1].dataset.time);
    seek(Number.isFinite(requestedTime) ? requestedTime : Number(phases[1].dataset.time));
  } catch (error) {
    console.error(error);
    $('notice').textContent = 'L’animation n’a pas pu être chargée. Rechargez la page lorsque les fichiers de l’explosion sont disponibles.';
  }
}
load();
