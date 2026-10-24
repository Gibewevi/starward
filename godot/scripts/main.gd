extends Node
## The game's frame: the 3D world drawn small and enlarged to the window with
## the nearest pixel (true pixel art, not a filter — `pixel_size` screen pixels
## to a pixel), the HUD at full resolution above it. In the world: the lab, its
## light and air (the web version's cold studio light, ACES tone mapping,
## bloom on what glows, a little fog), the Jedi, the iso camera.
##
## A frame of it can be written to a PNG for checking:
##   godot --path godot -- --screenshot=<file> [--frames=<n>] [--autopilot=<x>,<y>[,sprint]]

@export var pixel_size := 4

var viewport: SubViewport
var world: Node3D
var level: LabLevel
var hero: Hero
var camera: CameraRig
var strip: OmniLight3D
var _shot := ""
var _frames := 0
var _frames_left := 90
var _autopilot := ""


func _ready() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--screenshot="):
			_shot = argument.get_slice("=", 1)
		elif argument.begins_with("--frames="):
			_frames_left = int(argument.get_slice("=", 1))
		elif argument.begins_with("--autopilot="):
			_autopilot = argument.get_slice("=", 1)
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
	if not _autopilot.is_empty():
		var parts := _autopilot.split(",")
		hero.autopilot = Vector2(float(parts[0]), float(parts[1]))
		hero.autopilot_sprint = parts.size() > 2
	camera = CameraRig.new()
	camera.name = "Camera"
	camera.target = hero
	world.add_child(camera)
	camera.current = true


## The lab's cold light, as lighting.js: a key light casting the shadows, a rim from behind, a blue-violet ambient.
func _build_light() -> void:
	var environment := Environment.new()
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
	var key := DirectionalLight3D.new()
	key.name = "Key light"
	key.light_color = Color("dce6ff")
	key.light_energy = 1.25
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 30.0
	world.add_child(key)
	key.look_at_from_position(Vector3(-3, 7, 5), Vector3.ZERO, Vector3.UP)
	var rim := DirectionalLight3D.new()
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
	if _shot.is_empty():
		return
	_frames += 1
	if _frames >= _frames_left:
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot)
		get_tree().quit()
