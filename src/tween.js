/**
 * Easing curves and a small tween runner, for transitions and visual effects:
 * flashes, flares, hit stops, camera kicks, pose blends. Never for the flight
 * of thrown parts — that stays a physical simulation.
 */
const clamp01 = t => Math.min(1, Math.max(0, t));

export const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  // Overshoots, then settles: a snap with some give.
  outBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

/** Runs tweens: each maps its eased progress (0 → 1) onto whatever it animates. */
export function createTweens() {
  const list = [];
  return {
    add({ duration, delay = 0, curve = ease.outCubic, update, complete }) {
      const tween = { duration: Math.max(duration, 1e-4), delay, curve, update, complete, age: 0, done: false };
      list.push(tween);
      return tween;
    },
    /** Stops a tween where it stands (its complete() still runs). */
    cancel(tween) {
      if (!tween || tween.done) return;
      tween.done = true;
      tween.complete?.();
    },
    update(dt) {
      for (const tween of list) {
        if (tween.done) continue;
        tween.age += dt;
        if (tween.age < tween.delay) continue;
        const progress = clamp01((tween.age - tween.delay) / tween.duration);
        tween.update?.(tween.curve(progress), progress);
        if (progress >= 1) { tween.done = true; tween.complete?.(); }
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].done) list.splice(i, 1);
    },
    /** Finishes every tween at once (so each puts back what it borrowed). */
    clear() {
      for (const tween of list.splice(0)) if (!tween.done) { tween.update?.(tween.curve(1), 1); tween.complete?.(); }
    },
    get count() { return list.length; },
  };
}

/** A linear progress moved towards its target at a fixed pace; read it through an easing curve. */
export function approach(current, target, step) {
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * Time scale through a hit stop: nearly frozen for `hold` seconds, then eased
 * back to full speed over `recover` — a beat of slow motion, then the snap.
 */
export function hitStopScale(age, { hold, recover, floor = 0.04 }) {
  if (age < hold) return floor;
  return floor + (1 - floor) * ease.inOutSine(clamp01((age - hold) / recover));
}

/** A kick that hits at once and rings out: a damped oscillation, 0 at rest. */
export function kick(age, { duration = 0.3, frequency = 13 } = {}) {
  if (!(age < duration)) return 0;
  return Math.sin(2 * Math.PI * frequency * age) * (1 - ease.outQuad(clamp01(age / duration)));
}
