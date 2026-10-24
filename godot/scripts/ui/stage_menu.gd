class_name StageMenu
extends CanvasLayer
## The main menu: picking the stage (port of src/stage-menu.js and its page in
## index.html). A small arcade cabinet: hard edges, a bitmap type of its own
## (PixelText), the two stages' illustrations — the selected one lit, lifted,
## its art closer, a cursor blinking by its name, a light sweeping it, sparks
## rising —, what it is about, and how to start it.
##
## ←/→ (or the stick, the pad's cross) choose, Enter or Space (A, Start)
## confirm, the mouse points and clicks; F toggles full screen. The game
## waits under it (paused) and the choice is reported by `started` (1 or 2),
## after a short flash.

signal started(number: int)

const AMBER := Color("ffbd70")
const EDGE := Color("415970")
const EDGE_SELECTED := Color("ffb961")
const TEXT := Color("d2deeb")
const DESCRIPTIONS := ["Infiltrez le hangar. Affrontez l’escouade impériale.", "Ruines du marais. Détruisez les quatre générateurs."]

var selected := 0
var is_open := true
var _launching := 0.0
var _font: SystemFont
var _root: Control
var _cards: Array[Dictionary] = []
var _description: Label
var _led: ColorRect
var _clock := 0.0
var _pad_ready := false
var _pad_direction := 0
var _pad_confirm := false
var _repeat_at := 0.0


func _init(initial: int = 0) -> void:
	name = "Stage menu"
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS
	selected = initial
	_font = SystemFont.new()
	_font.font_names = PackedStringArray(["Courier New", "Consolas", "monospace"])
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_root)
	_build()
	_select(selected)


func _text(text: String, size: int, colour: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_override("font", _font)
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", colour)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _rect(colour: Color, size: Vector2 = Vector2.ZERO) -> ColorRect:
	var rect := ColorRect.new()
	rect.color = colour
	rect.custom_minimum_size = size
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


func _build() -> void:
	# The cabinet: a dark screen, a warm and a cold glow, a frame, two rails, scanlines.
	var back := _rect(Color("03080e"))
	back.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(back)
	for glow in [[Vector2(0.5, 0.32), Color("111e2c"), 0.65], [Vector2(0.15, 0.62), Color("a7511720"), 0.32], [Vector2(0.83, 0.6), Color("1c67862c"), 0.38]]:
		var gradient := Gradient.new()
		gradient.set_color(0, glow[1])
		gradient.set_color(1, Color(glow[1], 0.0))
		var texture := GradientTexture2D.new()
		texture.gradient = gradient
		texture.fill = GradientTexture2D.FILL_RADIAL
		texture.fill_from = glow[0]
		texture.fill_to = glow[0] + Vector2(glow[2], 0)
		var light := TextureRect.new()
		light.texture = texture
		light.set_anchors_preset(Control.PRESET_FULL_RECT)
		light.stretch_mode = TextureRect.STRETCH_SCALE
		light.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		light.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_root.add_child(light)
	var chassis := Chassis.new()
	chassis.set_anchors_preset(Control.PRESET_FULL_RECT)
	chassis.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(chassis)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 96)
	margin.add_theme_constant_override("margin_top", 28)
	margin.add_theme_constant_override("margin_bottom", 26)
	_root.add_child(margin)
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(column)
	# The top line.
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(_text("CAMPAGNE / 01", 10, Color("5e768c")))
	var spring := Control.new()
	spring.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(spring)
	_led = _rect(Color("81b9b0"), Vector2(4, 4))
	_led.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	top.add_child(_led)
	top.add_child(_text("  SYSTÈME EN LIGNE", 10, Color("5e768c")))
	column.add_child(top)
	column.add_child(_gap(18))
	# The heading: the ship, the name, the rule, the caption.
	var brand := HBoxContainer.new()
	brand.alignment = BoxContainer.ALIGNMENT_CENTER
	brand.add_theme_constant_override("separation", 26)
	brand.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ship := Ship.new()
	ship.custom_minimum_size = Vector2(37, 57)
	ship.mouse_filter = Control.MOUSE_FILTER_IGNORE
	brand.add_child(ship)
	brand.add_child(PixelText.label("STARWARD", 72, Color("eaf3ff"), 3))
	column.add_child(brand)
	var rule := HBoxContainer.new()
	rule.alignment = BoxContainer.ALIGNMENT_CENTER
	rule.add_theme_constant_override("separation", 10)
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for part in [[Color("587890"), 38.0], [Color("e82a41"), 58.0], [Color("e82a41"), 104.0], [Color("e82a41"), 58.0], [Color("587890"), 38.0]]:
		rule.add_child(_rect(part[0], Vector2(part[1], 3)))
	column.add_child(_gap(16))
	column.add_child(rule)
	column.add_child(_gap(14))
	var caption := _text("———   SÉLECTION DU STAGE   ———", 10, Color("7c96ae"))
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(caption)
	column.add_child(_gap(24))
	# The two stages.
	var grid := HBoxContainer.new()
	grid.add_theme_constant_override("separation", 28)
	grid.size_flags_vertical = Control.SIZE_EXPAND_FILL
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(grid)
	_cards.append(_card(grid, 0, "res://assets/ui/menu/stage-1-interior.png", "STAGE 1", "INTÉRIEUR", "01", "HANGAR IMPÉRIAL", "JOUABLE"))
	_cards.append(_card(grid, 1, "res://assets/ui/menu/stage-2-jungle.png", "STAGE 2", "JUNGLE", "02", "RUINES DU MARAIS", "JOUABLE"))
	column.add_child(_gap(20))
	# What it is, and how to start it.
	_description = _text("", 11, Color("7a91a6"))
	_description.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_description)
	column.add_child(_gap(14))
	var confirm := Button.new()
	confirm.focus_mode = Control.FOCUS_NONE
	confirm.custom_minimum_size = Vector2(250, 48)
	confirm.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var frame := StyleBoxFlat.new()
	frame.bg_color = Color("101e2e")
	frame.border_color = Color("5f7e9880")
	frame.set_border_width_all(1)
	confirm.add_theme_stylebox_override("normal", frame)
	var lit: StyleBoxFlat = frame.duplicate()
	lit.bg_color = Color("251c14")
	lit.border_color = AMBER
	confirm.add_theme_stylebox_override("hover", lit)
	confirm.add_theme_stylebox_override("pressed", lit)
	confirm.pressed.connect(_activate)
	var inside := HBoxContainer.new()
	inside.alignment = BoxContainer.ALIGNMENT_CENTER
	inside.add_theme_constant_override("separation", 16)
	inside.set_anchors_preset(Control.PRESET_FULL_RECT)
	inside.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inside.add_child(_key("ENTRÉE"))
	inside.add_child(PixelText.label("CONFIRMER", 18, Color("bfdcf2")))
	var arrow := Arrow.new()
	arrow.custom_minimum_size = Vector2(6, 9)
	arrow.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	arrow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inside.add_child(arrow)
	confirm.add_child(inside)
	column.add_child(confirm)
	column.add_child(_gap(18))
	# The bottom line.
	var bottom := HBoxContainer.new()
	bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.add_child(_key("←"))
	bottom.add_child(_key("→"))
	bottom.add_child(_text("  CHOISIR  / STICK + A", 9, Color("5e758a")))
	var middle := Control.new()
	middle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	middle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.add_child(middle)
	bottom.add_child(_text("PLEIN ÉCRAN ", 9, Color("8b9fb2")))
	bottom.add_child(_key("F"))
	var end := Control.new()
	end.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	end.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.add_child(end)
	bottom.add_child(_text("STARWARD ◆ v.01", 8, Color("4a6074")))
	column.add_child(bottom)
	var lines := ColorRect.new()
	lines.set_anchors_preset(Control.PRESET_FULL_RECT)
	lines.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = "shader_type canvas_item;\nvoid fragment() {\n\tfloat line = mod(FRAGCOORD.y, 4.0) < 1.0 ? 1.0 : 0.0;\n\tCOLOR = vec4(0.0, 0.0, 0.0, line * 0.082 * 0.48);\n}\n"
	var material := ShaderMaterial.new()
	material.shader = shader
	lines.material = material
	_root.add_child(lines)


func _gap(height: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, height)
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


## A key cap: its name in a dark box.
func _key(text: String) -> PanelContainer:
	var box := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color("09121d")
	style.border_color = Color("516d86")
	style.set_border_width_all(1)
	style.content_margin_left = 6
	style.content_margin_right = 6
	style.content_margin_top = 3
	style.content_margin_bottom = 3
	box.add_theme_stylebox_override("panel", style)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	box.add_child(_text(text, 10, Color("9bbbd5")))
	return box


## A stage's card: its illustration (lit and drawn closer when selected), its name, its footer.
func _card(parent: Control, index: int, art_path: String, number: String, place: String, code: String, title: String, status: String) -> Dictionary:
	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.size_flags_vertical = Control.SIZE_EXPAND_FILL
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	var edge := StyleBoxFlat.new()
	edge.bg_color = EDGE
	edge.content_margin_left = 3
	edge.content_margin_right = 3
	edge.content_margin_top = 3
	edge.content_margin_bottom = 3
	edge.shadow_color = Color(1, 0.5, 0.11, 0.0)
	edge.shadow_size = 14
	card.add_theme_stylebox_override("panel", edge)
	parent.add_child(card)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 0)
	inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(inner)
	var viewport := Control.new()
	viewport.clip_contents = true
	viewport.size_flags_vertical = Control.SIZE_EXPAND_FILL
	viewport.custom_minimum_size = Vector2(0, 160)
	viewport.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inner.add_child(viewport)
	var art := TextureRect.new()
	art.texture = load(art_path)
	art.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	art.set_anchors_preset(Control.PRESET_FULL_RECT)
	art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport.add_child(art)
	# The shade at the top (the title reads over it), lighter at the bottom.
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array([0.0, 0.19, 0.24, 0.38, 0.58, 1.0])
	gradient.colors = PackedColorArray([Color("02060e"), Color("02060e"), Color("02060ebd"), Color("02060e30"), Color(0.008, 0.024, 0.055, 0.0), Color("02060e50")])
	var shade_texture := GradientTexture2D.new()
	shade_texture.gradient = gradient
	shade_texture.fill_from = Vector2(0, 0)
	shade_texture.fill_to = Vector2(0, 1)
	var shade := TextureRect.new()
	shade.texture = shade_texture
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport.add_child(shade)
	var sweep := _rect(Color(0.78, 0.92, 1.0, 0.0), Vector2(0, 2))
	sweep.anchor_right = 1.0
	viewport.add_child(sweep)
	var sparks := Sparks.new()
	sparks.anchor_left = 0.45
	sparks.anchor_top = 0.25
	sparks.anchor_right = 0.95
	sparks.anchor_bottom = 0.95
	sparks.mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport.add_child(sparks)
	var heading := VBoxContainer.new()
	heading.position = Vector2(29, 22)
	heading.add_theme_constant_override("separation", 7)
	heading.mouse_filter = Control.MOUSE_FILTER_IGNORE
	heading.add_child(PixelText.label(number, 36))
	heading.add_child(PixelText.label(place, 18, Color("a9c6dc")))
	viewport.add_child(heading)
	var cursor := Arrow.new()
	cursor.size = Vector2(10, 14)
	cursor.colour = Color("ffd394")
	cursor.mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport.add_child(cursor)
	var target := AimCorner.new()
	target.anchor_left = 1.0
	target.anchor_right = 1.0
	target.offset_left = -31
	target.offset_top = 17
	target.size = Vector2(14, 14)
	target.mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport.add_child(target)
	var footer := PanelContainer.new()
	var footer_style := StyleBoxFlat.new()
	footer_style.bg_color = Color("0a111c")
	footer_style.content_margin_left = 22
	footer_style.content_margin_right = 22
	footer_style.content_margin_top = 14
	footer_style.content_margin_bottom = 14
	footer.add_theme_stylebox_override("panel", footer_style)
	footer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var line := HBoxContainer.new()
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var code_label := _text(code + "  │  ", 10, Color("6f8399"))
	line.add_child(code_label)
	var title_label := _text(title, 10, Color("a1b5c8"))
	line.add_child(title_label)
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(fill)
	var status_label := _text(status + "  ", 9, Color("a5c2bc"))
	line.add_child(status_label)
	var dot := _rect(Color("9cc8b8"), Vector2(4, 4))
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(dot)
	footer.add_child(line)
	inner.add_child(footer)
	card.mouse_entered.connect(func() -> void: _select(index))
	card.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_select(index)
			_activate())
	return {
		"card": card, "edge": edge, "art": art, "viewport": viewport, "heading": heading, "cursor": cursor, "sweep": sweep, "sparks": sparks,
		"target": target, "footer": footer_style, "code": code_label, "title": title_label, "status": status_label, "dot": dot,
	}


func _select(index: int) -> void:
	if _launching > 0.0:
		return
	selected = (index + _cards.size()) % _cards.size()
	_description.text = DESCRIPTIONS[selected]


## Confirmed: a short flash, then the stage starts.
func _activate() -> void:
	if not is_open or _launching > 0.0:
		return
	_launching = 0.42


## Shown again (from the game): the game waits under it.
func open() -> void:
	is_open = true
	visible = true
	_launching = 0.0
	_pad_ready = false
	_root.modulate = Color.WHITE
	get_tree().paused = true
	# The mouse back for the menu (the view from his eyes had taken it).
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _close() -> void:
	is_open = false
	visible = false
	get_tree().paused = false
	started.emit(selected + 1)


func _input(event: InputEvent) -> void:
	if not is_open:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_LEFT, KEY_UP, KEY_A, KEY_Q, KEY_W, KEY_Z:
				_select(selected - 1)
			KEY_RIGHT, KEY_DOWN, KEY_D, KEY_S:
				_select(selected + 1)
			KEY_ENTER, KEY_KP_ENTER, KEY_SPACE:
				_activate()
			KEY_F:
				var window := get_window()
				window.mode = Window.MODE_WINDOWED if window.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
			_:
				return
		get_viewport().set_input_as_handled()
	elif event is InputEventJoypadButton or event is InputEventJoypadMotion:
		get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	if not is_open:
		return
	_clock += delta
	_pad()
	if _launching > 0.0:
		_launching -= delta
		var k := clampf(1.0 - _launching / 0.42, 0.0, 1.0)
		_root.modulate = Color(1, 1, 1, 1.0 - k).lightened(0.4 * (1.0 - absf(k * 2.0 - 1.0)))
		if _launching <= 0.0:
			_close()
	_led.modulate.a = 1.0 if fmod(_clock, 3.0) < 1.5 else 0.45
	for index in _cards.size():
		var card: Dictionary = _cards[index]
		var chosen := index == selected
		var edge: StyleBoxFlat = card.edge
		edge.bg_color = edge.bg_color.lerp(EDGE_SELECTED if chosen else EDGE, minf(1.0, delta * 12.0))
		edge.shadow_color = Color(1, 0.5, 0.11, 0.44 if chosen else 0.0)
		# The art: lit and drawn closer when selected (moving in pixel steps, as an attract screen).
		var art: TextureRect = card.art
		var viewport: Control = card.viewport
		var scale := 1.075 if chosen else 1.025
		if _launching > 0.0 and chosen:
			scale = 1.2
		art.pivot_offset = viewport.size / 2.0
		art.scale = Vector2.ONE * scale
		art.modulate = Color(1.04, 1.04, 1.04) if chosen else Color(0.62, 0.64, 0.66)
		(card.footer as StyleBoxFlat).bg_color = Color("17130f") if chosen else Color("0a111c")
		(card.code as Label).add_theme_color_override("font_color", Color("b18d63") if chosen else Color("6f8399"))
		(card.title as Label).add_theme_color_override("font_color", Color("ffe0ba") if chosen else Color("a1b5c8"))
		(card.status as Label).add_theme_color_override("font_color", Color("ffc78c") if chosen else Color("a5c2bc"))
		(card.dot as ColorRect).color = Color("ffbf74") if chosen else Color("9cc8b8")
		var heading: Control = card.heading
		heading.position.x = 40.0 if chosen else 29.0
		var cursor: Control = card.cursor
		cursor.visible = chosen and fmod(_clock, 0.85) < 0.425
		cursor.position = Vector2(16, heading.position.y + 12)
		(card.target as AimCorner).colour = Color("ffd496") if chosen else Color(0.47, 0.59, 0.67, 0.5)
		(card.target as Control).queue_redraw()
		# A light sweeping down the selected card now and then.
		var sweep: ColorRect = card.sweep
		var sweeping := fmod(_clock, 6.0) / 6.0
		sweep.position.y = viewport.size.y * clampf(sweeping / 0.6, 0.0, 1.0)
		sweep.color.a = (0.22 * (1.0 - sweeping / 0.6) if sweeping < 0.6 else 0.0) if chosen else 0.0
		(card.sparks as Sparks).on = chosen
		(card.sparks as Sparks).clock = _clock


## The pad: the stick or the cross choose (once back at rest), A or Start confirms.
func _pad() -> void:
	var pads := Input.get_connected_joypads()
	if pads.is_empty():
		_pad_ready = false
		return
	var pad: int = pads[0]
	var pressed := Input.is_joy_button_pressed(pad, JOY_BUTTON_A) or Input.is_joy_button_pressed(pad, JOY_BUTTON_START)
	var axis := Input.get_joy_axis(pad, JOY_AXIS_LEFT_X)
	var direction := -1 if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_LEFT) else (1 if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_RIGHT) else (int(signf(axis)) if absf(axis) > 0.55 else 0))
	# Neutral once first (a button still held from the game, a stick lying off centre).
	if not _pad_ready:
		_pad_ready = not pressed and direction == 0
		_pad_confirm = pressed
		_pad_direction = direction
		return
	if _launching <= 0.0:
		if direction != 0 and (direction != _pad_direction or _clock >= _repeat_at):
			_select(selected + direction)
			_repeat_at = _clock + (0.4 if direction != _pad_direction else 0.2)
		if pressed and not _pad_confirm:
			_activate()
	_pad_confirm = pressed
	_pad_direction = direction


## The frame round the screen: dark bands, two rails with their lights, the corners.
class Chassis extends Control:
	func _draw() -> void:
		var area := Rect2(Vector2.ZERO, size)
		for band in [[0.0, 11.0, Color("02060b")], [11.0, 2.0, Color("192333")], [13.0, 9.0, Color("080e17")], [22.0, 2.0, Color("152130")]]:
			var inset: float = band[0]
			var width: float = band[1]
			var inner := area.grow(-inset)
			draw_rect(Rect2(inner.position, Vector2(inner.size.x, width)), band[2])
			draw_rect(Rect2(Vector2(inner.position.x, inner.end.y - width), Vector2(inner.size.x, width)), band[2])
			draw_rect(Rect2(inner.position, Vector2(width, inner.size.y)), band[2])
			draw_rect(Rect2(Vector2(inner.end.x - width, inner.position.y), Vector2(width, inner.size.y)), band[2])
		for side in [0, 1]:
			var x := 22.0 if side == 0 else size.x - 22.0 - 33.0
			var top := size.y * 0.13
			var bottom := size.y * 0.88
			draw_rect(Rect2(x, top, 33, bottom - top), Color("070e18"))
			draw_rect(Rect2(x if side == 0 else x + 28.0, top, 5, bottom - top), Color("1b2a3b"))
			var lamp := x + (9.0 if side == 0 else 19.0)
			draw_rect(Rect2(lamp, size.y * 0.2, 5, 49), Color("ff9c53"))
			draw_rect(Rect2(lamp, size.y * 0.2 + 56.0, 5, 28), Color("ed1737"))
			draw_rect(Rect2(lamp, bottom - size.y * 0.1 - 55.0, 5, 55), Color("a7dcf7"))
		for corner in [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]:
			var at := Vector2(56.0 if corner.x == 0.0 else size.x - 56.0, 8.0 if corner.y == 0.0 else size.y - 14.0)
			draw_rect(Rect2(at - Vector2(17, 0), Vector2(35, 6)), Color("ffd08a"))


## The ship of the name: a dart and its tail.
class Ship extends Control:
	func _draw() -> void:
		var k := size / Vector2(30, 44)
		draw_colored_polygon(PackedVector2Array([Vector2(15, 2) * k, Vector2(25, 32) * k, Vector2(15, 26) * k, Vector2(5, 32) * k]), Color("e5f1ff"))
		draw_colored_polygon(PackedVector2Array([Vector2(15, 30) * k, Vector2(21, 41) * k, Vector2(15, 38) * k, Vector2(9, 41) * k]), Color("e5f1ff"))


## A small triangle pointing right.
class Arrow extends Control:
	var colour := Color("f8c28e")

	func _draw() -> void:
		draw_colored_polygon(PackedVector2Array([Vector2.ZERO, Vector2(size.x, size.y / 2.0), Vector2(0, size.y)]), colour)


## The aiming corner at the card's top right.
class AimCorner extends Control:
	var colour := Color(0.47, 0.59, 0.67, 0.5)

	func _draw() -> void:
		draw_rect(Rect2(0, 0, size.x, 2), colour)
		draw_rect(Rect2(size.x - 2, 0, 2, size.y), colour)


## Sparks rising over the selected card, in steps.
class Sparks extends Control:
	var on := false
	var clock := 0.0

	func _process(_delta: float) -> void:
		queue_redraw()

	func _draw() -> void:
		if not on:
			return
		for i in 9:
			var period := 2.3 + i * 0.21
			var t := fmod(clock + i * 0.47, period) / period
			t = floorf(t * 18.0) / 18.0
			var alpha := (t / 0.2 if t < 0.2 else 1.0 - (t - 0.2) / 0.8) * 0.8
			var at := Vector2(size.x * (0.08 + i * 0.1) - 14.0 * t, size.y * 0.9 - 160.0 * t)
			draw_rect(Rect2(at, Vector2(2, 2)), Color(1, 0.76, 0.5, alpha))
