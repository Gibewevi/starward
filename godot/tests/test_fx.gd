extends TestCase
## The effects that play, against the JavaScript (assets/data/fx-reference.json):
## grenades thrown into the lab — bouncing off the floor and the crates,
## rolling, pushed by the Force, going off where and when the web's do; the
## lab's loose objects strewn where the web strews them and thrown by a blast
## alike (a tumbling box is chaotic, Godot's single precision drifts: they
## must agree for the first quarter second, and all land in the lab); and
## where the blade sends bolts back, enemy aimed at or not.


static func _v(values: Variant) -> Vector3:
	return Vector3(values[0], values[1], values[2])


## The web's draws (bake.js's DRAWS), from `start` on.
static func _counter(start: int) -> Callable:
	var draws: Array = data("combat-reference.json").draws
	var at := [start]
	return func() -> float:
		var value: float = draws[at[0] % draws.size()]
		at[0] += 1
		return value


func _lab() -> Obstacles:
	return Obstacles.new(data("lab.json").obstacles)


func test_grenades_fly_and_go_off_as_the_web() -> void:
	var reference := data("fx-reference.json")
	var feel := data("feel.json")
	var grenades := Grenades.new(_lab(), feel.grenade.reach, _counter(int(reference.draws.grenades)))
	var worst := 0.0
	var blasts := 0
	for i in reference.steps.size():
		for t in reference.throws:
			if int(t.at) == i:
				if t.has("to"):
					grenades.throw_at(_v(t.from), _v(t.to), t.fuse)
				else:
					grenades.drop(_v(t.from), t.fuse)
		if i == int(reference.push.at):
			grenades.push(_v(reference.push.from), _v(reference.push.direction), feel.push.range, feel.push.cone)
		var step: Dictionary = reference.steps[i]
		var went_off := grenades.update(step.dt)
		check(went_off.size() == step.blasts.size(), "pas %d : %d explosions au lieu de %d" % [i, went_off.size(), step.blasts.size()])
		for k in mini(went_off.size(), step.blasts.size()):
			worst = maxf(worst, went_off[k].distance_to(_v(step.blasts[k])))
			blasts += 1
		for k in grenades.pool.size():
			var expected: Variant = step.live[k]
			var grenade: Dictionary = grenades.pool[k]
			check(grenade.live == (expected != null), "pas %d : grenade %d %s" % [i, k, "en vol" if grenade.live else "éteinte"])
			if grenade.live and expected != null:
				worst = maxf(worst, (grenade.position as Vector3).distance_to(_v(expected)))
	check(blasts == 4, "%d explosions au lieu de 4" % blasts)
	check(worst < 1e-3, "trajectoires des grenades à %.5f m du web" % worst)
	print("    grenades : %d explosions, écart ≤ %.5f m" % [blasts, worst])
	grenades.free()


func test_debris_strewn_and_thrown_as_the_web() -> void:
	var reference := data("fx-reference.json")
	var debris := Debris.new(_lab(), _counter(int(reference.draws.debris)))
	var strewn: Array = reference.debris.strewn
	debris.scatter(30)
	check(debris.bodies.size() == strewn.size(), "%d objets au lieu de %d" % [debris.bodies.size(), strewn.size()])
	var placed := 0.0
	for k in mini(debris.bodies.size(), strewn.size()):
		var body: Dictionary = debris.bodies[k]
		check(body.name == strewn[k].name, "objet %d : %s au lieu de %s" % [k, body.name, strewn[k].name])
		placed = maxf(placed, (body.position as Vector3).distance_to(_v(strewn[k].position)))
	check(placed < 1e-4, "objets posés à %.5f m du web" % placed)
	var at := _v(reference.debris.blast)
	debris.blast(at)
	debris.fragments(at, 12)
	var flight: Array = reference.debris.flight
	var early := 0.0
	var late := 0.0
	var inside := true
	for i in flight.size():
		debris.update(1.0 / 60.0)
		check(debris.bodies.size() == flight[i].size(), "pas %d : %d objets au lieu de %d" % [i, debris.bodies.size(), flight[i].size()])
		for k in mini(debris.bodies.size(), flight[i].size()):
			var position: Vector3 = debris.bodies[k].position
			if i < 15:
				early = maxf(early, position.distance_to(_v(flight[i][k])))
			late = maxf(late, position.distance_to(_v(flight[i][k])))
			inside = inside and position.y > -0.05 and position.y < 6.0 and absf(position.x) < 14.0 and absf(position.z) < 16.0
	check(early < 1e-3, "débris projetés à %.4f m du web pendant le premier quart de seconde" % early)
	check(inside, "un débris a quitté le labo")
	print("    débris : posés à ≤ %.6f m, projetés à ≤ %.4f m (¼ s), %.4f m (1,5 s)" % [placed, early, late])
	debris.free()


func test_bolts_sent_back_as_the_web() -> void:
	var reference := data("fx-reference.json")
	var feel := data("feel.json")
	var draw := _counter(int(reference.draws.returns))
	var enemies: Array = reference.enemies.map(func(e: Dictionary) -> Dictionary: return { "point": _v(e.point), "shooter": e.shooter, "down": e.down })
	var worst := 0.0
	var aimed := 0
	for entry in reference.returns:
		var result := Blasters.return_direction(_v(entry.at), _v(entry.incoming), entry.precision, entry.closeness, enemies, entry.perfect, feel, draw)
		worst = maxf(worst, (result.aim as Vector3).distance_to(_v(entry.aim)))
		var target := enemies.find(result.target) if result.target != null else -1
		check(target == int(entry.target), "renvoi vers %d au lieu de %d" % [target, int(entry.target)])
		if target >= 0:
			aimed += 1
	check(worst < 1e-4, "renvois à %.6f du web" % worst)
	print("    renvois : %d sur %d visés, écart ≤ %.6f" % [aimed, reference.returns.size(), worst])
