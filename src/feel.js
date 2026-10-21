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
    hold: 0.24, // s: B held this long through a strike calls the finisher
  },
  // Help finding the mark: a strike turns to the trooper nearest the stick's way and closes the gap.
  assist: {
    range: 3.2, // m: who a strike can lock on to
    cone: 0.95, coneIdle: 1.5, // rad, half-angles: about the stick's way, or about his facing with the stick at rest
    reach: 1.15, // m: how far from the target the blow is struck (centre to centre)
    step: 1.9, // m: the most a strike closes in
    lunge: 0.14, // s: the closing glide
    dashRange: 5, dashStep: 3.2, // after (or during) a dash: further
  },
  // The transformer in the corner: the blade run into it, the surge, the burst.
  sabotage: {
    reach: 1.5, // m from where he stands to run the blade in: the prompt shows, B held does it
    hold: 0.75, // s: B held this long — the blade drawn back, the tension building — and the thrust goes in
    stand: 1.05, angle: -0.6, // m before the arc window he stands to do it, rad aside (his sword side towards the view)
    surge: 1.45, // s from the blade going in to the burst
    spit: [1, 3.5], calm: 20, // s between spits of sparks once dead (less often after `calm` s)
    cascade: 0.75, // s for the blackout to run through the room's fittings (their sparks)
  },
  // The room in the dark once the power is cut.
  blackout: {
    night: { hemisphere: 0.46, sky: 0x2b3a58, ground: 0x09090d, rim: 0.36, environment: 0.12, background: 0x05070b },
    // Battery-backed: the cases' diodes and light strips, and the red panels on the floor, stay faintly on.
    keep: { 'white lights': 0.32, 'red diodes': 0.75, 'amber diodes': 0.6, 'warning panel': 0.45, 'warning glow': 0.35 },
    // The red drops and footprints in the dark: this share of their colour (a red-black), and how strong a light
    // (intensity / distance^decay) shows them as in the lit room.
    stains: { floor: 0.08, full: 28 },
    lamps: 5, // the troopers' rifle lamps that really light (the nearest); the others show their beam only
    shadows: 5, // of them, this many cast shadows (none lights through a crate)
    // The lamps: a warm white, wide and soft, a little glow round the lens lighting the man and what is near.
    lamp: { color: 0xffd6a0, intensity: 15, distance: 12, angle: 0.62, penumbra: 0.95, decay: 1.45, spill: 1.6, spillDistance: 3.2 },
    beam: { length: 4.4, radius: 1.35, level: 0.7, haze: 0.45 }, // m, m (at its end), brightness, how uneven the dusty air is (0 → 1)
    // The dust in the air, seen only in the beams: motes per m³ (at most cap); each wanders this far (m) round where it
    // hangs at these rates (rad/s) and twirls (rad/s, m); px; brightness; stirred within reach (m) this much, settling in s.
    dust: { density: 4.5, cap: 8000, wander: { reach: 0.3, rate: [0.08, 0.25] }, swirl: [0.4, 1.2], orbit: [0.03, 0.1], size: [1, 1.4], glow: 0.6, reach: 0.8, stir: 1.4, settle: 0.6 },
    onAfter: [0.7, 1.9], // s after the blackout before each trooper switches his lamp on
    // A dead man's lamp: on where it fell for a few seconds (s), then flickering out over this long (s), this many flashes a second at most.
    dying: { after: [3, 6], flicker: [0.9, 1.8], rate: 14 },
    sight: 4.5, saberSight: 9, // m: how far a trooper sees the hero in the dark — and when his blade is lit
  },
  // Red footprints: a foot coming down in red drops takes some of them up and
  // prints its sole on the next steps, fainter each time.
  prints: {
    radius: 0.26, // m round the sole where drops are trodden in (the sole and the splash of the step)
    take: 0.3, // share of the drops under the sole it takes away
    soak: 0.2, // how red the sole gets per drop trodden in (1: fully)
    dry: 0.66, // what is left after each print
    faint: 0.12, // under this, no more prints
    linger: [24, 32], fade: 4, // s before a print fades, s to fade
    hero: [0.3, 0.13], trooper: [0.33, 0.145], // m: sole length, width (a little generous, to read at the pixel size)
  },
  // How a blow goes to the next enemy (angles from where the hero faces, rad).
  choreography: {
    side: 0.85, // beyond this, a blow sweeping towards him, the blade leading
    behind: 1.95, // beyond this, a blow starting behind the hero's back
    thrust: 1.9, // m: this close (and nearly straight behind), the reverse thrust
    straight: 0.6, either: 0.35, // rad off straight behind: still a thrust; either way round for the turning cut
    lead: 0.6, maxLead: 1.2, // the blade turned towards the target this much of the way before the body
    turnUntil: 0.12, // the body's turn ends this long (fraction of the move) after the blade starts to cut
    near: 2.4, // m: with the stick at rest, an enemy this close behind him is struck too
  },
  // Presses kept this long while they cannot be taken yet (mid-strike, cooldowns).
  input: { buffer: 0.22 },
  sparks: {
    graze: [3, 16], // spark counts, picked at random for every hit
    cut: [26, 92],
    slash: [18, 60],
  },
  // A limb (an arm, a leg, the head) coming off: fewer sparks, and red drops
  // — fewer and a little bigger than the sparks — thrown out with the blade,
  // falling back fast, that stick where they land (floor, crates, walls) a
  // long while.
  severed: {
    sparks: 0.75, // share of a cut's usual sparks
    red: [9, 15], // drops in the spray
    size: [2.5, 3.4], // px (sparks are 1.7–2.3)
    speed: 0.9, // share of the blade's speed they are thrown with
    lift: [0.6, 2.4], // m/s: thrown up a little as well
    gravity: 15, // m/s² (sparks: 9.8): they come back down fast
    // On a wall or a crate's side a drop runs down for a few seconds, slowing,
    // leaving a red trail behind it (and losing its volume to it); it may
    // reach the floor and pool there.
    run: [1.8, 3.6], // s it runs at most
    runSpeed: [0.12, 0.32], // m/s at the start (bigger drops faster)
    trail: 0.02, // m between two specks of its trail
    // How much a severed part sprays, by the joint cut (the drops' count and the drip from the cut):
    // the head and the body a lot, a hand or a foot a little.
    parts: { neck: 2.1, waist: 2.5, shoulder: 1.35, hip: 1.45, elbow: 0.85, knee: 0.9, wrist: 0.45, ankle: 0.5 },
    drip: [0.6, 1], // s: a few drops still fall from the cut after
    linger: [24, 32], // s stuck where they landed before they fade
    fade: 4, // s to fade out
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
    dodge: 0.08, // s after it during which bolts still pass through him (and all through it)
    strike: 0.22, // s after it a press of B still makes a lunging dash strike
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
    held: 0.75, // the guard merely held: at best this share of returns go back at the shooter
    // The perfect parry: the guard pressed this long (s) or less before the bolt
    // meets the blade sends it straight back into its shooter, from any range.
    perfect: 0.2,
    chain: 0.32, // s: after one, the next bolts this soon after are perfect too (the rest of the burst)
    mash: 0.35, // s: a press this soon after the last one opens no window (no mashing)
    perfectSpeed: 1.75, // the perfect return flies faster still
    perfectStop: [0.05, 0.16], // its beat of slow motion: hold, recover
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
  // Die and retry (god mode off): one mistake and he is dead — a bolt through him, a grenade at his feet.
  death: {
    blast: 2.4, // m: a grenade this close kills him (further, it throws him off his feet and he gets up)
    blastThrow: 1.25, // the blast throws his body this much harder than it knocks him down alive
    bolt: { push: 1.4, lift: 0.4, spin: 1.1, hit: 4.5 }, // m/s, m/s, rad/s, and m/s on the part hit
    slow: [0.08, 1.3], // s: the moment held, then the slow motion easing back
    show: 0.9, retry: 0.7, // s before "MORT" shows, and before a press can start again
    bleed: { bolt: 1.7, blast: 2.8 }, // how much he sprays (as a cut limb's spray)
    drip: [3.5, 5], // s his body keeps bleeding as it falls and lies
    pool: { after: 0.9, size: [0.45, 0.7], spread: [4, 6] }, // s (slowed time) after he falls, it starts under him: m across at most, s to spread
    wound: {
      bolt: { specks: [10, 15], spread: 0.04, size: [1.6, 2.8], char: 0.35 },
      blast: { specks: [6, 11], spread: 0.055, size: [1.4, 2.6], char: 0.12, count: [5, 8] },
    },
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
    hide: [0.3, 0.75], // s crouched behind cover between bursts
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
    windup: 0.32, // s the aim takes to settle before a burst (the glint at the muzzle)
    // The squad as a team.
    movers: 0.4, // share of the squad that may move at once under fire (the others cover them)
    stagger: 0.3, // s at least between two bursts starting
    suppress: 3, // s out of sight during which the anchors keep the hero pinned where he hides
    spread: [4.5, 6], // m from the Jedi: where they spread out to when he is among them
    panic: 8, fallback: 4, fallbackRange: [7, 11], // so many lost within this many s: they fall back (s) to covers this far (m)
  },
};

export const curve = name => ease[name] ?? ease.outCubic;
/** A value from a [min, max] range (or the value itself). */
export const pick = (range, random = Math.random) => (Array.isArray(range) ? range[0] + (range[1] - range[0]) * random() : range);
