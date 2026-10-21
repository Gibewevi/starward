/**
 * The rules of the duel, apart from rendering, animation and the AI. Each
 * fighter has:
 * - energy: strikes, blocks, dashes and Force powers spend it; it comes back
 *   once he stops spending, faster when he stands off. Tired (under a
 *   quarter), every block costs him nearly twice the balance, and it shows.
 * - posture (balance): every strike he blocks fills it; a strike parried
 *   perfectly fills the attacker's instead. It drains back when he is left
 *   alone, faster behind his guard. Full, the guard breaks: the blade is
 *   knocked aside, he staggers for a long moment, and a clean strike then is
 *   a deathblow.
 * - wounds: a clean strike on an unbroken guard wounds him (thrown back,
 *   bleeding, off balance); the third one kills.
 * Two strikes meeting lock the blades (a bind): the stronger pushes the
 * other off balance. An unblockable strike (a red glint) smashes through a
 * mere guard — half his balance gone, thrown off his feet a moment — so it
 * is parried perfectly or dodged.
 */
export const DUEL = Object.freeze({
  energy: 100, posture: 210, wounds: 3,
  cost: { strike: 8, heavy: 15, block: 5, dash: 14, force: 26, bind: 6 },
  // Energy back: once he has not spent for `delay` s; slower while striking or guarding.
  regen: { delay: 0.5, fighting: 9, calm: 24 },
  // Balance back: once he has not been pressed for `delay` s; faster guarding, slower tired.
  recover: { delay: 0.8, rate: 14, guarding: 1.6, tired: 0.5 },
  block: { posture: 10, heavy: 22, tired: 1.8, open: 1.4, unblockable: 45, smashed: 0.7 }, // open: × on a guard still shaken by a parry (the riposte bites)
  parry: { window: 0.16, cooldown: 0.3, posture: 16, heavy: 30, energy: 14, open: 0.6, stagger: 0.15 },
  bind: { posture: 22, stagger: 0.5 },
  wound: { posture: 30, energy: 18, stagger: 0.62, grace: 0.9 }, // grace: s no blade can touch him after a wound (the combo's next cut cannot finish him)
  broken: 1.7, // s the broken guard leaves him open
  afterBreak: 0.4, // share of balance he keeps once he recovers from a break
  tired: 0.25, // share of energy under which he is tired
  force: { range: 4.2, push: 34, pushStagger: 0.62, pullStagger: 0.42, pullOpen: 0.5 },
  dash: { invulnerable: 0.26 },
});

export function createDuelState({ energy = DUEL.energy } = {}) {
  return {
    maxEnergy: energy, energy, posture: 0, wounds: 0, alive: true,
    guard: false, guardAge: 0, parryAge: Infinity,
    stagger: 0, open: 0, broken: 0, invulnerable: 0,
    idle: Infinity, calm: Infinity, tired: false,
  };
}

const full = state => state.posture >= DUEL.posture - 1e-6;

/** Each frame: timers run down, energy and balance come back when they may. */
export function advanceDuelState(state, dt, { guarding = false, striking = false } = {}) {
  if (!state.alive) return state;
  state.stagger = Math.max(0, state.stagger - dt);
  state.open = Math.max(0, state.open - dt);
  state.invulnerable = Math.max(0, state.invulnerable - dt);
  state.parryAge += dt;
  state.idle += dt;
  state.calm += dt;
  if (state.broken > 0) {
    state.broken = Math.max(0, state.broken - dt);
    if (state.broken === 0) state.posture = DUEL.posture * DUEL.afterBreak;
  }
  const guard = guarding && state.stagger <= 0 && state.broken <= 0;
  state.guardAge = guard ? (state.guard ? state.guardAge + dt : 0) : 0;
  state.guard = guard;
  if (state.idle > DUEL.regen.delay) state.energy += (striking || guard ? DUEL.regen.fighting : DUEL.regen.calm) * dt;
  state.energy = Math.min(state.maxEnergy, Math.max(0, state.energy));
  state.tired = state.energy < state.maxEnergy * DUEL.tired;
  if (state.calm > DUEL.recover.delay && state.broken <= 0) {
    const rate = DUEL.recover.rate * (guard ? DUEL.recover.guarding : 1) * (state.tired ? DUEL.recover.tired : 1);
    state.posture = Math.max(0, state.posture - rate * dt);
  }
  return state;
}

/** Energy for a move. Strikes always go (a tired fighter is slow, not frozen); the rest need enough. */
export function spend(state, kind) {
  if (!state.alive || state.broken > 0) return false;
  const cost = DUEL.cost[kind] ?? 0;
  if (kind !== 'strike' && state.energy < cost) return false;
  state.energy = Math.max(0, state.energy - cost);
  state.idle = 0;
  return true;
}

/** RB pressed: a parry is tried — not again until the cooldown is over, so it cannot be mashed. */
export function parry(state) {
  if (!state.alive || state.broken > 0 || state.stagger > 0) return false;
  if (state.parryAge < DUEL.parry.cooldown) return false;
  state.parryAge = 0;
  return true;
}

function press(state, amount) {
  state.posture = Math.min(DUEL.posture, state.posture + amount);
  state.calm = 0;
}

export function breakGuard(state) {
  state.posture = DUEL.posture;
  state.broken = DUEL.broken;
  state.stagger = Math.max(state.stagger, DUEL.broken * 0.8);
  state.guard = false;
  state.calm = 0;
}

/**
 * A strike reaches the defender. `facing`: he faces the attacker (a guard
 * covers only the front); `heavy`: a finisher-weight blow; `unblockable`:
 * only a perfect parry or a dodge stops it.
 * Returns 'miss' | 'parry' | 'parryBreak' (the attacker's guard broke on it)
 * | 'block' | 'smashed' (an unblockable through the guard) | 'guardBreak'
 * | 'wound' | 'kill'.
 */
export function resolveStrike(attacker, defender, { facing = true, heavy = false, unblockable = false } = {}) {
  if (!defender.alive || defender.invulnerable > 0) return 'miss';
  const steady = defender.broken <= 0 && defender.stagger <= 0;
  if (facing && steady && defender.parryAge <= DUEL.parry.window) {
    press(attacker, heavy || unblockable ? DUEL.parry.heavy : DUEL.parry.posture);
    attacker.open = Math.max(attacker.open, DUEL.parry.open);
    attacker.stagger = Math.max(attacker.stagger, DUEL.parry.stagger);
    defender.energy = Math.min(defender.maxEnergy, defender.energy + DUEL.parry.energy);
    if (full(attacker)) { breakGuard(attacker); return 'parryBreak'; }
    return 'parry';
  }
  if (facing && defender.guard && defender.broken <= 0) {
    if (unblockable) {
      press(defender, DUEL.block.unblockable);
      defender.stagger = Math.max(defender.stagger, DUEL.block.smashed);
      defender.guard = false;
      if (full(defender)) { breakGuard(defender); return 'guardBreak'; }
      return 'smashed';
    }
    press(defender, (heavy ? DUEL.block.heavy : DUEL.block.posture) * (defender.tired ? DUEL.block.tired : 1) * (defender.open > 0 ? DUEL.block.open : 1));
    defender.energy = Math.max(0, defender.energy - DUEL.cost.block);
    defender.idle = 0;
    if (full(defender) || defender.energy <= 0) { breakGuard(defender); return 'guardBreak'; }
    return 'block';
  }
  if (defender.broken > 0 || defender.wounds + 1 >= DUEL.wounds) {
    defender.alive = false;
    defender.guard = false;
    return 'kill';
  }
  defender.wounds++;
  press(defender, DUEL.wound.posture);
  defender.energy = Math.max(0, defender.energy - DUEL.wound.energy);
  defender.stagger = Math.max(defender.stagger, DUEL.wound.stagger);
  defender.invulnerable = Math.max(defender.invulnerable, DUEL.wound.grace);
  defender.guard = false;
  if (full(defender)) breakGuard(defender);
  return 'wound';
}

/** How hard he pushes in a bind: his energy and balance, and the effort he puts in (0 → 1). */
export function bindStrength(state, effort = 0.5) {
  return (0.35 + 0.65 * state.energy / state.maxEnergy) * (1.15 - 0.6 * state.posture / DUEL.posture) * (0.4 + effort);
}

/** The bind ends: the loser is shoved off balance (his guard may break on it). Returns 'shove' or 'break'. */
export function resolveBind(winner, loser) {
  winner.energy = Math.max(0, winner.energy - DUEL.cost.bind);
  loser.energy = Math.max(0, loser.energy - DUEL.cost.bind);
  winner.idle = loser.idle = 0;
  press(loser, DUEL.bind.posture);
  loser.stagger = Math.max(loser.stagger, DUEL.bind.stagger);
  if (full(loser)) { breakGuard(loser); return 'break'; }
  return 'shove';
}

/**
 * A Force power reaches the target (facing him, in range). A push on a guard
 * crushes his balance; on anything else it throws him off his feet a moment.
 * A pull drags him in, open. Returns 'none' | 'pushed' | 'guardBreak' | 'pulled'.
 */
export function forceHit(caster, target, kind, { facing = true, distance = 0 } = {}) {
  if (!caster.alive || !target.alive || !facing || distance > DUEL.force.range || target.invulnerable > 0) return 'none';
  if (kind === 'push') {
    if (target.guard) {
      press(target, DUEL.force.push);
      if (full(target)) { breakGuard(target); return 'guardBreak'; }
      target.stagger = Math.max(target.stagger, DUEL.force.pushStagger * 0.5);
      return 'pushed';
    }
    press(target, DUEL.force.push * 0.5);
    target.stagger = Math.max(target.stagger, DUEL.force.pushStagger);
    if (full(target)) { breakGuard(target); return 'guardBreak'; }
    return 'pushed';
  }
  press(target, DUEL.force.push * 0.3);
  target.stagger = Math.max(target.stagger, DUEL.force.pullStagger);
  target.open = Math.max(target.open, DUEL.force.pullOpen);
  target.guard = false;
  return 'pulled';
}

/** A dash: out of reach for an instant. */
export function dash(state) {
  if (!spend(state, 'dash')) return false;
  state.invulnerable = DUEL.dash.invulnerable;
  return true;
}
