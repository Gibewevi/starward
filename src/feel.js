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
    maxKnock: 2.6, // m/s: never more, however many parts one swing touches (about half a metre of slide)
    spin: 2.6, // rad/s per unit of blow: and turns him away from it
    carry: 0.38, // share of the blade's speed a felled body carries away
    maxCarry: 3.4, // m/s
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
  // Reinforcements through the great door.
  reinforce: {
    first: 22, // s before the first wave
    interval: [26, 36], // s between waves
    wave: [3, 4], // troopers a wave
    cap: 9, // never more than this many standing
    few: 2, soon: 5, // this few left standing: the next wave within this many seconds
    alarm: 1.6, // s of blinking lamp and alarm before the door opens
    spacing: 0.85, // s between men coming out
    linger: 1.6, // s the door stays open after the last one
    bodies: 14, // troopers kept at most, dead ones included: the oldest bodies are cleared
  },
  // Y / Space: a lightning dash along the stick (or straight ahead).
  dash: {
    speed: 14, // m/s at the start, easing off: about 2.5 m in all
    duration: 0.19, // s
    cooldown: 0.45, // s before the next one
    carry: 0.3, // share of its speed he keeps when it ends
  },
  flee: {
    speed: [3.2, 4], time: [1.2, 1.9], stride: 1.3, // m/s, seconds, metres per running cycle
  },
  // LT and B held, a trooper before the hero: the blade goes through him.
  impale: {
    press: 0.16, // s: B held this long (LT down) runs him through; a quicker tap still strikes
    reach: 1.8, cone: 0.8, // metres, half-angle (rad): who can be run through
    depth: 0.72, // m along the blade from the hilt: where his chest sits on it
    struggle: [2.2, 3.2], // s: he fights on the blade, weaker and weaker, then dies there
    hitStop: [0.12, 0.14], // the blade going in
    gush: [0.05, 0.11], // s between spurts of sparks while he struggles
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
    miss: 0.3, // share of shots that go wide (near misses that whizz past)
    burst: [3, 5], gap: [0.09, 0.15], // shots per burst; seconds between shots
    firing: 3, // troopers shooting at the same moment, at most
  },
  deflect: {
    reach: 0.9, // m: the blade meets a bolt this far from his chest
    near: 1.45, // m: a bolt passing this close is caught too, from any side (behind his back as well)
    react: 0.17, // s: the parry starts this long before the bolt arrives
    reactBack: 0.26, // s: the same from behind (the blade has to go over his shoulder and down his back)
    blade: 0.32, // m: a bolt from behind is stopped where it passes this close to the blade down his back…
    body: 0.6, // m: …or, the blade being behind him, before it gets this close to his chest
    // m from the shooter: this close, a return goes straight back at him; this
    // far, it glances off the blade at random. In between, ever less sure.
    close: [3, 12],
    yaw: [0.25, 1.55], lift: [-0.22, 0.5], // scatter (rad) of a return left to chance: either side, into the floor or up
    speedUp: 1.3, // a sent-back bolt flies faster
    precision: { start: 0.1, gain: 0.003, hitGain: 0.006, max: 0.95, bonus: 0.12 }, // training: grows per deflection, more per hit; adds at most `bonus` to the chance
    error: 0.16, // rad: aim error of an aimed return made from far off (none close by)
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
    startle: [0.18, 0.32], // s from "!" to acting on it
    hide: [0.35, 0.9], // s crouched behind cover between bursts
    cycles: [2, 3], // bursts from one cover (or one stop in the open) before moving on
    range: [4.5, 9], // m from the hero a good cover lies (anchors)
    flankRange: [3.5, 7], // m: the same for a flanker, at the hero's side
    advance: 4.5, // m: how close a rusher comes before he stops to fire
    close: 2.4, // m: closer than this, he backs away
    pursue: 1, // s out of sight before they go after him
    search: 7, // s out of sight before they search where he was last seen
    kneel: 0.5, // chance he kneels to fire in the open (else he stands)
    blind: 0.35, // chance, behind a low crate, of a blind burst over it
    blindBurst: [5, 8], blindGap: [0.06, 0.1], blindSpread: 0.16, // shots, s between them, rad of scatter
  },
};

export const curve = name => ease[name] ?? ease.outCubic;
/** A value from a [min, max] range (or the value itself). */
export const pick = (range, random = Math.random) => (Array.isArray(range) ? range[0] + (range[1] - range[0]) * random() : range);
