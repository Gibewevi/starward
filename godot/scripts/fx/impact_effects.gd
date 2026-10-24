class_name ImpactEffects
extends Node3D
## Lightsaber and blaster impact effects, stylised and without gore (port of
## src/impact-effects.js). A physical particle system: sparks fly as streaks
## stretched along their velocity, droplets of molten armour fall heavier,
## and both obey gravity and air drag, bounce on the floor, slide to a stop
## and lie there as round glowing beads that cool from white-hot to orange,
## red, then black over a few seconds. Embers drift up from cauterised cuts,
## an orange flash lights the impact, and glowing materials cool down. A burst
## marks a clean cut: a flare that blooms and fades, and a ring of light
## racing out along the cut plane. A Force wave is a few pale rings rushing
## out of the hand (a push) or converging on it (a pull). An explosion tears
## the spray into uneven jets with long burning streaks.
## A limb coming off throws red drops too (bleed(), drip()): thrown out with
## the blade, falling back faster than the sparks, opaque rather than glowing.
## They do not bounce: they stick where they land — the floor, a crate, a wall
## (`lab`), where they run down a little before setting — and stay there half
## a minute before they fade; a foot coming down treads them in (tread()).

const SPARK := 0
const DROP := 1
const EMBER := 2
const MAX := 1800
const RED := 1600
## The vertex colours (8 bits) carry the glow divided by this; the shaders give it back.
const BRIGHTNESS := 4.5
const HOT := Color(3.2, 1.35, 0.4)
const COLD := Color(0.055, 0.05, 0.05)
const WHITE_HOT := Color(2.6, 2.5, 2.9)
const ORANGE := Color(2.4, 0.9, 0.25)
const BLASTER_RED := Color(0.85, 0.01, 0.01)
const BLADE_BLUE := Color(0.5, 0.9, 2.6)
const LIGHT_WHITE := Color(1, 0.93, 0.85)
const LIGHT_ORANGE := Color(1, 0.54, 0.23)
## three.js point-light intensities to Godot light energy (as the lab's lamps).
const LIGHT_SCALE := 0.35

var lab: Obstacles
var feel: Dictionary
var random: Callable

var _position := PackedFloat32Array()
var _velocity := PackedFloat32Array()
var _heat := PackedFloat32Array()
var _cooling := PackedFloat32Array()
var _size := PackedFloat32Array()
var _seed := PackedFloat32Array()
var _launch_delay := PackedFloat32Array()
var _age := PackedFloat32Array()
var _exposure := PackedFloat32Array()
var _kind := PackedByteArray()
var _alive := PackedByteArray()
var _resting := PackedByteArray()
## Saber-blue sparks (1, a parry) glow blue-white; blaster-red ones (2) red.
var _blue := PackedByteArray()
var _explosive := PackedByteArray()
var _cursor := 0
var _live := 0

var _red_position := PackedFloat32Array()
var _red_velocity := PackedFloat32Array()
var _red_state := PackedByteArray()
var _red_time := PackedFloat32Array()
var _red_life := PackedFloat32Array()
var _red_size := PackedFloat32Array()
var _red_shade := PackedFloat32Array()
## Stuck on a wall or a crate's side (1), it runs down a little; on a floor or a lid (0), it stays put.
var _red_wall := PackedByteArray()
var _red_floor := PackedFloat32Array()
var _red_run := PackedFloat32Array()
var _red_run_left := PackedFloat32Array()
var _red_travel := PackedFloat32Array()
var _red_cursor := 0
var _red_alive := 0
var _lying_on_floor := 0
var _drips: Array = []

var _beads: MeshInstance3D
var _lines: MeshInstance3D
var _reds: MeshInstance3D
var _lights: Array = []
var _flares: Array = []
var _rings: Array = []
var _waves: Array = []
var _next_light := 0
var _next_flare := 0
var _next_ring := 0
var _next_wave := 0
var _tweens := Tweens.new()
var _smoulders: Array = []
var _glows: Array = []
static var _glow_texture: ImageTexture


func _init(level: Obstacles = null, feel_data: Dictionary = {}, draw: Callable = Callable()) -> void:
	name = "Impact effects"
	lab = level
	feel = feel_data if not feel_data.is_empty() else CombatController._load("res://assets/data/feel.json")
	random = draw if draw.is_valid() else func() -> float: return randf()
	for array in [_position, _velocity]:
		array.resize(MAX * 3)
	for array in [_heat, _cooling, _size, _seed, _launch_delay, _age, _exposure]:
		array.resize(MAX)
	for array in [_kind, _alive, _resting, _blue, _explosive]:
		array.resize(MAX)
	for array in [_red_position, _red_velocity]:
		array.resize(RED * 3)
	for array in [_red_time, _red_life, _red_size, _red_shade, _red_floor, _red_run, _red_run_left, _red_travel]:
		array.resize(RED)
	for array in [_red_state, _red_wall]:
		array.resize(RED)
	_beads = _surface("Impact beads", "res://shaders/glow_points.gdshader")
	_lines = _surface("Spark streaks", "res://shaders/additive_trail.gdshader")
	_reds = _surface("Red drops", "res://shaders/red_drops.gdshader")
	StainLight.register(_reds.material_override, feel)
	for k in 2:
		var light := OmniLight3D.new()
		light.light_color = Color("ff8a3a")
		light.light_energy = 0.0
		light.omni_range = 3.2
		light.omni_attenuation = 1.8
		light.shadow_enabled = false
		light.light_specular = 0.3
		add_child(light)
		_lights.append({ "light": light, "tween": null })
	for k in 6:
		_flares.append({ "node": glow_quad(self, "Impact flare"), "tween": null })
		_rings.append({ "node": _ring_mesh("Cut ring", 0.82, 40), "tween": null })
	for k in 9:
		_waves.append({ "node": _ring_mesh("Force wave", 0.72, 48), "tween": null })


func _exit_tree() -> void:
	StainLight.forget(_reds.material_override)


func _surface(label: String, shader_path: String) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	mesh.name = label
	mesh.mesh = ArrayMesh.new()
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mesh.extra_cull_margin = 16384.0
	var material := ShaderMaterial.new()
	material.shader = load(shader_path)
	if shader_path.ends_with("additive_trail.gdshader") or shader_path.ends_with("glow_points.gdshader"):
		material.set_shader_parameter("brightness", BRIGHTNESS)
	mesh.material_override = material
	add_child(mesh)
	return mesh


## A soft radial glow, bright enough to bloom (shared by the flares, the muzzle flashes, the aim glints).
static func glow_texture() -> ImageTexture:
	if _glow_texture == null:
		var n := 32
		var image := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
		for y in n:
			for x in n:
				var d := minf(1.0, Vector2((x + 0.5) / n * 2.0 - 1.0, (y + 0.5) / n * 2.0 - 1.0).length())
				image.set_pixel(x, y, Color(1, 1, 1, pow(1.0 - d, 2.2)))
		_glow_texture = ImageTexture.create_from_image(image)
	return _glow_texture


## A camera-facing quad that glows (shaders/glow_billboard.gdshader), hidden; its material its own.
static func glow_quad(owner: Node, label: String, texture: Texture2D = null) -> MeshInstance3D:
	var quad := MeshInstance3D.new()
	quad.name = label
	var shape := QuadMesh.new()
	shape.size = Vector2(1, 1)
	quad.mesh = shape
	quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/glow_billboard.gdshader")
	material.set_shader_parameter("map", texture if texture else glow_texture())
	quad.material_override = material
	quad.visible = false
	owner.add_child(quad)
	return quad


func _ring_mesh(label: String, inner: float, segments: int) -> MeshInstance3D:
	var ring := MeshInstance3D.new()
	ring.name = label
	ring.mesh = Stormtrooper._ring(inner, 1.0, segments)
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.no_depth_test = false
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	ring.material_override = material
	ring.visible = false
	add_child(ring)
	return ring


func _r() -> float:
	return random.call()


func _pick(value: Variant) -> float:
	if value is Array:
		return value[0] + (value[1] - value[0]) * _r()
	return float(value)


## Black-body-ish ramp: white-hot, yellow, orange, deep red, out.
static func _incandescence(t: float) -> Color:
	if t > 0.75:
		return Color(2.6, 2.1, 1.4).lerp(Color(2.4, 1.3, 0.4), (1.0 - t) / 0.25)
	if t > 0.45:
		return Color(2.4, 1.3, 0.4).lerp(Color(2.2, 0.55, 0.08), (0.75 - t) / 0.3)
	if t > 0.15:
		return Color(2.2, 0.55, 0.08).lerp(Color(0.7, 0.08, 0.02), (0.45 - t) / 0.3)
	var k := maxf(0.0, t / 0.15)
	return Color(0.7 * k, 0.08 * k, 0.02 * k)


## An explosion's fragments read as saturated orange; only their tiny hottest heads go pale.
static func _blast_incandescence(t: float) -> Color:
	if t > 0.78:
		return Color(3.5, 0.46, 0.012).lerp(Color(3.9, 0.85, 0.045), (t - 0.78) / 0.22)
	if t > 0.32:
		return Color(2.8, 0.24, 0.004).lerp(Color(3.5, 0.46, 0.012), (t - 0.32) / 0.46)
	var k := maxf(0.0, t / 0.32)
	return Color(2.8 * k, 0.24 * k, 0.004 * k)


func _emit(at: Vector3, v: Vector3, type: int, temperature: float, rate: float, pixels: float, saber: int = 0) -> int:
	var i := _cursor
	_cursor = (_cursor + 1) % MAX
	var o := i * 3
	_position[o] = at.x; _position[o + 1] = at.y; _position[o + 2] = at.z
	_velocity[o] = v.x; _velocity[o + 1] = v.y; _velocity[o + 2] = v.z
	_blue[i] = saber
	_explosive[i] = 0
	_launch_delay[i] = 0.0
	_age[i] = 0.0
	_exposure[i] = 0.0
	_kind[i] = type
	_heat[i] = temperature
	_cooling[i] = rate
	_size[i] = pixels
	_alive[i] = 1
	_resting[i] = 0
	_seed[i] = _r() * 100.0
	return i


## A burst along the blade's motion, fanned across the cut plane. saber/red: shares of sparks coloured by the blades.
func sparks(at: Vector3, direction: Vector3, normal: Vector3, options: Dictionary = {}) -> void:
	var count: int = options.get("count", 40)
	var speed: float = options.get("speed", 4.0)
	var saber: float = options.get("saber", 0.0)
	var red: float = options.get("red", 0.0)
	var side := direction.cross(normal)
	if side.length_squared() < 1e-6:
		side = Vector3(1, 0, 0)
	side = side.normalized()
	for i in count:
		var drop := i % 6 == 5
		var pace := 0.25 + _r() * 0.45 if drop else 0.35 + _r() * 0.9
		var v := direction * (speed * pace)
		v += side * ((_r() - 0.5) * speed * (0.4 if drop else 1.0))
		v += normal * ((_r() - 0.5) * speed * 0.5)
		v.y += 0.2 + _r() * 0.6 if drop else 0.6 + _r() * 2.0
		# Staggered along their paths, so the burst never piles up in one blinding point.
		var start := at + v * (_r() * 0.03)
		var tint := _r()
		var temperature := 0.78 + _r() * 0.17
		var rate := 0.2 + _r() * 0.08 if drop else 0.32 + _r() * 0.25
		var pixels := 2.8 + _r() * 0.6 if drop else 1.7 + _r() * 0.6
		_emit(start, v, DROP if drop else SPARK, temperature, rate, pixels, 0 if drop else (1 if tint < saber else (2 if tint < saber + red else 0)))


## An explosion tears into uneven jets. A few hot leaders draw long trails;
## smaller, cooler splinters follow the same low lobes, with dark space
## between. The whole impulse launches in 70 ms, spreading over the floor.
func blast(at: Vector3, options: Dictionary = {}) -> void:
	var count: int = options.get("sparks", 220)
	var embers: int = options.get("embers", 110)
	var speed: float = options.get("speed", 14.0)
	var jet_count := mini(14, maxi(5, roundi(sqrt(count) * 0.7)))
	var orientation := _r() * PI * 2.0
	var jets := []
	for jet_index in jet_count:
		var theta := orientation + float(jet_index) / jet_count * PI * 2.0 + (_r() - 0.5) * 0.5
		var rise := 0.06 + pow(_r(), 1.7) * 0.36
		var flat := sqrt(1.0 - rise * rise)
		jets.append({ "direction": Vector3(cos(theta) * flat, rise, sin(theta) * flat), "speed": 0.6 + _r() * 0.6, "delay": _r() * 0.018 })
	for i in count:
		var jet: Dictionary = jets[i % jet_count]
		var leader := i < jet_count
		var scatter := not leader and _r() < 0.24
		var spread := 0.035 if leader else (0.55 if scatter else 0.12)
		var v: Vector3 = jet.direction + Vector3((_r() - 0.5) * spread, (_r() - 0.5) * spread * 0.35, (_r() - 0.5) * spread)
		v.y = maxf(0.035, v.y)
		var pace: float = speed * jet.speed * (0.95 + _r() * 0.24 if leader else 0.35 + pow(_r(), 0.8) * 0.64)
		v = v.normalized() * pace
		var start: Vector3 = at + jet.direction * (0.06 + _r() * 0.18) + Vector3((_r() - 0.5) * 0.13, _r() * 0.08, (_r() - 0.5) * 0.13)
		var drop := not leader and _r() < 0.12
		var temperature := 0.94 + _r() * 0.05 if leader else 0.48 + _r() * 0.46
		var rate := 0.5 + _r() * 0.3 if leader else (0.24 + _r() * 0.2 if drop else 0.62 + _r() * 0.55)
		var pixels := 2.0 + _r() * 0.8 if leader else (1.8 + _r() * 1.1 if drop else 1.0 + _r() * 0.9)
		var index := _emit(start, v, DROP if drop else SPARK, temperature, rate, pixels)
		_explosive[index] = 1
		_launch_delay[index] = jet.delay + (0.0 if leader else _r() * 0.05)
		_exposure[index] = 0.085 + _r() * 0.055 if leader else 0.007 + pow(_r(), 2) * 0.035
	for i in embers:
		var jet: Dictionary = jets[int(floor(_r() * jet_count))]
		var spread := pow(_r(), 0.6)
		var v: Vector3 = jet.direction * (1.2 + _r() * 2.4)
		v.y += 0.12 + _r() * 0.45
		var start: Vector3 = at + jet.direction * (spread * 0.35) + Vector3((_r() - 0.5) * 0.2, 0.05 + _r() * 0.22, (_r() - 0.5) * 0.2)
		var temperature := 0.24 + pow(_r(), 1.4) * 0.55
		var rate := 0.22 + _r() * 0.35
		var index := _emit(start, v, EMBER, temperature, rate, 0.8 + pow(_r(), 2) * 1.7)
		_explosive[index] = 1
		_launch_delay[index] = 0.012 + _r() * 0.055


func _emit_red(at: Vector3, v: Vector3) -> void:
	var i := _red_cursor
	_red_cursor = (_red_cursor + 1) % RED
	var o := i * 3
	_red_position[o] = at.x; _red_position[o + 1] = at.y; _red_position[o + 2] = at.z
	_red_velocity[o] = v.x; _red_velocity[o + 1] = v.y; _red_velocity[o + 2] = v.z
	_red_state[i] = 1
	_red_time[i] = 0.0
	_red_wall[i] = 0
	_red_floor[i] = 0.008
	_red_run[i] = 0.0
	_red_run_left[i] = 0.0
	_red_travel[i] = 0.0
	_red_life[i] = _pick(feel.severed.linger)
	_red_size[i] = _pick(feel.severed.size)
	_red_shade[i] = 0.8 + _r() * 0.35


## A limb comes off: red drops thrown along the blade's sweep, mostly downwards, from the cut.
func bleed(at: Vector3, direction: Vector3, normal: Vector3, options: Dictionary = {}) -> void:
	var speed: float = options.get("speed", 4.0)
	var amount: float = options.get("amount", 1.0)
	var count: int = options.get("count", roundi(_pick(feel.severed.red) * amount))
	var side := direction.cross(normal)
	if side.length_squared() < 1e-6:
		side = Vector3(1, 0, 0)
	side = side.normalized()
	var thrown: float = speed * feel.severed.speed
	for i in count:
		var v := direction * (thrown * (0.3 + _r() * 0.8))
		v += side * ((_r() - 0.5) * thrown * 0.8)
		v += normal * ((_r() - 0.5) * thrown * 0.4)
		v.y = minf(v.y, 1.0) + _pick(feel.severed.lift)
		_emit_red(at + v * (_r() * 0.02), v)


## A few more drops falling from a cut for a moment (`object`: where it is); `amount` scales how long and how fast.
func drip(object: Node3D, duration: float = NAN, amount: float = 1.0) -> void:
	if is_nan(duration):
		duration = _pick(feel.severed.drip)
	_drips.append({ "object": object, "age": 0.0, "duration": duration * sqrt(amount), "clock": _r() * 0.1, "rate": 1.0 / maxf(0.4, amount) })


## A speck of a running drop's trail, stuck where the drop was.
func _speck(i: int, o: int) -> void:
	var j := _red_cursor
	if j == i:
		return
	_red_cursor = (_red_cursor + 1) % RED
	_red_position[j * 3] = _red_position[o]
	_red_position[j * 3 + 1] = _red_position[o + 1]
	_red_position[j * 3 + 2] = _red_position[o + 2]
	_red_state[j] = 2
	_red_time[j] = _red_time[i]
	_red_life[j] = _red_life[i]
	_red_size[j] = _red_size[i] * 0.62
	_red_shade[j] = _red_shade[i] * 0.92
	_red_wall[j] = 1
	_red_floor[j] = _red_floor[i]
	_red_run[j] = 0.0
	_red_run_left[j] = 0.0
	_red_travel[j] = 0.0


## A foot coming down at `at`: the red drops lying on the floor under the sole
## are trodden in — some of them taken away. Returns how many were there.
func tread(at: Vector3, radius: float = NAN) -> int:
	if _lying_on_floor == 0:
		return 0
	if is_nan(radius):
		radius = feel.prints.radius
	var found := 0
	var taken := 0
	var last := -1
	var r2 := radius * radius
	for i in RED:
		if _red_state[i] != 2 or _red_wall[i] != 0:
			continue
		var o := i * 3
		var dx := _red_position[o] - at.x
		var dz := _red_position[o + 2] - at.z
		if dx * dx + dz * dz > r2 or _red_position[o + 1] > 0.03:
			continue
		found += 1
		last = i
		if _r() < feel.prints.take:
			_red_state[i] = 0
			taken += 1
	# Always a little taken up when there was some.
	if found > 0 and taken == 0 and last >= 0:
		_red_state[last] = 0
	return found


## The impact lights its surroundings: white at once, cooling to orange (or `color`) as it fades.
func flash(at: Vector3, power: float = 1.0, options: Dictionary = {}) -> void:
	var slot: Dictionary = _lights[_next_light]
	_next_light = (_next_light + 1) % _lights.size()
	_tweens.cancel(slot.tween)
	var light: OmniLight3D = slot.light
	light.position = at
	var target: Color = options.get("color", LIGHT_ORANGE)
	light.light_color = LIGHT_WHITE
	slot.tween = _tweens.add(0.22, "outQuad",
		func(eased: float, progress: float) -> void:
			light.light_energy = power * 4.0 * (1.0 - eased) * LIGHT_SCALE
			light.light_color = LIGHT_WHITE.lerp(target, Stormtrooper.ease_by("outCubic", progress)),
		func() -> void: light.light_energy = 0.0)


## A clean cut flares: a glow that blooms at the contact and fades, and a thin
## ring of light that races out along the cut plane (`normal` is the plane's
## normal), white-hot cooling to orange — red for a blaster, blue for a perfect parry.
func burst(at: Vector3, options: Dictionary = {}) -> void:
	var power := clampf(options.get("power", 1.0), 0.2, 1.5)
	var tint: String = options.get("tint", "")
	var cool := BLASTER_RED if tint == "red" else (BLADE_BLUE if tint == "blue" else ORANGE)
	var flare: Dictionary = _flares[_next_flare]
	_next_flare = (_next_flare + 1) % _flares.size()
	_tweens.cancel(flare.tween)
	var quad: MeshInstance3D = flare.node
	var material: ShaderMaterial = quad.material_override
	quad.position = at
	quad.visible = true
	var size := 0.18 + 0.2 * power
	flare.tween = _tweens.add(0.2, "outExpo",
		func(eased: float, progress: float) -> void:
			quad.scale = Vector3.ONE * (0.06 + (size - 0.06) * eased)
			var c := WHITE_HOT.lerp(cool, progress)
			material.set_shader_parameter("tint", Color(c.r, c.g, c.b, 1.0 - Stormtrooper.ease_by("outQuad", progress))),
		func() -> void: quad.visible = false)
	var normal: Variant = options.get("normal")
	if normal == null or (normal as Vector3).length_squared() < 1e-6:
		return
	var ring: Dictionary = _rings[_next_ring]
	_next_ring = (_next_ring + 1) % _rings.size()
	_tweens.cancel(ring.tween)
	var mesh: MeshInstance3D = ring.node
	var ring_material: StandardMaterial3D = mesh.material_override
	mesh.position = at
	mesh.quaternion = Quaternion(Vector3(0, 0, 1), (normal as Vector3).normalized())
	mesh.visible = true
	var reach := 0.12 + 0.14 * power
	ring.tween = _tweens.add(0.18, "outCubic",
		func(eased: float, progress: float) -> void:
			mesh.scale = Vector3.ONE * (0.04 + (reach - 0.04) * eased)
			var c := WHITE_HOT.lerp(cool, Stormtrooper.ease_by("outQuad", progress)) * 0.8
			ring_material.albedo_color = Color(c.r, c.g, c.b, pow(1.0 - progress, 1.6)),
		func() -> void: mesh.visible = false)


## Embers rising from an object (a cut) for a few seconds.
func smoulder(object: Node3D, duration: float = 2.6) -> void:
	_smoulders.append({ "object": object, "age": 0.0, "duration": duration, "debt": 0.0 })


## A material that cools from white-hot to scorched over a few seconds.
func glow(material: BaseMaterial3D, duration: float = 4.5) -> void:
	_glows.append({ "material": material, "age": 0.0, "duration": duration })
	material.albedo_color = HOT


## A Force wave from `from` along `direction` over `length` metres: a push rushes out and widens; a pull converges on `from` and narrows.
func wave(from: Vector3, direction: Vector3, options: Dictionary = {}) -> void:
	var kind: String = options.get("kind", "push")
	var length: float = options.get("length", 4.0)
	var power: float = options.get("power", 1.0)
	var along := Vector3(direction.x, 0, direction.z)
	if along.length_squared() < 1e-6:
		return
	along = along.normalized()
	for i in 3:
		var slot: Dictionary = _waves[_next_wave]
		_next_wave = (_next_wave + 1) % _waves.size()
		_tweens.cancel(slot.tween)
		var mesh: MeshInstance3D = slot.node
		var material: StandardMaterial3D = mesh.material_override
		material.albedo_color = Color(Color("9fc4ff"), 0.0)
		mesh.quaternion = Quaternion(Vector3(0, 0, 1), along)
		mesh.position = from
		mesh.scale = Vector3.ONE * 0.0001
		mesh.visible = true
		var travel := length * (0.75 + 0.12 * i)
		var k := i
		slot.tween = _tweens.add(0.34 + i * 0.04, "outCubic" if kind == "push" else "inOutCubic",
			func(eased: float, progress: float) -> void:
				var reach := eased if kind == "push" else 1.0 - eased
				mesh.position = from + along * (travel * reach)
				mesh.scale = Vector3.ONE * ((0.15 + 1.25 * eased if kind == "push" else 1.3 - 1.15 * eased) * (1.0 - k * 0.12))
				material.albedo_color.a = 0.55 * power * sin(PI * minf(1.0, progress * 1.15)) * (1.0 - k * 0.2),
			func() -> void:
				mesh.visible = false
				material.albedo_color.a = 0.0,
			i * 0.045)


func update(dt: float) -> void:
	_tweens.update(dt)
	for entry in _smoulders:
		entry.age += dt
		entry.debt += dt * 12.0 * (1.0 - entry.age / entry.duration)
		while entry.debt > 1.0:
			entry.debt -= 1.0
			if is_instance_valid(entry.object) and entry.object.is_inside_tree():
				var x := (_r() - 0.5) * 0.2
				var y := 0.2 + _r() * 0.35
				var z := (_r() - 0.5) * 0.2
				var temperature := 0.55 + _r() * 0.2
				var rate := 0.45 + _r() * 0.3
				_emit(entry.object.global_position, Vector3(x, y, z), EMBER, temperature, rate, 1.4 + _r() * 0.5)
	_smoulders = _smoulders.filter(func(entry: Dictionary) -> bool: return entry.age < entry.duration)
	# Drips from fresh cuts, slower and slower.
	for entry in _drips:
		entry.age += dt
		entry.clock -= dt
		if entry.clock > 0.0 or entry.age > entry.duration or not is_instance_valid(entry.object) or not entry.object.is_inside_tree():
			continue
		entry.clock = (0.08 + 0.2 * (entry.age / entry.duration) + _r() * 0.06) * entry.rate
		var x := (_r() - 0.5) * 0.3
		var y := -0.2 - _r() * 0.4
		_emit_red(entry.object.global_position, Vector3(x, y, (_r() - 0.5) * 0.3))
	_drips = _drips.filter(func(entry: Dictionary) -> bool: return entry.age <= entry.duration)
	for entry in _glows:
		entry.age += dt
		var t := minf(1.0, entry.age / entry.duration)
		if is_instance_valid(entry.material):
			entry.material.albedo_color = HOT.lerp(COLD, 1.0 - pow(1.0 - t, 2.2))
	_glows = _glows.filter(func(entry: Dictionary) -> bool: return entry.age < entry.duration)
	_update_reds(dt)
	_update_particles(dt)


## Red drops: no bounce; they stick where they land (a wall: running down, leaving a trail), darken, then fade.
func _update_reds(dt: float) -> void:
	var severed: Dictionary = feel.severed
	var gravity: float = severed.gravity
	var fade: float = severed.fade
	var trail: float = severed.trail
	_lying_on_floor = 0
	_red_alive = 0
	var points := PackedVector3Array()
	var colours := PackedColorArray()
	var sizes := PackedVector2Array()
	for i in RED:
		if _red_state[i] == 0:
			continue
		var o := i * 3
		if _red_state[i] == 1:
			var drag := exp(-0.35 * dt)
			_red_velocity[o] *= drag
			_red_velocity[o + 2] *= drag
			_red_velocity[o + 1] -= gravity * dt
			var from := Vector3(_red_position[o], _red_position[o + 1], _red_position[o + 2])
			_red_position[o] += _red_velocity[o] * dt
			_red_position[o + 1] += _red_velocity[o + 1] * dt
			_red_position[o + 2] += _red_velocity[o + 2] * dt
			# A crate, a barrel, a wall in the way: it sticks there, just off the surface.
			var hit := lab.segment_hit(from, Vector3(_red_position[o], _red_position[o + 1], _red_position[o + 2])) if lab and dt > 0.0 else {}
			if not hit.is_empty():
				var at: Vector3 = hit.point + hit.normal * 0.012
				_red_position[o] = at.x; _red_position[o + 1] = at.y; _red_position[o + 2] = at.z
				_red_state[i] = 2
				_red_time[i] = 0.0
				_red_wall[i] = 1 if absf(hit.normal.y) < 0.5 else 0
				# On a side, it will run down to the bottom of that face (the floor, or a lid below).
				_red_floor[i] = maxf(0.008, hit.box.lo[1] + 0.01)
				if _red_wall[i] != 0:
					var big := clampf((_red_size[i] - severed.size[0]) / (severed.size[1] - severed.size[0]), 0.0, 1.0)
					_red_run[i] = lerpf(severed.runSpeed[0], severed.runSpeed[1], 0.3 * _r() + 0.7 * big)
					_red_run_left[i] = _pick(severed.run)
			elif _red_position[o + 1] <= 0.008:
				_red_position[o + 1] = 0.008
				_red_state[i] = 2
				_red_time[i] = 0.0
		else:
			_red_time[i] += dt
			# On a wall it runs down, slower and slower, leaving specks of a trail and losing its volume to it.
			if _red_run[i] > 0.0:
				var step := minf(_red_run[i] * dt, _red_position[o + 1] - _red_floor[i])
				_red_position[o + 1] -= step
				_red_travel[i] += step
				while _red_travel[i] >= trail:
					_red_travel[i] -= trail
					_speck(i, o)
					_red_size[i] *= 0.988
				_red_run[i] *= exp(-dt / 1.4)
				_red_run_left[i] -= dt
				if _red_run_left[i] <= 0.0 or _red_run[i] < 0.012 or _red_size[i] < severed.size[0] * 0.55:
					_red_run[i] = 0.0
				# Down at the bottom: on the floor it pools (and can be trodden in).
				if _red_position[o + 1] <= _red_floor[i] + 1e-4:
					_red_run[i] = 0.0
					if _red_floor[i] <= 0.009:
						_red_wall[i] = 0
		if _red_state[i] == 2 and _red_wall[i] == 0:
			_lying_on_floor += 1
		_red_alive += 1
		var lying := _red_state[i] == 2
		if lying and _red_time[i] >= _red_life[i] + fade:
			_red_state[i] = 0
			continue
		var dark := minf(1.0, _red_time[i] / 2.5) if lying else 0.0
		var shade := _red_shade[i]
		points.append(Vector3(_red_position[o], _red_position[o + 1], _red_position[o + 2]))
		colours.append(Color((0.62 - 0.26 * dark) * shade, (0.03 - 0.012 * dark) * shade, (0.022 - 0.008 * dark) * shade, clampf((_red_life[i] + fade - _red_time[i]) / fade, 0.0, 1.0) if lying else 1.0))
		# Landed, a drop spreads a little (on a wall it stays rounder).
		sizes.append(Vector2(_red_size[i] * ((1.15 if _red_wall[i] != 0 else 1.3) if lying else 1.0), 0))
	_draw(_reds, Mesh.PRIMITIVE_POINTS, points, colours, sizes)


func _update_particles(dt: float) -> void:
	var points := PackedVector3Array()
	var point_colours := PackedColorArray()
	var point_sizes := PackedVector2Array()
	var lines := PackedVector3Array()
	var line_colours := PackedColorArray()
	var live := 0
	for i in MAX:
		if _alive[i] == 0:
			continue
		var o := i * 3
		var step := dt
		if _launch_delay[i] > 0.0:
			step = maxf(0.0, dt - _launch_delay[i])
			_launch_delay[i] = maxf(0.0, _launch_delay[i] - dt)
			if _launch_delay[i] > 0.0 and step == 0.0:
				live += 1
				continue
		live += 1
		_age[i] += step
		var type := _kind[i]
		var explosive := _explosive[i] != 0
		# Air: drag, and gravity (embers float on the heat instead).
		var air: float
		if explosive:
			air = 1.1 if type == EMBER else (0.45 if type == DROP else 1.15 + fmod(_seed[i], 1.0) * 1.8)
		else:
			air = 1.5 if type == EMBER else (0.4 if type == DROP else 1.1)
		var drag := exp(-air * step)
		_velocity[o] *= drag
		_velocity[o + 1] *= drag
		_velocity[o + 2] *= drag
		if type == EMBER:
			_velocity[o] += sin(_seed[i] + _heat[i] * 20.0) * 0.4 * step
			_velocity[o + 2] += cos(_seed[i] * 1.3 + _heat[i] * 17.0) * 0.4 * step
			if explosive:
				_velocity[o + 1] += maxf(-0.7, 0.45 - _age[i] * 0.65) * step
		elif _resting[i] == 0:
			_velocity[o + 1] -= 9.8 * step
		_position[o] += _velocity[o] * step
		_position[o + 1] += _velocity[o + 1] * step
		_position[o + 2] += _velocity[o + 2] * step
		# Floor: bounce with losses, then slide to a stop and lie there.
		if type != EMBER and _position[o + 1] < 0.006:
			_position[o + 1] = 0.006
			if _velocity[o + 1] < -0.6:
				_velocity[o + 1] *= -(0.25 + fmod(_seed[i], 1.0) * 0.25)
				_velocity[o] *= 0.62
				_velocity[o + 2] *= 0.62
			else:
				_velocity[o + 1] = 0.0
				_resting[i] = 1
				var slide := exp(-5.0 * step)
				_velocity[o] *= slide
				_velocity[o + 2] *= slide
		# Cooling: slower once lying on the floor, so they linger.
		_heat[i] -= _cooling[i] * step * (0.75 if _resting[i] != 0 else 1.0)
		if _heat[i] <= 0.0:
			_alive[i] = 0
			live -= 1
			continue
		var heat := _heat[i]
		var colour: Color
		if _blue[i] == 1:
			colour = Color(0.9 + heat * 1.4, 1.3 + heat * 1.2, 2.6 + heat * 0.6) * minf(1.0, heat * 2.2)
		elif _blue[i] == 2:
			colour = Color(2.7 + heat * 0.5, 0.32 + heat * 0.55, 0.25 + heat * 0.38) * minf(1.0, heat * 2.2)
		elif explosive:
			colour = _blast_incandescence(heat)
		else:
			colour = _incandescence(heat)
		var flicker := 0.75 + 0.25 * sin(_seed[i] * 7.0 + heat * 60.0) if type == EMBER else 1.0
		var at := Vector3(_position[o], _position[o + 1], _position[o + 2])
		var bead := colour * flicker
		if explosive and type == SPARK and _exposure[i] > 0.07 and heat > 0.62:
			bead = Color(4.1, 2.4, 1.1)
		var pixels := _size[i] * (0.6 + 0.4 * minf(1.0, heat * 2.0))
		# A fast spark is a streak along its path: bright head, fading tail.
		var v := Vector3(_velocity[o], _velocity[o + 1], _velocity[o + 2])
		var stretch := 0.0
		if type == SPARK and v.length() > 1.2:
			stretch = minf(_exposure[i], _age[i]) / 3.0 if explosive else 0.035
		if stretch > 0.0:
			pixels *= 0.7
			var tail := at - v * stretch
			var tail_colour := Color(colour.r * 0.2, colour.g * 0.1, colour.b * 0.05)
			if explosive and _resting[i] == 0:
				# The brief exposure extrapolated back along the ballistic arc: a bright
				# leader, an interrupted orange body and a dim red tail.
				tail.y -= 4.9 * stretch * stretch
				tail_colour = Color(colour.r * 0.95, colour.g * 0.86, colour.b * 0.5)
				for segment in 2:
					for end in 2:
						var t := stretch * (segment + 1 + (0.88 if end == 1 else 0.08))
						var p := at - v * t
						p.y = maxf(0.008, at.y - v.y * t - 4.9 * t * t)
						var fade := pow(1.0 - t / (stretch * 3.0), 0.8)
						lines.append(p)
						line_colours.append(_stored(Color(colour.r * fade, colour.g * fade * (0.8 - segment * 0.16), colour.b * fade * 0.2)))
			lines.append(at)
			line_colours.append(_stored(colour))
			lines.append(tail)
			line_colours.append(_stored(tail_colour))
		points.append(at)
		point_colours.append(_stored(bead))
		point_sizes.append(Vector2(pixels, 0))
	_live = live
	_draw(_beads, Mesh.PRIMITIVE_POINTS, points, point_colours, point_sizes)
	_draw(_lines, Mesh.PRIMITIVE_LINES, lines, line_colours)


## A glow as the 8-bit vertex colours can carry it (the shaders multiply it back).
static func _stored(colour: Color) -> Color:
	return Color(minf(1.0, colour.r / BRIGHTNESS), minf(1.0, colour.g / BRIGHTNESS), minf(1.0, colour.b / BRIGHTNESS), 1.0)


static func _draw(target: MeshInstance3D, primitive: int, vertices: PackedVector3Array, colours: PackedColorArray, uvs: PackedVector2Array = PackedVector2Array()) -> void:
	var mesh: ArrayMesh = target.mesh
	mesh.clear_surfaces()
	if vertices.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_COLOR] = colours
	if not uvs.is_empty():
		arrays[Mesh.ARRAY_TEX_UV] = uvs
	mesh.add_surface_from_arrays(primitive, arrays)


func clear() -> void:
	_alive.fill(0)
	_red_state.fill(0)
	_cursor = 0
	_red_cursor = 0
	_live = 0
	_lying_on_floor = 0
	_smoulders.clear()
	_drips.clear()
	_glows.clear()
	_tweens.clear()
	for slot in _lights:
		slot.light.light_energy = 0.0
	for slot in _flares + _rings + _waves:
		slot.node.visible = false
	update(0.0)


## Glowing particles alive (sparks, drops, embers).
func live() -> int:
	return _live


## Red drops in the air, and stuck where they landed.
func red() -> Dictionary:
	var flying := 0
	var lying := 0
	for i in RED:
		flying += 1 if _red_state[i] == 1 else 0
		lying += 1 if _red_state[i] == 2 else 0
	return { "flying": flying, "lying": lying }
