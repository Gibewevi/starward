/**
 * The enemy Jedi's mind. It sees what a duellist sees — how far the hero
 * is, whether his blade is coming and how soon, whether he guards, how
 * tired and off balance both are — and decides each frame where to move
 * and what to do. It is not all-seeing: a strike coming at it is noticed
 * only after a reaction time, so a fast strike from close, a strike from
 * the side, a delayed one may get through; it parries some strikes
 * perfectly, blocks most, dodges a few.
 *
 * Its offence comes in patterns with a rhythm of their own: single cuts,
 * strings of two or three, a strike held back a beat, a feint (the blade
 * drawn back, then the real cut), a heavy blow, an unblockable thrust
 * announced by a red glint. Between them it circles at a distance and
 * measures. Parried, it guards; when it blocks or parries, it often
 * answers at once. Tired or off balance, it backs off to get its breath
 * back; seeing the hero broken, it goes for the kill.
 *
 * It learns the hero's habits over the fight: a hero who strikes all the
 * time meets more parries; one who parries its strikes meets more feints
 * and delays; one who hides behind his guard meets the Force and heavy
 * blows; one who stands off is pulled in.
 *
 * think(dt, view) → intent. notify(event) tells it what happened
 * ('parried': it parried the hero; 'blocked'; 'wasParried'; 'wasBlocked';
 * 'wounded'; 'hit'; 'bind').
 */
export const MIND = {
  reaction: [0.12, 0.24], // s to notice a strike coming
  guardRange: 2.1, // m: within striking distance it keeps its guard up, as a duellist does, unless it strikes
  parry: 0.28, parryMax: 0.5, // chance to parry perfectly, rising against a hero who strikes all the time
  block: 0.92, blockTired: 0.6, // chance to block what it does not parry
  parryLead: [0.05, 0.12], // s before the impact it presses its parry
  dodgeUnblockable: 0.65, dodgeForce: 0.4,
  riposte: { parried: 0.9, blocked: 0.45, delay: [0.05, 0.2] },
  distance: { measure: [2.3, 2.9], strike: 1.55, recover: 3.6 },
  measure: [0.5, 1.4], // s circling before a pattern
  recoverAt: { energy: 0.26, posture: 0.72 }, recoveredAt: { energy: 0.62, posture: 0.4 },
  turtle: 1.0, // s of hero guard that calls for the Force or a heavy blow
};

const PATTERNS = [
  { steps: ['quick'], weight: 1.2 },
  { steps: ['quick', 'quick'], weight: 1.4 },
  { steps: ['quick', 'quick', 'quick'], weight: 0.8 },
  { steps: ['quick', 0.32, 'quick'], weight: 0.9, delayed: true },
  { steps: ['quick', 'quick', 0.38, 'quick'], weight: 0.5, delayed: true },
  { steps: ['feint', 'quick'], weight: 0.6, feint: true },
  { steps: ['feint', 0.15, 'quick', 'quick'], weight: 0.4, feint: true },
  { steps: ['heavy'], weight: 0.45, heavy: true },
  { steps: ['quick', 'heavy'], weight: 0.55, heavy: true },
  { steps: ['unblockable'], weight: 0.3, heavy: true },
  { steps: ['quick', 0.2, 'unblockable'], weight: 0.25, heavy: true },
];

export function createDuelMind({ random = Math.random } = {}) {
  const pick = ([a, b]) => a + (b - a) * random();
  let clock = 0;
  let stance = 'measure', stanceUntil = pick(MIND.measure), strafe = random() < 0.5 ? 1 : -1, strafeUntil = 1;
  let plan = null; // { steps, index, nextAt }
  let defence = null; // { id, raiseAt, parryAt, decision, until }
  let riposteAt = Infinity, forceUntil = 0, coverUntil = 0;
  const seen = new Set();
  const memory = { strikes: [], parriedMe: [], guardSince: null };

  function choosePattern(view) {
    const recent = memory.parriedMe.filter(at => clock - at < 9).length;
    const turtle = view.hero.guardTime > MIND.turtle;
    let total = 0;
    const weighted = PATTERNS.map(pattern => {
      let weight = pattern.weight;
      if (recent >= 2 && (pattern.feint || pattern.delayed)) weight *= 2.4;
      if (turtle && pattern.heavy) weight *= 2.2;
      if (view.me.energy < 0.45 && pattern.steps.length > 2) weight *= 0.3;
      if (view.hero.open || view.hero.staggered) weight *= pattern.steps.length > 1 ? 1.6 : 0.6;
      total += weight;
      return [pattern, weight];
    });
    let roll = random() * total;
    for (const [pattern, weight] of weighted) if ((roll -= weight) <= 0) return pattern;
    return PATTERNS[0];
  }
  /** How likely it is to parry perfectly: more against a hero who strikes all the time. */
  function parryChance() {
    const rate = memory.strikes.filter(at => clock - at < 4).length / 4;
    return Math.min(MIND.parryMax, MIND.parry + Math.max(0, rate - 0.9) * 0.22);
  }

  function think(dt, view) {
    clock += dt;
    const intent = { forward: 0, strafe: 0, guard: false, parry: false, attack: null, dash: null, force: null, effort: 0 };
    const { me, hero } = view;
    if (!me.alive || !hero.alive) return intent;
    while (memory.strikes.length && clock - memory.strikes[0] > 6) memory.strikes.shift();

    // In a bind it pushes, harder the fresher it is, in waves.
    if (view.bind) {
      intent.effort = Math.min(1, 0.35 + 0.55 * me.energy + 0.25 * Math.sin(clock * 9 + random()));
      return intent;
    }
    // Thrown off balance it covers up as soon as it can: it expects the riposte.
    if (me.broken || me.staggered) { intent.guard = clock < coverUntil; return intent; }

    // The hero's blade coming: noticed after a while, then parried, blocked, dodged — or not.
    const strike = hero.striking;
    if (strike && !seen.has(strike.id)) {
      seen.add(strike.id);
      memory.strikes.push(clock);
      const reaction = pick(MIND.reaction);
      const late = strike.impactIn < reaction && !me.guard;
      let decision = 'fail';
      if (!late && view.facing) {
        if (strike.unblockable) decision = me.energy > 0.18 && random() < MIND.dodgeUnblockable ? 'dodge' : random() < parryChance() ? 'parry' : 'fail';
        else if (random() < parryChance()) decision = 'parry';
        else if (random() < (me.energy > 0.2 ? MIND.block : MIND.blockTired)) decision = 'block';
        else if (me.energy > 0.2) decision = 'dodge';
      } else if (me.guard && view.facing) decision = 'block';
      defence = {
        id: strike.id, decision,
        raiseAt: clock + Math.min(reaction, Math.max(0, strike.impactIn - 0.06)),
        parryAt: clock + strike.impactIn - pick(MIND.parryLead),
        until: clock + strike.impactIn + 0.16,
      };
    }
    if (defence && clock > defence.until && (!strike || strike.id !== defence.id)) defence = null;
    if (defence && defence.decision !== 'fail') {
      if (clock >= defence.raiseAt) {
        intent.guard = defence.decision !== 'dodge';
        if (defence.decision === 'parry' && clock >= defence.parryAt && !defence.pressed) { intent.parry = true; defence.pressed = true; }
        if (defence.decision === 'dodge' && !defence.pressed) {
          defence.pressed = true;
          intent.dash = strike?.unblockable ? { forward: -0.2, strafe: strafe } : { forward: -1, strafe: 0.3 * strafe };
        }
      }
      intent.forward = -0.15;
      if (intent.guard || intent.dash) return intent;
    }
    // The Force coming: sometimes it steps out of its way.
    if (hero.forcing && hero.forcing.releaseIn < 0.28 && !hero.forcing.dodged) {
      hero.forcing.dodged = true;
      if (me.energy > 0.25 && random() < MIND.dodgeForce) { intent.dash = { forward: 0, strafe }; return intent; }
    }

    // Still covering up after being parried or hit (unless the hero is wide open).
    if (clock < coverUntil && !hero.open && !hero.broken) { intent.guard = true; intent.forward = -0.3; intent.strafe = 0.3 * strafe; return intent; }
    // Stance: punish, recover, measure, press.
    // His guard broken: on him at once, and the deathblow as soon as he is in reach.
    if (hero.broken && view.distance < 5) { intent.forward = 1; if (view.distance < 3 && !me.busy) intent.attack = 'deathblow'; return intent; }
    if (stance !== 'recover' && (me.energy < MIND.recoverAt.energy || me.posture > MIND.recoverAt.posture) && !hero.open) {
      stance = 'recover'; plan = null;
    }
    if (stance === 'recover' && me.energy > MIND.recoveredAt.energy && me.posture < MIND.recoveredAt.posture) { stance = 'measure'; stanceUntil = clock + pick(MIND.measure); }
    if (clock > strafeUntil) { strafeUntil = clock + 0.8 + random() * 1.4; if (random() < 0.55) strafe = -strafe; }

    // An answer to a block or a parry: at once.
    if (clock >= riposteAt && !me.busy && view.distance < 2.3) {
      riposteAt = Infinity;
      plan = { steps: random() < 0.5 ? ['quick'] : ['quick', 'quick'], index: 0, nextAt: clock };
      stance = 'press';
    }
    // The Force: against a hero hiding behind his guard, or standing off out of reach.
    if (clock > forceUntil && !me.busy && me.energy > 0.5) {
      if (hero.guardTime > MIND.turtle && view.distance < 3.6 && random() < 0.5 * dt * 4) { intent.force = 'push'; forceUntil = clock + 6.5 + random() * 3; return intent; }
      if (view.distance > 4.3 && hero.idle && random() < 0.25 * dt * 4) { intent.force = 'pull'; forceUntil = clock + 4; return intent; }
    }

    if (stance === 'recover') {
      intent.forward = view.distance < MIND.distance.recover ? -1 : 0.1;
      intent.strafe = 0.5 * strafe;
      intent.guard = view.distance < 2.4 && hero.closing;
      return intent;
    }
    if (stance === 'measure') {
      const want = (MIND.distance.measure[0] + MIND.distance.measure[1]) / 2;
      intent.forward = Math.max(-1, Math.min(1, (view.distance - want) * 1.4));
      intent.strafe = 0.6 * strafe;
      intent.guard = view.distance < MIND.guardRange;
      if (clock > stanceUntil && me.energy > 0.4) { stance = 'press'; plan = { ...choosePattern(view), index: 0, nextAt: clock }; }
      return intent;
    }
    // Press: close in, then the pattern's steps with their beats.
    if (!plan) plan = { ...choosePattern(view), index: 0, nextAt: clock };
    if (view.distance > MIND.distance.strike + 0.15) {
      intent.forward = 1;
      intent.strafe = 0.2 * strafe;
      // From far, now and then a dash to close the gap.
      if (view.distance > 3.2 && me.energy > 0.6 && random() < 0.6 * dt) intent.dash = { forward: 1, strafe: 0 };
      return intent;
    }
    intent.forward = view.distance < 1.1 ? -0.4 : 0;
    // Between its strikes, the guard up.
    intent.guard = !me.busy && clock < plan.nextAt;
    if (clock >= plan.nextAt && (!me.busy || me.chainable)) {
      const step = plan.steps[plan.index];
      if (typeof step === 'number') { plan.nextAt = clock + step; plan.index++; }
      else if (step) {
        intent.attack = step === 'feint' ? 'quick' : step;
        intent.feint = step === 'feint';
        plan.index++;
        plan.nextAt = clock + (step === 'feint' ? 0.3 : 0.05);
      }
      if (plan.index >= plan.steps.length && step === undefined) {
        plan = null;
        stance = 'measure';
        stanceUntil = clock + pick(MIND.measure) * (me.energy < 0.5 ? 1.6 : 1);
      }
    }
    if (plan && plan.index >= plan.steps.length && !me.busy) {
      plan = null;
      stance = 'measure';
      stanceUntil = clock + pick(MIND.measure) * (me.energy < 0.5 ? 1.6 : 1);
    }
    return intent;
  }

  function notify(event) {
    if (event === 'parried') { riposteAt = random() < MIND.riposte.parried ? clock + pick(MIND.riposte.delay) * 0.5 : Infinity; }
    else if (event === 'blocked') { if (random() < MIND.riposte.blocked) riposteAt = clock + pick(MIND.riposte.delay); }
    else if (event === 'wasParried') { memory.parriedMe.push(clock); plan = null; stance = 'measure'; stanceUntil = clock + 0.5; coverUntil = clock + 0.85 + random() * 0.3; }
    else if (event === 'wounded') { plan = null; stance = 'recover'; coverUntil = clock + 1; }
    // It drew blood: a beat to let him get up, then on again.
    else if (event === 'hit') { plan = null; stance = 'measure'; stanceUntil = clock + 0.9 + random() * 0.6; }
    else if (event === 'bind') { plan = null; }
  }

  return {
    think, notify,
    get stance() { return stance; },
    get parryChance() { return parryChance(); },
    get memory() { return memory; },
  };
}
