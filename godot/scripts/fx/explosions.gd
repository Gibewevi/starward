class_name Explosions
extends Node3D
## Blasts (port of src/explosions.js): Blender-rendered volumetric fire and
## smoke, a flipbook (assets/fx/explosion.png, its heat mask beside it) on a
## quad facing the camera — only the incandescent parts glow, soot stays dark.
##
## Around it, all live: a blinding flash that lights the room and fades from
## white to orange, a flare, a shockwave racing over the floor, a slower ring
## of ground dust, the floor glowing where it burst (it cools in a few
## seconds), a burn left for good on the floor and the crates around
## (ScorchMarks), and the fire mirrored in the wet metal floor by a shader
## that traces the mirror ray up to the flipbook. Sparks, embers and debris
## come from their own systems (see Battle.detonate).

const LIGHT_SCALE := 0.35
const WHITE := Color(1, 0.95, 0.85)
const ORANGE := Color(1, 0.45, 0.12)
const HOT := Color(3, 2.6, 2.1)
const WARM := Color(2.4, 0.9, 0.25)

var meta: Dictionary = {}
var marks: ScorchMarks
var random: Callable
var pool: Array = []
var _next := 0


func _init(burns: ScorchMarks = null, slots: int = 5, draw: Callable = Callable()) -> void:
	name = "Explosions"
	marks = burns
	random = draw if draw.is_valid() else func() -> float: return randf()
	meta = CombatController._load("res://assets/fx/explosion.json")
	var map: Texture2D = load("res://assets/fx/explosion.png")
	var heat_map: Texture2D = load("res://assets/fx/explosion-heat.png")
	var embers: Texture2D = load("res://assets/fx/embers.png")
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	for k in slots:
		var billboard := _surface("Explosion", quad, "res://shaders/explosion_fire.gdshader")
		billboard.extra_cull_margin = 8.0
		billboard.sorting_offset = 2.0
		var reflection := _surface("Explosion reflection", plane, "res://shaders/explosion_mirror.gdshader")
		for mesh: MeshInstance3D in [billboard, reflection]:
			var material: ShaderMaterial = mesh.material_override
			material.set_shader_parameter("map", map)
			material.set_shader_parameter("heat_map", heat_map)
			material.set_shader_parameter("columns", float(meta.columns))
			material.set_shader_parameter("rows", float(meta.rows))
			material.set_shader_parameter("cell_size", float(meta.size))
		billboard.material_override.set_shader_parameter("glow", float(meta.get("glow", 1.8)))
		reflection.material_override.set_shader_parameter("width", float(meta.width))
		var flare := ImpactEffects.glow_quad(self, "Explosion flare", Grenades._glow())
		var shock := _surface("Shockwave", plane, "res://shaders/blast_shock.gdshader")
		shock.material_override.set_shader_parameter("color", Vector3(1.3, 0.85, 0.5))
		var dust := _surface("Ground dust", plane, "res://shaders/blast_dust.gdshader")
		dust.material_override.set_shader_parameter("color", Vector3(0.2, 0.17, 0.14))
		var heat := _surface("Blast heat", plane, "res://shaders/floor_glow.gdshader")
		heat.material_override.set_shader_parameter("map", embers)
		heat.material_override.set_shader_parameter("tint", Vector3.ZERO)
		var light := OmniLight3D.new()
		light.name = "Explosion light"
		light.light_color = Color(1, 0.847, 0.627)
		light.light_energy = 0.0
		light.omni_range = 14.0
		light.omni_attenuation = 1.4
		add_child(light)
		pool.append({
			"billboard": billboard, "reflection": reflection, "flare": flare, "shock": shock, "dust": dust, "heat": heat, "light": light,
			"at": Vector3.ZERO, "age": INF, "power": 1.0, "live": false, "heat_age": INF, "spin": 1.0, "size": 0.75,
		})


func _surface(label: String, mesh: Mesh, shader_path: String) -> MeshInstance3D:
	var surface := MeshInstance3D.new()
	surface.name = label
	surface.mesh = mesh
	surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load(shader_path)
	surface.material_override = material
	surface.visible = false
	add_child(surface)
	return surface


## Which frame (with its fraction) at `time`: the render's own timestamps — more frames in the first burst, fewer as it cools.
static func frame_at(data: Dictionary, time: float, progress: float) -> float:
	var times: Array = data.get("frameTimes", [])
	var frames: int = int(data.frames)
	if times.size() != frames:
		return (frames - 1) * (progress if data.get("playback", "") == "linear" else 1.0 - pow(1.0 - progress, 1.75))
	if time <= times[0]:
		return 0.0
	if time >= times[-1]:
		return times.size() - 1.0
	var lo := 0
	var hi := times.size() - 1
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if times[mid] <= time:
			lo = mid
		else:
			hi = mid
	return lo + (time - times[lo]) / (times[hi] - times[lo])


## A blast at `at` (on the floor).
func spawn(at: Vector3, power: float = 1.0) -> Dictionary:
	var slot: Dictionary = pool[_next]
	_next = (_next + 1) % pool.size()
	slot.age = 0.0
	slot.power = power
	slot.live = true
	slot.heat_age = 0.0
	slot.spin = 1.0 if random.call() < 0.5 else -1.0
	slot.size = 0.75 + random.call() * 0.08
	slot.at = Vector3(at.x, 0, at.z)
	for key in ["billboard", "reflection", "flare", "shock", "dust", "heat"]:
		slot[key].visible = true
	var heat: MeshInstance3D = slot.heat
	heat.position = slot.at + Vector3(0, 0.006, 0)
	heat.scale = Vector3.ONE * ((1.1 + random.call() * 0.3) * power)
	heat.rotation.y = random.call() * TAU
	for key in ["shock", "dust"]:
		slot[key].material_override.set_shader_parameter("seed", random.call() * 100.0)
	slot.reflection.material_override.set_shader_parameter("time", 0.0)
	if marks:
		marks.blast(slot.at, power)
	return slot


func update(dt: float) -> void:
	var duration: float = meta.duration
	for slot in pool:
		var heat: MeshInstance3D = slot.heat
		if heat.visible:
			# White-orange, then deep red, then out; the embers flicker as they go.
			slot.heat_age += dt
			var age: float = slot.heat_age
			var glow := minf(1.0, age / 0.12) * (1.0 - smoothstep(0.4, 6.0, age)) * (0.9 + 0.1 * sin(age * 23.0 + slot.spin))
			heat.material_override.set_shader_parameter("tint", Vector3(2.6 * glow, 1.05 * pow(glow, 1.6), 0.3 * pow(glow, 3.0)))
			if age > 6.0:
				heat.visible = false
		if not slot.live:
			continue
		slot.age += dt
		var t: float = slot.age
		var p := minf(1.0, t / duration)
		var power: float = slot.power
		var frame := frame_at(meta, t, p)
		var a := floorf(frame)
		var b := minf(float(meta.frames) - 1.0, a + 1.0)
		for key in ["billboard", "reflection"]:
			var material: ShaderMaterial = slot[key].material_override
			material.set_shader_parameter("frame_a", a)
			material.set_shader_parameter("frame_b", b)
			material.set_shader_parameter("between", frame - a)
		# Same size and centre as the Blender camera's frame.
		var scale: float = slot.size * (0.9 + 0.1 * power)
		var width: float = meta.width * scale
		var billboard: MeshInstance3D = slot.billboard
		billboard.scale = Vector3(width, width, 1)
		billboard.position = Vector3(slot.at.x, meta.centre * scale, slot.at.z)
		billboard.material_override.set_shader_parameter("depth_bias", float(meta.get("depthBias", 1.1)))
		billboard.material_override.set_shader_parameter("opacity", 1.0 if meta.get("dissipation", "") == "erosion" else 1.0 - smoothstep(0.82, 1.0, p))
		var reflection: MeshInstance3D = slot.reflection
		var mirror: ShaderMaterial = reflection.material_override
		mirror.set_shader_parameter("centre", Vector3(slot.at.x, meta.centre * scale, slot.at.z))
		mirror.set_shader_parameter("width", width)
		mirror.set_shader_parameter("time", float(mirror.get_shader_parameter("time")) + dt)
		reflection.position = slot.at + Vector3(0, 0.012, 0)
		reflection.scale = Vector3(width * 1.3, 1, width * 1.3)
		# The flash: blinding at once, white cooling to orange, gone in half a second.
		var flash := exp(-t * 18.0) * minf(1.0, t / 0.016)
		var fire := (1.0 - exp(-t * 36.0)) * exp(-t * 2.8)
		var light: OmniLight3D = slot.light
		light.position = slot.at + Vector3(0, 0.6, 0)
		light.light_energy = power * (70.0 * flash + 22.0 * fire) * LIGHT_SCALE
		light.light_color = WHITE.lerp(ORANGE, minf(1.0, t / 0.09))
		mirror.set_shader_parameter("flash", flash * 0.4 + fire * 0.24)
		mirror.set_shader_parameter("light_color", Vector3(light.light_color.r, light.light_color.g, light.light_color.b))
		var flare: MeshInstance3D = slot.flare
		flare.position = slot.at + Vector3(0, 0.35, 0)
		var flare_p := minf(1.0, t / 0.16)
		var flare_width := (0.4 + 1.2 * Stormtrooper.ease_by("outExpo", flare_p)) * power
		flare.scale = Vector3(flare_width, flare_width * 0.7, 1)
		var tint := HOT.lerp(WARM, flare_p)
		tint.a = 0.65 * (1.0 - Stormtrooper.ease_by("outQuad", flare_p))
		flare.material_override.set_shader_parameter("tint", tint)
		flare.visible = flare_p < 1.0
		# The shockwave races out over the floor; the dust follows, slower.
		var shock_p := minf(1.0, t / 0.18)
		var shock: MeshInstance3D = slot.shock
		shock.position = slot.at + Vector3(0, 0.03, 0)
		shock.scale = Vector3.ONE * (0.5 + 6.8 * Stormtrooper.ease_by("outCubic", shock_p) * power)
		shock.material_override.set_shader_parameter("opacity", 0.34 * pow(1.0 - shock_p, 2.0))
		shock.material_override.set_shader_parameter("phase", shock_p)
		shock.visible = shock_p < 1.0
		var dust_p := minf(1.0, t / 1.3)
		var dust: MeshInstance3D = slot.dust
		dust.position = slot.at + Vector3(0, 0.02, 0)
		dust.scale = Vector3.ONE * (0.6 + 5.0 * Stormtrooper.ease_by("outExpo", dust_p) * power)
		dust.material_override.set_shader_parameter("opacity", 0.24 * sin(PI * minf(1.0, dust_p * 1.6)) * (1.0 - dust_p))
		dust.material_override.set_shader_parameter("phase", dust_p)
		dust.visible = dust_p < 1.0
		if p >= 1.0:
			slot.live = false
			billboard.visible = false
			reflection.visible = false
			light.light_energy = 0.0


func clear() -> void:
	for slot in pool:
		slot.live = false
		for key in ["billboard", "reflection", "flare", "shock", "dust", "heat"]:
			slot[key].visible = false
		slot.light.light_energy = 0.0


## Blasts still burning.
func active() -> int:
	return pool.filter(func(slot: Dictionary) -> bool: return slot.live).size()
