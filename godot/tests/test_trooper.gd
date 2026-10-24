extends TestCase
## A stormtrooper (scripts/trooper/stormtrooper.gd) against src/stormtrooper.js:
## the web's man taken through every scene of its script (bake.js's
## trooperScript) — walking, aiming, crouching, firing, a grenade; the blade's
## blows, a wound, limbs off, the fall and the crawl; the Force's push, pull and
## hold, the flight, hauled up off the floor; run through; beheaded; a bolt in
## the body, treated.
##
## A body thrown on the floor is chaotic: a millionth of a metre apart at the
## start, two throws end centimetres (decimetres for a long tumble) apart, a
## loose plate bounces one way or the other — Godot against itself does the
## same. So the checks are: standing, the same pose to the millimetre; the same
## blows, cuts and calls; and, until the floor's chaos sets in (his trunk
## CHAOS from the web's), the same states at the same moments (give or take a
## little), the same pose about him once back on his feet. Past that point the
## states must still come in the same order (a short 'stunned' aside, and the
## trace may stop a state sooner).

## Standing before any fall: the pose (m). Back up after one: the pose about his root (m).
const STANDING := 0.004
const BACK_UP := 0.02
## His trunk this far (m) from the web's: the floor's chaos has set in.
const CHAOS := 0.05
## A change of state may come this many steps sooner or later.
const LATE := 25


static func _v(values: Variant) -> Vector3:
	return Vector3(values[0], values[1], values[2])


static func _event(event: Dictionary) -> String:
	var text := "%s:%s" % [event.type, event.get("part", "undefined")]
	if event.has("joint"):
		text += ":" + str(event.joint)
	if event.get("lethal", false):
		text += ":lethal"
	if event.get("felled", false):
		text += ":felled"
	return text


## The calls of a step on him, as playTrooper() in bake.js makes them; what each returned.
static func _play(trooper: Stormtrooper, step: Dictionary) -> Array:
	var results := []
	for entry in step.get("calls", []):
		var method: String = entry[0]
		var args: Array = entry.slice(1)
		match method:
			"reset":
				trooper.reset()
				continue
			"shot":
				var a := _v(args[0])
				var b := _v(args[1])
				var hit: Variant = trooper.bolt_hit(a, b)
				results.append(trooper.shot(hit, (b - a).normalized() * args[2]).type if hit != null else null)
			"forcePull":
				results.append(trooper.force_pull(_v(args[0]), args[1].get("hold", false) if args.size() > 1 else false))
			"fire":
				var shot: Variant = trooper.fire()
				results.append(null if shot == null else [shot.from.x, shot.from.y, shot.from.z, shot.direction.x, shot.direction.y, shot.direction.z])
			"throwGrenade":
				results.append(trooper.throw_grenade(_v(args[0])))
			"forcePush":
				trooper.force_push(_v(args[0]))
				results.append(null)
			"hold":
				trooper.hold(_v(args[0]), args[1])
				results.append(null)
			"drop":
				trooper.drop()
				results.append(null)
			"impale":
				results.append(trooper.impale(_v(args[0]), args[1]))
			"skewer":
				trooper.skewer(_v(args[0]), args[1])
				results.append(null)
			"slideOff":
				results.append(trooper.slide_off(_v(args[0])))
			"attend":
				trooper.attend()
				results.append(null)
			"drag":
				trooper.drag(null if args[0] == null else _v(args[0]), null if args.size() < 2 or args[1] == null else _v(args[1]))
				results.append(null)
			"heal":
				results.append(trooper.heal())
	if step.has("order"):
		var given: Dictionary = step.order
		var o := trooper.order
		o.velocity = _v(given.velocity)
		o.face = given.face
		o.aim = given.aim
		o.crouch = given.crouch
		o.blind = given.blind
		o.over = given.over
		o.aim_at = null if given.aimAt == null else _v(given.aimAt)
		o.look = null if given.look == null else _v(given.look)
		o.drag = null if given.drag == null else _v(given.drag)
		o.tend = null if given.tend == null else _v(given.tend)
	if step.has("focus"):
		trooper.focus = _v(step.focus)
	return results


static func _same_result(got: Variant, want: Variant) -> bool:
	if want is Array:
		if not (got is Array) or got.size() != want.size():
			return false
		for k in want.size():
			if absf(got[k] - want[k]) > 2e-3:
				return false
		return true
	if want == null or got == null:
		return want == null and got == null
	return typeof(got) == typeof(want) and got == want


## What a scene went through: its states one after the other (and when), its blows and news, the calls' results.
class Scene:
	var states: Array = []
	var events: Array[String] = []
	var news: Array[String] = []
	var calls: Array = []
	var standing := 0.0
	var back_up := 0.0
	var lying := 0.0
	var fell := false
	## The step the floor's chaos set in (or -1).
	var chaos := -1

	func see(state: String, step: int) -> void:
		if states.is_empty() or states[-1][0] != state:
			states.append([state, step])

	## Its states from the chaos on, the short 'stunned' asides left out.
	func later(from: int) -> Array:
		return states.filter(func(s: Array) -> bool: return s[1] >= from and s[0] != "stunned").map(func(s: Array) -> String: return s[0])


func test_replays_the_javascript_trooper() -> void:
	var reference := data("trooper-reference.json")
	check(not reference.is_empty(), "trooper-reference.json manquant")
	if reference.is_empty():
		return
	var draws: Array = data("combat-reference.json").draws
	var counter := [0]
	var random := func() -> float:
		var value: float = draws[counter[0] % draws.size()]
		counter[0] += 1
		return value
	var trooper := Stormtrooper.new(Vector3.ZERO, 0.0, random)
	tree.root.add_child(trooper)
	var script: Array = reference.script
	var samples: Array = reference.samples
	var names: Array = reference.joints
	var sample := 0
	var previous: Variant = null
	var scene := ""
	var got := {}
	var want := {}
	for i in script.size():
		var step: Dictionary = script[i]
		if step.has("scene"):
			scene = step.scene
			got[scene] = Scene.new()
			want[scene] = Scene.new()
			# Each scene draws from the start of the list again (as the bake does).
			counter[0] = 0
		var mine: Scene = got[scene]
		var theirs: Scene = want[scene]
		var results := _play(trooper, step)
		trooper.update(step.dt, step.time)
		if step.has("blade") and previous != null:
			var b: Array = previous
			var c: Array = step.blade
			for event in trooper.strike(Vector3(b[0], b[1], b[2]), Vector3(b[3], b[4], b[5]), Vector3(c[0], c[1], c[2]), Vector3(c[3], c[4], c[5]), step.dt, step.time, step.blow):
				mine.events.append(_event(event))
		previous = step.get("blade")
		for item in trooper.take_news():
			mine.news.append(item.type)
		if not results.is_empty():
			mine.calls.append(results)
		if sample >= samples.size() or int(samples[sample].step) != i:
			continue
		var expected: Dictionary = samples[sample]
		sample += 1
		mine.see(trooper.state(), i)
		theirs.see(expected.state, i)
		for text: String in expected.events:
			if text.begins_with("calls:"):
				theirs.calls.append(JSON.parse_string(text.substr(6)))
			else:
				theirs.events.append(text)
		for item: String in expected.news:
			theirs.news.append(item)
		if trooper.fallen or expected.fallen:
			mine.fell = true
		if not trooper.fallen and expected.joints != null:
			if not mine.fell:
				var worst := trooper.root.position.distance_to(_v(expected.root))
				for k in names.size():
					worst = maxf(worst, (trooper.joints[names[k]] as Node3D).global_position.distance_to(_v(expected.joints[k])))
				mine.standing = maxf(mine.standing, worst)
			elif trooper.state() == expected.state and mine.chaos < 0:
				# Back up: the pose about him (where he got up is the floor's doing).
				var turn := Quaternion(expected.quaternion[0], expected.quaternion[1], expected.quaternion[2], expected.quaternion[3]).normalized().inverse()
				var origin := _v(expected.root)
				var worst := 0.0
				for k in names.size():
					var at := trooper.root.to_local((trooper.joints[names[k]] as Node3D).global_position)
					worst = maxf(worst, at.distance_to(turn * (_v(expected.joints[k]) - origin)))
				mine.back_up = maxf(mine.back_up, worst)
		elif trooper.fallen and expected.fallen and mine.chaos < 0:
			# His trunk: waist and neck.
			for key in ["W", "N"]:
				var k := trooper.index_of(key)
				mine.lying = maxf(mine.lying, trooper.particle_position(k).distance_to(_v(expected.particles[k])))
			if mine.lying > CHAOS:
				mine.chaos = i
	trooper.queue_free()
	check(sample == samples.size(), "%d échantillons comparés sur %d" % [sample, samples.size()])
	for name in got:
		var mine: Scene = got[name]
		var theirs: Scene = want[name]
		print("    %s : debout ≤ %.4f m, relevé ≤ %.4f m, tronc au sol ≤ %.3f m%s ; états %s" % [name, mine.standing, mine.back_up, mine.lying, " (chaos au pas %d)" % mine.chaos if mine.chaos >= 0 else "", ", ".join(mine.states.map(func(s: Array) -> String: return s[0]))])
		check(mine.standing <= STANDING, "%s : pose debout à %.4f m" % [name, mine.standing])
		check(mine.back_up <= BACK_UP, "%s : pose relevée à %.4f m" % [name, mine.back_up])
		var until := mine.chaos if mine.chaos >= 0 else 1 << 30
		var early := func(list: Array) -> Array: return list.filter(func(s: Array) -> bool: return s[1] < until)
		var mine_early: Array = early.call(mine.states)
		var theirs_early: Array = early.call(theirs.states)
		var same_states := mine_early.size() == theirs_early.size()
		for k in mini(mine_early.size(), theirs_early.size()):
			if mine_early[k][0] != theirs_early[k][0] or absi(mine_early[k][1] - theirs_early[k][1]) > LATE:
				same_states = false
		if mine.chaos >= 0:
			var a := mine.later(until)
			var b := theirs.later(until)
			if a.slice(0, b.size()) != b and b.slice(0, a.size()) != a:
				same_states = false
		check(same_states, "%s : états %s au lieu de %s" % [name, mine.states, theirs.states])
		check(Array(mine.events) == Array(theirs.events), "%s : coups %s au lieu de %s" % [name, mine.events, theirs.events])
		var calls_match := mine.calls.size() == theirs.calls.size()
		for k in mini(mine.calls.size(), theirs.calls.size()):
			for m in mini(mine.calls[k].size(), theirs.calls[k].size()):
				if not _same_result(mine.calls[k][m], theirs.calls[k][m]):
					calls_match = false
		check(calls_match, "%s : appels %s au lieu de %s" % [name, mine.calls, theirs.calls])
		# The news, but for landings and plates coming off (the floor's doing): the same, in the same order.
		var steady := func(list: Array) -> Array: return list.filter(func(item: String) -> bool: return item != "land" and item != "armor")
		var a: Array = steady.call(Array(mine.news))
		var b: Array = steady.call(Array(theirs.news))
		var same_news := a == b if mine.chaos < 0 else (a.slice(0, b.size()) == b or b.slice(0, a.size()) == a)
		check(same_news, "%s : nouvelles %s au lieu de %s" % [name, mine.news, theirs.news])
