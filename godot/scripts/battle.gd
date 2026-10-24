class_name Battle
extends Node3D
## The fight in the lab (the squad's part of src/main.js): the stormtroopers
## at their posts among the crates, unaware of the hero at first — sentries
## and patrols —, their minds (SquadMind) on the navigation grid (Nav), the
## "?" and "!" over their heads (Alerts); every so often the great door opens
## and more march in (Reinforcements). Each frame, after the hero: the squad
## thinks and gives its orders, the men move, fall, get up; the hero's blade
## is tested against each of them, and what it does is felt — a beat of slow
## motion on a clean cut, the view kicked and shaken, a noise the squad hears.
## The course: the squad at its posts; all of them down, an escort marches in
## through the door. (The Jedi who comes after it is step 5 of the migration;
## the bolts their rifles fire, step 4: for now they only take aim and fire
## blanks.) T or L3 starts it all again.

## The screen's right and up on the floor (the iso camera's axes).
const SCREEN_RIGHT := Vector3(0.780869, 0, -0.624695)

var hero: Hero
var level: LabLevel
var camera: CameraRig
var feel: Dictionary
var effects := ImpactEffects.new()
var alerts: Alerts
var nav: Nav
var squad: SquadMind
var reinforcements: Reinforcements
var rounds: Array = []
var troopers: Array = []
var course := { "stage": "squad", "clock": 0.0 }
## What the squad hears this frame: footsteps, the blade, blows, the Force, shots.
var noises: Array = []
var shots_fired := 0
var _last_base := Vector3.ZERO
var _last_tip := Vector3.ZERO
var _blade_ready := false
## Hit stops: at most one per enemy and per strike.
var _stopped := {}
var _stopped_key := ""


func _init(the_hero: Hero, lab: LabLevel, view: CameraRig) -> void:
	name = "Battle"
	hero = the_hero
	level = lab
	camera = view
	# After the hero: his blade and his move this frame are what the squad meets.
	process_priority = 10


func _ready() -> void:
	feel = CombatController._load("res://assets/data/feel.json")
	alerts = Alerts.new()
	alerts.camera = camera
	add_child(alerts)
	nav = Nav.new(level.obstacles, level.bounds)
	for post in level.posts:
		troopers.append(_make(post.position, post.heading))
	squad = SquadMind.new(troopers, level.obstacles, nav, alerts, level.posts, Callable(), SCREEN_RIGHT, feel)
	reinforcements = Reinforcements.new(level.door, feel)
	rounds = SquadMind.patrol_rounds(level.obstacles, nav, level.bounds)
	hero.battle = self


func _make(at: Vector3, heading: float) -> Stormtrooper:
	var trooper := Stormtrooper.new(at, heading, Callable(), level.obstacles, effects, feel)
	add_child(trooper)
	return trooper


func noise(position: Vector3, radius: float, options: Dictionary = {}) -> void:
	var entry := { "position": position, "radius": radius }
	entry.merge(options)
	noises.append(entry)


## Where a trooper is on the floor: standing, his hips; down, his waist.
static func where_is(trooper: Stormtrooper) -> Vector3:
	var block: Variant = trooper.blocker()
	if block != null:
		return Vector3(block.x, 0, block.z)
	var at := trooper.particle("W")
	return Vector3(at.x, 0, at.z)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("restart"):
		restart()


## For checks: every man still standing struck down where he is.
func clear_room() -> void:
	for trooper: Stormtrooper in troopers:
		if not trooper.dead:
			trooper.die("slash", Vector3(0, 0, 1))


## Everything as it was: the squad at its posts, the hero at the start, the door shut.
func restart() -> void:
	for trooper: Stormtrooper in troopers.duplicate():
		if trooper.reinforcement:
			squad.remove(trooper)
			trooper.queue_free()
	troopers = troopers.filter(func(trooper: Stormtrooper) -> bool: return not trooper.reinforcement)
	if level.door:
		level.door.reset()
	reinforcements.reset()
	for trooper: Stormtrooper in troopers:
		trooper.reset()
	effects.clear()
	squad.reset()
	noises.clear()
	course = { "stage": "squad", "clock": 0.0 }
	hero.restart()
	_blade_ready = false


## One of a wave: made in the corridor, marched through the door into the room, then off on his round.
func _bring_in(index: int) -> void:
	var door := level.door
	var heading := atan2(door.out.x, door.out.z)
	var trooper := _make(door.inside[index % door.inside.size()], heading)
	trooper.reinforcement = true
	troopers.append(trooper)
	# Through the doorway, then round whatever stands in the way to a free spot fanned out in front.
	var threshold := door.centre + door.out * 0.7
	var wanted := door.centre + door.out * (2.3 + (index % 2) * 0.9) + door.along * (((index % 4) - 1.5) * 0.9)
	var near: Variant = nav.nearest(wanted)
	var post: Vector3 = near if near != null else threshold + door.out * 1.5
	# His round, from its spot nearest the door.
	var route: Variant = null
	if not rounds.is_empty():
		var points: Array = rounds[(index + reinforcements.waves) % rounds.size()]
		var first := 0
		for k in points.size():
			if (points[k] as Vector3).distance_to(post) < (points[first] as Vector3).distance_to(post):
				first = k
		route = points.slice(first) + points.slice(0, first)
	var way: Variant = nav.path(threshold, post)
	squad.add(trooper, { "position": post, "heading": heading, "route": route }, [threshold] + (way if way != null else [post]))
	_clear_bodies()


## Too many men in the room, dead ones included: the oldest bodies are cleared away.
func _clear_bodies() -> void:
	while troopers.size() > feel.reinforce.bodies:
		var old: Variant = null
		for trooper: Stormtrooper in troopers:
			if trooper.dead and trooper.fallen and not trooper.is_impaled() and trooper != hero.held and not hero.is_skewering(trooper):
				old = trooper
				break
		if old == null:
			return
		squad.remove(old)
		troopers.erase(old)
		old.queue_free()


## The fight's course: the squad at its posts; all of them down, an escort marches in through the great door.
func _course_step(sim: float) -> void:
	if course.stage != "squad" and course.stage != "escort":
		return
	# Nobody standing, and nobody still to come through the door.
	var cleared := not troopers.any(func(trooper: Stormtrooper) -> bool: return not trooper.dead) and reinforcements.phase == "idle"
	course.clock = course.clock + sim if cleared else 0.0
	if course.stage == "squad" and course.clock > feel.course.escortAfter:
		reinforcements.summon(int(feel.course.escort))
		course.stage = "escort"
		course.clock = 0.0
	elif course.stage == "escort" and course.clock > feel.course.jediAfter:
		course.stage = "done"
		course.clock = 0.0


func _process(delta: float) -> void:
	var sim := hero.sim
	var time := hero.time
	var at := hero.position
	var velocity := Vector3(hero.motion.vx, 0, hero.motion.vz)
	# The squad: senses, decisions, orders; then the shots leave the muzzles.
	var thoughts := squad.update(sim, at, velocity, hero.motion.saber, noises)
	noises.clear()
	# The escort: the alarm, the door, the men coming out one by one.
	# Only the living hold the door open: a man cut down in the doorway is not coming in any more.
	var entering := squad.minds.filter(func(mind: Dictionary) -> bool: return mind.entering != null and not mind.trooper.dead).size()
	for event in reinforcements.update(sim, entering):
		if event is Dictionary and event.type == "spawn":
			_bring_in(event.index)
	_course_step(sim)
	for shot in thoughts.shots:
		shots_fired += 1
		noise(shot.from, 12.0, { "alarm": true, "from": at, "source": shot.trooper })
	hero.keep_skewer(sim)
	for trooper: Stormtrooper in troopers:
		trooper.focus = at
		trooper.update(sim, time)
	Stormtrooper.collide_squad(troopers)
	_strikes(sim, time)
	effects.update(sim)
	if level.door:
		level.door.update(sim, time)
	alerts.update(delta, func(trooper: Object) -> Variant: return null if trooper.dead or trooper.is_impaled() else trooper.particle("HT"), SCREEN_RIGHT)
	# In a fight, the view leans a little towards the squad, so the shooters stay in frame.
	var lean := Vector3.ZERO
	var weight := 0.0
	for mind in squad.minds:
		if mind.mode != "combat" or mind.trooper.dead:
			continue
		var p: Vector3 = mind.trooper.root.position
		var distance := Vector2(p.x - at.x, p.z - at.z).length()
		if distance > 14.0:
			continue
		var w := 1.0 / (1.0 + distance * 0.2)
		lean += Vector3(p.x - at.x, 0, p.z - at.z) * w
		weight += w
	if weight > 0.0:
		lean = (lean * (0.32 / weight)).limit_length(2.2)
	camera.lean_toward(lean, sim)


## The hero's blade against each man; what it does, felt; their landings heard.
func _strikes(sim: float, time: float) -> void:
	var blade := hero.saber.segment()
	var base: Vector3 = blade[0]
	var tip: Vector3 = blade[1]
	var key := "%d:%d" % [hero.combat.sequence, hero.combat.hits]
	if key != _stopped_key:
		_stopped.clear()
		_stopped_key = key
	for index in troopers.size():
		var trooper: Stormtrooper = troopers[index]
		var struck: Array = []
		if hero.saber.extension > 0.6 and _blade_ready and not hero.is_skewering(trooper):
			struck = trooper.strike(_last_base, _last_tip, base, tip, sim, time, key)
		# A man cut down before he knew it makes little noise; a fight, a lot.
		var silent := struck.any(func(event: Dictionary) -> bool: return event.get("lethal", false)) and trooper.unaware
		if struck.any(func(event: Dictionary) -> bool: return event.type != "fall"):
			noise(trooper.root.position, 3.0 if silent else 9.0, { "alarm": true, "from": hero.position, "source": trooper })
		for event in struck:
			# Falls are reported alongside the blow that caused them.
			if event.type == "fall" or (event.type == "graze" and event.speed < 1.0):
				continue
			var heavy: bool = event.type == "cut" or event.type == "slash" or event.type == "disarm"
			# A short hit stop on a clean cut, a little longer on a felling blow — once per enemy and per strike.
			var felling: bool = event.get("lethal", false) or event.get("felled", false)
			if heavy and not _stopped.has(index):
				_stopped[index] = true
				var stop: Array = feel.hitStop.felling if felling else (feel.hitStop.cut if event.type == "cut" else feel.hitStop.blow)
				hero.stop_for(stop[0], stop[1])
			camera.shove(event.velocity, feel.camera.kickFelling if felling else (feel.camera.kick if heavy else 0.012))
			if heavy:
				camera.punch(feel.camera.punch * (1.8 if felling else (1.0 if event.type == "cut" else 0.7)))
			camera.trauma.add(0.26 if felling else (0.14 if heavy else 0.03))
		# Landings: heard and felt in step with the physics.
		for item in trooper.take_news():
			if item.type == "land":
				camera.trauma.add(minf(0.15, item.speed * 0.02))
				noise(item.point, clampf(2.0 + item.speed * 1.2, 2.5, 7.0), { "alarm": true, "from": hero.position, "source": trooper })
	_blade_ready = hero.saber.extension > 0.6
	_last_base = base
	_last_tip = tip
