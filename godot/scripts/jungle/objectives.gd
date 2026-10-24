class_name Objectives
extends CanvasLayer
## The jungle's objective on screen (main.js's): the generators destroyed,
## and a marker for each one left — over it in view, at the screen's edge
## pointing to it out of view. Once the last is blown and the trail is quiet:
## "VICTOIRE". Full resolution, above the pixel view.

var pixel_size := 4
var _title: Label
var _count: Label
var _markers: Array[Control] = []
var _victory: CenterContainer
var _pop := 0.0


func _init(size: int = 4) -> void:
	name = "Objectives"
	layer = 2
	pixel_size = size
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	box.position = Vector2(-120, 32)
	box.custom_minimum_size = Vector2(240, 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(box)
	_title = _label("GÉNÉRATEURS", 11, Color8(0xff, 0x8a, 0x6a))
	box.add_child(_title)
	_count = _label("", 20, Color8(0xf1, 0xe4, 0xd8))
	box.add_child(_count)
	_victory = CenterContainer.new()
	_victory.set_anchors_preset(Control.PRESET_FULL_RECT)
	_victory.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_victory.visible = false
	add_child(_victory)
	var card := VBoxContainer.new()
	card.add_theme_constant_override("separation", 18)
	_victory.add_child(card)
	card.add_child(_label("VICTOIRE", 76, Color8(0xbf, 0xe6, 0xff)))
	card.add_child(_label("L3 / T    REJOUER", 12, Color8(0xd6, 0xe8, 0xf6)))


func _label(text: String, size: int, colour: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", colour)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	label.add_theme_constant_override("shadow_outline_size", 6)
	return label


## The count, a little burst when a generator goes.
func pop() -> void:
	_pop = 0.6


func _marker(index: int) -> Control:
	while _markers.size() <= index:
		var marker := Control.new()
		marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var diamond := Panel.new()
		var style := StyleBoxFlat.new()
		style.bg_color = Color8(0x1a, 0x0a, 0x06, 0xcc)
		style.border_color = Color8(0xff, 0x7a, 0x3a)
		style.set_border_width_all(2)
		diamond.add_theme_stylebox_override("panel", style)
		diamond.size = Vector2(18, 18)
		diamond.position = Vector2(-9, -9)
		diamond.pivot_offset = Vector2(9, 9)
		diamond.rotation = PI / 4.0
		marker.add_child(diamond)
		var number := _label(str(_markers.size() + 1), 11, Color.WHITE)
		number.position = Vector2(-10, -9)
		number.size = Vector2(20, 18)
		marker.add_child(number)
		add_child(marker)
		_markers.append(marker)
	return _markers[index]


func update(delta: float, generators: Array, course: Dictionary, camera: Camera3D) -> void:
	var won: bool = course.stage == "won"
	_count.text = "%d / %d DÉTRUITS" % [course.destroyed, generators.size()]
	_pop = maxf(0.0, _pop - delta)
	_count.add_theme_color_override("font_color", Color.WHITE.lerp(Color8(0xf1, 0xe4, 0xd8), 1.0 - _pop / 0.6) if _pop > 0.0 else Color8(0xf1, 0xe4, 0xd8))
	_title.visible = not won
	_count.visible = not won
	_victory.visible = won and course.clock > 2.4
	var screen := get_viewport().get_visible_rect().size
	var margin := 34.0
	for index in generators.size():
		var t: Transformer = generators[index]
		var marker := _marker(index)
		marker.visible = not won and t.state == "ready" and camera.is_inside_tree()
		if not marker.visible:
			continue
		var world := t.socket + Vector3(0, 2.6, 0)
		var at := camera.unproject_position(world) * pixel_size
		var behind := camera.is_position_behind(world)
		var inside := not behind and at.x > margin and at.x < screen.x - margin and at.y > margin + 60.0 and at.y < screen.y - margin
		if not inside:
			# Along the line from the screen's centre, stopped at its edge (below the count at the top).
			var d := at - screen / 2.0
			var k := minf((screen.x / 2.0 - margin) / maxf(absf(d.x), 1e-3), (screen.y / 2.0 - margin - (60.0 if d.y < 0.0 else 0.0)) / maxf(absf(d.y), 1e-3))
			at = screen / 2.0 + d * k
		marker.position = at
		marker.modulate.a = 0.75 if not inside else 1.0
