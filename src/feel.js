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
    // Once per enemy and per strike: [hold, recover] seconds. The action
    // freezes for the hold, then eases back to speed.
    blow: [0.055, 0.07], // the blade bites without cutting through
    cut: [0.075, 0.08],
    felling: [0.1, 0.12],
  },
  camera: { kick: 0.04, kickFelling: 0.065, punch: 0.012, kickPush: 0.07, punchPush: 0.02 },
  force: {
    // When the power leaves the hand, as a fraction of the gesture.
    pushAt: 0.42,
    pullAt: 0.3,
  },
  hit: {
    toughness: 1, // blade blows a standing trooper takes (burnt, staggered) before the blade cuts him apart
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
    pickup: 0.7, reach: 3, // he walks over to his rifle if it lies this close (m), and picks it up
  },
  armor: {
    graze: 0.45, slash: 1, cut: 0.6, landing: 0.4, landingSpeed: 3.6, // chances; impact speed (m/s)
  },
  blaster: {
    speed: 12.5, // m/s: fast, yet readable and deflectable
    spread: 0.035, // rad: the aim's scatter on a shot meant to hit
    miss: 0.35, // share of shots that go wide (near misses that whizz past)
    burst: [2, 4], gap: [0.13, 0.24], // shots per burst; seconds between shots
    firing: 2, // troopers shooting at the same moment, at most
  },
  deflect: {
    reach: 0.9, // m: the blade meets a bolt this far from his chest
    near: 1.45, // m: a bolt passing this close is caught too, from any side (behind his back as well)
    react: 0.17, // s: the parry starts this long before the bolt arrives
    close: [2.5, 9], // m from the shooter: the closer the hero, the likelier the return goes back at him
    yaw: [0.15, 0.9], lift: [-0.04, 0.18], // scatter (rad) of a return left to chance
    speedUp: 1.3, // a sent-back bolt flies faster
    precision: { start: 0.1, gain: 0.003, hitGain: 0.006, max: 0.95 }, // chance a return goes for an enemy: grows per deflection, more per hit
    error: 0.14, // rad: aim error of such a return at zero precision (none at full)
  },
  senses: {
    sight: 11, cone: 1.05, peripheral: 1.75, // m; half-angles (rad): full view, corner of the eye
    notice: 1.1, // seconds to spot the hero in full view, close by
    suspicious: 0.3, // awareness that raises a "?"
    forget: 0.1, // awareness lost per second without news
    callout: 10, // m: a trooper who spots the hero alerts his squad this far
  },
  grenade: {
    squadCooldown: 6, cooldown: 12, // s between grenades, for the squad and for each trooper
    range: [3.5, 11], // m from the hero
    safe: 2.6, // m: never onto a squadmate this close to the target
    chance: 0.16, chanceHidden: 0.5, // at each pause behind cover (the hero out of sight: more likely)
    fuse: [1.9, 2.4], // s
    reach: 3.4, // m: the red circle on the floor
  },
  blast: {
    radius: 4.6, // m: bodies are thrown within this
    speed: [5.5, 8.5], lift: [3.2, 5.2], tumble: [3, 7], // at point blank: m/s, m/s, rad/s
    lethal: 0.9, // m: a trooper this close does not survive it
    knock: 2.9, // m: the hero is knocked off his feet this close; further, he staggers
    shake: 0.42, kick: 0.09, punch: 0.035, // camera
  },
  ai: {
    startle: [0.28, 0.5], // s from "!" to acting on it
    hide: [0.7, 1.7], // s crouched behind cover between bursts
    cycles: [2, 4], // bursts from one cover before moving to another
    range: [4, 8.5], // m from the hero a good cover lies
    close: 2.6, // m: closer than this, he backs away
  },
};

export const curve = name => ease[name] ?? ease.outCubic;
/** A value from a [min, max] range (or the value itself). */
export const pick = (range, random = Math.random) => (Array.isArray(range) ? range[0] + (range[1] - range[0]) * random() : range);
