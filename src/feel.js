import { ease } from './tween.js';

/**
 * Game feel: every tunable of the fight in one place — timings, strengths,
 * easing curves, chances, ranges [min, max] picked at random so that no two
 * interactions are quite alike. Values are read each time they are used, so
 * they can be tweaked live from the console: window.__STARWARD__.feel.
 */
export const FEEL = {
  attacks: {
    tempo: 0.86, // strike durations are scaled by this: lower is snappier
    memory: 4, // moves used this recently are avoided, so combos never loop
  },
  sparks: {
    graze: [3, 16], // spark counts, picked at random for every hit
    cut: [26, 92],
    slash: [18, 60],
  },
  hitStop: {
    // At most one per enemy and per attack sequence: [hold, recover] seconds.
    cut: [0.02, 0.05],
    felling: [0.032, 0.075],
  },
  camera: { kick: 0.04, kickFelling: 0.065, punch: 0.012, kickPush: 0.07, punchPush: 0.02 },
  force: {
    // When the power leaves the hand, as a fraction of the gesture.
    pushAt: 0.42,
    pullAt: 0.3,
  },
  hit: {
    knockback: 3.4, // m/s per unit of blow: a hit shoves a standing trooper back
    spin: 2.6, // rad/s per unit of blow: and turns him away from it
    carry: 0.38, // share of the blade's speed a felled body carries away
    maxCarry: 4.5, // m/s
    slide: 1.3, // seconds the floor stays slippery under a felled body
  },
  pull: {
    range: 8.5, cone: 0.75, // metres, half-angle (rad) of the cone of aim
    duration: [0.4, 0.52], curve: 'outSnap', // explosive start, slowing right down on arrival
    topSpeed: 24, // m/s: a long pull takes a little longer rather than teleporting
    stop: 1.15, // how far in front of the hero he lands
    lift: [0.18, 0.34], spin: 0.6,
    dropChance: 0.55, fallChance: 0.22,
    // Held (LT kept down): he hangs in the air before the hero, following him.
    hold: { distance: 1.25, height: 0.5, follow: 9, bob: 0.05 },
  },
  flee: {
    speed: [3.2, 4], time: [1.2, 1.9], stride: 1.3, // m/s, seconds, metres per running cycle
  },
  push: {
    range: 5.8, cone: 0.95,
    speed: [6, 8.5], lift: [2.4, 3.6], tumble: [2, 5], // m/s, m/s, rad/s
    falloff: 0.55, // what is left of the push at full range
    friction: 0.05, bounce: 0.34, // on the floor while he is thrown: slides, rolls, bounces
  },
  recovery: {
    stun: [0.5, 1.5], // lying dazed after the fall
    rise: [0.95, 1.3], riseCurve: 'inOutCubic', // getting up, from a crouch
    daze: [0.9, 1.6], // swaying once up
    pickup: 0.7, reach: 1.7, // fetching his rifle if it lies close enough
  },
  armor: {
    graze: 0.45, slash: 1, cut: 0.6, landing: 0.4, landingSpeed: 3.6, // chances; impact speed (m/s)
  },
};

export const curve = name => ease[name] ?? ease.outCubic;
/** A value from a [min, max] range (or the value itself). */
export const pick = (range, random = Math.random) => (Array.isArray(range) ? range[0] + (range[1] - range[0]) * random() : range);
