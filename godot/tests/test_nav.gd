extends TestCase
## The lab's navigation grid and what its crates give (scripts/ai/nav.gd,
## scripts/obstacles.gd) against src/nav.js and src/lab.js: the same walkable
## cells, the same paths round the crates, the same clear lines, nearest
## spots and hiding places.


static func _lab() -> Obstacles:
	return Obstacles.new(data("lab.json").obstacles)


static func _v(values: Variant) -> Vector3:
	return Vector3(values[0], values[1], values[2])


static func _index(obstacles: Obstacles, box: Dictionary) -> int:
	for k in obstacles.boxes.size():
		if is_same(obstacles.boxes[k], box):
			return k
	return -1


func test_the_grid_matches() -> void:
	var reference := data("nav-reference.json")
	var nav := Nav.new(_lab(), data("lab.json").bounds)
	check(nav.cols == int(reference.cols) and nav.rows == int(reference.rows), "grille %d × %d au lieu de %d × %d" % [nav.cols, nav.rows, reference.cols, reference.rows])
	var cells := ""
	for j in nav.rows:
		for i in nav.cols:
			cells += "1" if nav.blocked[j * nav.cols + i] else "0"
	var wrong := 0
	for k in mini(cells.length(), reference.blocked.length()):
		if cells[k] != reference.blocked[k]:
			wrong += 1
	check(wrong == 0, "%d cases diffèrent" % wrong)


func test_the_paths_match() -> void:
	var reference := data("nav-reference.json")
	var nav := Nav.new(_lab(), data("lab.json").bounds)
	for entry in reference.paths:
		var got: Variant = nav.path(_v(entry.from), _v(entry.to))
		var label := "%s → %s" % [entry.from, entry.to]
		if entry.path == null:
			check(got == null, "%s : un chemin au lieu d’aucun" % label)
			continue
		if got == null:
			check(false, "%s : aucun chemin" % label)
			continue
		check(got.size() == entry.path.size(), "%s : %d points au lieu de %d" % [label, got.size(), entry.path.size()])
		for k in mini(got.size(), entry.path.size()):
			check((got[k] as Vector3).distance_to(_v(entry.path[k])) < 1e-4, "%s : point %d en %s au lieu de %s" % [label, k, got[k], entry.path[k]])
	for k in reference.nearest.size():
		var probe: Vector3 = _v(reference.paths[k * 8].from) if k < 9 else Vector3.ZERO
		var got: Variant = nav.nearest(probe + Vector3(0.3, 0, 0.2))
		var want: Variant = reference.nearest[k]
		check((want == null) == (got == null), "plus proche de %s" % probe)
		if want != null and got != null:
			check((got as Vector3).distance_to(_v(want)) < 1e-4, "plus proche de %s : %s au lieu de %s" % [probe, got, want])


func test_the_lines_and_cover_match() -> void:
	var reference := data("nav-reference.json")
	var lab := _lab()
	var nav := Nav.new(lab, data("lab.json").bounds)
	for line in reference.lines:
		var from := _v(line.from)
		var to := _v(line.to)
		check(nav.line_free(from, to) == line.free, "ligne libre %s → %s" % [line.from, line.to])
		var hit := lab.segment_hit(Vector3(from.x, 1.1, from.z), Vector3(to.x, 0.8, to.z))
		if line.hit == null:
			check(hit.is_empty(), "%s → %s : un obstacle au lieu d’aucun" % [line.from, line.to])
		elif hit.is_empty():
			check(false, "%s → %s : aucun obstacle" % [line.from, line.to])
		else:
			check(_index(lab, hit.box) == int(line.hit.box) and absf(hit.t - line.hit.t) < 1e-4 and hit.normal == _v(line.hit.normal), "%s → %s : obstacle %d à %.4f au lieu de %d à %.4f" % [line.from, line.to, _index(lab, hit.box), hit.t, line.hit.box, line.hit.t])
	for entry in reference.cover:
		var spots := lab.cover_spots(_v(entry.threat), 2.5)
		check(spots.size() == entry.spots.size(), "couverts face à %s : %d au lieu de %d" % [entry.threat, spots.size(), entry.spots.size()])
		for k in mini(spots.size(), entry.spots.size()):
			var want: Dictionary = entry.spots[k]
			var got: Dictionary = spots[k]
			check((got.position as Vector3).distance_to(_v(want.position)) < 1e-4 and _index(lab, got.box) == int(want.box) and got.tall == want.tall and got.facing == _v(want.facing), "couvert %d face à %s" % [k, entry.threat])
