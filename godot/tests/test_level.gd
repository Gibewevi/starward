extends TestCase
## The lab's baked obstacles keep the hero out of the crates, as lab.js does;
## the baked room loads with its lights and glowing strips.

func test_a_walker_is_pushed_out_of_a_crate() -> void:
	var obstacles := Obstacles.new([{ "kind": "crate", "min": [0, 0, 0], "max": [1, 1, 1] }])
	var outside := obstacles.push_out(Vector3(1.1, 0, 0.5), 0.3)
	near(outside.x, 1.3, 1e-6, "repoussé hors du flanc")
	var inside := obstacles.push_out(Vector3(0.9, 0, 0.5), 0.3)
	near(inside.x, 1.3, 1e-6, "sorti par le côté le plus proche")
	var free := obstacles.push_out(Vector3(3, 0, 3), 0.3)
	check(free == Vector3(3, 0, 3), "loin de la caisse, rien ne change")


func test_the_lab_is_baked_with_its_obstacles() -> void:
	var lab := data("lab.json")
	check(lab.obstacles.size() > 20, "des obstacles (%d)" % lab.obstacles.size())
	var scene: PackedScene = load("res://assets/baked/lab.glb")
	check(scene != null, "lab.glb s'importe")
	if scene:
		var room := scene.instantiate()
		check(room.find_children("*", "MeshInstance3D", true, false).size() > 20, "des maillages")
		check(room.find_children("*", "Light3D", true, false).size() > 0, "ses lumières")
		room.free()


func test_the_hero_stays_out_of_every_lab_crate() -> void:
	var obstacles := Obstacles.new(data("lab.json").obstacles)
	for box in obstacles.boxes:
		if box.min.y > 1.2:
			continue
		var centre: Vector3 = (box.min + box.max) * 0.5
		var out := obstacles.push_out(Vector3(centre.x, 0, centre.z), 0.3)
		var inside: bool = out.x > box.min.x and out.x < box.max.x and out.z > box.min.z and out.z < box.max.z
		check(not inside, "sorti de %s" % box.kind)
