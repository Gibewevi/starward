extends Node
## The game's frame: the 3D world drawn small and enlarged to the window with
## the nearest pixel (true pixel art, not a filter — `pixel_size` screen pixels
## to a pixel), the HUD at full resolution above it. In the world: the stage,
## its light and air (the web version's cold studio light, ACES tone mapping,
## bloom on what glows, a little fog), the Jedi, the squad of stormtroopers
## (Battle), the iso camera.
##
## Two stages: the lab (stage 1) and the marsh ruins (stage 2, JungleLevel):
## a wider view in finer pixels, by day or by night (at random, or as asked:
## --night=1, --night=0), the jungle closing in at the edges of the view.
## The main menu (StageMenu) opens first, the game waiting under it; Escape
## brings it back. Picking the stage being played starts it (again); picking
## the other builds it (the scene is loaded anew, straight into the game).
## The keys 1 and 2 switch stage too; --stage=jungle starts in the marsh.
## A check (--screenshot) skips the menu.
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
##     [--stage=jungle] [--night=<0|1>]  (the marsh ruins, by day or by night)
##     [--menu]  (the main menu over it)
##     [--soak]  (an endurance fight: the hero goes for the nearest man and strikes, blasts now and
##       then, the squad cut down and replaced; every 15 s, how fast it runs and what has piled up)

@export var pixel_size := 4

## The stage played (kept when the game starts again on another one): "lab" or "jungle"; and the jungle's night ("": at random).
static var stage := ""
static var night_asked := ""
## Coming back from a switch of stage: straight into the game, no menu.
static var skip_menu := false

var viewport: SubViewport
var world: Node3D
var level  ## LabLevel or JungleLevel
var jungle: JungleLevel
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
var _menu: StageMenu
## For checks: the menu shown in the picture (--menu).
var _show_menu := false
## The endurance fight (--soak): its clocks, and the window measured since the last report.
var _soak := false
var _soak_strike := 0.0
var _soak_blast := 6.0
var _soak_clear := 40.0
var _soak_window := { "frames": 0, "process": 0.0, "real": 0.0 }
var _soak_report := 0.0
## A stage started from the menu (picking it again starts it over).
var _playing := false
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
		elif argument == "--menu":
			_show_menu = true
		elif argument == "--soak":
			_soak = true
		elif argument.begins_with("--stage=") and stage.is_empty():
			stage = argument.get_slice("=", 1)
		elif argument.begins_with("--night=") and night_asked.is_empty():
			night_asked = argument.get_slice("=", 1)
	if stage.is_empty():
		stage = "lab"
	# The jungle: finer pixels, a wider view.
	if stage == "jungle":
		pixel_size = 2
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
	if stage == "jungle":
		var dark := randf() < 0.5 if night_asked.is_empty() else night_asked != "0"
		jungle = JungleLevel.new(dark)
		level = jungle
		world.add_child(level)
		_light_jungle(dark)
	else:
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
	if jungle:
		battle.objectives = Objectives.new(pixel_size)
		add_child(battle.objectives)
		var start: Dictionary = jungle.start
		hero.home = { "x": float(start.x), "z": float(start.z), "heading": float(start.heading) }
		hero.restart()
		camera.stage_offset = Vector3(-1.8, 0, -2.3)
		camera.focus = hero.position + camera.stage_offset + Vector3(0, 0.6, 0)
		camera.desired_height = 12.0
		camera.view_height = 12.0
		_vignette()
	if not _at.is_empty():
		var parts := _at.split(",")
		hero.place(float(parts[0]), float(parts[1]), float(parts[2]) if parts.size() > 2 else NAN)
		camera.focus = hero.position + Vector3(0, 0.6, 0)
	if _view > 0.0:
		camera.desired_height = _view
		camera.view_height = _view
	if _shot.is_empty() or _show_menu:
		# A check of the menu still counts its frames under it.
		if not _shot.is_empty():
			process_mode = Node.PROCESS_MODE_ALWAYS
		_menu = StageMenu.new(1 if jungle else 0)
		_menu.started.connect(_on_stage)
		add_child(_menu)
		if skip_menu:
			skip_menu = false
			_menu.visible = false
			_menu.is_open = false
			_playing = true
		else:
			_menu.open()


## The stage picked in the menu: this one starts (again); the other is built.
func _on_stage(number: int) -> void:
	var wanted := "jungle" if number == 2 else "lab"
	if wanted != stage:
		stage = wanted
		night_asked = ""
		skip_menu = true
		get_tree().reload_current_scene()
		return
	if _playing:
		battle.restart()
	_playing = true


func _unhandled_input(event: InputEvent) -> void:
	# Escape: back to the menu (the game waits under it).
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE and _menu and not _menu.is_open:
		_menu.open()
		get_viewport().set_input_as_handled()
		return
	# 1, 2: the lab, the marsh ruins (the game starts again on it).
	if event is InputEventKey and event.pressed and not event.echo and _shot.is_empty():
		var wanted: String = { KEY_1: "lab", KEY_2: "jungle" }.get(event.physical_keycode, "")
		if not wanted.is_empty() and wanted != stage:
			stage = wanted
			night_asked = ""
			skip_menu = true
			get_tree().reload_current_scene()


## Night under the canopy, from the lab's lighting (jungle.js's jungleLighting): dark, the light where it
## burns — a cold moon picking out the edges, a dim blue-green sky, earth below; the ruins' amber lamps, the
## blade and the blasts provide local colour. By day, a damp blue-grey dusk.
func _light_jungle(dark: bool) -> void:
	environment.background_color = Color("020406") if dark else Color("061015")
	environment.fog_light_color = Color("04080b") if dark else Color("0c1c22")
	environment.fog_density = 0.018 if dark else 0.0105
	# The web's sky light goes from 1.4 to these; its key from 3.5, its rim from 1.65, its strip from 3.3.
	environment.ambient_light_color = Color("2b3a58") if dark else Color("668892")
	environment.ambient_light_energy = 0.55 * (0.42 if dark else 1.15) / 1.4
	key.light_color = Color("7d95c4") if dark else Color("a9bfdc")
	key.light_energy = 1.25 * (0.5 if dark else 3.1) / 3.5
	key.directional_shadow_max_distance = 40.0
	rim.light_color = Color("6b9693")
	rim.light_energy = 0.6 * (0.3 if dark else 0.8) / 1.65
	strip.light_color = Color("9fc2c8")
	strip.light_energy = 2.6 * (0.2 if dark else 0.7) / 3.3


## The jungle closes in at the edges of the view.
func _vignette() -> void:
	var layer := CanvasLayer.new()
	layer.name = "Vignette"
	layer.layer = 1
	var veil := ColorRect.new()
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var material := ShaderMaterial.new()
	var shader := Shader.new()
	shader.code = "shader_type canvas_item;\nuniform float strength = 0.42;\nvoid fragment() {\n\tfloat d = length((UV - 0.5) * vec2(1.15, 1.0));\n\tCOLOR = vec4(0.0, 0.0, 0.0, strength * smoothstep(0.3, 0.8, d));\n}\n"
	material.shader = shader
	veil.material = material
	layer.add_child(veil)
	add_child(layer)


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
	if _soak:
		_soak_step(_delta)
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


## The endurance fight: the hero walks to the nearest man standing and strikes; a blast by him now and then;
## when few are left, all are cut down (the next ones come in). Every 15 s of real time: what it costs.
func _soak_step(delta: float) -> void:
	var here := Vector3(hero.motion.x, 0, hero.motion.z)
	var nearest: Stormtrooper = null
	for trooper: Stormtrooper in battle.troopers:
		if trooper.dead or trooper.fallen:
			continue
		if nearest == null or Battle.where_is(trooper).distance_to(here) < Battle.where_is(nearest).distance_to(here):
			nearest = trooper
	hero.autopilot = Vector2.ZERO
	if nearest:
		var to := Battle.where_is(nearest) - here
		if to.length() > 1.6:
			var d := Vector2(to.x, to.z).normalized()
			hero.autopilot = Vector2(d.dot(Hero.INPUT_RIGHT), d.dot(Hero.INPUT_FORWARD))
	_soak_strike -= delta
	if _soak_strike <= 0.0:
		_soak_strike = 0.35
		hero.autopilot_presses[hero.time + 0.001] = "attack"
	_soak_blast -= delta
	if _soak_blast <= 0.0:
		_soak_blast = 12.0
		battle.detonate(here + Vector3(randf_range(-2.5, 2.5), 0, randf_range(-2.5, 2.5)))
	_soak_clear -= delta
	var standing := battle.troopers.filter(func(t: Stormtrooper) -> bool: return not t.dead).size()
	if _soak_clear <= 0.0 or standing == 0:
		_soak_clear = 40.0
		battle.clear_room()
	_soak_window.frames += 1
	_soak_window.process += Performance.get_monitor(Performance.TIME_PROCESS)
	_soak_window.real += delta
	_soak_report += delta
	if _soak_report >= 15.0:
		_soak_report = 0.0
		var w: Dictionary = _soak_window
		print("[%4.0f s] %5.1f img/s ; calcul %5.1f ms ; nœuds %d ; objets %d ; troopers %d (%d debout) ; particules %d ; gouttes %d ; débris %d ; brûlures %d ; entailles %d ; empreintes %d ; tirs en vol %d ; dessins %d ; objets dessinés %d" % [
			Time.get_ticks_msec() / 1000.0, w.frames / maxf(w.real, 1e-3), w.process * 1000.0 / maxi(w.frames, 1),
			Performance.get_monitor(Performance.OBJECT_NODE_COUNT), Performance.get_monitor(Performance.OBJECT_COUNT),
			battle.troopers.size(), standing, battle.effects.live(), battle.effects.red().lying, battle.debris.bodies.size(),
			battle.marks.count(), battle.scars.scars(), battle.prints.count(), battle.blasters.live.size(),
			Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)])
		_soak_window = { "frames": 0, "process": 0.0, "real": 0.0 }
