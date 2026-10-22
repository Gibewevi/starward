import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStormtrooper, collideSquad } from '../src/stormtrooper.js';
import { createLab } from '../src/lab.js';
import { createSquadMind } from '../src/trooper-ai.js';
import { FEEL } from '../src/feel.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function solo(seed) {
  const trooper = createStormtrooper({ scene: new THREE.Scene(), position: new THREE.Vector3(), heading: 0, random: seeded(seed) });
  let time = 0;
  const run = seconds => { for (let frame = 0; frame < Math.round(seconds * 60); frame++) trooper.update(1 / 60, time += 1 / 60); };
  return { trooper, run };
}
/** A bolt into his chest, at a share of the way from his waist up to his neck. */
function bolt(trooper, share) {
  const point = trooper.particle('W').position.clone().lerp(trooper.particle('N').position, share);
  const hit = trooper.boltHit(point.clone().add(new THREE.Vector3(0, 0, 0.8)), point.clone().add(new THREE.Vector3(0, 0, -0.2)));
  assert.equal(hit?.body.name, 'torso');
  return trooper.shot(hit, new THREE.Vector3(0, 0, -15));
}

test('a bolt low in the body: he goes down alive and hurt, stays down, and once treated gets back up', () => {
  const { trooper, run } = solo(11);
  run(0.3);
  const event = bolt(trooper, 0.35);
  assert.ok(!event.lethal && event.felled, 'felled, not killed');
  assert.ok(!trooper.dead && trooper.fallen && trooper.hurt);
  run(5);
  assert.equal(trooper.state, 'hurt', 'he does not get up on his own');
  assert.ok(trooper.heal());
  run(4);
  assert.ok(!trooper.fallen && !trooper.hurt && !trooper.dead, `back on his feet (${trooper.state})`);
});

test('high on the chest it kills; a second bolt finishes a man down; left alone he bleeds out', () => {
  const heart = solo(12);
  heart.run(0.3);
  assert.ok(bolt(heart.trooper, 0.8).lethal && heart.trooper.dead, 'the heart');
  const twice = solo(13);
  twice.run(0.3);
  bolt(twice.trooper, 0.35);
  twice.run(2);
  const lying = twice.trooper.particle('W').position.clone().lerp(twice.trooper.particle('N').position, 0.5);
  const hit = twice.trooper.boltHit(lying.clone().add(new THREE.Vector3(0, 0.8, 0)), lying.clone().add(new THREE.Vector3(0, -0.3, 0)));
  assert.ok(hit, 'the bolt meets the body on the floor');
  assert.ok(twice.trooper.shot(hit, new THREE.Vector3(0, -15, 0)).lethal, 'finished');
  const alone = solo(14);
  alone.run(0.3);
  bolt(alone.trooper, 0.35);
  alone.run(FEEL.wounded.bleed[1] + 1.5);
  assert.ok(alone.trooper.dead, 'bled out');
});

function squadWithWounded(seed = 5) {
  const lab = createLab(new THREE.Scene());
  const at = (x, z) => new THREE.Vector3(x, 0, z);
  const troopers = [at(-3.3, -4.8), at(-0.9, -5.9)].map((position, index) => createStormtrooper({ scene: new THREE.Scene(), position, heading: 0.7, random: seeded(30 + index), lab }));
  const [patient, rescuer] = troopers;
  const squad = createSquadMind({ troopers, lab, random: seeded(seed) });
  const hero = new THREE.Vector3(6, 0, 4);
  for (const mind of squad.minds) mind.awareness = 1;
  let time = 0;
  const cues = [];
  const step = () => {
    time += 1 / 60;
    cues.push(...squad.update(1 / 60, { hero }).cues);
    for (const trooper of troopers) trooper.update(1 / 60, time);
    collideSquad(troopers);
  };
  for (let i = 0; i < 30; i++) step();
  bolt(patient, 0.35);
  return { lab, patient, rescuer, squad, hero, cues, step, mind: squad.minds[1] };
}

test('a squadmate runs to the man down, drags him behind a crate, kneels and treats him; both get up', () => {
  const { patient, rescuer, cues, step, mind } = squadWithWounded();
  const from = patient.particle('W').position.clone().setY(0);
  const stages = new Set();
  let hauled = false, knelt = false, handOn = false;
  for (let frame = 0; frame < 60 * 22 && patient.fallen; frame++) {
    step();
    if (mind.rescue) stages.add(mind.rescue.stage);
    hauled ||= patient.hauled;
    if (mind.rescue?.stage === 'treat' && rescuer.reaction.crouch > 0.7) knelt = true;
    handOn ||= Boolean(rescuer.order.tend) && rescuer.reaction.holdL < 0.3;
  }
  assert.ok(stages.has('go') && stages.has('treat'), [...stages].join(' > '));
  assert.ok(cues.some(cue => cue.type === 'radio' && cue.radio === 'cover'), 'he calls for cover');
  if (stages.has('drag')) {
    assert.ok(hauled, 'dragged by the collar');
    assert.ok(patient.particle('W').position.clone().setY(0).distanceTo(from) > 0.6, 'moved to cover');
  }
  assert.ok(knelt && handOn, 'kneeling, a hand on him');
  assert.ok(cues.some(cue => cue.type === 'heal') && cues.some(cue => cue.type === 'healed'), 'treated');
  for (let frame = 0; frame < 60 * 4; frame++) step();
  assert.ok(!patient.fallen && !patient.dead && !patient.hurt, `the man treated is up (${patient.state})`);
  assert.ok(!rescuer.fallen && !rescuer.dead && !mind.rescue, 'and his rescuer back in the fight');
});

test('the Jedi coming at the man treating him: he drops it, gets up and shoots; the man down stays down', () => {
  const { patient, rescuer, hero, step, mind } = squadWithWounded();
  for (let frame = 0; frame < 60 * 15 && !(mind.rescue && ['drag', 'treat'].includes(mind.rescue.stage) && mind.rescue.clock > 0.5); frame++) step();
  assert.ok(mind.rescue, 'busy with him');
  hero.copy(rescuer.root.position).add(new THREE.Vector3(2.4, 0, 1.2)).setY(0);
  let aimed = false;
  for (let frame = 0; frame < 60 * 1.5; frame++) { step(); aimed ||= rescuer.reaction.aim > 0.6; }
  assert.equal(mind.rescue, null, 'he dropped it');
  assert.ok(!patient.hauled && patient.hurt && patient.fallen, 'the man down stays down');
  assert.ok(rescuer.reaction.crouch < 0.5 && aimed, 'up, rifle on the Jedi');
});
