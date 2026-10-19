import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createCharacter } from './character.js';
import { createCoat } from './coat.js';
import { createStage } from './stage.js';
import { createLighting } from './lighting.js';
import { createSaber } from './saber.js';
import { MotionController, damp } from './motion.js';
import { CombatController } from './combat.js';
import { createBladeTrail } from './blade-trail.js';
import { createStormtrooper, collideSquad } from './stormtrooper.js';
import { ease, hitStopScale, kick } from './tween.js';
import { FEEL, pick } from './feel.js';
import { createImpactEffects } from './impact-effects.js';
import { createLab, onScreen } from './lab.js';
import { createBlasters, closestSegments } from './blasters.js';
import { createAlerts } from './alerts.js';
import { createSquadMind } from './trooper-ai.js';
import { returnDirection } from './deflect.js';
import { createExplosions, loadExplosionAssets } from './explosions.js';
import { createScorchMarks } from './scorch-marks.js';
import { createDebris } from './debris.js';
import { createGrenades } from './grenades.js';
import { createHeroRagdoll } from './hero-ragdoll.js';

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

  const stage = createStage(scene);
  // The AI lab: crates, barrels and barriers on the floor, no walls.
  const lab = createLab(scene);
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
  const explosions = createExplosions(scene, { marks, slots: 5 });
  camera.layers.enable(1);
  loadExplosionAssets(explosions).catch(error => console.error('Chargement de l’explosion interrompu :', error));
  const debris = createDebris(scene, { lab });
  debris.scatter();
  const grenades = createGrenades(scene, { lab, reach: FEEL.grenade.reach, onBeep: (grenade, progress) => audio.beep(progress, grenade.position.distanceTo(character.root.position)) });
  const knockdown = createHeroRagdoll(character, { lab });
  const blasters = createBlasters(scene, { effects, lab, marks });
  const squad = createSquadMind({ troopers, lab, alerts, posts: POSTS, cameraRight: screenRight });
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
  let bladeReady = false, hitStop = null, impactShake = 0, padReset = false;
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
  function resetTrooper() {
    skewered = thrust = null;
    combat.unpin();
    for (const trooper of troopers) trooper.reset();
    effects.clear(); blasters.clear(); squad.reset(); grenades.clear(); explosions.clear(); marks.clear();
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
      impactShake = Math.max(impactShake, 0.22);
      audio.impact(1);
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
    const { aim } = returnDirection({ at, incoming, precision, closeness, enemies });
    blasters.deflect(bolt, at, aim, FEEL.blaster.speed * FEEL.deflect.speedUp);
    // Guarding, he turns a little into a shot from the side (one from behind is taken behind his back).
    const toward = Math.atan2(a.x - motion.x, a.z - motion.z), turn = Math.atan2(Math.sin(toward - motion.heading), Math.cos(toward - motion.heading));
    if (Math.abs(turn) > 0.45 && Math.abs(turn) < 1.95) motion.face(motion.heading + turn * 0.3);
    train(FEEL.deflect.precision.gain);
    const across = new THREE.Vector3().crossVectors(incoming, UP).normalize();
    // A small spray, blade-blue and molten-yellow mixed.
    effects.sparks(at, aim.clone().add(incoming.clone().multiplyScalar(-0.5)).normalize(), across, { count: Math.round(pick([7, 13])), speed: 3, saber: 0.5 });
    effects.flash(at, 0.8);
    effects.burst(at, { normal: incoming, power: 0.45, tint: 'red' });
    combat.output.flare = 1;
    stopFor(0.012, 0.035);
    shove(aim, 0.025);
    impactShake = Math.max(impactShake, 0.06);
    audio.deflect();
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
    audio.sizzle();
    burns++;
  }
  let deflections = 0, burns = 0, kills = 0;
  /** Every bolt, every frame: the blade first, then the hero, then (sent back) the troopers. */
  function boltMeets(bolt, a, b) {
    const wall = lab.segmentHit(a, b), end = wall ? wall.point : b;
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
    audio.impact(event.lethal ? 1 : 0.6);
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
    impactShake = Math.max(impactShake, blast.shake * (0.35 + 0.65 * near));
    shove(new THREE.Vector3(0, -1, 0), blast.kick * (0.4 + 0.6 * near));
    punch(blast.punch * near);
    stopFor(0.012, 0.05);
    audio.boom(reach);
    noise(at, 15, { alarm: true, from: character.root.position });
  }
  function knockHero(direction, falloff) {
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
  const actionCodes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyT', 'KeyU', 'KeyI'];
  // B / J strike, RB / K guard (a press parries), LT / U pull, RT / I push.
  let attackPressed = false, padAttack = false, parryPressed = false, padGuard = false, powerPressed = null, padPull = false, padPush = false;
  window.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT'].includes(event.target.tagName)) return;
    if (actionCodes.includes(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'Escape') setPause(!paused);
      if (event.code === 'KeyR') reset();
      if (event.code === 'KeyH') togglePanel('help');
      if (event.code === 'KeyF') fullscreen();
      if (event.code === 'KeyT') resetTrooper();
      if (event.code === 'KeyJ') attackPressed = true;
      if (event.code === 'KeyK') parryPressed = true;
      if (event.code === 'KeyU') powerPressed = 'forcePull';
      if (event.code === 'KeyI') powerPressed = 'forcePush';
    }
    keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  function clearInput() { keys.clear(); attackPressed = parryPressed = false; powerPressed = null; joystick.x = joystick.y = 0; joystick.running = false; $('#stick').style.transform = ''; }
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
  $('#audio-enabled').addEventListener('change', event => { audio.enabled = event.target.checked; if (audio.enabled) audio.start(); });
  window.addEventListener('keydown', () => { if (audio.enabled) audio.start(); });
  let lastFrame = performance.now(), fps = 60, hudTimer = 0, frameCount = 0;
  const stateEl = $('#motion-state'), speedEl = $('#speed'), saberEl = $('#saber-state'), squadEl = $('#squad-state'), precisionEl = $('#precision');
  const targetFocus = new THREE.Vector3(), shakenFocus = new THREE.Vector3();
  function frame(now, manual = false) {
    // Never backwards: a stepped check (advance) may run ahead of the display clock.
    const rawDt = Math.max(0, (now - lastFrame) / 1000);
    const dt = Math.min(rawDt, 0.05);
    lastFrame = now;
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
        const guardButton = !!gamepad.buttons[5]?.pressed;
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
        const resetButton = !!gamepad.buttons[3]?.pressed;
        if (resetButton && !padReset) resetTrooper();
        padReset = resetButton;
      }
      const inputLength = Math.max(1, Math.hypot(x, y)); x /= inputLength; y /= inputLength;
      const worldX = inputRight.x * x + inputForward.x * y, worldZ = inputRight.y * x + inputForward.y * y;
      // Thrown by a blast: no control until he is back on his feet.
      const down = knockdown.active;
      if (down) { attackPressed = parryPressed = false; powerPressed = null; guard = false; pullHeld = false; x = y = 0; }
      // Powers cut any strike short; a parry too; B strikes and chains.
      keepHold();
      impaleInput(dt, padAttack || keys.has('KeyJ'), down);
      autoParry(guard);
      if (powerPressed) combat.power(powerPressed);
      if (parryPressed) combat.parry();
      if (attackPressed) combat.attack({ speed: motion.speed });
      attackPressed = parryPressed = false;
      powerPressed = null;
      const action = combat.update(sim, { guard, speed: motion.speed, hold: Boolean(held) });
      // Each move re-aims towards the stick before it lands; a power with the
      // stick at rest turns towards the trooper the hero is facing most.
      const started = combat.takeStart();
      if (started && !/^(force|parry)/.test(started)) noise(here.set(motion.x, 0, motion.z), 5, { from: here });
      if (started && !/^(parry|impale)/.test(started) && Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ));
      else if (started === 'forcePull' || started === 'forcePush') {
        const aimed = target(started === 'forcePull' ? FEEL.pull.range : FEEL.push.range, 1.2);
        if (aimed) { const at = whereIs(aimed); motion.face(Math.atan2(at.x - motion.x, at.z - motion.z)); }
      }
      const released = combat.takeForce();
      if (released) unleash(released);
      if (down) {
        const at = knockdown.position, moving = knockdown.velocity;
        motion.x = at.x; motion.z = at.z; motion.vx = moving.x; motion.vz = moving.z; motion.speed = 0;
      } else motion.update(sim, worldX, worldZ, { sprint: sprint && !action.engaged, analog, maxSpeed: action.maxSpeed, inputScale: action.inputScale, drive: action.drive, turnScale: action.turnScale, engaged: action.engaged });
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
      if (saber.update(motion.saber, time, action.flare) === 'ignite') { combat.flourish(); noise(character.root.position, 6.5, { from: character.root.position }); }
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
      for (const shot of thoughts.shots) {
        blasters.fire(shot.from, shot.direction, { owner: shot.trooper, speed: FEEL.blaster.speed });
        audio.shot(shot.from.distanceTo(character.root.position));
        noise(shot.from, 12, { alarm: true, from: character.root.position, source: shot.trooper });
      }
      for (const cue of thoughts.cues) audio.alert(cue.type === 'alert' ? '!' : '?');
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
          impactShake = Math.max(impactShake, felling ? 0.3 : heavy ? 0.14 : 0.05);
          audio.impact(heavy ? 1 : 0.35);
        }
        // Landings, armour coming off: heard and felt in step with the physics.
        for (const item of trooper.news) {
          if (item.type === 'land') { audio.thud(Math.min(1, item.speed / 8)); impactShake = Math.max(impactShake, Math.min(0.18, item.speed * 0.025)); noise(item.point, 7, { alarm: true, from: character.root.position, source: trooper }); }
          if (item.type === 'armor') audio.clank();
          // A grenade leaves his hand (or drops at his feet if he was knocked over).
          if (item.type === 'grenade') {
            if (item.dropped) grenades.drop(item.from);
            else grenades.throwAt(item.from, item.target, { fuse: pick(FEEL.grenade.fuse) });
            audio.whoosh?.();
          }
        }
      });
      bladeReady = saber.extension > 0.6;
      lastBase.copy(bladeBase);
      lastTip.copy(bladeTip);
      // Bolts fly: the blade, the hero, the troopers, then crates and floor.
      for (const event of blasters.update(sim, boltMeets)) {
        if (event.type === 'impact') audio.boltImpact(event.point.distanceTo(character.root.position));
      }
      for (const at of grenades.update(sim)) detonate(at);
      explosions.update(sim, camera);
      debris.update(sim);
      alerts.update(dt, trooper => (trooper.dead || trooper.impaled ? null : trooper.particle('HT').position), screenRight);
      effects.update(sim);
      playerPosition.copy(character.root.position);
      lighting.follow(playerPosition);
      targetFocus.set(motion.x + motion.vx * 0.16, 0.6, motion.z + motion.vz * 0.16);
      cameraFocus.lerp(targetFocus, 1 - Math.exp(-7 * sim));
      stage.update({ time, playerPosition });
      // A heavy landing shakes the view for a moment.
      impactShake = Math.max(0, impactShake - dt * 3);
      shake.set(Math.sin(time * 91 + now * 0.05), Math.sin(time * 77 + 1 + now * 0.04), Math.sin(time * 83 + 2)).multiplyScalar(action.shake * action.shake * 0.09 + impactShake * impactShake * 0.07);
      // The kick runs in real time, so it rings through a hit stop.
      cameraKick.age += dt;
      shake.add(kickOffset.copy(cameraKick.direction).multiplyScalar(cameraKick.amplitude * kick(cameraKick.age, { duration: 0.3, frequency: 11 })));
      zoomPunch.age += dt;
      audio.swing = Math.min(1, swing / 12) * action.weight;
    }
    viewHeight = damp(viewHeight, desiredHeight + motion.runBlend * 0.24, 6, dt);
    // Zoom punch: in fast, out slowly.
    const punched = zoomPunch.age < 0.05 ? ease.outQuad(zoomPunch.age / 0.05) : 1 - ease.inOutSine(Math.min(1, (zoomPunch.age - 0.05) / 0.3));
    updateProjection(viewHeight * (1 - zoomPunch.amount * punched));
    camera.position.copy(cameraFocus).add(cameraOffset).add(shake);
    camera.lookAt(shakenFocus.copy(cameraFocus).add(shake));
    audio.update(paused ? 0 : motion.saber, motion.speed, motion.turnRate);
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
    }
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
    squad, lab, blasters, troopers, grenades, explosions, debris, knockdown, marks,
    /** For checks: a grenade thrown by trooper `index` (or dropped) at (x, z). */
    grenade(x, z, from = null) { const start = from ?? troopers[0].root.position.clone().setY(1.3); return grenades.throwAt(start, new THREE.Vector3(x, 0, z), { fuse: 1.6 }); },
    explode(x, z) { detonate(new THREE.Vector3(x, 0, z)); },
    set guard(value) { forcedGuard = value; },
    /** For checks: who is on the blade (null if nobody). */
    get skewered() { return skewered?.trooper ?? null; },
    getState: () => ({ x: motion.x, z: motion.z, speed: motion.speed, heading: motion.heading, runBlend: motion.runBlend, sprint: motion.sprint, idleTime: motion.idleTime, saber: motion.saber, attack: combat.output.name, guard: combat.guard, sequence: combat.sequence, armour: troopers.map(trooper => trooper.armour), troopersDown: troopers.filter(trooper => trooper.fallen).length, troopersDead: troopers.filter(trooper => trooper.dead).length, troopers: troopers.map(trooper => trooper.state), heroDown: knockdown.phase, hitStop: hitStop ? +hitStop.hold.toFixed(3) : 0, grenades: grenades.live.length, explosions: explosions.active, debris: debris.bodies.length, squad: squad.minds.map(mind => mind.mode), tactics: squad.minds.map(mind => mind.tactic), bolts: blasters.live.length, precision, deflections, burns, kills, severed: troopers.flatMap(trooper => [...trooper.severed]), paused, pixelSize, fps, frames: frameCount, capeFinite: cape.mesh.geometry.attributes.position.array.every(Number.isFinite), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }),
  };
  requestAnimationFrame(frame);
}

function createAudio() {
  let context, gain, oscillatorA, oscillatorB;
  return {
    enabled: false,
    start() {
      if (!context) {
        context = new (window.AudioContext || window.webkitAudioContext)();
        gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination);
        oscillatorA = context.createOscillator(); oscillatorB = context.createOscillator();
        oscillatorA.type = 'sine'; oscillatorB.type = 'triangle';
        oscillatorA.frequency.value = 72; oscillatorB.frequency.value = 144.6;
        const secondary = context.createGain(); secondary.gain.value = 0.16;
        oscillatorA.connect(gain); oscillatorB.connect(secondary); secondary.connect(gain);
        oscillatorA.start(); oscillatorB.start();
      }
      context.resume().catch(() => {});
    },
    swing: 0,
    /** A crackling hiss with a low thud when the blade bites. */
    impact(strength) {
      if (!this.enabled || !context) return;
      const length = Math.floor(context.sampleRate * 0.35);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.22));
      const noise = context.createBufferSource(), band = context.createBiquadFilter(), level = context.createGain();
      noise.buffer = buffer; band.type = 'bandpass'; band.frequency.value = 2200; band.Q.value = 0.7;
      level.gain.value = 0.14 * strength;
      noise.connect(band); band.connect(level); level.connect(context.destination);
      noise.start();
      const thud = context.createOscillator(), thudLevel = context.createGain();
      thud.frequency.setValueAtTime(110, context.currentTime);
      thud.frequency.exponentialRampToValueAtTime(45, context.currentTime + 0.2);
      thudLevel.gain.setValueAtTime(0.18 * strength, context.currentTime);
      thudLevel.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
      thud.connect(thudLevel); thudLevel.connect(context.destination);
      thud.start(); thud.stop(context.currentTime + 0.3);
    },
    /** A Force whoosh: a rising sweep for a push, a falling one for a pull. */
    force(kind) {
      if (!this.enabled || !context) return;
      const length = Math.floor(context.sampleRate * 0.5), now = context.currentTime;
      const buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / length) ** 2;
      const noise = context.createBufferSource(), band = context.createBiquadFilter(), level = context.createGain();
      noise.buffer = buffer; band.type = 'bandpass'; band.Q.value = 1.4;
      const [from, to] = kind === 'push' ? [260, 1500] : [1500, 260];
      band.frequency.setValueAtTime(from, now);
      band.frequency.exponentialRampToValueAtTime(to, now + 0.4);
      level.gain.value = 0.22;
      noise.connect(band); band.connect(level); level.connect(context.destination);
      noise.start();
    },
    /** A body hitting the floor. */
    thud(strength) {
      if (!this.enabled || !context) return;
      const now = context.currentTime, thud = context.createOscillator(), level = context.createGain();
      thud.frequency.setValueAtTime(90, now);
      thud.frequency.exponentialRampToValueAtTime(38, now + 0.18);
      level.gain.setValueAtTime(0.2 * strength, now);
      level.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      thud.connect(level); level.connect(context.destination);
      thud.start(); thud.stop(now + 0.25);
    },
    /** Armour clattering off. */
    clank() {
      if (!this.enabled || !context) return;
      const now = context.currentTime, tone = context.createOscillator(), level = context.createGain();
      tone.type = 'square';
      tone.frequency.setValueAtTime(620 + Math.random() * 300, now);
      tone.frequency.exponentialRampToValueAtTime(240, now + 0.09);
      level.gain.setValueAtTime(0.035, now);
      level.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      tone.connect(level); level.connect(context.destination);
      tone.start(); tone.stop(now + 0.14);
    },
    /** A burst of filtered noise (a crack, a fizz, a thump of air). */
    noiseBurst({ duration = 0.12, type = 'bandpass', frequency = 2000, q = 0.8, gain = 0.1, decay = 0.25 } = {}) {
      const length = Math.floor(context.sampleRate * duration), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * decay));
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), level = context.createGain();
      source.buffer = buffer; filter.type = type; filter.frequency.value = frequency; filter.Q.value = q; level.gain.value = gain;
      source.connect(filter); filter.connect(level); level.connect(context.destination);
      source.start();
    },
    tone({ type = 'sine', from = 880, to = 440, duration = 0.15, gain = 0.05, delay = 0 } = {}) {
      const now = context.currentTime + delay, tone = context.createOscillator(), level = context.createGain();
      tone.type = type;
      tone.frequency.setValueAtTime(from, now);
      tone.frequency.exponentialRampToValueAtTime(to, now + duration);
      level.gain.setValueAtTime(0.0001, now);
      level.gain.exponentialRampToValueAtTime(gain, now + 0.006);
      level.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      tone.connect(level); level.connect(context.destination);
      tone.start(now); tone.stop(now + duration + 0.02);
    },
    /** A blaster shot: a bright zap falling in pitch, fainter far off. */
    shot(distance = 5) {
      if (!this.enabled || !context) return;
      const near = Math.max(0.2, 1 - distance / 18);
      this.tone({ type: 'sawtooth', from: 1500 + Math.random() * 400, to: 150, duration: 0.17, gain: 0.05 * near });
      this.tone({ type: 'square', from: 900 + Math.random() * 200, to: 110, duration: 0.12, gain: 0.025 * near });
      this.noiseBurst({ duration: 0.05, frequency: 3000, gain: 0.05 * near, decay: 0.3 });
    },
    /** The blade sends a bolt back: a crack and a ringing metallic zing. */
    deflect() {
      if (!this.enabled || !context) return;
      this.noiseBurst({ duration: 0.06, type: 'highpass', frequency: 2500, gain: 0.12, decay: 0.2 });
      this.tone({ from: 2900 + Math.random() * 500, to: 1900, duration: 0.32, gain: 0.05 });
      this.tone({ from: 4300 + Math.random() * 400, to: 3100, duration: 0.22, gain: 0.03 });
      this.tone({ type: 'triangle', from: 640, to: 220, duration: 0.14, gain: 0.05 });
    },
    /** A bolt bursting on a crate or the floor. */
    boltImpact(distance = 5) {
      if (!this.enabled || !context) return;
      const near = Math.max(0.15, 1 - distance / 16);
      this.noiseBurst({ duration: 0.14, type: 'lowpass', frequency: 1600, gain: 0.12 * near, decay: 0.2 });
      this.tone({ from: 180, to: 60, duration: 0.12, gain: 0.06 * near });
    },
    /** A bolt burning the hero's robe. */
    sizzle() {
      if (!this.enabled || !context) return;
      this.noiseBurst({ duration: 0.28, type: 'highpass', frequency: 3200, gain: 0.07, decay: 0.45 });
    },
    /** An explosion: a crack, a deep thump and a long rumble, quieter far off. */
    boom(distance = 5) {
      if (!this.enabled || !context) return;
      const near = Math.max(0.25, 1 - distance / 26);
      this.noiseBurst({ duration: 0.14, type: 'highpass', frequency: 1500, gain: 0.3 * near, decay: 0.16 });
      this.tone({ from: 85, to: 26, duration: 1.2, gain: 0.42 * near });
      this.tone({ type: 'triangle', from: 140, to: 40, duration: 0.5, gain: 0.18 * near });
      this.noiseBurst({ duration: 2.2, type: 'lowpass', frequency: 360, q: 0.4, gain: 0.55 * near, decay: 0.33 });
      this.noiseBurst({ duration: 1.2, type: 'bandpass', frequency: 2400, q: 0.6, gain: 0.05 * near, decay: 0.5 });
    },
    /** The grenade's countdown: a short beep, higher as time runs out. */
    beep(progress = 0, distance = 5) {
      if (!this.enabled || !context) return;
      const near = Math.max(0.2, 1 - distance / 16), pitch = 1700 + progress * 900;
      this.tone({ type: 'square', from: pitch, to: pitch * 0.98, duration: 0.05, gain: 0.035 * near });
    },
    whoosh() {
      if (!this.enabled || !context) return;
      this.noiseBurst({ duration: 0.25, type: 'bandpass', frequency: 900, q: 1.2, gain: 0.05, decay: 0.5 });
    },
    /** "?" — a wondering rise; "!" — the alert's sharp double sting. */
    alert(kind) {
      if (!this.enabled || !context) return;
      if (kind === '!') {
        this.tone({ type: 'square', from: 1320, to: 1300, duration: 0.07, gain: 0.04 });
        this.tone({ type: 'square', from: 1760, to: 1740, duration: 0.16, gain: 0.04, delay: 0.07 });
        this.noiseBurst({ duration: 0.04, type: 'highpass', frequency: 4000, gain: 0.04, decay: 0.3 });
      } else this.tone({ type: 'triangle', from: 480, to: 760, duration: 0.2, gain: 0.05 });
    },
    update(saber, speed, turn) {
      if (!context) return;
      // Strikes swell and raise the hum, like a blade cutting the air.
      gain.gain.setTargetAtTime(this.enabled ? saber * (0.022 + this.swing * 0.05) : 0, context.currentTime, 0.04);
      oscillatorA.frequency.setTargetAtTime(72 + speed * 4 + Math.abs(turn) * 1.5 + this.swing * 60, context.currentTime, 0.04);
      oscillatorB.frequency.setTargetAtTime(144.6 + speed * 7 + this.swing * 110, context.currentTime, 0.04);
    },
  };
}
