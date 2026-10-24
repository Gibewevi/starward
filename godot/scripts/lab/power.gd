class_name Power
extends RefCounted
## The room's power (port of src/power.js). Everything that shines in the
## room — the light bars and floor strips (unlit materials drawn bright),
## their glow pools, the lamps — and the studio light over the deck (the key
## light, the rim, the strip over the hero, the ambient, the background, the
## fog) follows one `level`, 1 (on) to 0 (cut). At 0 the room keeps only a
## cold trace of light (FEEL.blackout.night), enough to read shapes.
##
## Lights are never removed or hidden, only dimmed. Animated ones (the door's
## blinking lamp) are recognised by their colour changing between frames and
## dimmed on top of their own animation. The transformer is not the room's:
## it keeps its own light. Materials named in FEEL.blackout.keep
## stay faintly on (battery-backed diodes on the cases).
##
## `fittings`: points on the light fittings (where sparks fly when the power
## dies), nearest first from any point with fixtures_from(point).

var level := 1.0
var fittings: Array[Vector3] = []
var _emitters: Array = []
var _lamps: Array = []
var _night: Dictionary
var _environment: Environment
var _day := {}
var _key: Light3D
var _rim: Light3D
var _strip: Light3D


## `room`: the baked lab; `lights`: { environment, key, rim, strip } (main.gd's).
func _init(room: Node, feel: Dictionary, lights: Dictionary = {}) -> void:
	_night = feel.blackout.night
	var keep: Dictionary = feel.blackout.keep
	var glowing := {}
	for emitter in Glow._load().get("lab.glb", []):
		glowing[emitter.name] = emitter
	var transformer := room.find_child("Transformer", true, false)
	var seen := {}
	var points: Array[Vector3] = []
	for node in room.find_children("*", "", true, false):
		if transformer and (node == transformer or transformer.is_ancestor_of(node)):
			continue
		if node is Light3D:
			_lamps.append({ "light": node, "base": node.light_energy, "last": node.light_energy })
			continue
		if not node is MeshInstance3D or node.mesh == null:
			continue
		for surface in node.mesh.get_surface_count():
			var material := node.mesh.surface_get_material(surface) as BaseMaterial3D
			if material == null or not glowing.has(material.resource_name):
				continue
			if not seen.has(material):
				seen[material] = true
				_emitters.append({ "material": material, "base": material.albedo_color, "last": material.albedo_color, "floor": float(keep.get(material.resource_name, 0.0)) })
			# Where the fittings are: a few points of each merged light (not of the glow pools added round them).
			if glowing[material.resource_name].additive:
				continue
			var vertices: PackedVector3Array = node.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
			var step := maxi(1, vertices.size() / 60)
			for k in range(0, vertices.size(), step):
				points.append(node.global_transform * vertices[k])
	# Fittings closer than half a metre are one fitting.
	for candidate in points:
		var near := false
		for other in fittings:
			if other.distance_squared_to(candidate) < 0.25:
				near = true
				break
		if not near:
			fittings.append(candidate)
	_environment = lights.get("environment")
	_key = lights.get("key")
	_rim = lights.get("rim")
	_strip = lights.get("strip")
	if _environment:
		_day = {
			"ambient": _environment.ambient_light_energy, "ambient_color": _environment.ambient_light_color,
			"background": _environment.background_color, "fog": _environment.fog_light_color,
		}
	for light in [_key, _rim, _strip]:
		if light:
			_day[light] = light.light_energy


## Each frame, after the room's own animations: everything set to the level.
func apply() -> void:
	var k := level
	for entry in _emitters:
		var on: float = entry.floor + (1.0 - entry.floor) * k
		# Still since we last set it: from its base. Animated (it changed): dimmed on top of its animation.
		var colour: Color = entry.material.albedo_color
		var from: Color = entry.base if colour == entry.last else colour
		entry.material.albedo_color = Color(from.r * on, from.g * on, from.b * on, from.a)
		entry.last = entry.material.albedo_color
	for entry in _lamps:
		var light: Light3D = entry.light
		light.light_energy = entry.base * k if light.light_energy == entry.last else light.light_energy * k
		light.visible = light.light_energy > 1e-4
		entry.last = light.light_energy
	if _key:
		_key.light_energy = _day[_key] * k
	if _strip:
		_strip.light_energy = _day[_strip] * k
	# The web's rim goes from 1.65 to FEEL.blackout.night.rim, its sky from 1.4 to night.hemisphere.
	if _rim:
		_rim.light_energy = lerpf(_day[_rim] * _night.rim / 1.65, _day[_rim], k)
	if _environment:
		_environment.ambient_light_energy = lerpf(_day.ambient * _night.hemisphere / 1.4, _day.ambient, k)
		_environment.ambient_light_color = Color.hex(int(_night.sky) << 8 | 0xff).lerp(_day.ambient_color, k)
		var dark := Color.hex(int(_night.background) << 8 | 0xff)
		_environment.background_color = dark.lerp(_day.background, k)
		_environment.fog_light_color = dark.lerp(_day.fog, k)


## The fittings, nearest to `from` first.
func fixtures_from(from: Vector3) -> Array[Vector3]:
	var sorted := fittings.duplicate()
	sorted.sort_custom(func(a: Vector3, b: Vector3) -> bool: return a.distance_squared_to(from) < b.distance_squared_to(from))
	return sorted
