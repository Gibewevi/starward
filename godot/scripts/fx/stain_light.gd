class_name StainLight
extends RefCounted
## The light falling on the red stains — the drops, the wounds, the pools, the
## footprints (port of src/stain-light.js). They are drawn unlit in their own
## colour, which is right in the lit room; in the dark they must go dark too,
## a red-black, except where a lamp's beam or the blade's glow catches them
## (in the blade's blue glow, red stays dark, as it would).
##
## Every stain material (shaders/stain_light.gdshaderinc) is registered here;
## light(room, lights) gives them, each frame, the room's light (the power
## level, 1 → the stains as they are) and the lights near them, each as it
## is this frame.

const MAX := 12
## How the lights' energy maps back to the web's intensities (LabLevel.LIGHT_SCALE).
const LIGHT_SCALE := 0.35

static var materials: Array[ShaderMaterial] = []
static var _room := 1.0


static func register(material: ShaderMaterial, feel: Dictionary = {}) -> void:
	if feel.has("blackout"):
		material.set_shader_parameter("stain_floor", float(feel.blackout.stains.floor))
		material.set_shader_parameter("stain_scale", 1.0 / float(feel.blackout.stains.full))
	material.set_shader_parameter("stain_room", _room)
	materials.append(material)


static func forget(material: ShaderMaterial) -> void:
	materials.erase(material)


## Each frame: the room's light (0 → 1) and the lights (OmniLight3D, SpotLight3D) that may fall on the stains.
static func light(room: float, lights: Array) -> void:
	_room = room
	var a := PackedVector4Array()
	var b := PackedVector4Array()
	var c := PackedVector4Array()
	var decay := PackedFloat32Array()
	if room < 1.0:
		for light: Light3D in lights:
			if a.size() >= MAX:
				break
			if not light.is_inside_tree() or not light.visible or not (light.light_energy > 0.0):
				continue
			var at := light.global_position
			var intensity := light.light_energy / LIGHT_SCALE
			var colour := light.light_color * intensity
			if light is SpotLight3D:
				var spot := light as SpotLight3D
				var aim := -spot.global_basis.z.normalized()
				var angle := deg_to_rad(spot.spot_angle)
				a.append(Vector4(at.x, at.y, at.z, spot.spot_range))
				b.append(Vector4(aim.x, aim.y, aim.z, cos(angle)))
				c.append(Vector4(colour.r, colour.g, colour.b, cos(angle * (1.0 - float(spot.get_meta("penumbra", 0.0))))))
				decay.append(spot.spot_attenuation)
			else:
				var omni := light as OmniLight3D
				a.append(Vector4(at.x, at.y, at.z, omni.omni_range if omni else 0.0))
				b.append(Vector4(0, 0, 0, -2))
				c.append(Vector4(colour.r, colour.g, colour.b, 1))
				decay.append(omni.omni_attenuation if omni else 2.0)
	while a.size() < MAX:
		a.append(Vector4.ZERO)
		b.append(Vector4(0, 0, 0, -2))
		c.append(Vector4(0, 0, 0, 1))
		decay.append(2.0)
	for material in materials:
		material.set_shader_parameter("stain_room", room)
		if room < 1.0:
			material.set_shader_parameter("stain_a", a)
			material.set_shader_parameter("stain_b", b)
			material.set_shader_parameter("stain_c", c)
			material.set_shader_parameter("stain_decay", decay)
