class_name Glow
extends RefCounted
## glTF keeps colours between 0 and 1: what glowed brighter than white in the
## web version (light strips, diodes, warning panels, the saber's blade —
## unlit, not tone mapped) gets its real colour back, so that the bloom catches
## it again. The list comes from the bake (assets/data/glow.json, by model).

static var _table: Dictionary = {}


static func _load() -> Dictionary:
	if _table.is_empty():
		var file := FileAccess.open("res://assets/data/glow.json", FileAccess.READ)
		if file:
			_table = JSON.parse_string(file.get_as_text())
	return _table


## Gives back their glow to the materials of `root` (instanced from the baked model `model`, e.g. "lab.glb").
static func restore(root: Node, model: String) -> void:
	var glowing := {}
	for emitter in _load().get(model, []):
		glowing[emitter.name] = emitter
	var done := {}
	for mesh in root.find_children("*", "MeshInstance3D", true, false):
		if mesh.mesh == null:
			continue
		for surface in mesh.mesh.get_surface_count():
			var material := mesh.mesh.surface_get_material(surface) as BaseMaterial3D
			if material == null or done.has(material) or not glowing.has(material.resource_name):
				continue
			done[material] = true
			var emitter: Dictionary = glowing[material.resource_name]
			var colour: Array = emitter.color
			material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			material.albedo_color = Color(colour[0], colour[1], colour[2], material.albedo_color.a)
			if emitter.additive:
				material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
				material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
				material.no_depth_test = false
