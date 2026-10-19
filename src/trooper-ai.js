import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { PACE } from './stormtrooper.js';

/**
 * The squad's minds. Each trooper sees — a cone in front of him, wider but
 * weaker at the corner of his eye, blocked by crates — and hears: footsteps
 * at a run, the blade, blows, the Force, shots. What he senses fills his
 * awareness: past a little he is suspicious ("?"): he stops, turns towards
 * it, then goes to have a look, rifle up; full, he has spotted the hero
 * ("!"): he flinches, calls it out to the squad, and fights.
 *
 * Fighting, each has a part, handed out by distance to the hero: the one
 * nearest rushes him, two swing round his flanks, the rest hold cover. An
 * anchor runs to cover (a crate between him and the hero, at a good range,
 * not taken by a squadmate, away from the others' line), crouches, comes up
 * — standing behind the crate, leaning out past it, or holding his rifle up
 * over it for a blind burst — fires, ducks back; after a few bursts, or as
 * soon as the hero flanks him, he moves on. A rusher closes in, then kneels
 * or stands to fire, and closes in again; a flanker does the same from the
 * hero's side. Lose sight of the hero and they go after him at a run; still
 * nothing, they search where he was last seen, then calm down. Too close: he
 * backs away, firing. Disarmed: he runs for his rifle. Nobody fires through
 * a squadmate, and a few at most shoot at the same moment.
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

export function createSquadMind({ troopers, lab, nav = null, alerts = null, posts = [], random = Math.random, cameraRight = new THREE.Vector3(1, 0, 0) }) {
  const minds = troopers.map((trooper, index) => ({ trooper, post: posts[index] ?? {} }));
  let firing = 0, grenadeClock = Infinity, clock = 0, tick = 1 / 60, roleClock = Infinity;
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3();

  function reset() {
    firing = 0;
    grenadeClock = Infinity;
    roleClock = Infinity;
    for (const mind of minds) {
      const { trooper, post } = mind;
      Object.assign(mind, {
        mode: 'calm', awareness: 0, interest: null, lastKnown: new THREE.Vector3(), seen: Infinity, sees: false,
        tactic: null, timer: 0, cover: null, previousCover: null, burst: 0, gap: 0, cycles: 0, maxCycles: 3, token: false,
        startle: 0, callout: null, routeIndex: 0, wait: 0, strafe: random() < 0.5 ? 1 : -1, step: 0, glance: 0, heard: 0,
        aimPoint: new THREE.Vector3(), progress: { at: new THREE.Vector3(), time: 0 }, searchTime: 0, side: 1, grenadeClock: Infinity, thrown: false,
        home: (post.position ?? trooper.root.position).clone(), homeHeading: post.heading ?? trooper.heading, route: post.route ?? null,
        role: null, path: null, stance: 'stand', detour: 0, detourSide: new THREE.Vector3(), stuck: { at: new THREE.Vector3(), time: 0, stamp: -1 }, stuckCount: 0, advanceTo: null,
      });
    }
    alerts?.clear();
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
      if (distance < senses.sight) {
        const facing = new THREE.Vector3(Math.sin(t.heading), 0, Math.cos(t.heading));
        const angle = facing.angleTo(to);
        // Once he has seen the hero, he keeps track of him all around.
        const tracking = mind.mode === 'combat' && mind.seen < 1.5;
        // Right next to him, he feels someone there even behind his back.
        const field = tracking ? 1 : angle < senses.cone ? 1 : angle < senses.peripheral ? 0.35 : distance < 1.8 ? 0.5 : 0;
        if (field > 0 && (lab.clear(eye, chest) || lab.clear(eye, head))) {
          sees = true;
          // Closer, moving faster, blade lit: noticed sooner.
          rate = field * (1 - distance / senses.sight) ** 0.6 / senses.notice * (1 + Math.min(heroSpeed, 4.5) / 4.5 * 0.6 + saber * 0.3);
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
      if (mind.mode !== 'combat' && t.free) { mind.lastKnown.copy(at); alert(mind, cues); }
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
  function alert(mind, cues) {
    const t = mind.trooper;
    const fresh = mind.mode !== 'combat';
    mind.mode = 'combat';
    mind.awareness = 1;
    mind.tactic = null;
    mind.searchTime = 0;
    mind.startle = pick(FEEL.ai.startle, random);
    alerts?.show(t, '!', { hold: 1.4 });
    if (!fresh) return;
    cues.push({ type: 'alert', trooper: t });
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

  // ---- Getting about -------------------------------------------------------
  /**
   * Sets his steps towards a point — along a path round the crates and walls
   * when there is a navigation grid — clear of squadmates; true once there.
   * Stopped while trying to move, he steps aside and finds another way.
   */
  function steer(mind, target, speed, arrive = 0.25) {
    const t = mind.trooper, o = t.order, at = flat(t.root.position);
    const goal = flat(target), to = goal.clone().sub(at), distance = to.length();
    if (distance < arrive) { o.velocity.set(0, 0, 0); mind.path = null; return true; }
    const direction = to.clone().divideScalar(distance);
    const plain = distance < 1.6 && !lab.segmentHit(temp.copy(at).setY(0.45), temp2.copy(goal).setY(0.45));
    if (nav && !plain) {
      let way = mind.path;
      if (!way || way.goal.distanceTo(goal) > 0.6 || (way.age += tick) > 1.5) mind.path = way = { goal, points: nav.path(at, goal) ?? [], age: 0 };
      while (way.points.length > 1 && at.distanceTo(way.points[0]) < 0.3) way.points.shift();
      const next = way.points[0];
      if (next && at.distanceTo(next) > 1e-3) direction.copy(next).sub(at).normalize();
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
    // Keep clear of squadmates.
    for (const other of troopers) {
      if (other === t || other.fallen) continue;
      const away = at.clone().sub(flat(other.root.position)), gap = away.length();
      if (gap < 0.95 && gap > 1e-4) direction.addScaledVector(away.divideScalar(gap), (0.95 - gap) * 2);
    }
    direction.normalize();
    o.velocity.copy(direction).multiplyScalar(speed * Math.min(1, distance / 0.8 + 0.25));
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
  /** Is a crouching man at `spot` hidden from the hero by a crate? */
  function covered(spot, threat) {
    const hit = lab.segmentHit(temp.copy(threat).setY(1.45), temp2.copy(spot).setY(1.0));
    return Boolean(hit);
  }
  /** Where the rest of the squad stands, seen from the hero (unit vectors). */
  function bearings(mind, threat) {
    return minds.filter(other => other !== mind && other.mode === 'combat' && !other.trooper.dead)
      .map(other => flat(other.cover?.position ?? other.trooper.root.position).sub(flat(threat)).normalize());
  }
  function chooseCover(mind) {
    const t = mind.trooper, at = flat(t.root.position), threat = mind.lastKnown;
    const [near, far] = mind.role === 'flanker' ? FEEL.ai.flankRange : FEEL.ai.range;
    const others = bearings(mind, threat);
    let best = null, bestScore = Infinity;
    for (const spot of lab.coverSpots(threat, { minDistance: near - 0.5 })) {
      if (minds.some(other => other !== mind && other.cover && !other.trooper.dead && other.cover.position.distanceTo(spot.position) < 1.1)) continue;
      const travel = at.distanceTo(spot.position);
      if (travel > 10) continue;
      const range = spot.position.distanceTo(threat);
      // The way there should not run past the hero.
      const line = new THREE.Line3(at, spot.position), closest = line.closestPointToPoint(threat, true, new THREE.Vector3());
      const exposed = closest.distanceTo(threat) < 2.2 ? 5 : 0;
      // Spread round him: no two on the same line; a flanker wants his side.
      const bearing = flat(spot.position).sub(flat(threat)).normalize();
      const crowd = others.reduce((sum, other) => sum + (bearing.angleTo(other) < 0.55 ? 2.2 : 0), 0);
      const flank = mind.role === 'flanker' && others.length ? (Math.min(...others.map(other => bearing.angleTo(other))) > 1 ? -2.5 : 1.5) : 0;
      const score = travel * 0.75 + (range < near ? (near - range) * 3 : range > far ? (range - far) * 1.2 : Math.abs(range - (near + far) / 2) * 0.3) + exposed
        + crowd + flank + (mind.previousCover && spot.position.distanceTo(mind.previousCover.position) < 0.5 ? 4 : 0) + random() * 0.8;
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
  /** Would a bolt from his rifle reach the target, or hit a crate first? */
  const lineOfFire = (t, target) => lab.clear(t.muzzle, target);
  function take(mind) {
    if (mind.token) return true;
    if (firing >= FEEL.blaster.firing) return false;
    firing++;
    mind.token = true;
    return true;
  }
  function release(mind) {
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
    // A beat to listen, then he goes to see, rifle up.
    if (mind.timer < 0.8 || mind.awareness < 0.5) { o.face = headingTo(t.root.position, point); return; }
    mind.aimPoint.copy(point).setY(CHEST);
    o.aim = true;
    o.aimAt = mind.aimPoint;
    if (steer(mind, point, PACE.walk * 0.8, 1.4)) {
      // There: he sweeps the area with his rifle.
      mind.glance += dt;
      mind.aimPoint.copy(point).add(new THREE.Vector3(Math.sin(mind.glance * 1.3) * 2.5, 0, Math.cos(mind.glance * 1.1) * 2.5)).setY(CHEST);
      o.face = headingTo(t.root.position, mind.aimPoint);
      mind.awareness = Math.max(0, mind.awareness - dt * 0.12);
    }
  }
  function search(mind, dt) {
    const t = mind.trooper, o = t.order;
    mind.searchTime += dt;
    mind.aimPoint.copy(mind.lastKnown).setY(CHEST);
    o.aim = true;
    o.aimAt = mind.aimPoint;
    if (steer(mind, mind.lastKnown, PACE.walk, 1.6)) {
      mind.glance += dt;
      mind.aimPoint.add(new THREE.Vector3(Math.sin(mind.glance * 1.4) * 3, 0, Math.cos(mind.glance * 1.2) * 3));
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
   * that whizzes past; blind (the rifle up over his cover), only roughly his way.
   */
  function shoot(mind, hero, heroVelocity, shots, { blind = false } = {}) {
    const t = mind.trooper;
    const aimAt = blind ? flat(mind.lastKnown).add(new THREE.Vector3((random() - 0.5) * 2.4, 0, (random() - 0.5) * 2.4)).setY(CHEST + (random() - 0.4) * 0.8) : new THREE.Vector3().copy(hero).setY(CHEST);
    // Never into his own cover, never through a squadmate.
    if (!lineOfFire(t, aimAt) || friendInLine(t, t.muzzle, aimAt)) return false;
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
    // A wide shot that would clip his own crate goes straight at the chest instead.
    if (lab.segmentHit(shot.from, temp.copy(shot.from).addScaledVector(direction, Math.min(3, distance)))) direction.copy(hero).setY(CHEST).sub(shot.from).normalize();
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
    const fighters = minds.filter(mind => mind.mode === 'combat' && !mind.trooper.dead && !mind.trooper.impaled);
    fighters.sort((a, b) => flat(a.trooper.root.position).distanceTo(flat(hero)) - flat(b.trooper.root.position).distanceTo(flat(hero)));
    const roles = rolesFor(fighters.length);
    fighters.forEach((mind, index) => { mind.role = roles[index % roles.length]; });
  }
  /** Where a rusher or a flanker heads: short of the hero, or round to his side. */
  function approach(mind, threat) {
    const at = flat(mind.trooper.root.position), from = flat(threat), away = at.clone().sub(from);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize();
    if (mind.role === 'flanker') {
      // Round to whichever side is further from the rest of the squad.
      const others = bearings(mind, threat), mean = others.reduce((sum, b) => sum.add(b), new THREE.Vector3());
      const left = away.clone().applyAxisAngle(UP, 1.2), right = away.clone().applyAxisAngle(UP, -1.2);
      const side = mean.lengthSq() > 1e-4 ? (left.dot(mean) < right.dot(mean) ? left : right) : (mind.strafe > 0 ? left : right);
      away.copy(side);
    }
    const range = mind.role === 'flanker' ? FEEL.ai.flankRange[0] + 0.8 : FEEL.ai.advance;
    const goal = from.addScaledVector(away, range);
    return nav && !nav.walkable(goal) ? from.clone().add(away.multiplyScalar(range * 0.6)) : goal;
  }
  /** Rifle up and a burst: kneeling, standing, or blind over his cover. */
  function stanceOrders(mind, o) {
    o.crouch = mind.stance !== 'stand';
    o.aim = mind.stance !== 'blind';
    o.blind = mind.stance === 'blind';
    o.over = o.blind && mind.cover?.box ? mind.cover.box.max.y + 0.22 : null;
  }
  function fight(mind, dt, hero, heroVelocity, shots) {
    const t = mind.trooper, o = t.order, at = t.root.position;
    const threat = mind.sees ? hero : mind.lastKnown;
    mind.aimPoint.copy(threat).setY(CHEST);
    o.aimAt = mind.aimPoint;
    o.look = temp.copy(threat).setY(HEAD).clone();
    if (mind.startle > 0) { mind.startle -= dt; o.face = headingTo(at, threat); return; }
    // Lost him for long: go and look where he was.
    if (mind.seen > FEEL.ai.search) {
      release(mind);
      mind.mode = 'searching';
      mind.searchTime = 0;
      mind.glance = 0;
      mind.cover = null;
      mind.tactic = null;
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
    if (mind.stuckCount >= 3) { mind.stuckCount = 0; release(mind); mind.tactic = null; }
    const distance = flat(at).distanceTo(flat(threat));
    if (mind.sees && distance < FEEL.ai.close && t.holding && mind.tactic !== 'evade') { release(mind); mind.tactic = 'evade'; mind.timer = 0; }
    // Out of sight a moment: after him, at a run.
    if (!mind.sees && mind.seen > FEEL.ai.pursue && t.holding && !['pursue', 'throw', 'blindUp', 'fire', 'evade'].includes(mind.tactic)) {
      release(mind);
      mind.tactic = 'pursue';
      mind.cover = null;
      mind.peek = null;
      mind.timer = 0;
    }
    if (!mind.tactic) {
      mind.previousCover = mind.cover;
      mind.cover = mind.role === 'rusher' && t.holding ? null : chooseCover(mind);
      mind.tactic = mind.cover ? 'move' : t.holding ? 'advance' : 'cower';
      mind.cycles = 0;
      mind.maxCycles = Math.round(pick(FEEL.ai.cycles, random));
      mind.timer = 0;
      mind.advanceTo = null;
    }
    switch (mind.tactic) {
      case 'move': {
        release(mind);
        const cover = mind.cover;
        // Running for it; he slows to a walk for the last steps.
        const there = steer(mind, cover.position, flat(at).distanceTo(cover.position) > 1.4 ? PACE.run : PACE.walk, 0.22);
        if (there) { mind.tactic = 'hide'; mind.timer = pick(FEEL.ai.hide, random) * 0.5; }
        break;
      }
      case 'hide': {
        release(mind);
        o.crouch = true;
        o.face = headingTo(at, threat);
        mind.timer -= dt;
        if (!covered(mind.cover.position, threat)) { mind.tactic = null; break; }
        // The hero has moved off: a cover nearer him.
        if (flat(mind.cover.position).distanceTo(flat(threat)) > FEEL.ai.range[1] + 2) { mind.tactic = null; break; }
        if (mind.timer > 0) break;
        if (!t.holding) break;
        if (mind.cycles >= mind.maxCycles) { mind.tactic = null; break; }
        if (wantsGrenade(mind, threat, distance)) { mind.tactic = 'throw'; mind.timer = 0; mind.thrown = false; break; }
        if (take(mind)) {
          // Blind over a low crate now and then; otherwise up behind it, or out past its edge.
          if (!mind.cover.tall && random() < FEEL.ai.blind) { mind.stance = 'blind'; mind.tactic = 'blindUp'; mind.timer = 0; break; }
          const spot = peekFrom(mind, threat);
          if (!spot) {
            if (!mind.cover.tall) { mind.stance = 'blind'; mind.tactic = 'blindUp'; mind.timer = 0; break; }
            release(mind); mind.tactic = null; break;
          }
          mind.peekAt = spot;
          mind.peek = spot.distanceTo(mind.cover.position) < 0.05 ? null : spot;
          mind.retries = 0;
          mind.stance = 'stand';
          mind.tactic = 'peek';
          mind.timer = 0;
        } else mind.timer = 0.2;
        break;
      }
      case 'blindUp': {
        // Rifle up over the crate, head down.
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (t.reaction.blind > 0.85) {
          if (!lineOfFire(t, temp2.copy(threat).setY(CHEST))) { mind.stance = 'stand'; mind.tactic = 'hide'; mind.timer = 0.1; release(mind); break; }
          mind.tactic = 'fire';
          mind.burst = Math.round(pick(FEEL.ai.blindBurst, random));
          mind.gap = 0.05;
        }
        if (mind.timer > 1.2) { release(mind); mind.stance = 'stand'; mind.tactic = 'hide'; mind.timer = 0.2; }
        break;
      }
      case 'peek': {
        // Up (or out), rifle to the shoulder.
        if (mind.peek && !steer(mind, mind.peek, PACE.walk, 0.2)) { o.face = headingTo(at, threat); mind.timer += dt; if (mind.timer > 2) { release(mind); mind.tactic = null; } break; }
        o.aim = true;
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (t.reaction.aim > 0.85 && (mind.sees || mind.timer > 0.6)) {
          // The crate is in the way of his rifle: another spot, or another cover.
          if (!lineOfFire(t, temp2.copy(threat).setY(CHEST))) {
            const next = mind.retries++ < 3 ? peekFrom(mind, threat, mind.peekAt) : null;
            if (!next) { release(mind); mind.tactic = null; break; }
            mind.peekAt = next;
            mind.peek = next.distanceTo(mind.cover.position) < 0.05 ? null : next;
            mind.timer = 0;
            break;
          }
          mind.tactic = 'fire';
          mind.burst = Math.round(pick(FEEL.blaster.burst, random));
          mind.gap = 0.04 + random() * 0.06;
        }
        if (mind.timer > 1.6) { release(mind); mind.tactic = 'hide'; mind.timer = 0.2; }
        break;
      }
      case 'advance': {
        // A rusher closes in, a flanker swings round; then he stops to fire.
        release(mind);
        mind.timer += dt;
        if (!mind.advanceTo || mind.timer % 1 < dt) mind.advanceTo = approach(mind, threat);
        const there = steer(mind, mind.advanceTo, PACE.run, 0.45);
        if (there) o.face = headingTo(at, threat);
        const inRange = distance < (mind.role === 'flanker' ? FEEL.ai.flankRange[1] : FEEL.ai.advance + 2.5);
        // Hiding from him: a grenade to flush him out.
        if (!mind.sees && wantsGrenade(mind, threat, distance)) { mind.tactic = 'throw'; mind.timer = 0; mind.thrown = false; break; }
        if (mind.sees && (there || (inRange && mind.timer > 1.1) || mind.timer > 3.5) && take(mind)) {
          mind.stance = random() < FEEL.ai.kneel ? 'kneel' : 'stand';
          mind.tactic = 'aimOpen';
          mind.timer = 0;
        } else if (there && !mind.sees) mind.tactic = 'pursue';
        break;
      }
      case 'aimOpen': {
        // Kneeling or standing, the rifle comes up.
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        mind.timer += dt;
        if (mind.timer > 1.4 || !mind.sees) { release(mind); mind.tactic = null; mind.stance = 'stand'; break; }
        const settled = t.reaction.aim > 0.85 && (mind.stance !== 'kneel' || t.reaction.crouch > 0.7);
        if (!settled) break;
        // Kneeling, a crate may be in the way: up he gets; standing too, he moves on.
        if (!lineOfFire(t, temp2.copy(threat).setY(CHEST))) {
          if (mind.stance === 'kneel') mind.stance = 'stand';
          else { release(mind); mind.tactic = 'advance'; mind.timer = 0; mind.advanceTo = null; }
          break;
        }
        mind.tactic = 'fire';
        mind.burst = Math.round(pick(FEEL.blaster.burst, random)) + (mind.stance === 'kneel' ? 1 : 0);
        mind.gap = 0.04;
        break;
      }
      case 'fire': {
        stanceOrders(mind, o);
        o.face = headingTo(at, threat);
        if (mind.peek) steer(mind, mind.peek, PACE.walk, 0.15);
        mind.gap -= dt;
        if (mind.gap <= 0 && mind.burst > 0) {
          const blind = mind.stance === 'blind';
          // Blocked (the hero moved behind something, or a squadmate is in the way): the burst stops there.
          if ((blind || mind.sees) && !shoot(mind, hero, heroVelocity, shots, { blind })) mind.burst = 1;
          if (!blind && !mind.sees) mind.burst = 1;
          mind.burst--;
          mind.gap = pick(blind ? FEEL.ai.blindGap : FEEL.blaster.gap, random);
        }
        if (mind.burst <= 0 && mind.gap <= 0) {
          release(mind);
          mind.cycles++;
          const fromCover = mind.cover && (mind.stance === 'blind' || mind.peekAt);
          mind.stance = 'stand';
          if (fromCover) { mind.tactic = 'back'; mind.timer = pick(FEEL.ai.hide, random); }
          else { mind.tactic = mind.cycles >= mind.maxCycles ? null : 'advance'; mind.timer = 0; mind.advanceTo = null; }
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
        // After him: to where he was last seen, at a run, stopping short.
        release(mind);
        mind.timer += dt;
        const from = flat(mind.lastKnown), away = flat(at).sub(from);
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        const goal = from.addScaledVector(away.normalize(), 2.5);
        const there = steer(mind, goal, PACE.run, 0.5);
        o.face = there ? headingTo(at, threat) : null;
        if (mind.sees) { mind.tactic = null; break; }
        if (there) { mind.glance += dt; o.face = headingTo(at, threat) + Math.sin(mind.glance * 2) * 0.8; }
        break;
      }
      case 'evade': {
        // Too close: he backs off, firing from the hip as he goes.
        o.face = headingTo(at, threat);
        o.aim = true;
        const away = flat(at).sub(flat(threat)).normalize();
        steer(mind, flat(at).addScaledVector(away, 2).addScaledVector(new THREE.Vector3(-away.z, 0, away.x), mind.strafe * 0.8), PACE.walk * 1.3, 0.1);
        mind.timer += dt;
        mind.gap -= dt;
        if (mind.gap <= 0 && mind.sees && t.reaction.aim > 0.7 && take(mind)) {
          shoot(mind, hero, heroVelocity, shots);
          mind.gap = 0.22 + random() * 0.22;
          release(mind);
        }
        if (distance > FEEL.ai.close + 1.6 || mind.timer > 2.5) mind.tactic = null;
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
            if (t.throwGrenade(target)) { mind.thrown = true; grenadeClock = 0; mind.grenadeClock = 0; }
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

  function update(dt, { hero, heroVelocity = new THREE.Vector3(), saber = 0, noises = [] }) {
    const shots = [], cues = [];
    tick = dt;
    clock += dt;
    grenadeClock += dt;
    // Parts in the fight, handed out again now and then as the fight moves.
    if ((roleClock += dt) > 4 || minds.some(mind => mind.mode === 'combat' && !mind.role)) { roleClock = 0; assignRoles(hero); }
    for (const mind of minds) mind.grenadeClock += dt;
    const heroSpeed = Math.hypot(heroVelocity.x, heroVelocity.z);
    for (const mind of minds) {
      const t = mind.trooper, o = t.order;
      // Dead, or dying on the blade: out of the fight for good.
      if (t.dead || t.impaled) { release(mind); alerts?.hide(t); mind.mode = 'dead'; continue; }
      perceive(mind, dt, hero, heroSpeed, saber, noises, cues);
      o.velocity.set(0, 0, 0);
      o.face = null;
      o.look = null;
      o.aim = false;
      o.crouch = false;
      o.blind = false;
      o.aimAt = mind.aimPoint;
      // In the Force's grip, on the floor, running off: he is not his own master.
      if (!t.free) {
        release(mind);
        if (mind.tactic !== 'move') mind.tactic = null;
        mind.peek = null;
        continue;
      }
      if (mind.mode === 'calm') patrol(mind, dt);
      else if (mind.mode === 'suspicious') investigate(mind, dt);
      else if (mind.mode === 'searching') { if (mind.sees && mind.awareness >= 1) alert(mind, cues); else search(mind, dt); }
      else if (mind.mode === 'combat') fight(mind, dt, hero, heroVelocity, shots);
    }
    return { shots, cues };
  }
  /** The squad's mood: 'calme', 'suspicion' or 'alerte'. */
  const mood = () => (minds.some(mind => mind.mode === 'combat') ? 'alerte' : minds.some(mind => mind.mode === 'suspicious' || mind.mode === 'searching') ? 'suspicion' : 'calme');
  return { update, reset, minds, mood };
}
