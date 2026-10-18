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
  // A squad of stormtroopers stands in a row at the top of the screen, facing
  // the hero: training dummies. Screen-up on the floor is away from the camera.
  const effects = createImpactEffects(scene);
  const screenUp = new THREE.Vector3(-8, 0, -10).normalize(), screenRight = new THREE.Vector3(10, 0, -8).normalize();
  const troopers = [-2, -1, 0, 1, 2].map(slot => createStormtrooper({
    scene, effects,
    position: screenUp.clone().multiplyScalar(4.2).addScaledVector(screenRight, slot * 1.15),
    heading: Math.atan2(-screenUp.x, -screenUp.z) + slot * 0.06,
  }));
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
  function resetTrooper() { for (const trooper of troopers) trooper.reset(); effects.clear(); }
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
      shove(facing, FEEL.camera.kickPush);
      punch(FEEL.camera.punchPush);
      audio.force('push');
    } else {
      const trooper = target(FEEL.pull.range, FEEL.pull.cone);
      const toward = trooper ? whereIs(trooper).sub(here) : facing.clone().multiplyScalar(3);
      const distance = Math.max(0.1, toward.length());
      if (trooper) trooper.forcePull(here.clone().addScaledVector(toward.clone().normalize(), Math.min(FEEL.pull.stop, distance)));
      effects.wave(leftHand, toward, { kind: 'pull', length: distance });
      shove(toward.clone().negate(), FEEL.camera.kick);
      audio.force('pull');
    }
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
  let paused = false, time = 0, moved = false;
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
  $('#audio-enabled').addEventListener('change', event => { audio.enabled = event.target.checked; if (audio.enabled) audio.start(); });
  let lastFrame = performance.now(), fps = 60, hudTimer = 0, frameCount = 0;
  const stateEl = $('#motion-state'), speedEl = $('#speed'), saberEl = $('#saber-state');
  const targetFocus = new THREE.Vector3(), shakenFocus = new THREE.Vector3();
  function frame(now, manual = false) {
    const rawDt = (now - lastFrame) / 1000;
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
      let guard = keys.has('KeyK');
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
        const attackButton = !!gamepad.buttons[1]?.pressed;
        if (attackButton && !padAttack) attackPressed = true;
        padAttack = attackButton;
        const pull = (gamepad.buttons[6]?.value ?? 0) > (padPull ? 0.3 : 0.5), push = (gamepad.buttons[7]?.value ?? 0) > (padPush ? 0.3 : 0.5);
        if (pull && !padPull) powerPressed = 'forcePull';
        if (push && !padPush) powerPressed = 'forcePush';
        padPull = pull; padPush = push;
        // Y puts the stormtrooper back on his feet.
        const resetButton = !!gamepad.buttons[3]?.pressed;
        if (resetButton && !padReset) resetTrooper();
        padReset = resetButton;
      }
      const inputLength = Math.max(1, Math.hypot(x, y)); x /= inputLength; y /= inputLength;
      const worldX = inputRight.x * x + inputForward.x * y, worldZ = inputRight.y * x + inputForward.y * y;
      // Powers cut any strike short; a parry too; B strikes and chains.
      if (powerPressed) combat.power(powerPressed);
      if (parryPressed) combat.parry();
      if (attackPressed) combat.attack({ speed: motion.speed });
      attackPressed = parryPressed = false;
      powerPressed = null;
      const action = combat.update(sim, { guard, speed: motion.speed });
      // Each move re-aims towards the stick before it lands; a power with the
      // stick at rest turns towards the trooper the hero is facing most.
      const started = combat.takeStart();
      if (started && Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ));
      else if (started === 'forcePull' || started === 'forcePush') {
        const aimed = target(started === 'forcePull' ? FEEL.pull.range : FEEL.push.range, 1.2);
        if (aimed) { const at = whereIs(aimed); motion.face(Math.atan2(at.x - motion.x, at.z - motion.z)); }
      }
      const released = combat.takeForce();
      if (released) unleash(released);
      motion.update(sim, worldX, worldZ, { sprint: sprint && !action.engaged, analog, maxSpeed: action.maxSpeed, inputScale: action.inputScale, drive: action.drive, turnScale: action.turnScale, engaged: action.engaged });
      for (const trooper of troopers) {
        const blocker = trooper.blocker();
        if (!blocker) continue;
        const dx = motion.x - blocker.x, dz = motion.z - blocker.z, distance = Math.hypot(dx, dz), reach = blocker.radius + 0.24;
        if (distance < reach && distance > 1e-4) { motion.x = blocker.x + dx / distance * reach; motion.z = blocker.z + dz / distance * reach; }
      }
      if (!moved && (motion.speed > 0.1 || action.engaged)) { moved = true; document.body.classList.add('playing'); }
      character.root.position.set(motion.x, 0, motion.z);
      character.root.rotation.y = motion.heading + action.spin;
      velocity.set(motion.vx, 0, motion.vz);
      character.update({ dt: sim, time, speed: motion.speed, runBlend: motion.runBlend, sprintIntent: Math.max(motion.sprint, sprint && Math.hypot(x, y) > 0.05 ? 1 : 0) * (1 - action.guard), turnRate: motion.turnRate, forwardAccel: motion.forwardAccel, action });
      cape.update({ dt: sim, time, velocity });
      // Igniting the blade, moving or not, comes with a quick draw twirl.
      if (saber.update(motion.saber, time, action.flare) === 'ignite') combat.flourish();
      saber.segment(bladeBase, bladeTip);
      trail.update(sim, bladeBase, bladeTip, action.trail * motion.saber);
      const swing = sim > 0 ? lastTip.distanceTo(bladeTip) / sim : 0;
      for (const trooper of troopers) { trooper.focus = character.root.position; trooper.update(sim, time); }
      collideSquad(troopers);
      if (combat.sequence !== stoppedSequence) { stopped.clear(); stoppedSequence = combat.sequence; }
      troopers.forEach((trooper, index) => {
        const struck = saber.extension > 0.6 && bladeReady ? trooper.strike(lastBase, lastTip, bladeBase, bladeTip, sim, time) : [];
        for (const event of struck) {
          // Falls are reported alongside the blow that caused them.
          if (event.type === 'fall' || (event.type === 'graze' && event.speed < 1)) continue;
          const heavy = event.type === 'cut' || event.type === 'slash' || event.type === 'disarm';
          // A short hit stop on a clean cut, a little longer on a felling blow
          // — once per enemy and per attack sequence, so it never drags.
          const felling = event.lethal || event.felled;
          if ((felling || event.type === 'cut') && !stopped.has(index)) {
            stopped.add(index);
            const [hold, recover] = felling ? FEEL.hitStop.felling : FEEL.hitStop.cut;
            stopFor(hold, recover);
          }
          shove(event.velocity, felling ? FEEL.camera.kickFelling : heavy ? FEEL.camera.kick : 0.012);
          if (felling || event.type === 'cut') punch(FEEL.camera.punch * (felling ? 1.8 : 1));
          impactShake = Math.max(impactShake, felling ? 0.3 : heavy ? 0.14 : 0.05);
          audio.impact(heavy ? 1 : 0.35);
        }
        // Landings, armour coming off: heard and felt in step with the physics.
        for (const item of trooper.news) {
          if (item.type === 'land') { audio.thud(Math.min(1, item.speed / 8)); impactShake = Math.max(impactShake, Math.min(0.18, item.speed * 0.025)); }
          if (item.type === 'armor') audio.clank();
        }
      });
      bladeReady = saber.extension > 0.6;
      lastBase.copy(bladeBase);
      lastTip.copy(bladeTip);
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
      stateEl.textContent = paused ? 'EN PAUSE' : move.startsWith('force') ? 'FORCE' : move.startsWith('parry') ? 'PARADE' : combat.busy ? 'ATTAQUE' : combat.guarding ? 'GARDE' : motion.speed < 0.05 ? 'IMMOBILE' : motion.sprint > 0.5 ? 'SPRINT' : motion.runBlend > 0.5 ? 'COURSE' : 'MARCHE';
      speedEl.textContent = motion.speed.toFixed(1);
      saberEl.textContent = motion.saber > 0.05 ? 'SABRE ACTIF' : 'SABRE EN VEILLE';
      $('#performance').textContent = `${Math.round(fps)} FPS · PIXELS ${pixelSize}×`;
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
    advance(seconds, step = 1 / 60) { for (let t = 0; t < seconds - 1e-9; t += step) frame(lastFrame + step * 1000, true); },
    getState: () => ({ x: motion.x, z: motion.z, speed: motion.speed, heading: motion.heading, runBlend: motion.runBlend, sprint: motion.sprint, idleTime: motion.idleTime, saber: motion.saber, attack: combat.output.name, guard: combat.guard, sequence: combat.sequence, armour: troopers.map(trooper => trooper.armour), troopersDown: troopers.filter(trooper => trooper.fallen).length, troopersDead: troopers.filter(trooper => trooper.dead).length, troopers: troopers.map(trooper => trooper.state), severed: troopers.flatMap(trooper => [...trooper.severed]), paused, pixelSize, fps, frames: frameCount, capeFinite: cape.mesh.geometry.attributes.position.array.every(Number.isFinite), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }),
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
    update(saber, speed, turn) {
      if (!context) return;
      // Strikes swell and raise the hum, like a blade cutting the air.
      gain.gain.setTargetAtTime(this.enabled ? saber * (0.022 + this.swing * 0.05) : 0, context.currentTime, 0.04);
      oscillatorA.frequency.setTargetAtTime(72 + speed * 4 + Math.abs(turn) * 1.5 + this.swing * 60, context.currentTime, 0.04);
      oscillatorB.frequency.setTargetAtTime(144.6 + speed * 7 + this.swing * 110, context.currentTime, 0.04);
    },
  };
}
