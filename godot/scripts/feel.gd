extends Node
## The game's feel (autoload `Feel`): every tuning value of the web version,
## read from assets/data/feel.json (baked from src/feel.js), so both versions
## play alike. `Feel.data.push.range`-style access goes through `get_value`:
## Feel.get_value("push.range"). pick([min, max]) draws in a range, as pick()
## does in feel.js.

var data: Dictionary = {}


func _init() -> void:
	data = load_feel()


static func load_feel() -> Dictionary:
	var file := FileAccess.open("res://assets/data/feel.json", FileAccess.READ)
	if file == null:
		push_error("feel.json manquant : lancer la cuisson (docs/MIGRATION_GODOT.md)")
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}


## A value by its dotted path ("blast.radius"), or `fallback`.
func get_value(path: String, fallback: Variant = null) -> Variant:
	var node: Variant = data
	for key in path.split("."):
		if node is Dictionary and node.has(key):
			node = node[key]
		else:
			return fallback
	return node


## A value in a [min, max] range (or the value itself).
static func pick(value: Variant, rng: RandomNumberGenerator = null) -> float:
	if value is Array and value.size() == 2:
		var t := rng.randf() if rng else randf()
		return lerpf(value[0], value[1], t)
	return float(value)
