class_name Obstacles
extends RefCounted
## The level's obstacles: boxes on the floor, square to the axes (kind, min,
## max) — port of obstacleQueries() in src/lab.js. push_out() keeps a walker
## (a circle on the floor) out of every one.

var boxes: Array[Dictionary] = []


func _init(list: Array = []) -> void:
	for entry in list:
		boxes.append({ "kind": entry.kind, "min": _vector(entry.min), "max": _vector(entry.max) })


static func _vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


## Pushes a walker (a circle of `radius` on the floor) out of every obstacle; returns the corrected point.
func push_out(position: Vector3, radius: float = 0.3) -> Vector3:
	for box in boxes:
		var lo: Vector3 = box.min
		var hi: Vector3 = box.max
		if lo.y > 1.2:
			continue
		var nx := clampf(position.x, lo.x, hi.x)
		var nz := clampf(position.z, lo.z, hi.z)
		var dx := position.x - nx
		var dz := position.z - nz
		var distance := sqrt(dx * dx + dz * dz)
		if distance >= radius:
			continue
		if distance > 1e-6:
			position.x = nx + dx / distance * radius
			position.z = nz + dz / distance * radius
		else:
			# Inside: out through the nearest side.
			var exits := [Vector2(lo.x - radius - position.x, 0), Vector2(hi.x + radius - position.x, 0), Vector2(0, lo.z - radius - position.z), Vector2(0, hi.z + radius - position.z)]
			exits.sort_custom(func(a: Vector2, b: Vector2) -> bool: return absf(a.x + a.y) < absf(b.x + b.y))
			position.x += exits[0].x
			position.z += exits[0].y
	return position
