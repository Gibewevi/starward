import test from 'node:test';
import assert from 'node:assert/strict';
import { DUEL, createDuelState, advanceDuelState, spend, parry, resolveStrike, bindStrength, resolveBind, forceHit, dash } from '../src/duel-rules.js';
import { createDuelMind } from '../src/duel-ai.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

test('a guard takes the blow on the blade: balance fills, a little energy goes, and full it breaks', () => {
  const attacker = createDuelState(), defender = createDuelState();
  advanceDuelState(defender, 0.5, { guarding: true });
  let result = null, blocks = 0;
  while ((result = resolveStrike(attacker, defender, { facing: true })) === 'block') { blocks++; advanceDuelState(defender, 0.2, { guarding: true }); }
  assert.equal(result, 'guardBreak');
  assert.ok(blocks >= 6, `a guard holds a while (${blocks} blocks)`);
  assert.ok(defender.broken > 0 && defender.stagger > 0 && !defender.guard, 'broken: staggered, guard down');
  // Broken, a strike is a deathblow.
  assert.equal(resolveStrike(attacker, defender, { facing: true }), 'kill');
  assert.equal(defender.alive, false);
});

test('a guard covers only the front: from the side the blade goes through', () => {
  const attacker = createDuelState(), defender = createDuelState();
  advanceDuelState(defender, 0.5, { guarding: true });
  assert.equal(resolveStrike(attacker, defender, { facing: false }), 'wound');
});

test('a perfect parry: pressed just before the blow, it is the attacker who reels; it cannot be mashed', () => {
  const attacker = createDuelState(), defender = createDuelState();
  defender.energy = 50;
  assert.ok(parry(defender));
  advanceDuelState(defender, DUEL.parry.window * 0.5, { guarding: true });
  assert.equal(resolveStrike(attacker, defender, { facing: true }), 'parry');
  assert.ok(attacker.posture >= DUEL.parry.posture - 1e-6 && attacker.stagger > 0 && attacker.open > 0, 'the attacker off balance, open');
  assert.ok(defender.energy > 50 && defender.posture === 0, 'the parrying side gains energy, loses nothing');
  // Pressed again at once: refused (no mashing).
  assert.equal(parry(defender), false);
  // Too early: it is only a block.
  const early = createDuelState();
  parry(early);
  advanceDuelState(early, DUEL.parry.window + 0.05, { guarding: true });
  assert.equal(resolveStrike(createDuelState(), early, { facing: true }), 'block');
});

test('a riposte blocked by a guard still shaken from a parry bites deeper', () => {
  const steady = createDuelState(), shaken = createDuelState();
  for (const s of [steady, shaken]) advanceDuelState(s, 0.5, { guarding: true });
  shaken.open = 0.4;
  resolveStrike(createDuelState(), steady, { facing: true });
  resolveStrike(createDuelState(), shaken, { facing: true });
  assert.ok(shaken.posture >= steady.posture * DUEL.block.open - 1e-6 && DUEL.block.open > 1);
});

test('wounds: a grace after each, and the last one kills', () => {
  const attacker = createDuelState(), defender = createDuelState();
  for (let wound = 1; wound < DUEL.wounds; wound++) {
    assert.equal(resolveStrike(attacker, defender, { facing: false }), 'wound');
    assert.equal(resolveStrike(attacker, defender, { facing: false }), 'miss', 'the combo’s next cut cannot finish him');
    advanceDuelState(defender, DUEL.wound.grace + 0.05);
    defender.posture = 0;
  }
  assert.equal(resolveStrike(attacker, defender, { facing: false }), 'kill');
});

test('an unblockable smashes a mere guard; a perfect parry or a dash beats it', () => {
  const guard = createDuelState();
  advanceDuelState(guard, 0.5, { guarding: true });
  assert.equal(resolveStrike(createDuelState(), guard, { facing: true, unblockable: true }), 'smashed');
  assert.ok(guard.stagger > 0 && guard.posture >= DUEL.block.unblockable - 1e-6);
  const parrying = createDuelState();
  parry(parrying);
  assert.equal(resolveStrike(createDuelState(), parrying, { facing: true, unblockable: true }), 'parry');
  const dodging = createDuelState();
  assert.ok(dash(dodging));
  assert.equal(resolveStrike(createDuelState(), dodging, { facing: true, unblockable: true }), 'miss');
});

test('energy: strikes always go, dashes and the Force need enough; it comes back when left alone, balance too', () => {
  const s = createDuelState();
  s.energy = 5;
  assert.equal(spend(s, 'strike'), true, 'a tired fighter is slow, not frozen');
  assert.equal(spend(s, 'force'), false);
  assert.equal(spend(s, 'dash'), false);
  s.posture = 80;
  const before = { energy: s.energy, posture: s.posture };
  for (let i = 0; i < 180; i++) advanceDuelState(s, 1 / 60);
  assert.ok(s.energy > before.energy + 20 && s.posture < before.posture - 10, 'breath and balance back');
});

test('a bind: the fresher, steadier fighter pushing harder wins and shoves the other off balance', () => {
  const fresh = createDuelState(), spent = createDuelState();
  spent.energy = 20; spent.posture = 120;
  assert.ok(bindStrength(fresh, 0.8) > bindStrength(spent, 0.8));
  assert.ok(bindStrength(spent, 1) > bindStrength(spent, 0.1), 'effort counts');
  const result = resolveBind(fresh, spent);
  assert.ok(['shove', 'break'].includes(result));
  assert.ok(spent.stagger > 0 && spent.posture > 120);
});

test('the Force: a push crushes a guard, a pull drags him in open', () => {
  const caster = createDuelState(), guarding = createDuelState(), standing = createDuelState();
  advanceDuelState(guarding, 0.5, { guarding: true });
  assert.equal(forceHit(caster, guarding, 'push', { facing: true, distance: 2 }), 'pushed');
  assert.ok(guarding.posture >= DUEL.force.push - 1e-6);
  assert.equal(forceHit(caster, standing, 'pull', { facing: true, distance: 3 }), 'pulled');
  assert.ok(standing.open > 0 && standing.stagger > 0);
  assert.equal(forceHit(caster, createDuelState(), 'push', { facing: true, distance: DUEL.force.range + 1 }), 'none', 'out of range');
});

function heroStrike(id, impactIn, extra = {}) { return { id, impactIn, heavy: false, unblockable: false, ...extra }; }
function view(extra = {}) {
  return {
    distance: 1.6, facing: true, bind: false, bearing: 0,
    me: { energy: 1, posture: 0, wounds: 0, broken: false, staggered: false, guard: false, alive: true, busy: false, chainable: false },
    hero: { energy: 1, posture: 0, wounds: 0, broken: false, staggered: false, guard: false, alive: true, open: false, guardTime: 0, idle: false, closing: false, striking: null, forcing: null },
    ...extra,
  };
}

test('the enemy sees a strike coming only after a reaction time, then guards or parries; too fast, it is caught', () => {
  const dt = 1 / 60;
  let defended = 0;
  // Slow strikes: it has time to react (over a few minds, nearly always).
  for (let seed = 1; seed <= 8; seed++) {
    const mind = createDuelMind({ random: seeded(seed) });
    let guarded = false;
    for (let t = 0; t < 0.5; t += dt) {
      const intent = mind.think(dt, view({ distance: 3, hero: { ...view().hero, striking: heroStrike(1, Math.max(0, 0.5 - t)) } }));
      guarded ||= intent.guard || intent.parry || Boolean(intent.dash);
    }
    defended += guarded ? 1 : 0;
  }
  assert.ok(defended >= 6, `it defends a slow strike (${defended}/8)`);
  // A strike landing sooner than any reaction, the guard down: no defence.
  const quick = createDuelMind({ random: seeded(4) });
  const first = quick.think(dt, view({ distance: 3, hero: { ...view().hero, striking: heroStrike(9, 0.05) } }));
  assert.ok(!first.parry && !first.dash, 'caught');
});

test('the enemy goes for the kill on a broken guard, backs off when spent, and parries more against a hero who only strikes', () => {
  const mind = createDuelMind({ random: seeded(5) });
  const kill = mind.think(1 / 60, view({ distance: 2, hero: { ...view().hero, broken: true } }));
  assert.equal(kill.attack, 'deathblow');
  const tired = createDuelMind({ random: seeded(6) });
  let back = 0;
  for (let i = 0; i < 30; i++) back += tired.think(1 / 60, view({ distance: 2.5, me: { ...view().me, energy: 0.1 } })).forward < 0 ? 1 : 0;
  assert.ok(back > 20, 'backs off to get its breath');
  assert.equal(tired.stance, 'recover');
  const spammed = createDuelMind({ random: seeded(7) });
  const before = spammed.parryChance;
  for (let i = 0; i < 12; i++) spammed.think(0.25, view({ hero: { ...view().hero, striking: heroStrike(100 + i, 0.4) } }));
  assert.ok(spammed.parryChance > before, `learns (${before.toFixed(2)} → ${spammed.parryChance.toFixed(2)})`);
});
