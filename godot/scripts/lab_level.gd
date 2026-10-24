class_name LabLevel
extends Node3D
## Stage 1's room, baked from the web version (assets/baked/lab.glb: the steel
## deck, the crates, barrels and barriers, the walls, the great door, the
## transformer) with its obstacles (assets/data/lab.json).
## Its light strips, diodes and warning panels get their glow back (Glow).

var obstacles: Obstacles
var bounds: Dictionary = {}
var data: Dictionary = {}

## How the baked lamps' intensities (three.js, physical units) map to Godot's light energy.
const LIGHT_SCALE := 0.35


func _ready() -> void:
	var file := FileAccess.open("res://assets/data/lab.json", FileAccess.READ)
	data = JSON.parse_string(file.get_as_text()) if file else {}
	obstacles = Obstacles.new(data.get("obstacles", []))
	bounds = data.get("bounds", {})
	var scene: PackedScene = load("res://assets/baked/lab.glb")
	var room := scene.instantiate()
	add_child(room)
	Glow.restore(room, "lab.glb")
	for light in room.find_children("*", "Light3D", true, false):
		light.light_energy *= LIGHT_SCALE
		light.shadow_enabled = false
