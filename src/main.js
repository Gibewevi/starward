import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createCharacter } from './character.js';
import { createCoat } from './coat.js';
import { createStage, deckGeometry } from './stage.js';
import { createArena, ARENA } from './arena.js';
import { createNav } from './nav.js';
import { createReinforcements } from './reinforcements.js';
import { createLighting } from './lighting.js';
import { createSaber } from './saber.js';
import { MotionController, damp, angleDelta } from './motion.js';
import { CombatController, MOVES } from './combat.js';
import { createBladeTrail } from './blade-trail.js';
import { createStormtrooper, collideSquad } from './stormtrooper.js';
import { ease, hitStopScale, kick } from './tween.js';
import { FEEL, pick } from './feel.js';
import { createImpactEffects } from './impact-effects.js';
import { createLab, onScreen } from './lab.js';
import { glowTexture } from './kit.js';
import { createBlasters, closestSegments } from './blasters.js';
import { createAlerts } from './alerts.js';
import { createSquadMind } from './trooper-ai.js';
import { returnDirection } from './deflect.js';
import { createExplosions, loadExplosionAssets } from './explosions.js';
import { createScorchMarks } from './scorch-marks.js';
import { createSaberScars } from './saber-scars.js';
import { createDebris } from './debris.js';
import { createGrenades } from './grenades.js';
import { createHeroRagdoll } from './hero-ragdoll.js';
import { createAudio } from './audio.js';
import { createShake } from './shake.js';
import { createTelegraph } from './telegraph.js';

const $ = selector => document.querySelector(selector);
function showError(error) {
  console.error(error);
  $('#loading').hidden = true;
  $('#error').hidden = false;
  $('#error-message').textContent = `Un navigateur compatible WebGL 2 est nécessaire. ${error.message || error}`;
}
window.addEventListener('error', event => showError(event.error || event.message));

try { init(); } catch (error) { showError(error); }

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Jeu 3D. ZQSD, WASD ou flèches pour marcher, Maj pour courir.');
  $('#game').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); showError(new Error('Le contexte graphique a été interrompu. Rechargez la page.')); });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101722);
  scene.fog = new THREE.FogExp2(0x111722, 0.018);
  const camera = new THREE.OrthographicCamera(-7, 7, 4.1, -4.1, 0.1, 100);
  const cameraOffset = new THREE.Vector3(8, 8.2, 10);
  const cameraFocus = new THREE.Vector3(0, 0.6, 0);
  camera.position.copy(cameraFocus).add(cameraOffset);
  camera.lookAt(cameraFocus);
  const lighting = createLighting(scene, renderer);
  // The studio strip above the hero would whiten every puddle of the wet deck.
  lighting.whiteStrip.intensity *= 0.55;

  // The deck, closed at the back by walls, open at the front over a lower level.
  const stage = createStage(scene, { bounds: ARENA });
  // The AI lab: crates, barrels and barriers on the floor; the room around it.
  const lab = createLab(scene);
  const arena = createArena(scene, { lab, floorMaterial: stage.material });
  // The wet deck mirrors the room: the reflection is added to the floor's own
  // light, strongest in the puddles (smooth in the roughness map), and it is
  // stretched towards the viewer as on wet steel — light columns and strips
  // become long red streaks.
  const deck = deckGeometry(ARENA);
  const reflection = new Reflector(deck.geometry, {
    textureWidth: 640, textureHeight: 400, multisample: 0, clipBias: 0.001,
    shader: {
      name: 'WetDeckReflection',
      uniforms: {
        color: { value: new THREE.Color(0x8698ad) }, tDiffuse: { value: null }, textureMatrix: { value: null },
        roughnessMap: { value: stage.roughnessTexture }, texel: { value: new THREE.Vector2(1 / 640, 1 / 400) },
      },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 mirrorUv; varying vec2 surfaceUv;
        void main(){mirrorUv=textureMatrix*vec4(position,1.);surfaceUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D roughnessMap; uniform vec2 texel; varying vec4 mirrorUv; varying vec2 surfaceUv;
        void main(){
          float rough=texture2D(roughnessMap,surfaceUv).r;
          float wet=1.-smoothstep(.2,.6,rough);
          vec2 uv=mirrorUv.xy/mirrorUv.w;
          float stretch=mix(4.5,1.6,wet)*texel.y, wobble=(rough-.5)*texel.x*1.5;
          vec3 sum=vec3(0.); float total=0.;
          for(int i=-4;i<=4;i++){float w=1.-abs(float(i))/5.;sum+=texture2D(tDiffuse,uv+vec2(wobble,float(i)*stretch)).rgb*w;total+=w;}
          // Only what shines is mirrored: the dim room and the fog add no milky veil.
          vec3 bright=max(sum/total-vec3(.012),0.);
          gl_FragColor=vec4(bright*mix(.4,1.25,wet),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.copy(deck.centre).setY(0.002);
  reflection.material.transparent = true;
  reflection.material.blending = THREE.AdditiveBlending;
  reflection.material.depthWrite = false;
  reflection.renderOrder = 1;
  reflection.getRenderTarget().texture.magFilter = THREE.NearestFilter;
  reflection.getRenderTarget().texture.minFilter = THREE.NearestFilter;
  scene.add(reflection);

  const character = createCharacter();
  scene.add(character.root);
  const motion = new MotionController();
  character.root.rotation.y = motion.heading;
  const cape = createCoat({ scene, character });
  const saber = createSaber({ socket: character.saberSocket, scene });
  const combat = new CombatController();
  const trail = createBladeTrail(scene);
  const bladeBase = new THREE.Vector3(), bladeTip = new THREE.Vector3(), lastTip = new THREE.Vector3();
  const shake = new THREE.Vector3();
  let roll = 0;
  const SPRINT_PACE = 4.5;
  // A squad of stormtroopers among the crates, unaware of the hero at first:
  // sentries and patrols. Screen-up on the floor is away from the camera.
  const effects = createImpactEffects(scene);
  const screenUp = new THREE.Vector3(-8, 0, -10).normalize(), screenRight = new THREE.Vector3(10, 0, -8).normalize();
  const towards = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  // Screen directions as headings: down (towards the camera) 0.68, up -2.47, left -0.9, right 2.24.
  const POSTS = [
    { position: onScreen(-2.4, 5.4), heading: -0.9 },
    { position: onScreen(0.3, 5.7), route: [onScreen(0.3, 5.7), onScreen(4.7, 6.2), onScreen(4.9, 7.6), onScreen(0.8, 7.9)] },
    { position: onScreen(4.1, 8.4), heading: -2.47 },
    { position: onScreen(-5.6, 2.7), route: [onScreen(-5.6, 2.7), onScreen(-5.4, 7.2)] },
    { position: onScreen(-0.6, 8.1), heading: 2.24 },
  ];
  for (const post of POSTS) post.heading ??= towards(post.route[0], post.route[1]);
  const troopers = POSTS.map(post => createStormtrooper({ scene, effects, lab, position: post.position, heading: post.heading }));
  const alerts = createAlerts(scene);
  // Grenades and explosions. The fireball is a Blender flipbook (public/fx),
  // laid over the iso view; everything around it is live.
  // Burns that stay: blasts and bolts mark the floor and the crates for good.
  const marks = createScorchMarks(scene, { lab });
  // The blade melts what it goes into: molten trails that cool, cuts that stay.
  const scars = createSaberScars(scene, { lab, bounds: ARENA });
  let scarSparks = 0, scarSizzle = 0;
  const explosions = createExplosions(scene, { marks, slots: 5 });
  camera.layers.enable(1);
  loadExplosionAssets(explosions).catch(error => console.error('Chargement de l’explosion interrompu :', error));
  const debris = createDebris(scene, { lab });
  debris.scatter();
  const grenades = createGrenades(scene, {
    lab, reach: FEEL.grenade.reach,
    onBeep: (grenade, progress) => audio.beep(progress, grenade.position),
    onBounce: (grenade, speed) => audio.clink(grenade.position, Math.min(1, speed / 6)),
  });
  // Warnings: a glint at a muzzle about to fire; chevrons at the screen's edges for threats out of view.
  const telegraph = createTelegraph(scene, { overlay: $('#threats') });
  const knockdown = createHeroRagdoll(character, { lab });
  const blasters = createBlasters(scene, { effects, lab, marks });
  // The squad finds its way round the crates and walls on a navigation grid.
  const nav = createNav(lab, ARENA);
  const squad = createSquadMind({ troopers, lab, nav, alerts, posts: POSTS, cameraRight: screenRight });
  // Every so often the great door opens and three or four more march in.
  const reinforcements = createReinforcements({ door: arena.door });
  /** One of a wave: made in the corridor, marched through the door to a post in the room. */
  function bringIn(index) {
    const door = arena.door, heading = Math.atan2(door.out.x, door.out.z);
    const trooper = createStormtrooper({ scene, effects, lab, position: door.inside[index % door.inside.length], heading });
    trooper.reinforcement = true;
    // Through the doorway, then round whatever stands in the way to a free spot fanned out in front.
    const threshold = door.centre.clone().addScaledVector(door.out, 0.7);
    const wanted = door.centre.clone().addScaledVector(door.out, 2.3 + (index % 2) * 0.9).addScaledVector(door.along, ((index % 4) - 1.5) * 0.9);
    const post = nav.nearest(wanted) ?? threshold.clone().addScaledVector(door.out, 1.5);
    squad.add(trooper, { position: post, heading }, { entering: [threshold, ...(nav.path(threshold, post) ?? [post])] });
    clearBodies();
  }
  /** Too many men in the room, dead ones included: the oldest bodies are cleared away. */
  function clearBodies() {
    while (troopers.length > FEEL.reinforce.bodies) {
      const old = troopers.find(trooper => trooper.dead && trooper.fallen && !trooper.impaled && trooper !== held && trooper !== skewered?.trooper);
      if (!old) break;
      old.dispose();
      squad.remove(old);
    }
  }
  // What the squad hears this frame: footsteps, the blade, blows, the Force, shots.
  const noises = [];
  const noise = (position, radius, options = {}) => noises.push({ position: position.clone(), radius, ...options });
  let stepClock = 0, humClock = 0;
  // Precision: the chance that a bolt the blade sends back goes for an enemy.
  // It grows with every deflection, and more with every enemy hit.
  let precision = FEEL.deflect.precision.start;
  try { const saved = Number(localStorage.getItem('starward.precision')); if (saved > 0) precision = Math.min(FEEL.deflect.precision.max, saved); } catch { /* no storage */ }
  const train = gain => {
    precision = Math.min(FEEL.deflect.precision.max, precision + gain);
    try { localStorage.setItem('starward.precision', precision.toFixed(3)); } catch { /* no storage */ }
  };
  const lastBase = new THREE.Vector3();
  let bladeReady = false, hitStop = null;
  // Camera shake from trauma: blows add it, it drains, the view shakes with its square.
  const trauma = createShake();
  // The controller trembles with the blows (if it can, and if the player wants it).
  let rumbleOn = true, rumbleUntil = 0, rumbleLevel = 0;
  function rumble(strong, weak, duration) {
    if (!rumbleOn) return;
    const actuator = navigator.getGamepads?.()?.find(pad => pad?.connected)?.vibrationActuator;
    if (!actuator?.playEffect) return;
    // A weaker one never cuts a stronger one short.
    const now = performance.now();
    if (now < rumbleUntil && Math.max(strong, weak) < rumbleLevel) return;
    rumbleUntil = now + duration * 1000;
    rumbleLevel = Math.max(strong, weak);
    actuator.playEffect('dual-rumble', { startDelay: 0, duration: duration * 1000, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }
  // The streak: blows, returns and kills in a row without being hit.
  let streak = 0, streakAge = Infinity, streakNote = '', streakNoteAge = Infinity, streakBroken = Infinity, eliminated = 0;
  const counted = new WeakSet();
  function score(points, note = '') {
    streak += points;
    streakAge = 0;
    if (note) { streakNote = note; streakNoteAge = 0; }
    const element = $('#streak');
    element.classList.remove('pop');
    void element.offsetWidth;
    element.classList.add('pop');
  }
  function breakStreak() {
    if (streak >= 3) streakBroken = 0;
    streak = 0;
  }
  // Game feel: hit stops ease back to speed, the view is kicked along the
  // swing and rings out, and a felling blow punches the zoom in a touch.
  const cameraKick = { direction: new THREE.Vector3(), amplitude: 0, age: Infinity }, kickOffset = new THREE.Vector3();
  const zoomPunch = { amount: 0, age: Infinity };
  function stopFor(hold, recover) {
    if (!hitStop || hold + recover > hitStop.hold + hitStop.recover - hitStop.age) hitStop = { age: 0, hold, recover };
  }
  function shove(velocity, amplitude) {
    if (!velocity || amplitude < cameraKick.amplitude * Math.max(0, 1 - cameraKick.age / 0.3)) return;
    cameraKick.direction.set(velocity.x, 0, velocity.z);
    if (cameraKick.direction.lengthSq() < 1e-6) cameraKick.direction.set(0, -1, 0);
    cameraKick.direction.normalize();
    cameraKick.direction.y -= 0.35;
    Object.assign(cameraKick, { amplitude, age: 0 });
  }
  function punch(amount) { if (amount >= zoomPunch.amount * (zoomPunch.age < 0.3 ? 1 : 0)) Object.assign(zoomPunch, { amount, age: 0 }); }
  /** L3 / T: everything as it was — the squad at its posts, the hero at the start, the room clean. */
  function restart() {
    resetTrooper();
    reset();
    streak = eliminated = 0;
    streakAge = streakBroken = Infinity;
    trauma.clear();
    telegraph.clear();
    dash = lunge = null;
    dashCooldown = dodge = dashAfter = 0;
  }
  function resetTrooper() {
    skewered = thrust = held = null;
    combat.unpin();
    // The reinforcements go; the door shuts; the first squad stands at its posts again.
    for (const trooper of troopers.filter(trooper => trooper.reinforcement)) { trooper.dispose(); squad.remove(trooper); }
    arena.door?.reset();
    reinforcements.reset();
    for (const trooper of troopers) trooper.reset();
    effects.clear(); blasters.clear(); squad.reset(); grenades.clear(); explosions.clear(); marks.clear(); scars.clear();
    debris.clear(); debris.scatter();
  }
  // Hit stops: at most one per enemy and per attack sequence.
  const stopped = new Set();
  let stoppedSequence = -1;

  // The Force: where each trooper is, which one the hero means, and what the power does.
  const leftHand = new THREE.Vector3(), here = new THREE.Vector3(), facing = new THREE.Vector3();
  const whereIs = trooper => {
    const block = trooper.blocker();
    return block ? new THREE.Vector3(block.x, 0, block.z) : trooper.particle('W').position.clone().setY(0);
  };
  /** The trooper the hero means: closest to his line of sight, alive ones first. */
  function target(range, cone) {
    here.set(motion.x, 0, motion.z);
    facing.set(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    let best = null, score = Infinity;
    for (const trooper of troopers) {
      const offset = whereIs(trooper).sub(here), distance = offset.length();
      if (distance > range || distance < 0.3) continue;
      const angle = facing.angleTo(offset);
      if (angle > cone) continue;
      const value = angle * 2.2 + distance * 0.12 + (trooper.dead ? 0.6 : 0);
      if (value < score) { score = value; best = trooper; }
    }
    return best;
  }
  // LT / U kept down: the pulled trooper hangs before the hero; let go, he drops.
  let pullHeld = false, held = null;
  const holdPoint = () => new THREE.Vector3(motion.x + Math.sin(motion.heading) * FEEL.pull.hold.distance, FEEL.pull.hold.height, motion.z + Math.cos(motion.heading) * FEEL.pull.hold.distance);
  function keepHold() {
    if (!held) return;
    if (!pullHeld || held.dead) { held.drop(); held = null; return; }
    const point = holdPoint();
    held.hold(point, Math.atan2(motion.x - point.x, motion.z - point.z));
  }
  // ---- The dash (Y / Space) ------------------------------------------------------
  // A lightning burst along the ground: off at full speed, easing to a stop
  // after a few metres; the cape streams, a pale streak of light hangs behind
  // him an instant and fades, the debris on the floor is swept aside.
  // Bolts pass through him while he dashes (and a beat after); B during it,
  // or just after, turns it into a lunging strike.
  let dash = null, dashCooldown = 0, dodge = 0, dashAfter = 0, strikeFromDash = false;
  const streaks = [[0.85, 0.45], [0.32, 1.1]].map(([width, strength]) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.55, 0.72, 1.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.visible = false;
    sprite.userData = { width, strength };
    scene.add(sprite);
    return sprite;
  });
  const streakFrom = new THREE.Vector3(), streakTo = new THREE.Vector3();
  let streakFade = 0;
  function startDash(along) {
    dash = { age: 0, along };
    dashCooldown = FEEL.dash.cooldown;
    dodge = FEEL.dash.duration + FEEL.dash.dodge;
    motion.face(Math.atan2(along.x, along.z));
    streakFrom.set(motion.x, 0.95, motion.z);
    streakFade = 1;
    // A pale Force wave rushes along the way he goes.
    effects.wave(streakFrom.clone().setY(0.6), along, { kind: 'push', length: FEEL.dash.speed * FEEL.dash.duration * 0.75, power: 0.55 });
    shove(along, FEEL.camera.kick * 0.6);
    audio.dash();
    rumble(0.1, 0.35, 0.08);
    noise(here.set(motion.x, 0, motion.z), 6, { from: here });
  }
  function dashStep(dt) {
    const { duration, speed, carry } = FEEL.dash;
    dash.age += dt;
    const k = Math.min(1, dash.age / duration), v = speed * (1 - k ** 3);
    motion.vx = dash.along.x * v;
    motion.vz = dash.along.z * v;
    motion.x += motion.vx * dt;
    motion.z += motion.vz * dt;
    motion.speed = v;
    motion.runBlend = motion.sprint = 1;
    motion.idleTime = 0;
    debris.kick(here.set(motion.x, 0, motion.z), dash.along.clone().multiplyScalar(v));
    if (k >= 1) endDash();
  }
  /** The dash ends (run out, or cut short by a strike): he keeps a little of it into his stride. */
  function endDash() {
    if (!dash) return;
    const { speed, carry } = FEEL.dash;
    motion.vx = dash.along.x * speed * carry;
    motion.vz = dash.along.z * speed * carry;
    dash = null;
    dashAfter = FEEL.dash.strike;
  }

  // ---- Finding the mark ----------------------------------------------------------
  // A strike turns to the trooper nearest the stick's way (ahead of him with
  // the stick at rest) and glides in to striking distance before the blade
  // lands, turning with him if he moves. Out of a dash it reaches further.
  let lunge = null;
  const lungeTo = new THREE.Vector3();
  function lockOn(name, worldX, worldZ) {
    const assist = FEEL.assist, rushing = strikeFromDash;
    strikeFromDash = false;
    lunge = null;
    const stick = Math.hypot(worldX, worldZ) > 0.2;
    const along = stick ? new THREE.Vector3(worldX, 0, worldZ).normalize() : new THREE.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    const range = rushing ? assist.dashRange : assist.range, cone = stick ? assist.cone : assist.coneIdle;
    here.set(motion.x, 0, motion.z);
    let best = null, bestScore = Infinity;
    for (const trooper of troopers) {
      if (trooper.dead || trooper.impaled) continue;
      const offset = whereIs(trooper).sub(here), distance = offset.length();
      if (distance > range) continue;
      const angle = distance < 0.4 ? 0 : along.angleTo(offset);
      if (angle > cone) continue;
      const score = angle * 1.6 + distance * 0.35 + (trooper.fallen ? 0.7 : 0) - (trooper === held ? 1 : 0);
      if (score < bestScore) { bestScore = score; best = trooper; }
    }
    if (!best) { if (stick) motion.face(Math.atan2(worldX, worldZ)); return; }
    const offset = whereIs(best).sub(here), distance = offset.length();
    motion.face(Math.atan2(offset.x, offset.z));
    const gap = THREE.MathUtils.clamp(distance - assist.reach, 0, rushing ? assist.dashStep : assist.step);
    const action = combat.action;
    lunge = { trooper: best, age: 0, duration: assist.lunge * (gap > 1.6 ? 1.35 : 1), gap, done: 0, track: action ? action.active[0] * action.duration : 0.15 };
  }
  /** Each frame of a locked strike: the glide in, the turn with the target until the blade lands. */
  function lungeStep(dt) {
    if (!lunge) return;
    if (!combat.busy || lunge.trooper.dead) { lunge = null; return; }
    lunge.age += dt;
    const offset = lungeTo.copy(whereIs(lunge.trooper)).sub(here.set(motion.x, 0, motion.z)).setY(0), distance = offset.length();
    if (distance < 1e-3) { lunge = null; return; }
    offset.divideScalar(distance);
    if (lunge.age < lunge.track) motion.heading += angleDelta(motion.heading, Math.atan2(offset.x, offset.z)) * (1 - Math.exp(-24 * dt));
    const k = Math.min(1, lunge.age / lunge.duration), reach = ease.outCubic(k) * lunge.gap;
    // Never into him: he stops at striking distance even if the man came forward.
    const step = Math.min(reach - lunge.done, Math.max(0, distance - FEEL.assist.reach * 0.85));
    lunge.done = reach;
    if (step > 0) { motion.x += offset.x * step; motion.z += offset.z * step; }
    if (k >= 1 && lunge.age >= lunge.track) lunge = null;
  }

  // ---- The perfect parry ---------------------------------------------------------
  // The guard pressed just before a bolt meets the blade sends it straight back
  // into its shooter, whatever the range — and the rest of his burst after it.
  // Pressed again and again, the button opens no window.
  let parryAt = -Infinity, parryTry = -Infinity, perfectUntil = -Infinity, perfects = 0;
  function parryPress() {
    if (time - parryTry > FEEL.deflect.mash || time <= perfectUntil + 0.2) parryAt = time;
    parryTry = time;
  }
  /** The streak: from where the dash began to where he is, camera-facing, fading once he stops. */
  function updateStreak(dt) {
    if (streakFade <= 0) { for (const sprite of streaks) sprite.visible = false; return; }
    if (dash) streakTo.set(motion.x, 0.95, motion.z);
    else streakFade = Math.max(0, streakFade - dt / 0.28);
    camera.updateMatrixWorld();
    const a = streakFrom.clone().project(camera), b = streakTo.clone().project(camera);
    const dx = (b.x - a.x) * (camera.right - camera.left) / 2 / camera.zoom, dy = (b.y - a.y) * (camera.top - camera.bottom) / 2 / camera.zoom;
    for (const sprite of streaks) {
      sprite.position.lerpVectors(streakFrom, streakTo, 0.5);
      sprite.material.rotation = Math.atan2(dy, dx);
      sprite.scale.set(Math.hypot(dx, dy) + 0.5, sprite.userData.width, 1);
      sprite.material.opacity = streakFade * sprite.userData.strength;
      sprite.visible = true;
    }
  }

  // LT and B held, a trooper before him: the blade goes through him. A quick
  // tap of B still strikes; held a moment, it runs the trooper through. He
  // struggles on the blade, dies there, and hangs from it until LT is let go.
  let thrust = null, skewered = null, gushClock = 0;
  const bladeAxis = new THREE.Vector3(), wound = new THREE.Vector3();
  /** The living trooper the blade can reach before him: the one held up by the Force first. */
  function victim() {
    if (held && !held.dead && !held.fallen) return held;
    const trooper = target(FEEL.impale.reach, FEEL.impale.cone);
    return trooper && !trooper.dead && !trooper.fallen ? trooper : null;
  }
  function impaleInput(dt, attackHeld, down) {
    if (down || skewered) { thrust = null; return; }
    if (attackPressed && pullHeld && victim()) { thrust = { age: 0 }; attackPressed = false; }
    if (!thrust) return;
    thrust.age += dt;
    if (!attackHeld) { thrust = null; attackPressed = true; return; }
    if (thrust.age < FEEL.impale.press) return;
    thrust = null;
    const trooper = victim();
    if (!trooper) { attackPressed = true; return; }
    if (held === trooper) held = null;
    const at = whereIs(trooper);
    motion.face(Math.atan2(at.x - motion.x, at.z - motion.z));
    combat.impale();
    skewered = { trooper, entered: false, depth: 0.7 };
  }
  /** Off the blade: the body drops (a living one dies of it as he falls). */
  function unskewer() {
    if (!skewered) return;
    const { trooper } = skewered;
    skewered = null;
    combat.unpin();
    if (trooper.impaled) trooper.slideOff(bladeAxis.clone().multiplyScalar(0.4).setY(-0.3));
  }
  /** Each frame while the thrust goes in and the body is on the blade. */
  function keepSkewer(dt) {
    if (!skewered) return;
    const { trooper } = skewered;
    bladeAxis.subVectors(bladeTip, bladeBase);
    const length = bladeAxis.length();
    if (length < 0.2) { unskewer(); return; }
    bladeAxis.divideScalar(length);
    const moving = combat.action?.name === 'impale';
    if (!skewered.entered) {
      // The blade goes in as the thrust lands; his chest slides onto it where it passes him.
      if (!moving || !pullHeld) { skewered = null; combat.unpin(); return; }
      if (combat.time / combat.action.duration < 0.17) return;
      const chestAt = whereIs(trooper).setY(bladeBase.y);
      skewered.depth = THREE.MathUtils.clamp(chestAt.sub(bladeBase).dot(bladeAxis), 0.45, length * 0.8);
      wound.copy(bladeBase).addScaledVector(bladeAxis, skewered.depth);
      if (!trooper.impale(wound, motion.heading)) { skewered = null; combat.unpin(); return; }
      skewered.entered = true;
      // The gush: sparks out of his back along the blade, back out of the
      // entry towards the hero, blade-blue and molten mixed, smoke after.
      const across = new THREE.Vector3().crossVectors(bladeAxis, UP).normalize();
      effects.sparks(wound.clone().addScaledVector(bladeAxis, 0.2), bladeAxis.clone().add(UP.clone().multiplyScalar(0.25)).normalize(), across, { count: 46, speed: 5.5, saber: 0.35 });
      effects.sparks(wound.clone().addScaledVector(bladeAxis, -0.2), bladeAxis.clone().negate().add(UP.clone().multiplyScalar(0.5)).normalize(), across, { count: 22, speed: 3.2, saber: 0.35 });
      effects.flash(wound, 1.3);
      effects.burst(wound, { normal: bladeAxis.clone().negate(), power: 1 });
      if (trooper.parts?.torso) effects.smoulder(trooper.parts.torso, 4.5);
      const [hold, recover] = FEEL.impale.hitStop;
      stopFor(hold, recover);
      punch(FEEL.camera.punch * 1.6);
      shove(bladeAxis, FEEL.camera.kick);
      trauma.add(0.32);
      rumble(0.6, 0.45, 0.22);
      audio.impact(1.2, wound);
      score(2, 'EMPALÉ');
      noise(wound, 9, { alarm: true, from: character.root.position, source: trooper });
      gushClock = 0.06;
      return;
    }
    // LT let go, or the blade taken elsewhere (a power, a blast): the body comes off.
    if (!pullHeld || !moving || !trooper.impaled) { unskewer(); return; }
    wound.copy(bladeBase).addScaledVector(bladeAxis, skewered.depth);
    trooper.skewer(wound, motion.heading);
    // While he fights, spurts of sparks from the wound, fewer as he weakens.
    if (!trooper.dead && (gushClock -= dt) <= 0) {
      gushClock = pick(FEEL.impale.gush);
      const across = new THREE.Vector3().crossVectors(bladeAxis, UP).normalize();
      const out = Math.random() < 0.6;
      effects.sparks(wound.clone().addScaledVector(bladeAxis, out ? 0.2 : -0.2), bladeAxis.clone().multiplyScalar(out ? 1 : -1).add(UP.clone().multiplyScalar(0.4)).normalize(), across, { count: 5 + Math.round(Math.random() * 6), speed: 2.4, saber: 0.3 });
    }
  }
  function unleash(kind) {
    character.rig.bones.LeftHand.getWorldPosition(leftHand);
    here.set(motion.x, 0, motion.z);
    facing.set(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    if (kind === 'forcePush') {
      // Everyone in the cone is thrown, the nearest hardest.
      for (const trooper of troopers) {
        const offset = whereIs(trooper).sub(here), distance = offset.length();
        if (distance > FEEL.push.range || distance < 0.05 || facing.angleTo(offset) > FEEL.push.cone) continue;
        const strength = THREE.MathUtils.lerp(1, FEEL.push.falloff, distance / FEEL.push.range);
        const direction = offset.normalize().add(facing).normalize();
        trooper.forcePush(direction.multiplyScalar(pick(FEEL.push.speed) * strength).setY(pick(FEEL.push.lift) * strength));
      }
      effects.wave(leftHand, facing, { kind: 'push', length: FEEL.push.range * 0.8 });
      noise(here, 8.5, { alarm: true, from: here });
      grenades.push(here, facing, { range: FEEL.push.range, cone: FEEL.push.cone });
      debris.blast(here.clone().addScaledVector(facing, -0.6), { radius: FEEL.push.range * 0.7, strength: 0.45 });
      shove(facing, FEEL.camera.kickPush);
      punch(FEEL.camera.punchPush);
      audio.force('push');
    } else {
      const trooper = target(FEEL.pull.range, FEEL.pull.cone);
      const toward = trooper ? whereIs(trooper).sub(here) : facing.clone().multiplyScalar(3);
      const distance = Math.max(0.1, toward.length());
      if (trooper && pullHeld) {
        if (held && held !== trooper) held.drop();
        if (trooper.forcePull(holdPoint(), { hold: true })) held = trooper;
      } else if (trooper) trooper.forcePull(here.clone().addScaledVector(toward.clone().normalize(), Math.min(FEEL.pull.stop, distance)));
      effects.wave(leftHand, toward, { kind: 'pull', length: distance });
      noise(here, 8.5, { alarm: true, from: here });
      shove(toward.clone().negate(), FEEL.camera.kick);
      audio.force('pull');
    }
  }

  // ---- Blaster fire -----------------------------------------------------------
  const chest = new THREE.Vector3(), heroFeet = new THREE.Vector3(), heroHead = new THREE.Vector3(), offset = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  /** Is that point in front of the hero (where the blade can cover)? */
  const inFront = point => {
    offset.subVectors(point, chest).setY(0);
    return offset.lengthSq() < 1e-6 || offset.angleTo(new THREE.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading))) < 1.95;
  };
  const guardUp = () => saber.extension > 0.6 && (combat.guard > 0.4 || (combat.output.name ?? '').startsWith('parry'));
  /**
   * RB held: a bolt about to arrive — or to pass close by — makes the blade
   * snap to meet it, on its side; from behind, the blade goes down his back.
   */
  function autoParry(guarding) {
    if (!guarding || saber.extension < 0.6) return;
    chest.set(motion.x, 1.05, motion.z);
    for (const bolt of blasters.live) {
      if (bolt.deflected || bolt.parried) continue;
      offset.subVectors(bolt.position, chest);
      const speed = bolt.velocity.length(), closing = -offset.dot(bolt.velocity) / speed;
      if (closing <= 0) continue;
      const passes = offset.clone().addScaledVector(bolt.velocity, closing / speed).length();
      const reach = Math.max(FEEL.deflect.reach, Math.min(passes, FEEL.deflect.near));
      // From behind the blade has further to go (over the shoulder, down his back): it sets off sooner.
      const local = offset.clone().applyAxisAngle(UP, -motion.heading), back = !inFront(bolt.position);
      if (passes > FEEL.deflect.near || (closing - reach) / speed > (back ? FEEL.deflect.reactBack : FEEL.deflect.react)) continue;
      const side = back ? 'back' : local.x > 0.12 ? 'left' : local.x < -0.12 ? 'right' : bolt.position.y > 1.45 ? 'high' : null;
      if (combat.deflect(side)) bolt.parried = back ? 'back' : 'side';
    }
  }
  /** The blade meets a bolt and sends it back — at an enemy if his precision allows, else somewhere off. */
  function deflectBolt(bolt, a, b) {
    const meet = closestSegments(a, b, bladeBase, bladeTip);
    const at = meet.c2.clone(), incoming = bolt.velocity.clone().normalize();
    const enemies = troopers.filter(trooper => !trooper.dead).map(trooper => ({
      point: trooper.particle('W').position.clone().lerp(trooper.particle('N').position, 0.45), shooter: trooper === bolt.owner, down: trooper.fallen,
    }));
    // Closing in on the shooter, guard up, the returns find him more and more surely.
    const shooter = bolt.owner?.dead === false ? bolt.owner : null;
    const [near, far] = FEEL.deflect.close;
    const closeness = shooter ? THREE.MathUtils.clamp((far - shooter.root.position.distanceTo(here.set(motion.x, 0, motion.z))) / (far - near), 0, 1) : 0;
    const perfect = time - parryAt <= FEEL.deflect.perfect || time <= perfectUntil;
    if (perfect) { perfectUntil = time + FEEL.deflect.chain; parryAt = -Infinity; perfects++; }
    const { aim } = returnDirection({ at, incoming, precision, closeness, enemies, perfect });
    blasters.deflect(bolt, at, aim, FEEL.blaster.speed * (perfect ? FEEL.deflect.perfectSpeed : FEEL.deflect.speedUp));
    bolt.perfect = perfect;
    // Guarding, he turns a little into a shot from the side (one from behind is taken behind his back).
    const toward = Math.atan2(a.x - motion.x, a.z - motion.z), turn = Math.atan2(Math.sin(toward - motion.heading), Math.cos(toward - motion.heading));
    if (Math.abs(turn) > 0.45 && Math.abs(turn) < 1.95) motion.face(motion.heading + turn * 0.3);
    train(FEEL.deflect.precision.gain);
    const across = new THREE.Vector3().crossVectors(incoming, UP).normalize();
    // A small spray, blade-blue and molten-yellow mixed.
    if (perfect) {
      // The perfect one rings out: a bright spray, a blade-blue flare, a beat of slow motion.
      effects.sparks(at, aim.clone().add(incoming.clone().multiplyScalar(-0.3)).normalize(), across, { count: Math.round(pick([18, 26])), speed: 4.2, saber: 0.8 });
      effects.flash(at, 1.5, { color: new THREE.Color(0.55, 0.75, 1) });
      effects.burst(at, { normal: incoming, power: 1.1, tint: 'blue' });
      const [hold, recover] = FEEL.deflect.perfectStop;
      stopFor(hold, recover);
      punch(FEEL.camera.punch * 0.9);
      shove(aim, 0.05);
    } else {
      effects.sparks(at, aim.clone().add(incoming.clone().multiplyScalar(-0.5)).normalize(), across, { count: Math.round(pick([7, 13])), speed: 3, saber: 0.5 });
      effects.flash(at, 0.8);
      effects.burst(at, { normal: incoming, power: 0.45, tint: 'red' });
      stopFor(0.012, 0.035);
      shove(aim, 0.025);
    }
    combat.output.flare = 1;
    trauma.add(perfect ? 0.2 : 0.07);
    rumble(perfect ? 0.25 : 0, perfect ? 0.75 : 0.35, perfect ? 0.13 : 0.05);
    audio.deflect(perfect, at);
    score(perfect ? 2 : 1, perfect ? 'PARADE PARFAITE' : '');
    noise(at, 9, { alarm: true, from: chest });
    deflections++;
  }
  /** A bolt reaches the hero: it burns, nothing more (no damage yet). */
  function burnHero(bolt, point) {
    const incoming = bolt.velocity.clone().normalize();
    effects.sparks(point, incoming.clone().negate().setY(0.4).normalize(), new THREE.Vector3(incoming.z, 0, -incoming.x), { count: 12, speed: 2 });
    effects.flash(point, 0.6, { color: new THREE.Color(1, 0.06, 0.04) });
    effects.burst(point, { power: 0.3, tint: 'red' });
    shove(incoming, 0.018);
    trauma.add(0.14);
    rumble(0.45, 0.2, 0.1);
    audio.burn(point);
    breakStreak();
    burns++;
  }
  let deflections = 0, burns = 0, kills = 0;
  /** Every bolt, every frame: the blade first, then the hero, then (sent back) the troopers. */
  function boltMeets(bolt, a, b) {
    const wall = lab.segmentHit(a, b, box => box.kind === 'rail'), end = wall ? wall.point : b;
    if (!bolt.deflected) {
      chest.set(motion.x, 1.05, motion.z);
      // Guarding, the blade takes a bolt coming at him from the front, and any
      // bolt it has gone out to meet (from behind, or passing close by).
      // From behind, only the blade down his back stops it: where it crosses the
      // blade, or (the blade being there) before it would reach him.
      const pass = closestSegments(a, end, chest, chest).distance;
      if (guardUp()) {
        const front = inFront(a) && bolt.parried !== 'back';
        const backed = bolt.parried === 'back' && combat.action?.name === 'parryBack' && combat.time / combat.action.duration > 0.22
          && (closestSegments(a, end, bladeBase, bladeTip).distance < FEEL.deflect.blade || pass < FEEL.deflect.body);
        if ((front && pass < FEEL.deflect.reach) || (bolt.parried === 'side' && pass < FEEL.deflect.near) || backed) { deflectBolt(bolt, a, end); return 'deflected'; }
      }
      // Dashing, he is gone before it arrives: it flies on through where he was.
      if (dodge > 0) return null;
      heroFeet.set(motion.x, 0.3, motion.z); heroHead.set(motion.x, 1.5, motion.z);
      const body = closestSegments(a, end, heroFeet, heroHead);
      if (body.distance < 0.26) { burnHero(bolt, body.c1); return 'spent'; }
      return null;
    }
    let best = null, struck = null;
    for (const trooper of troopers) {
      const hit = trooper.boltHit(a, end);
      if (hit && (!best || hit.s < best.s)) { best = hit; struck = trooper; }
    }
    if (!best) return null;
    const event = struck.shot(best, bolt.velocity);
    train(FEEL.deflect.precision.hitGain);
    if (event.lethal) kills++;
    if (event.lethal || event.felled) { const [hold, recover] = FEEL.hitStop.felling; stopFor(hold * 0.8, recover); punch(FEEL.camera.punch); }
    shove(bolt.velocity, event.lethal ? FEEL.camera.kick : 0.02);
    trauma.add(event.lethal ? 0.16 : 0.05);
    audio.impact(event.lethal ? 1 : 0.6, struck.root.position);
    noise(struck.root.position, 9, { alarm: true, from: chest.clone(), source: struck });
    return 'spent';
  }

  // ---- Grenades and explosions ---------------------------------------------------
  /** A grenade goes off at `at`: fire, light, sparks, debris; bodies are thrown, the hero too. */
  function detonate(at) {
    const blast = FEEL.blast;
    explosions.spawn(at);
    effects.blast(at.clone().setY(0.25), { sparks: 200, embers: 170, speed: 12 });
    // A few that fly much further, long burning streaks.
    effects.blast(at.clone().setY(0.35), { sparks: 45, embers: 0, speed: 24 });
    debris.blast(at);
    debris.fragments(at, 18 + Math.round(Math.random() * 8));
    for (const trooper of troopers) {
      const offset = whereIs(trooper).sub(at).setY(0), distance = offset.length();
      if (distance > blast.radius) continue;
      const falloff = (1 - distance / blast.radius) ** 1.2;
      if (distance < 1e-3) offset.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      offset.normalize();
      if (!trooper.dead && distance < blast.lethal) trooper.die('blast', offset.clone().multiplyScalar(6));
      trooper.forcePush(offset.multiplyScalar(pick(blast.speed) * falloff).setY(pick(blast.lift) * falloff));
    }
    if (held && held.dead) { held = null; }
    // The hero: knocked off his feet close by, rocked further off.
    const toHero = here.set(motion.x, 0, motion.z).sub(at), reach = toHero.length();
    if (reach < blast.radius) {
      const falloff = (1 - reach / blast.radius) ** 1.1;
      const direction = reach > 1e-3 ? toHero.clone().divideScalar(reach) : new THREE.Vector3(1, 0, 0);
      if (reach < blast.knock && !knockdown.active) knockHero(direction, Math.max(0.45, falloff));
      else if (reach < blast.knock) knockdown.knock(direction.clone().multiplyScalar(3 * falloff).setY(2 * falloff));
      else { motion.vx += direction.x * 6 * falloff; motion.vz += direction.z * 6 * falloff; }
    }
    const near = Math.max(0, 1 - reach / 14);
    // The whole view rocks: hard at his feet, still felt across the room.
    trauma.add(0.42 + 0.58 * near);
    rumble(0.35 + 0.65 * near, 0.25 + 0.6 * near, 0.3 + 0.45 * near);
    shove(new THREE.Vector3(0, -1, 0), blast.kick * (0.4 + 0.6 * near));
    punch(blast.punch * near);
    stopFor(0.012, 0.05);
    audio.boom(at, Math.max(0, 1 - reach / 7));
    noise(at, 15, { alarm: true, from: character.root.position });
  }
  function knockHero(direction, falloff) {
    breakStreak();
    const velocity = direction.clone().setY(0).normalize().multiplyScalar(pick(FEEL.blast.speed) * falloff).setY(pick(FEEL.blast.lift) * falloff);
    velocity.x += motion.vx * 0.5;
    velocity.z += motion.vz * 0.5;
    unskewer();
    combat.reset();
    trail.clear();
    if (held) { held.drop(); held = null; }
    character.root.updateMatrixWorld(true);
    knockdown.knock(velocity, { spin: pick(FEEL.blast.tumble) });
    bladeReady = false;
  }

  // Lighting bloom is calculated inside the reduced-resolution framebuffer.
  // The final canvas is then enlarged with nearest-neighbour, never blurred.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(640, 400), 0.45, 0.15, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let pixelSize = 4, viewHeight = 8.2, desiredHeight = 8.2;
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    const renderWidth = Math.max(1, Math.floor(width / pixelSize));
    const renderHeight = Math.max(1, Math.floor(height / pixelSize));
    renderer.setSize(renderWidth, renderHeight, false);
    composer.setSize(renderWidth, renderHeight);
    reflection.getRenderTarget().setSize(renderWidth, renderHeight);
    reflection.material.uniforms.texel.value.set(1 / renderWidth, 1 / renderHeight);
    updateProjection();
  }
  function updateProjection(height = viewHeight) {
    const aspect = window.innerWidth / window.innerHeight;
    camera.top = height / 2; camera.bottom = -height / 2;
    camera.left = -height * aspect / 2; camera.right = height * aspect / 2;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const keys = new Set();
  let paused = false, time = 0, moved = false, forcedGuard = false;
  const velocity = new THREE.Vector3();
  const playerPosition = new THREE.Vector3();
  const inputRight = new THREE.Vector2(10, -8).normalize();
  const inputForward = new THREE.Vector2(-8, -10).normalize();
  const joystick = { x: 0, y: 0, running: false, pointer: null };
  const actionCodes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyT', 'KeyU', 'KeyI', 'KeyE'];
  // B / J strike, RB / K guard (a press parries), LT / U pull, RT / I push.
  let attackPressed = false, padAttack = false, parryPressed = false, padGuard = false, powerPressed = null, padPull = false, padPush = false;
  // Y / Space dash; R3 / E twirl the blade; L3 / T start the fight again.
  let dashPressed = false, padDash = false, twirlPressed = false, padTwirl = false, padRestart = false;
  // A press that cannot be taken yet (mid-strike, a cooldown) waits a moment instead of being lost.
  const pending = { attack: -Infinity, dash: -Infinity, power: -Infinity, powerName: null };
  let inputClock = 0;
  const waiting = at => inputClock - at <= FEEL.input.buffer;
  window.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT'].includes(event.target.tagName)) return;
    if (actionCodes.includes(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'Escape') setPause(!paused);
      if (event.code === 'KeyR') reset();
      if (event.code === 'KeyH') togglePanel('help');
      if (event.code === 'KeyF') fullscreen();
      if (event.code === 'KeyT') restart();
      if (event.code === 'Space') dashPressed = true;
      if (event.code === 'KeyE') twirlPressed = true;
      if (event.code === 'KeyJ') attackPressed = true;
      if (event.code === 'KeyK') parryPressed = true;
      if (event.code === 'KeyU') powerPressed = 'forcePull';
      if (event.code === 'KeyI') powerPressed = 'forcePush';
    }
    keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  function clearInput() { keys.clear(); attackPressed = parryPressed = dashPressed = twirlPressed = false; powerPressed = null; joystick.x = joystick.y = 0; joystick.running = false; $('#stick').style.transform = ''; }
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); setPause(true); } });
  $('#game').addEventListener('pointerdown', () => { renderer.domElement.focus(); if (audio.enabled) audio.start(); });
  $('#game').addEventListener('wheel', event => {
    event.preventDefault(); desiredHeight = THREE.MathUtils.clamp(desiredHeight + event.deltaY * 0.005, 5, 12);
    $('#camera-zoom').value = desiredHeight;
  }, { passive: false });
  function setPause(value) { paused = value; clearInput(); $('#pause-overlay').hidden = !paused; if (!paused) renderer.domElement.focus(); }
  function reset() {
    knockdown.stop();
    motion.reset(); character.root.position.set(0, 0, 0); character.root.rotation.y = motion.heading;
    character.update({ dt: 0, time, speed: 0, runBlend: 0, turnRate: 0 });
    combat.reset(); trail.clear(); cape.reset(); bladeReady = false; cameraFocus.set(0, 0.6, 0);
  }
  function togglePanel(name) {
    const willOpen = $(`#${name}-panel`).hidden;
    for (const panel of ['help', 'settings']) { $(`#${panel}-panel`).hidden = true; $(`#${panel}-toggle`).setAttribute('aria-expanded', 'false'); }
    $(`#${name}-panel`).hidden = !willOpen;
    $(`#${name}-toggle`).setAttribute('aria-expanded', String(willOpen));
  }
  for (const name of ['help', 'settings']) {
    $(`#${name}-toggle`).addEventListener('click', () => togglePanel(name));
    $(`#${name}-panel .close-panel`).addEventListener('click', () => togglePanel(name));
  }
  $('#pixel-size').addEventListener('change', event => { pixelSize = Number(event.target.value); resize(); });
  $('#camera-zoom').addEventListener('input', event => desiredHeight = Number(event.target.value));
  $('#reflections').addEventListener('change', event => reflection.visible = event.target.checked);
  $('#resume').addEventListener('click', () => setPause(false));
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { $('#fullscreen').title = 'Le plein écran est indisponible dans cette fenêtre.'; }
  }
  $('#fullscreen').addEventListener('click', fullscreen);

  const pad = $('#joystick');
  function moveStick(event) {
    const rect = pad.getBoundingClientRect();
    let x = (event.clientX - rect.left - rect.width / 2) / 39;
    let y = (event.clientY - rect.top - rect.height / 2) / 39;
    const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
    joystick.x = x; joystick.y = -y;
    $('#stick').style.transform = `translate(${x * 32}px, ${y * 32}px)`;
  }
  pad.addEventListener('pointerdown', event => { joystick.pointer = event.pointerId; pad.setPointerCapture(event.pointerId); moveStick(event); });
  pad.addEventListener('pointermove', event => { if (event.pointerId === joystick.pointer) moveStick(event); });
  const releaseStick = () => { joystick.pointer = null; joystick.x = joystick.y = 0; $('#stick').style.transform = ''; };
  pad.addEventListener('pointerup', releaseStick); pad.addEventListener('pointercancel', releaseStick);
  $('#touch-run').addEventListener('pointerdown', event => { event.target.setPointerCapture(event.pointerId); joystick.running = true; });
  $('#touch-run').addEventListener('pointerup', () => joystick.running = false);
  $('#touch-run').addEventListener('pointercancel', () => joystick.running = false);

  const audio = createAudio();
  audio.enabled = $('#audio-enabled').checked;
  audio.volume = Number($('#audio-volume').value);
  $('#audio-enabled').addEventListener('change', event => { audio.enabled = event.target.checked; if (audio.enabled) audio.start(); });
  $('#audio-volume').addEventListener('input', event => { audio.volume = Number(event.target.value); });
  rumbleOn = $('#rumble').checked;
  $('#rumble').addEventListener('change', event => { rumbleOn = event.target.checked; });
  document.body.classList.toggle('tech-info', $('#tech-info').checked);
  $('#tech-info').addEventListener('change', event => document.body.classList.toggle('tech-info', event.target.checked));
  window.addEventListener('keydown', () => { if (audio.enabled) audio.start(); });
  let lastFrame = performance.now(), fps = 60, hudTimer = 0, frameCount = 0;
  const stateEl = $('#motion-state'), speedEl = $('#speed'), saberEl = $('#saber-state'), squadEl = $('#squad-state'), precisionEl = $('#precision');
  const killsEl = $('#kills'), waveEl = $('#wave'), reinforceEl = $('#reinforce-state'), streakEl = $('#streak'), streakCountEl = $('#streak-count'), streakNoteEl = $('#streak-note');
  const targetFocus = new THREE.Vector3(), shakenFocus = new THREE.Vector3();
  // The camera's own axes (for the shake), and the lean of the view towards the fight.
  camera.updateMatrixWorld();
  const viewRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), viewUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const lean = new THREE.Vector3(), leanTarget = new THREE.Vector3();
  // Footsteps (the hero's and the troopers'), and bolts already heard whizzing past.
  let heroStep = 0.6, lastActionShake = 0, scrape = 0;
  const trooperSteps = new WeakMap();
  function frame(now, manual = false) {
    // Never backwards: a stepped check (advance) may run ahead of the display clock.
    const rawDt = Math.max(0, (now - lastFrame) / 1000);
    const dt = Math.min(rawDt, 0.05);
    lastFrame = now;
    audio.listen(character.root.position, screenRight);
    if (!paused) {
      // A clean cut freezes the action for a beat, then eases back to speed.
      const sim = dt * (hitStop ? hitStopScale(hitStop.age, hitStop) : 1);
      if (hitStop && (hitStop.age += dt) > hitStop.hold + hitStop.recover) hitStop = null;
      time += sim;
      let x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) + joystick.x;
      let y = Number(keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + joystick.y;
      let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || joystick.running;
      let guard = keys.has('KeyK') || forcedGuard;
      pullHeld = keys.has('KeyU');
      // The stick's tilt sets the pace: slow walk, brisk walk, run, then sprint.
      let analog = Math.hypot(joystick.x, joystick.y) > 0.01 && !sprint;
      const gamepad = navigator.getGamepads?.()?.find(pad => pad?.connected);
      if (gamepad) {
        const ax = gamepad.axes[0] || 0, ay = -(gamepad.axes[1] || 0);
        const length = Math.hypot(ax, ay);
        if (length > 0.16) { const gain = Math.min(1, (length - 0.16) / 0.8) / length; x += ax * gain; y += ay * gain; analog = true; }
        // Standard mapping: B (1) strikes; RB (5) guards and a press parries
        // (A, 0, guards too); LT (6) pulls and RT (7) pushes with the Force.
        // LB (4) or RB (5): the guard that takes the bolts.
        const guardButton = !!gamepad.buttons[5]?.pressed || !!gamepad.buttons[4]?.pressed;
        if (guardButton && !padGuard) parryPressed = true;
        padGuard = guardButton;
        guard ||= guardButton || !!gamepad.buttons[0]?.pressed;
        if (audio.enabled && gamepad.buttons.some(button => button?.pressed)) audio.start();
        const attackButton = !!gamepad.buttons[1]?.pressed;
        if (attackButton && !padAttack) attackPressed = true;
        padAttack = attackButton;
        const pull = (gamepad.buttons[6]?.value ?? 0) > (padPull ? 0.3 : 0.5), push = (gamepad.buttons[7]?.value ?? 0) > (padPush ? 0.3 : 0.5);
        if (pull && !padPull) powerPressed = 'forcePull';
        if (push && !padPush) powerPressed = 'forcePush';
        padPull = pull; padPush = push;
        pullHeld ||= pull;
        // Y puts the stormtrooper back on his feet.
        // Y: the dash. L3 (left stick pressed): the fight starts again. R3: the twirl.
        const dashButton = !!gamepad.buttons[3]?.pressed;
        if (dashButton && !padDash) dashPressed = true;
        padDash = dashButton;
        const restartButton = !!gamepad.buttons[10]?.pressed;
        if (restartButton && !padRestart) restart();
        padRestart = restartButton;
        const twirlButton = !!gamepad.buttons[11]?.pressed;
        if (twirlButton && !padTwirl) twirlPressed = true;
        padTwirl = twirlButton;
      }
      const inputLength = Math.max(1, Math.hypot(x, y)); x /= inputLength; y /= inputLength;
      const worldX = inputRight.x * x + inputForward.x * y, worldZ = inputRight.y * x + inputForward.y * y;
      // Thrown by a blast: no control until he is back on his feet.
      const down = knockdown.active;
      inputClock += dt;
      if (down) {
        attackPressed = parryPressed = dashPressed = twirlPressed = false; powerPressed = null; guard = false; pullHeld = false; x = y = 0;
        pending.attack = pending.dash = pending.power = -Infinity;
      }
      // The dash: along the stick, or straight ahead with the stick at rest.
      dashCooldown = Math.max(0, dashCooldown - sim);
      dodge = Math.max(0, dodge - sim);
      dashAfter = Math.max(0, dashAfter - sim);
      if (dashPressed) pending.dash = inputClock;
      if (waiting(pending.dash) && !dash && dashCooldown <= 0 && !skewered && !combat.impaling) {
        pending.dash = -Infinity;
        const along = Math.hypot(worldX, worldZ) > 0.2 ? new THREE.Vector3(worldX, 0, worldZ).normalize() : new THREE.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
        startDash(along);
      }
      if (twirlPressed) combat.twirl();
      dashPressed = twirlPressed = false;
      // Powers cut any strike short; a parry too; B strikes and chains.
      keepHold();
      const attackHeld = padAttack || keys.has('KeyJ');
      impaleInput(dt, attackHeld, down);
      // The guard: held, or just pressed (a parry, the window of a perfect one).
      if (parryPressed) parryPress();
      autoParry(guard || time - parryTry < 0.3);
      if (powerPressed) { pending.power = inputClock; pending.powerName = powerPressed; }
      if (waiting(pending.power) && combat.power(pending.powerName)) pending.power = -Infinity;
      if (parryPressed) combat.parry();
      if (attackPressed) pending.attack = inputClock;
      if (waiting(pending.attack)) {
        // During the dash or just after it, the strike lunges from it.
        const rushing = Boolean(dash) || dashAfter > 0;
        if (combat.attack({ speed: rushing ? Math.max(motion.speed, 5) : motion.speed })) {
          pending.attack = -Infinity;
          strikeFromDash = rushing;
          endDash();
          dashAfter = 0;
        }
      }
      attackPressed = parryPressed = false;
      powerPressed = null;
      // B kept down through a strike calls the finisher (not while running a trooper through).
      const action = combat.update(sim, { guard, speed: motion.speed, hold: Boolean(held), charging: attackHeld && !thrust && !skewered });
      // A strike finds its mark (lockOn); other moves re-aim towards the stick;
      // a power with the stick at rest turns towards the trooper the hero is facing most.
      const started = combat.takeStart();
      if (started && !/^(force|parry)/.test(started)) noise(here.set(motion.x, 0, motion.z), 5, { from: here });
      const strike = started && MOVES[started] && !MOVES[started].utility && !MOVES[started].free;
      if (strike) { lockOn(started, worldX, worldZ); audio.whoosh(MOVES[started].role.includes('finisher') ? 1.4 : 1); }
      else if (started && !/^(parry|impale)/.test(started) && Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ));
      else if (started === 'forcePull' || started === 'forcePush') {
        const aimed = target(started === 'forcePull' ? FEEL.pull.range : FEEL.push.range, 1.2);
        if (aimed) { const at = whereIs(aimed); motion.face(Math.atan2(at.x - motion.x, at.z - motion.z)); }
      }
      const released = combat.takeForce();
      if (released) unleash(released);
      if (down) {
        const at = knockdown.position, moving = knockdown.velocity;
        motion.x = at.x; motion.z = at.z; motion.vx = moving.x; motion.vz = moving.z; motion.speed = 0;
      } else if (dash) dashStep(sim);
      else {
        motion.update(sim, worldX, worldZ, { sprint: sprint && !action.engaged, analog, maxSpeed: action.maxSpeed, inputScale: action.inputScale, drive: action.drive, turnScale: action.turnScale, engaged: action.engaged });
        lungeStep(sim);
      }
      for (const trooper of troopers) {
        const blocker = trooper.blocker();
        if (!blocker || down) continue;
        const dx = motion.x - blocker.x, dz = motion.z - blocker.z, distance = Math.hypot(dx, dz), reach = blocker.radius + 0.24;
        if (distance < reach && distance > 1e-4) { motion.x = blocker.x + dx / distance * reach; motion.z = blocker.z + dz / distance * reach; }
      }
      // Crates and barrels stop him.
      if (!down) {
        lab.pushOut(here.set(motion.x, 0, motion.z), 0.3);
        motion.x = here.x; motion.z = here.z;
      }
      if (!moved && (motion.speed > 0.1 || action.engaged)) { moved = true; document.body.classList.add('playing'); }
      velocity.set(motion.vx, 0, motion.vz);
      if (down) {
        // The ragdoll lays his skeleton out; once up, the motion capture takes over again.
        const up = knockdown.update(sim, time);
        if (up) { motion.x = up.x; motion.z = up.z; motion.heading = up.heading; motion.vx = motion.vz = motion.speed = 0; bladeReady = false; }
      } else {
        character.root.position.set(motion.x, 0, motion.z);
        character.root.rotation.y = motion.heading + action.spin;
        character.update({ dt: sim, time, speed: motion.speed, runBlend: motion.runBlend, sprintIntent: Math.max(motion.sprint, sprint && Math.hypot(x, y) > 0.05 ? 1 : 0) * (1 - action.guard), turnRate: motion.turnRate, forwardAccel: motion.forwardAccel, action });
        debris.kick(character.root.position, velocity);
      }
      cape.update({ dt: sim, time, velocity });
      // Igniting the blade, moving or not, comes with a quick draw twirl.
      const saberEvent = saber.update(motion.saber, time, action.flare);
      if (saberEvent === 'ignite') { combat.flourish(); noise(character.root.position, 6.5, { from: character.root.position }); audio.ignite(); }
      else if (saberEvent === 'retract') audio.retract();
      // His steps on the deck.
      if (!down && !dash && motion.speed > 0.35) {
        heroStep += motion.speed * sim / (motion.runBlend > 0.5 ? 1.25 : 0.7);
        if (heroStep >= 1) { heroStep %= 1; audio.step(character.root.position, { pace: Math.min(1, motion.speed / SPRINT_PACE) }); }
      } else heroStep = 0.6;
      // Running feet and the blade's hum carry.
      stepClock -= sim; humClock -= sim;
      if (motion.speed > 2.4 && stepClock <= 0) { stepClock = 0.3; noise(character.root.position, motion.sprint > 0.5 ? 7 : 4.5, { from: character.root.position }); }
      if (motion.saber > 0.5 && humClock <= 0) { humClock = 0.6; noise(character.root.position, 2.6, { from: character.root.position, strength: 0.6 }); }
      saber.segment(bladeBase, bladeTip);
      trail.update(sim, bladeBase, bladeTip, action.trail * motion.saber);
      const swing = sim > 0 ? lastTip.distanceTo(bladeTip) / sim : 0;
      // The squad: senses, decisions, orders; then the shots leave the muzzles.
      const thoughts = squad.update(sim, { hero: character.root.position, heroVelocity: velocity, saber: motion.saber, noises });
      noises.length = 0;
      // Reinforcements: the alarm, the door, the men coming out one by one.
      const living = troopers.filter(trooper => !trooper.dead).length, entering = squad.minds.filter(mind => mind.entering).length;
      for (const event of reinforcements.update(sim, { living, entering })) {
        if (event === 'alarm') audio.alarm(arena.door.centre);
        else if (event === 'open' || event === 'close') audio.door(arena.door.centre);
        else if (event.type === 'spawn') bringIn(event.index);
      }
      for (const shot of thoughts.shots) {
        blasters.fire(shot.from, shot.direction, { owner: shot.trooper, speed: FEEL.blaster.speed });
        audio.shot(shot.from);
        noise(shot.from, 12, { alarm: true, from: character.root.position, source: shot.trooper });
      }
      for (const cue of thoughts.cues) {
        const at = cue.trooper.root.position;
        if (cue.type === 'alert') { audio.alert('!', at); audio.radio(at, 'contact', cue.trooper); }
        else if (cue.type === 'suspicious') audio.alert('?', at);
        else if (cue.radio) audio.radio(at, cue.radio, cue.trooper);
      }
      keepSkewer(sim);
      for (const trooper of troopers) { trooper.focus = character.root.position; trooper.update(sim, time); }
      collideSquad(troopers);
      // One hit stop per enemy and per strike (a new strike, a new one).
      const strikeKey = `${combat.sequence}:${combat.hits}`;
      if (strikeKey !== stoppedSequence) { stopped.clear(); stoppedSequence = strikeKey; }
      troopers.forEach((trooper, index) => {
        const struck = saber.extension > 0.6 && bladeReady && !down && skewered?.trooper !== trooper ? trooper.strike(lastBase, lastTip, bladeBase, bladeTip, sim, time, strikeKey) : [];
        if (!trooper.fallen) debris.kick(trooper.root.position, trooper.velocity);
        if (struck.some(event => event.type !== 'fall')) noise(trooper.root.position, 9, { alarm: true, from: character.root.position, source: trooper });
        for (const event of struck) {
          // Falls are reported alongside the blow that caused them.
          if (event.type === 'fall' || (event.type === 'graze' && event.speed < 1)) continue;
          const heavy = event.type === 'cut' || event.type === 'slash' || event.type === 'disarm';
          // A short hit stop on a clean cut, a little longer on a felling blow
          // — once per enemy and per attack sequence, so it never drags.
          const felling = event.lethal || event.felled;
          if (heavy && !stopped.has(index)) {
            stopped.add(index);
            const [hold, recover] = felling ? FEEL.hitStop.felling : event.type === 'cut' ? FEEL.hitStop.cut : FEEL.hitStop.blow;
            stopFor(hold, recover);
          }
          shove(event.velocity, felling ? FEEL.camera.kickFelling : heavy ? FEEL.camera.kick : 0.012);
          if (heavy) punch(FEEL.camera.punch * (felling ? 1.8 : event.type === 'cut' ? 1 : 0.7));
          trauma.add(felling ? 0.26 : heavy ? 0.14 : 0.03);
          if (heavy) rumble(felling ? 0.55 : 0.2, felling ? 0.6 : 0.5, felling ? 0.15 : 0.08);
          audio.impact(felling ? 1.1 : heavy ? 0.9 : 0.35, trooper.root.position);
          if (heavy) score(1);
        }
        // Landings, armour coming off: heard and felt in step with the physics.
        for (const item of trooper.news) {
          if (item.type === 'land') { audio.thud(Math.min(1, item.speed / 8), item.point); trauma.add(Math.min(0.15, item.speed * 0.02)); noise(item.point, 7, { alarm: true, from: character.root.position, source: trooper }); }
          if (item.type === 'armor') audio.clank(trooper.root.position);
          // A grenade leaves his hand (or drops at his feet if he was knocked over).
          if (item.type === 'grenade') {
            if (item.dropped) grenades.drop(item.from);
            else grenades.throwAt(item.from, item.target, { fuse: pick(FEEL.grenade.fuse) });
            audio.toss(item.from);
          }
        }
      });
      // The lit blade in a case, a wall, the floor: a molten line follows it, sparks and a sizzle.
      if (saber.extension > 0.6 && bladeReady && !down && sim > 0) {
        // Held low while he walks, the tip dips into the deck: only a strike marks the floor.
        const contacts = scars.cut(bladeBase, bladeTip, time, { floor: combat.busy && action.trail > 0.2 });
        scarSparks -= sim; scarSizzle -= sim;
        for (const contact of contacts) {
          if (!contact.fresh && scarSparks > 0) continue;
          const along = new THREE.Vector3().subVectors(bladeTip, lastTip).projectOnPlane(contact.normal);
          if (along.lengthSq() < 1e-8) along.set(contact.normal.z, 0, -contact.normal.x);
          effects.sparks(contact.point, contact.normal.clone().addScaledVector(along.normalize(), -0.6).normalize(), along, { count: contact.fresh ? 9 : 3, speed: 2.4, saber: 0.35 });
        }
        if (contacts.length && scarSparks <= 0) scarSparks = 0.05;
        if (contacts.some(contact => contact.fresh) && scarSizzle <= 0) { scarSizzle = 0.3; audio.sizzle(contacts[0].point); }
        if (contacts.length) scrape = 1;
      }
      scars.update(sim);
      bladeReady = saber.extension > 0.6;
      lastBase.copy(bladeBase);
      lastTip.copy(bladeTip);
      // Bolts fly: the blade, the hero, the troopers, then crates and floor.
      for (const event of blasters.update(sim, boltMeets)) {
        if (event.type === 'impact') audio.boltImpact(event.point);
      }
      // Bolts whizzing past his head.
      chest.set(motion.x, 1.15, motion.z);
      for (const bolt of blasters.live) {
        if (bolt.deflected || bolt.whizzed) continue;
        offset.subVectors(bolt.position, chest);
        if (offset.length() < 1.6 && offset.dot(bolt.velocity) > 0) { bolt.whizzed = true; audio.flyby(bolt.position, bolt.velocity); }
      }
      // The troopers' steps as they run, the armour clacking.
      for (const trooper of troopers) {
        if (trooper.fallen || trooper.dead) continue;
        const pace = trooper.velocity.length();
        if (pace < 1.1 || trooper.root.position.distanceTo(character.root.position) > 13) { trooperSteps.set(trooper, 0.5); continue; }
        let phase = (trooperSteps.get(trooper) ?? 0.5) + pace * sim / 1.3;
        if (phase >= 1) { phase %= 1; audio.step(trooper.root.position, { pace: Math.min(1, pace / 3.7), armour: true }); }
        trooperSteps.set(trooper, phase);
      }
      // Kills: every man down for good counts once.
      for (const trooper of troopers) if (trooper.dead && !counted.has(trooper)) { counted.add(trooper); eliminated++; score(2); }
      for (const at of grenades.update(sim)) detonate(at);
      explosions.update(sim, camera);
      debris.update(sim);
      alerts.update(dt, trooper => (trooper.dead || trooper.impaled ? null : trooper.particle('HT').position), screenRight);
      effects.update(sim);
      playerPosition.copy(character.root.position);
      lighting.follow(playerPosition);
      // In a fight, the view leans a little towards the squad, so the shooters stay in frame.
      leanTarget.set(0, 0, 0);
      let weight = 0;
      for (const mind of squad.minds) {
        if (mind.mode !== 'combat' || mind.trooper.dead) continue;
        const p = mind.trooper.root.position, distance = Math.hypot(p.x - motion.x, p.z - motion.z);
        if (distance > 14) continue;
        const w = 1 / (1 + distance * 0.2);
        leanTarget.x += (p.x - motion.x) * w; leanTarget.z += (p.z - motion.z) * w; weight += w;
      }
      if (weight > 0) leanTarget.multiplyScalar(0.32 / weight).clampLength(0, 2.2);
      lean.lerp(leanTarget, 1 - Math.exp(-1.6 * sim));
      targetFocus.set(motion.x + motion.vx * 0.16 + lean.x, 0.6, motion.z + motion.vz * 0.16 + lean.z);
      cameraFocus.lerp(targetFocus, 1 - Math.exp(-7 * sim));
      stage.update({ time, playerPosition });
      lab.update(time);
      arena.update(time);
      // A finisher landing jolts the view.
      if (action.shake > lastActionShake + 0.05) { trauma.add(action.shake * 0.5); rumble(0.5 * action.shake, 0.4, 0.15); }
      lastActionShake = action.shake;
      // The shake: trauma (real time, so it rings through a hit stop) along the view's own axes.
      const jolt = trauma.update(dt);
      shake.copy(viewRight).multiplyScalar(jolt.offset.x).addScaledVector(viewUp, jolt.offset.y);
      roll = jolt.roll;
      // The kick runs in real time too.
      cameraKick.age += dt;
      shake.add(kickOffset.copy(cameraKick.direction).multiplyScalar(cameraKick.amplitude * kick(cameraKick.age, { duration: 0.3, frequency: 11 })));
      scrape = Math.max(0, scrape - dt * 6);
      zoomPunch.age += dt;
      audio.swing = Math.min(1, swing / 12) * action.weight;
    }
    updateStreak(dt);
    viewHeight = damp(viewHeight, desiredHeight + motion.runBlend * 0.24, 6, dt);
    // Zoom punch: in fast, out slowly.
    const punched = zoomPunch.age < 0.05 ? ease.outQuad(zoomPunch.age / 0.05) : 1 - ease.inOutSine(Math.min(1, (zoomPunch.age - 0.05) / 0.3));
    updateProjection(viewHeight * (1 - zoomPunch.amount * punched));
    camera.position.copy(cameraFocus).add(cameraOffset).add(shake);
    camera.lookAt(shakenFocus.copy(cameraFocus).add(shake));
    if (roll) camera.rotateZ(roll);
    camera.updateMatrixWorld();
    // Warnings: glints at the muzzles about to fire, chevrons for threats out of view.
    const aiming = [], threats = [];
    for (const mind of squad.minds) {
      const t = mind.trooper;
      if (t.dead || mind.mode !== 'combat') continue;
      if (mind.charge > 0 && t.holding) aiming.push({ position: t.muzzle, amount: mind.charge });
      threats.push({ position: t.root.position.clone().setY(1.1), kind: mind.charge > 0 ? 'aiming' : 'shooter' });
    }
    for (const grenade of grenades.live) threats.push({ position: grenade.position, kind: 'grenade' });
    telegraph.update(paused ? 0 : dt, aiming);
    telegraph.edges(camera, paused ? [] : threats, window.innerWidth, window.innerHeight);
    const burning = skewered?.entered ? (skewered.trooper.dead ? 0.3 : 0.75) : 0;
    audio.update(paused ? 0 : motion.saber, motion.speed, motion.turnRate, { burn: paused ? 0 : Math.max(scrape * 0.8, burning), hold: paused || !held ? 0 : 1, fight: paused ? 0 : { alerte: 1, suspicion: 0.35 }[squad.mood()] ?? 0, dt });
    composer.render(dt);
    fps = damp(fps, 1 / Math.max(rawDt, 0.001), 1, dt);
    hudTimer += dt;
    if (hudTimer > 0.15) {
      hudTimer = 0;
      const move = combat.output.name ?? '';
      stateEl.textContent = paused ? 'EN PAUSE' : knockdown.active ? 'À TERRE' : skewered ? 'EMPALEMENT' : held ? 'EMPRISE' : move.startsWith('force') ? 'FORCE' : move.startsWith('parry') ? 'PARADE' : combat.busy ? 'ATTAQUE' : combat.guarding ? 'GARDE' : motion.speed < 0.05 ? 'IMMOBILE' : motion.sprint > 0.5 ? 'SPRINT' : motion.runBlend > 0.5 ? 'COURSE' : 'MARCHE';
      speedEl.textContent = motion.speed.toFixed(1);
      saberEl.textContent = motion.saber > 0.05 ? 'SABRE ACTIF' : 'SABRE EN VEILLE';
      $('#performance').textContent = `${Math.round(fps)} FPS · PIXELS ${pixelSize}×`;
      const mood = squad.mood();
      squadEl.textContent = mood.toUpperCase();
      squadEl.dataset.mood = mood;
      precisionEl.textContent = `${Math.round(precision * 100)} %`;
      killsEl.textContent = String(eliminated).padStart(2, '0');
      waveEl.textContent = String(reinforcements.waves).padStart(2, '0');
      const phase = reinforcements.phase;
      reinforceEl.textContent = phase === 'wait' ? `${Math.max(0, Math.ceil(reinforcements.countdown))} S` : phase === 'alarm' ? 'ALERTE' : phase === 'closing' ? 'FERMETURE' : 'ENTRÉE';
    }
    // The streak shows while it lives (a few seconds after the last point); a broken one flashes red.
    streakAge += dt; streakNoteAge += dt; streakBroken += dt;
    const showing = (streak >= 2 && streakAge < 3.5) || streakBroken < 0.9;
    streakEl.classList.toggle('on', showing);
    streakEl.classList.toggle('broken', streakBroken < 0.9);
    if (streakBroken < 0.9 && streak === 0) streakCountEl.textContent = '×';
    else streakCountEl.textContent = String(streak);
    if (streakAge >= 3.5 && streak) streak = 0;
    streakNoteEl.textContent = streakNote;
    streakNoteEl.classList.toggle('on', streakNoteAge < 1.1);
    if (++frameCount === 3) {
      $('#loading').style.opacity = '0';
      setTimeout(() => $('#loading').hidden = true, 550);
    }
    if (!manual) requestAnimationFrame(frame);
  }
  // Read-only diagnostics for regression checks; this does not drive gameplay.
  window.__STARWARD__ = {
    // Game feel settings, tweakable live from the console.
    feel: FEEL,
    /** Runs the game for some seconds without waiting for the display (checks, hidden windows). */
    advance(seconds, step = 1 / 60) { for (let t = 0; t < seconds - 1e-9; t += step) frame(lastFrame + step * 1000, true); lastFrame = performance.now(); },
    /** For checks: where the hero is put, and the squad, lab and bolts. */
    place(x, z, heading = motion.heading) { motion.x = x; motion.z = z; motion.heading = heading; bladeReady = false; },
    squad, lab, arena, reinforcements, blasters, troopers, grenades, explosions, debris, knockdown, marks, scars, audio, telegraph,
    camera,
    /** For checks: the lit blade this frame. */
    blade: () => ({ base: bladeBase.clone(), tip: bladeTip.clone() }),
    /** For checks: a grenade thrown by trooper `index` (or dropped) at (x, z). */
    grenade(x, z, from = null) { const start = from ?? troopers[0].root.position.clone().setY(1.3); return grenades.throwAt(start, new THREE.Vector3(x, 0, z), { fuse: 1.6 }); },
    explode(x, z) { detonate(new THREE.Vector3(x, 0, z)); },
    set guard(value) { forcedGuard = value; },
    /** For checks: the strike's glide to its target (null when none). */
    get lunge() { return lunge && { age: lunge.age, duration: lunge.duration, gap: lunge.gap, done: lunge.done, track: lunge.track }; },
    /** For checks: who is on the blade (null if nobody). */
    get skewered() { return skewered?.trooper ?? null; },
    getState: () => ({ x: motion.x, z: motion.z, speed: motion.speed, heading: motion.heading, runBlend: motion.runBlend, sprint: motion.sprint, idleTime: motion.idleTime, saber: motion.saber, attack: combat.output.name, guard: combat.guard, sequence: combat.sequence, armour: troopers.map(trooper => trooper.armour), troopersDown: troopers.filter(trooper => trooper.fallen).length, troopersDead: troopers.filter(trooper => trooper.dead).length, troopers: troopers.map(trooper => trooper.state), heroDown: knockdown.phase, hitStop: hitStop ? +hitStop.hold.toFixed(3) : 0, grenades: grenades.live.length, explosions: explosions.active, debris: debris.bodies.length, squad: squad.minds.map(mind => mind.mode), tactics: squad.minds.map(mind => mind.tactic), bolts: blasters.live.length, precision, deflections, perfects, burns, kills, eliminated, streak, trauma: trauma.trauma, aiming: squad.minds.filter(mind => mind.charge > 0).length, severed: troopers.flatMap(trooper => [...trooper.severed]), paused, pixelSize, fps, frames: frameCount, capeFinite: cape.mesh.geometry.attributes.position.array.every(Number.isFinite), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }),
  };
  requestAnimationFrame(frame);
}

