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
## through the door. (The Jedi who comes after it is step 5 of the migration.)
## T or L3 starts it all again.
##
## Their bolts (Blasters): the blade meets them — guard held, it snaps to a
## bolt about to arrive, from the front, the side or behind his back
## (auto_parry); a strike under way knocks one away — and sends them back,
## at an enemy the closer the shooter is and the better trained the hero
## (`precision`), straight into the shooter on a perfect parry (the guard
## pressed just before it arrives, and the rest of that burst after it). A
## bolt that reaches him waits a few frames at his chest, unseen: a parry
## meanwhile still sends it back. Otherwise it burns him (god mode: nothing
## more; else he falls dead).
##
## Their grenades (Grenades): thrown at him, blinking, a red ring on the floor
## for their reach; the Force pushes them away. One goes off (detonate): the
## fireball (Explosions), sparks, the lab's loose objects thrown (Debris), a
## burn left on the floor and the crates (ScorchMarks); the troopers near it
## killed or thrown, the hero knocked off his feet (HeroRagdoll) — or killed,
## god mode off (G toggles it). Dead, he lies there, his wounds (Wounds)
## bleeding, until a press starts it all again (the death screen).
##
## The room keeps what happens in it: the lit blade melts the crates, walls
## and floor it goes into (SaberScars); a foot that comes down in red drops
## prints its sole on the next steps (Footprints).
##
## The transformer in the corner (Transformer): the hero runs his blade into
## it (Hero's plunge); it surges, then blows — a white flash, a beat of slow
## motion, the hero thrown back — and the room's power dies (Power): every
## light out at once, a wave of sparks running through the fittings. Then the
## dark: the troopers' rifle lamps clicking on one by one (Flashlights), the
## blade's glow the only light round the hero, the red stains dark but where
## a light falls on them (StainLight).
##
## Stage 2, the marsh ruins (JungleLevel, in place of the lab): four
## generators to destroy wherever the hero likes, each in its core; each one
## blown cuts its zone's light and sounds the alarm, a wave of men coming in
## down the trail behind the command post. The last blown, it is won. The
## jungle answers what happens: footsteps in the sand and the water, the blade
## through the plants, blasts digging craters, the Force through the plants
## and the water. By night (at random, or as asked), the troopers' rifle lamps
## are on from the start and they see less far; in the reeds or wading, the
## hero is harder to see.

## The screen's right and up on the floor (the iso camera's axes).
const SCREEN_RIGHT := Vector3(0.780869, 0, -0.624695)

var hero: Hero
var level  ## LabLevel or JungleLevel
## The marsh ruins (stage 2), or null in the lab.
var jungle: JungleLevel
var camera: CameraRig
var feel: Dictionary
var effects: ImpactEffects
var blasters: Blasters
var grenades: Grenades
var explosions: Explosions
var debris: Debris
var marks: ScorchMarks
var scars: SaberScars
var prints: Footprints
var transformer: Transformer
## Every generator (the lab's one transformer, the jungle's four).
var transformers: Array[Transformer] = []
## The jungle's objectives on screen (main.gd's).
var objectives: Objectives
## The jungle by night: 1; the lab: 0 until the power is cut.
var night_base := 0.0
var glints: AimGlints
var power: Power
var flashlights: Flashlights
## 0 by day, 1 once the power is cut.
var night := 0.0
## { age, cut } from the moment it blew; the sparks running through the fittings.
var _blackout: Variant = null
var _cascade: Array = []
## The burst's white flash over everything.
var _flash: ColorRect
var _flash_age := INF
var _stir_tip := Vector3.ZERO
var _swing := 0.0
## The effects' lights (flashes, bolts, blasts, rifle lamps): hidden while dark, so they cost nothing (a shadowed lamp would draw its shadows).
var _effect_lights: Array[Light3D] = []
## Each walker's soles: how red each one is, and which came down last.
var _soles := {}
var _hero_step := 0.6
var _trooper_steps := {}
var _scar_sparks := 0.0
## The hero thrown off his feet, and his wounds when he dies.
var knockdown: HeroRagdoll
var wounds: Wounds
var death_screen: DeathScreen
## { cause, age, lying, pooled } once he is dead (god mode off).
var death: Variant = null
var alerts: Alerts
var nav: Nav
var squad: SquadMind
var reinforcements: Reinforcements
var rounds: Array = []
var troopers: Array = []
var course := { "stage": "squad", "clock": 0.0, "wave": 0, "destroyed": 0, "pending": 0 }
## What the squad hears this frame: footsteps, the blade, blows, the Force, shots.
var noises: Array = []
var shots_fired := 0
## God mode (the default): a bolt only burns him.
var god_mode := true
## The chance that a bolt the blade sends back goes for an enemy: it grows with every deflection, more with every enemy hit.
var precision := 0.0
var deflections := 0
var perfects := 0
var late_parries := 0
var burns := 0
var kills := 0
var _last_base := Vector3.ZERO
var _last_tip := Vector3.ZERO
var _blade_ready := false
## Hit stops: at most one per enemy and per strike.
var _stopped := {}
var _stopped_key := ""


func _init(the_hero: Hero, stage: Node3D, view: CameraRig) -> void:
	name = "Battle"
	hero = the_hero
	level = stage
	jungle = stage as JungleLevel
	camera = view
	if jungle and jungle.night:
		night_base = 1.0
	night = night_base
	# After the hero: his blade and his move this frame are what the squad meets.
	process_priority = 10


func _ready() -> void:
	feel = CombatController._load("res://assets/data/feel.json")
	precision = feel.deflect.precision.start
	effects = ImpactEffects.new(level.obstacles, feel)
	add_child(effects)
	# Burns that stay: blasts and bolts mark the floor and the crates for good.
	marks = ScorchMarks.new(level.obstacles)
	add_child(marks)
	# The blade melts what it goes into: molten trails that cool, cuts that stay.
	scars = SaberScars.new(level.obstacles, level.bounds)
	add_child(scars)
	# Red footprints: whoever treads in red drops prints his soles on the next steps.
	prints = Footprints.new(feel)
	add_child(prints)
	blasters = Blasters.new(effects, level.obstacles, marks)
	add_child(blasters)
	explosions = Explosions.new(marks, 5)
	add_child(explosions)
	# Scraps of the lab's floor, and what a blast throws out.
	debris = Debris.new(level.obstacles)
	add_child(debris)
	# Scraps of the lab's floor: none in the jungle.
	if not jungle:
		debris.scatter()
	grenades = Grenades.new(level.obstacles, feel.grenade.reach)
	add_child(grenades)
	for spec in level.generator_specs():
		var t := Transformer.new(spec.room, spec.data, feel, effects)
		t.generator = spec.name
		t.label = spec.label
		t.zone = spec.zone
		add_child(t)
		transformers.append(t)
	transformer = transformers[0]
	flashlights = Flashlights.new(feel, level.obstacles, level.bounds)
	add_child(flashlights)
	glints = AimGlints.new()
	add_child(glints)
	var overlay := CanvasLayer.new()
	overlay.name = "Flash"
	overlay.layer = 3
	add_child(overlay)
	_flash = ColorRect.new()
	_flash.color = Color(0.86, 0.92, 1.0, 0.0)
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(_flash)
	for slot in effects._lights:
		_effect_lights.append(slot.light)
	_effect_lights.append_array(blasters._lights)
	for slot in explosions.pool:
		_effect_lights.append(slot.light)
	_effect_lights.append_array(flashlights.pool)
	_effect_lights.append_array(flashlights.spills)
	knockdown = HeroRagdoll.new(hero, hero.animator, level.obstacles)
	wounds = Wounds.new(hero, hero.animator, feel)
	add_child(wounds)
	alerts = Alerts.new()
	alerts.camera = camera
	add_child(alerts)
	nav = Nav.new(level.obstacles, level.bounds, 0.4, 0.33, 0.35, jungle.nav_cost if jungle else Callable())
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
	elif event.is_action_pressed("god_mode"):
		god_mode = not god_mode
		print("Mode invincible : %s" % ("oui" if god_mode else "non"))


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
	blasters.clear()
	grenades.clear()
	explosions.clear()
	marks.clear()
	scars.clear()
	prints.clear()
	_soles.clear()
	_trooper_steps.clear()
	debris.clear()
	if not jungle:
		debris.scatter()
	else:
		jungle.reset()
	squad.reset()
	noises.clear()
	course = { "stage": "squad", "clock": 0.0, "wave": 0, "destroyed": 0, "pending": 0 }
	knockdown.stop()
	death = null
	wounds.clear()
	for t in transformers:
		t.reset()
	transformer = transformers[0]
	flashlights.clear()
	glints.clear()
	night = night_base
	_blackout = null
	_cascade.clear()
	_flash_age = INF
	if power:
		power.level = 1.0
		power.apply()
	if death_screen:
		death_screen.display(false)
	hero.restart()
	_blade_ready = false


## For checks: a grenade thrown by the first trooper at (x, z), its fuse short.
func grenade_at(x: float, z: float) -> void:
	var start: Vector3 = troopers[0].root.position
	grenades.throw_at(Vector3(start.x, 1.3, start.z), Vector3(x, 0, z), 1.6)


## One of a wave: made in the corridor, marched through the door into the room, then off on his round.
func _bring_in(index: int) -> void:
	var door: LabDoor = level.door
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
	while troopers.size() > feel.reinforce.bodies + (12 if jungle else 0):
		var old: Variant = null
		for trooper: Stormtrooper in troopers:
			if trooper.dead and trooper.fallen and not trooper.is_impaled() and trooper != hero.held and not hero.is_skewering(trooper):
				old = trooper
				break
		if old == null:
			return
		squad.remove(old)
		troopers.erase(old)
		_soles.erase(old)
		_trooper_steps.erase(old)
		old.queue_free()


## The fight's course: the squad at its posts; all of them down, an escort marches in through the great door.
## In the jungle: each generator blown calls a wave down the trail, one after the other; the last blown, it is won.
func _course_step(sim: float) -> void:
	if jungle:
		if course.stage == "squad":
			var waves: Array = feel.course.waves
			if course.pending > 0 and reinforcements.phase == "idle" and reinforcements.summon(int(waves[mini(course.wave, waves.size() - 1)])):
				course.pending -= 1
				course.wave += 1
			if course.destroyed >= transformers.size():
				course.clock += sim
				if course.clock > feel.course.waveAfter:
					course.stage = "won"
					course.clock = 0.0
		elif course.stage == "won":
			course.clock += sim
		return
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
	_death_step(delta, sim)
	var thoughts := squad.update(sim, at, velocity, hero.motion.saber, noises, night, jungle.seen(at) if jungle else 1.0)
	noises.clear()
	if death != null:
		thoughts.shots.clear()
	# The escort: the alarm, the door, the men coming out one by one.
	# Only the living hold the door open: a man cut down in the doorway is not coming in any more.
	var entering := squad.minds.filter(func(mind: Dictionary) -> bool: return mind.entering != null and not mind.trooper.dead).size()
	for event in reinforcements.update(sim, entering):
		if event is Dictionary and event.type == "spawn":
			_bring_in(event.index)
	_course_step(sim)
	for shot in thoughts.shots:
		shots_fired += 1
		blasters.fire(shot.from, shot.direction, shot.trooper, feel.blaster.speed)
		noise(shot.from, 12.0, { "alarm": true, "from": at, "source": shot.trooper })
	hero.keep_skewer(sim)
	for trooper: Stormtrooper in troopers:
		trooper.focus = at
		trooper.update(sim, time)
	Stormtrooper.collide_squad(troopers)
	_cut_room(sim)
	_strikes(sim, time)
	# Bolts fly: the blade, the hero, the troopers, then crates and floor.
	for event in blasters.update(sim, _bolt_meets):
		if jungle and event.type == "impact" and event.point.y < 0.3:
			jungle.bolt(event.point)
	for blast in grenades.update(sim):
		detonate(blast)
	explosions.update(sim)
	debris.update(sim)
	_footfalls(sim)
	effects.update(sim)
	prints.update(sim)
	if level.door:
		level.door.update(sim, time)
	_power_step(sim, delta)
	if jungle:
		_jungle_step(sim, time)
	if objectives:
		objectives.update(delta, transformers, course, camera)
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
	for light in _effect_lights:
		light.visible = light.light_energy > 1e-4


# ---- Bolts against the blade, the hero, the troopers --------------------------------

func _chest() -> Vector3:
	return Vector3(hero.motion.x, 1.05, hero.motion.z)


func _facing() -> Vector3:
	return Vector3(sin(hero.motion.heading), 0, cos(hero.motion.heading))


## Is that point in front of the hero (where the blade can cover)?
func _in_front(point: Vector3) -> bool:
	var offset := point - _chest()
	offset.y = 0.0
	return offset.length_squared() < 1e-6 or SquadMind._angle(offset, _facing()) < 1.95


## The blade up to take a bolt: guarding, or in a parry.
func guard_up() -> bool:
	return hero.saber.extension > 0.6 and (hero.combat.guard > 0.4 or str(hero.combat.output.name).begins_with("parry"))


## RB held: a bolt about to arrive — or to pass close by — makes the blade snap
## to meet it, on its side; from behind, the blade goes down his back.
func auto_parry(guarding: bool) -> void:
	if not guarding or hero.saber.extension < 0.6:
		return
	var chest := _chest()
	var d: Dictionary = feel.deflect
	for bolt in blasters.live:
		if bolt.deflected or bolt.parried != "":
			continue
		var offset: Vector3 = bolt.position - chest
		var velocity: Vector3 = bolt.velocity
		var speed := velocity.length()
		var closing := -offset.dot(velocity) / speed
		if closing <= 0.0:
			continue
		var passes := (offset + velocity * (closing / speed)).length()
		var reach := maxf(d.reach, minf(passes, d.near))
		# From behind the blade has further to go (over the shoulder, down his back): it sets off sooner.
		var local := offset.rotated(Vector3.UP, -hero.motion.heading)
		var back := not _in_front(bolt.position)
		if passes > d.near or (closing - reach) / speed > (d.reactBack if back else d.react):
			continue
		var side: Variant = "back" if back else ("left" if local.x > 0.12 else ("right" if local.x < -0.12 else ("high" if bolt.position.y > 1.45 else null)))
		if hero.combat.deflect(side):
			bolt.parried = "back" if back else "side"


## The blade meets a bolt and sends it back — at an enemy if his precision allows, else somewhere off.
func _deflect_bolt(bolt: Dictionary, a: Vector3, b: Vector3) -> void:
	var blade := hero.saber.segment()
	var meet := Stormtrooper._closest(a, b, blade[0], blade[1])
	var at: Vector3 = meet.c2
	var incoming: Vector3 = (bolt.velocity as Vector3).normalized()
	var enemies := []
	for trooper: Stormtrooper in troopers:
		if not trooper.dead:
			enemies.append({ "point": trooper.particle("W").lerp(trooper.particle("N"), 0.45), "shooter": is_same(trooper, bolt.owner), "down": trooper.fallen })
	# Closing in on the shooter, guard up, the returns find him more and more surely.
	var shooter: Stormtrooper = bolt.owner if bolt.owner is Stormtrooper and not bolt.owner.dead else null
	var d: Dictionary = feel.deflect
	var closeness := 0.0
	if shooter:
		var here := Vector3(hero.motion.x, 0, hero.motion.z)
		closeness = clampf((d.close[1] - shooter.root.position.distance_to(here)) / (d.close[1] - d.close[0]), 0.0, 1.0)
	var perfect: bool = hero.time - hero.parry_at <= d.perfect or hero.time <= hero.perfect_until
	if perfect:
		hero.perfect_until = hero.time + d.chain
		hero.parry_at = -INF
		perfects += 1
	var aim: Vector3 = Blasters.return_direction(at, incoming, precision, closeness, enemies, perfect, feel, func() -> float: return randf()).aim
	blasters.deflect(bolt, at, aim, feel.blaster.speed * (d.perfectSpeed if perfect else d.speedUp))
	bolt.perfect = perfect
	# Guarding, he turns a little into a shot from the side (one from behind is taken behind his back).
	var toward := atan2(a.x - hero.motion.x, a.z - hero.motion.z)
	var turn := atan2(sin(toward - hero.motion.heading), cos(toward - hero.motion.heading))
	if absf(turn) > 0.45 and absf(turn) < 1.95:
		hero.motion.face(hero.motion.heading + turn * 0.3)
	precision = minf(d.precision.max, precision + d.precision.gain)
	var across := incoming.cross(Vector3.UP).normalized()
	if perfect:
		# The perfect one rings out: a bright spray, a blade-blue flare, a beat of slow motion.
		effects.sparks(at, (aim - incoming * 0.3).normalized(), across, { "count": roundi(Feel.pick([18, 26])), "speed": 4.2, "saber": 0.8 })
		effects.flash(at, 1.5, { "color": Color(0.55, 0.75, 1) })
		effects.burst(at, { "normal": incoming, "power": 1.1, "tint": "blue" })
		hero.stop_for(d.perfectStop[0], d.perfectStop[1])
		camera.punch(feel.camera.punch * 0.9)
		camera.shove(aim, 0.05)
	else:
		# A small spray, blade-blue and molten-yellow mixed.
		effects.sparks(at, (aim - incoming * 0.5).normalized(), across, { "count": roundi(Feel.pick([7, 13])), "speed": 3.0, "saber": 0.5 })
		effects.flash(at, 0.8)
		effects.burst(at, { "normal": incoming, "power": 0.45, "tint": "red" })
		hero.stop_for(0.012, 0.035)
		camera.shove(aim, 0.025)
	hero.combat.output.flare = 1.0
	camera.trauma.add(0.2 if perfect else 0.07)
	noise(at, 9.0, { "alarm": true, "from": _chest() })
	deflections += 1


## A bolt reaches the hero: it burns.
func _burn_hero(bolt: Dictionary, point: Vector3) -> void:
	var incoming: Vector3 = (bolt.velocity as Vector3).normalized()
	var back := -incoming
	back.y = 0.4
	effects.sparks(point, back.normalized(), Vector3(incoming.z, 0, -incoming.x), { "count": 12, "speed": 2.0 })
	effects.flash(point, 0.6, { "color": Color(1, 0.06, 0.04) })
	effects.burst(point, { "power": 0.3, "tint": "red" })
	camera.shove(incoming, 0.018)
	camera.trauma.add(0.14)
	burns += 1


## The unseen grace: a bolt that reaches him waits a few frames at his chest; a parry meanwhile still sends it back.
func _hold_bolt(bolt: Dictionary, point: Vector3) -> void:
	var direction: Vector3 = (bolt.velocity as Vector3).normalized()
	bolt.held = { "since": hero.input_clock, "time": hero.time, "point": point, "velocity": bolt.velocity }
	bolt.velocity = (bolt.velocity as Vector3) * 1e-4
	bolt.position = point - direction * 0.08


## A held bolt, each frame: the guard in time sends it back; the window gone, it hits.
func _held_bolt(bolt: Dictionary) -> String:
	var h: Dictionary = bolt.held
	if death != null or hero.input_clock - h.since > feel.deflect.late.window:
		bolt.velocity = h.velocity
		bolt.held = null
		if death != null:
			return "spent"
		_burn_hero(bolt, h.point)
		if not god_mode:
			kill_hero("bolt", h.point, h.velocity)
		return "spent"
	if hero.parry_at >= h.time or guard_up():
		bolt.velocity = h.velocity
		bolt.held = null
		late_parries += 1
		# As if the blade had met it a little before his chest.
		_deflect_bolt(bolt, h.point - (h.velocity as Vector3) * 0.06, h.point)
		return "deflected"
	return ""


## Every bolt, every frame: the blade first, then the hero, then (sent back) the troopers.
func _bolt_meets(bolt: Dictionary, a: Vector3, b: Vector3) -> String:
	if bolt.held != null:
		return _held_bolt(bolt)
	var wall: Dictionary = level.obstacles.segment_hit(a, b, func(box: Dictionary) -> bool: return box.kind == "rail")
	var end: Vector3 = wall.point if not wall.is_empty() else b
	var d: Dictionary = feel.deflect
	var blade := hero.saber.segment()
	if not bolt.deflected:
		if death != null:
			return ""
		var chest := _chest()
		# Guarding, the blade takes a bolt coming at him from the front, and any bolt it has gone out to meet
		# (from behind, or passing close by). From behind, only the blade down his back stops it.
		var passing: float = Stormtrooper._closest(a, end, chest, chest).distance
		if guard_up():
			var front: bool = _in_front(a) and bolt.parried != "back"
			var playing: Variant = hero.combat.action
			var backed: bool = bolt.parried == "back" and playing != null and playing.name == "parryBack" and hero.combat.time / playing.duration > 0.22 \
				and (Stormtrooper._closest(a, end, blade[0], blade[1]).distance < d.blade or passing < d.body)
			if (front and passing < d.reach) or (bolt.parried == "side" and passing < d.near) or backed:
				_deflect_bolt(bolt, a, end)
				return "deflected"
		# A strike under way: a bolt crossing the swinging blade is knocked away.
		if hero.combat.busy() and hero.combat.output.trail > 0.2 and hero.saber.extension > 0.6 and Stormtrooper._closest(a, end, blade[0], blade[1]).distance < d.blade:
			_deflect_bolt(bolt, a, end)
			return "deflected"
		# Dashing, he is gone before it arrives: it flies on through where he was.
		if hero.dodging():
			return ""
		var body := Stormtrooper._closest(a, end, Vector3(hero.motion.x, 0.3, hero.motion.z), Vector3(hero.motion.x, 1.5, hero.motion.z))
		# Reaching him: a few frames' grace (a parry now still sends it back).
		if body.distance < 0.26:
			_hold_bolt(bolt, body.c1)
		return ""
	var best: Variant = null
	var struck: Stormtrooper = null
	for trooper: Stormtrooper in troopers:
		var hit: Variant = trooper.bolt_hit(a, end)
		if hit != null and (best == null or hit.s < best.s):
			best = hit
			struck = trooper
	if best == null:
		return ""
	var event := struck.shot(best, bolt.velocity)
	precision = minf(d.precision.max, precision + d.precision.hitGain)
	if event.get("lethal", false):
		kills += 1
	if event.get("lethal", false) or event.get("felled", false):
		var stop: Array = feel.hitStop.felling
		hero.stop_for(stop[0] * 0.8, stop[1])
		camera.punch(feel.camera.punch)
	camera.shove(bolt.velocity, feel.camera.kick if event.get("lethal", false) else 0.02)
	camera.trauma.add(0.16 if event.get("lethal", false) else 0.05)
	noise(struck.root.position, 9.0, { "alarm": true, "from": _chest(), "source": struck })
	return "spent"


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
				if jungle:
					jungle.landing(item.point, item.speed)
				camera.trauma.add(minf(0.15, item.speed * 0.02))
				noise(item.point, clampf(2.0 + item.speed * 1.2, 2.5, 7.0), { "alarm": true, "from": hero.position, "source": trooper })
			# A grenade leaves his hand (or drops at his feet if he was knocked over).
			elif item.type == "grenade" and death == null:
				if item.get("dropped", false):
					grenades.drop(item.from)
				else:
					grenades.throw_at(item.from, item.target, Feel.pick(feel.grenade.fuse))
		# His feet push the scraps on the floor about.
		if not trooper.fallen:
			debris.kick(trooper.root.position, trooper.loco.velocity)
	_blade_ready = hero.saber.extension > 0.6
	_last_base = base
	_last_tip = tip


# ---- Grenades and explosions; the hero thrown, or killed ----------------------------

## A grenade goes off at `at`: fire, light, sparks, debris; bodies are thrown, the hero too.
func detonate(at: Vector3) -> void:
	var blast: Dictionary = feel.blast
	explosions.spawn(at)
	effects.blast(at + Vector3(0, 0.25, 0), { "sparks": 200, "embers": 170, "speed": 12.0 })
	# A few that fly much further, long burning streaks.
	effects.blast(at + Vector3(0, 0.35, 0), { "sparks": 45, "embers": 0, "speed": 24.0 })
	debris.blast(at)
	debris.fragments(at, 18 + roundi(randf() * 8.0))
	# The plants flattened outward, the water thrown up, a crater dug.
	if jungle:
		jungle.blast(at, 1.0, blast.radius * 1.15)
	for trooper: Stormtrooper in troopers:
		var offset := where_is(trooper) - at
		offset.y = 0.0
		var distance := offset.length()
		if distance > blast.radius:
			continue
		var falloff := pow(1.0 - distance / blast.radius, 1.2)
		if distance < 1e-3:
			offset = Vector3(randf() - 0.5, 0, randf() - 0.5)
		offset = offset.normalized()
		if not trooper.dead and distance < blast.lethal:
			trooper.die("blast", offset * 6.0)
		var throw := offset * (Feel.pick(blast.speed) * falloff)
		throw.y = Feel.pick(blast.lift) * falloff
		trooper.force_push(throw)
	if hero.held and hero.held.dead:
		hero.held = null
	# The hero: knocked off his feet close by, rocked further off.
	var to_hero := Vector3(hero.motion.x, 0, hero.motion.z) - at
	var reach := to_hero.length()
	if reach < blast.radius:
		var falloff := pow(1.0 - reach / blast.radius, 1.1)
		var direction := to_hero / reach if reach > 1e-3 else Vector3(1, 0, 0)
		if not god_mode and death == null and reach < feel.death.blast:
			kill_hero("blast", at, direction, maxf(0.6, falloff))
		elif reach < blast.knock and not knockdown.active():
			knock_hero(direction, maxf(0.45, falloff))
		elif reach < blast.knock:
			var push := direction * (3.0 * falloff)
			push.y = 2.0 * falloff
			knockdown.knock(push)
		elif death == null:
			hero.motion.vx += direction.x * 6.0 * falloff
			hero.motion.vz += direction.z * 6.0 * falloff
	var near := maxf(0.0, 1.0 - reach / 14.0)
	# The whole view rocks: hard at his feet, still felt across the room.
	camera.trauma.add(0.42 + 0.58 * near)
	camera.shove(Vector3(0, -1, 0), blast.kick * (0.4 + 0.6 * near))
	camera.punch(blast.punch * near)
	hero.stop_for(0.012, 0.05)
	noise(at, 15.0, { "alarm": true, "from": hero.position })


## Off his feet: the ragdoll takes him, thrown away from the blast; he gets up again.
func knock_hero(direction: Vector3, falloff: float) -> void:
	var flat := Vector3(direction.x, 0, direction.z).normalized()
	var velocity := flat * (Feel.pick(feel.blast.speed) * falloff)
	velocity.y = Feel.pick(feel.blast.lift) * falloff
	velocity.x += hero.motion.vx * 0.5
	velocity.z += hero.motion.vz * 0.5
	hero.let_go()
	knockdown.knock(velocity, { "spin": Feel.pick(feel.blast.tumble) })
	_blade_ready = false


## God mode off, one mistake: he falls dead where the hit throws him. A bolt:
## a charred wound where it went in, red sprayed out the other side, a twist
## as he drops. A blast: thrown hard and tumbling, torn and spattered over the
## side that faced it, red flying everywhere. Then the moment slows, his blade
## goes out, his body bleeds where it lies — and "MORT", a press away from
## the next try.
func kill_hero(cause: String, point: Vector3, direction: Vector3, falloff: float = 1.0) -> void:
	if death != null:
		return
	var dead: Dictionary = feel.death
	var flat := Vector3(direction.x, 0, direction.z).normalized()
	death = { "cause": cause, "age": 0.0, "lying": 0.0, "pooled": false }
	hero.let_go()
	var chest_at := hero.bone_position("Spine2")
	if cause == "bolt":
		var push := flat * float(dead.bolt.push)
		push.y = dead.bolt.lift
		knockdown.knock(push, { "spin": dead.bolt.spin, "dead": true, "hit": { "at": point, "velocity": flat * float(dead.bolt.hit) } })
		wounds.strike(point, -flat, "bolt")
		effects.bleed(point, flat, Vector3.UP, { "speed": 3.0, "amount": dead.bleed.bolt })
	else:
		var velocity := flat * (Feel.pick(feel.blast.speed) * falloff * float(dead.blastThrow))
		velocity.y = Feel.pick(feel.blast.lift) * falloff * float(dead.blastThrow)
		knockdown.knock(velocity, { "spin": Feel.pick(feel.blast.tumble) * 1.3, "dead": true })
		wounds.riddle(-flat, roundi(Feel.pick(dead.wound.blast.count)))
		effects.bleed(chest_at, flat, Vector3.UP, { "speed": 5.0, "amount": dead.bleed.blast })
		var aside := Vector3(-flat.z, 0, flat.x) * (1.0 if randf() < 0.5 else -1.0)
		effects.bleed(chest_at, (aside + flat).normalized(), Vector3.UP, { "speed": 4.0, "amount": dead.bleed.blast * 0.6 })
	# His body keeps bleeding where it lies.
	for bone in (["Spine2"] if cause == "bolt" else ["Spine2", "Hips", "Head", "LeftForeArm"]):
		effects.drip(hero.bone_node(bone), Feel.pick(dead.drip), 1.3 if cause == "bolt" else 1.6)
	hero.stop_for(dead.slow[0], dead.slow[1])
	camera.trauma.add(0.65)
	camera.shove(flat, feel.camera.kick * 1.5)
	camera.punch(feel.camera.punch * 1.6)
	_blade_ready = false


## Dead: a pool spreads from under him, "MORT" shows; a press, and it all starts again.
func _death_step(delta: float, sim: float) -> void:
	if death == null:
		return
	death.age += delta
	death.lying += sim
	if not death.pooled and death.lying > feel.death.pool.after and knockdown.still() > 0.2:
		death.pooled = true
		wounds.spill(hero.bone_position("Spine2").lerp(knockdown.position(), 0.5))
	wounds.update(sim)
	if death_screen:
		death_screen.display(death.age > feel.death.show)
	if death.age > feel.death.retry and hero.retry_pressed():
		restart()


# ---- The blade's cuts in the room; footprints ---------------------------------------

## The lit blade in a case, a wall, the floor: a molten line follows it, and sparks.
func _cut_room(sim: float) -> void:
	if hero.saber.extension > 0.6 and _blade_ready and not knockdown.active() and sim > 0.0:
		var blade := hero.saber.segment()
		# Held low while he walks, the tip dips into the deck: only a strike marks the floor.
		var contacts := scars.cut(blade[0], blade[1], hero.combat.busy() and hero.action.trail > 0.2)
		_scar_sparks -= sim
		for contact in contacts:
			if not contact.fresh and _scar_sparks > 0.0:
				continue
			var normal: Vector3 = contact.normal
			var along: Vector3 = blade[1] - _last_tip
			along -= normal * along.dot(normal)
			if along.length_squared() < 1e-8:
				along = Vector3(normal.z, 0, -normal.x)
			along = along.normalized()
			effects.sparks(contact.point, (normal - along * 0.6).normalized(), along, { "count": 9 if contact.fresh else 3, "speed": 2.4, "saber": 0.35 })
		if not contacts.is_empty() and _scar_sparks <= 0.0:
			_scar_sparks = 0.05
		# Through the plants: the blade cuts what it meets; its tip through the stream throws it up.
		if jungle:
			jungle.cut(_last_base, _last_tip, blade[0], blade[1], blade[1].distance_to(_last_tip) / sim)
	scars.update(sim)


## A foot coming down: drops under it are trodden in (some taken up); a red sole prints, fainter each step.
func _footfall(walker: Object, at: Vector3, along: Vector3, side: String, size: Array) -> void:
	# In the jungle, it presses into the sand or splashes in the stream as well.
	if jungle:
		var speed: float = hero.motion.speed if walker == hero else (walker.loco.velocity.length() if walker is Stormtrooper else 1.5)
		jungle.step(at, along, side, size, speed)
	var sole: Dictionary = _soles.get(walker, { "L": 0.0, "R": 0.0, "last": "R" })
	sole.last = side
	var found := effects.tread(at)
	if found > 0:
		sole[side] = minf(1.0, sole[side] + found * float(feel.prints.soak))
	if sole[side] > feel.prints.faint:
		prints.stamp(at, along, side, sole[side], size)
	sole[side] *= float(feel.prints.dry)
	_soles[walker] = sole


## One foot after the other: the next foot to come down.
func _next_foot(walker: Object) -> String:
	return "L" if _soles.get(walker, { "last": "R" }).last == "R" else "R"


## The hero's steps (the motion capture's pace) and the troopers' (their walking speed): each foot that comes down.
func _footfalls(sim: float) -> void:
	var motion := hero.motion
	if not knockdown.active() and not hero.dashing() and motion.speed > 0.35:
		_hero_step += motion.speed * sim / (1.25 if motion.run_blend > 0.5 else 0.7)
		if _hero_step >= 1.0:
			_hero_step = fmod(_hero_step, 1.0)
			var side := _next_foot(hero)
			var foot := hero.bone_position("LeftFoot" if side == "L" else "RightFoot")
			var toe := hero.bone_position("LeftToeBase" if side == "L" else "RightToeBase")
			var along := Vector3(toe.x - foot.x, 0, toe.z - foot.z)
			if along.length_squared() < 1e-6:
				along = Vector3(sin(motion.heading), 0, cos(motion.heading))
			var at := foot.lerp(toe, 0.4)
			_footfall(hero, Vector3(at.x, 0, at.z), along.normalized(), side, feel.prints.hero)
	else:
		_hero_step = 0.6
	for trooper: Stormtrooper in troopers:
		if trooper.fallen or trooper.dead:
			continue
		var pace: float = trooper.loco.velocity.length()
		if pace < 0.35:
			_trooper_steps[trooper] = 0.5
			continue
		var phase: float = _trooper_steps.get(trooper, 0.5) + pace * sim / lerpf(0.62, 1.3, clampf((pace - 1.35) / 2.35, 0.0, 1.0))
		if phase >= 1.0:
			phase = fmod(phase, 1.0)
			var side := _next_foot(trooper)
			var heel := trooper.particle("HE" + side)
			var toe := trooper.particle("T" + side)
			var along := Vector3(toe.x - heel.x, 0, toe.z - heel.z)
			if along.length_squared() < 1e-6:
				var heading := trooper.heading_of()
				along = Vector3(sin(heading), 0, cos(heading))
			var at := heel.lerp(toe, 0.5)
			_footfall(trooper, Vector3(at.x, 0, at.z), along.normalized(), side, feel.prints.trooper)
		_trooper_steps[trooper] = phase


# ---- The transformer, the power, the dark -------------------------------------------

## main.gd's lights (environment, key, rim, strip): the room's power dims them with the rest.
func light_room(lights: Dictionary) -> void:
	if not jungle:
		power = Power.new(level, feel, lights)


## Each frame: the plunge, the transformer's surge and burst; the power's level
## (stuttering through the surge, the last flicker, then out) and the sparks of
## the wave; the rifle lamps; the light on the stains.
func _power_step(sim: float, delta: float) -> void:
	var blade: Array = []
	if hero.plunge != null and hero.plunge.entered:
		blade = hero.saber.segment()
	hero.plunge_step(sim)
	var state := {}
	for t in transformers:
		var result := t.update(sim, blade if t == transformer else [])
		if t == transformer:
			state = result
		if result.burst:
			transformer = t
			_overload()
		if result.spit and t.socket.distance_to(hero.position) < 14.0:
			camera.trauma.add(0.04)
	if state.progress > 0.0:
		camera.trauma.at_least(0.12 + 0.3 * state.progress)
	if power:
		if _blackout != null:
			_blackout.age += sim
			var age: float = _blackout.age
			if not _blackout.cut and age >= 0.05:
				_blackout.cut = true
				_cut_power()
				night = 1.0
			# One last stutter as it dies, then nothing.
			var level_now := 0.0
			for step in [[0.0, 0.15], [0.05, 0.0], [0.11, 0.45], [0.15, 0.0], [0.24, 0.2], [0.27, 0.0]]:
				if age >= step[0]:
					level_now = step[1]
			power.level = 1.0 if age < 0.05 else level_now
			for entry in _cascade:
				if entry.done or age - 0.05 < entry.when:
					continue
				entry.done = true
				var down := Vector3((randf() - 0.5) * 0.6, -1, (randf() - 0.5) * 0.6).normalized()
				effects.sparks(entry.at, down, Vector3(1, 0, 0), { "count": 5 + roundi(randf() * 8.0), "speed": 1.8 })
				if entry.pop:
					effects.flash(entry.at, 0.5)
		elif state.progress > 0.0:
			# The surge drags the room's lights down in stutters, worse as it builds.
			var surge: float = state.progress
			power.level = 0.2 + randf() * 0.4 if randf() < 0.08 + 0.45 * surge else 1.0 - 0.25 * surge
		elif night == 0.0:
			power.level = 1.0
		power.apply()
	# What stirs the dust in the beams: the hero going through, and his blade's tip.
	var tip: Vector3 = hero.saber.segment()[1]
	var swing := tip.distance_to(_stir_tip) / sim if sim > 0.0 else 0.0
	_stir_tip = tip
	_swing = swing
	var stirs := [{ "at": hero.position + Vector3(0, 1, 0), "speed": hero.motion.speed }, { "at": tip, "speed": minf(12.0, swing) }]
	flashlights.update(sim, troopers, hero.position, night, stirs)
	# A trooper about to fire: a red glint at his muzzle.
	var aiming: Array = []
	for mind in squad.minds:
		var t: Stormtrooper = mind.trooper
		if not t.dead and mind.mode == "combat" and mind.charge > 0.0 and t.holding:
			aiming.append({ "position": t.muzzle(), "amount": mind.charge })
	glints.update(delta, aiming)
	# In the dark the stains show only in the light that falls on them (the rifle lamps, the blade).
	var lights: Array = []
	lights.append_array(flashlights.pool)
	lights.append_array(flashlights.spills)
	lights.append_array(hero.saber.lights)
	StainLight.light(0.0 if night > 0.0 else (power.level if power else 1.0), lights)
	# The burst's flash over everything, gone in a third of a second.
	_flash_age += delta
	_flash.color.a = pow(1.0 - _flash_age / 0.3, 1.6) * 0.9 if _flash_age < 0.3 else 0.0


## It blew: the flash, the slow beat, the hero thrown back, and the power cut a hair later.
func _overload() -> void:
	var s := transformer.socket
	var out := transformer.facing
	var across := Vector3(out.z, 0, -out.x)
	hero.end_plunge()
	hero.motion.vx = out.x * 4.5
	hero.motion.vz = out.z * 4.5
	_flash_age = 0.0
	hero.stop_for(0.09, 0.34)
	camera.trauma.add(0.55)
	camera.punch(feel.camera.punch * 2.6)
	camera.shove(out, feel.camera.kickFelling * 1.3)
	effects.blast(s + out * 0.1, { "sparks": 150, "embers": 40, "speed": 8.0 })
	effects.sparks(s, Vector3(out.x, 0.6, out.z).normalized(), across, { "count": 90, "speed": 7.0, "saber": 0.7 })
	effects.flash(s, 3.5, { "color": Color(0.7, 0.85, 1) })
	debris.fragments(Vector3(s.x, 0.4, s.z), 10)
	marks.blast(Vector3(s.x, 0, s.z), 0.5)
	if transformer.model:
		effects.smoulder(transformer.model, 25.0)
	noise(s, 16.0, { "alarm": true, "from": s })
	# The lab's power dies with it; in the jungle, the generator's zone goes dark and the alarm calls men in.
	if not jungle:
		_blackout = { "age": 0.0, "cut": false }
		return
	jungle.sabotaged(transformer.zone)
	course.destroyed += 1
	if course.destroyed < transformers.size():
		course.pending += 1
	if objectives:
		objectives.pop()


## The power dies: lights out, sparks racing through the fittings; the squad loses the hero for a moment; the rifle lamps come on.
func _cut_power() -> void:
	var s := transformer.socket
	var wave: float = feel.sabotage.cascade
	var fittings := power.fixtures_from(s)
	var far := fittings[-1].distance_to(s) if not fittings.is_empty() else 1.0
	# A wave through the room: the nearest fittings first, a few spread out (not every one).
	var every := maxi(1, roundi(fittings.size() / 40.0))
	_cascade.clear()
	for index in fittings.size():
		if index % every != 0:
			continue
		var at: Vector3 = fittings[index]
		_cascade.append({ "at": at, "when": at.distance_to(s) / far * wave + randf() * 0.08, "pop": _cascade.size() % 3 == 0, "done": false })
	camera.trauma.add(0.2)
	squad.blackout()
	flashlights.darkness(troopers)


# ---- The jungle -----------------------------------------------------------------------

## Where the ground is at (x, z): a walkway's deck, a crater's floor; the lab's floor is flat.
func ground_at(x: float, z: float) -> float:
	return jungle.ground_at(x, z) if jungle else 0.0


## How far the dark makes the blade light round it: the jungle is never quite day for it.
func blade_dark() -> float:
	return maxf(0.5, night) if jungle else night


## Who goes through the plants and the water this frame: the hero, his blade held low, the bodies standing or lying, nearest first.
func _jungle_actors(swing: float) -> Array:
	var actors: Array = [{ "x": hero.motion.x, "z": hero.motion.z, "radius": 0.5, "strength": 1.0, "speed": hero.motion.speed }]
	var tip: Vector3 = hero.saber.segment()[1]
	if hero.saber.extension > 0.6 and tip.y < 0.9:
		actors.append({ "x": tip.x, "z": tip.z, "radius": 0.35, "strength": minf(1.5, swing / 6.0), "speed": swing, "wades": tip.y < 0.1 })
	var others: Array = []
	for trooper: Stormtrooper in troopers:
		var at := where_is(trooper)
		others.append({ "x": at.x, "z": at.z, "radius": 0.7 if trooper.fallen else 0.45, "strength": 0.8 if trooper.fallen else 1.0, "speed": trooper.loco.velocity.length() })
	var here := Vector2(hero.motion.x, hero.motion.z)
	others.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return Vector2(a.x, a.z).distance_squared_to(here) < Vector2(b.x, b.z).distance_squared_to(here))
	return (actors + others).slice(0, 8)


func _jungle_step(sim: float, time: float) -> void:
	var tip: Vector3 = hero.saber.segment()[1]
	var swing := _swing
	var stirs := [{ "at": hero.position + Vector3(0, 1, 0), "speed": hero.motion.speed }, { "at": tip, "speed": minf(12.0, swing) }]
	var lights: Array = []
	lights.append_array(hero.saber.lights)
	jungle.update(sim, time, hero.position, _jungle_actors(swing), stirs, lights)
