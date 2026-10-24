class_name TestCase
extends RefCounted
## What every test file extends: check(), and the reference traces baked from the JavaScript.

var failures: Array = []
var tree: SceneTree


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func near(a: float, b: float, tolerance: float, message: String) -> void:
	check(absf(a - b) <= tolerance, "%s : %f au lieu de %f" % [message, a, b])


static func data(name: String) -> Dictionary:
	var file := FileAccess.open("res://assets/data/" + name, FileAccess.READ)
	return JSON.parse_string(file.get_as_text()) if file else {}
