class_name SquadMind
extends RefCounted
## The squad's minds (port of src/trooper-ai.js). Each trooper sees — a cone
## in front of him, wider but weaker at the corner of his eye, blocked by
## crates — and hears: footsteps at a run, the blade, blows, the Force,
## shots. What he senses fills his awareness: past a little he is suspicious
## ("?"): he stops, turns towards it, then goes to have a look, rifle up;
## full, he has spotted the hero ("!"): he flinches, calls it out on the
## radio, and fights.
##
## They fight as a team, under a plan the squad leader revises four times a
## second (_coordinate()): the one nearest the hero rushes him, two swing
## round his flanks, the rest hold cover; under fire only some move at a time
## while the others cover them, their bursts staggered; the hero gone behind
## cover, the anchors keep him pinned while the others work round to him; the
## Jedi among them, the man he goes for backs away firing from the hip and the
## others spread round him; too many lost too fast, they fall back. A man down
## and hurt: the nearest free squadmate drags him behind a crate and treats
## him. A squadmate found lying there, or the hero lost for good: the squad
## searches the hiding places round it.
##
## An anchor runs to cover, crouches, comes up — standing behind the crate,
## leaning out past it, or holding his rifle up over it for a blind burst —
## takes aim (`charge`: the glint at his muzzle), fires, ducks back; after a
## few bursts, or as soon as the hero flanks him, he moves on. Nobody fires
## through a squadmate, nor into his own cover. Out of sight is out of sight:
## a man who has not seen the hero for a while and does not face him is
## caught unaware (`trooper.unaware`: the first blow of the blade kills him).
##
## update(dt, hero, ...) writes each trooper's orders and returns the shots
## fired and the moments worth a sound: { shots, cues }.
## tests/test_squad.gd replays a trace of the web's squad.

## Heights: the hero's chest and head; the muzzle of a shouldered rifle (a little low, to be safe).
const CHEST := 1.05
const HEAD := 1.55
const MUZZLE := 1.1
## Parts in a fight, nearest the hero first (a lone trooper holds cover; two, one of them flanks).
const ROLES := ["rusher", "flanker", "anchor", "flanker", "anchor"]
## Moves that need the squad's leave under fire (someone must be covering).
const MOVING := ["move", "advance", "pursue"]
## Busy with something that should not be cut short by a new plan.
const COMMITTED := ["throw", "fire", "blindUp", "evade", "spread"]
const PACE := Stormtrooper.PACE

var troopers: Array = []
var lab: Obstacles
var nav: Nav
var alerts: Object
var draw: Callable
var camera_right := Vector3(1, 0, 0)
var feel: Dictionary
var minds: Array[Dictionary] = []
## Who is going to whom: a man down and hurt → his rescuer's mind.
var rescuers := {}
var firing := 0
var grenade_clock := INF
var clock := 0.0
var tick := 1.0 / 60.0
var role_clock := INF
var dark := 0.0
var open := 1.0
var _ids := 0
## The squad leader's plan (_coordinate()).
var plan := {}


static func _flat(v: Vector3) -> Vector3:
	return Vector3(v.x, 0, v.z)


static func _wrap(angle: float) -> float:
	return atan2(sin(angle), cos(angle))


static func _heading_to(from: Vector3, to: Vector3) -> float:
	return atan2(to.x - from.x, to.z - from.z)


## As three.js's Vector3.angleTo.
static func _angle(a: Vector3, b: Vector3) -> float:
	var denominator := sqrt(a.length_squared() * b.length_squared())
	if denominator == 0.0:
		return PI / 2.0
	return acos(clampf(a.dot(b) / denominator, -1.0, 1.0))


## As three.js's Line3.closestPointToPoint (clamped to the segment).
static func _closest_on(start: Vector3, end: Vector3, point: Vector3) -> Vector3:
	var along := end - start
	var t := clampf(along.dot(point - start) / along.dot(along), 0.0, 1.0)
	return start + along * t


static func _roles_for(count: int) -> Array:
	return ["anchor"] if count == 1 else (["flanker", "anchor"] if count == 2 else ROLES)


## posts: per trooper { position, heading, route } (as in lab.json).
func _init(squad: Array, level: Obstacles, grid: Nav = null, signs: Object = null, posts: Array = [], random: Callable = Callable(), right: Vector3 = Vector3(1, 0, 0), feel_data: Dictionary = {}) -> void:
	troopers = squad
	lab = level
	nav = grid
	alerts = signs
	draw = random if random.is_valid() else func() -> float: return randf()
	camera_right = right
	feel = feel_data if not feel_data.is_empty() else CombatController._load("res://assets/data/feel.json")
	for index in troopers.size():
		minds.append(_make(troopers[index], posts[index] if index < posts.size() else {}))
	reset()


func _random() -> float:
	return draw.call()


func _pick(value: Variant) -> float:
	if value is Array:
		return value[0] + (value[1] - value[0]) * _random()
	return float(value)


func _make(trooper: Stormtrooper, post: Dictionary) -> Dictionary:
	_ids += 1
	return { "id": _ids, "trooper": trooper, "post": post }


## A mind as at the start: calm, at his post.
func _fresh(mind: Dictionary) -> void:
	var t: Stormtrooper = mind.trooper
	var post: Dictionary = mind.post
	mind.merge({
		"mode": "calm", "awareness": 0.0, "interest": null, "last_known": Vector3.ZERO, "seen": INF, "sees": false,
		"tactic": null, "timer": 0.0, "cover": null, "previous_cover": null, "burst": 0, "gap": 0.0, "cycles": 0, "max_cycles": 3, "token": false,
		"startle": 0.0, "callout": null, "route_index": 0, "wait": 0.0, "strafe": 1.0 if _random() < 0.5 else -1.0, "step": 0, "glance": 0.0, "heard": 0.0,
		"aim_point": Vector3.ZERO, "search_time": 0.0, "side": 1.0, "grenade_clock": INF, "thrown": false,
		"home": post.get("position", t.root.position), "home_heading": post.get("heading", t.heading_of()), "route": post.get("route"),
		"role": null, "path": null, "stance": "stand", "detour": 0.0, "detour_side": Vector3.ZERO, "stuck": { "at": Vector3.ZERO, "time": 0.0, "stamp": -1.0 }, "stuck_count": 0, "advance_to": null,
		"entering": null, "threshold": null, "dir": null, "marching": 0.0,
		# The fight: the aim before a burst (charge 0 → 1), his flank, what went wrong lately.
		"charge": 0.0, "windup": 0.0, "windup_total": 1.0, "flank_side": 0.0, "no_blind": 0.0, "aim_fails": 0, "cover_time": 0.0, "suppressed": false, "suppressing": false, "fell_back": false, "spread_to": null, "mourned": false, "reposition": false,
		"spread_again": 0.0, "plans": 0.0, "rescue": null, "rescue_ready": 0.0, "armed": false, "peek": null, "peek_at": null, "retries": 0,
		# The bodies he has seen; the hiding place he is searching.
		"known": {}, "point": null,
	}, true)


func reset() -> void:
	firing = 0
	grenade_clock = INF
	role_clock = INF
	plan = {
		"clock": 0.0, "movers": {}, "threat": Vector3.ZERO, "axis": Vector3(1, 0, 0), "seen": false, "fighting": 0,
		"scatter": false, "fallback": 0.0, "losses": [], "last_burst": -INF, "last_fire": -INF, "cover_call": INF, "lost": false,
		# The search under way (null when none): where, which hiding places, until when.
		"sweep": null,
	}
	for mind in minds:
		_fresh(mind)
	rescuers.clear()
	if alerts:
		alerts.clear()


## A newcomer: marched in along `entering` (points), then on his own.
func add(trooper: Stormtrooper, post: Dictionary = {}, entering: Variant = null) -> Dictionary:
	if not troopers.has(trooper):
		troopers.append(trooper)
	var mind := _make(trooper, post)
	_fresh(mind)
	mind.entering = (entering as Array).duplicate() if entering != null else null
	mind.threshold = mind.entering[0] if mind.entering != null and not mind.entering.is_empty() else null
	minds.append(mind)
	return mind


## Out of the squad for good (a body cleared away).
func remove(trooper: Stormtrooper) -> void:
	for index in minds.size():
		var mind := minds[index]
		if mind.trooper == trooper:
			_end_rescue(mind)
			_release(mind)
			plan.movers.erase(mind.id)
			if alerts:
				alerts.dismiss(trooper)
			minds.remove_at(index)
			break
	troopers.erase(trooper)


func _mind_of(trooper: Stormtrooper) -> Variant:
	for mind in minds:
		if mind.trooper == trooper:
			return mind
	return null


## Marching in through the door, rifle at low ready; at the end of the way (or too long on it), his own man.
func _march(mind: Dictionary, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var next: Vector3 = mind.entering[0]
	var to := _flat(next) - _flat(t.root.position)
	var distance := to.length()
	mind.marching += tick
	# The squad is fighting: through the door and a few steps in, he goes straight into it.
	var fighter: Variant = null
	for other in minds:
		if other.mode == "combat" and not is_same(other, mind) and not other.trooper.dead:
			fighter = other
			break
	# Still on his way through the doorway (more of it ahead): not yet in.
	var inside := false
	if not (mind.threshold != null and mind.entering.size() > 1):
		inside = mind.threshold == null or _flat(t.root.position).distance_to(_flat(mind.threshold)) > 1.2
	if fighter != null and inside and t.is_free():
		mind.entering = null
		mind.last_known = fighter.last_known
		_alert(mind, cues)
		return
	if distance < 0.3 or mind.marching > 8.0:
		mind.entering.pop_front()
		if mind.marching > 8.0:
			mind.entering.clear()
		if mind.entering.is_empty():
			mind.entering = null
			if fighter != null:
				mind.last_known = fighter.last_known
				_alert(mind, cues)
			else:
				_look_for_bodies(mind, cues)
		return
	o.velocity = to / distance * (PACE.run * 0.8)
	# In file, not on each other's heels.
	for other: Stormtrooper in troopers:
		if other == t or other.fallen:
			continue
		var away := _flat(t.root.position) - _flat(other.root.position)
		var gap := away.length()
		if gap < 0.8 and gap > 1e-4 and away.dot(o.velocity) < 0.0:
			o.velocity = o.velocity * maxf(0.15, gap / 0.8)
		elif gap <= 1e-4:
			o.velocity = o.velocity * 0.5
	o.face = _heading_to(t.root.position, next)


# ---- Senses --------------------------------------------------------------

func _perceive(mind: Dictionary, dt: float, hero: Vector3, hero_speed: float, saber: float, noises: Array, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var senses: Dictionary = feel.senses
	var chest := Vector3(hero.x, CHEST, hero.z)
	var head := Vector3(hero.x, HEAD, hero.z)
	var sees := false
	var rate := 0.0
	if t.is_free():
		var eye := t.eye()
		var to := _flat(chest) - _flat(eye)
		var distance := to.length()
		var facing := Vector3(sin(t.heading_of()), 0, cos(t.heading_of()))
		var angle := _angle(facing, to)
		# In the dark he sees only so far — further the hero's lit blade, and down his own lamp's beam.
		var b: Dictionary = feel.blackout
		var range_base: float
		if dark < 0.5:
			range_base = senses.sight
		elif angle < 0.4:
			range_base = maxf(8.5, b.saberSight if saber > 0.5 else 0.0)
		else:
			range_base = b.saberSight if saber > 0.5 else b.sight
		var sight_range: float = range_base * (maxf(0.8, open) if saber > 0.5 else open)
		if distance < sight_range:
			# Having just seen him, he follows where he went — for a moment: gone behind a crate, he is lost.
			var tracking: bool = mind.mode == "combat" and mind.seen < senses.track
			# Behind his back he sees nothing; only someone running right up to him is felt.
			var field := 0.0
			if tracking:
				field = 1.0
			elif angle < senses.cone:
				field = 1.0
			elif angle < senses.peripheral:
				field = 0.35
			elif distance < senses.feel and hero_speed > senses.rush:
				field = 0.5
			# Hidden behind a crate he is not seen; his head alone over it is noticed only close by, and slowly.
			var chest_seen: bool = field > 0.0 and lab.clear(eye, chest)
			var head_seen: bool = field > 0.0 and not chest_seen and distance < senses.glimpse and lab.clear(eye, head)
			if chest_seen or head_seen:
				sees = true
				# Closer, moving faster, blade lit: noticed sooner.
				rate = field * (senses.peek if head_seen else 1.0) * pow(1.0 - distance / sight_range, 0.6) / senses.notice * (1.0 + minf(hero_speed, 4.5) / 4.5 * 0.6 + saber * 0.3) * open
	mind.sees = sees
	if sees:
		mind.seen = 0.0
		mind.awareness = 1.0 if mind.mode == "combat" else mind.awareness + rate * dt
		mind.interest = _flat(hero)
		if mind.awareness >= 1.0:
			mind.last_known = _flat(hero)
	else:
		mind.seen += dt
	# Hearing: louder and nearer counts more; violence close by is an alarm.
	mind.heard = maxf(0.0, mind.heard - dt)
	for noise in noises:
		var distance := _flat(noise.position).distance_to(_flat(t.root.position))
		if distance > noise.radius or noise.get("source") == t:
			continue
		var loud: float = (1.0 - distance / noise.radius) * noise.get("strength", 1.0)
		# Heard, not seen: roughly where it was — the fainter, the vaguer.
		var heard_at := func(point: Vector3, height: float = 0.0) -> Vector3:
			var error: float = (1.0 - loud) * distance * feel.senses.hearing
			var angle := _random() * PI * 2.0
			var at := _flat(point) + Vector3(sin(angle) * error, 0, cos(angle) * error)
			at.y = height
			return at
		if mind.mode != "combat":
			mind.awareness = minf(1.0 if noise.get("alarm", false) else 0.92, mind.awareness + loud * 0.55)
			mind.interest = heard_at.call(noise.position)
			if noise.get("alarm", false) and loud > 0.3:
				mind.last_known = heard_at.call(noise.get("from") if noise.get("from") != null else noise.position)
		elif not sees and noise.get("from") != null and loud > 0.35:
			mind.last_known = heard_at.call(noise.from)
		if mind.heard <= 0.0 and t.is_free():
			mind.heard = 0.6
			if alerts:
				alerts.sound(t, (noise.position - t.root.position).dot(camera_right))
	# A squadmate's call.
	if mind.callout != null:
		mind.callout.delay -= dt
		if mind.callout.delay <= 0.0:
			var at: Vector3 = mind.callout.at
			mind.callout = null
			if mind.mode != "combat" and t.is_free():
				mind.last_known = at
				_alert(mind, cues, true)
	if not sees and mind.mode != "combat":
		mind.awareness = maxf(0.0, mind.awareness - senses.forget * dt)
	# Has not seen him for a while and does not face him: caught unaware.
	var facing_hero: bool = absf(_wrap(_heading_to(t.root.position, hero) - t.heading_of())) < senses.peripheral
	t.unaware = not sees and (mind.mode != "combat" or mind.seen > senses.unaware or not facing_hero)
	# A squadmate lying there: something has happened here.
	if t.is_free() and mind.mode != "combat":
		_look_for_bodies(mind, cues)
	# Moods.
	if mind.awareness >= 1.0 and mind.mode != "combat" and t.is_free():
		_alert(mind, cues)
	elif mind.mode == "calm" and mind.awareness >= senses.suspicious and t.is_free():
		mind.mode = "suspicious"
		mind.timer = 0.0
		mind.glance = 0.0
		if alerts:
			alerts.alert(t, "?")
		cues.append({ "type": "suspicious", "trooper": t })
		t.reaction.vhead -= 1.2
	elif mind.mode == "suspicious" and mind.awareness < 0.1:
		_calm(mind)


## Contact: he flinches and calls it out (quiet: told by a squadmate, he only turns to it).
func _alert(mind: Dictionary, cues: Array, quiet: bool = false) -> void:
	var t: Stormtrooper = mind.trooper
	var first: bool = mind.mode != "combat"
	# Whatever he was searching, someone else will.
	if mind.point != null:
		mind.point.taken = null
		mind.point = null
	# Told by a squadmate: he goes by what he was told (not straight off to search, having never seen him himself).
	if quiet:
		mind.seen = minf(mind.seen, feel.ai.pursue * 0.5)
	mind.mode = "combat"
	mind.awareness = 1.0
	mind.tactic = null
	mind.search_time = 0.0
	mind.startle = _pick(feel.ai.startle) * (0.6 if quiet else 1.0)
	plan.lost = false
	if alerts:
		alerts.alert(t, "!", 1.4)
	if not first:
		return
	cues.append({ "type": "joined" if quiet else "alert", "trooper": t })
	# The flinch: head and shoulders jerk as he sees the hero.
	t.reaction.vhead -= 3.0
	t.reaction.vpitch -= 1.4
	t.reaction.vbuckle += 0.8
	# He calls it out; the squad turns towards the threat.
	for other in minds:
		if is_same(other, mind) or other.mode == "combat" or other.trooper.dead:
			continue
		if other.trooper.root.position.distance_to(t.root.position) > feel.senses.callout:
			continue
		if other.callout == null:
			other.callout = { "delay": 0.3 + _random() * 0.6, "at": mind.last_known }


func _calm(mind: Dictionary) -> void:
	mind.mode = "calm"
	mind.awareness = 0.0
	mind.interest = null
	mind.tactic = null
	if alerts:
		alerts.dismiss(mind.trooper)


# ---- The squad's plan --------------------------------------------------------

## Fighters: in the fight, alive, in the room.
func _fighting() -> Array:
	return minds.filter(func(mind: Dictionary) -> bool: return mind.mode == "combat" and not mind.trooper.dead and not mind.trooper.is_impaled() and mind.entering == null)


func _coordinate(hero: Vector3, cues: Array) -> void:
	_assign_rescues(hero, cues)
	var fighters := _fighting()
	plan.fighting = fighters.size()
	if fighters.is_empty():
		plan.movers.clear()
		plan.scatter = false
		return
	plan.seen = fighters.any(func(mind: Dictionary) -> bool: return mind.sees)
	# Where the squad thinks he is: in sight, or the freshest sighting.
	if plan.seen:
		plan.threat = _flat(hero)
	else:
		var best: Dictionary = fighters[0]
		for mind in fighters:
			if mind.seen < best.seen:
				best = mind
		plan.threat = _flat(best.last_known)
	# Leave to move goes back once the move is over.
	for id in plan.movers.keys():
		var mover: Dictionary = plan.movers[id]
		if not fighters.any(func(m: Dictionary) -> bool: return is_same(m, mover)) or not MOVING.has(mover.tactic):
			plan.movers.erase(id)
	# The line from him to the squad: flankers take one side each.
	var centre := Vector3.ZERO
	for mind in fighters:
		centre += _flat(mind.trooper.root.position)
	centre /= fighters.size()
	var axis: Vector3 = centre - plan.threat
	axis.y = 0.0
	if axis.length_squared() < 1e-4:
		axis = Vector3(1, 0, 0)
	plan.axis = axis.normalized()
	for mind in fighters:
		if mind.role != "flanker":
			mind.flank_side = 0.0
			continue
		if mind.flank_side != 0.0:
			continue
		var across: Vector3 = _flat(mind.trooper.root.position) - plan.threat
		var own: float = signf(plan.axis.x * across.z - plan.axis.z * across.x)
		if own == 0.0:
			own = 1.0
		var taken := fighters.any(func(other: Dictionary) -> bool: return not is_same(other, mind) and other.role == "flanker" and other.flank_side == own)
		mind.flank_side = -own if taken else own
	# The Jedi among them: they scatter round him.
	plan.scatter = plan.seen and fighters.any(func(mind: Dictionary) -> bool: return _flat(mind.trooper.root.position).distance_to(plan.threat) < feel.ai.close + 0.8)
	# Too many lost too fast: they fall back.
	plan.losses = plan.losses.filter(func(at: float) -> bool: return clock - at < feel.ai.panic)
	if plan.fallback <= 0.0 and plan.losses.size() >= maxi(2, ceili((fighters.size() + plan.losses.size()) / 2.0)):
		plan.fallback = feel.ai.fallback
		plan.losses.clear()
		for mind in fighters:
			if not COMMITTED.has(mind.tactic):
				_release(mind)
				mind.tactic = null
				mind.fell_back = false
		var speaker: Dictionary = fighters[int(floor(_random() * fighters.size()))]
		cues.append({ "type": "radio", "radio": "move", "trooper": speaker.trooper })
	# Someone moving under fire: a squadmate who stays calls the covering fire.
	if clock >= plan.cover_call:
		plan.cover_call = INF
		for mind in fighters:
			if not plan.movers.has(mind.id) and mind.sees and mind.trooper.holding:
				cues.append({ "type": "radio", "radio": "cover", "trooper": mind.trooper })
				break


## Leave to move: under fire, only some at a time (the others cover them).
func _claim_move(mind: Dictionary, cues: Array) -> bool:
	if plan.movers.has(mind.id):
		return true
	# Those who have him in sight cover; one who cannot see him is free to move and find him.
	var most := maxi(1, roundi(plan.fighting * feel.ai.movers))
	if plan.seen and mind.sees and plan.movers.size() >= most:
		return false
	plan.movers[mind.id] = mind
	if plan.seen and plan.fighting > 1 and _random() < 0.6:
		cues.append({ "type": "radio", "radio": "flank" if mind.role == "flanker" else "move", "trooper": mind.trooper })
		plan.cover_call = minf(plan.cover_call, clock + 0.9)
	return true


# ---- A man down -----------------------------------------------------------

## Where a body lying on the floor is (its chest, on the floor).
static func _chest_of(body: Stormtrooper) -> Vector3:
	return _flat(body.particle("N").lerp(body.particle("W"), 0.45))


## A man down and hurt: the nearest free squadmate goes to him — not while the Jedi stands over him. Nobody left: he bleeds out.
func _assign_rescues(hero: Vector3, cues: Array) -> void:
	var R: Dictionary = feel.rescue
	for patient: Stormtrooper in troopers:
		if not patient.is_hurt():
			rescuers.erase(patient)
			continue
		var current: Variant = rescuers.get(patient)
		if current != null and current.rescue != null and current.rescue.patient == patient:
			continue
		rescuers.erase(patient)
		var able := minds.filter(func(mind: Dictionary) -> bool: return mind.trooper != patient and not mind.trooper.dead and not mind.trooper.is_hurt())
		if able.is_empty():
			patient.abandon()
			continue
		var at := _chest_of(patient)
		if at.distance_to(_flat(hero)) < R.safe:
			continue
		var best: Variant = null
		var best_distance: float = R.range
		for mind in able:
			var t: Stormtrooper = mind.trooper
			if mind.mode == "dead" or mind.rescue != null or not t.is_free() or mind.entering != null or COMMITTED.has(mind.tactic) or clock < mind.rescue_ready:
				continue
			if _flat(t.root.position).distance_to(_flat(hero)) < R.threat + 1.0:
				continue
			var distance := _flat(t.root.position).distance_to(at)
			if distance < best_distance:
				best_distance = distance
				best = mind
		if best == null:
			continue
		# A man shot down beside him is an alarm in itself: the shot came from the Jedi.
		if best.mode != "combat":
			best.last_known = _flat(hero)
			_alert(best, cues, true)
		_release(best)
		plan.movers.erase(best.id)
		best.tactic = null
		best.rescue = { "patient": patient, "stage": "go", "clock": 0.0, "to": null, "treat": 0.0, "pulse": 0.0 }
		rescuers[patient] = best
		cues.append({ "type": "radio", "radio": "cover", "trooper": best.trooper })


## Behind a crate near the man down, out of the Jedi's sight: where to drag him (null: treated where he lies).
func _haven(patient: Stormtrooper, hero: Vector3) -> Variant:
	var R: Dictionary = feel.rescue
	var from := _chest_of(patient)
	var best: Variant = null
	var best_score := INF
	for spot in lab.cover_spots(hero, 2.5):
		var position: Vector3 = spot.position
		var distance := position.distance_to(from)
		if distance > R.haven:
			continue
		if minds.any(func(other: Dictionary) -> bool: return other.cover != null and not other.trooper.dead and other.cover.position.distance_to(position) < 0.9):
			continue
		var score := distance + (5.0 if position.distance_to(_flat(hero)) < 4.0 else 0.0)
		if score < best_score:
			best_score = score
			best = position
	if best == null or best.distance_to(from) < 0.6:
		return null
	# He backs up past the spot, so that the man he drags ends on it.
	var to: Vector3 = best + (best - from).normalized() * 0.7
	if nav:
		if not nav.walkable(to):
			var near: Variant = nav.nearest(to)
			to = near if near != null else best
	return to


func _end_rescue(mind: Dictionary) -> void:
	var r: Variant = mind.rescue
	if r == null:
		return
	r.patient.drag(null)
	rescuers.erase(r.patient)
	mind.rescue = null
	mind.rescue_ready = clock + feel.rescue.cooldown
	mind.tactic = null


## To the man down, running; then backing away with him by the collar to the
## cover near by; then kneeling by him, a hand on his chest, until he is
## treated and gets up. The Jedi coming at him: he drops it, up and firing.
## True while it takes him over.
func _rescue(mind: Dictionary, dt: float, hero: Vector3, cues: Array) -> bool:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var r: Dictionary = mind.rescue
	var patient: Stormtrooper = r.patient
	var R: Dictionary = feel.rescue
	if patient.dead or not patient.is_hurt():
		_end_rescue(mind)
		return false
	var at := _flat(t.root.position)
	var body := _chest_of(patient)
	if at.distance_to(_flat(hero)) < R.threat:
		_end_rescue(mind)
		mind.last_known = _flat(hero)
		mind.stance = "stand"
		mind.tactic = "aimOpen"
		mind.timer = 0.0
		mind.startle = 0.12
		t.reaction.vhead -= 1.6
		t.reaction.vbuckle += 0.4
		return false
	r.clock += dt
	patient.attend()
	o.look = Vector3(body.x, 0.3, body.z)
	if r.stage == "go":
		if _steer(mind, body, PACE.run, 0.85):
			r.stage = "drag"
			r.clock = 0.0
			r.to = _haven(patient, hero)
			if r.to == null:
				r.stage = "treat"
		return true
	if r.stage == "drag":
		# Facing him, backing away: his hand at the collar, the body sliding after him.
		var hand := at + Vector3(sin(t.heading_of()), 0, cos(t.heading_of())) * 0.55
		hand.y = 0.45
		var there := _steer(mind, r.to, R.drag, 0.3)
		o.face = _heading_to(t.root.position, body)
		o.drag = patient.particle("N")
		patient.drag(hand, o.velocity)
		if there or r.clock > R.dragMax:
			patient.drag(null)
			r.stage = "treat"
			r.clock = 0.0
		return true
	# Treating him: kneeling at his side, a hand on his chest.
	if at.distance_to(body) > 1.05:
		_steer(mind, body, PACE.walk, 0.8)
		o.face = _heading_to(t.root.position, body)
		r.clock = 0.0
		return true
	if r.treat == 0.0:
		r.treat = _pick(R.treat)
	o.face = _heading_to(t.root.position, body)
	o.crouch = true
	o.tend = patient.particle("N").lerp(patient.particle("W"), 0.35)
	r.pulse -= dt
	if r.pulse <= 0.0:
		r.pulse = 0.5
		cues.append({ "type": "heal", "trooper": t, "at": o.tend })
	if r.clock >= r.treat:
		patient.heal()
		cues.append({ "type": "healed", "trooper": t, "patient": patient })
		_end_rescue(mind)
		return false
	return true


# ---- Getting about -------------------------------------------------------

## Sets his steps towards a point — along a path round the crates and walls
## when there is a navigation grid — clear of squadmates; true once there (or
## as near as he can get). His heading turns smoothly into a new way. Stopped
## while trying to move, he steps aside and finds another way.
func _steer(mind: Dictionary, target: Vector3, speed: float, arrive: float = 0.25) -> bool:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var at := _flat(t.root.position)
	var goal := _flat(target)
	var to := goal - at
	var distance := to.length()
	if distance < arrive:
		o.velocity = Vector3.ZERO
		mind.path = null
		return true
	var direction := to / distance
	var plain := distance < 1.6 and lab.segment_hit(Vector3(at.x, 0.45, at.z), Vector3(goal.x, 0.45, goal.z)).is_empty()
	var remaining := distance
	if nav and not plain:
		var way: Variant = mind.path
		var stale := way == null or (way.goal as Vector3).distance_to(goal) > 0.6
		if not stale:
			way.age += tick
			stale = way.age > 1.5
		if stale:
			var found: Variant = nav.path(at, goal)
			way = { "goal": goal, "points": found if found != null else [], "age": 0.0 }
			mind.path = way
		var points: Array = way.points
		while points.size() > 1 and at.distance_to(points[0]) < 0.3:
			points.pop_front()
		# Skip ahead to the furthest point in plain view: the way is walked in long straight lines.
		while points.size() > 1 and nav.line_free(at, points[1]):
			points.pop_front()
		var next: Variant = points[0] if not points.is_empty() else null
		# The end of the way short of the goal (it cannot be reached): as near as he can get.
		if points.size() == 1 and next != null and at.distance_to(next) < 0.3:
			o.velocity = Vector3.ZERO
			mind.path = null
			return true
		if points.is_empty():
			o.velocity = Vector3.ZERO
			return true
		if next != null and at.distance_to(next) > 1e-3:
			direction = ((next as Vector3) - at).normalized()
		remaining = at.distance_to(next) if points.size() == 1 else distance
	elif nav == null:
		# Round an obstacle in the way: along its face, on the side nearer the goal.
		var probe := minf(distance, 1.3)
		var ahead_at := at + direction * probe
		var hit := lab.segment_hit(Vector3(at.x, 0.45, at.z), Vector3(ahead_at.x, 0.45, ahead_at.z))
		if not hit.is_empty() and absf(hit.normal.y) < 0.5:
			var tangent := Vector3(-hit.normal.z, 0, hit.normal.x)
			var ahead := _flat(hit.point)
			if (ahead + tangent).distance_to(goal) > (ahead - tangent).distance_to(goal):
				tangent = -tangent
			direction = (tangent + hit.normal * 0.3).normalized()
	if mind.detour > 0.0:
		mind.detour -= tick
		direction = (direction + mind.detour_side * 1.3).normalized()
	# Keep clear of squadmates: a gentle push away from those close by, more from those ahead.
	for other: Stormtrooper in troopers:
		if other == t or other.fallen:
			continue
		var away := at - _flat(other.root.position)
		var gap := away.length()
		if gap < 1.0 and gap > 1e-4:
			away /= gap
			var ahead := maxf(0.0, -away.dot(direction))
			direction += away * ((1.0 - gap) * (0.8 + ahead * 1.2))
	direction = direction.normalized()
	# A new way is turned into, not snapped to.
	if mind.dir == null or (mind.dir as Vector3).dot(direction) < -0.2:
		mind.dir = direction
	else:
		mind.dir = (mind.dir as Vector3).lerp(direction, 1.0 - exp(-11.0 * tick)).normalized()
	o.velocity = (mind.dir as Vector3) * (speed * minf(1.0, remaining / 0.9 + 0.2))
	# Hardly moved for most of a second while trying to: a step aside, a new way.
	var stuck: Dictionary = mind.stuck
	if clock - stuck.stamp > 0.25:
		stuck.at = at
		stuck.time = 0.0
	stuck.stamp = clock
	stuck.time += tick
	if stuck.time > 0.9:
		if at.distance_to(stuck.at) < 0.2 and speed > 0.5:
			mind.path = null
			mind.detour = 0.55
			mind.detour_side = Vector3(-direction.z, 0, direction.x) * (1.0 if _random() < 0.5 else -1.0)
			mind.stuck_count += 1
		else:
			mind.stuck_count = 0
		stuck.at = at
		stuck.time = 0.0
	return false


## Moving in the fight: close to the hero and in sight of him, he walks with
## his rifle on him (legs one way, chest the other); further, he runs.
func _tactical_move(mind: Dictionary, goal: Vector3, threat: Vector3, arrive: float = 0.25, close: float = 6.0) -> bool:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var at := t.root.position
	var near: bool = mind.sees and _flat(at).distance_to(_flat(threat)) < close and _flat(at).distance_to(_flat(goal)) < 4.5
	var speed: float = PACE.walk * 1.35 if near else (PACE.run if _flat(at).distance_to(_flat(goal)) > 1.4 else PACE.walk)
	var there := _steer(mind, goal, speed, arrive)
	if near or there:
		o.face = _heading_to(at, threat)
		o.aim = near and t.holding
	return there


## Is a crouching man at `spot` hidden from the hero by a crate? (The same test as the cover spots'.)
func _covered(spot: Vector3, threat: Vector3) -> bool:
	return not lab.segment_hit(Vector3(threat.x, 1.2, threat.z), Vector3(spot.x, 0.72, spot.z)).is_empty()


## Where the rest of the squad stands, seen from the hero (unit vectors).
func _bearings(mind: Dictionary, threat: Vector3) -> Array:
	var list := []
	for other in minds:
		if is_same(other, mind) or other.mode != "combat" or other.trooper.dead:
			continue
		var at: Vector3 = other.cover.position if other.cover != null else (other.spread_to if other.spread_to != null else other.trooper.root.position)
		list.append((_flat(at) - _flat(threat)).normalized())
	return list


## Which side of the squad's line a point lies on, seen from the hero: 1, -1.
func _side_of(point: Vector3, threat: Vector3) -> float:
	var side: float = signf(plan.axis.x * (point.z - threat.z) - plan.axis.z * (point.x - threat.x))
	return side if side != 0.0 else 1.0


func _choose_cover(mind: Dictionary, range_override: Variant = null) -> Variant:
	var t: Stormtrooper = mind.trooper
	var at := _flat(t.root.position)
	var threat: Vector3 = mind.last_known
	var limits: Array = range_override if range_override != null else (feel.ai.flankRange if mind.role == "flanker" else feel.ai.range)
	var near: float = limits[0]
	var far: float = limits[1]
	var others := _bearings(mind, threat)
	var best: Variant = null
	var best_score := INF
	for spot in lab.cover_spots(threat, near - 0.5):
		var position: Vector3 = spot.position
		if minds.any(func(other: Dictionary) -> bool: return not is_same(other, mind) and other.cover != null and not other.trooper.dead and other.cover.position.distance_to(position) < 1.1):
			continue
		var travel := at.distance_to(position)
		if travel > 10.0:
			continue
		var distance := position.distance_to(threat)
		# The way there should not run past the hero.
		var exposed := 5.0 if _closest_on(at, position, threat).distance_to(threat) < 2.2 else 0.0
		# Spread round him: no two on the same line; a flanker wants his own side, well round.
		var bearing := (_flat(position) - _flat(threat)).normalized()
		var crowd := 0.0
		for other in others:
			crowd += 2.2 if _angle(bearing, other) < 0.55 else 0.0
		var flank := 0.0
		if mind.role == "flanker" and mind.flank_side != 0.0:
			var round_angle := _angle(bearing, plan.axis)
			flank = (-2.5 - minf(1.0, round_angle - 0.7)) if _side_of(position, threat) == mind.flank_side and round_angle > 0.7 else 1.5
		var span: float
		if distance < near:
			span = (near - distance) * 3.0
		elif distance > far:
			span = (distance - far) * 1.2
		else:
			span = absf(distance - (near + far) / 2.0) * 0.3
		var again := 4.0 if mind.previous_cover != null and position.distance_to(mind.previous_cover.position) < 0.5 else 0.0
		var score := travel * 0.75 + span + exposed + crowd + flank + again + _random() * 0.6
		if score < best_score:
			best_score = score
			best = spot
	return best


## Where to shoot from at his cover: standing up behind it if the rifle
## clears the crate, otherwise stepping out past its edge — never into it.
func _peek_from(mind: Dictionary, threat: Vector3, skip: Variant = null) -> Variant:
	var cover: Dictionary = mind.cover
	var across := Vector3(-cover.facing.z, 0, cover.facing.x)
	var target := Vector3(threat.x, CHEST, threat.z)
	var candidates := [] if cover.tall else [cover.position]
	for step in [0.65, 0.95, 1.25]:
		for sign in [mind.side, -mind.side]:
			candidates.append(cover.position + across * (sign * step))
	for spot: Vector3 in candidates:
		if skip != null and spot.distance_to(skip) < 0.2:
			continue
		if spot.distance_to(lab.push_out(spot, 0.32)) > 1e-3:
			continue
		if not lab.clear(Vector3(spot.x, MUZZLE, spot.z), target):
			continue
		return spot
	return null


## A spot close by with a clear shot at the hero (no crate in the way, no squadmate there), or null.
func _firing_spot(mind: Dictionary, threat: Vector3) -> Variant:
	var t: Stormtrooper = mind.trooper
	var at := _flat(t.root.position)
	var target := Vector3(threat.x, CHEST, threat.z)
	var toward := (_flat(threat) - at).normalized()
	var best: Variant = null
	var best_score := INF
	for radius in [0.9, 1.5, 2.2]:
		for k in 10:
			var angle := (k / 10.0) * PI * 2.0
			var spot: Vector3 = at + Vector3(sin(angle), 0, cos(angle)) * radius
			if nav and not nav.walkable(spot):
				continue
			if nav == null and spot.distance_to(lab.push_out(spot, 0.32)) > 1e-3:
				continue
			if not lab.clear(Vector3(spot.x, MUZZLE, spot.z), target):
				continue
			if troopers.any(func(other: Stormtrooper) -> bool: return other != t and not other.fallen and _flat(other.root.position).distance_to(spot) < 0.9):
				continue
			# Not towards him, not too far.
			var score: float = radius + maxf(0.0, (spot - at).normalized().dot(toward)) * 1.5
			if score < best_score:
				best_score = score
				best = spot
		if best != null:
			return best
	return null


## Round the hero, at a distance, where no squadmate stands yet: a place in the crossfire.
func _spread_point(mind: Dictionary, threat: Vector3) -> Variant:
	var at := _flat(mind.trooper.root.position)
	var from := _flat(threat)
	var others := _bearings(mind, threat)
	var base := at - from
	if base.length_squared() < 1e-4:
		base = Vector3(1, 0, 0)
	base = base.normalized()
	var radius := _pick(feel.ai.spread)
	var best: Variant = null
	var best_score := -INF
	for turn in [-1.4, -1.0, -0.6, -0.3, 0.0, 0.3, 0.6, 1.0, 1.4]:
		var bearing := base.rotated(Vector3.UP, turn)
		var spot := from + bearing * radius
		if nav:
			var near: Variant = nav.nearest(spot)
			if near != null:
				spot = near
		var apart := 1.5
		if not others.is_empty():
			apart = INF
			for other in others:
				apart = minf(apart, _angle((_flat(spot) - from).normalized(), other))
		var score: float = minf(apart, 1.5) * 2.0 - absf(turn) * 0.6 - at.distance_to(spot) * 0.15 + (1.0 if lab.clear(Vector3(spot.x, MUZZLE, spot.z), Vector3(threat.x, CHEST, threat.z)) else 0.0)
		if score > best_score:
			best_score = score
			best = spot
	return best


## Would a bolt from his rifle reach the target, or hit a crate first? (Bolts fly through the railings; `skip`: his own cover, held over.)
func _line_of_fire(t: Stormtrooper, target: Vector3, skip: Variant = null) -> bool:
	return lab.segment_hit(t.muzzle(), target, func(box: Dictionary) -> bool: return box.kind == "rail" or (skip != null and is_same(box, skip))).is_empty()


## Leave to fire: a few at once at most, their bursts staggered.
func _take(mind: Dictionary) -> bool:
	if mind.token:
		return true
	if firing >= feel.blaster.firing:
		return false
	if firing > 0 and clock - plan.last_burst < feel.ai.stagger:
		return false
	firing += 1
	mind.token = true
	plan.last_burst = clock
	return true


func _release(mind: Dictionary) -> void:
	mind.charge = 0.0
	if not mind.token:
		return
	mind.token = false
	firing = maxi(0, firing - 1)


# ---- Behaviour -----------------------------------------------------------

func _patrol(mind: Dictionary, dt: float) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var route: Variant = mind.route
	if route != null and not route.is_empty():
		if mind.wait > 0.0:
			mind.wait -= dt
			# Waiting at a waypoint, he glances about.
			var turn: float = t.heading_of() + sin(mind.wait * 0.9) * 0.9
			var look: Vector3 = t.root.position + Vector3(sin(turn), 0, cos(turn)) * 4.0
			look.y = 1.4
			o.look = look
			return
		if _steer(mind, route[mind.route_index], PACE.walk * 0.75, 0.3):
			mind.route_index = (mind.route_index + 1) % route.size()
			mind.wait = 1.4 + _random() * 2.2
		return
	# A sentry: back to his post, facing his way.
	if _flat(t.root.position).distance_to(_flat(mind.home)) > 0.45:
		_steer(mind, mind.home, PACE.walk * 0.75, 0.3)
	else:
		o.face = mind.home_heading


func _investigate(mind: Dictionary, dt: float) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	mind.timer += dt
	var point: Vector3 = mind.interest if mind.interest != null else mind.home
	o.look = Vector3(point.x, 1.2, point.z)
	# A beat to listen, then he goes to see, rifle up (as near as he can get).
	if mind.timer < 0.8 or mind.awareness < 0.5:
		o.face = _heading_to(t.root.position, point)
		return
	mind.aim_point = Vector3(point.x, CHEST, point.z)
	o.aim = true
	var goal: Vector3 = point
	if nav:
		var near: Variant = nav.nearest(point)
		if near != null:
			goal = near
	if mind.stuck_count >= 2 or _steer(mind, goal, PACE.walk * 0.8, 1.4):
		# There: he sweeps the area with his rifle.
		o.velocity = Vector3.ZERO
		mind.glance += dt
		mind.aim_point = point + Vector3(sin(mind.glance * 1.3) * 2.5, 0, cos(mind.glance * 1.1) * 2.5)
		mind.aim_point.y = CHEST
		o.face = _heading_to(t.root.position, mind.aim_point)
		mind.awareness = maxf(0.0, mind.awareness - dt * 0.12)


# ---- The search ----------------------------------------------------------

## Squadmates lying in sight that he has not seen yet: the first one found starts a search (or joins it).
func _look_for_bodies(mind: Dictionary, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var eye := t.eye()
	var facing := Vector3(sin(t.heading_of()), 0, cos(t.heading_of()))
	for body: Stormtrooper in troopers:
		if body == t or not body.fallen or (not body.dead and not body.is_hurt()) or mind.known.has(body):
			continue
		var at := body.particle("W")
		at.y = maxf(0.25, at.y)
		var to := _flat(at) - _flat(eye)
		if to.length() > feel.senses.bodies or _angle(facing, to) > feel.senses.peripheral or not lab.clear(eye, at):
			continue
		mind.known[body] = true
		_discover(mind, body, cues)
		return


## A body found: he calls it, and the squad (those not fighting) searches the room round it.
func _discover(mind: Dictionary, body: Stormtrooper, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var at := _flat(body.particle("W"))
	if alerts:
		alerts.alert(t, "!", 1.2)
	t.reaction.vhead -= 2.0
	t.reaction.vbuckle += 0.5
	var searching: bool = plan.sweep != null and clock < plan.sweep.until
	if not searching:
		_start_sweep(at, feel.sweep.radius, feel.sweep.duration)
		cues.append({ "type": "radio", "radio": "down", "trooper": t })
	# The body itself is the first place to look.
	if not plan.sweep.points.any(func(point: Dictionary) -> bool: return point.body == body):
		plan.sweep.points.push_front({ "at": at, "look": _heading_to(t.root.position, at), "body": body, "taken": null, "done": false, "arrived": false, "pause": 0.0 })
	for other in minds:
		var o: Stormtrooper = other.trooper
		if o.dead or not o.is_free() or other.entering != null or other.mode == "combat" or other.mode == "sweep":
			continue
		if not is_same(other, mind) and _flat(o.root.position).distance_to(_flat(t.root.position)) > feel.senses.callout:
			continue
		other.mode = "sweep"
		other.point = null
		other.awareness = maxf(other.awareness, 0.6)
		other.known[body] = true
		if not is_same(other, mind):
			other.callout = null


## The hiding places round a point: behind the crates (out of sight from it,
## and from where the squad stands), a few metres apart, where a man can walk.
func _start_sweep(origin: Vector3, radius: float, duration: float) -> void:
	var alive := minds.filter(func(mind: Dictionary) -> bool: return not mind.trooper.dead)
	var squad_at := Vector3.ZERO
	for mind in alive:
		squad_at += _flat(mind.trooper.root.position) / alive.size()
	var points := []
	for from in [origin, squad_at]:
		for spot in lab.cover_spots(from, 1.2):
			var position: Vector3 = spot.position
			if position.distance_to(_flat(origin)) > radius:
				continue
			if nav and not nav.walkable(position):
				continue
			if points.any(func(point: Dictionary) -> bool: return (point.at as Vector3).distance_to(position) < feel.sweep.spacing):
				continue
			points.append({ "at": position, "look": atan2(spot.facing.x, spot.facing.z), "body": null, "taken": null, "done": false, "arrived": false, "pause": 0.0 })
	plan.sweep = { "origin": _flat(origin), "points": points, "until": clock + duration }


## The next hiding place for him: the nearest one nobody has searched or taken.
func _next_point(mind: Dictionary) -> Variant:
	var at := _flat(mind.trooper.root.position)
	var best: Variant = null
	var best_distance := INF
	for point in (plan.sweep.points if plan.sweep != null else []):
		if point.done or (point.taken != null and not is_same(point.taken, mind) and not point.taken.trooper.dead):
			continue
		# A body is checked by whoever is nearest it; the rest go on to the hiding places.
		var distance: float = at.distance_to(point.at) - (3.0 if point.body != null else 0.0)
		if distance < best_distance:
			best_distance = distance
			best = point
	if best != null:
		best.taken = mind
	return best


## Searching: to the next hiding place, rifle leading the way; there, a look round (kneeling by a body).
func _sweep(mind: Dictionary, dt: float) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var S: Dictionary = feel.sweep
	mind.awareness = maxf(mind.awareness, 0.6)
	if plan.sweep == null or clock > plan.sweep.until:
		_end_sweep(mind)
		return
	if mind.point == null:
		mind.point = _next_point(mind)
	var point: Variant = mind.point
	if point == null:
		_end_sweep(mind)
		return
	o.aim = true
	if not point.arrived:
		# On his way: the rifle points where he goes.
		mind.aim_point = Vector3(point.at.x, CHEST, point.at.z)
		if mind.stuck_count >= 2 or _steer(mind, point.at, PACE.walk * (1.2 if point.body != null else 0.95), 0.9 if point.body != null else 0.45):
			point.arrived = true
			point.pause = S.check if point.body != null else _pick(S.pause)
			mind.glance = 0.0
			mind.stuck_count = 0
		return
	point.pause -= dt
	mind.glance += dt
	if point.body != null:
		# Kneeling by him, a look at him, then round.
		o.crouch = true
		o.aim = false
		o.face = _heading_to(t.root.position, point.at)
		o.look = Vector3(point.at.x, 0.3, point.at.z)
	else:
		# Rifle and eyes round the hiding place, one way then the other.
		var look: float = point.look + sin(mind.glance * 2.2) * 1.2
		mind.aim_point = t.root.position + Vector3(sin(look), 0, cos(look)) * 4.0
		mind.aim_point.y = CHEST
		o.face = _heading_to(t.root.position, mind.aim_point)
	if point.pause <= 0.0:
		point.done = true
		mind.point = null


## Nothing found: wary for a while, then back to his post.
func _end_sweep(mind: Dictionary) -> void:
	if mind.point != null:
		mind.point.taken = null
	mind.point = null
	mind.mode = "suspicious"
	mind.awareness = 0.45
	mind.interest = plan.sweep.origin if plan.sweep != null else _flat(mind.trooper.root.position)
	mind.timer = 1.0
	if alerts:
		alerts.alert(mind.trooper, "?")
	if plan.sweep != null and not minds.any(func(other: Dictionary) -> bool: return not is_same(other, mind) and (other.mode == "sweep" or other.mode == "searching")):
		plan.sweep = null


## Is a squadmate in the way of a shot from `from` to `to`?
func _friend_in_line(t: Stormtrooper, from: Vector3, to: Vector3) -> bool:
	for other: Stormtrooper in troopers:
		if other == t or other.fallen:
			continue
		var chest := _flat(other.root.position)
		chest.y = 1.05
		var point := _closest_on(from, to, chest)
		if point.distance_to(chest) < 0.5 and point.distance_to(to) > 0.6:
			return true
	return false


## Pulls the trigger: aimed at the hero's chest, or a deliberate near miss that
## whizzes past; blind (the rifle up over his cover), only roughly his way;
## suppressing, at where he hides (the bolts may splash on his cover, never on the shooter's own).
func _shoot(mind: Dictionary, hero: Vector3, hero_velocity: Vector3, shots: Array, blind: bool = false, suppress: bool = false) -> bool:
	var t: Stormtrooper = mind.trooper
	if suppress:
		var sx := (_random() - 0.5) * 1.2
		var sz := (_random() - 0.5) * 1.2
		var aim_at: Vector3 = _flat(mind.last_known) + Vector3(sx, 0, sz)
		aim_at.y = 0.8 + _random() * 0.7
		var hit := lab.segment_hit(t.muzzle(), aim_at, func(box: Dictionary) -> bool: return box.kind == "rail")
		if (not hit.is_empty() and (hit.point as Vector3).distance_to(aim_at) > 1.8) or _friend_in_line(t, t.muzzle(), aim_at):
			return false
		var shot: Variant = t.fire()
		if shot == null:
			return false
		shots.append({ "from": shot.from, "direction": (aim_at - shot.from).normalized(), "trooper": t, "suppress": true })
		return true
	var aim_at: Vector3
	if blind:
		var bx := (_random() - 0.5) * 2.4
		var bz := (_random() - 0.5) * 2.4
		aim_at = _flat(mind.last_known) + Vector3(bx, 0, bz)
		aim_at.y = CHEST + (_random() - 0.4) * 0.8
	else:
		aim_at = Vector3(hero.x, CHEST, hero.z)
	# Never into a crate (held up over his own, the rifle clears it), never through a squadmate.
	if not _line_of_fire(t, aim_at, mind.cover.box if blind and mind.cover != null else null) or _friend_in_line(t, t.muzzle(), aim_at):
		return false
	var shot: Variant = t.fire()
	if shot == null:
		return false
	if blind:
		var direction: Vector3 = (aim_at - shot.from).normalized()
		direction.x += (_random() - 0.5) * feel.ai.blindSpread * 2.0
		direction.y += (_random() - 0.5) * feel.ai.blindSpread
		direction.z += (_random() - 0.5) * feel.ai.blindSpread * 2.0
		shots.append({ "from": shot.from, "direction": direction.normalized(), "trooper": t, "blind": true })
		return true
	var target := Vector3(hero.x, CHEST + (_random() - 0.5) * 0.3, hero.z)
	# A slight lead on a moving target, imperfect.
	target += hero_velocity * ((shot.from as Vector3).distance_to(target) / feel.blaster.speed * (0.3 + _random() * 0.5))
	if _random() < feel.blaster.miss:
		var side: Vector3 = (target - shot.from).cross(Vector3(0, 1, 0)).normalized()
		var sign := -1.0 if _random() < 0.5 else 1.0
		target += side * (sign * (0.45 + _random() * 0.5))
		target.y += (_random() - 0.3) * 0.5
	var distance := target.distance_to(shot.from)
	var direction: Vector3 = (target - shot.from).normalized()
	var spread: float = feel.blaster.spread
	direction.x += (_random() - 0.5) * spread * 2.0
	direction.y += (_random() - 0.5) * spread
	direction.z += (_random() - 0.5) * spread * 2.0
	direction = direction.normalized()
	# A wide shot that would clip a crate on its way goes straight at the chest instead.
	if not lab.segment_hit(shot.from, shot.from + direction * maxf(0.5, distance - 0.8), func(box: Dictionary) -> bool: return box.kind == "rail").is_empty():
		direction = (Vector3(hero.x, CHEST, hero.z) - shot.from).normalized()
	shots.append({ "from": shot.from, "direction": direction, "trooper": t })
	return true


## A grenade now? Not too often, at a fair range, never onto a squadmate; likelier when the hero hides.
func _wants_grenade(mind: Dictionary, threat: Vector3, distance: float) -> bool:
	var g: Dictionary = feel.grenade
	var t: Stormtrooper = mind.trooper
	if not t.holding or t.reaction.wound != null or grenade_clock < g.squadCooldown or mind.grenade_clock < g.cooldown:
		return false
	if distance < g.range[0] or distance > g.range[1]:
		return false
	if troopers.any(func(other: Stormtrooper) -> bool: return other != t and not other.dead and _flat(other.root.position).distance_to(_flat(threat)) < g.safe):
		return false
	return _random() < (g.chance if mind.sees else g.chanceHidden)


## Hands out the parts by distance to the hero: rusher, flankers, anchors.
func _assign_roles(hero: Vector3) -> void:
	var fighters := _fighting()
	fighters.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return _flat(a.trooper.root.position).distance_to(_flat(hero)) < _flat(b.trooper.root.position).distance_to(_flat(hero)))
	var roles := _roles_for(fighters.size())
	for index in fighters.size():
		var mind: Dictionary = fighters[index]
		var role: String = roles[index % roles.size()]
		if role != mind.role:
			mind.flank_side = 0.0
		mind.role = role


## Where a rusher or a flanker heads: short of the hero, or round to his side.
func _approach(mind: Dictionary, threat: Vector3) -> Vector3:
	var at := _flat(mind.trooper.root.position)
	var from := _flat(threat)
	var away := at - from
	if away.length_squared() < 1e-4:
		away = Vector3(1, 0, 0)
	away = away.normalized()
	if mind.role == "flanker":
		# Round to his own side of the squad's line.
		var side: float = mind.flank_side if mind.flank_side != 0.0 else mind.strafe
		var round_way: Vector3 = (plan.axis as Vector3).rotated(Vector3.UP, 1.25 * side)
		if _side_of(from + round_way, from) != side:
			round_way = (plan.axis as Vector3).rotated(Vector3.UP, -1.25 * side)
		away = round_way
	var reach: float = feel.ai.flankRange[0] + 0.8 if mind.role == "flanker" else feel.ai.advance
	var goal := from + away * reach
	if nav == null:
		return goal
	if nav.walkable(goal):
		return goal
	var near: Variant = nav.nearest(goal)
	return near if near != null else from + away * (reach * 0.6)


## Rifle up and a burst: kneeling, standing, or blind over his cover.
func _stance_orders(mind: Dictionary, o: Dictionary) -> void:
	o.crouch = mind.stance != "stand"
	o.aim = mind.stance != "blind"
	o.blind = mind.stance == "blind"
	o.over = mind.cover.box.max.y + 0.22 if o.blind and mind.cover != null and mind.cover.get("box") != null else null


## Into the burst: first the aim settles (the glint), then the shots.
func _open_fire(mind: Dictionary, burst: int, blind: bool = false) -> void:
	mind.tactic = "fire"
	mind.burst = burst
	mind.gap = 0.0
	mind.armed = false
	mind.windup = feel.ai.windup * (0.7 if blind else 1.0)
	mind.windup_total = mind.windup


## A new plan: to cover (or a better one), closer in, or holding where he is if the squad needs him covering.
func _new_plan(mind: Dictionary, cues: Array, range_override: Variant = null, urgent: bool = false) -> void:
	var t: Stormtrooper = mind.trooper
	# Plan after plan without getting anywhere: he stands and fires from where he is.
	mind.plans += 1.0
	if mind.plans > 5.0 and t.holding:
		mind.plans = 0.0
		mind.stance = "stand"
		mind.tactic = "aimOpen"
		mind.timer = 0.0
		return
	var cover: Variant = null if mind.role == "rusher" and t.holding and range_override == null else _choose_cover(mind, range_override)
	mind.cycles = 0
	mind.max_cycles = roundi(_pick(feel.ai.cycles))
	mind.timer = 0.0
	mind.advance_to = null
	mind.reposition = false
	mind.suppressing = false
	var here: bool = mind.cover != null and _flat(t.root.position).distance_to(mind.cover.position) < 0.4
	if cover != null and here and cover.position.distance_to(mind.cover.position) < 0.3:
		mind.tactic = "hide"
		return
	var wanted := "move" if cover != null else ("advance" if t.holding else "cower")
	if wanted == "cower" or urgent or _claim_move(mind, cues):
		mind.previous_cover = mind.cover
		mind.cover = cover
		mind.cover_time = 0.0
		mind.tactic = wanted
		if wanted != "cower":
			plan.movers[mind.id] = mind
		return
	# No leave to move: he covers the others from where he is.
	if mind.cover != null and here and _covered(mind.cover.position, mind.last_known):
		mind.tactic = "hide"
		mind.timer = 0.15
	elif t.holding:
		mind.stance = "kneel" if _random() < feel.ai.kneel else "stand"
		mind.tactic = "aimOpen"
	else:
		mind.tactic = "cower"


func _fight(mind: Dictionary, dt: float, hero: Vector3, hero_velocity: Vector3, shots: Array, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	var at := t.root.position
	var threat: Vector3 = hero if mind.sees else mind.last_known
	mind.aim_point = Vector3(threat.x, CHEST, threat.z)
	o.look = Vector3(threat.x, HEAD, threat.z)
	mind.charge = 0.0
	mind.no_blind = maxf(0.0, mind.no_blind - dt)
	mind.spread_again = maxf(0.0, mind.spread_again - dt)
	mind.plans = maxf(0.0, mind.plans - dt * 4.0)
	mind.cover_time += dt
	if mind.sees:
		mind.suppressed = false
	# A squadmate has him in sight: the squad knows where he is (the radio) — he goes round to see him, he does not search.
	if not mind.sees and plan.seen:
		mind.last_known = plan.threat
	if mind.startle > 0.0:
		mind.startle -= dt
		o.face = _heading_to(at, threat)
		return
	# Lost him for long: go and look where he was.
	if mind.seen > feel.ai.search and not plan.seen:
		# The hiding places round where he was lost (the search under way, if it is round there).
		if plan.sweep == null or clock > plan.sweep.until or (plan.sweep.origin as Vector3).distance_to(_flat(mind.last_known)) > 4.0:
			_start_sweep(mind.last_known, feel.sweep.lost, feel.sweep.lostDuration)
		mind.point = null
		_release(mind)
		plan.movers.erase(mind.id)
		mind.mode = "searching"
		mind.search_time = 0.0
		mind.glance = 0.0
		mind.cover = null
		mind.tactic = null
		if not plan.lost:
			plan.lost = true
			cues.append({ "type": "radio", "radio": "lost", "trooper": t })
		return
	# Disarmed: the rifle first; failing that, away to cover.
	if not t.holding:
		_release(mind)
		var rifle: Variant = t.rifle()
		if rifle != null and _flat(at).distance_to(rifle) < 10.0:
			_steer(mind, rifle, PACE.run, 0.5)
			return
		if not ["move", "hide", "cower"].has(mind.tactic):
			mind.tactic = null
	# Stuck again and again: a new plan.
	if mind.stuck_count >= 3:
		mind.stuck_count = 0
		_release(mind)
		mind.tactic = null
		mind.cover = null
	var distance := _flat(at).distance_to(_flat(threat))
	# Falling back: to a cover further off, now.
	if plan.fallback > 0.0 and not mind.fell_back and not COMMITTED.has(mind.tactic):
		mind.fell_back = true
		_release(mind)
		_new_plan(mind, cues, feel.ai.fallbackRange, true)
	# The Jedi on him: he backs away, firing from the hip.
	if mind.sees and distance < feel.ai.close and t.holding and mind.tactic != "evade":
		_release(mind)
		plan.movers.erase(mind.id)
		mind.tactic = "evade"
		mind.timer = 0.0
		mind.gap = 0.0
		mind.windup = 0.0
	# The Jedi among them: those in the open nearby spread out round him for a crossfire.
	elif plan.scatter and mind.sees and t.holding and distance < 6.5 and mind.spread_again <= 0.0 and not COMMITTED.has(mind.tactic) and mind.tactic != "aimOpen" \
			and not (mind.cover != null and ["hide", "peek", "back"].has(mind.tactic) and distance > 4.5):
		_release(mind)
		mind.spread_again = 3.0
		mind.tactic = "spread"
		mind.spread_to = _spread_point(mind, threat)
		mind.timer = 0.0
	# Out of sight a moment: the anchors keep him pinned with a burst at where he hides; the others go after him.
	if not mind.sees and mind.seen > feel.ai.pursue and t.holding and not ["pursue", "throw", "blindUp", "fire", "evade", "suppress"].has(mind.tactic):
		if mind.role == "anchor" and not mind.suppressed and mind.seen < feel.ai.suppress and mind.cover != null and _take(mind):
			mind.suppressed = true
			mind.tactic = "suppress"
			mind.peek_at = null
			mind.peek = null
			mind.timer = 0.0
		elif mind.role != "anchor" or mind.seen > feel.ai.suppress:
			_release(mind)
			plan.movers[mind.id] = mind
			mind.tactic = "pursue"
			mind.cover = null
			mind.peek = null
			mind.timer = 0.0
	if mind.tactic == null:
		_new_plan(mind, cues)
	match mind.tactic:
		"move":
			_release(mind)
			var cover: Variant = mind.cover
			if cover == null:
				mind.tactic = null
			# Running for it; close to him he walks there with his rifle on him.
			elif _tactical_move(mind, cover.position, threat, 0.22):
				plan.movers.erase(mind.id)
				mind.tactic = "hide"
				mind.timer = _pick(feel.ai.hide) * 0.5
		"hide":
			_hide(mind, dt, threat, distance, cues)
		"blindUp":
			# Rifle up over the crate, head down.
			_stance_orders(mind, o)
			o.face = _heading_to(at, threat)
			mind.timer += dt
			var done := false
			if t.reaction.blind > 0.85:
				# The rifle cannot clear it from here: not again for a while.
				if not _line_of_fire(t, Vector3(threat.x, CHEST, threat.z), mind.cover.box if mind.cover != null else null):
					mind.stance = "stand"
					mind.tactic = "hide"
					mind.timer = 0.1
					mind.no_blind = 4.0
					_release(mind)
					done = true
				else:
					_open_fire(mind, roundi(_pick(feel.ai.blindBurst)), true)
			if not done and mind.timer > 1.2:
				_release(mind)
				mind.stance = "stand"
				mind.tactic = "hide"
				mind.timer = 0.2
				mind.no_blind = 4.0
		"peek", "suppress":
			_peek(mind, dt, threat, at)
		"advance":
			# A rusher closes in, a flanker swings round; then he stops to fire.
			_release(mind)
			mind.timer += dt
			if mind.advance_to == null or (not mind.reposition and fmod(mind.timer, 1.0) < dt):
				mind.advance_to = _approach(mind, threat)
			var there := _tactical_move(mind, mind.advance_to, threat, 0.45)
			var in_range: bool = distance < (feel.ai.flankRange[1] if mind.role == "flanker" else feel.ai.advance + 2.5)
			# Hiding from him: a grenade to flush him out.
			if not mind.sees and _wants_grenade(mind, threat, distance):
				mind.tactic = "throw"
				mind.timer = 0.0
				mind.thrown = false
			else:
				var ready: bool = mind.timer > 0.2 if there else ((in_range and mind.timer > 1.1 and not mind.reposition) or mind.timer > 3.5)
				if mind.sees and ready and _take(mind):
					plan.movers.erase(mind.id)
					mind.reposition = false
					mind.stance = "kneel" if _random() < feel.ai.kneel else "stand"
					mind.tactic = "aimOpen"
					mind.timer = 0.0
				elif there and not mind.sees:
					mind.reposition = false
					mind.tactic = "pursue"
					plan.movers[mind.id] = mind
		"aimOpen":
			_aim_open(mind, dt, threat, at, cues)
		"fire":
			_fire(mind, dt, hero, hero_velocity, threat, at, shots, cues)
		"back":
			# Back behind the crate.
			if mind.peek != null and not _steer(mind, mind.cover.position, PACE.walk, 0.2):
				o.face = _heading_to(at, threat)
			else:
				mind.peek = null
				mind.peek_at = null
				mind.tactic = "hide"
		"pursue":
			# After him: round to where he was last seen, at a run, stopping short — each from his own side.
			_release(mind)
			mind.timer += dt
			var from := _flat(mind.last_known)
			var away := _flat(at) - from
			if away.length_squared() < 1e-4:
				away = Vector3(1, 0, 0)
			away = away.normalized()
			if mind.flank_side != 0.0:
				away = away.rotated(Vector3.UP, 0.6 * mind.flank_side)
			var goal := from + away * 2.5
			if nav:
				var near: Variant = nav.nearest(goal)
				if near != null:
					goal = near
			var there := _steer(mind, goal, PACE.run, 0.5)
			o.face = _heading_to(at, threat) if there else null
			if mind.sees:
				plan.movers.erase(mind.id)
				mind.tactic = null
			else:
				if there:
					mind.glance += dt
					o.face = _heading_to(at, threat) + sin(mind.glance * 2.0) * 0.8
					o.aim = true
				# Nothing there: on to the hiding places round it, without waiting.
				if there and mind.glance > 1.2:
					mind.seen = maxf(mind.seen, feel.ai.search + 0.01)
		"evade":
			# Too close: he backs off — away from the hero and out of his squadmates' line — firing from the hip.
			o.face = _heading_to(at, threat)
			o.aim = true
			var away := (_flat(at) - _flat(threat)).normalized()
			var across: Vector3 = Vector3(-away.z, 0, away.x) * mind.strafe
			# Sideways towards where no squadmate stands, so the others get a clear shot.
			var others := _bearings(mind, threat)
			if others.any(func(other: Vector3) -> bool: return other.dot(across) > 0.6):
				mind.strafe *= -1.0
				across = -across
			_steer(mind, _flat(at) + away * 2.0 + across, PACE.walk * 1.6, 0.1)
			mind.timer += dt
			mind.gap -= dt
			if mind.windup > 0.0:
				mind.windup -= dt
				mind.charge = minf(1.0, 1.0 - mind.windup / mind.windup_total)
				if mind.windup <= 0.0 and mind.sees and t.reaction.aim > 0.6 and _take(mind):
					if _shoot(mind, hero, hero_velocity, shots):
						shots[-1].hip = true
					_release(mind)
			elif mind.gap <= 0.0 and mind.sees and t.reaction.aim > 0.6:
				mind.windup = feel.ai.windup * 0.55
				mind.windup_total = mind.windup
				mind.gap = 0.3 + _random() * 0.25
			if distance > feel.ai.close + 1.6 or mind.timer > 2.5:
				mind.tactic = null
				mind.windup = 0.0
		"spread":
			# Out to his place round the Jedi, at a run, then the rifle up.
			_release(mind)
			mind.timer += dt
			var there: bool = mind.spread_to == null or _steer(mind, mind.spread_to, PACE.run, 0.5)
			if there or mind.timer > 2.2:
				mind.spread_to = null
				mind.stance = "kneel" if _random() < feel.ai.kneel * 0.6 else "stand"
				mind.tactic = "aimOpen"
				mind.timer = 0.0
		"throw":
			# Up from cover, square to the hero, and over it goes.
			_release(mind)
			o.face = _heading_to(at, threat)
			if not mind.thrown:
				mind.timer += dt
				var facing := absf(_wrap(_heading_to(at, threat) - t.heading_of())) < 0.35
				if t.reaction.crouch < 0.25 and facing:
					var tx := (_random() - 0.5) * 1.4
					var tz := (_random() - 0.5) * 1.4
					var target := _flat(threat) + _flat(hero_velocity) * 0.7 + Vector3(tx, 0, tz)
					if t.throw_grenade(target):
						mind.thrown = true
						grenade_clock = 0.0
						mind.grenade_clock = 0.0
						cues.append({ "type": "radio", "radio": "grenade", "trooper": t })
				if mind.timer > 2.0:
					mind.tactic = "hide" if mind.cover != null else null
			elif not t.is_throwing():
				mind.thrown = false
				mind.tactic = "hide" if mind.cover != null else null
				mind.timer = _pick(feel.ai.hide) * 0.6
		"cower":
			# Unarmed with nowhere better: crouched, away from the hero.
			_release(mind)
			o.crouch = true
			o.face = _heading_to(at, threat)
			if t.rifle() != null:
				mind.tactic = null


func _hide(mind: Dictionary, dt: float, threat: Vector3, distance: float, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	_release(mind)
	o.crouch = true
	o.face = _heading_to(t.root.position, threat)
	# While squadmates move, he comes up sooner to cover them.
	mind.timer -= dt * (1.8 if not plan.movers.is_empty() and not plan.movers.has(mind.id) else 1.0)
	if mind.cover == null or not _covered(mind.cover.position, threat):
		mind.tactic = null
		return
	# The hero has moved off: a cover nearer him (not straight after settling).
	if mind.cover_time > 2.0 and _flat(mind.cover.position).distance_to(_flat(threat)) > feel.ai.range[1] + 2.0 and _claim_move(mind, cues):
		mind.tactic = null
		return
	if mind.timer > 0.0 or not t.holding:
		return
	if mind.cycles >= mind.max_cycles:
		mind.tactic = null
		return
	if _wants_grenade(mind, threat, distance):
		mind.tactic = "throw"
		mind.timer = 0.0
		mind.thrown = false
		return
	if _take(mind):
		# Blind over a low crate now and then; otherwise up behind it, or out past its edge.
		var blind_ok: bool = not mind.cover.tall and mind.no_blind <= 0.0
		if blind_ok and _random() < feel.ai.blind:
			mind.stance = "blind"
			mind.tactic = "blindUp"
			mind.timer = 0.0
			return
		var spot: Variant = _peek_from(mind, threat)
		if spot == null:
			if blind_ok:
				mind.stance = "blind"
				mind.tactic = "blindUp"
				mind.timer = 0.0
				return
			# Nowhere to fire from here: another cover.
			_release(mind)
			mind.tactic = null
			return
		mind.peek_at = spot
		mind.peek = null if (spot as Vector3).distance_to(mind.cover.position) < 0.05 else spot
		mind.retries = 0
		mind.stance = "stand"
		mind.tactic = "peek"
		mind.timer = 0.0
	else:
		mind.timer = 0.15


func _peek(mind: Dictionary, dt: float, threat: Vector3, at: Vector3) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	# Up (or out), rifle to the shoulder.
	var suppress: bool = mind.tactic == "suppress"
	if suppress and mind.peek_at == null:
		var spot: Variant = _peek_from(mind, threat)
		if spot == null:
			spot = mind.cover.position if mind.cover != null else _flat(at)
		mind.peek_at = spot
		mind.peek = spot if mind.cover != null and (spot as Vector3).distance_to(mind.cover.position) > 0.05 else null
	if mind.peek != null and not _steer(mind, mind.peek, PACE.walk, 0.2):
		o.face = _heading_to(at, threat)
		mind.timer += dt
		if mind.timer > 2.0:
			_release(mind)
			mind.tactic = null
		return
	o.aim = true
	o.face = _heading_to(at, threat)
	mind.timer += dt
	if t.reaction.aim > 0.85 and (mind.sees or suppress or mind.timer > 0.6):
		if suppress:
			mind.suppressing = true
			_open_fire(mind, roundi(_pick(feel.blaster.burst)))
			return
		# The crate is in the way of his rifle: another spot, or another cover.
		if not _line_of_fire(t, Vector3(threat.x, CHEST, threat.z)):
			var next: Variant = null
			mind.retries += 1
			if mind.retries - 1 < 3:
				next = _peek_from(mind, threat, mind.peek_at)
			if next == null:
				_release(mind)
				mind.tactic = null
				return
			mind.peek_at = next
			mind.peek = null if (next as Vector3).distance_to(mind.cover.position) < 0.05 else next
			mind.timer = 0.0
			return
		_open_fire(mind, roundi(_pick(feel.blaster.burst)))
	if mind.timer > 1.6:
		_release(mind)
		mind.tactic = "hide"
		mind.timer = 0.2


func _aim_open(mind: Dictionary, dt: float, threat: Vector3, at: Vector3, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	# Kneeling or standing, the rifle comes up.
	_stance_orders(mind, o)
	o.face = _heading_to(at, threat)
	mind.timer += dt
	if mind.timer > 2.2 or not mind.sees:
		_release(mind)
		mind.tactic = null
		mind.stance = "stand"
		return
	var settled: bool = t.reaction.aim > 0.85 and (mind.stance != "kneel" or t.reaction.crouch > 0.7)
	if not settled:
		return
	# Kneeling, a crate may be in the way: up he gets. Standing too: a step to a clear spot, or another cover.
	if not _line_of_fire(t, Vector3(threat.x, CHEST, threat.z)):
		if mind.stance == "kneel":
			mind.stance = "stand"
			return
		_release(mind)
		var spot: Variant = null
		mind.aim_fails += 1
		if mind.aim_fails - 1 < 2:
			spot = _firing_spot(mind, threat)
		if spot != null:
			mind.tactic = "advance"
			mind.advance_to = spot
			mind.reposition = true
			mind.timer = 0.0
		else:
			mind.aim_fails = 0
			mind.cover = null
			_new_plan(mind, cues, null, true)
		return
	mind.aim_fails = 0
	# His turn to fire (a few at a time, staggered).
	if not _take(mind):
		return
	_open_fire(mind, roundi(_pick(feel.blaster.burst)) + (1 if mind.stance == "kneel" else 0))


func _fire(mind: Dictionary, dt: float, hero: Vector3, hero_velocity: Vector3, threat: Vector3, at: Vector3, shots: Array, cues: Array) -> void:
	var t: Stormtrooper = mind.trooper
	var o: Dictionary = t.order
	_stance_orders(mind, o)
	o.face = _heading_to(at, threat)
	if mind.peek != null:
		_steer(mind, mind.peek, PACE.walk, 0.15)
	var blind: bool = mind.stance == "blind"
	# One burst after another: he waits for the last one to have started a moment ago.
	if not mind.armed:
		if clock - plan.last_fire < feel.ai.stagger:
			return
		mind.armed = true
		plan.last_fire = clock
	# The aim settles first: the glint at his muzzle tells the burst is coming.
	if mind.windup > 0.0:
		mind.windup -= dt
		mind.charge = minf(1.0, 1.0 - mind.windup / mind.windup_total)
		# He lost his mark while aiming (not blind, not pinning him down): no burst.
		if not blind and not mind.suppressing and not mind.sees and mind.seen > 0.4:
			mind.burst = 0
			mind.windup = 0.0
		return
	mind.gap -= dt
	if mind.gap <= 0.0 and mind.burst > 0:
		# Blocked (the hero moved behind something, or a squadmate is in the way): the burst stops there.
		if mind.suppressing:
			if not _shoot(mind, hero, hero_velocity, shots, false, true):
				mind.burst = 1
		elif (blind or mind.sees) and not _shoot(mind, hero, hero_velocity, shots, blind):
			mind.burst = 1
		if not blind and not mind.suppressing and not mind.sees:
			mind.burst = 1
		mind.burst -= 1
		mind.gap = _pick(feel.ai.blindGap if blind else feel.blaster.gap)
	if mind.burst <= 0 and mind.gap <= 0.0:
		_release(mind)
		mind.cycles += 1
		var from_cover: bool = mind.cover != null and (mind.stance == "blind" or mind.peek_at != null)
		mind.stance = "stand"
		mind.suppressing = false
		if from_cover:
			mind.tactic = "back"
			mind.timer = _pick(feel.ai.hide)
		elif mind.cycles >= mind.max_cycles:
			mind.tactic = null
		# In the open: on, if the squad lets him; otherwise he keeps covering from where he is.
		elif _claim_move(mind, cues):
			mind.tactic = "advance"
			mind.timer = 0.0
			mind.advance_to = null
		else:
			mind.tactic = "aimOpen"
			mind.timer = 0.0
		mind.step = 0


## The lights go out: each man flinches and loses the hero for a moment; those not yet fighting are on their guard.
func blackout(cues: Array = []) -> Array:
	var speaker: Variant = null
	for mind in minds:
		var t: Stormtrooper = mind.trooper
		if t.dead or t.is_impaled() or not t.is_free():
			continue
		t.reaction.vhead -= 2.2
		t.reaction.vbuckle += 0.5
		if alerts:
			alerts.alert(t, "?")
		if mind.mode == "combat":
			_release(mind)
			mind.startle = 0.5 + _random() * 0.7
			mind.seen = maxf(mind.seen, 2.0)
			mind.tactic = null
			if speaker == null:
				speaker = t
		elif mind.mode == "calm":
			mind.mode = "suspicious"
			mind.awareness = maxf(mind.awareness, 0.6)
			mind.timer = 0.0
	if speaker != null:
		cues.append({ "type": "radio", "radio": "lost", "trooper": speaker })
	return cues


## noises: [{ position, radius, from, strength, alarm, source }]. Returns { shots, cues }.
func update(dt: float, hero: Vector3, hero_velocity: Vector3 = Vector3.ZERO, saber: float = 0.0, noises: Array = [], darkness: float = 0.0, seen: float = 1.0) -> Dictionary:
	var shots := []
	var cues := []
	dark = darkness
	open = seen
	tick = dt
	clock += dt
	grenade_clock += dt
	plan.fallback = maxf(0.0, plan.fallback - dt)
	# Parts in the fight, handed out again now and then as the fight moves.
	role_clock += dt
	if role_clock > 4.0 or minds.any(func(mind: Dictionary) -> bool: return mind.mode == "combat" and mind.role == null):
		role_clock = 0.0
		_assign_roles(hero)
	plan.clock -= dt
	if plan.clock <= 0.0:
		plan.clock = 0.25
		_coordinate(hero, cues)
	for mind in minds:
		mind.grenade_clock += dt
	var hero_speed := Vector2(hero_velocity.x, hero_velocity.z).length()
	for mind in minds:
		var t: Stormtrooper = mind.trooper
		var o: Dictionary = t.order
		# Dead, or dying on the blade: out of the fight for good — and the squad hears of it.
		if t.dead or t.is_impaled():
			if not mind.mourned:
				mind.mourned = true
				plan.losses.append(clock)
				var near := minds.filter(func(other: Dictionary) -> bool: return not is_same(other, mind) and other.mode == "combat" and not other.trooper.dead and other.trooper.root.position.distance_to(t.root.position) < 11.0)
				if not near.is_empty():
					cues.append({ "type": "radio", "radio": "down", "trooper": near[int(floor(_random() * near.size()))].trooper })
			_end_rescue(mind)
			_release(mind)
			plan.movers.erase(mind.id)
			if alerts:
				alerts.dismiss(t)
			mind.mode = "dead"
			mind.entering = null
			continue
		o.velocity = Vector3.ZERO
		o.face = null
		o.look = null
		o.aim = false
		o.crouch = false
		o.blind = false
		o.drag = null
		o.tend = null
		# Knocked off his feet, or out of the fight: whoever he was going to waits for another.
		if mind.rescue != null and (not t.is_free() or mind.mode != "combat"):
			_end_rescue(mind)
		# Coming in through the door: nothing else until he is in.
		if mind.entering != null:
			if t.is_free():
				_march(mind, cues)
			else:
				mind.entering = null
			o.aim_at = mind.aim_point
			continue
		_perceive(mind, dt, hero, hero_speed, saber, noises, cues)
		# In the Force's grip, on the floor, running off: he is not his own master.
		if not t.is_free():
			_release(mind)
			plan.movers.erase(mind.id)
			if mind.tactic != "move":
				mind.tactic = null
			mind.peek = null
			o.aim_at = mind.aim_point
			continue
		if mind.mode == "calm":
			_patrol(mind, dt)
		elif mind.mode == "suspicious":
			_investigate(mind, dt)
		elif mind.mode == "searching" or mind.mode == "sweep":
			if mind.sees and mind.awareness >= 1.0:
				_alert(mind, cues)
			else:
				_sweep(mind, dt)
		elif mind.mode == "combat" and not (mind.rescue != null and _rescue(mind, dt, hero, cues)):
			_fight(mind, dt, hero, hero_velocity, shots, cues)
		# His rifle points where his mind's aim point is, wherever that moved this turn.
		o.aim_at = mind.aim_point
	return { "shots": shots, "cues": cues }


## The squad's mood: 'calme', 'suspicion' or 'alerte'.
func mood() -> String:
	if minds.any(func(mind: Dictionary) -> bool: return mind.mode == "combat"):
		return "alerte"
	if minds.any(func(mind: Dictionary) -> bool: return mind.mode == "suspicious" or mind.mode == "searching"):
		return "suspicion"
	return "calme"


## Rounds through a room for men without a post of their own (the escort): the
## free spots of a coarse grid (clear of the crates), split into `count`
## sectors round the room's middle; each round is a loop through a few spots of
## its sector, near and far apart, in order round it.
static func patrol_rounds(level: Obstacles, grid: Nav, bounds: Dictionary, count: int = 5, spacing: float = 2.5, margin: float = 1.6) -> Array:
	var points: Array[Vector3] = []
	var x: float = bounds.minX + margin
	while x <= bounds.maxX - margin:
		var z: float = bounds.minZ + margin
		while z <= bounds.maxZ - margin:
			var spot := Vector3(x, 0, z)
			if (grid == null or grid.walkable(spot)) and level.push_out(spot, 0.6).distance_to(spot) < 1e-3:
				points.append(spot)
			z += spacing
		x += spacing
	if points.is_empty():
		return []
	var centre := Vector3.ZERO
	for point in points:
		centre += point
	centre /= points.size()
	var sectors := []
	for k in count:
		sectors.append([])
	for point in points:
		var angle := atan2(point.x - centre.x, point.z - centre.z)
		sectors[mini(count - 1, int(floor((angle + PI) / (2.0 * PI) * count)))].append(point)
	var rounds := []
	for sector: Array in sectors:
		if sector.size() < 2:
			continue
		# The spot furthest out, then each time the one furthest from those already chosen.
		var first: Vector3 = sector[0]
		for point: Vector3 in sector:
			if not (first.distance_to(centre) > point.distance_to(centre)):
				first = point
		var chosen: Array = [first]
		while chosen.size() < mini(4, sector.size()):
			var best: Variant = null
			var best_gap := -1.0
			for point: Vector3 in sector:
				if chosen.has(point):
					continue
				var gap := INF
				for other: Vector3 in chosen:
					gap = minf(gap, other.distance_to(point))
				if gap > best_gap:
					best_gap = gap
					best = point
			chosen.append(best)
		var middle := Vector3.ZERO
		for point: Vector3 in chosen:
			middle += point
		middle /= chosen.size()
		chosen.sort_custom(func(a: Vector3, b: Vector3) -> bool: return atan2(a.x - middle.x, a.z - middle.z) < atan2(b.x - middle.x, b.z - middle.z))
		rounds.append(chosen)
	return rounds
