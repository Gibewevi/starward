extends Node
## The game's frame: the 3D world drawn small and enlarged to the window with
## the nearest pixel (true pixel art, not a filter — `pixel_size` screen pixels
## to a pixel), the HUD at full resolution above it. In the world: the lab, its
## light and air (the web version's cold studio light, ACES tone mapping,
## bloom on what glows, a little fog), the Jedi, the squad of stormtroopers
## (Battle), the iso camera.
##
## A frame of it can be written to a PNG for checking:
##   godot --path godot -- --screenshot=<file> [--frames=<n>] [--autopilot=<x>,<y>[,sprint]]
##     [--press=<seconds>:<action>,…]  (attack, guard, dash, twirl, force_pull, force_push;
##       <seconds>:hold:<action> … <seconds>:release:<action> keeps it down in between)
##     [--at=<x>,<z>[,<heading>]]  (where the hero starts)
##     [--clear=<seconds>]  (the whole squad struck down then: the escort comes in)
##     [--view=<metres>]  (the view's height, 5 to 12: closer for a look at the hero)
##     [--grenade=<seconds>:<x>:<z>,…]  (a grenade thrown then at that spot, its fuse 1.6 s)
##     [--blast=<seconds>:<x>:<z>,…]  (a blast then, right there)
##     [--mortal]  (god mode off: a bolt or a blast kills him)

@export var pixel_size := 4

var viewport: SubViewport
var world: Node3D
var level: LabLevel
var hero: Hero
var battle: Battle
var camera: CameraRig
var strip: OmniLight3D
var key: DirectionalLight3D
var rim: DirectionalLight3D
var environment: Environment
var _shot := ""
var _frames := 0
var _frames_left := 90
var _autopilot := ""
var _presses := ""
var _view := 0.0
var _at := ""
var _clear := INF
var _grenades: Array = []
var _mortal := false
var _states := {}
var _moves := {}
var _trail_peak := 0
var _process_sum := 0.0
var _process_worst := 0.0


func _ready() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--screenshot="):
			_shot = argument.get_slice("=", 1)
		elif argument.begins_with("--frames="):
			_frames_left = int(argument.get_slice("=", 1))
		elif argument.begins_with("--autopilot="):
			_autopilot = argument.get_slice("=", 1)
		elif argument.begins_with("--view="):
			_view = float(argument.get_slice("=", 1))
		elif argument.begins_with("--press="):
			_presses = argument.get_slice("=", 1)
		elif argument.begins_with("--at="):
			_at = argument.get_slice("=", 1)
		elif argument.begins_with("--clear="):
			_clear = float(argument.get_slice("=", 1))
		elif argument.begins_with("--grenade=") or argument.begins_with("--blast="):
			for throw in argument.get_slice("=", 1).split(",", false):
				var parts := throw.split(":")
				_grenades.append([float(parts[0]), float(parts[1]), float(parts[2]), argument.begins_with("--blast=")])
		elif argument == "--mortal":
			_mortal = true
	var container := SubViewportContainer.new()
	container.name = "Pixels"
	container.stretch = true
	container.stretch_shrink = pixel_size
	container.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	container.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(container)
	viewport = SubViewport.new()
	viewport.msaa_3d = Viewport.MSAA_DISABLED
	viewport.positional_shadow_atlas_size = 2048
	container.add_child(viewport)
	world = Node3D.new()
	world.name = "World"
	viewport.add_child(world)
	_build_light()
	level = LabLevel.new()
	level.name = "Lab"
	world.add_child(level)
	hero = Hero.new()
	hero.name = "Hero"
	world.add_child(hero)
	hero.obstacles = level.obstacles
	# A check plays by itself: a pad left lying on its trigger must not play along.
	hero.manual = _shot.is_empty()
	if not _autopilot.is_empty():
		var parts := _autopilot.split(",")
		hero.autopilot = Vector2(float(parts[0]), float(parts[1]))
		hero.autopilot_sprint = parts.size() > 2
	for press in _presses.split(",", false):
		var at := press.find(":")
		hero.autopilot_presses[float(press.substr(0, at))] = press.substr(at + 1)
	camera = CameraRig.new()
	camera.name = "Camera"
	camera.target = hero
	world.add_child(camera)
	camera.current = true
	hero.camera = camera
	battle = Battle.new(hero, level, camera)
	world.add_child(battle)
	battle.god_mode = not _mortal
	battle.light_room({ "environment": environment, "key": key, "rim": rim, "strip": strip })
	battle.death_screen = DeathScreen.new()
	add_child(battle.death_screen)
	if not _at.is_empty():
		var parts := _at.split(",")
		hero.place(float(parts[0]), float(parts[1]), float(parts[2]) if parts.size() > 2 else NAN)
		camera.focus = hero.position + Vector3(0, 0.6, 0)
	if _view > 0.0:
		camera.desired_height = _view
		camera.view_height = _view


## The lab's cold light, as lighting.js: a key light casting the shadows, a rim from behind, a blue-violet ambient.
func _build_light() -> void:
	environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("101722")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("5a6c8c")
	environment.ambient_light_energy = 0.55
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_exposure = 1.2
	environment.glow_enabled = true
	environment.glow_intensity = 0.6
	environment.glow_bloom = 0.0
	environment.glow_hdr_threshold = 1.15
	# A tight halo round what glows (the web's bloom has a small radius): the finest levels only.
	for level in 7:
		environment.set_glow_level(level, [1.0, 0.6, 0.15, 0.0, 0.0, 0.0, 0.0][level])
	environment.fog_enabled = true
	environment.fog_light_color = Color("111722")
	environment.fog_density = 0.012
	var env_node := WorldEnvironment.new()
	env_node.environment = environment
	world.add_child(env_node)
	key = DirectionalLight3D.new()
	key.name = "Key light"
	key.light_color = Color("dce6ff")
	key.light_energy = 1.25
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 30.0
	world.add_child(key)
	key.look_at_from_position(Vector3(-3, 7, 5), Vector3.ZERO, Vector3.UP)
	rim = DirectionalLight3D.new()
	rim.name = "Rim light"
	rim.light_color = Color("97abe0")
	rim.light_energy = 0.6
	world.add_child(rim)
	rim.look_at_from_position(Vector3(2, 3, -5), Vector3.ZERO, Vector3.UP)
	# The studio strip over the hero (lighting.js's white RectAreaLight, which follows him): his fill light.
	strip = OmniLight3D.new()
	strip.name = "Studio strip"
	strip.light_color = Color("d9dcec")
	strip.light_energy = 2.6
	strip.omni_range = 6.0
	strip.omni_attenuation = 1.2
	world.add_child(strip)


func _process(_delta: float) -> void:
	# The studio strip keeps above the hero, a little to the side (a broad strip in the web version, a lamp near him here).
	strip.position = hero.position + Vector3(-1.4, 3.2, 0.8)
	if hero.time >= _clear:
		_clear = INF
		battle.clear_room()
	for throw in _grenades.duplicate():
		if hero.time >= throw[0]:
			_grenades.erase(throw)
			if throw[3]:
				battle.detonate(Vector3(throw[1], 0, throw[2]))
			else:
				battle.grenade_at(throw[1], throw[2])
	if _shot.is_empty():
		return
	_frames += 1
	var spent := Performance.get_monitor(Performance.TIME_PROCESS)
	_process_sum += spent
	_process_worst = maxf(_process_worst, spent)
	# What the check went through: the moves played, the longest trail.
	_trail_peak = maxi(_trail_peak, hero.trail.samples.size())
	if hero.action.name != null:
		_moves[hero.action.name] = true
	for trooper: Stormtrooper in battle.troopers:
		_states[trooper.state()] = true
	if _frames == _frames_left:
		print("%d images par seconde" % Engine.get_frames_per_second())
		print("traitement : %.1f ms par image en moyenne, %.1f ms au pire" % [_process_sum * 1000.0 / _frames, _process_worst * 1000.0])
		print("%.1f s — coups joués : %s ; traînée jusqu’à %d échantillons ; héros en (%.2f ; %.2f)" % [hero.time, ", ".join(_moves.keys()), _trail_peak, hero.motion.x, hero.motion.z])
		print("héros : %s%s ; grenades : %d ; explosions : %d ; débris : %d (%d en mouvement) ; brûlures : %d ; entailles : %d ; empreintes : %d ; blessures : %d" % [
			battle.knockdown.phase() if battle.knockdown.active() else "debout", " (mort)" if battle.death != null else "",
			battle.grenades.live().size(), battle.explosions.active(), battle.debris.bodies.size(), battle.debris.awake(), battle.marks.count(),
			battle.scars.scars(), battle.prints.count(), battle.wounds.count()])
		print("escouade : %s ; états vus : %s ; états : %s ; %d tirs ; coupés : %s" % [
			", ".join(battle.squad.minds.map(func(mind: Dictionary) -> String: return "%s/%s" % [mind.mode, mind.tactic])),
			", ".join(_states.keys()), ", ".join(battle.troopers.map(func(t: Stormtrooper) -> String: return t.state())), battle.shots_fired,
			", ".join(battle.troopers.map(func(t: Stormtrooper) -> String: return ",".join(t.severed.keys())).filter(func(text: String) -> bool: return not text.is_empty()))])
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot)
		get_tree().quit()
