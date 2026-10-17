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
import { createStormtrooper } from './stormtrooper.js';
import { ease, hitStopScale, kick } from './tween.js';
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
  const actionCodes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyT'];
  let attackPressed = false, padAttack = false;
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
    }
    keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  function clearInput() { keys.clear(); attackPressed = false; joystick.x = joystick.y = 0; joystick.running = false; $('#stick').style.transform = ''; }
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
  function frame(now) {
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
        // Standard mapping: A is button 0 (hold to guard), B is button 1 (strike).
        guard ||= !!gamepad.buttons[0]?.pressed;
        const attackButton = !!gamepad.buttons[1]?.pressed;
        if (attackButton && !padAttack) attackPressed = true;
        padAttack = attackButton;
        // Y puts the stormtrooper back on his feet.
        const resetButton = !!gamepad.buttons[3]?.pressed;
        if (resetButton && !padReset) resetTrooper();
        padReset = resetButton;
      }
      const inputLength = Math.max(1, Math.hypot(x, y)); x /= inputLength; y /= inputLength;
      const worldX = inputRight.x * x + inputForward.x * y, worldZ = inputRight.y * x + inputForward.y * y;
      if (attackPressed) combat.attack({ speed: motion.speed });
      attackPressed = false;
      const action = combat.update(sim, { guard, speed: motion.speed });
      // Each strike re-aims towards the stick before it lands.
      if (combat.takeStart() && Math.hypot(worldX, worldZ) > 0.2) motion.face(Math.atan2(worldX, worldZ));
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
      for (const trooper of troopers) trooper.update(sim, time);
      const struck = saber.extension > 0.6 && bladeReady ? troopers.flatMap(trooper => trooper.strike(lastBase, lastTip, bladeBase, bladeTip, sim, time)) : [];
      for (const event of struck) {
        // Falls are reported alongside the blow that caused them.
        if (event.type === 'fall' || (event.type === 'graze' && event.speed < 1)) continue;
        const heavy = event.type === 'cut' || event.type === 'slash' || event.type === 'disarm';
        // A light beat of hit stop on a clean cut, a longer one on a felling
        // blow; the view is kicked along the swing.
        const felling = event.lethal || event.felled;
        if (felling) stopFor(0.06, 0.16);
        else if (event.type === 'cut') stopFor(0.035, 0.1);
        else if (heavy) stopFor(0.018, 0.06);
        shove(event.velocity, felling ? 0.075 : heavy ? 0.045 : 0.015);
        if (felling) punch(0.03);
        else if (event.type === 'cut') punch(0.014);
        impactShake = Math.max(impactShake, felling ? 0.35 : heavy ? 0.15 : 0.06);
        audio.impact(heavy ? 1 : 0.35);
      }
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
      stateEl.textContent = paused ? 'EN PAUSE' : combat.busy ? 'ATTAQUE' : combat.guarding ? 'GARDE' : motion.speed < 0.05 ? 'IMMOBILE' : motion.sprint > 0.5 ? 'SPRINT' : motion.runBlend > 0.5 ? 'COURSE' : 'MARCHE';
      speedEl.textContent = motion.speed.toFixed(1);
      saberEl.textContent = motion.saber > 0.05 ? 'SABRE ACTIF' : 'SABRE EN VEILLE';
      $('#performance').textContent = `${Math.round(fps)} FPS · PIXELS ${pixelSize}×`;
    }
    if (++frameCount === 3) {
      $('#loading').style.opacity = '0';
      setTimeout(() => $('#loading').hidden = true, 550);
    }
    requestAnimationFrame(frame);
  }
  // Read-only diagnostics for regression checks; this does not drive gameplay.
  window.__STARWARD__ = {
    getState: () => ({ x: motion.x, z: motion.z, speed: motion.speed, heading: motion.heading, runBlend: motion.runBlend, sprint: motion.sprint, idleTime: motion.idleTime, saber: motion.saber, attack: combat.output.name, guard: combat.guard, troopersDown: troopers.filter(trooper => trooper.fallen).length, troopersDead: troopers.filter(trooper => trooper.dead).length, troopers: troopers.map(trooper => trooper.state), severed: troopers.flatMap(trooper => [...trooper.severed]), paused, pixelSize, fps, frames: frameCount, capeFinite: cape.mesh.geometry.attributes.position.array.every(Number.isFinite), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height }),
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
    update(saber, speed, turn) {
      if (!context) return;
      // Strikes swell and raise the hum, like a blade cutting the air.
      gain.gain.setTargetAtTime(this.enabled ? saber * (0.022 + this.swing * 0.05) : 0, context.currentTime, 0.04);
      oscillatorA.frequency.setTargetAtTime(72 + speed * 4 + Math.abs(turn) * 1.5 + this.swing * 60, context.currentTime, 0.04);
      oscillatorB.frequency.setTargetAtTime(144.6 + speed * 7 + this.swing * 110, context.currentTime, 0.04);
    },
  };
}
