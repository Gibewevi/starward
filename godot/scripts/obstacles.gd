class_name Obstacles
extends RefCounted
## The level's obstacles: boxes on the floor, square to the axes (kind, min,
## max, centre) — port of obstacleQueries() in src/lab.js. What the game asks
## of them: push a walker (a circle on the floor) out of every one, cast a
## bolt or a line of sight against them, find cover behind them from a threat.
## Their bounds are also kept in doubles (`bounds`, six numbers a box), for
## the ragdolls, the navigation grid and the casts to work as the web's do.
## A box can be taken out and put back (the great door, open or shut).

var boxes: Array[Dictionary] = []
## min x, y, z, max x, y, z of each box, in order.
var bounds := PackedFloat64Array()
## The cover candidates (see _candidates()), worked out once for these boxes.
var _spots: Array = []


func _init(list: Array = []) -> void:
	for entry in list:
		boxes.append(make(entry.kind, PackedFloat64Array(entry.min), PackedFloat64Array(entry.max)))
	_rebuild()


## A box (kind, and its corners in doubles).
static func make(kind: String, low: PackedFloat64Array, high: PackedFloat64Array) -> Dictionary:
	return {
		"kind": kind, "min": Vector3(low[0], low[1], low[2]), "max": Vector3(high[0], high[1], high[2]),
		"centre": Vector3((low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, (low[2] + high[2]) / 2.0),
		"lo": low, "hi": high,
	}


static func _vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


func _find(box: Dictionary) -> int:
	for k in boxes.size():
		if is_same(boxes[k], box):
			return k
	return -1


func has(box: Dictionary) -> bool:
	return _find(box) >= 0


## Puts a box back (last, as the web's push()).
func add(box: Dictionary) -> void:
	if has(box):
		return
	boxes.append(box)
	_rebuild()


func remove(box: Dictionary) -> void:
	var at := _find(box)
	if at < 0:
		return
	boxes.remove_at(at)
	_rebuild()


func _rebuild() -> void:
	bounds.clear()
	for box in boxes:
		bounds.append_array(box.lo)
		bounds.append_array(box.hi)
	_spots.clear()


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


## First obstacle the segment a → b crosses: { t (0..1), point, normal, box }, or an empty
## dictionary (slab method). skip: a box to ignore, or a callable that rejects boxes.
func segment_hit(a: Vector3, b: Vector3, skip: Variant = null) -> Dictionary:
	var best := {}
	var best_t := INF
	var start := [float(a.x), float(a.y), float(a.z)]
	var d := [float(b.x) - a.x, float(b.y) - a.y, float(b.z) - a.z]
	var skip_box: Dictionary = skip if skip is Dictionary else {}
	var reject: Callable = skip if skip is Callable else Callable()
	for box in boxes:
		if not skip_box.is_empty() and is_same(box, skip_box):
			continue
		if reject.is_valid() and reject.call(box):
			continue
		var lo: PackedFloat64Array = box.lo
		var hi: PackedFloat64Array = box.hi
		var enter := 0.0
		var exit := 1.0
		var axis := -1
		var sign := 0.0
		var ok := true
		for k in 3:
			var dk: float = d[k]
			var ak: float = start[k]
			if absf(dk) < 1e-9:
				if ak < lo[k] or ak > hi[k]:
					ok = false
					break
				continue
			var t0 := (lo[k] - ak) / dk
			var t1 := (hi[k] - ak) / dk
			var s := -1.0
			if t0 > t1:
				var swap := t0
				t0 = t1
				t1 = swap
				s = 1.0
			if t0 > enter:
				enter = t0
				axis = k
				sign = s
			exit = minf(exit, t1)
			if enter > exit:
				ok = false
				break
		if not ok or enter >= best_t:
			continue
		var normal := Vector3.ZERO
		if axis >= 0:
			normal[axis] = sign
		best_t = enter
		best = { "t": enter, "point": Vector3(start[0] + d[0] * enter, start[1] + d[1] * enter, start[2] + d[2] * enter), "normal": normal, "box": box }
	return best


func clear(a: Vector3, b: Vector3) -> bool:
	return segment_hit(a, b).is_empty()


## Places to hide from `threat`: just outside each face of each obstacle,
## where the obstacle stands between the threat and a crouching trooper.
## [{ position, box, tall, facing }]
func cover_spots(threat: Vector3, min_distance: float = 3.0) -> Array[Dictionary]:
	if _spots.is_empty():
		_spots = _candidates()
	var spots: Array[Dictionary] = []
	var eye := Vector3(threat.x, 1.2, threat.z)
	var tx := float(threat.x)
	var tz := float(threat.z)
	for candidate: Dictionary in _spots:
		var x: float = candidate.x
		var z: float = candidate.z
		if sqrt((x - tx) * (x - tx) + (z - tz) * (z - tz)) < min_distance:
			continue
		# Covered when crouching: the line from the threat to his head meets this obstacle.
		var hit := segment_hit(eye, Vector3(x, 0.72, z))
		if hit.is_empty():
			continue
		var box: Dictionary = candidate.box
		var other: Dictionary = hit.box
		if not is_same(other, box) and not (other.lo[1] > 0.5 and (other.centre as Vector3).distance_to(box.centre) < 1.5):
			continue
		spots.append({ "position": Vector3(x, 0, z), "box": box, "tall": candidate.tall, "facing": candidate.facing })
	return spots


## Every place beside a box where a trooper could crouch, clear of the others: what does not depend on the threat.
func _candidates() -> Array:
	var list := []
	for box in boxes:
		var lo: PackedFloat64Array = box.lo
		var hi: PackedFloat64Array = box.hi
		if lo[1] > 0.5 or hi[1] < 0.75 or box.kind == "wall" or box.kind == "rail":
			continue
		var cx := (lo[0] + hi[0]) / 2.0
		var cz := (lo[2] + hi[2]) / 2.0
		var hx := (hi[0] - lo[0]) / 2.0
		var hz := (hi[2] - lo[2]) / 2.0
		var tall := hi[1] > 1.3
		for other in boxes:
			if other.lo[1] > 0.5 and absf(other.centre.x - cx) < 0.1 and absf(other.centre.z - cz) < 0.1:
				tall = true
		for face in [[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0]]:
			var nx: float = face[0]
			var nz: float = face[1]
			for offset in [-0.3, 0.3]:
				var x: float = cx + nx * (hx + 0.42) + (offset * hx if nz != 0.0 else 0.0)
				var z: float = cz + nz * (hz + 0.42) + (offset * hz if nx != 0.0 else 0.0)
				var crowded := false
				for other in boxes:
					if x > other.lo[0] - 0.25 and x < other.hi[0] + 0.25 and z > other.lo[2] - 0.25 and z < other.hi[2] + 0.25:
						crowded = true
						break
				if not crowded:
					list.append({ "x": x, "z": z, "box": box, "tall": tall, "facing": Vector3(-nx, 0, -nz) })
	return list
