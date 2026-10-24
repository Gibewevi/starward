extends TestCase
## Stage 2, the marsh ruins (scripts/jungle/): the map baked from the web
## loads whole — its ruins and generators, its obstacles and gate, its plants
## and stones; the water lies where the web's does, the walkways' decks over
## it; a blast digs a crater and tears up the plants there; the blade cuts the
## plants it sweeps through; the hero is harder to see in the reeds and wading.


func _level() -> JungleLevel:
	var level := JungleLevel.new(false)
	tree.root.add_child(level)
	return level


func test_the_marsh_is_baked_whole() -> void:
	var map := data("jungle.json")
	check(map.obstacles.size() > 60, "des obstacles (%d)" % map.obstacles.size())
	check(map.generators.size() == 4, "quatre générateurs")
	var level := _level()
	var specs := level.generator_specs()
	check(specs.size() == 4, "quatre générateurs prêts")
	for spec in specs:
		check(spec.room != null and spec.room.find_child("Transformer*", true, false) != null, "le générateur %s a son modèle" % spec.name)
	check(level.door != null and level.obstacles.has(level.door.shut), "la piste est fermée au départ")
	check(level.posts.size() == 15, "15 postes (%d)" % level.posts.size())
	var plants := level.vegetation.counts()
	var total := 0
	for kind in plants:
		total += plants[kind].plants
	check(total > 12000, "les plantes (%d)" % total)
	check(level.lamps.size() > 30, "les lampes (%d)" % level.lamps.size())
	level.free()


func test_the_water_and_the_walkways() -> void:
	var level := _level()
	var start: Dictionary = level.start
	check(level.water.depth(start.x, start.z) == 0.0, "le départ est au sec")
	check(level.water.depth(0.5, 0.5) == 0.0, "l'île centrale est au sec")
	# Between the entry and the centre: marsh, crossed by the main walkway.
	check(level.water.depth(7.5, 7.5) > 0.3, "le marais entre l'entrée et le centre")
	check(not is_nan(level.deck_at(7.5, 7.5)), "la passerelle au-dessus")
	check(is_nan(level.deck_at(9.0, 6.0)), "à côté de la passerelle, pas de planches")
	check(level.in_water(Vector3(9.0, 0, 6.0)), "à côté, on patauge")
	check(not level.in_water(Vector3(7.5, 0, 7.5)), "sur la passerelle, on est au sec")
	near(level.ground_at(7.5, 7.5), 0.06, 1e-6, "le pont de la passerelle")
	level.free()


func test_a_blast_digs_a_crater_and_tears_up_the_plants() -> void:
	var level := _level()
	var at := Vector3(-20.5, 0, 20.5)
	var before := 0
	for counts in level.vegetation.counts().values():
		before += counts.cut
	near(level.ground_at(at.x + 0.6, at.z), 0.0, 1e-6, "le sol intact")
	var radius := level.blast(at, 1.0, 5.0)
	check(radius > 1.0, "un cratère de plus d'un mètre (%.2f)" % radius)
	check(level.ground_at(at.x + 0.6, at.z) < -0.05, "le sol creusé (%.3f)" % level.ground_at(at.x + 0.6, at.z))
	var after := 0
	for counts in level.vegetation.counts().values():
		after += counts.cut
	check(after > before, "des plantes arrachées (%d)" % (after - before))
	level.reset()
	near(level.ground_at(at.x + 0.6, at.z), 0.0, 1e-6, "rebouché à la relance")
	level.free()


func test_the_blade_cuts_the_plants_it_sweeps() -> void:
	var level := _level()
	# A low, fast sweep through the thick of the jungle by the map's edge.
	var cut := 0
	for k in 12:
		var x := -21.0 + k * 0.6
		cut += level.vegetation.cut(Vector3(x, 0.15, 20.0), Vector3(x, 0.15, 21.4), Vector3(x + 0.6, 0.15, 20.0), Vector3(x + 0.6, 0.15, 21.4), 12.0)
	check(cut > 10, "des plantes coupées (%d)" % cut)
	check(level.vegetation.cut(Vector3(0, 0.15, 20), Vector3(0, 0.15, 21), Vector3(0.6, 0.15, 20), Vector3(0.6, 0.15, 21), 2.0) == 0, "trop lent, rien n'est coupé")
	level.free()


func test_the_hero_hides_in_the_reeds_and_the_water() -> void:
	var level := _level()
	near(level.seen(Vector3(0.5, 0, 0.5)), 1.0, 0.2, "à découvert sur la place")
	var hidden := 1.0
	for x in range(-20, 20):
		for z in range(-20, 20):
			hidden = minf(hidden, level.seen(Vector3(x, 0, z)))
	check(hidden < 0.75, "quelque part, le couvert le cache (%.2f)" % hidden)
	level.free()
