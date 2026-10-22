import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { PACE } from './stormtrooper.js';

/**
 * The squad's minds. Each trooper sees — a cone in front of him, wider but
 * weaker at the corner of his eye, blocked by crates — and hears: footsteps
 * at a run, the blade, blows, the Force, shots. What he senses fills his
 * awareness: past a little he is suspicious ("?"): he stops, turns towards
 * it, then goes to have a look, rifle up; full, he has spotted the hero
 * ("!"): he flinches, calls it out on the radio, and fights.
 *
 * They fight as a team, under a plan the squad leader revises four times a
 * second (coordinate()):
 * - parts by distance to the hero: the one nearest rushes him, two swing
 *   round his flanks — one each side —, the rest hold cover;
 * - bounding overwatch: under fire, only some of them move at a time (to a
 *   new cover, closer in, round his side); the others stay where they are
 *   and fire to cover them, their bursts staggered so the pressure never
 *   lets up and never all comes at once;
 * - the hero gone behind cover: the anchors keep him pinned with a burst at
 *   where he hides while the rusher and the flankers work round to him;
 * - the Jedi among them: the man he goes for backs away firing from the hip,
 *   the others nearby spread out round him to catch him in a crossfire;
 * - too many lost too fast: they fall back to covers further off;
 * - a man down, a grenade, a move, covering fire, contact lost: they say so
 *   on the radio (cues the game turns into chatter);
 * - a man down and hurt (a bolt in the body): the nearest free squadmate
 *   runs to him — unless the Jedi stands over him —, drags him by the collar
 *   behind a crate near by, kneels and treats him for a few seconds, and both
 *   get up. The Jedi coming at him, he drops it all, up and firing (rescue()).
 *
 * An anchor runs to cover (a crate between him and the hero, at a good
 * range, not taken by a squadmate, away from the others' line), crouches,
 * comes up — standing behind the crate, leaning out past it, or holding his
 * rifle up over it for a blind burst — takes aim (a glint at his muzzle says
 * a burst is coming: `charge`), fires, ducks back; after a few bursts, or as
 * soon as the hero flanks him, he moves on. A rusher closes in, then kneels
 * or stands to fire, and closes in again; a flanker does the same from his
 * side. Moving close to the hero they keep their rifles on him, walking;
 * further off they run. Disarmed: he runs for his rifle. Nobody fires
 * through a squadmate, nor into his own cover.
 *
 * With a navigation grid (nav.js) they find their way round the crates and
 * walls; whoever stops moving while trying to steps aside and finds another
 * way, or another plan.
 *
 * update(dt, { hero, noises }) writes each trooper's orders and returns the
 * shots fired and the moments worth a sound: { shots, cues }.
 */
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const flat = vector => vector.clone().setY(0);
// Heights: the hero's chest and head; the muzzle of a shouldered rifle (a little low, to be safe).
const CHEST = 1.05, HEAD = 1.55, MUZZLE = 1.1;
const UP = new THREE.Vector3(0, 1, 0);
// Parts in a fight, nearest the hero first (a lone trooper holds cover; two, one of them flanks).
const ROLES = ['rusher', 'flanker', 'anchor', 'flanker', 'anchor'];
const rolesFor = count => (count === 1 ? ['anchor'] : count === 2 ? ['flanker', 'anchor'] : ROLES);
// Moves that need the squad's leave under fire (someone must be covering).
const MOVING = new Set(['move', 'advance', 'pursue']);
// Busy with something that should not be cut short by a new plan.
const COMMITTED = new Set(['throw', 'fire', 'blindUp', 'evade', 'spread']);

export function createSquadMind({ troopers, lab, nav = null, alerts = null, posts = [], random = Math.random, cameraRight = new THREE.Vector3(1, 0, 0) }) {
  const minds = troopers.map((trooper, index) => ({ trooper, post: posts[index] ?? {} }));
  // Who is going to whom: a man down and hurt → his rescuer's mind.
  const rescuers = new Map();
  let firing = 0, grenadeClock = Infinity, clock = 0, tick = 1 / 60, roleClock = Infinity, dark = 0;
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3();
  // The squad leader's plan (coordinate()).
  const plan = {
    clock: 0, movers: new Set(), threat: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), seen: false, fighting: 0,
    scatter: false, fallback: 0, losses: [], lastBurst: -Infinity, lastFire: -Infinity, coverCall: Infinity, lost: false,
  };

  /** A mind as at the start: calm, at his post. */
  function fresh(mind) {
    const { trooper, post } = mind;
    Object.assign(mind, {
      mode: 'calm', awareness: 0, interest: null, lastKnown: new THREE.Vector3(), seen: Infinity, sees: false,
      tactic: null, timer: 0, cover: null, previousCover: null, burst: 0, gap: 0, cycles: 0, maxCycles: 3, token: false,
      startle: 0, callout: null, routeIndex: 0, wait: 0, strafe: random() < 0.5 ? 1 : -1, step: 0, glance: 0, heard: 0,
      aimPoint: new THREE.Vector3(), progress: { at: new THREE.Vector3(), time: 0 }, searchTime: 0, side: 1, grenadeClock: Infinity, thrown: false,
      home: (post.position ?? trooper.root.position).clone(), homeHeading: post.heading ?? trooper.heading, route: post.route ?? null,
      role: null, path: null, stance: 'stand', detour: 0, detourSide: new THREE.Vector3(), stuck: { at: new THREE.Vector3(), time: 0, stamp: -1 }, stuckCount: 0, advanceTo: null,
      entering: null, dir: null,
      // The fight: the aim before a burst (charge 0 → 1), his flank, what went wrong lately.
      charge: 0, windup: 0, windupTotal: 1, flankSide: 0, noBlind: 0, aimFails: 0, coverTime: 0, suppressed: false, suppressing: false, fellBack: false, spreadTo: null, mourned: false, reposition: false,
      spreadAgain: 0, plans: 0, rescue: null, rescueReady: 0,
    });
  }
  function reset() {
    firing = 0;
    grenadeClock = Infinity;
    roleClock = Infinity;
    Object.assign(plan, { movers: new Set(), seen: false, fighting: 0, scatter: false, fallback: 0, losses: [], lastBurst: -Infinity, lastFire: -Infinity, coverCall: Infinity, lost: false });
    for (const mind of minds) fresh(mind);
    rescuers.clear();
    alerts?.clear();
  }
  /**
   * A newcomer: marched in along `entering` (points), then on his own — into
   * the fight at once if the squad is fighting, else calm at his post.
   */
  function add(trooper, post = {}, { entering = null } = {}) {
    if (!troopers.includes(trooper)) troopers.push(trooper);
    const mind = { trooper, post };
    fresh(mind);
    mind.entering = entering?.map(point => point.clone()) ?? null;
    mind.threshold = mind.entering?.[0]?.clone() ?? null;
    minds.push(mind);
    return mind;
  }
  /** Out of the squad for good (a body cleared away). */
  function remove(trooper) {
    const index = minds.findIndex(mind => mind.trooper === trooper);
    if (index >= 0) { endRescue(minds[index]); release(minds[index]); plan.movers.delete(minds[index]); alerts?.hide(trooper); minds.splice(index, 1); }
    const at = troopers.indexOf(trooper);
    if (at >= 0) troopers.splice(at, 1);
  }
  /** Marching in through the door, rifle at low ready; at the end of the way (or too long on it), his own man. */
  function march(mind, cues) {
    const t = mind.trooper, o = t.order, next = mind.entering[0];
    const to = flat(next).sub(flat(t.root.position)), distance = to.length();
    mind.marching = (mind.marching ?? 0) + tick;
    // The squad is fighting: through the door and a few steps in, he goes straight into it.
    const fighter = minds.find(other => other.mode === 'combat' && other !== mind && !other.trooper.dead);
    const inside = mind.threshold && mind.entering[0] !== mind.entering.at(-1) ? false : !mind.threshold || flat(t.root.position).distanceTo(flat(mind.threshold)) > 1.2;
    if (fighter && inside && t.free) {
      mind.entering = null;
      mind.lastKnown.copy(fighter.lastKnown);
      alert(mind, cues);
      return;
    }
    if (distance < 0.3 || mind.marching > 8) {
      mind.entering.shift();
      if (mind.marching > 8) mind.entering.length = 0;
      if (!mind.entering.length) {
        mind.entering = null;
        if (fighter) { mind.lastKnown.copy(fighter.lastKnown); alert(mind, cues); }
      }
      return;
    }
    o.velocity.copy(to.divideScalar(distance)).multiplyScalar(PACE.run * 0.8);
    // In file, not on each other's heels.
    for (const other of troopers) {
      if (other === t || other.fallen) continue;
      const away = flat(t.root.position).sub(flat(other.root.position)), gap = away.length();
      if (gap < 0.8 && gap > 1e-4 && away.dot(o.velocity) < 0) o.velocity.multiplyScalar(Math.max(0.15, gap / 0.8));
      else if (gap <= 1e-4) o.velocity.multiplyScalar(0.5);
    }
    o.face = headingTo(t.root.position, next);
  }
  reset();

  // ---- Senses --------------------------------------------------------------
  function perceive(mind, dt, hero, heroSpeed, saber, noises, cues) {
    const t = mind.trooper, senses = FEEL.senses;
    const chest = temp.copy(hero).setY(CHEST), head = temp2.copy(hero).setY(HEAD);
    let sees = false, rate = 0;
    if (t.free) {
      const eye = t.eye;
      const to = flat(chest).sub(flat(eye)), distance = to.length();
      const facing = new THREE.Vector3(Math.sin(t.heading), 0, Math.cos(t.heading));
      const angle = facing.angleTo(to);
      // In the dark he sees only so far — further the hero's lit blade, and down his own lamp's beam.
      const b = FEEL.blackout, range = dark < 0.5 ? senses.sight : angle < 0.4 ? Math.max(8.5, saber > 0.5 ? b.saberSight : 0) : saber > 0.5 ? b.saberSight : b.sight;
      if (distance < range) {
        // Once he has seen the hero, he keeps track of him all around.
        const tracking = mind.mode === 'combat' && mind.seen < 1.5;
        // Right next to him, he feels someone there even behind his back.
        const field = tracking ? 1 : angle < senses.cone ? 1 : angle < senses.peripheral ? 0.35 : distance < 1.8 ? 0.5 : 0;
        if (field > 0 && (lab.clear(eye, chest) || lab.clear(eye, head))) {
          sees = true;
          // Closer, moving faster, blade lit: noticed sooner.
          rate = field * (1 - distance / range) ** 0.6 / senses.notice * (1 + Math.min(heroSpeed, 4.5) / 4.5 * 0.6 + saber * 0.3);
        }
      }
    }
    mind.sees = sees;
    if (sees) {
      mind.seen = 0;
      mind.awareness = mind.mode === 'combat' ? 1 : mind.awareness + rate * dt;
      mind.interest = flat(hero);
      if (mind.awareness >= 1) mind.lastKnown.copy(hero).setY(0);
    } else mind.seen += dt;
    // Hearing: louder and nearer counts more; violence close by is an alarm.
    mind.heard = Math.max(0, mind.heard - dt);
    for (const noise of noises) {
      const distance = flat(noise.position).distanceTo(flat(t.root.position));
      if (distance > noise.radius || noise.source === t) continue;
      const loud = (1 - distance / noise.radius) * (noise.strength ?? 1);
      if (mind.mode !== 'combat') {
        mind.awareness = Math.min(noise.alarm ? 1 : 0.92, mind.awareness + loud * 0.55);
        mind.interest = flat(noise.position);
        if (noise.alarm && loud > 0.3) mind.lastKnown.copy(noise.from ?? noise.position).setY(0);
      } else if (!sees && noise.from && loud > 0.2) mind.lastKnown.copy(noise.from).setY(0);
      if (mind.heard <= 0 && t.free) {
        mind.heard = 0.6;
        alerts?.sound(t, temp.subVectors(noise.position, t.root.position).dot(cameraRight));
      }
    }
    // A squadmate's call.
    if (mind.callout && (mind.callout.delay -= dt) <= 0) {
      const at = mind.callout.at;
      mind.callout = null;
      if (mind.mode !== 'combat' && t.free) { mind.lastKnown.copy(at); alert(mind, cues, { quiet: true }); }
    }
    if (!sees && mind.mode !== 'combat') mind.awareness = Math.max(0, mind.awareness - senses.forget * dt);
    // Moods.
    if (mind.awareness >= 1 && mind.mode !== 'combat' && t.free) alert(mind, cues);
    else if (mind.mode === 'calm' && mind.awareness >= senses.suspicious && t.free) {
      mind.mode = 'suspicious';
      mind.timer = 0;
      mind.glance = 0;
      alerts?.show(t, '?');
      cues.push({ type: 'suspicious', trooper: t });
      t.reaction.vhead -= 1.2;
    } else if ((mind.mode === 'suspicious' || mind.mode === 'searching') && mind.awareness < 0.1) calm(mind);
  }
  /** Contact: he flinches and calls it out (quiet: told by a squadmate, he only turns to it). */
  function alert(mind, cues, { quiet = false } = {}) {
    const t = mind.trooper;
    const fresh = mind.mode !== 'combat';
    mind.mode = 'combat';
    mind.awareness = 1;
    mind.tactic = null;
    mind.searchTime = 0;
    mind.startle = pick(FEEL.ai.startle, random) * (quiet ? 0.6 : 1);
    plan.lost = false;
    alerts?.show(t, '!', { hold: 1.4 });
    if (!fresh) return;
    cues.push({ type: quiet ? 'joined' : 'alert', trooper: t });
    // The flinch: head and shoulders jerk as he sees the hero.
    t.reaction.vhead -= 3;
    t.reaction.vpitch -= 1.4;
    t.reaction.vbuckle += 0.8;
    // He calls it out; the squad turns towards the threat.
    for (const other of minds) {
      if (other === mind || other.mode === 'combat' || other.trooper.dead) continue;
      if (other.trooper.root.position.distanceTo(t.root.position) > FEEL.senses.callout) continue;
      other.callout ??= { delay: 0.3 + random() * 0.6, at: mind.lastKnown.clone() };
    }
  }
  function calm(mind) {
    mind.mode = 'calm';
    mind.awareness = 0;
    mind.interest = null;
    mind.tactic = null;
    alerts?.hide(mind.trooper);
  }

  // ---- The squad's plan --------------------------------------------------------
  /** Fighters: in the fight, alive, in the room. */
  const fighting = () => minds.filter(mind => mind.mode === 'combat' && !mind.trooper.dead && !mind.trooper.impaled && !mind.entering);
  function coordinate(hero, cues) {
    assignRescues(hero, cues);
    const fighters = fighting();
    plan.fighting = fighters.length;
    if (!fighters.length) { plan.movers.clear(); plan.scatter = false; return; }
    plan.seen = fighters.some(mind => mind.sees);
    // Where the squad thinks he is: in sight, or the freshest sighting.
    if (plan.seen) plan.threat.copy(hero).setY(0);
    else {
      let best = fighters[0];
      for (const mind of fighters) if (mind.seen < best.seen) best = mind;
      plan.threat.copy(best.lastKnown).setY(0);
    }
    // Leave to move goes back once the move is over.
    for (const mind of plan.movers) if (!fighters.includes(mind) || !MOVING.has(mind.tactic)) plan.movers.delete(mind);
    // The line from him to the squad: flankers take one side each.
    const centre = fighters.reduce((sum, mind) => sum.add(flat(mind.trooper.root.position)), new THREE.Vector3()).divideScalar(fighters.length);
    plan.axis.copy(centre).sub(plan.threat).setY(0);
    if (plan.axis.lengthSq() < 1e-4) plan.axis.set(1, 0, 0);
    plan.axis.normalize();
    for (const mind of fighters) {
      if (mind.role !== 'flanker') { mind.flankSide = 0; continue; }
      if (mind.flankSide) continue;
      const across = flat(mind.trooper.root.position).sub(plan.threat);
      const own = Math.sign(plan.axis.x * across.z - plan.axis.z * across.x) || 1;
      mind.flankSide = fighters.some(other => other !== mind && other.role === 'flanker' && other.flankSide === own) ? -own : own;
    }
    // The Jedi among them: they scatter round him.
    plan.scatter = plan.seen && fighters.some(mind => flat(mind.trooper.root.position).distanceTo(plan.threat) < FEEL.ai.close + 0.8);
    // Too many lost too fast: they fall back.
    plan.losses = plan.losses.filter(at => clock - at < FEEL.ai.panic);
    if (plan.fallback <= 0 && plan.losses.length >= Math.max(2, Math.ceil((fighters.length + plan.losses.length) / 2))) {
      plan.fallback = FEEL.ai.fallback;
      plan.losses.length = 0;
      for (const mind of fighters) if (!COMMITTED.has(mind.tactic)) { release(mind); mind.tactic = null; mind.fellBack = false; }
      const speaker = fighters[Math.floor(random() * fighters.length)];
      cues.push({ type: 'radio', radio: 'move', trooper: speaker.trooper });
    }
    // Someone moving under fire: a squadmate who stays calls the covering fire.
    if (clock >= plan.coverCall) {
      plan.coverCall = Infinity;
      const coverer = fighters.find(mind => !plan.movers.has(mind) && mind.sees && mind.trooper.holding);
      if (coverer) cues.push({ type: 'radio', radio: 'cover', trooper: coverer.trooper });
    }
  }
  /** Leave to move: under fire, only some at a time (the others cover them). */
  function claimMove(mind, cues) {
    if (plan.movers.has(mind)) return true;
    // Those who have him in sight cover; one who cannot see him is free to move and find him.
    const most = Math.max(1, Math.round(plan.fighting * FEEL.ai.movers));
    if (plan.seen && mind.sees && plan.movers.size >= most) return false;
    plan.movers.add(mind);
    if (plan.seen && plan.fighting > 1 && random() < 0.6) {
      cues.push({ type: 'radio', radio: mind.role === 'flanker' ? 'flank' : 'move', trooper: mind.trooper });
      plan.coverCall = Math.min(plan.coverCall, clock + 0.9);
    }
    return true;
  }

  // ---- A man down -----------------------------------------------------------
  /** Where a body lying on the floor is (its chest, on the floor). */
  const chestOf = body => body.particle('N').position.clone().lerp(body.particle('W').position, 0.45).setY(0);
  /** A man down and hurt: the nearest free squadmate goes to him — not while the Jedi stands over him. Nobody left: he bleeds out. */
  function assignRescues(hero, cues) {
    const R = FEEL.rescue;
    for (const patient of troopers) {
      if (!patient.hurt) { rescuers.delete(patient); continue; }
      const current = rescuers.get(patient);
      if (current?.rescue?.patient === patient) continue;
      rescuers.delete(patient);
      const able = minds.filter(mind => mind.trooper !== patient && !mind.trooper.dead && !mind.trooper.hurt);
      if (!able.length) { patient.abandon(); continue; }
      const at = chestOf(patient);
      if (at.distanceTo(flat(hero)) < R.safe) continue;
      let best = null, bestDistance = R.range;
      for (const mind of able) {
        const t = mind.trooper;
        if (mind.mode === 'dead' || mind.rescue || !t.free || mind.entering || COMMITTED.has(mind.tactic) || clock < mind.rescueReady) continue;
        if (flat(t.root.position).distanceTo(flat(hero)) < R.threat + 1) continue;
        const distance = flat(t.root.position).distanceTo(at);
        if (distance < bestDistance) { bestDistance = distance; best = mind; }
      }
      if (!best) continue;
      // A man shot down beside him is an alarm in itself: the shot came from the Jedi.
      if (best.mode !== 'combat') { best.lastKnown.copy(hero).setY(0); alert(best, cues, { quiet: true }); }
      release(best);
      plan.movers.delete(best);
      best.tactic = null;
      best.rescue = { patient, stage: 'go', clock: 0, to: null, treat: 0, pulse: 0 };
      rescuers.set(patient, best);
      cues.push({ type: 'radio', radio: 'cover', trooper: best.trooper });
    }
  }
  /** Behind a crate near the man down, out of the Jedi's sight: where to drag him (null: treated where he lies). */
  function haven(patient, hero) {
    const R = FEEL.rescue, from = chestOf(patient);
    let best = null, bestScore = Infinity;
    for (const spot of lab.coverSpots(hero, { minDistance: 2.5 })) {
      const distance = spot.position.distanceTo(from);
      if (distance > R.haven) continue;
      if (minds.some(other => other.cover && !other.trooper.dead && other.cover.position.distanceTo(spot.position) < 0.9)) continue;
      const score = distance + (spot.position.distanceTo(flat(hero)) < 4 ? 5 : 0);
      if (score < bestScore) { bestScore = score; best = spot.position; }
    }
    if (!best || best.distanceTo(from) < 0.6) return null;
    // He backs up past the spot, so that the man he drags ends on it.
    let to = best.clone().addScaledVector(best.clone().sub(from).normalize(), 0.7);
    if (nav) to = nav.walkable(to) ? to : nav.nearest(to) ?? best.clone();
    return to;
  }
  function endRescue(mind) {
    const r = mind.rescue;
    if (!r) return;
    r.patient.drag(null);
    rescuers.delete(r.patient);
    mind.rescue = null;
    mind.rescueReady = clock + FEEL.rescue.cooldown;
    mind.tactic = null;
  }
  /**
   * To the man down, running; then backing away with him by the collar to the
   * cover near by; then kneeling by him, a hand on his chest, until he is
   * treated and gets up. The Jedi coming at him: he drops it, up and firing.
   * True while it takes him over.
   */
  function rescue(mind, dt, hero, cues) {
    const t = mind.trooper, o = t.order, r = mind.rescue, patient = r.patient, R = FEEL.rescue;
    if (patient.dead || !patient.hurt) { endRescue(mind); return false; }
    const at = flat(t.root.position), body = chestOf(patient);
    if (at.distanceTo(flat(hero)) < R.threat) {
      endRescue(mind);
      mind.lastKnown.copy(hero).setY(0);
      mind.stance = 'stand';
      mind.tactic = 'aimOpen';
      mind.timer = 0;
      mind.startle = 0.12;
      t.reaction.vhead -= 1.6;
      t.reaction.vbuckle += 0.4;
      return false;
    }
    r.clock += dt;
    patient.attend();
    o.look = body.clone().setY(0.3);
    if (r.stage === 'go') {
      if (steer(mind, body, PACE.run, 0.85)) { r.stage = 'drag'; r.clock = 0; r.to = haven(patient, hero); if (!r.to) r.stage = 'treat'; }
      return true;
    }
    if (r.stage === 'drag') {
      // Facing him, backing away: his hand at the collar, the body sliding after him.
      const hand = at.clone().addScaledVector(new THREE.Vector3(Math.sin(t.heading), 0, Math.cos(t.heading)), 0.55).setY(0.45);
      const there = steer(mind, r.to, R.drag, 0.3);
      o.face = headingTo(t.root.position, body);
      o.drag = patient.particle('N').position.clone();
      patient.drag(hand, o.velocity);
      if (there || r.clock > R.dragMax) { patient.drag(null); r.stage = 'treat'; r.clock = 0; }
      return true;
    }
    // Treating him: kneeling at his side, a hand on his chest.
    if (at.distanceTo(body) > 1.05) { steer(mind, body, PACE.walk, 0.8); o.face = headingTo(t.root.position, body); r.clock = 0; return true; }
    r.treat ||= pick(R.treat, random);
    o.face = headingTo(t.root.position, body);
    o.crouch = true;
    o.tend = patient.particle('N').position.clone().lerp(patient.particle('W').position, 0.35);
    if ((r.pulse -= dt) <= 0) { r.pulse = 0.5; cues.push({ type: 'heal', trooper: t, at: o.tend.clone() }); }
    if (r.clock >= r.treat) {
      patient.heal();
      cues.push({ type: 'healed', trooper: t, patient });
      endRescue(mind);
      return false;
    }
    return true;
  }

  // ---- Getting about -------------------------------------------------------
  /**
   * Sets his steps towards a point — along a path round the crates and walls
   * when there is a navigation grid — clear of squadmates; true once there
   * (or as near as he can get). His heading turns smoothly into a new way.
   * Stopped while trying to move, he steps aside and finds another way.
   */
  function steer(mind, target, speed, arrive = 0.25) {
    const t = mind.trooper, o = t.order, at = flat(t.root.position);
    const goal = flat(target), to = goal.clone().sub(at), distance = to.length();
    if (distance < arrive) { o.velocity.set(0, 0, 0); mind.path = null; return true; }
    const direction = to.clone().divideScalar(distance);
    const plain = distance < 1.6 && !lab.segmentHit(temp.copy(at).setY(0.45), temp2.copy(goal).setY(0.45));
    let remaining = distance;
    if (nav && !plain) {
      let way = mind.path;
      if (!way || way.goal.distanceTo(goal) > 0.6 || (way.age += tick) > 1.5) mind.path = way = { goal, points: nav.path(at, goal) ?? [], age: 0 };
      while (way.points.length > 1 && at.distanceTo(way.points[0]) < 0.3) way.points.shift();
      // Skip ahead to the furthest point in plain view: the way is walked in long straight lines.
      while (way.points.length > 1 && nav.lineFree(at, way.points[1])) way.points.shift();
      const next = way.points[0];
      // The end of the way short of the goal (it cannot be reached): as near as he can get.
      if (way.points.length === 1 && next && at.distanceTo(next) < 0.3) { o.velocity.set(0, 0, 0); mind.path = null; return true; }
      if (!way.points.length) { o.velocity.set(0, 0, 0); return true; }
      if (next && at.distanceTo(next) > 1e-3) direction.copy(next).sub(at).normalize();
      remaining = way.points.length === 1 ? at.distanceTo(next) : distance;
    } else if (!nav) {
      // Round an obstacle in the way: along its face, on the side nearer the goal.
      const probe = Math.min(distance, 1.3);
      const hit = lab.segmentHit(temp.copy(at).setY(0.45), temp2.copy(at).addScaledVector(direction, probe).setY(0.45));
      if (hit && Math.abs(hit.normal.y) < 0.5) {
        const tangent = new THREE.Vector3(-hit.normal.z, 0, hit.normal.x);
        const ahead = hit.point.clone().setY(0);
        if (ahead.clone().add(tangent).distanceTo(goal) > ahead.clone().sub(tangent).distanceTo(goal)) tangent.negate();
        direction.copy(tangent).addScaledVector(hit.normal, 0.3).normalize();
      }
    }
    if (mind.detour > 0) { mind.detour -= tick; direction.addScaledVector(mind.detourSide, 1.3).normalize(); }
    // Keep clear of squadmates: a gentle push away from those close by, more from those ahead.
    for (const other of troopers) {
      if (other === t || other.fallen) continue;
      const away = at.clone().sub(flat(other.root.position)), gap = away.length();
      if (gap < 1 && gap > 1e-4) {
        away.divideScalar(gap);
        const ahead = Math.max(0, -away.dot(direction));
        direction.addScaledVector(away, (1 - gap) * (0.8 + ahead * 1.2));
      }
    }
    direction.normalize();
    // A new way is turned into, not snapped to.
    if (!mind.dir || mind.dir.dot(direction) < -0.2) mind.dir = direction.clone();
    else mind.dir.lerp(direction, 1 - Math.exp(-11 * tick)).normalize();
    o.velocity.copy(mind.dir).multiplyScalar(speed * Math.min(1, remaining / 0.9 + 0.2));
    // Hardly moved for most of a second while trying to: a step aside, a new way.
    const stuck = mind.stuck;
    if (clock - stuck.stamp > 0.25) { stuck.at.copy(at); stuck.time = 0; }
    stuck.stamp = clock;
    stuck.time += tick;
    if (stuck.time > 0.9) {
      if (at.distanceTo(stuck.at) < 0.2 && speed > 0.5) {
        mind.path = null;
        mind.detour = 0.55;
        mind.detourSide.set(-direction.z, 0, direction.x).multiplyScalar(random() < 0.5 ? 1 : -1);
        mind.stuckCount++;
      } else mind.stuckCount = 0;
      stuck.at.copy(at);
      stuck.time = 0;
    }
    return false;
  }
  const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  /**
   * Moving in the fight: close to the hero and in sight of him, he walks with
   * his rifle on him (legs one way, chest the other); further, he runs.
   */
  function tacticalMove(mind, goal, threat, { arrive = 0.25, close = 6 } = {}) {
    const t = mind.trooper, o = t.order, at = t.root.position;
    const near = mind.sees && flat(at).distanceTo(flat(threat)) < close && flat(at).distanceTo(flat(goal)) < 4.5;
    const there = steer(mind, goal, near ? PACE.walk * 1.35 : flat(at).distanceTo(flat(goal)) > 1.4 ? PACE.run : PACE.walk, arrive);
    if (near || there) { o.face = headingTo(at, threat); o.aim = near && t.holding; }
    return there;
  }
  /** Is a crouching man at `spot` hidden from the hero by a crate? (The same test as the cover spots'.) */
  function covered(spot, threat) {
    const hit = lab.segmentHit(temp.copy(threat).setY(1.2), temp2.copy(spot).setY(0.72));
    return Boolean(hit);
  }
  /** Where the rest of the squad stands, seen from the hero (unit vectors). */
  function bearings(mind, threat) {
    return minds.filter(other => other !== mind && other.mode === 'combat' && !other.trooper.dead)
      .map(other => flat(other.cover?.position ?? other.spreadTo ?? other.trooper.root.position).sub(flat(threat)).normalize());
  }
  /** Which side of the squad's line a point lies on, seen from the hero: 1, -1. */
  const sideOf = (point, threat) => Math.sign(plan.axis.x * (point.z - threat.z) - plan.axis.z * (point.x - threat.x)) || 1;
  function chooseCover(mind, { range = null } = {}) {
    const t = mind.trooper, at = flat(t.root.position), threat = mind.lastKnown;
    const [near, far] = range ?? (mind.role === 'flanker' ? FEEL.ai.flankRange : FEEL.ai.range);
    const others = bearings(mind, threat);
    let best = null, bestScore = Infinity;
    for (const spot of lab.coverSpots(threat, { minDistance: near - 0.5 })) {
      if (minds.some(other => other !== mind && other.cover && !other.trooper.dead && other.cover.position.distanceTo(spot.position) < 1.1)) continue;
      const travel = at.distanceTo(spot.position);
      if (travel > 10) continue;
      const distance = spot.position.distanceTo(threat);
      // The way there should not run past the hero.
      const line = new THREE.Line3(at, spot.position), closest = line.closestPointToPoint(threat, true, new THREE.Vector3());
      const exposed = closest.distanceTo(threat) < 2.2 ? 5 : 0;
      // Spread round him: no two on the same line; a flanker wants his own side, well round.
      const bearing = flat(spot.position).sub(flat(threat)).normalize();
      const crowd = others.reduce((sum, other) => sum + (bearing.angleTo(other) < 0.55 ? 2.2 : 0), 0);
      let flank = 0;
      if (mind.role === 'flanker' && mind.flankSide) {
        const round = bearing.angleTo(plan.axis);
        flank = sideOf(spot.position, threat) === mind.flankSide && round > 0.7 ? -2.5 - Math.min(1, round - 0.7) : 1.5;
      }
      const score = travel * 0.75 + (distance < near ? (near - distance) * 3 : distance > far ? (distance - far) * 1.2 : Math.abs(distance - (near + far) / 2) * 0.3) + exposed
        + crowd + flank + (mind.previousCover && spot.position.distanceTo(mind.previousCover.position) < 0.5 ? 4 : 0) + random() * 0.6;
      if (score < bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }
  /**
   * Where to shoot from at his cover: standing up behind it if the rifle
   * clears the crate, otherwise stepping out past its edge — never into it.
   */
  function peekFrom(mind, threat, skip = null) {
    const cover = mind.cover, across = new THREE.Vector3(-cover.facing.z, 0, cover.facing.x);
    const target = new THREE.Vector3().copy(threat).setY(CHEST);
    const candidates = cover.tall ? [] : [cover.position.clone()];
    for (const step of [0.65, 0.95, 1.25]) for (const sign of [mind.side, -mind.side]) candidates.push(cover.position.clone().addScaledVector(across, sign * step));
    for (const spot of candidates) {
      if (skip && spot.distanceTo(skip) < 0.2) continue;
      if (spot.distanceTo(lab.pushOut(spot.clone(), 0.32)) > 1e-3) continue;
      if (!lab.clear(temp.copy(spot).setY(MUZZLE), target)) continue;
      return spot;
    }
    return null;
  }
  /** A spot close by with a clear shot at the hero (no crate in the way, no squadmate there), or null. */
  function firingSpot(mind, threat) {
    const t = mind.trooper, at = flat(t.root.position), target = new THREE.Vector3().copy(threat).setY(CHEST);
    const toward = flat(threat).sub(at).normalize();
    let best = null, bestScore = Infinity;
    for (const radius of [0.9, 1.5, 2.2]) {
      for (let k = 0; k < 10; k++) {
        const angle = (k / 10) * Math.PI * 2;
        const spot = at.clone().add(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(radius));
        if (nav && !nav.walkable(spot)) continue;
        if (!nav && spot.distanceTo(lab.pushOut(spot.clone(), 0.32)) > 1e-3) continue;
        if (!lab.clear(temp.copy(spot).setY(MUZZLE), target)) continue;
        if (troopers.some(other => other !== t && !other.fallen && flat(other.root.position).distanceTo(spot) < 0.9)) continue;
        // Not towards him, not too far.
        const score = radius + Math.max(0, spot.clone().sub(at).normalize().dot(toward)) * 1.5;
        if (score < bestScore) { bestScore = score; best = spot; }
      }
      if (best) return best;
    }
    return null;
  }
  /** Round the hero, at a distance, where no squadmate stands yet: a place in the crossfire. */
  function spreadPoint(mind, threat) {
    const at = flat(mind.trooper.root.position), from = flat(threat), others = bearings(mind, threat);
    const base = at.clone().sub(from);
    if (base.lengthSq() < 1e-4) base.set(1, 0, 0);
    base.normalize();
    const radius = pick(FEEL.ai.spread, random);
    let best = null, bestScore = -Infinity;
    for (const turn of [-1.4, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.4]) {
      const bearing = base.clone().applyAxisAngle(UP, turn);
      let spot = from.clone().addScaledVector(bearing, radius);
      if (nav) spot = nav.nearest(spot) ?? spot;
      const apart = others.length ? Math.min(...others.map(other => flat(spot).sub(from).normalize().angleTo(other))) : 1.5;
      const score = Math.min(apart, 1.5) * 2 - Math.abs(turn) * 0.6 - at.distanceTo(spot) * 0.15 + (lab.clear(temp.copy(spot).setY(MUZZLE), temp2.copy(threat).setY(CHEST)) ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }
  /** Would a bolt from his rifle reach the target, or hit a crate first? (Bolts fly through the railings; `skip`: his own cover, held over.) */
  const lineOfFire = (t, target, skip = null) => !lab.segmentHit(t.muzzle, target, box => box.kind === 'rail' || box === skip);
  /** Leave to fire: a few at once at most, their bursts staggered. */
  function take(mind) {
    if (mind.token) return true;
    if (firing >= FEEL.blaster.firing) return false;
    if (firing > 0 && clock - plan.lastBurst < FEEL.ai.stagger) return false;
    firing++;
    mind.token = true;
    plan.lastBurst = clock;
    return true;
  }
  function release(mind) {
    mind.charge = 0;
    if (!mind.token) return;
    mind.token = false;
    firing = Math.max(0, firing - 1);
  }

  // ---- Behaviour -----------------------------------------------------------
  function patrol(mind, dt) {
    const t = mind.trooper, o = t.order;
    if (mind.route?.length) {
      if (mind.wait > 0) {
        mind.wait -= dt;
        // Waiting at a waypoint, he glances about.
        o.look = temp.copy(t.root.position).add(new THREE.Vector3(Math.sin(t.heading + Math.sin(mind.wait * 0.9) * 0.9), 0, Math.cos(t.heading + Math.sin(mind.wait * 0.9) * 0.9)).multiplyScalar(4)).setY(1.4).clone();
        return;
      }
      if (steer(mind, mind.route[mind.routeIndex], PACE.walk * 0.75, 0.3)) {
        mind.routeIndex = (mind.routeIndex + 1) % mind.route.length;
        mind.wait = 1.4 + random() * 2.2;
      }
      return;
    }
    // A sentry: back to his post, facing his way.
    if (flat(t.root.position).distanceTo(flat(mind.home)) > 0.45) steer(mind, mind.home, PACE.walk * 0.75, 0.3);
    else o.face = mind.homeHeading;
  }
  function investigate(mind, dt) {
    const t = mind.trooper, o = t.order;
    mind.timer += dt;
    const point = mind.interest ?? mind.home;
    o.look = temp.copy(point).setY(1.2).clone();
    // A beat to listen, then he goes to see, rifle up (as near as he can get).
    if (mind.timer < 0.8 || mind.awareness < 0.5) { o.face = headingTo(t.root.position, point); return; }
    mind.aimPoint.copy(point).setY(CHEST);
    o.aim = true;
    o.aimAt = mind.aimPoint;
    const goal = nav?.nearest(point) ?? point;
    if (mind.stuckCount >= 2 || steer(mind, goal, PACE.walk * 0.8, 1.4)) {
      // There: he sweeps the area with his rifle.
      o.velocity.set(0, 0, 0);
      mind.glance += dt;
      mind.aimPoint.copy(point).add(new THREE.Vector3(Math.sin(mind.glance * 1.3) * 2.5, 0, Math.cos(mind.glance * 1.1) * 2.5)).setY(CHEST);
      o.face = headingTo(t.root.position, mind.aimPoint);
      mind.awareness = Math.max(0, mind.awareness - dt * 0.12);
    }
  }
  function search(mind, dt) {
    const t = mind.trooper, o = t.order;
    mind.searchTime += dt;
    // Fanned out round where he was last seen, each looking his own way.
    const index = minds.filter(other => other.mode === 'searching').indexOf(mind);
    const spot = mind.lastKnown.clone().add(new THREE.Vector3(Math.sin(index * 2.4), 0, Math.cos(index * 2.4)).multiplyScalar(index ? 1.8 : 0));
    const goal = nav?.nearest(spot) ?? spot;
    mind.aimPoint.copy(mind.lastKnown).setY(CHEST);
    o.aim = true;
    o.aimAt = mind.aimPoint;
    if (mind.stuckCount >= 2 || steer(mind, goal, PACE.walk, 1.2)) {
      o.velocity.set(0, 0, 0);
      mind.glance += dt;
      mind.aimPoint.copy(goal).add(new THREE.Vector3(Math.sin(mind.glance * 1.4 + index), 0, Math.cos(mind.glance * 1.2 + index)).multiplyScalar(3)).setY(CHEST);
      o.face = headingTo(t.root.position, mind.aimPoint);
    }
    if (mind.searchTime > 9) {
      // Nothing: back to wary, then calm.
      mind.mode = 'suspicious';
      mind.awareness = 0.45;
      mind.interest = mind.lastKnown.clone();
      mind.timer = 1;
      alerts?.show(t, '?');
    }
  }
  /** Is a squadmate in the way of a shot from `from` to `to`? */
  function friendInLine(t, from, to) {
    const line = new THREE.Line3(from, to), point = new THREE.Vector3();
    return troopers.some(other => {
      if (other === t || other.fallen) return false;
      const chest = flat(other.root.position).setY(1.05);
      line.closestPointToPoint(chest, true, point);
      return point.distanceTo(chest) < 0.5 && point.distanceTo(to) > 0.6;
    });
  }
  /**
   * Pulls the trigger: aimed at the hero's chest, or a deliberate near miss
   * that whizzes past; blind (the rifle up over his cover), only roughly his
   * way; suppressing, at where he hides (the bolts may splash on his cover,
   * never on the shooter's own).
   */
  function shoot(mind, hero, heroVelocity, shots, { blind = false, suppress = false } = {}) {
    const t = mind.trooper;
    if (suppress) {
      const aimAt = flat(mind.lastKnown).add(new THREE.Vector3((random() - 0.5) * 1.2, 0, (random() - 0.5) * 1.2)).setY(0.8 + random() * 0.7);
      const hit = lab.segmentHit(t.muzzle, aimAt, box => box.kind === 'rail');
      if ((hit && hit.point.distanceTo(aimAt) > 1.8) || friendInLine(t, t.muzzle, aimAt)) return false;
      const shot = t.fire();
      if (!shot) return false;
      shots.push({ from: shot.from, direction: aimAt.sub(shot.from).normalize(), trooper: t, suppress: true });
      return true;
    }
    const aimAt = blind ? flat(mind.lastKnown).add(new THREE.Vector3((random() - 0.5) * 2.4, 0, (random() - 0.5) * 2.4)).setY(CHEST + (random() - 0.4) * 0.8) : new THREE.Vector3().copy(hero).setY(CHEST);
    // Never into a crate (held up over his own, the rifle clears it), never through a squadmate.
    if (!lineOfFire(t, aimAt, blind ? mind.cover?.box : null) || friendInLine(t, t.muzzle, aimAt)) return false;
    const shot = t.fire();
    if (!shot) return false;
    if (blind) {
      const direction = aimAt.sub(shot.from).normalize();
      direction.x += (random() - 0.5) * FEEL.ai.blindSpread * 2;
      direction.y += (random() - 0.5) * FEEL.ai.blindSpread;
      direction.z += (random() - 0.5) * FEEL.ai.blindSpread * 2;
      shots.push({ from: shot.from, direction: direction.normalize(), trooper: t, blind: true });
      return true;
    }
    const target = new THREE.Vector3().copy(hero).setY(CHEST + (random() - 0.5) * 0.3);
    // A slight lead on a moving target, imperfect.
    target.addScaledVector(heroVelocity, shot.from.distanceTo(target) / FEEL.blaster.speed * (0.3 + random() * 0.5));
    if (random() < FEEL.blaster.miss) {
      const side = new THREE.Vector3().subVectors(target, shot.from).cross(new THREE.Vector3(0, 1, 0)).normalize();
      target.addScaledVector(side, (random() < 0.5 ? -1 : 1) * (0.45 + random() * 0.5)).y += (random() - 0.3) * 0.5;
    }
    const distance = target.distanceTo(shot.from);
    const direction = target.sub(shot.from).normalize();
    const spread = FEEL.blaster.spread;
    direction.x += (random() - 0.5) * spread * 2;
    direction.y += (random() - 0.5) * spread;
    direction.z += (random() - 0.5) * spread * 2;
    direction.normalize();
    // A wide shot that would clip a crate on its way goes straight at the chest instead.
    if (lab.segmentHit(shot.from, temp.copy(shot.from).addScaledVector(direction, Math.max(0.5, distance - 0.8)), box => box.kind === 'rail')) direction.copy(hero).setY(CHEST).sub(shot.from).normalize();
    shots.push({ from: shot.from, direction, trooper: t });
    return true;
  }
  /** A grenade now? Not too often, at a fair range, never onto a squadmate; likelier when the hero hides. */
  function wantsGrenade(mind, threat, distance) {
    const g = FEEL.grenade, t = mind.trooper;
    if (!t.holding || t.reaction.wound || grenadeClock < g.squadCooldown || mind.grenadeClock < g.cooldown) return false;
    if (distance < g.range[0] || distance > g.range[1]) return false;
    if (troopers.some(other => other !== t && !other.dead && flat(other.root.position).distanceTo(flat(threat)) < g.safe)) return false;
    return random() < (mind.sees ? g.chance : g.chanceHidden);
  }
  /** Hands out the parts by distance to the hero: rusher, flankers, anchors. */
  function assignRoles(hero) {
    const fighters = fighting();
    fighters.sort((a, b) => flat(a.trooper.root.position).distanceTo(flat(hero)) - flat(b.trooper.root.position).distanceTo(flat(hero)));
    const roles = rolesFor(fighters.length);
    fighters.forEach((mind, index) => {
      const role = roles[index % roles.length];
      if (role !== mind.role) mind.flankSide = 0;
      mind.role = role;
    });
  }
  /** Where a rusher or a flanker heads: short of the hero, or round to his side. */
  function approach(mind, threat) {
    const at = flat(mind.trooper.root.position), from = flat(threat), away = at.clone().sub(from);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize();
    if (mind.role === 'flanker') {
      // Round to his own side of the squad's line.
      const side = mind.flankSide || mind.strafe;
      const round = plan.axis.clone().applyAxisAngle(UP, 1.25 * side);
      if (sideOf(from.clone().add(round), from) !== side) round.copy(plan.axis).applyAxisAngle(UP, -1.25 * side);
      away.copy(round);
    }
    const range = mind.role === 'flanker' ? FEEL.ai.flankRange[0] + 0.8 : FEEL.ai.advance;
    const goal = from.clone().addScaledVector(away, range);
    if (!nav) return goal;
    return nav.walkable(goal) ? goal : nav.nearest(goal) ?? from.clone().addScaledVector(away, range * 0.6);
  }
  /** Rifle up and a burst: kneeling, standing, or blind over his cover. */
  function stanceOrders(mind, o) {
    o.crouch = mind.stance !== 'stand';
    o.aim = mind.stance !== 'blind';
    o.blind = mind.stance === 'blind';
    o.over = o.blind && mind.cover?.box ? mind.cover.box.max.y + 0.22 : null;
  }
  /** Into the burst: first the aim settles (the glint), then the shots. */
  function openFire(mind, { burst, blind = false } = {}) {
    mind.tactic = 'fire';
    mind.burst = burst;
    mind.gap = 0;
    mind.armed = false;
    mind.windup = mind.windupTotal = FEEL.ai.windup * (blind ? 0.7 : 1);
  }
  /** A new plan: to cover (or a better one), closer in, or holding where he is if the squad needs him covering. */
  function newPlan(mind, cues, { range = null, urgent = false } = {}) {
    const t = mind.trooper;
    // Plan after plan without getting anywhere: he stands and fires from where he is.
    if ((mind.plans += 1) > 5 && t.holding) { mind.plans = 0; mind.stance = 'stand'; mind.tactic = 'aimOpen'; mind.timer = 0; return; }
    const cover = mind.role === 'rusher' && t.holding && !range ? null : chooseCover(mind, { range });
    mind.cycles = 0;
    mind.maxCycles = Math.round(pick(FEEL.ai.cycles, random));
    mind.timer = 0;
    mind.advanceTo = null;
    mind.reposition = false;
    mind.suppressing = false;
    const here = mind.cover && flat(t.root.position).distanceTo(mind.cover.position) < 0.4;
    if (cover && here && cover.position.distanceTo(mind.cover.position) < 0.3) { mind.tactic = 'hide'; return; }
    const wanted = cover ? 'move' : t.holding ? 'advance' : 'cower';
    if (wanted === 'cower' || urgent || claimMove(mind, cues)) {
      mind.previousCover = mind.cover;
      mind.cover = cover;
      mind.coverTime = 0;
      mind.tactic = wanted;
      if (wanted !== 'cower') plan.movers.add(mind);
      return;
    }
    // No leave to move: he covers the others from where he is.
    if (mind.cover && here && covered(mind.cover.position, mind.lastKnown)) { mind.tactic = 'hide'; mind.timer = 0.15; }
    else if (t.holding) { mind.stance = random() < FEEL.ai.kneel ? 'kneel' : 'stand'; mind.tactic = 'aimOpen'; }
    else mind.tactic = 'cower';
  }
  function fight(mind, dt, hero, heroVelocity, shots, cues) {
    const t = mind.trooper, o = t.order, at = t.root.position;
    const threat = mind.sees ? hero : mind.lastKnown;
    mind.aimPoint.copy(threat).setY(CHEST);
    o.aimAt = mind.aimPoint;
    o.look = temp.copy(threat).setY(HEAD).clone();
    mind.charge = 0;
    mind.noBlind = Math.max(0, mind.noBlind - dt);
    mind.spreadAgain = Math.max(0, mind.spreadAgain - dt);
    mind.plans = Math.max(0, mind.plans - dt * 4);
    mind.coverTime += dt;
    if (mind.sees) mind.suppressed = false;
    if (mind.startle > 0) { mind.startle -= dt; o.face = headingTo(at, threat); return; }
    // Lost him for long: go and look where he was.
    if (mind.seen > FEEL.ai.search) {
      release(mind);
      plan.movers.delete(mind);
      mind.mode = 'searching';
      mind.searchTime = 0;
      mind.glance = 0;
      mind.cover = null;
      mind.tactic = null;
      if (!plan.lost) { plan.lost = true; cues.push({ type: 'radio', radio: 'lost', trooper: t }); }
      return;
    }
    // Disarmed: the rifle first; failing that, away to cover.
    if (!t.holding) {
      release(mind);
      const rifle = t.rifle;
      if (rifle && flat(at).distanceTo(rifle) < 10) { steer(mind, rifle, PACE.run, 0.5); return; }
      if (!['move', 'hide', 'cower'].includes(mind.tactic)) mind.tactic = null;
    }
    // Stuck again and again: a new plan.
    if (mind.stuckCount >= 3) { mind.stuckCount = 0; release(mind); mind.tactic = null; mind.cover = null; }
    const distance = flat(at).distanceTo(flat(threat));
    // Falling back: to a cover further off, now.
    if (plan.fallback > 0 && !mind.fellBack && !COMMITTED.has(mind.tactic)) {
      mind.fellBack = true;
      release(mind);
      newPlan(mind, cues, { range: FEEL.ai.fallbackRange, urgent: true });
    }
    // The Jedi on him: he backs away, firing from the hip.
    if (mind.sees && distance < FEEL.ai.close && t.holding && mind.tactic !== 'evade') { release(mind); plan.movers.delete(mind); mind.tactic = 'evade'; mind.timer = 0; mind.gap = 0; mind.windup = 0; }
    // The Jedi among them: those in the open nearby spread out round him for a crossfire.
    else if (plan.scatter && mind.sees && t.holding && distance < 6.5 && mind.spreadAgain <= 0 && !COMMITTED.has(mind.tactic) && mind.tactic !== 'aimOpen'
      && !(mind.cover && ['hide', 'peek', 'back'].includes(mind.tactic) && distance > 4.5)) {
      release(mind);
      mind.spreadAgain = 3;
      mind.tactic = 'spread';
      mind.spreadTo = spreadPoint(mind, threat);
      mind.timer = 0;
    }
    // Out of sight a moment: the anchors keep him pinned with a burst at where he hides; the others go after him.
    if (!mind.sees && mind.seen > FEEL.ai.pursue && t.holding && !['pursue', 'throw', 'blindUp', 'fire', 'evade', 'suppress'].includes(mind.tactic)) {
      if (mind.role === 'anchor' && !mind.suppressed && mind.seen < FEEL.ai.suppress && mind.cover && take(mind)) {
        mind.suppressed = true;
        mind.tactic = 'suppress';
        mind.peekAt = mind.peek = null;
        mind.timer = 0;
      } else if (mind.role !== 'anchor' || mind.seen > FEEL.ai.suppress) {
        release(mind);
        plan.movers.add(mind);
        mind.tactic = 'pursue';
        mind.cover = null;
        mind.peek = null;
        mind.timer = 0;
      }
    }
    if (!mind.tactic) newPlan(mind, cues);
    switch (mind.tactic) {
      case 'move': {
        release(mind);
        const cover = mind.cover;
        if (!cover) { mind.tactic = null; break; }
        // Running for it; close to him he walks there with his rifle on him.
        if (tacticalMove(mind, cover.position, threat, { arrive: 0.22 })) { plan.movers.delete(mind); mind.tactic = 'hide'; mind.timer = pick(FEEL.ai.hide, random) * 0.5; }
        break;
      }
      case 'hide': {
        release(mind);
        o.crouch = true;
        o.face = headingTo(at, threat);
        // While squadmates move, he comes up sooner to cover them.
        mind.timer -= dt * (plan.movers.size && !plan.movers.has(mind) ? 1.8 : 1);
        if (!mind.cover || !covered(mind.cover.position, threat)) { mind.tactic = null; break; }
        // The hero has moved off: a cover nearer him (not straight after settling).
        if (mind.coverTime > 2 && flat(mind.cover.position).distanceTo(flat(threat)) > FEEL.ai.range[1] + 2 && claimMove(mind, cues)) { mind.tactic = null; break; }
        if (mind.timer > 0) break;
        if (!t.holding) break;
        if (mind.cycles >= mind.maxCycles) { mind.tactic = null; break; }
        if (wantsGrenade(mind, threat, distance)) { mind.tactic = 'throw'; mind.timer = 0; mind.thrown = false; break; }
        if (take(mind)) {
          // Blind over a low crate now and then; otherwise up behind it, or out past its edge.
          const blindOk = !mind.cover.tall && mind.noBlind <= 0;
          if (blindOk && random() < FEEL.ai.blind) { mind.stance = 'blind'; mind.tactic = 'blindUp'; mind.timer = 0; break; }
          const spot = peekFrom(mind, threat);
          if (!spot) {
            if (blindOk) { mind.stance = 'blind'; mind.tactic = 'blindUp'; mind.timer = 0; break; }
            // Nowhere to fire from here: another cover.
            release(mind); mind.tactic = null; break;
          }
          mind.peekAt = spot;
          mind.peek = spot.distanceTo(mind.cover.position) < 0.05 ? null : spot;
          mind.retries = 0;
          mind.stance = 'stand';
          mind.tactic = 'peek';
          mind.timer = 0;
        } else mind.timer = 0.15;
        break;
      }
      case 'blindUp': {
        // Rifle up over the crate, head down.
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (t.reaction.blind > 0.85) {
          // The rifle cannot clear it from here: not again for a while.
          if (!lineOfFire(t, temp2.copy(threat).setY(CHEST), mind.cover?.box)) { mind.stance = 'stand'; mind.tactic = 'hide'; mind.timer = 0.1; mind.noBlind = 4; release(mind); break; }
          openFire(mind, { burst: Math.round(pick(FEEL.ai.blindBurst, random)), blind: true });
        }
        if (mind.timer > 1.2) { release(mind); mind.stance = 'stand'; mind.tactic = 'hide'; mind.timer = 0.2; mind.noBlind = 4; }
        break;
      }
      case 'peek':
      case 'suppress': {
        // Up (or out), rifle to the shoulder.
        const suppress = mind.tactic === 'suppress';
        if (suppress && !mind.peekAt) { mind.peekAt = peekFrom(mind, threat) ?? mind.cover?.position ?? flat(at); mind.peek = mind.cover && mind.peekAt.distanceTo(mind.cover.position) > 0.05 ? mind.peekAt : null; }
        if (mind.peek && !steer(mind, mind.peek, PACE.walk, 0.2)) { o.face = headingTo(at, threat); mind.timer += dt; if (mind.timer > 2) { release(mind); mind.tactic = null; } break; }
        o.aim = true;
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (t.reaction.aim > 0.85 && (mind.sees || suppress || mind.timer > 0.6)) {
          if (suppress) { mind.suppressing = true; openFire(mind, { burst: Math.round(pick(FEEL.blaster.burst, random)) }); break; }
          // The crate is in the way of his rifle: another spot, or another cover.
          if (!lineOfFire(t, temp2.copy(threat).setY(CHEST))) {
            const next = mind.retries++ < 3 ? peekFrom(mind, threat, mind.peekAt) : null;
            if (!next) { release(mind); mind.tactic = null; break; }
            mind.peekAt = next;
            mind.peek = next.distanceTo(mind.cover.position) < 0.05 ? null : next;
            mind.timer = 0;
            break;
          }
          openFire(mind, { burst: Math.round(pick(FEEL.blaster.burst, random)) });
        }
        if (mind.timer > 1.6) { release(mind); mind.tactic = 'hide'; mind.timer = 0.2; }
        break;
      }
      case 'advance': {
        // A rusher closes in, a flanker swings round; then he stops to fire.
        release(mind);
        mind.timer += dt;
        if (!mind.advanceTo || (!mind.reposition && mind.timer % 1 < dt)) mind.advanceTo = approach(mind, threat);
        const there = tacticalMove(mind, mind.advanceTo, threat, { arrive: 0.45 });
        const inRange = distance < (mind.role === 'flanker' ? FEEL.ai.flankRange[1] : FEEL.ai.advance + 2.5);
        // Hiding from him: a grenade to flush him out.
        if (!mind.sees && wantsGrenade(mind, threat, distance)) { mind.tactic = 'throw'; mind.timer = 0; mind.thrown = false; break; }
        const ready = there ? mind.timer > 0.2 : (inRange && mind.timer > 1.1 && !mind.reposition) || mind.timer > 3.5;
        if (mind.sees && ready && take(mind)) {
          plan.movers.delete(mind);
          mind.reposition = false;
          mind.stance = random() < FEEL.ai.kneel ? 'kneel' : 'stand';
          mind.tactic = 'aimOpen';
          mind.timer = 0;
        } else if (there && !mind.sees) { mind.reposition = false; mind.tactic = 'pursue'; plan.movers.add(mind); }
        break;
      }
      case 'aimOpen': {
        // Kneeling or standing, the rifle comes up.
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (mind.timer > 2.2 || !mind.sees) { release(mind); mind.tactic = null; mind.stance = 'stand'; break; }
        const settled = t.reaction.aim > 0.85 && (mind.stance !== 'kneel' || t.reaction.crouch > 0.7);
        if (!settled) break;
        // Kneeling, a crate may be in the way: up he gets. Standing too: a step to a clear spot
        // (he is of no use where he is: he may go even while the others move), or another cover.
        if (!lineOfFire(t, temp2.copy(threat).setY(CHEST))) {
          if (mind.stance === 'kneel') { mind.stance = 'stand'; break; }
          release(mind);
          const spot = mind.aimFails++ < 2 ? firingSpot(mind, threat) : null;
          if (spot) { mind.tactic = 'advance'; mind.advanceTo = spot; mind.reposition = true; mind.timer = 0; }
          else { mind.aimFails = 0; mind.cover = null; newPlan(mind, cues, { urgent: true }); }
          break;
        }
        mind.aimFails = 0;
        // His turn to fire (a few at a time, staggered).
        if (!take(mind)) break;
        openFire(mind, { burst: Math.round(pick(FEEL.blaster.burst, random)) + (mind.stance === 'kneel' ? 1 : 0) });
        break;
      }
      case 'fire': {
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        if (mind.peek) steer(mind, mind.peek, PACE.walk, 0.15);
        const blind = mind.stance === 'blind';
        // One burst after another: he waits for the last one to have started a moment ago.
        if (!mind.armed) {
          if (clock - plan.lastFire < FEEL.ai.stagger) break;
          mind.armed = true;
          plan.lastFire = clock;
        }
        // The aim settles first: the glint at his muzzle tells the burst is coming.
        if (mind.windup > 0) {
          mind.windup -= dt;
          mind.charge = Math.min(1, 1 - mind.windup / mind.windupTotal);
          // He lost his mark while aiming (not blind, not pinning him down): no burst.
          if (!blind && !mind.suppressing && !mind.sees && mind.seen > 0.4) { mind.burst = 0; mind.windup = 0; }
          break;
        }
        mind.gap -= dt;
        if (mind.gap <= 0 && mind.burst > 0) {
          // Blocked (the hero moved behind something, or a squadmate is in the way): the burst stops there.
          if (mind.suppressing) { if (!shoot(mind, hero, heroVelocity, shots, { suppress: true })) mind.burst = 1; }
          else if ((blind || mind.sees) && !shoot(mind, hero, heroVelocity, shots, { blind })) mind.burst = 1;
          if (!blind && !mind.suppressing && !mind.sees) mind.burst = 1;
          mind.burst--;
          mind.gap = pick(blind ? FEEL.ai.blindGap : FEEL.blaster.gap, random);
        }
        if (mind.burst <= 0 && mind.gap <= 0) {
          release(mind);
          mind.cycles++;
          const fromCover = mind.cover && (mind.stance === 'blind' || mind.peekAt);
          mind.stance = 'stand';
          mind.suppressing = false;
          if (fromCover) { mind.tactic = 'back'; mind.timer = pick(FEEL.ai.hide, random); }
          else if (mind.cycles >= mind.maxCycles) mind.tactic = null;
          // In the open: on, if the squad lets him; otherwise he keeps covering from where he is.
          else if (claimMove(mind, cues)) { mind.tactic = 'advance'; mind.timer = 0; mind.advanceTo = null; }
          else { mind.tactic = 'aimOpen'; mind.timer = 0; }
          mind.step = 0;
        }
        break;
      }
      case 'back': {
        // Back behind the crate.
        if (mind.peek && !steer(mind, mind.cover.position, PACE.walk, 0.2)) { o.face = headingTo(at, threat); break; }
        mind.peek = null;
        mind.peekAt = null;
        mind.tactic = 'hide';
        break;
      }
      case 'pursue': {
        // After him: round to where he was last seen, at a run, stopping short — each from his own side.
        release(mind);
        mind.timer += dt;
        const from = flat(mind.lastKnown), away = flat(at).sub(from);
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        away.normalize();
        if (mind.flankSide) away.applyAxisAngle(UP, 0.6 * mind.flankSide);
        let goal = from.addScaledVector(away, 2.5);
        if (nav) goal = nav.nearest(goal) ?? goal;
        const there = steer(mind, goal, PACE.run, 0.5);
        o.face = there ? headingTo(at, threat) : null;
        if (mind.sees) { plan.movers.delete(mind); mind.tactic = null; break; }
        if (there) { mind.glance += dt; o.face = headingTo(at, threat) + Math.sin(mind.glance * 2) * 0.8; o.aim = true; }
        break;
      }
      case 'evade': {
        // Too close: he backs off — away from the hero and out of his squadmates' line — firing from the hip.
        o.face = headingTo(at, threat);
        o.aim = true;
        const away = flat(at).sub(flat(threat)).normalize();
        const across = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(mind.strafe);
        // Sideways towards where no squadmate stands, so the others get a clear shot.
        const others = bearings(mind, threat);
        if (others.some(other => other.dot(across) > 0.6)) { mind.strafe *= -1; across.negate(); }
        steer(mind, flat(at).addScaledVector(away, 2).addScaledVector(across, 1), PACE.walk * 1.6, 0.1);
        mind.timer += dt;
        mind.gap -= dt;
        if (mind.windup > 0) {
          mind.windup -= dt;
          mind.charge = Math.min(1, 1 - mind.windup / mind.windupTotal);
          if (mind.windup <= 0 && mind.sees && t.reaction.aim > 0.6 && take(mind)) { if (shoot(mind, hero, heroVelocity, shots)) shots.at(-1).hip = true; release(mind); }
        } else if (mind.gap <= 0 && mind.sees && t.reaction.aim > 0.6) {
          mind.windup = mind.windupTotal = FEEL.ai.windup * 0.55;
          mind.gap = 0.3 + random() * 0.25;
        }
        if (distance > FEEL.ai.close + 1.6 || mind.timer > 2.5) { mind.tactic = null; mind.windup = 0; }
        break;
      }
      case 'spread': {
        // Out to his place round the Jedi, at a run, then the rifle up.
        release(mind);
        mind.timer += dt;
        const there = !mind.spreadTo || steer(mind, mind.spreadTo, PACE.run, 0.5);
        if (there || mind.timer > 2.2) {
          mind.spreadTo = null;
          mind.stance = random() < FEEL.ai.kneel * 0.6 ? 'kneel' : 'stand';
          mind.tactic = 'aimOpen';
          mind.timer = 0;
        }
        break;
      }
      case 'throw': {
        // Up from cover, square to the hero, and over it goes.
        release(mind);
        o.face = headingTo(at, threat);
        if (!mind.thrown) {
          mind.timer += dt;
          const facing = Math.abs(wrap(headingTo(at, threat) - t.heading)) < 0.35;
          if (t.reaction.crouch < 0.25 && facing) {
            const target = flat(threat).addScaledVector(flat(heroVelocity), 0.7).add(new THREE.Vector3((random() - 0.5) * 1.4, 0, (random() - 0.5) * 1.4));
            if (t.throwGrenade(target)) { mind.thrown = true; grenadeClock = 0; mind.grenadeClock = 0; cues.push({ type: 'radio', radio: 'grenade', trooper: t }); }
          }
          if (mind.timer > 2) mind.tactic = mind.cover ? 'hide' : null;
        } else if (!t.throwing) {
          mind.thrown = false;
          mind.tactic = mind.cover ? 'hide' : null;
          mind.timer = pick(FEEL.ai.hide, random) * 0.6;
        }
        break;
      }
      case 'cower': {
        // Unarmed with nowhere better: crouched, away from the hero.
        release(mind);
        o.crouch = true;
        o.face = headingTo(at, threat);
        if (t.rifle) mind.tactic = null;
        break;
      }
    }
  }

  /**
   * The lights go out: each man flinches and loses the hero for a moment;
   * those not yet fighting are on their guard. One says so on the radio.
   */
  function blackout(cues = []) {
    let speaker = null;
    for (const mind of minds) {
      const t = mind.trooper;
      if (t.dead || t.impaled || !t.free) continue;
      t.reaction.vhead -= 2.2;
      t.reaction.vbuckle += 0.5;
      alerts?.show(t, '?');
      if (mind.mode === 'combat') {
        release(mind);
        mind.startle = 0.5 + random() * 0.7;
        mind.seen = Math.max(mind.seen, 2);
        mind.tactic = null;
        speaker ??= t;
      } else if (mind.mode === 'calm') {
        mind.mode = 'suspicious';
        mind.awareness = Math.max(mind.awareness, 0.6);
        mind.timer = 0;
      }
    }
    if (speaker) cues.push({ type: 'radio', radio: 'lost', trooper: speaker });
    return cues;
  }
  function update(dt, { hero, heroVelocity = new THREE.Vector3(), saber = 0, noises = [], darkness = 0 }) {
    const shots = [], cues = [];
    dark = darkness;
    tick = dt;
    clock += dt;
    grenadeClock += dt;
    plan.fallback = Math.max(0, plan.fallback - dt);
    // Parts in the fight, handed out again now and then as the fight moves.
    if ((roleClock += dt) > 4 || minds.some(mind => mind.mode === 'combat' && !mind.role)) { roleClock = 0; assignRoles(hero); }
    if ((plan.clock -= dt) <= 0) { plan.clock = 0.25; coordinate(hero, cues); }
    for (const mind of minds) mind.grenadeClock += dt;
    const heroSpeed = Math.hypot(heroVelocity.x, heroVelocity.z);
    for (const mind of minds) {
      const t = mind.trooper, o = t.order;
      // Dead, or dying on the blade: out of the fight for good — and the squad hears of it.
      if (t.dead || t.impaled) {
        if (!mind.mourned) {
          mind.mourned = true;
          plan.losses.push(clock);
          const near = minds.filter(other => other !== mind && other.mode === 'combat' && !other.trooper.dead && other.trooper.root.position.distanceTo(t.root.position) < 11);
          if (near.length) cues.push({ type: 'radio', radio: 'down', trooper: near[Math.floor(random() * near.length)].trooper });
        }
        endRescue(mind); release(mind); plan.movers.delete(mind); alerts?.hide(t); mind.mode = 'dead'; continue;
      }
      o.velocity.set(0, 0, 0);
      o.face = null;
      o.look = null;
      o.aim = false;
      o.crouch = false;
      o.blind = false;
      o.aimAt = mind.aimPoint;
      o.drag = o.tend = null;
      // Knocked off his feet, or out of the fight: whoever he was going to waits for another.
      if (mind.rescue && (!t.free || mind.mode !== 'combat')) endRescue(mind);
      // Coming in through the door: nothing else until he is in.
      if (mind.entering) { if (t.free) march(mind, cues); else mind.entering = null; continue; }
      perceive(mind, dt, hero, heroSpeed, saber, noises, cues);
      // In the Force's grip, on the floor, running off: he is not his own master.
      if (!t.free) {
        release(mind);
        plan.movers.delete(mind);
        if (mind.tactic !== 'move') mind.tactic = null;
        mind.peek = null;
        continue;
      }
      if (mind.mode === 'calm') patrol(mind, dt);
      else if (mind.mode === 'suspicious') investigate(mind, dt);
      else if (mind.mode === 'searching') { if (mind.sees && mind.awareness >= 1) alert(mind, cues); else search(mind, dt); }
      else if (mind.mode === 'combat' && !(mind.rescue && rescue(mind, dt, hero, cues))) fight(mind, dt, hero, heroVelocity, shots, cues);
    }
    return { shots, cues };
  }
  /** The squad's mood: 'calme', 'suspicion' or 'alerte'. */
  const mood = () => (minds.some(mind => mind.mode === 'combat') ? 'alerte' : minds.some(mind => mind.mode === 'suspicious' || mind.mode === 'searching') ? 'suspicion' : 'calme');
  return { update, reset, add, remove, minds, mood, plan, blackout };
}
