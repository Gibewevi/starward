import * as THREE from 'three';
import { createCharacter } from './character.js';
import { createCoat } from './coat.js';
import { createSaber } from './saber.js';
import { createBladeTrail } from './blade-trail.js';
import { MotionController, damp, angleDelta } from './motion.js';
import { CombatController } from './combat.js';
import { closestSegments } from './blasters.js';
import { createShake } from './shake.js';
import { hitStopScale } from './tween.js';
import { FEEL } from './feel.js';
import { DUEL, createDuelState, advanceDuelState, spend, parry, resolveStrike, bindStrength, resolveBind, forceHit, dash } from './duel-rules.js';
import { createDuelMind } from './duel-ai.js';
import { createLivingBlade } from './duel-blades.js';
import { createFinisher } from './duel-finisher.js';

/**
 * The last fight of the room: a Jedi with a red blade, alone, one on one.
 *
 * enter(): the great door opens on the score's drone; he walks out of the
 * corridor, every step a timpani stroke, stops before the door, turns to the
 * hero and lights his blade (the brass stab). Then the duel: the hero leaves
 * the game's own controls for the duel's (while `fighting`, the game hands
 * over his body: the same character, cape, blade, motion and combat).
 *
 * Most strikes meet a blade — blocked, parried, or locked in a bind — and
 * every meeting is an event: two-coloured sparks, a flash, the blades thrown
 * back on their springs, a freeze (the camera held still through it, the
 * struck body shuddering), the pad kicking. A fight is won by breaking the
 * other's balance and finishing him, or by three clean wounds. Rules in
 * duel-rules.js, the enemy's mind in duel-ai.js, the blades' life in
 * duel-blades.js, the finishing cut in duel-finisher.js.
 *
 * Strikes are the choreography of combat.js, time-warped: the wind-up slower
 * (readable, more so for the enemy), the cut faster. Each strike resolves
 * once, at its impact, against what the other is doing then.
 *
 * Each frame, while `present`: scale(dt) (the duel's freezes and slow
 * motion: the world runs at dt × that), then step(sim) — the entrance, or
 * the fight — then view(dt) for the camera, hud() and ask() for the screen.
 */
const clamp = THREE.MathUtils.clamp;
const forward = heading => new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
const angleTo = (a, b) => Math.atan2(b.motion.x - a.motion.x, b.motion.z - a.motion.z);
const range = (a, b) => Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z);
const faces = (a, b, limit) => Math.abs(angleDelta(a.motion.heading, angleTo(a, b))) < limit;
const UP = new THREE.Vector3(0, 1, 0);
const HEAVY = ['slam', 'spinSlam', 'risingLeap'];
// The feel, per event. stop: [hold, recover] s — the action freezes on the impact (the struck body
// shudders, the sparks still bloom), then eases back to speed; slow: [scale, hold, recover]. The camera snaps
// with the blow — kick: m along it, punch: a share of zoom — and holds still through the freeze; the shake
// (trauma) rings out once it ends. A moving camera would hide the freeze.
const FX = {
  block: { stop: [0.065, 0.08], trauma: 0.16, kick: 0.035, punch: 0.012, sparks: 70, flash: 0.9, rumble: [0.35, 0.5, 0.08] },
  parry: { stop: [0.12, 0.1], slow: [0.3, 0.12, 0.3], trauma: 0.32, kick: 0.06, punch: 0.035, sparks: 150, flash: 1.8, rumble: [0.75, 0.9, 0.14] },
  guardBreak: { stop: [0.14, 0.12], slow: [0.3, 0.14, 0.45], trauma: 0.45, kick: 0.08, punch: 0.045, sparks: 170, flash: 2.2, rumble: [1, 1, 0.22] },
  wound: { stop: [0.11, 0.13], trauma: 0.4, kick: 0.075, punch: 0.03, sparks: 60, flash: 1.3, rumble: [0.9, 0.7, 0.18] },
  kill: { stop: [0.2, 0.14], slow: [0.2, 0.35, 1.1], trauma: 0.55, kick: 0.1, punch: 0.06, sparks: 110, flash: 2.4, rumble: [1, 1, 0.4] },
  bind: { stop: [0.09, 0.1], trauma: 0.3, kick: 0.045, punch: 0.03, sparks: 130, flash: 1.5, rumble: [0.6, 0.8, 0.12] },
  shove: { stop: [0.09, 0.1], trauma: 0.34, kick: 0.07, punch: 0.03, sparks: 120, flash: 1.6, rumble: [0.8, 0.9, 0.16] },
};
// The entrance: his pace (each step a stroke of the score), where he stops, the beats before the fight.
const ENTRANCE = { pace: 0.85, stride: 0.78, turn: 0.7, held: 1.5, near: 3.2 };
// Why the hero died: one line on the death card.
const CAUSES = {
  broken: 'Garde brisée : parez au bon moment, ou reculez pour reprendre l’équilibre.',
  wounds: 'Troisième blessure : il retient certains coups et feinte avant de frapper.',
  unblockable: 'Reflet rouge : coup imparable. Esquivez (Y), ou parez à l’instant exact.',
  parried: 'Vos coups ont été parés jusqu’à vous déséquilibrer. Variez le rythme.',
  bind: 'Lames croisées : martelez B plus vite que lui.',
  force: 'La Force a brisé votre garde : ne restez pas figé derrière elle.',
};
const ENEMY_PALETTE = {
  coat: '#29232d', coatShade: '#1b1821', coatEdge: '#3b303d', collar: '#44313e',
  tunic: '#776b76', tunicShade: '#574b59', trousers: '#211d26', boot: '#19171e',
  bootCuff: '#302934', sole: '#111117', lining: '#1b1620',
};
const ENEMY_COAT = { base: '#24202a', fold: '#15121c', hem: '#372a39' };

/**
 * hero: { character, coat, saber, trail, motion, combat, base, tip } — the game's own.
 * door: the arena's great door; stand: where he stops before it. keys: the keys held (the game's set).
 * confine(motion): crates and walls push a body out. onStep(fighter): a foot comes down. kick(position, velocity): debris.
 */
export function createDuel({ scene, hero, effects, audio, music, wounds, door, stand, keys, confine = () => {}, onStep = () => {}, kick: kickDebris = () => {}, rumble = () => {}, screenRight, screenUp }) {
  function fighter(id, color, parts) {
    return {
      id, color, ...parts, state: createDuelState(), blade: createLivingBlade(), lit: 1,
      lastTip: new THREE.Vector3(), swing: new THREE.Vector3(), push: new THREE.Vector3(),
      strike: null, pending: null, feint: null, dash: null, forcing: null, guardTime: 0, idleTime: 0, stride: 0.6, cause: '',
    };
  }
  const player = fighter('player', 'blue', hero);
  const enemyCharacter = createCharacter({ palette: ENEMY_PALETTE });
  scene.add(enemyCharacter.root);
  const enemy = fighter('enemy', 'red', {
    character: enemyCharacter, coat: createCoat({ scene, character: enemyCharacter, palette: ENEMY_COAT }),
    saber: createSaber({ socket: enemyCharacter.saberSocket, scene, color: 'red' }), trail: createBladeTrail(scene, { color: 'red', lifetime: 0.14 }),
    motion: new MotionController(), combat: new CombatController(), base: new THREE.Vector3(), tip: new THREE.Vector3(),
  });
  const fighters = [player, enemy];
  const opponent = f => f === player ? enemy : player;

  let phase = 'idle', entrance = null, mind = createDuelMind(), time = 0, outcome = null, outcomeAge = 0;
  let strikeIds = 0, hitStop = null, slowMo = null, bind = null, intent = null, lastBind = -Infinity, attackBuffered = -Infinity, pendingTrauma = 0;
  const fragments = [];
  const shake = createShake({ maxOffset: 0.16, decay: 2.4 });
  const cameraKick = { offset: new THREE.Vector3(), velocity: new THREE.Vector3() }, punch = { value: 0, velocity: 0 };
  const focus = new THREE.Vector3();
  const controls = { attack: false, guard: false, pull: false, push: false, dash: false };
  const virtual = {};
  let frameDt = 0;

  function show(f, visible) {
    f.character.root.visible = visible;
    f.coat.mesh.visible = visible;
    f.saber.group.visible = visible;
    if (!visible) for (const light of f.saber.lights) light.intensity = 0;
  }
  show(enemy, false);

  function stop(hold, recover, victim = null) { if (!hitStop || hold + recover > hitStop.hold + hitStop.recover - hitStop.age) hitStop = { age: 0, hold, recover, floor: 0.02, victim }; }
  const frozen = () => Boolean(hitStop && hitStop.age < hitStop.hold);
  function slow(scale, hold, recover) { if (!slowMo || scale < slowMo.scale) slowMo = { age: 0, scale, hold, recover }; }
  function feel(kind, at, direction = null, victim = null) {
    const fx = FX[kind];
    if (fx.stop) stop(...fx.stop, victim);
    if (fx.slow) slow(...fx.slow);
    // The camera snaps with the blow and holds there through the freeze; the shake comes after.
    pendingTrauma = Math.max(pendingTrauma, fx.trauma);
    const along = direction?.clone().setY(0);
    if (along?.lengthSq() > 1e-6) { cameraKick.offset.copy(along.normalize()).multiplyScalar(fx.kick); cameraKick.velocity.set(0, 0, 0); }
    if (fx.punch) { punch.value = Math.max(punch.value, fx.punch); punch.velocity = 0; }
    rumble(...fx.rumble);
  }
  function crossedSparks(at, attacker, defender, count = 90, speed = 6) {
    const a = attacker.tip.clone().sub(attacker.base).normalize();
    const b = defender.tip.clone().sub(defender.base).normalize();
    const left = new THREE.Vector3().crossVectors(a, b).setY(0);
    if (left.lengthSq() < 0.05) left.subVectors(defender.base, attacker.base).setY(0).cross(UP);
    if (left.lengthSq() < 1e-6) left.set(1, 0, 0);
    left.normalize();
    const share = f => f.color === 'red' ? { saber: 0.25, red: 0.65 } : { saber: 0.65, red: 0.25 };
    effects.sparks(at.clone().addScaledVector(left, 0.02), left, UP, { count: Math.ceil(count / 2), speed, ...share(attacker) });
    effects.sparks(at.clone().addScaledVector(left, -0.02), left.clone().negate(), UP, { count: Math.floor(count / 2), speed, ...share(defender) });
  }
  const local = (f, vector) => vector.clone().applyAxisAngle(UP, -f.motion.heading);

  // ---- Input: the duel reads the pad and the keys itself --------------------------
  const padButton = (pad, index) => pad?.buttons[index]?.pressed || (pad?.buttons[index]?.value ?? 0) > 0.65;
  function readInput() {
    const pad = navigator.getGamepads?.()?.find(Boolean);
    const dead = value => Math.abs(value || 0) < 0.15 ? 0 : value;
    const horizontal = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft') ? 1 : 0) + dead(pad?.axes[0]) + (virtual.x ?? 0);
    const vertical = (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - dead(pad?.axes[1]) + (virtual.y ?? 0);
    const length = Math.min(1, Math.hypot(horizontal, vertical));
    const norm = Math.max(1e-6, Math.hypot(horizontal, vertical));
    const x = length ? (screenRight.x * horizontal + screenUp.x * vertical) / norm * length : 0;
    const z = length ? (screenRight.z * horizontal + screenUp.z * vertical) / norm * length : 0;
    const current = {
      attack: keys.has('KeyJ') || padButton(pad, 1) || Boolean(virtual.attack),
      guard: keys.has('KeyK') || padButton(pad, 5) || padButton(pad, 4) || Boolean(virtual.guard),
      pull: keys.has('KeyU') || padButton(pad, 6) || Boolean(virtual.pull),
      push: keys.has('KeyI') || padButton(pad, 7) || Boolean(virtual.push),
      dash: keys.has('Space') || padButton(pad, 3) || Boolean(virtual.dash),
    };
    const pressed = {};
    for (const key of Object.keys(current)) { pressed[key] = current[key] && !controls[key]; controls[key] = current[key]; }
    return { x, z, magnitude: length, current, pressed };
  }

  // ---- Strikes ----------------------------------------------------------------
  const phaseOf = f => f.combat.action ? f.combat.time / f.combat.action.duration : 0;
  /** The wind-up slower, the cut faster: readable and snappy. The enemy's wind-up more so; a tired fighter slower. */
  function warp(f) {
    const action = f.combat.action;
    if (!action || action.utility || action.free) return 1;
    const phase = phaseOf(f), tired = f.state.tired ? 0.86 : 1;
    if (phase < action.active[0]) return (f === enemy ? 0.7 : 0.93) * tired;
    if (phase < action.active[1]) return 1.14 * tired;
    return tired;
  }
  /** Seconds before this strike lands, as the warped clock will run. */
  function impactIn(f) {
    const s = f.strike, action = f.combat.action;
    if (!s || s.resolved || !action || action.name !== s.name) return Infinity;
    const phase = phaseOf(f), d = action.duration, w = warp(f) || 1;
    if (phase >= s.impact) return 0;
    if (phase < action.active[0]) return (action.active[0] - phase) * d / ((f === enemy ? 0.7 : 0.93) * (f.state.tired ? 0.86 : 1)) + (s.impact - action.active[0]) * d / (1.14 * (f.state.tired ? 0.86 : 1));
    return (s.impact - phase) * d / w;
  }
  function canAct(f) { return f.state.alive && f.state.broken <= 0 && f.state.stagger <= 0 && !bind && !f.dash; }
  function requestStrike(f, kind = 'quick', { feint = false } = {}) {
    if (!canAct(f)) return false;
    const other = opponent(f);
    // A deathblow on its way is not started again by more presses.
    if (f.strike?.deathblow && !f.strike.resolved) return false;
    // A broken guard within a lunge: the deathblow, a flat cut through the neck (the strike springs in to close the gap).
    if (kind === 'deathblow' || (other.state.broken > 0 && range(f, other) < 3.3)) {
      f.combat.cancel();
      f.combat.start('horizontal');
      f.pending = { deathblow: true, heavy: true };
      return true;
    }
    if (kind === 'heavy' || kind === 'unblockable') {
      if (f.combat.busy) return false;
      f.combat.start(kind === 'unblockable' ? 'lunge' : HEAVY[Math.floor(Math.random() * HEAVY.length)]);
      f.pending = { heavy: true, unblockable: kind === 'unblockable' };
      return true;
    }
    const aim = { angle: angleDelta(f.motion.heading, angleTo(f, other)), distance: range(f, other) };
    const started = f.combat.attack({ speed: f.motion.speed, aim });
    if (started && !f.pending) f.pending = { feint };
    return started;
  }
  function beginStrike(f, name) {
    const action = f.combat.action;
    const pending = f.pending ?? {};
    f.pending = null;
    // (The deathblow costs nothing: a broken guard must always be punishable.)
    if (!spend(f.state, pending.heavy && !pending.deathblow ? 'heavy' : 'strike')) { f.combat.cancel(); return; }
    f.strike = {
      id: ++strikeIds, name, resolved: false, age: 0,
      impact: action.active[0] + (action.active[1] - action.active[0]) * 0.35,
      heavy: Boolean(pending.heavy), unblockable: Boolean(pending.unblockable), deathblow: Boolean(pending.deathblow),
    };
    f.feint = pending.feint ? { at: f.strike.impact * 0.55 } : null;
    f.motion.heading += angleDelta(f.motion.heading, angleTo(f, opponent(f))) * 0.85;
    // From a little too far, the strike springs in (it would otherwise cut the air).
    const gap = range(f, opponent(f));
    if (gap > 1.9 && gap < 3.4) f.push.addScaledVector(forward(angleTo(f, opponent(f))), (gap - 1.5) * 4.2);
    audio.whoosh(f.strike.heavy ? 1.35 : 0.85);
    // The unblockable thrust is announced: a red glint on the blade and a sharp cue.
    if (f.strike.unblockable) {
      const at = f.character.root.position.clone().setY(1.35);
      effects.burst(at, { power: 0.9, tint: 'red' });
      effects.flash(at, 1.2, { color: new THREE.Color(1, 0.12, 0.08) });
      audio.alert('!', at);
    }
  }
  function interruptStrike(f) {
    // The hero's next blow already pressed (a combo) is not lost: it goes as soon as he can.
    if (f === player && f.combat.queued) attackBuffered = time;
    if (f.combat.busy && !f.combat.action?.utility) f.combat.cancel();
    f.strike = null; f.feint = null; f.pending = null;
  }

  // ---- What a strike meets ------------------------------------------------------
  const chestLow = new THREE.Vector3(), chestHigh = new THREE.Vector3();
  function contactPoint(attacker, defender) {
    chestLow.set(defender.motion.x, 0.75, defender.motion.z);
    chestHigh.set(defender.motion.x, 1.45, defender.motion.z);
    const body = closestSegments(attacker.base, attacker.tip, chestLow, chestHigh);
    const blades = closestSegments(attacker.base, attacker.tip, defender.base, defender.tip);
    return { body: body.c1.clone(), blades: blades.c1.clone().add(blades.c2).multiplyScalar(0.5), apart: blades.distance };
  }
  function swingOf(f) {
    if (f.swing.lengthSq() < 1e-4) f.swing.copy(forward(f.motion.heading));
    return f.swing.clone().normalize();
  }
  function resolve(attacker, immortal) {
    const defender = opponent(attacker), s = attacker.strike;
    s.resolved = true;
    const distance = range(attacker, defender);
    const reach = s.deathblow ? 2.6 : s.heavy ? 2.3 : 2.05;
    if (!defender.state.alive || distance > reach || !faces(attacker, defender, 1.2)) return;
    // Both blades coming at once: they lock.
    const theirs = defender.strike;
    if (theirs && !theirs.resolved && !s.deathblow && !theirs.deathblow && impactIn(defender) < 0.14 && faces(defender, attacker, 1.1)) {
      // A bind is a moment: rare (the blows almost at the same instant, not too soon after the last). Otherwise the blades meet and both are thrown back.
      if (time - lastBind > 18 && impactIn(defender) < 0.08 && Math.random() < 0.45) startBind(attacker, defender);
      else clash(attacker, defender);
      return;
    }
    const facing = faces(defender, attacker, 1.25);
    const { body, blades, apart } = contactPoint(attacker, defender);
    const swing = swingOf(attacker);
    let result = s.deathblow && defender.state.broken > 0
      ? (defender.state.alive = false, 'kill')
      : resolveStrike(attacker.state, defender.state, { facing, heavy: s.heavy, unblockable: s.unblockable });
    // God mode: the blow that would kill him only wounds.
    if (result === 'kill' && defender === player && immortal) {
      Object.assign(defender.state, { alive: true, wounds: DUEL.wounds - 1, broken: 0, posture: DUEL.posture * 0.5 });
      result = 'wound';
    }
    const at = ['block', 'smashed', 'parry', 'parryBreak', 'guardBreak'].includes(result) ? (apart < 0.8 ? blades : body) : body;
    const away = forward(angleTo(attacker, defender));
    if (result === 'miss') {
      // Dodged. Through a wound's grace: the blade grazes, burns, shoves — but no new wound.
      if (defender.dash) { audio.whoosh(0.6); return; }
      effects.sparks(body, swing, away, { count: 26, speed: 4, ...(attacker.color === 'red' ? { red: 0.7 } : { saber: 0.7 }) });
      effects.flash(body, 0.6, { color: new THREE.Color(1, 0.4, 0.3) });
      audio.burn(body);
      defender.push.addScaledVector(away, 1.8);
      defender.blade.knock(local(defender, swing.clone().multiplyScalar(1.2)), null, -1.2);
      stop(0.05, 0.08, defender);
      return;
    }
    if (result === 'block' || result === 'smashed' || result === 'guardBreak') {
      interruptStrike(attacker);
      attacker.blade.knock(local(attacker, swing.clone().multiplyScalar(-1.9)).setY(0.4), local(attacker, new THREE.Vector3().crossVectors(swing, UP)).multiplyScalar(-6), -0.9);
      defender.blade.knock(local(defender, swing.clone().multiplyScalar(1.3)), local(defender, new THREE.Vector3().crossVectors(UP, swing)).multiplyScalar(4), -0.7, 0.4);
      defender.push.addScaledVector(away, result === 'guardBreak' ? 2.2 : result === 'smashed' ? 3 : 1.5);
      attacker.push.addScaledVector(away, -0.5);
      const fx = FX[result === 'smashed' ? 'guardBreak' : result];
      crossedSparks(at, attacker, defender, fx.sparks, result === 'block' ? 5.8 : 7.5);
      effects.flash(at, fx.flash, { color: new THREE.Color(0.85, 0.8, 1) });
      audio.deflect(false, at); audio.impact(result === 'block' ? 0.45 : 1.25, at);
      feel(result === 'smashed' ? 'guardBreak' : result, at, swing, defender);
      if (result === 'smashed') interruptStrike(defender);
      if (result === 'guardBreak') {
        audio.zap(at, 1);
        interruptStrike(defender);
        defender.cause = s.unblockable ? 'unblockable' : 'broken';
      }
      if (defender === enemy) mind.notify(result === 'block' ? 'blocked' : 'wounded');
      else mind.notify('wasBlocked');
      return;
    }
    if (result === 'parry' || result === 'parryBreak') {
      interruptStrike(attacker);
      // The attacker's arm flung back and up, the body thrown off; the parrying blade barely moves.
      attacker.blade.knock(local(attacker, swing.clone().multiplyScalar(-3.2)).add(new THREE.Vector3(0, 1.4, -1.2)), local(attacker, new THREE.Vector3().crossVectors(swing, UP)).multiplyScalar(-11), -2.2, 0.6);
      defender.blade.knock(local(defender, swing.clone().multiplyScalar(0.5)), null, 0.4);
      attacker.push.addScaledVector(away, -2.4);
      crossedSparks(at, attacker, defender, FX.parry.sparks, 7.8);
      effects.flash(at, FX.parry.flash, { color: new THREE.Color(0.9, 0.95, 1) });
      effects.burst(at, { power: 0.8, tint: defender.color === 'red' ? 'red' : 'blue' });
      audio.deflect(true, at); audio.impact(0.8, at);
      feel(result === 'parryBreak' ? 'guardBreak' : 'parry', at, swing, attacker);
      if (result === 'parryBreak') attacker.cause = 'parried';
      if (defender === enemy) mind.notify('parried'); else mind.notify('wasParried');
      return;
    }
    // A clean strike: a burn and a wound, or death.
    interruptStrike(defender);
    const wound = new THREE.Vector3().subVectors(attacker.character.root.position, defender.character.root.position).setY(0).normalize();
    defender.character.root.updateMatrixWorld(true);
    wounds.strike(defender.character.rig.bones, body, wound, 'bolt');
    if (result === 'wound') {
      effects.sparks(body, swing, away, { count: FX.wound.sparks, speed: 5, ...(attacker.color === 'red' ? { red: 0.7 } : { saber: 0.7 }) });
      effects.bleed(body, swing, UP, { speed: 3.2, amount: 1.2 });
      effects.flash(body, FX.wound.flash, { color: new THREE.Color(1, 0.3, 0.25) });
    }
    audio.impact(result === 'kill' ? 1.45 : 1.05, body); audio.burn(body);
    feel(result, body, swing, defender);
    if (result === 'wound') {
      defender.push.addScaledVector(away, 3.8);
      defender.blade.knock(local(defender, swing.clone().multiplyScalar(2)), null, -2.6, 0.8);
      if (defender === enemy) mind.notify('wounded'); else mind.notify('hit');
      return;
    }
    // Death: the head comes off (an arm on a rising cut), thrown with the blade's own sweep.
    if (!defender.cause) defender.cause = s.deathblow ? 'broken' : 'wounds';
    const move = attacker.combat.action?.name || '';
    const kind = !s.deathblow && ['lowSweep', 'rising', 'risingLeap'].includes(move) ? 'arm' : 'head';
    const sweep = attacker.swing.clone();
    if (sweep.length() < 4) sweep.copy(swing).multiplyScalar(8);
    defender.trail.clear();
    fragments.push(createFinisher(scene, defender, kind, sweep, effects));
    outcome = attacker === player ? 'victory' : 'death'; outcomeAge = 0;
    phase = 'over';
    if (outcome === 'victory') music.victory(); else { audio.death(); music.defeat(); }
  }

  // ---- The bind ----------------------------------------------------------------
  /** Two strikes at the same instant, no bind: the blades meet and both fighters are thrown back. */
  function clash(a, b) {
    const mid = new THREE.Vector3((a.tip.x + b.tip.x + a.base.x + b.base.x) / 4, 1.25, (a.tip.z + b.tip.z + a.base.z + b.base.z) / 4);
    const axis = forward(angleTo(a, b));
    for (const [f, sign] of [[a, -1], [b, 1]]) {
      const swing = swingOf(f);
      interruptStrike(f);
      f.blade.knock(local(f, swing.clone().multiplyScalar(-1.8)).setY(0.6), local(f, new THREE.Vector3().crossVectors(swing, UP)).multiplyScalar(-6), -1.1, 0.4);
      f.push.addScaledVector(axis, sign * 1.9);
      f.state.stagger = Math.max(f.state.stagger, 0.12);
    }
    crossedSparks(mid, a, b, 130, 7);
    effects.flash(mid, 1.4, { color: new THREE.Color(0.95, 0.8, 1) });
    audio.deflect(false, mid); audio.impact(0.8, mid);
    feel('block', mid, axis);
  }
  function startBind(a, b) {
    interruptStrike(a); interruptStrike(b);
    lastBind = time;
    const axis = new THREE.Vector3(b.motion.x - a.motion.x, 0, b.motion.z - a.motion.z).normalize();
    const mid = new THREE.Vector3((a.motion.x + b.motion.x) / 2, 1.32, (a.motion.z + b.motion.z) / 2);
    bind = { age: 0, balance: 0, axis, mid, presses: [], spark: 0, sizzle: 0, flash: 0, molten: 0, pulse: 0 };
    crossedSparks(mid, a, b, 220, 8.5);
    effects.blast(mid, { sparks: 60, embers: 30, speed: 7 });
    effects.burst(mid, { power: 1.2, tint: 'blue' }); effects.burst(mid, { power: 1.2, tint: 'red' });
    effects.flash(mid, 2.4, { color: new THREE.Color(0.95, 0.75, 1) });
    audio.deflect(false, mid); audio.impact(1.1, mid); audio.zap(mid, 0.8);
    feel('bind', mid, axis);
    slow(0.4, 0.12, 0.3);
    mind.notify('bind');
  }
  function stepBind(dt, input) {
    bind.age += dt;
    if (input.pressed.attack) bind.presses.push(time);
    while (bind.presses.length && time - bind.presses[0] > 0.5) bind.presses.shift();
    const toward = forward(angleTo(player, enemy));
    const lean = Math.max(0, input.x * toward.x + input.z * toward.z);
    const playerEffort = clamp(bind.presses.length * 0.24 + lean * 0.25, 0, 1);
    const enemyEffort = intent?.effort ?? 0.5;
    bind.balance += (bindStrength(player.state, playerEffort) - bindStrength(enemy.state, enemyEffort)) * dt * 1.5;
    // The two bodies close in; whoever is winning pushes forward.
    const axis = forward(angleTo(player, enemy));
    const centre = new THREE.Vector3((player.motion.x + enemy.motion.x) / 2, 0, (player.motion.z + enemy.motion.z) / 2).addScaledVector(axis, bind.balance * 0.25 * dt * 4);
    player.motion.x = damp(player.motion.x, centre.x - axis.x * 0.52, 10, dt); player.motion.z = damp(player.motion.z, centre.z - axis.z * 0.52, 10, dt);
    enemy.motion.x = damp(enemy.motion.x, centre.x + axis.x * 0.52, 10, dt); enemy.motion.z = damp(enemy.motion.z, centre.z + axis.z * 0.52, 10, dt);
    bind.mid.set(centre.x + axis.x * bind.balance * 0.12, 1.32 + Math.sin(time * 19) * 0.015, centre.z + axis.z * bind.balance * 0.12);
    for (const f of fighters) f.motion.heading = angleTo(f, opponent(f));
    // Sparks pouring from the crossed blades in both colours, molten drops raining, the light pulsing blue and red,
    // the hum grinding, the pad trembling — harder as one side gains.
    const strain = 0.5 + Math.abs(bind.balance) * 0.5;
    if ((bind.spark -= dt) <= 0) { bind.spark = 0.035; crossedSparks(bind.mid, player, enemy, Math.round((14 + Math.random() * 10) * strain), 5 + Math.random() * 2.5); }
    if ((bind.molten -= dt) <= 0) { bind.molten = 0.28; effects.blast(bind.mid, { sparks: Math.round(18 * strain), embers: 10, speed: 5 }); }
    if ((bind.sizzle -= dt) <= 0) { bind.sizzle = 0.15; audio.sizzle(bind.mid); if (Math.random() < 0.5) audio.zap(bind.mid, 0.3 * strain); rumble(0.35 + Math.abs(bind.balance) * 0.5, 0.6, 0.18); }
    if ((bind.flash -= dt) <= 0) { bind.pulse++; bind.flash = 0.11; effects.flash(bind.mid, 0.8 + 0.6 * strain, { color: bind.pulse % 2 ? new THREE.Color(0.55, 0.75, 1.3) : new THREE.Color(1.3, 0.45, 0.4) }); }
    shake.atLeast(0.16 + Math.abs(bind.balance) * 0.2);
    if (Math.abs(bind.balance) >= 1 || bind.age > 1.8) endBind();
  }
  function endBind() {
    const winner = bind.balance >= 0 ? player : enemy, loser = opponent(winner);
    const result = resolveBind(winner.state, loser.state);
    const away = forward(angleTo(winner, loser));
    loser.push.addScaledVector(away, result === 'break' ? 5.2 : 4.4);
    winner.push.addScaledVector(away, -0.8);
    loser.blade.knock(local(loser, away.clone().multiplyScalar(2.4)).add(new THREE.Vector3(0, 1.2, 0)), new THREE.Vector3(0, 0, 9), -2.4, 0.6);
    winner.blade.knock(local(winner, away.clone().multiplyScalar(1.2)), null, 1.2);
    crossedSparks(bind.mid, winner, loser, 220, 9);
    effects.blast(bind.mid, { sparks: 70, embers: 35, speed: 9 });
    effects.burst(bind.mid, { power: 1.4, tint: winner.color === 'red' ? 'red' : 'blue' });
    effects.flash(bind.mid, 2.6, { color: new THREE.Color(1, 0.85, 1) });
    slow(0.35, 0.08, 0.35);
    audio.deflect(true, bind.mid); audio.impact(1.1, bind.mid);
    feel(result === 'break' ? 'guardBreak' : 'shove', bind.mid, away, loser);
    loser.state.open = Math.max(loser.state.open, 0.35);
    if (result === 'break') loser.cause = 'bind';
    bind = null;
  }

  // ---- Dash and Force -----------------------------------------------------------
  function startDash(f, direction) {
    if (!canAct(f) || !dash(f.state)) return false;
    if (f.strike && !f.strike.resolved) interruptStrike(f);
    f.dash = { age: 0, duration: 0.24, direction: direction.clone().setY(0).normalize(), speed: 7.2 };
    f.blade.knock(null, null, 0.8, 0.5);
    audio.dash();
    return true;
  }
  function startForce(f, kind) {
    if (!canAct(f) || f.forcing || f.state.energy < DUEL.cost.force) return false;
    if (f.strike && !f.strike.resolved) interruptStrike(f);
    if (f.combat.busy) return false;
    const name = kind === 'pull' ? 'forcePull' : 'forcePush';
    if (!f.combat.power(name)) return false;
    spend(f.state, 'force');
    const duration = f.combat.action?.duration ?? 0.56;
    f.forcing = { kind, releaseIn: FEEL.force[kind === 'pull' ? 'pullAt' : 'pushAt'] * duration };
    audio.force(kind);
    return true;
  }
  function releaseForce(f) {
    const target = opponent(f), kind = f.forcing.kind;
    f.forcing = null;
    const dir = forward(angleTo(f, target));
    effects.wave(f.character.root.position.clone().setY(1), forward(f.motion.heading), { kind });
    const result = forceHit(f.state, target.state, kind, { facing: faces(f, target, 0.9), distance: range(f, target) });
    if (result === 'none') return;
    interruptStrike(target);
    target.push.addScaledVector(dir, kind === 'pull' ? -6 : 6.5);
    target.blade.knock(local(target, dir.clone().multiplyScalar(kind === 'pull' ? -1.5 : 2)).setY(1), new THREE.Vector3(0, 0, kind === 'pull' ? -5 : 7), kind === 'pull' ? 1.6 : -2.2, 0.5);
    feel(result === 'guardBreak' ? 'guardBreak' : 'block', target.character.root.position.clone().setY(1.1), dir, target);
    if (result === 'guardBreak') target.cause = 'force';
  }

  // ---- One fighter, one step ---------------------------------------------------
  function stepFighter(f, dt, { x, z, guard }) {
    const state = f.state, other = opponent(f);
    const striking = Boolean(f.strike && !f.strike.resolved);
    advanceDuelState(state, dt, { guarding: guard && !striking && !f.dash, striking: f.combat.busy });
    f.guardTime = state.guard ? f.guardTime + dt : 0;
    if ((state.stagger > 0.05 || state.broken > 0) && f.combat.busy && !f.combat.action?.utility) interruptStrike(f);
    const aim = { angle: angleDelta(f.motion.heading, angleTo(f, other)), distance: range(f, other) };
    const base = f.combat.update(dt * warp(f), { guard: state.guard, speed: f.motion.speed, aim, lead: clamp(aim.angle, -0.6, 0.6), charging: false });
    const started = f.combat.takeStart();
    if (started && f.combat.action && !f.combat.action.utility && !f.combat.action.free) beginStrike(f, started);
    if (f.strike && (!f.combat.action || f.combat.action.name !== f.strike.name)) f.strike = null;
    if (f.strike) f.strike.age += dt;
    // A feint: the wind-up drawn back before the cut, to bait the parry.
    if (f.feint && f.strike && phaseOf(f) >= f.feint.at) {
      f.combat.cancel(); f.strike = null; f.feint = null;
      f.blade.knock(new THREE.Vector3(0.2, 0.4, -0.9), null, -0.6);
      audio.whoosh(0.4);
    }
    const force = f.combat.takeForce();
    if (force && f.forcing) releaseForce(f);
    if (f.forcing && !f.combat.action) f.forcing = null;

    // Moving: the stick (or the mind), the drive of the strike, a lunge to reach, the pushes, a dash.
    const maxSpeed = state.guard ? 1.7 : state.tired ? 2.3 : 3.1;
    if (state.broken > 0 || state.stagger > 0) { x *= 0.2; z *= 0.2; }
    f.motion.update(dt, x, z, { analog: true, maxSpeed, inputScale: base.inputScale ?? 1, turnScale: 0, drive: state.stagger > 0 ? 0 : base.drive || 0, engaged: true });
    const distance = range(f, other);
    // The lunge closes in during the wind-up only: once the cut is under way it is committed, and can be dodged.
    const committed = f.strike && f.combat.action && phaseOf(f) >= f.combat.action.active[0];
    if (f.strike && !f.strike.resolved && !committed && distance > 1.3) {
      const lunge = Math.min(f.strike.heavy ? 5 : 4.4, (distance - 1.25) * 7) * dt;
      const to = forward(angleTo(f, other));
      f.motion.x += to.x * lunge; f.motion.z += to.z * lunge;
    }
    if (f.dash) {
      f.dash.age += dt;
      const k = Math.max(0, 1 - f.dash.age / f.dash.duration);
      f.motion.x += f.dash.direction.x * f.dash.speed * k * k * dt * 2;
      f.motion.z += f.dash.direction.z * f.dash.speed * k * k * dt * 2;
      if (f.dash.age >= f.dash.duration) f.dash = null;
    }
    f.motion.x += f.push.x * dt; f.motion.z += f.push.z * dt;
    f.push.multiplyScalar(Math.exp(-6.5 * dt));
    // The crates and the walls of the room stop him.
    confine(f.motion);
    // Always facing him: the duel's lock.
    const turnRate = state.broken > 0 ? 2 : committed ? 0 : f.strike ? 12 : 9;
    f.motion.heading += angleDelta(f.motion.heading, angleTo(f, other)) * (1 - Math.exp(-turnRate * dt));
    kickDebris(f.character.root.position, new THREE.Vector3(f.motion.vx + f.push.x, 0, f.motion.vz + f.push.z));
  }
  /** Pose and body: the living blade on the choreography, then the skeleton, the coat, the blade. */
  function animate(f, dt) {
    const state = f.state, other = opponent(f);
    f.character.root.position.set(f.motion.x, f.combat.output.lift || 0, f.motion.z);
    f.character.root.rotation.y = f.motion.heading;
    f.character.root.updateMatrixWorld(true);
    let meet = null;
    // His guard goes to meet a strike on its way, as soon as he sees it coming.
    const incoming = phase === 'idle' || phase === 'entrance' ? Infinity : impactIn(other);
    if (state.guard && incoming < 0.5 && faces(f, other, 1.25)) {
      const { blades } = contactPoint(other, f);
      meet = {
        point: f.character.root.worldToLocal(blades.clone()),
        against: local(f, other.tip.clone().sub(other.base).normalize()),
      };
    } else if (state.guard) {
      meet = { point: new THREE.Vector3(-0.05, 1.1, 0.5), against: new THREE.Vector3(1, 0, 0) };
    }
    const bound = bind ? { point: f.character.root.worldToLocal(bind.mid.clone()) } : null;
    const fatigue = clamp((DUEL.tired * 1.6 - state.energy / state.maxEnergy) / (DUEL.tired * 1.6), 0, 1);
    const pose = f.blade.update(dt, f.combat.output, { meet, bind: bound, broken: state.broken > 0, fatigue, time });
    f.character.update({ dt, time, speed: f.motion.speed, runBlend: f.motion.runBlend, sprintIntent: 0, turnRate: f.motion.turnRate, forwardAccel: f.motion.forwardAccel, action: pose });
    f.coat.update({ dt, time, velocity: { x: f.motion.vx + f.push.x, z: f.motion.vz + f.push.z }, turnRate: f.motion.turnRate });
    if (f.saber.update(f.lit, time, (f.combat.output.flare || 0) + fatigue * 0.06) === 'ignite') audio.ignite();
    f.lastTip.copy(f.tip);
    f.saber.segment(f.base, f.tip);
    if (dt > 0) f.swing.lerp(new THREE.Vector3().subVectors(f.tip, f.lastTip).divideScalar(dt), 0.5);
    // The trail: the strikes' own, and a faint one on a very fast blade (a rebound), never a fan on every move.
    f.trail.update(dt, f.base, f.tip, f.lit * Math.max((f.combat.output.trail || 0) * 0.85, clamp((f.swing.length() - 9) / 14, 0, 0.35)));
  }
  /** His feet on the deck: a step heard, and printed red if he trod in it. */
  function stride(f, dt) {
    const speed = Math.hypot(f.motion.vx + f.push.x, f.motion.vz + f.push.z);
    if (speed < 0.35 || f.dash) { f.stride = 0.6; return; }
    f.stride += speed * dt / (f.motion.runBlend > 0.5 ? 1.25 : 0.7);
    if (f.stride < 1) return;
    f.stride %= 1;
    audio.step(f.character.root.position, { pace: Math.min(1, speed / 4.5) });
    onStep(f);
  }

  /** What the enemy's mind is told of the fight. */
  function view() {
    const toward = angleTo(enemy, player), d = range(enemy, player);
    const frac = s => ({ energy: s.energy / s.maxEnergy, posture: s.posture / DUEL.posture, wounds: s.wounds, broken: s.broken > 0, staggered: s.stagger > 0, guard: s.guard, alive: s.alive });
    const heroIn = impactIn(player);
    return {
      distance: d,
      facing: faces(enemy, player, 1.25),
      bind: Boolean(bind),
      me: { ...frac(enemy.state), busy: enemy.combat.busy, chainable: enemy.combat.busy && phaseOf(enemy) > (enemy.combat.action?.buffer ?? 1) },
      hero: {
        ...frac(player.state), open: player.state.open > 0 || player.state.stagger > 0,
        guardTime: player.guardTime, idle: player.idleTime > 0.8,
        closing: player.motion.speed > 0.5 && Math.cos(Math.atan2(player.motion.vx, player.motion.vz) - angleTo(player, enemy)) > 0.5,
        striking: heroIn < Infinity ? { id: player.strike.id, impactIn: heroIn, heavy: player.strike.heavy, unblockable: player.strike.unblockable } : null,
        forcing: player.forcing,
      },
      bearing: angleDelta(enemy.motion.heading, toward),
    };
  }

  // ---- The entrance ------------------------------------------------------------
  /** Where he walks from (the corridor, deep), and the way out of it. */
  const outward = () => door.out.clone().setY(0).normalize();
  function placeEnemy(at, heading) {
    enemy.motion.reset();
    enemy.motion.x = at.x; enemy.motion.z = at.z; enemy.motion.face(heading);
    enemy.combat.reset(); enemy.blade.reset(); enemy.state = createDuelState();
    enemy.strike = enemy.pending = enemy.feint = enemy.dash = enemy.forcing = null;
    enemy.push.set(0, 0, 0); enemy.cause = ''; enemy.stride = 0.6; enemy.trail.clear();
  }
  function enter() {
    reset();
    phase = 'entrance';
    entrance = { stage: 'door', age: 0, steps: 0, shut: false };
    const start = door.inside[2].clone().lerp(door.inside[3], 0.5);
    const out = outward();
    placeEnemy(start, Math.atan2(out.x, out.z));
    // His blade out, silently, before he is seen.
    enemy.lit = 0;
    for (let i = 0; i < 4; i++) enemy.saber.update(0, time + i * 0.1);
    time += 0.4;
    show(enemy, true);
    for (const light of enemy.saber.lights) light.intensity = 0;
    door.alarm = false;
    door.open();
    audio.door(door.centre);
    music.entrance();
  }
  function ignite() {
    entrance.stage = 'lit'; entrance.age = 0;
    enemy.lit = 1;
    enemy.combat.flourish();
    music.ignite();
    const at = enemy.character.root.position.clone().setY(1.2);
    effects.flash(at, 2.2, { color: new THREE.Color(1, 0.16, 0.12) });
    effects.burst(at, { power: 1.1, tint: 'red' });
    rumble(0.6, 0.5, 0.3);
  }
  function stepEntrance(dt) {
    const e = entrance;
    e.age += dt;
    const out = outward();
    let speed = 0;
    if (e.stage === 'door' && door.openness > 0.55) { e.stage = 'walk'; e.age = 0; }
    if (e.stage === 'walk') {
      speed = ENTRANCE.pace;
      enemy.motion.x += out.x * speed * dt; enemy.motion.z += out.z * speed * dt;
      e.stride = (e.stride ?? 0) + speed * dt;
      if (e.stride >= ENTRANCE.stride) { e.stride -= ENTRANCE.stride; music.step(); audio.step(enemy.character.root.position, { pace: 0.3 }); onStep(enemy); }
      // Through the door: it shuts behind him.
      const past = new THREE.Vector3(enemy.motion.x - door.centre.x, 0, enemy.motion.z - door.centre.z).dot(out);
      if (!e.shut && past > 1.6) { e.shut = true; door.close(); audio.door(door.centre); }
      // He stops before the door — or lights it at once if the hero comes at him.
      if (past >= new THREE.Vector3().subVectors(stand, door.centre).setY(0).dot(out)) { e.stage = 'turn'; e.age = 0; }
      if (range(enemy, player) < ENTRANCE.near) { e.stage = 'turn'; e.age = ENTRANCE.turn; }
    }
    if (e.stage === 'turn') {
      enemy.motion.heading += angleDelta(enemy.motion.heading, angleTo(enemy, player)) * (1 - Math.exp(-5 * dt));
      if (e.age >= ENTRANCE.turn) ignite();
    }
    if (e.stage === 'lit') {
      enemy.motion.heading += angleDelta(enemy.motion.heading, angleTo(enemy, player)) * (1 - Math.exp(-6 * dt));
      if (!e.shut && door.openness > 0) { e.shut = true; door.close(); audio.door(door.centre); }
      if (e.age >= ENTRANCE.held) engage();
    }
    enemy.motion.speed = speed;
    enemy.motion.vx = out.x * speed; enemy.motion.vz = out.z * speed;
    enemy.motion.runBlend = 0;
    enemy.combat.update(dt, { guard: false, speed, aim: null, charging: false });
    enemy.combat.takeStart();
    animate(enemy, dt);
  }
  /** The fight begins: the hero's body is the duel's now. */
  function engage() {
    phase = 'fight';
    entrance = null;
    mind = createDuelMind();
    for (const f of fighters) {
      f.state = createDuelState(); f.blade.reset(); f.lit = 1;
      f.strike = f.pending = f.feint = f.dash = f.forcing = null; f.push.set(0, 0, 0); f.cause = ''; f.guardTime = f.idleTime = 0;
    }
    player.combat.reset();
    player.motion.saber = 1;
    hitStop = slowMo = bind = null; lastBind = attackBuffered = -Infinity;
    readInput();
    music.fight();
  }

  // ---- Each frame ------------------------------------------------------------------
  /** The duel's clock: freezes ease back to speed, slow motion holds then eases. Returns the world's time scale. */
  function scale(dt) {
    frameDt = dt;
    let value = 1;
    if (hitStop) { value = Math.min(value, hitStopScale(hitStop.age, hitStop)); if ((hitStop.age += dt) > hitStop.hold + hitStop.recover) hitStop = null; }
    if (slowMo) {
      const { age, hold, recover } = slowMo;
      value = Math.min(value, age < hold ? slowMo.scale : slowMo.scale + (1 - slowMo.scale) * Math.min(1, (age - hold) / recover) ** 2);
      if ((slowMo.age += dt) > hold + recover) slowMo = null;
    }
    return value;
  }
  function step(dt, { immortal = false } = {}) {
    if (phase === 'idle') return;
    time += dt;
    for (const fragment of fragments) fragment.update(dt, frameDt);
    if (phase === 'entrance') { if (entrance.stage === 'ready') readyStep(dt); else stepEntrance(dt); return; }
    if (phase === 'over') {
      outcomeAge += frameDt;
      // The winner's blade plays on to rest.
      for (const f of fighters) if (f.state.alive) { stepFighter(f, dt, { x: 0, z: 0, guard: false }); animate(f, dt); }
      shudder();
      return;
    }
    const input = readInput();
    // The hero.
    player.idleTime = input.magnitude > 0.1 || player.combat.busy ? 0 : player.idleTime + dt;
    if (bind) stepBind(dt, input);
    else {
      if (input.pressed.attack) attackBuffered = time;
      if (time - attackBuffered < 0.5 && requestStrike(player)) attackBuffered = -Infinity;
      if (input.pressed.guard) {
        // RB during his own wind-up (a deliberate one, not a press right after B) takes the strike back: his own feint.
        if (player.strike && !player.strike.resolved && player.strike.age > 0.12 && phaseOf(player) < player.strike.impact) interruptStrike(player);
        parry(player.state);
      }
      if (input.pressed.dash) startDash(player, input.magnitude > 0.2 ? new THREE.Vector3(input.x, 0, input.z) : forward(angleTo(enemy, player)));
      if (input.pressed.pull) startForce(player, 'pull');
      if (input.pressed.push) startForce(player, 'push');
    }
    // The enemy.
    intent = mind.think(dt, view());
    let enemyMove = { x: 0, z: 0 };
    if (intent && !bind) {
      const to = forward(angleTo(enemy, player)), side = new THREE.Vector3(to.z, 0, -to.x);
      enemyMove = { x: to.x * intent.forward + side.x * intent.strafe, z: to.z * intent.forward + side.z * intent.strafe };
      if (intent.parry) parry(enemy.state);
      if (intent.dash) startDash(enemy, to.clone().multiplyScalar(intent.dash.forward).addScaledVector(side, intent.dash.strafe));
      if (intent.force) startForce(enemy, intent.force);
      if (intent.attack) requestStrike(enemy, intent.attack, { feint: intent.feint });
    }
    stepFighter(player, dt, { x: bind ? 0 : input.x, z: bind ? 0 : input.z, guard: input.current.guard && !bind });
    stepFighter(enemy, dt, { x: enemyMove.x, z: enemyMove.z, guard: Boolean(intent?.guard) && !bind });
    // Bodies never pass through each other.
    const dx = enemy.motion.x - player.motion.x, dz = enemy.motion.z - player.motion.z, d = Math.hypot(dx, dz);
    const min = bind ? 0.95 : 0.82;
    if (d < min && d > 1e-4) { const o = (min - d) / 2; player.motion.x -= dx / d * o; player.motion.z -= dz / d * o; enemy.motion.x += dx / d * o; enemy.motion.z += dz / d * o; }
    for (const f of fighters) { animate(f, dt); stride(f, dt); }
    // Strikes land, in the order they come.
    for (const f of fighters) if (phase === 'fight' && f.strike && !f.strike.resolved && phaseOf(f) >= f.strike.impact) resolve(f, immortal);
    // The score follows the fight: blades locked, a guard broken, a wound.
    music.intensity(bind || enemy.state.broken > 0 || player.state.broken > 0 ? 1 : 0.55 + 0.12 * (player.state.wounds + enemy.state.wounds));
    shudder();
  }
  /** Through a freeze the struck body shudders. */
  function shudder() {
    if (!frozen() || !hitStop.victim) return;
    const root = hitStop.victim.character.root, fade = 1 - hitStop.age / hitStop.hold;
    root.position.addScaledVector(screenRight, (Math.floor(hitStop.age * 60) % 2 ? 1 : -1) * 0.028 * fade);
  }
  /** After a death, before the fight starts again: both stand a beat, blades lit. */
  function readyStep(dt) {
    entrance.age += dt;
    for (const f of fighters) {
      f.motion.update(dt, 0, 0, { analog: true, maxSpeed: 1, engaged: true });
      f.motion.heading += angleDelta(f.motion.heading, angleTo(f, opponent(f))) * (1 - Math.exp(-8 * dt));
      f.combat.update(dt, { guard: false, speed: 0, aim: null, charging: false });
      f.combat.takeStart();
      animate(f, dt);
    }
    if (entrance.age > 1.1) engage();
  }

  /** The camera, from his entrance on: both framed, the snap of a blow held through the freeze. */
  const viewOffset = new THREE.Vector3();
  function camera(dt) {
    focus.set((player.motion.x + enemy.motion.x) * 0.5, 0.75, (player.motion.z + enemy.motion.z) * 0.5);
    const still = frozen();
    if (!still) {
      if (pendingTrauma) { shake.add(pendingTrauma); pendingTrauma = 0; }
      cameraKick.velocity.addScaledVector(cameraKick.offset, -260 * dt).multiplyScalar(Math.max(0, 1 - 18 * dt));
      cameraKick.offset.addScaledVector(cameraKick.velocity, dt);
      punch.velocity += (-220 * punch.value - 20 * punch.velocity) * dt;
      punch.value += punch.velocity * dt;
    }
    const d = range(player, enemy);
    // Coming in, he may be across the room: the view widens to keep both.
    const spread = phase === 'entrance' && entrance?.stage !== 'ready' ? clamp(0.7 + d * 0.075, 0.9, 1.65) : clamp(0.75 + d * 0.08, 0.9, 1.35);
    const zoom = (d < 1.6 ? 0.9 : 1) * spread * (bind ? 0.84 - Math.min(0.1, bind.age * 0.08) : 1) * (outcome ? 0.84 : 1);
    const pose = shake.update(still ? 0 : dt);
    viewOffset.copy(cameraKick.offset).addScaledVector(screenRight, pose.offset.x).add(new THREE.Vector3(0, pose.offset.y, 0));
    return { focus, offset: viewOffset, roll: pose.roll, zoom, punch: clamp(punch.value, -0.2, 0.25) };
  }
  /** The pixel prompt: finish him (his guard broken), or hammer B (blades locked). */
  function ask() {
    if (phase !== 'fight') return null;
    if (bind) return { label: 'MARTELER', progress: clamp((bind.balance + 1) / 2, 0.02, 1), anchor: bind.mid.clone().setY(bind.mid.y + 0.75) };
    if (enemy.state.broken > 0 && enemy.state.alive) return { label: 'ACHEVER', progress: enemy.state.broken / DUEL.broken, anchor: enemy.character.root.position.clone().setY(2.05) };
    return null;
  }
  /** The gauges, both sides: wounds left, breath (energy), balance (posture). */
  function hud(elements) {
    for (const f of fighters) {
      const side = elements[f.id];
      if (!side) continue;
      const cells = (track, value, max, low) => {
        const filled = Math.ceil(track.children.length * value / max);
        for (let index = 0; index < track.children.length; index++) track.children[index].classList.toggle('filled', index < filled);
        track.classList.toggle('low', low);
      };
      cells(side.energy, f.state.energy, f.state.maxEnergy, f.state.tired);
      cells(side.posture, f.state.posture, DUEL.posture, f.state.posture > DUEL.posture * 0.7);
      for (let index = 0; index < side.wounds.children.length; index++) side.wounds.children[index].classList.toggle('lost', index >= DUEL.wounds - f.state.wounds);
    }
  }

  /** After his death: the hero back on his feet before the Jedi, who waits, blade lit. */
  function retry() {
    for (const fragment of fragments) fragment.dispose();
    fragments.length = 0;
    outcome = null; outcomeAge = 0;
    hitStop = slowMo = bind = null; pendingTrauma = 0;
    cameraKick.offset.set(0, 0, 0); cameraKick.velocity.set(0, 0, 0); punch.value = punch.velocity = 0; shake.clear();
    const out = outward();
    placeEnemy(stand, Math.atan2(-out.x, -out.z));
    enemy.lit = 1;
    show(enemy, true);
    const heroAt = stand.clone().addScaledVector(out, 3.6);
    player.motion.reset();
    player.motion.x = heroAt.x; player.motion.z = heroAt.z; player.motion.face(Math.atan2(-out.x, -out.z));
    player.motion.saber = 1;
    player.combat.reset(); player.blade.reset(); player.trail.clear();
    player.state = createDuelState(); player.cause = '';
    for (const f of fighters) { f.character.root.position.set(f.motion.x, 0, f.motion.z); f.character.root.rotation.y = f.motion.heading; f.character.update({ dt: 0, time, speed: 0 }); f.coat.reset(); }
    phase = 'entrance';
    entrance = { stage: 'ready', age: 0 };
    music.stop();
  }
  /** The game starts again: he is gone, the corridor empty. */
  function reset() {
    for (const fragment of fragments) fragment.dispose();
    fragments.length = 0;
    phase = 'idle'; entrance = null; outcome = null; outcomeAge = 0;
    hitStop = slowMo = bind = null; pendingTrauma = 0; lastBind = attackBuffered = -Infinity;
    cameraKick.offset.set(0, 0, 0); cameraKick.velocity.set(0, 0, 0); punch.value = punch.velocity = 0; shake.clear();
    player.state = createDuelState(); player.blade.reset(); player.lit = 1;
    show(enemy, false);
    enemy.trail.clear();
    music.stop();
  }

  return {
    enter, step, scale, camera, ask, hud, retry, reset,
    /** He is in the room (or coming into it). */
    get present() { return phase !== 'idle'; },
    /** The hero's body is the duel's: from the moment the blades are lit until a while after the victory. */
    get fighting() { return phase === 'fight' || (phase === 'entrance' && entrance?.stage === 'ready') || (phase === 'over' && !(outcome === 'victory' && outcomeAge > 1.8)); },
    get phase() { return phase; },
    get stage() { return entrance?.stage ?? null; },
    get outcome() { return outcome; },
    get frozen() { return frozen(); },
    /** Why the hero died (a line for the death card). */
    get cause() { return CAUSES[player.cause] ?? CAUSES.wounds; },
    player, enemy,
    get mind() { return mind; }, get bind() { return bind; },
    /** For checks: virtual buttons and stick. */
    hold(name, value = true) { virtual[name] = value; },
    stick(x = 0, y = 0) { virtual.x = x; virtual.y = y; },
  };
}
