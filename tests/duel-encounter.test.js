import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLab } from '../src/lab.js';
import { createArena } from '../src/arena.js';
import { createCharacter } from '../src/character.js';
import { createCoat } from '../src/coat.js';
import { createSaber } from '../src/saber.js';
import { createBladeTrail } from '../src/blade-trail.js';
import { MotionController } from '../src/motion.js';
import { CombatController } from '../src/combat.js';
import { createImpactEffects } from '../src/impact-effects.js';
import { createWounds } from '../src/wounds.js';
import { createDuel } from '../src/duel.js';

const silent = new Proxy({}, { get: () => () => {} });

function room() {
  const scene = new THREE.Scene(), lab = createLab(scene), arena = createArena(scene, { lab });
  const character = createCharacter();
  scene.add(character.root);
  const hero = {
    character, coat: createCoat({ scene, character }), saber: createSaber({ socket: character.saberSocket, scene }), trail: createBladeTrail(scene),
    motion: new MotionController(), combat: new CombatController(), base: new THREE.Vector3(), tip: new THREE.Vector3(),
  };
  const door = arena.door, stand = door.centre.clone().addScaledVector(door.out, 3.2).setY(0);
  hero.motion.x = stand.x + door.out.x * 6; hero.motion.z = stand.z + door.out.z * 6;
  const wounds = createWounds();
  wounds.scene = scene;
  const music = { calls: [] };
  for (const name of ['entrance', 'step', 'ignite', 'fight', 'intensity', 'victory', 'defeat', 'stop', 'update']) music[name] = () => music.calls.push(name);
  const keys = new Set();
  const duel = createDuel({
    scene, hero, effects: createImpactEffects(scene), audio: silent, music, wounds, door, stand, keys,
    screenRight: new THREE.Vector3(10, 0, -8).normalize(), screenUp: new THREE.Vector3(-8, 0, -10).normalize(),
  });
  let time = 0;
  const run = (seconds, each = () => {}) => {
    for (let i = 0; i < seconds * 60; i++) {
      const sim = duel.present ? duel.scale(1 / 60) / 60 : 1 / 60;
      arena.update(time += sim);
      each();
      // God mode: an idle hero must not die before the check gets to him.
      if (duel.present) duel.step(sim, { immortal: true });
    }
  };
  return { duel, door, stand, hero, music, run };
}

test('the Jedi comes in: the door opens, he walks out to the beat, the door shuts behind him, his blade lit, the duel begins', () => {
  const { duel, door, stand, music, run } = room();
  assert.equal(duel.present, false);
  assert.equal(duel.enemy.character.root.visible, false, 'nobody before he is called');
  duel.enter();
  assert.ok(duel.present && !duel.fighting && duel.enemy.character.root.visible);
  assert.equal(duel.enemy.saber.extension, 0, 'his blade out as he walks in');
  let litAt = null;
  run(16, () => { if (duel.fighting && !litAt) litAt = new THREE.Vector3(duel.enemy.motion.x, 0, duel.enemy.motion.z); });
  assert.ok(duel.fighting, 'the duel has begun');
  assert.ok(music.calls.includes('entrance') && music.calls.filter(call => call === 'step').length >= 5, 'every step a stroke of the score');
  assert.ok(music.calls.indexOf('ignite') < music.calls.indexOf('fight'));
  assert.ok(duel.enemy.saber.extension > 0.9, 'his blade lit');
  assert.ok(door.target === 0, 'the door shut behind him');
  assert.ok(litAt.distanceTo(stand) < 0.6, `he stopped before the door (${litAt.distanceTo(stand).toFixed(2)} m)`);
});

test('the duel: his guard broken, the hero cuts his head off; a while after, the hero has his own body back', () => {
  const { duel, run } = room();
  duel.enter();
  run(16);
  assert.ok(duel.fighting);
  const enemy = duel.enemy, player = duel.player;
  player.motion.x = enemy.motion.x + 1.5; player.motion.z = enemy.motion.z;
  Object.assign(enemy.state, { broken: 1.7, stagger: 1, guard: false });
  Object.assign(player.state, { broken: 0, stagger: 0 });
  duel.hold('attack');
  run(1 / 30);
  duel.hold('attack', false);
  run(1.5);
  assert.equal(duel.outcome, 'victory');
  assert.ok(enemy.character.rig.bones.Head.scale.x < 0.01, 'beheaded');
  assert.ok(duel.fighting, 'still his for the beat after the blow');
  run(3);
  assert.equal(duel.fighting, false, 'handed back');
  duel.reset();
  assert.equal(duel.present, false);
  assert.equal(enemy.character.root.visible, false);
  assert.equal(enemy.character.rig.bones.Head.scale.x, 1);
});

test('god mode: his killing blow only wounds the hero; without it the hero dies, and a retry stands him before the Jedi again', () => {
  const { duel, run, hero } = room();
  duel.enter();
  run(16);
  const enemy = duel.enemy, player = duel.player;
  const breakHero = () => Object.assign(player.state, { broken: Math.max(player.state.broken, 0.6), stagger: Math.max(player.state.stagger, 0.3), guard: false });
  // He stands close, fresh: nothing keeps him from the deathblow.
  const closeIn = () => { enemy.motion.x = player.motion.x + 1.6; enemy.motion.z = player.motion.z; Object.assign(enemy.state, { energy: enemy.state.maxEnergy, posture: 0, stagger: 0, broken: 0 }); };
  closeIn();
  for (let i = 0; i < 60 * 8 && !duel.outcome; i++) { breakHero(); duel.step(duel.scale(1 / 60) / 60, { immortal: true }); }
  assert.equal(duel.outcome, null, 'immortal');
  assert.ok(player.state.alive);
  closeIn();
  for (let i = 0; i < 60 * 12 && !duel.outcome; i++) { breakHero(); duel.step(duel.scale(1 / 60) / 60); }
  assert.equal(duel.outcome, 'death');
  assert.ok(duel.cause.length > 10, 'a reason for the death card');
  duel.retry();
  assert.equal(duel.outcome, null);
  assert.ok(hero.character.root.visible && hero.character.rig.bones.Head.scale.x === 1, 'his body back');
  run(2);
  assert.equal(duel.phase, 'fight', 'the fight again');
  assert.ok(enemy.saber.extension > 0.9);
});
