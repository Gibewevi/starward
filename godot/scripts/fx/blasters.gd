class_name Blasters
extends Node3D
## Blaster bolts (port of src/blasters.js): long red streaks of light with a
## white-hot core, flying straight and fast enough to sting, slow enough to
## see and to deflect. A muzzle flash marks each shot; two red lights ride
## with the bolts and wash over whatever they pass. A bolt that meets a crate,
## a barrel or the floor bursts in sparks and leaves a scorch that glows,
## cools, and stays there for good (`marks`).
##
## fire(from, direction) launches one; update(dt, interact) moves them all:
## interact(bolt, a, b) is asked first about the stretch a → b (the blade,
## the hero, the troopers) and answers "deflected", "spent" or ""; the crates
## and the floor come next. update returns what happened this frame.

const LENGTH := 0.85
## White-hot core, deep red sheath.
const CORE := Color(3, 1.1, 1)
const SHEATH := Color(0.75, 0.004, 0.004)
const MUZZLE_HOT := Color(3, 2, 1.9)
const MUZZLE_RED := Color(0.8, 0.01, 0.01)
const LIGHT_RED := Color(1, 0.06, 0.04)

var effects: ImpactEffects
var lab: Obstacles
var marks: Object
var live: Array = []
var _pool: Array = []
var _lights: Array[OmniLight3D] = []
var _muzzles: Array = []
var _next_muzzle := 0
var _scorches: Array = []
var _next_scorch := 0
static var _flash_texture: ImageTexture


func _init(fx: ImpactEffects = null, level: Obstacles = null, scorch_marks: Object = null) -> void:
	name = "Blasters"
	effects = fx
	lab = level
	marks = scorch_marks
	var core_shape := CylinderMesh.new()
	core_shape.top_radius = 0.016
	core_shape.bottom_radius = 0.016
	core_shape.height = LENGTH
	core_shape.radial_segments = 6
	core_shape.rings = 1
	var sheath_shape := CylinderMesh.new()
	sheath_shape.top_radius = 0.042
	sheath_shape.bottom_radius = 0.042
	sheath_shape.height = LENGTH + 0.08
	sheath_shape.radial_segments = 8
	sheath_shape.rings = 1
	var sheath := StandardMaterial3D.new()
	sheath.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sheath.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sheath.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	sheath.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	sheath.albedo_color = Color(SHEATH.r, SHEATH.g, SHEATH.b, 0.85)
	for k in 48:
		var group := Node3D.new()
		group.name = "Blaster bolt"
		var core_material := StandardMaterial3D.new()
		core_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		core_material.albedo_color = CORE
		for part in [[sheath_shape, sheath], [core_shape, core_material]]:
			var mesh := MeshInstance3D.new()
			mesh.mesh = part[0]
			mesh.material_override = part[1]
			mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			# The streak trails behind its head.
			mesh.position.y = -LENGTH / 2.0
			group.add_child(mesh)
		group.visible = false
		add_child(group)
		_pool.append({ "group": group, "core": core_material, "live": false, "position": Vector3.ZERO, "velocity": Vector3.ZERO, "age": 0.0, "life": 0.0, "owner": null, "deflected": false, "parried": "", "perfect": false, "whizzed": false, "stretch": 0.0, "held": null })
	for k in 2:
		var light := OmniLight3D.new()
		light.light_color = Color("ff2a1a")
		light.light_energy = 0.0
		light.omni_range = 3.0
		light.omni_attenuation = 1.6
		light.shadow_enabled = false
		light.light_specular = 0.3
		add_child(light)
		_lights.append(light)
	for k in 8:
		_muzzles.append({ "node": ImpactEffects.glow_quad(self, "Muzzle flash", flash_texture()), "age": INF })
	var disc := Stormtrooper._disc(0.06, 8)
	for k in 36:
		var mesh := MeshInstance3D.new()
		mesh.name = "Bolt scorch"
		mesh.mesh = disc
		var material := StandardMaterial3D.new()
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		material.albedo_color = Color(0, 0, 0)
		mesh.material_override = material
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.visible = false
		add_child(mesh)
		_scorches.append({ "mesh": mesh, "material": material, "age": INF })


## A hot star that blooms and is gone.
static func flash_texture() -> ImageTexture:
	if _flash_texture == null:
		var n := 32
		var image := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
		for y in n:
			for x in n:
				var dx := (x + 0.5) / n * 2.0 - 1.0
				var dy := (y + 0.5) / n * 2.0 - 1.0
				var d := minf(1.0, Vector2(dx, dy).length())
				var star := maxf(0.0, 1.0 - minf(absf(dx), absf(dy)) * 9.0) * (1.0 - d)
				image.set_pixel(x, y, Color(1, 1, 1, minf(1.0, pow(1.0 - d, 2.4) + star)))
		_flash_texture = ImageTexture.create_from_image(image)
	return _flash_texture


func fire(from: Vector3, aim: Vector3, owner: Variant = null, speed: float = 12.0) -> Dictionary:
	var bolt: Dictionary = {}
	for entry in _pool:
		if not entry.live:
			bolt = entry
			break
	if bolt.is_empty():
		bolt = live[0]
	if bolt.live:
		remove(bolt)
	# A recycled bolt starts afresh (not parried, not deflected).
	bolt.merge({ "live": true, "age": 0.0, "life": 3.0, "owner": owner, "deflected": false, "parried": "", "perfect": false, "whizzed": false, "stretch": 0.0, "held": null }, true)
	bolt.position = from
	bolt.velocity = aim.normalized() * speed
	bolt.core.albedo_color = CORE
	bolt.group.visible = true
	_place(bolt)
	live.append(bolt)
	var muzzle: Dictionary = _muzzles[_next_muzzle]
	_next_muzzle = (_next_muzzle + 1) % _muzzles.size()
	muzzle.age = 0.0
	muzzle.node.position = from
	(muzzle.node.material_override as ShaderMaterial).set_shader_parameter("spin", randf() * PI)
	muzzle.node.visible = true
	return bolt


## Sent back by the blade from `at`, along `aim`.
func deflect(bolt: Dictionary, at: Vector3, aim: Vector3, speed: float) -> void:
	bolt.position = at
	bolt.velocity = aim.normalized() * speed
	bolt.deflected = true
	bolt.owner = "hero"
	bolt.age = 0.0
	bolt.life = 2.5
	bolt.stretch = 0.0
	# White-hot for an instant as it leaves the blade.
	bolt.core.albedo_color = Color(4, 3.2, 3)
	_place(bolt)


func remove(bolt: Dictionary) -> void:
	bolt.live = false
	bolt.group.visible = false
	for index in live.size():
		if is_same(live[index], bolt):
			live.remove_at(index)
			return


func _place(bolt: Dictionary) -> void:
	var group: Node3D = bolt.group
	var direction: Vector3 = (bolt.velocity as Vector3).normalized()
	# Fresh out of the muzzle the streak grows to its length.
	group.transform = Transform3D(Basis(Quaternion(Vector3.UP, direction)) * Basis.from_scale(Vector3(1, minf(1.0, 0.15 + bolt.stretch), 1)), bolt.position)


func _scorch(at: Vector3, facing: Vector3, box: Variant = null) -> void:
	var entry: Dictionary = _scorches[_next_scorch]
	_next_scorch = (_next_scorch + 1) % _scorches.size()
	entry.age = 0.0
	if marks:
		var surface: Variant = marks.bolt(at, facing, box)
		if surface != null:
			at = surface.position
			facing = surface.normal
	var mesh: MeshInstance3D = entry.mesh
	mesh.global_transform = Transform3D(Basis(Quaternion(Vector3(0, 0, 1), facing)) * Basis.from_scale(Vector3.ONE * (0.7 + randf() * 0.6)), at + facing * 0.006)
	entry.material.albedo_color.a = 1.0
	mesh.visible = true
	if effects:
		effects.glow(entry.material, 2.2)


## A bolt bursts on something: sparks, a red flash and flare, a scorch.
func burst(at: Vector3, facing: Vector3, along: Vector3, box: Variant = null) -> void:
	if effects:
		effects.sparks(at, (facing - along * 0.3).normalized(), along, { "count": 14 + roundi(randf() * 16), "speed": 2.6 })
		effects.flash(at, 0.7, { "color": LIGHT_RED })
		effects.burst(at, { "normal": facing, "power": 0.35, "tint": "red" })
	_scorch(at, facing, box)


func update(dt: float, interact: Callable = Callable()) -> Array:
	var events := []
	for bolt in live.duplicate():
		bolt.age += dt
		bolt.stretch += dt * 9.0
		if bolt.age > bolt.life:
			remove(bolt)
			continue
		var a: Vector3 = bolt.position
		var b: Vector3 = a + bolt.velocity * dt
		var answer: String = interact.call(bolt, a, b) if interact.is_valid() else ""
		if answer == "spent":
			remove(bolt)
			continue
		if answer == "deflected":
			_place(bolt)
			events.append({ "type": "deflected", "bolt": bolt, "point": bolt.position })
			continue
		# Crates and barrels (a railing is mostly air: bolts pass between its bars), then the floor.
		var hit := lab.segment_hit(a, b, func(box: Dictionary) -> bool: return box.kind == "rail") if lab else {}
		var t: float = hit.t if not hit.is_empty() else INF
		var facing: Variant = hit.normal if not hit.is_empty() else null
		var box: Variant = hit.box if not hit.is_empty() else null
		if b.y < 0.0 and a.y >= 0.0:
			var floor_t := a.y / maxf(1e-6, a.y - b.y)
			if floor_t < t:
				t = floor_t
				facing = Vector3.UP
				box = null
		if t <= 1.0:
			var at := a.lerp(b, t)
			burst(at, facing, (bolt.velocity as Vector3).normalized(), box)
			events.append({ "type": "impact", "point": at, "bolt": bolt })
			remove(bolt)
			continue
		bolt.position = b
		if bolt.core.albedo_color.r > CORE.r:
			bolt.core.albedo_color = (bolt.core.albedo_color as Color).lerp(CORE, 1.0 - exp(-10.0 * dt))
		_place(bolt)
		var p: Vector3 = bolt.position
		if absf(p.x) > 60.0 or absf(p.z) > 60.0 or p.y > 20.0:
			remove(bolt)
	# The two lights follow the two youngest bolts.
	var youngest := live.duplicate()
	youngest.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return p.age < q.age)
	for index in _lights.size():
		var light := _lights[index]
		light.light_energy = 2.2 * ImpactEffects.LIGHT_SCALE if index < youngest.size() else 0.0
		if index < youngest.size():
			light.position = youngest[index].position
	for muzzle in _muzzles:
		var node: MeshInstance3D = muzzle.node
		if not node.visible:
			continue
		muzzle.age += dt
		var p := minf(1.0, muzzle.age / 0.07)
		node.scale = Vector3.ONE * (0.12 + 0.2 * Stormtrooper.ease_by("outCubic", p))
		var c := MUZZLE_HOT.lerp(MUZZLE_RED, p)
		(node.material_override as ShaderMaterial).set_shader_parameter("tint", Color(c.r, c.g, c.b, 1.0 - p))
		if p >= 1.0:
			node.visible = false
	for entry in _scorches:
		if not entry.mesh.visible:
			continue
		entry.age += dt
		# Cooled, the glow gives way to the mark (it stays; without marks, so does this).
		if marks and entry.age > 2.2:
			entry.material.albedo_color.a = maxf(0.0, 1.0 - (entry.age - 2.2) / 0.8)
		if marks and entry.age > 3.0:
			entry.mesh.visible = false
	return events


## Where a bolt goes once the blade has met it (port of src/deflect.js).
## Distance decides: close to the shooter (`closeness` 1) it goes straight
## back at him; far off (`closeness` 0) it glances off the blade at random. In
## between, the chance that it is sent at an enemy — back where it came from,
## its shooter first — falls with the distance, and its aim error grows.
## Training (`precision`) adds a little. Left to chance, it flies off to
## either side, into the floor or up, never aimed at anyone.
## enemies: [{ point, shooter, down }]. Returns { aim (unit vector), target (or null) }.
static func return_direction(at: Vector3, incoming: Vector3, precision: float, closeness: float, enemies: Array, perfect: bool, feel: Dictionary, random: Callable) -> Dictionary:
	var deflect: Dictionary = feel.deflect
	var back := -incoming.normalized()
	# A perfect parry: straight back, as if from point blank.
	var near := 1.0 if perfect else clampf(closeness, 0.0, 1.0)
	var chance := 1.0 if perfect else minf(1.0, lerpf(0.04, 1.0, pow(near, 1.3)) * deflect.held + deflect.precision.bonus * precision * near)
	if random.call() < chance:
		var best: Variant = null
		var score := INF
		for enemy in enemies:
			var to: Vector3 = enemy.point - at
			var distance := to.length()
			if distance > 16.0 or distance < 0.5:
				continue
			var angle := SquadMind._angle(to / distance, back)
			if angle > 1.3:
				continue
			var value := angle + distance * 0.03 - (0.5 if enemy.shooter else 0.0) + (0.6 if enemy.down else 0.0)
			if value < score:
				score = value
				best = enemy
		if best != null:
			var error: float = deflect.error * (1.0 - near)
			var aim: Vector3 = (best.point - at).normalized()
			aim.x += (random.call() - 0.5) * error * 2.0
			aim.y += (random.call() - 0.5) * error
			aim.z += (random.call() - 0.5) * error * 2.0
			return { "aim": aim.normalized(), "target": best }
	var aim := Vector3(back.x, 0, back.z)
	if aim.length_squared() < 1e-6:
		aim = Vector3(1, 0, 0)
	var turn := (-1.0 if random.call() < 0.5 else 1.0)
	var yaw: Array = deflect.yaw
	aim = aim.normalized().rotated(Vector3.UP, turn * (yaw[0] + (yaw[1] - yaw[0]) * random.call()))
	var lift: Array = deflect.lift
	aim.y = tan(lift[0] + (lift[1] - lift[0]) * random.call())
	return { "aim": aim.normalized(), "target": null }


func clear() -> void:
	for bolt in live.duplicate():
		remove(bolt)
	for entry in _scorches:
		entry.mesh.visible = false
	for light in _lights:
		light.light_energy = 0.0
