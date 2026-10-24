class_name Nav
extends RefCounted
## Finding the way round the room (port of src/nav.js). The deck is a grid of
## cells (0.4 m); a cell is walkable when a trooper standing there stays clear
## of every obstacle (its footprint grown by his girth) and inside the room.
## path(from, to) runs A* over the grid (8 directions, no cutting corners)
## and straightens the result: only the waypoints where the way really turns
## are kept. line_free(a, b) says whether a man can walk straight from a to b.
## `cost(point)` (≥ 1) makes some ground slower to cross: the way found goes
## round it when it can, and is not straightened across it.

const NEIGHBOURS := [[1, 0, 1.0], [-1, 0, 1.0], [0, 1, 1.0], [0, -1, 1.0], [1, 1, 1.4142135623730951], [1, -1, 1.4142135623730951], [-1, 1, 1.4142135623730951], [-1, -1, 1.4142135623730951]]

var obstacles: Obstacles
var cost: Callable
var cell := 0.4
var clearance := 0.33
var min_x := 0.0
var min_z := 0.0
var cols := 1
var rows := 1
var blocked := PackedByteArray()
## As the web's Float32Arrays: the cost of each cell, the best known way to it.
var weight := PackedFloat32Array()
var _g := PackedFloat32Array()
var _from := PackedInt32Array()
var _stamp := PackedInt32Array()
var _closed := PackedInt32Array()
var _search := 0


func _init(level: Obstacles, bounds: Dictionary, cell_size: float = 0.4, girth: float = 0.33, margin: float = 0.35, slow: Callable = Callable()) -> void:
	obstacles = level
	cost = slow
	cell = cell_size
	clearance = girth
	min_x = bounds.minX + margin
	min_z = bounds.minZ + margin
	cols = maxi(1, ceili((bounds.maxX - margin - min_x) / cell))
	rows = maxi(1, ceili((bounds.maxZ - margin - min_z) / cell))
	blocked.resize(cols * rows)
	weight.resize(cols * rows)
	weight.fill(1.0)
	_g.resize(cols * rows)
	_from.resize(cols * rows)
	_stamp.resize(cols * rows)
	_closed.resize(cols * rows)
	rebuild()


func rebuild() -> void:
	var b := obstacles.bounds
	for j in rows:
		for i in cols:
			var x := min_x + (i + 0.5) * cell
			var z := min_z + (j + 0.5) * cell
			var hit := 0
			for k in range(0, b.size(), 6):
				if b[k + 1] < 1.2 and x > b[k] - clearance and x < b[k + 3] + clearance and z > b[k + 2] - clearance and z < b[k + 5] + clearance:
					hit = 1
					break
			blocked[j * cols + i] = hit
			if cost.is_valid():
				weight[j * cols + i] = maxf(1.0, cost.call(Vector3(x, 0, z)))


func centre(i: int, j: int) -> Vector3:
	return Vector3(min_x + (i + 0.5) * cell, 0, min_z + (j + 0.5) * cell)


func _inside(i: int, j: int) -> bool:
	return i >= 0 and j >= 0 and i < cols and j < rows


func _free(i: int, j: int) -> bool:
	return _inside(i, j) and blocked[j * cols + i] == 0


func _cell_of(x: float, z: float) -> Vector2i:
	return Vector2i(floori((x - min_x) / cell), floori((z - min_z) / cell))


## The nearest walkable cell to a point (searching rings outwards), or (-1, -1).
func _nearest_free(point: Vector3) -> Vector2i:
	var c := _cell_of(point.x, point.z)
	if _free(c.x, c.y):
		return c
	for r in range(1, 8):
		var best := Vector2i(-1, -1)
		var best_d := INF
		for j in range(c.y - r, c.y + r + 1):
			for i in range(c.x - r, c.x + r + 1):
				if maxi(absi(i - c.x), absi(j - c.y)) != r or not _free(i, j):
					continue
				var dx: float = min_x + (i + 0.5) * cell - point.x
				var dz: float = min_z + (j + 0.5) * cell - point.z
				var d: float = dx * dx + float(point.y) * point.y + dz * dz
				if d < best_d:
					best_d = d
					best = Vector2i(i, j)
		if best.x >= 0:
			return best
	return Vector2i(-1, -1)


## Can he walk straight from a to b? (`cheap`: and without crossing slower ground than either end's.)
func line_free(a: Vector3, b: Vector3, cheap: bool = false) -> bool:
	var ax := float(a.x)
	var az := float(a.z)
	var dx := float(b.x) - ax
	var dz := float(b.z) - az
	var length := sqrt(dx * dx + dz * dz)
	var steps := maxi(1, ceili(length / (cell * 0.5)))
	var most := INF
	if cheap:
		var ca := _cell_of(a.x, a.z)
		var cb := _cell_of(b.x, b.z)
		most = maxf(weight[ca.y * cols + ca.x] if _inside(ca.x, ca.y) else 1.0, weight[cb.y * cols + cb.x] if _inside(cb.x, cb.y) else 1.0)
	for k in steps + 1:
		var c := _cell_of(ax + dx * k / steps, az + dz * k / steps)
		if not _free(c.x, c.y) or weight[c.y * cols + c.x] > most:
			return false
	return true


func walkable(point: Vector3) -> bool:
	var c := _cell_of(point.x, point.z)
	return _free(c.x, c.y)


## The nearest walkable spot to a point (the point itself if it is walkable), or null.
func nearest(point: Vector3) -> Variant:
	if walkable(point):
		return Vector3(point.x, 0, point.z)
	var c := _nearest_free(point)
	return centre(c.x, c.y) if c.x >= 0 else null


func _h(index: int, goal: Vector2i) -> float:
	var dx := absi(index % cols - goal.x)
	var dz := absi(index / cols - goal.y)
	return maxi(dx, dz) + (1.4142135623730951 - 1.0) * mini(dx, dz)


## Waypoints from `start` to `goal` (the last is the goal itself, or the nearest reachable point to it); null if there is no way.
func path(start: Vector3, goal: Vector3) -> Variant:
	var a := _nearest_free(start)
	var b := _nearest_free(goal)
	if a.x < 0 or b.x < 0:
		return null
	var at_goal := _cell_of(goal.x, goal.z)
	var end := Vector3(goal.x, 0, goal.z) if _free(at_goal.x, at_goal.y) else centre(b.x, b.y)
	if line_free(start, end, true):
		return [end]
	_search += 1
	var start_index := a.y * cols + a.x
	var goal_index := b.y * cols + b.x
	var heap := MinHeap.new()
	_g[start_index] = 0.0
	_from[start_index] = -1
	_stamp[start_index] = _search
	heap.push(start_index, _h(start_index, b))
	var found := false
	while heap.size() > 0:
		var index := heap.pop()
		if _closed[index] == _search:
			continue
		_closed[index] = _search
		if index == goal_index:
			found = true
			break
		var i := index % cols
		var j := index / cols
		for neighbour in NEIGHBOURS:
			var di: int = neighbour[0]
			var dj: int = neighbour[1]
			var ni := i + di
			var nj := j + dj
			if not _free(ni, nj):
				continue
			# No cutting a corner diagonally.
			if di != 0 and dj != 0 and (not _free(i + di, j) or not _free(i, j + dj)):
				continue
			var next := nj * cols + ni
			var score: float = _g[index] + neighbour[2] * (weight[index] + weight[next]) / 2.0
			if _stamp[next] == _search and score >= _g[next]:
				continue
			_stamp[next] = _search
			_g[next] = score
			_from[next] = index
			heap.push(next, score + _h(next, b))
	if not found:
		return null
	var cells: Array[Vector3] = []
	var index := goal_index
	while index != -1:
		cells.append(centre(index % cols, index / cols))
		index = _from[index]
	cells.reverse()
	cells[cells.size() - 1] = end
	# Straighten: from each kept point, jump to the furthest one in plain view.
	var way: Array[Vector3] = []
	var here := Vector3(start.x, 0, start.z)
	var k := 0
	while k < cells.size():
		var far := k
		for m in range(cells.size() - 1, k, -1):
			if line_free(here, cells[m], true):
				far = m
				break
		way.append(cells[far])
		here = cells[far]
		k = far + 1
	return way


## A binary heap of cells by score (as nav.js's, so ties fall the same way).
class MinHeap:
	var items := PackedInt32Array()
	var keys := PackedFloat64Array()

	func size() -> int:
		return items.size()

	func push(item: int, key: float) -> void:
		var n := items.size()
		items.append(item)
		keys.append(key)
		while n > 0:
			var parent := (n - 1) >> 1
			if keys[parent] <= key:
				break
			items[n] = items[parent]
			keys[n] = keys[parent]
			n = parent
		items[n] = item
		keys[n] = key

	func pop() -> int:
		var top := items[0]
		var last := items.size() - 1
		var last_item := items[last]
		var last_key := keys[last]
		items.resize(last)
		keys.resize(last)
		if last > 0:
			var n := 0
			while true:
				var child := 2 * n + 1
				if child >= last:
					break
				if child + 1 < last and keys[child + 1] < keys[child]:
					child += 1
				if keys[child] >= last_key:
					break
				items[n] = items[child]
				keys[n] = keys[child]
				n = child
			items[n] = last_item
			keys[n] = last_key
		return top
