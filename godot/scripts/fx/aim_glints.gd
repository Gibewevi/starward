class_name AimGlints
extends Node3D
## Warnings the player can read before the danger arrives (the room's part of
## src/telegraph.js): a trooper about to open fire shows it — a red glint
## swells at his muzzle for the moment he takes aim, pulsing faster as the
## trigger comes, gone with the first shot. (The chevrons at the screen's
## edges come with the HUD.)

var _glints: Array[MeshInstance3D] = []
var _clock := 0.0


func _init(slots: int = 8) -> void:
	name = "Aim glints"
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var shader: Shader = load("res://shaders/aim_glint.gdshader")
	for k in slots:
		var glint := MeshInstance3D.new()
		glint.name = "Aim glint"
		glint.mesh = quad
		glint.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var material := ShaderMaterial.new()
		material.shader = shader
		material.render_priority = 5
		glint.material_override = material
		glint.visible = false
		add_child(glint)
		_glints.append(glint)


## aiming: [{ position (the muzzle), amount 0 → 1 (the shot comes at 1) }].
func update(dt: float, aiming: Array) -> void:
	_clock += dt
	for index in _glints.size():
		var glint := _glints[index]
		if index >= aiming.size():
			glint.visible = false
			continue
		var entry: Dictionary = aiming[index]
		var k := clampf(entry.amount, 0.0, 1.0)
		# It swells as he settles his aim, and flickers quicker as the trigger comes.
		var pulse := 0.78 + 0.22 * sin(_clock * (14.0 + 26.0 * k))
		glint.position = entry.position
		glint.scale = Vector3.ONE * ((0.16 + 0.5 * pow(k, 0.7)) * pulse)
		var material: ShaderMaterial = glint.material_override
		material.set_shader_parameter("tint", Color(1.6, 0.08, 0.05, minf(1.0, 0.25 + k) * pulse))
		material.set_shader_parameter("spin", _clock * 0.8)
		glint.visible = true


func clear() -> void:
	for glint in _glints:
		glint.visible = false
