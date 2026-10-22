import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BeamPass } from './beam-pass.js';
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
import { createWounds } from './wounds.js';
import { createPixelPrompt } from './pixel-prompt.js';
import { createAudio } from './audio.js';
import { createRadioComms, RADIO_LINES } from './radio-comms.js';
import { createDuel } from './duel.js';
import { createMusic } from './music.js';
import { createShake } from './shake.js';
import { createTelegraph } from './telegraph.js';
import { createFootprints } from './footprints.js';
import { createPower } from './power.js';
import { createTransformer } from './transformer.js';
import { createFlashlights } from './flashlights.js';
import { lightStains } from './stain-light.js';

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
  const effects = createImpactEffects(scene, { lab });
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
  // Red footprints: whoever treads in red drops prints his soles on the next steps.
  const prints = createFootprints(scene);
  let soles = new WeakMap();
  const footAt = new THREE.Vector3(), toeAt = new THREE.Vector3();
  /** A foot coming down: drops under it are trodden in (some taken up); a red sole prints, fainter each step. */
  function footfall(walker, at, along, side, size) {
    const sole = soles.get(walker) ?? { L: 0, R: 0, last: 'R' };
    sole.last = side;
    const found = effects.tread(at);
    if (found) sole[side] = Math.min(1, sole[side] + found * FEEL.prints.soak);
    if (sole[side] > FEEL.prints.faint) prints.stamp(at, along, side, sole[side], size);
    sole[side] *= FEEL.prints.dry;
    soles.set(walker, sole);
  }
  /** One foot after the other: the next foot to come down. */
  const nextFoot = walker => ((soles.get(walker)?.last ?? 'R') === 'R' ? 'L' : 'R');
  /** A Jedi's foot coming down (the hero's, his enemy's): where its sole is, and heel to toe. */
  function bodyFootfall(body, heading) {
    const bones = body.rig.bones, side = nextFoot(body);
    bones[side === 'L' ? 'LeftFoot' : 'RightFoot'].getWorldPosition(footAt);
    bones[side === 'L' ? 'LeftToeBase' : 'RightToeBase'].getWorldPosition(toeAt);
    const along = toeAt.clone().sub(footAt).setY(0);
    if (along.lengthSq() < 1e-6) along.set(Math.sin(heading), 0, Math.cos(heading));
    footfall(body, footAt.clone().lerp(toeAt, 0.4).setY(0), along.normalize(), side, FEEL.prints.hero);
  }
  const heroFootfall = () => bodyFootfall(character, motion.heading);
  /** A trooper's foot coming down: its sole from heel to toe. */
  function trooperFootfall(trooper) {
    const side = nextFoot(trooper);
    const heel = trooper.particle(`HE${side}`).position, toe = trooper.particle(`T${side}`).position;
    const along = toe.clone().sub(heel).setY(0);
    if (along.lengthSq() < 1e-6) along.set(Math.sin(trooper.heading), 0, Math.cos(trooper.heading));
    footfall(trooper, heel.clone().lerp(toe, 0.5).setY(0), along.normalize(), side, FEEL.prints.trooper);
  }
  // Warnings: a glint at a muzzle about to fire; chevrons at the screen's edges for threats out of view.
  const telegraph = createTelegraph(scene, { overlay: $('#threats') });
  const knockdown = createHeroRagdoll(character, { lab });
  // Die and retry: god mode (on unless turned off in the settings) keeps him alive; off, one mistake kills him.
  const wounds = createWounds();
  wounds.scene = scene;
  let godMode = true, death = null, retryPressed = false, padRetry = false;
  try { const saved = localStorage.getItem('starward.god'); if (saved !== null) godMode = saved === '1'; } catch { /* no storage */ }
  const blasters = createBlasters(scene, { effects, lab, marks });
  // The squad finds its way round the crates and walls on a navigation grid.
  // In the back corner, the transformer the room's lights hang on (an obstacle like a crate).
  const transformer = createTransformer(scene, { lab, effects, at: new THREE.Vector3(7.4, 0, -10.675), facing: new THREE.Vector3(0, 0, 1) });
  // The room's power: every light of it follows one level; the rifle lamps for the dark.
  const power = createPower({ scene, roots: [{ group: lab.group, keep: FEEL.blackout.keep }, arena.group], lighting });
  const flashlights = createFlashlights(scene, { lab, bounds: arena.bounds });
  // What may light the red stains in the dark: the rifle lamps, their spills, the blade.
  const stainLights = [...flashlights.pool, ...flashlights.spills, ...saber.lights];
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
  // The fight's course: the squad at its posts; all of them down, an escort
  // marches in through the great door; all of those down too, the Jedi comes alone.
  const course = { stage: 'squad', clock: 0 };
  function courseStep(sim) {
    if (course.stage === 'squad' || course.stage === 'escort') {
      // Nobody standing, and nobody still to come through the door.
      const cleared = !troopers.some(trooper => !trooper.dead) && reinforcements.phase === 'idle';
      course.clock = cleared ? course.clock + sim : 0;
      if (course.stage === 'squad' && course.clock > FEEL.course.escortAfter) { reinforcements.summon(FEEL.course.escort); course.stage = 'escort'; course.clock = 0; }
      else if (course.stage === 'escort' && course.clock > FEEL.course.jediAfter) { duel.enter(); course.stage = 'jedi'; course.clock = 0; }
    } else if (course.stage === 'jedi' && duel.outcome === 'victory') { course.stage = 'won'; course.clock = 0; }
    else if (course.stage === 'won') {
      course.clock += sim;
      $('#victory').classList.toggle('on', course.clock > 2.4);
    }
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
  let criticalCount = 0;
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
    radio.reset();
    // First: a hero cut down in the duel gets his body back.
    duel.reset();
    duelView = null;
    wasDueling = false;
    course.stage = 'squad';
    course.clock = 0;
    $('#victory').classList.remove('on');
    resetTrooper();
    reset();
    // The power back on, the transformer as new.
    plunge = null;
    night = 0;
    blackout = null;
    cascade = [];
    power.level = 1;
    transformer.reset();
    flashlights.clear();
    streak = eliminated = criticalCount = 0;
    streakAge = streakBroken = Infinity;
    trauma.clear();
    telegraph.clear();
    dash = lunge = turn = intent = null;
    lead = 0;
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
    prints.clear();
    soles = new WeakMap();
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
  /**
   * The trooper a strike now would go for: the nearest to the stick's way
   * (ahead of him with the stick at rest — or, nobody there, one close behind
   * him). With where he is from the hero: angle (rad, + to his left), distance.
   */
  function findMark(worldX, worldZ, rushing) {
    const assist = FEEL.assist;
    const stick = Math.hypot(worldX, worldZ) > 0.2;
    const along = stick ? new THREE.Vector3(worldX, 0, worldZ).normalize() : new THREE.Vector3(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    const range = rushing ? assist.dashRange : assist.range, cone = stick ? assist.cone : assist.coneIdle;
    here.set(motion.x, 0, motion.z);
    let best = null, bestScore = Infinity, behind = null, behindDistance = FEEL.choreography.near;
    for (const trooper of troopers) {
      if (trooper.dead || trooper.impaled) continue;
      const offset = whereIs(trooper).sub(here), distance = offset.length();
      if (distance > range) continue;
      const angle = distance < 0.4 ? 0 : along.angleTo(offset);
      if (angle > cone) {
        if (!stick && !trooper.fallen && distance < behindDistance) { behindDistance = distance; behind = trooper; }
        continue;
      }
      const score = angle * 1.6 + distance * 0.35 + (trooper.fallen ? 0.7 : 0) - (trooper === held ? 1 : 0);
      if (score < bestScore) { bestScore = score; best = trooper; }
    }
    best ??= behind;
    return best ? markOf(best) : null;
  }
  /** Where a trooper is from the hero: distance, and angle from his facing (rad, + to his left). */
  function markOf(trooper) {
    const offset = whereIs(trooper).sub(here.set(motion.x, 0, motion.z));
    return { trooper, distance: offset.length(), angle: angleDelta(motion.heading, Math.atan2(offset.x, offset.z)) };
  }
  // The trooper meant when B was pressed: a queued blow goes for him even if
  // the stick has moved on by the time it starts (a hit stop delays it).
  let intent = null;
  // The strike's turn to its target: the body turns during the blow (when the
  // move says, or until the blade lands), the blade leading; `lead` turns the
  // arms' pose ahead of the body, fed to the next combat update.
  let turn = null, lead = 0;
  function lockOn(name, worldX, worldZ, mark) {
    const assist = FEEL.assist, rushing = strikeFromDash;
    strikeFromDash = false;
    lunge = null;
    turn = null;
    lead = 0;
    if (!mark) { if (Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ)); return; }
    const move = MOVES[name], action = combat.action;
    const gap = THREE.MathUtils.clamp(mark.distance - assist.reach, 0, rushing ? assist.dashStep : assist.step);
    lunge = { trooper: mark.trooper, age: 0, duration: assist.lunge * (gap > 1.6 ? 1.35 : 1), gap, done: 0, track: action ? action.active[0] * action.duration : 0.15 };
    // Nearly ahead: he squares up to him at once. Further round: the body turns during the blow.
    if (Math.abs(mark.angle) < 0.5 && !move.turn) { motion.face(motion.heading + mark.angle); return; }
    const window = move.turn ?? [0, Math.min(0.7, move.active[0] + FEEL.choreography.turnUntil)];
    turn = { trooper: mark.trooper, name, from: motion.heading, window, back: move.back ?? null };
    lunge.track = 0;
  }
  /** Each frame of a turning strike: the heading eased round to the target (tracked if he moves), the blade's lead. */
  function turnStep() {
    lead = 0;
    if (!turn) return;
    const action = combat.action;
    if (!action || action.name !== turn.name || turn.trooper.dead && !turn.trooper.fallen) { turn = null; return; }
    const at = whereIs(turn.trooper), want = Math.atan2(at.x - motion.x, at.z - motion.z);
    let delta = angleDelta(turn.from, want);
    // A turning cut goes round its own way, even the long way.
    if (turn.back === 'right' && delta > 0) delta -= Math.PI * 2;
    if (turn.back === 'left' && delta < 0) delta += Math.PI * 2;
    const [from, to] = turn.window, k = THREE.MathUtils.clamp((combat.time / action.duration - from) / (to - from), 0, 1);
    const eased = turn.back ? ease.inOutCubic(k) : ease.outQuad(k);
    motion.heading = turn.from + delta * eased;
    const c = FEEL.choreography, off = angleDelta(motion.heading, want);
    // Side blows: the blade turns towards him ahead of the body. The thrust behind: aimed at him, behind the back.
    if (!turn.back) lead = THREE.MathUtils.clamp(off * c.lead, -c.maxLead, c.maxLead);
    else if (turn.back === 'thrust' && k === 0) lead = THREE.MathUtils.clamp(angleDelta(Math.sign(off || 1) * Math.PI, off), -0.6, 0.6);
    if (k >= 1) turn = null;
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

  // ---- The sabotage ----------------------------------------------------------------
  // B held by the transformer: he squares up to its arc window and draws the
  // blade far back along his right side, both hands on the hilt, the arc
  // crackling at it and the pad trembling more and more; let go too soon and
  // he lowers it. The hold full, he drives it straight in; it surges (sparks pouring out, arcs leaping to the
  // blade, the room's lights stuttering, the view and the pad shaking harder),
  // then blows — a white flash, a beat of slow motion, the hero thrown back —
  // and the room's power dies: every light out at once, a wave of sparks
  // running through the fittings, the mains hum sinking into silence. Then the
  // dark: the troopers' rifle lamps clicking on one by one, the blade's glow
  // the only light round the hero.
  let plunge = null, night = 0, blackout = null, cascade = [], flashAge = Infinity;
  /** In the dark a blade lights more of the room round it. */
  function nightBlade(blade) { blade.lights.forEach((light, index) => { light.intensity *= 1 + 0.8 * night; light.distance = [3.2, 2.6][index] + 2.2 * night; }); }
  const flashEl = $('#flash'), promptEl = $('#prompt'), prompt = createPixelPrompt(promptEl.querySelector('canvas'));
  function startPlunge() {
    const s = transformer.socket, a = transformer.approach;
    plunge = { age: 0, phase: 'cocking', hold: 0, crackle: 0, entered: false, from: new THREE.Vector3(motion.x, 0, motion.z), to: a.clone() };
    motion.face(Math.atan2(s.x - a.x, s.z - a.z));
    motion.vx = motion.vz = 0;
    dash = lunge = turn = null;
    combat.plunge();
  }
  /** B pressed by the transformer starts the wind-up; held to the end, the thrust; let go before, nothing. */
  function plungeInput(dt, attackHeld, down) {
    if (plunge?.phase === 'cocking') {
      // Let go, thrown, or another move took over: he lowers the blade.
      if (down || !attackHeld || combat.action?.name !== 'plunge') { combat.uncock(); plunge = null; return; }
      plunge.hold += dt;
      const k = Math.min(1, plunge.hold / FEEL.sabotage.hold), s = transformer.socket, out = transformer.facing;
      // The tension: the arc crackling at the blade, faster and harder, the pad trembling more and more.
      rumble(0.06 + 0.3 * k, 0.12 + 0.35 * k, 0.06);
      if ((plunge.crackle -= dt) <= 0) {
        plunge.crackle = 0.3 - 0.16 * k;
        effects.sparks(s.clone().addScaledVector(out, 0.06), out.clone().setY(0.3 + Math.random() * 0.4).normalize(), new THREE.Vector3(out.z, 0, -out.x), { count: Math.round(1 + 4 * k), speed: 1 + 2 * k, saber: 0.6 });
        if (Math.random() < 0.3 + 0.5 * k) audio.zap(s, 0.12 + 0.25 * k);
      }
      if (k >= 1) {
        plunge.phase = 'thrust';
        combat.loose();
        audio.whoosh(1.3);
        rumble(0.3, 0.5, 0.08);
      }
      return;
    }
    // (The blade off after a moment standing still: it lights as he draws it back.)
    if (attackPressed && !down && !plunge && !death && !combat.busy && transformer.reachable(character.root.position)) { attackPressed = false; startPlunge(); }
  }
  function plungeStep(dt) {
    if (!plunge) return;
    plunge.age += dt;
    // A quick step to just before the window, squared up to it.
    const k = ease.outCubic(Math.min(1, plunge.age / 0.14));
    motion.x = THREE.MathUtils.lerp(plunge.from.x, plunge.to.x, k);
    motion.z = THREE.MathUtils.lerp(plunge.from.z, plunge.to.z, k);
    const s = transformer.socket;
    motion.heading = Math.atan2(s.x - motion.x, s.z - motion.z);
    const action = combat.action;
    if (!plunge.entered && plunge.phase === 'thrust' && action?.name === 'plunge' && combat.time / action.duration >= action.impact[0] - 0.01) {
      plunge.entered = true;
      transformer.begin();
      // The blade goes in: a jolt, a gush of blue and molten sparks, a crack of electricity.
      const out = transformer.facing;
      effects.sparks(s.clone().addScaledVector(out, 0.06), out.clone().setY(0.4).normalize(), new THREE.Vector3(out.z, 0, -out.x), { count: 60, speed: 5.5, saber: 0.6 });
      effects.flash(s, 1.8, { color: new THREE.Color(0.55, 0.75, 1) });
      effects.burst(s, { normal: out, power: 1.3, tint: 'blue' });
      stopFor(0.12, 0.2);
      punch(FEEL.camera.punch * 1.4);
      shove(out.clone().negate(), FEEL.camera.kick);
      trauma.add(0.25);
      rumble(0.5, 0.75, 0.25);
      audio.zap(s, 1);
      audio.impact(1.1, s);
      noise(s, 9, { alarm: true, from: s });
    }
    // Pinned while it surges.
    if (plunge.entered && transformer.state !== 'surging') plunge = null;
  }
  /** It blew: the flash, the slow beat, the hero thrown back, and the power cut a hair later. */
  function overload() {
    const s = transformer.socket, out = transformer.facing;
    combat.unpin();
    plunge = null;
    motion.vx = out.x * 4.5; motion.vz = out.z * 4.5;
    flashAge = 0;
    stopFor(0.09, 0.34);
    trauma.add(0.55);
    punch(FEEL.camera.punch * 2.6);
    shove(out, FEEL.camera.kickFelling * 1.3);
    rumble(1, 0.9, 0.45);
    effects.blast(s.clone().addScaledVector(out, 0.1), { sparks: 150, embers: 40, speed: 8 });
    effects.sparks(s, out.clone().setY(0.6).normalize(), new THREE.Vector3(out.z, 0, -out.x), { count: 90, speed: 7, saber: 0.7 });
    effects.flash(s, 3.5, { color: new THREE.Color(0.7, 0.85, 1) });
    debris.fragments(s.clone().setY(0.4), 10);
    marks.blast(s.clone().setY(0), 0.5);
    effects.smoulder(transformer.group, 25);
    audio.bang(s);
    noise(s, 16, { alarm: true, from: s });
    blackout = { age: 0 };
  }
  /** The power dies: lights out (with a last stutter), sparks racing through the fittings, the hum sinking. */
  function cutPower() {
    const s = transformer.socket, c = FEEL.sabotage.cascade;
    const fittings = power.fixturesFrom(s);
    const far = fittings.length ? fittings.at(-1).distanceTo(s) : 1;
    // A wave through the room: the nearest fittings first, a few spread out (not every one).
    cascade = fittings.filter((_, index) => index % Math.max(1, Math.round(fittings.length / 40)) === 0)
      .map((at, index) => ({ at, when: at.distanceTo(s) / far * c + Math.random() * 0.08, pop: index % 3 === 0 }));
    audio.powerDown();
    trauma.add(0.2);
    rumble(0.25, 0.2, 0.9);
    const cues = squad.blackout();
    const witness = troopers.find(trooper => !trooper.dead && trooper.free);
    if (witness) radioCall('blackout', witness);
    flashlights.darkness(troopers);
  }
  /** Each frame: the power's level (stuttering through the surge, the last flicker, then out) and the sparks of the wave. */
  function powerStep(dt, surge) {
    if (blackout) {
      const age = (blackout.age += dt);
      if (!blackout.cut && age >= 0.05) { blackout.cut = true; cutPower(); night = 1; }
      // One last stutter as it dies, then nothing.
      const stutter = [[0, 0.15], [0.05, 0], [0.11, 0.45], [0.15, 0], [0.24, 0.2], [0.27, 0]];
      let level = 0;
      for (const [at, value] of stutter) if (age >= at) level = value;
      power.level = age < 0.05 ? 1 : level;
      for (const entry of cascade) {
        if (entry.done || age - 0.05 < entry.when) continue;
        entry.done = true;
        effects.sparks(entry.at, new THREE.Vector3((Math.random() - 0.5) * 0.6, -1, (Math.random() - 0.5) * 0.6).normalize(), new THREE.Vector3(1, 0, 0), { count: 5 + Math.round(Math.random() * 8), speed: 1.8 });
        if (entry.pop) { audio.pop(entry.at); effects.flash(entry.at, 0.5); }
      }
    } else if (surge > 0) {
      // The surge drags the room's lights down in stutters, worse as it builds.
      power.level = Math.random() < 0.08 + 0.45 * surge ? 0.2 + Math.random() * 0.4 : 1 - 0.25 * surge;
    } else if (!night) power.level = 1;
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
  let deflections = 0, burns = 0, kills = 0, lateParries = 0;
  // The unseen grace: a bolt that reaches him waits a few frames at his chest; a parry meanwhile still sends it back.
  function holdBolt(bolt, point) {
    const direction = bolt.velocity.clone().normalize();
    bolt.held = { since: inputClock, time, point: point.clone(), velocity: bolt.velocity.clone() };
    bolt.velocity.multiplyScalar(1e-4);
    bolt.position.copy(point).addScaledVector(direction, -0.08);
  }
  /** A held bolt, each frame: the guard in time sends it back; the window gone, it hits. */
  function heldBolt(bolt) {
    const h = bolt.held;
    if (death || inputClock - h.since > FEEL.deflect.late.window) {
      bolt.velocity.copy(h.velocity);
      bolt.held = null;
      if (death) return 'spent';
      burnHero(bolt, h.point);
      if (!godMode) killHero('bolt', { point: h.point, direction: h.velocity });
      return 'spent';
    }
    if (parryAt >= h.time || guardUp()) {
      bolt.velocity.copy(h.velocity);
      bolt.held = null;
      lateParries++;
      // As if the blade had met it a little before his chest.
      deflectBolt(bolt, h.point.clone().addScaledVector(h.velocity, -0.06), h.point);
      return 'deflected';
    }
    return null;
  }
  /** Every bolt, every frame: the blade first, then the hero, then (sent back) the troopers. */
  function boltMeets(bolt, a, b) {
    if (bolt.held) return heldBolt(bolt);
    const wall = lab.segmentHit(a, b, box => box.kind === 'rail'), end = wall ? wall.point : b;
    if (!bolt.deflected) {
      if (death) return null;
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
      // A strike under way: a bolt crossing the swinging blade is knocked away.
      if (combat.busy && (combat.output.trail ?? 0) > 0.2 && saber.extension > 0.6 && closestSegments(a, end, bladeBase, bladeTip).distance < FEEL.deflect.blade) { deflectBolt(bolt, a, end); return 'deflected'; }
      // Dashing, he is gone before it arrives: it flies on through where he was.
      if (dodge > 0) return null;
      heroFeet.set(motion.x, 0.3, motion.z); heroHead.set(motion.x, 1.5, motion.z);
      const body = closestSegments(a, end, heroFeet, heroHead);
      // Reaching him: a few frames' grace (a parry now still sends it back).
      if (body.distance < 0.26) { holdBolt(bolt, body.c1); return null; }
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
      if (!godMode && !death && reach < FEEL.death.blast) killHero('blast', { point: at, direction, falloff: Math.max(0.6, falloff) });
      else if (reach < blast.knock && !knockdown.active) knockHero(direction, Math.max(0.45, falloff));
      else if (reach < blast.knock) knockdown.knock(direction.clone().multiplyScalar(3 * falloff).setY(2 * falloff));
      else if (!death) { motion.vx += direction.x * 6 * falloff; motion.vz += direction.z * 6 * falloff; }
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
  /**
   * God mode off, one mistake: he falls dead where the hit throws him. A
   * bolt: a charred wound where it went in, red sprayed out the other side,
   * a twist as he drops. A blast: thrown hard and tumbling, torn and
   * spattered over the side that faced it, red flying everywhere. Then the
   * moment slows, the sound sinks, his blade goes out, his body bleeds where
   * it lies — and "MORT", a press away from the next try.
   */
  function killHero(cause, { point, direction, falloff = 1 }) {
    if (death) return;
    const D = FEEL.death, bones = character.rig.bones, flat = direction.clone().setY(0).normalize();
    death = { cause, age: 0, lying: 0, radioed: false, pooled: false };
    $('#death-hint').textContent = '';
    breakStreak();
    unskewer();
    combat.reset();
    trail.clear();
    dash = lunge = turn = intent = null;
    if (held) { held.drop(); held = null; }
    character.root.updateMatrixWorld(true);
    const chestAt = bones.Spine2.getWorldPosition(new THREE.Vector3()), up = new THREE.Vector3(0, 1, 0);
    if (cause === 'bolt') {
      knockdown.knock(flat.clone().multiplyScalar(D.bolt.push).setY(D.bolt.lift), { spin: D.bolt.spin, dead: true, hit: { at: point, velocity: flat.clone().multiplyScalar(D.bolt.hit) } });
      wounds.strike(bones, point, flat.clone().negate(), 'bolt');
      effects.bleed(point, flat, up, { speed: 3, amount: D.bleed.bolt });
    } else {
      const velocity = flat.clone().multiplyScalar(pick(FEEL.blast.speed) * falloff * D.blastThrow).setY(pick(FEEL.blast.lift) * falloff * D.blastThrow);
      knockdown.knock(velocity, { spin: pick(FEEL.blast.tumble) * 1.3, dead: true });
      wounds.riddle(bones, flat.clone().negate(), Math.round(pick(D.wound.blast.count)));
      effects.bleed(chestAt, flat, up, { speed: 5, amount: D.bleed.blast });
      effects.bleed(chestAt, new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1).add(flat).normalize(), up, { speed: 4, amount: D.bleed.blast * 0.6 });
    }
    // His body keeps bleeding where it lies.
    for (const name of cause === 'bolt' ? ['Spine2'] : ['Spine2', 'Hips', 'Head', 'LeftForeArm']) effects.drip(bones[name], pick(D.drip), cause === 'bolt' ? 1.3 : 1.6);
    const [hold, recover] = D.slow;
    stopFor(hold, recover);
    trauma.add(0.65);
    rumble(1, 0.8, 0.45);
    shove(flat, FEEL.camera.kick * 1.5);
    punch(FEEL.camera.punch * 1.6);
    audio.death();
    if (motion.saber > 0.5) audio.retract();
    bladeReady = false;
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
  // The scene's depth comes with its colour: the beams in the dark stop on what stands there.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new BeamPass(camera, () => flashlights.volumes));
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
  let lastDevice = 'pad';
  window.addEventListener('keydown', () => { lastDevice = 'keyboard'; });
  window.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT'].includes(event.target.tagName)) return;
    if (actionCodes.includes(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'Escape') setPause(!paused);
      if (event.code === 'KeyR') reset();
      if (event.code === 'KeyH') togglePanel('help');
      if (event.code === 'KeyF') fullscreen();
      if (event.code === 'KeyT') restart();
      if (death && ['Enter', 'Space', 'KeyJ', 'KeyK'].includes(event.code)) retryPressed = true;
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
  function setPause(value) { paused = value; clearInput(); radio.setPaused(value); $('#pause-overlay').hidden = !paused; if (!paused) renderer.domElement.focus(); }
  function reset() {
    knockdown.stop();
    death = null;
    wounds.clear();
    $('#death').classList.remove('on');
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
  const radio = createRadioComms({ element: $('#radio-comms'), marker: $('#radio-speaker-marker'), camera, audio });
  const radioCall = (kind, speaker) => radio.offer(kind, speaker, Math.max(0, troopers.indexOf(speaker)));
  // The score, and the Jedi who comes last (duel.js): while they fight, the duel has the hero's body.
  const music = createMusic(audio);
  // Where he stops before the door: in the open, with room round him (the crates there are walked round).
  const duelStand = (() => {
    const door = arena.door, across = new THREE.Vector3(-door.out.z, 0, door.out.x);
    for (const depth of [3.2, 3.6, 2.8, 4.2, 4.8]) for (const side of [0, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8]) {
      const spot = door.centre.clone().addScaledVector(door.out, depth).addScaledVector(across, side).setY(0);
      if (nav.walkable(spot) && lab.pushOut(spot.clone(), 0.7).distanceTo(spot) < 1e-3) return spot;
    }
    return nav.nearest(door.centre.clone().addScaledVector(door.out, 3.2)) ?? door.centre.clone().addScaledVector(door.out, 3.2).setY(0);
  })();
  const duel = createDuel({
    scene, effects, audio, music, wounds, keys, screenRight, screenUp, rumble,
    hero: { character, coat: cape, saber, trail, motion, combat, base: bladeBase, tip: bladeTip },
    door: arena.door, stand: duelStand,
    confine: body => { here.set(body.x, 0, body.z); lab.pushOut(here, 0.3); body.x = here.x; body.z = here.z; },
    route: (from, to) => nav.path(from, to),
    place: point => nav.nearest(point) ?? point,
    onStep: f => bodyFootfall(f.character, f.motion.heading),
    kick: (at, moving) => debris.kick(at, moving),
  });
  stainLights.push(...duel.enemy.saber.lights);
  let duelView = null, wasDueling = false;
  /** Dead in the duel: back on his feet before the Jedi, who waits for him. */
  function retryDuel() {
    death = null;
    $('#death').classList.remove('on');
    wounds.clear();
    duel.retry();
  }
  // The duel's gauges: wounds left, breath, balance, for both.
  const duelHud = $('#duel-hud');
  const gauges = Object.fromEntries(['player', 'enemy'].map(id => {
    const side = duelHud.querySelector(`[data-side=${id}]`);
    const track = kind => { const element = side.querySelector(`.${kind}-track`); element.innerHTML = '<i></i>'.repeat(12); return element; };
    const wounds = side.querySelector('.duel-wounds');
    wounds.innerHTML = '<i></i>'.repeat(3);
    return [id, { energy: track('energy'), posture: track('posture'), wounds }];
  }));
  // A focused visual/audio preview for checking this same HUD in the real scene.
  const radioPreview = new URLSearchParams(location.search).get('radioPreview');
  if (RADIO_LINES[radioPreview]) $('#game').addEventListener('pointerdown', () => radioCall(radioPreview, troopers[0]), { once: true });
  $('#audio-enabled').addEventListener('change', event => { audio.enabled = event.target.checked; radio.setSound(audio.enabled); if (audio.enabled) audio.start(); });
  $('#audio-volume').addEventListener('input', event => { audio.volume = Number(event.target.value); });
  $('#god-mode').checked = godMode;
  document.body.classList.toggle('god', godMode);
  $('#god-mode').addEventListener('change', event => {
    godMode = event.target.checked;
    document.body.classList.toggle('god', godMode);
    try { localStorage.setItem('starward.god', godMode ? '1' : '0'); } catch { /* no storage */ }
  });
  rumbleOn = $('#rumble').checked;
  $('#rumble').addEventListener('change', event => { rumbleOn = event.target.checked; });
  window.addEventListener('keydown', () => { if (audio.enabled) audio.start(); });
  let lastFrame = performance.now(), fps = 60, frameCount = 0;
  const streakEl = $('#streak'), streakCountEl = $('#streak-count'), streakNoteEl = $('#streak-note');
  const targetFocus = new THREE.Vector3(), shakenFocus = new THREE.Vector3();
  // The camera's own axes (for the shake), and the lean of the view towards the fight.
  camera.updateMatrixWorld();
  const viewRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), viewUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const lean = new THREE.Vector3(), leanTarget = new THREE.Vector3();
  // Footsteps (the hero's and the troopers'), and bolts already heard whizzing past.
  let heroStep = 0.6, lastActionShake = 0, scrape = 0, surgeLevel = 0;
  const trooperSteps = new WeakMap();
  function frame(now, manual = false) {
    // Never backwards: a stepped check (advance) may run ahead of the display clock.
    const rawDt = Math.max(0, (now - lastFrame) / 1000);
    const dt = Math.min(rawDt, 0.05);
    lastFrame = now;
    audio.listen(character.root.position, screenRight);
    if (!paused) {
      // A clean cut freezes the action for a beat, then eases back to speed.
      const sim = dt * (hitStop ? hitStopScale(hitStop.age, hitStop) : 1) * (duel.present ? duel.scale(dt) : 1);
      if (hitStop && (hitStop.age += dt) > hitStop.hold + hitStop.recover) hitStop = null;
      time += sim;
      if (death) {
        death.age += dt;
        // His blade goes out as he falls; a trooper tells the others.
        motion.saber = Math.max(0, motion.saber - sim * 3);
        if (!death.radioed && death.age > 0.8) {
          death.radioed = true;
          const near = troopers.filter(trooper => !trooper.dead).sort((a, b) => a.root.position.distanceTo(character.root.position) - b.root.position.distanceTo(character.root.position))[0];
          if (near) radioCall('targetDown', near);
        }
        // Lying still, a pool spreads from under him.
        death.lying += sim;
        if (!death.pooled && death.lying > FEEL.death.pool.after && knockdown.still > 0.2) {
          death.pooled = true;
          const chestAt = character.rig.bones.Spine2.getWorldPosition(new THREE.Vector3());
          wounds.spill(chestAt.lerp(knockdown.position, 0.5));
        }
        wounds.update(sim);
        $('#death').classList.toggle('on', death.age > FEEL.death.show);
        if (retryPressed && death.age > FEEL.death.retry) { if (death.cause === 'duel') retryDuel(); else restart(); }
      }
      retryPressed = false;
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
        if (gamepad.buttons.some(button => button?.pressed) || Math.hypot(gamepad.axes[0] || 0, gamepad.axes[1] || 0) > 0.3) lastDevice = 'pad';
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
        // Dead: A, B or Start, and the next try begins.
        const retryButton = [0, 1, 9].some(index => gamepad.buttons[index]?.pressed);
        if (retryButton && !padRetry) retryPressed = true;
        padRetry = retryButton;
        const restartButton = !!gamepad.buttons[10]?.pressed;
        if (restartButton && !padRestart) restart();
        padRestart = restartButton;
        const twirlButton = !!gamepad.buttons[11]?.pressed;
        if (twirlButton && !padTwirl) twirlPressed = true;
        padTwirl = twirlButton;
      }
      const inputLength = Math.max(1, Math.hypot(x, y)); x /= inputLength; y /= inputLength;
      const worldX = inputRight.x * x + inputForward.x * y, worldZ = inputRight.y * x + inputForward.y * y;
      // Thrown by a blast: no control until he is back on his feet. In the duel, the duel has his body.
      const dueling = duel.fighting;
      const down = !dueling && knockdown.active;
      inputClock += dt;
      let action = combat.output;
      if (dueling) {
        attackPressed = parryPressed = dashPressed = twirlPressed = false; powerPressed = null;
        pending.attack = pending.dash = pending.power = -Infinity;
        duel.step(sim, { immortal: godMode });
        nightBlade(saber);
        velocity.set(motion.vx, 0, motion.vz);
        duelView = duel.camera(dt);
      } else {
        if (down) {
          attackPressed = parryPressed = dashPressed = twirlPressed = false; powerPressed = null; guard = false; pullHeld = false; x = y = 0;
          pending.attack = pending.dash = pending.power = -Infinity;
        }
        // The dash: along the stick, or straight ahead with the stick at rest.
        dashCooldown = Math.max(0, dashCooldown - sim);
        dodge = Math.max(0, dodge - sim);
        dashAfter = Math.max(0, dashAfter - sim);
        if (dashPressed) pending.dash = inputClock;
        if (waiting(pending.dash) && !dash && dashCooldown <= 0 && !skewered && !plunge && !combat.impaling) {
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
        plungeInput(dt, attackHeld, down);
        if (attackPressed) pending.attack = inputClock;
        // Where the next blow would go: the strike is chosen to reach him (ahead, aside, behind).
        if (intent && (intent.dead || intent.impaled)) intent = null;
        const mark = intent ? markOf(intent) : findMark(worldX, worldZ, Boolean(dash) || dashAfter > 0 || strikeFromDash);
        const aim = mark && { angle: mark.angle, distance: mark.distance };
        if (waiting(pending.attack)) {
          // During the dash or just after it, the strike lunges from it.
          const rushing = Boolean(dash) || dashAfter > 0;
          // Pressed towards someone else than the one the current blow goes for: he is the next one.
          const pressed = findMark(worldX, worldZ, rushing);
          if (combat.attack({ speed: rushing ? Math.max(motion.speed, 5) : motion.speed, aim: pressed && { angle: pressed.angle, distance: pressed.distance } })) {
            intent = pressed?.trooper ?? null;
            pending.attack = -Infinity;
            strikeFromDash = rushing;
            endDash();
            dashAfter = 0;
          }
        }
        attackPressed = parryPressed = false;
        powerPressed = null;
        // B kept down through a strike calls the finisher (not while running a trooper through).
        action = combat.update(sim, { guard, speed: motion.speed, hold: Boolean(held), charging: attackHeld && !thrust && !skewered, aim, lead });
        // A strike finds its mark (lockOn); other moves re-aim towards the stick;
        // a power with the stick at rest turns towards the trooper the hero is facing most.
        const started = combat.takeStart();
        if (started && !/^(force|parry)/.test(started)) noise(here.set(motion.x, 0, motion.z), 5, { from: here });
        const strike = started && MOVES[started] && !MOVES[started].utility && !MOVES[started].free;
        if (strike) { lockOn(started, worldX, worldZ, intent ? markOf(intent) : mark); intent = null; audio.whoosh(MOVES[started].role.includes('finisher') ? 1.4 : 1); }
        else if (started) { turn = null; lead = 0; }
        else if (started && !/^(parry|impale|plunge)/.test(started) && Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ));
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
          turnStep();
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
        // In the dark the blade lights more of the room round him.
        nightBlade(saber);
        if (saberEvent === 'ignite') { combat.flourish(); noise(character.root.position, 6.5, { from: character.root.position }); audio.ignite(); }
        else if (saberEvent === 'retract') audio.retract();
        // His steps on the deck.
        if (!down && !dash && motion.speed > 0.35) {
          heroStep += motion.speed * sim / (motion.runBlend > 0.5 ? 1.25 : 0.7);
          if (heroStep >= 1) { heroStep %= 1; audio.step(character.root.position, { pace: Math.min(1, motion.speed / SPRINT_PACE) }); heroFootfall(); }
        } else heroStep = 0.6;
        // Running feet and the blade's hum carry.
        stepClock -= sim; humClock -= sim;
        if (motion.speed > 2.4 && stepClock <= 0) { stepClock = 0.3; noise(character.root.position, motion.sprint > 0.5 ? 7 : 4.5, { from: character.root.position }); }
        if (motion.saber > 0.5 && humClock <= 0) { humClock = 0.6; noise(character.root.position, 2.6, { from: character.root.position, strength: 0.6 }); }
        saber.segment(bladeBase, bladeTip);
        trail.update(sim, bladeBase, bladeTip, action.trail * motion.saber);
        // The Jedi coming in through the door (framed with the hero), or lying where he fell.
        if (duel.present) duel.step(sim);
        duelView = duel.phase === 'entrance' ? duel.camera(dt) : null;
      }
      if (duel.present) nightBlade(duel.enemy.saber);
      if (wasDueling && !dueling) { combat.reset(); trail.clear(); dash = lunge = turn = intent = null; bladeReady = false; }
      wasDueling = dueling;
      if (duel.outcome === 'death' && !death) { death = { cause: 'duel', age: 0, lying: 0, radioed: true, pooled: true }; breakStreak(); $('#death-hint').textContent = duel.cause; }
      const swing = sim > 0 ? lastTip.distanceTo(bladeTip) / sim : 0;
      // The squad: senses, decisions, orders; then the shots leave the muzzles.
      const thoughts = squad.update(sim, { hero: character.root.position, heroVelocity: velocity, saber: motion.saber, noises, darkness: night });
      noises.length = 0;
      if (death) thoughts.shots.length = 0;
      // The escort: the alarm, the door, the men coming out one by one. Then the Jedi.
      // Only the living hold the door open: a man cut down in the doorway is not coming in any more.
      const entering = squad.minds.filter(mind => mind.entering && !mind.trooper.dead).length;
      for (const event of reinforcements.update(sim, { entering })) {
        if (event === 'alarm') { audio.alarm(arena.door.centre); const caller = troopers.find(trooper => !trooper.dead); if (caller) radioCall('reinforce', caller); }
        else if (event === 'open' || event === 'close') audio.door(arena.door.centre);
        else if (event.type === 'spawn') bringIn(event.index);
      }
      courseStep(sim);
      for (const shot of thoughts.shots) {
        blasters.fire(shot.from, shot.direction, { owner: shot.trooper, speed: FEEL.blaster.speed });
        audio.shot(shot.from);
        noise(shot.from, 12, { alarm: true, from: character.root.position, source: shot.trooper });
      }
      for (const cue of thoughts.cues) {
        const at = cue.trooper.root.position;
        if (cue.type === 'heal') { effects.sparks(cue.at, UP, screenRight, { count: 4, speed: 0.7, saber: 1 }); effects.flash(cue.at, 0.3, { color: new THREE.Color(0.45, 0.8, 1) }); continue; }
        if (cue.type === 'healed') { audio.click(cue.at ?? at); continue; }
        if (cue.type === 'alert') { audio.alert('!', at); radioCall('contact', cue.trooper); }
        else if (cue.type === 'suspicious') { audio.alert('?', at); radioCall('suspicious', cue.trooper); }
        else if (cue.radio) radioCall(cue.radio, cue.trooper);
      }
      keepSkewer(sim);
      for (const trooper of troopers) { trooper.focus = character.root.position; trooper.update(sim, time); }
      collideSquad(troopers);
      // One hit stop per enemy and per strike (a new strike, a new one).
      const strikeKey = `${combat.sequence}:${combat.hits}`;
      if (strikeKey !== stoppedSequence) { stopped.clear(); stoppedSequence = strikeKey; }
      troopers.forEach((trooper, index) => {
        const struck = !dueling && saber.extension > 0.6 && bladeReady && !down && skewered?.trooper !== trooper ? trooper.strike(lastBase, lastTip, bladeBase, bladeTip, sim, time, strikeKey) : [];
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
          if (item.type === 'grenade' && !death) {
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
      // The troopers' steps: heard as they run (the armour clacking), printed in red when their soles are.
      for (const trooper of troopers) {
        if (trooper.fallen || trooper.dead) continue;
        const pace = trooper.velocity.length();
        if (pace < 0.35) { trooperSteps.set(trooper, 0.5); continue; }
        let phase = (trooperSteps.get(trooper) ?? 0.5) + pace * sim / THREE.MathUtils.lerp(0.62, 1.3, THREE.MathUtils.clamp((pace - 1.35) / 2.35, 0, 1));
        if (phase >= 1) {
          phase %= 1;
          if (pace > 1.1 && trooper.root.position.distanceTo(character.root.position) < 13) audio.step(trooper.root.position, { pace: Math.min(1, pace / 3.7), armour: true });
          trooperFootfall(trooper);
        }
        trooperSteps.set(trooper, phase);
      }
      // Kills: every man down for good counts once.
      for (const trooper of troopers) if (trooper.dead && !counted.has(trooper)) { counted.add(trooper); eliminated++; score(2); }
      if (eliminated >= 3 && eliminated > criticalCount && troopers.filter(trooper => !trooper.dead).length <= 2) {
        criticalCount = eliminated;
        const caller = troopers.find(trooper => !trooper.dead && trooper.free);
        if (caller) radioCall('critical', caller);
      }
      for (const at of grenades.update(sim)) detonate(at);
      explosions.update(sim, camera);
      debris.update(sim);
      alerts.update(dt, trooper => (trooper.dead || trooper.impaled ? null : trooper.particle('HT').position), screenRight);
      // Through a duel's freeze the sparks still bloom.
      effects.update(duel.frozen ? Math.max(sim, dt * 0.3) : sim);
      prints.update(sim);
      playerPosition.copy(duelView ? duelView.focus : character.root.position);
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
      // In the duel the view frames both fighters.
      if (duelView) targetFocus.copy(duelView.focus);
      else targetFocus.set(motion.x + motion.vx * 0.16 + lean.x, 0.6, motion.z + motion.vz * 0.16 + lean.z);
      cameraFocus.lerp(targetFocus, 1 - Math.exp(-(duelView ? 5 : 7) * sim));
      stage.update({ time, playerPosition });
      lab.update(time);
      arena.update(time);
      // The transformer: its surge, its burst; the room's power after it; the rifle lamps.
      plungeStep(sim);
      const state = transformer.update(sim, { blade: plunge ? { base: bladeBase, tip: bladeTip } : null });
      if (state.burst) overload();
      if (state.spit) { audio.zap(transformer.socket, 0.5); trauma.add(0.04); }
      // The hum of the room's current: rising as he holds the blade back, then the surge itself.
      surgeLevel = Math.max(state.progress, plunge?.phase === 'cocking' ? 0.35 * Math.min(1, plunge.hold / FEEL.sabotage.hold) : 0);
      if (state.progress > 0) { trauma.atLeast(0.12 + 0.3 * state.progress); rumble(0.12 + 0.45 * state.progress, 0.3 + 0.5 * state.progress, 0.12); }
      powerStep(sim, state.progress);
      power.apply();
      // What stirs the dust in the beams: the hero going through, and his blade's tip.
      const stirs = [{ at: here.set(motion.x, 1, motion.z).clone(), speed: motion.speed }, { at: bladeTip.clone(), speed: Math.min(12, swing) }];
      if (duel.present) stirs.push({ at: duel.enemy.tip.clone(), speed: Math.min(12, duel.enemy.swing.length()) });
      for (const trooper of flashlights.update(sim, { troopers, hero: character.root.position, night, stirs })) audio.click(trooper.root.position);
      lightStains(power.level, stainLights);
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
    viewHeight = damp(viewHeight, duelView ? desiredHeight * duelView.zoom : desiredHeight + motion.runBlend * 0.24, duelView ? 3 : 6, dt);
    // Zoom punch: in fast, out slowly.
    const punched = zoomPunch.age < 0.05 ? ease.outQuad(zoomPunch.age / 0.05) : 1 - ease.inOutSine(Math.min(1, (zoomPunch.age - 0.05) / 0.3));
    updateProjection(viewHeight * (1 - zoomPunch.amount * punched) * (1 - (duelView?.punch ?? 0)));
    if (duelView) shake.add(duelView.offset);
    camera.position.copy(cameraFocus).add(cameraOffset).add(shake);
    camera.lookAt(shakenFocus.copy(cameraFocus).add(shake));
    if (roll || duelView?.roll) camera.rotateZ(roll + (duelView?.roll ?? 0));
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
    audio.update(paused ? 0 : motion.saber, motion.speed, motion.turnRate, { burn: paused ? 0 : Math.max(scrape * 0.8, burning, plunge?.entered ? 0.9 : 0), hold: paused || !held ? 0 : 1, fight: paused || duel.present ? 0 : { alerte: 1, suspicion: 0.35 }[squad.mood()] ?? 0, dt, surge: paused ? 0 : surgeLevel, power: power.level, dark: duel.present ? 0 : night });
    if (!paused) music.update();
    radio.update(paused ? 0 : dt);
    document.body.classList.toggle('night', night > 0.5);
    // The burst's flash over everything, gone in a quarter of a second.
    flashAge += dt;
    flashEl.style.opacity = flashAge < 0.3 ? String((1 - flashAge / 0.3) ** 1.6 * 0.9) : '0';
    // The prompt by the transformer, in pixels: B (or J) to hold, DÉTRUIRE, the gauge filling as it is held.
    const cocking = plunge?.phase === 'cocking';
    const canPlunge = !paused && !death && !duel.fighting && (cocking || (!plunge && transformer.reachable(character.root.position) && !knockdown.active));
    const asked = paused || !duel.fighting ? null : duel.ask();
    promptEl.classList.toggle('on', canPlunge || Boolean(asked));
    if (canPlunge || asked) {
      const scale = Math.max(3, pixelSize), size = prompt.draw({ device: lastDevice, label: asked ? asked.label : 'DÉTRUIRE', progress: asked ? asked.progress : cocking ? Math.min(1, plunge.hold / FEEL.sabotage.hold) : 0, time: performance.now() / 1000 });
      const canvas = promptEl.firstElementChild;
      canvas.style.width = `${size.width * scale}px`;
      canvas.style.height = `${size.height * scale}px`;
      const p = (asked ? asked.anchor : transformer.socket.clone().setY(1.7)).project(camera);
      promptEl.style.transform = `translate(${((p.x + 1) / 2 * window.innerWidth - size.width * scale / 2).toFixed(0)}px, ${((1 - p.y) / 2 * window.innerHeight - size.height * scale).toFixed(0)}px)`;
    }
    if (death) $('#death').dataset.device = lastDevice;
    duelHud.hidden = !duel.fighting;
    if (duel.fighting) duel.hud(gauges);
    composer.render(dt);
    fps = damp(fps, 1 / Math.max(rawDt, 0.001), 1, dt);
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
    squad, lab, arena, reinforcements, blasters, troopers, grenades, explosions, debris, knockdown, marks, scars, audio, telegraph, effects,
    duel, music, course,
    /** For checks: every man standing falls (the course moves on). */
    clearRoom() { for (const trooper of troopers) if (!trooper.dead) trooper.die('slash', new THREE.Vector3(0, 0, 1)); },
    renderer, composer, reflection, prints, transformer, power, flashlights, wounds, knockdown,
    get death() { return death; },
    get plunge() { return plunge; },
    combat,
    get god() { return godMode; },
    set god(value) { godMode = value; $('#god-mode').checked = value; document.body.classList.toggle('god', value); },
    get night() { return night; },
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
    getState: () => ({ x: motion.x, z: motion.z, speed: motion.speed, heading: motion.heading, runBlend: motion.runBlend, sprint: motion.sprint, idleTime: motion.idleTime, saber: motion.saber, attack: combat.output.name, guard: combat.guard, sequence: combat.sequence, armour: troopers.map(trooper => trooper.armour), troopersDown: troopers.filter(trooper => trooper.fallen).length, troopersDead: troopers.filter(trooper => trooper.dead).length, troopers: troopers.map(trooper => trooper.state), heroDown: knockdown.phase, hitStop: hitStop ? +hitStop.hold.toFixed(3) : 0, grenades: grenades.live.length, explosions: explosions.active, debris: debris.bodies.length, squad: squad.minds.map(mind => mind.mode), tactics: squad.minds.map(mind => mind.tactic), bolts: blasters.live.length, precision, deflections, perfects, lateParries, burns, kills, eliminated, streak, trauma: trauma.trauma, aiming: squad.minds.filter(mind => mind.charge > 0).length, severed: troopers.flatMap(trooper => [...trooper.severed]), paused, pixelSize, fps, frames: frameCount, capeFinite: cape.mesh.geometry.attributes.position.array.every(Number.isFinite), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }),
  };
  requestAnimationFrame(frame);
}

