class_name DeathScreen
extends CanvasLayer
## "MORT" over a red-dark vignette, and how to try again (the death card of
## the web version's index.html): it fades in once the hero has fallen,
## shows the key or the pad button to press, and a hint on what killed him
## when there is one. Full resolution, above the pixel view.

var _veil: TextureRect
var _card: VBoxContainer
var _prompt: Label
var _hint: Label
var _shown := 0.0
var _wanted := 0.0


func _init() -> void:
	name = "Death screen"
	layer = 4
	_veil = TextureRect.new()
	_veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	_veil.stretch_mode = TextureRect.STRETCH_SCALE
	_veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array([0.0, 0.3, 0.8, 1.0])
	gradient.colors = PackedColorArray([Color8(0x2a, 0, 0, 0x33), Color8(0x2a, 0, 0, 0x33), Color8(0x3a, 3, 3, 0xb8), Color8(0x12, 0, 0, 0xee)])
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = 256
	texture.height = 256
	_veil.texture = texture
	add_child(_veil)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_card = VBoxContainer.new()
	_card.alignment = BoxContainer.ALIGNMENT_CENTER
	_card.add_theme_constant_override("separation", 18)
	centre.add_child(_card)
	var title := Label.new()
	title.text = "MORT"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 76)
	title.add_theme_color_override("font_color", Color8(0xff, 0x4a, 0x3d))
	title.add_theme_color_override("font_shadow_color", Color8(0xff, 0x2a, 0x1f, 0x99))
	title.add_theme_constant_override("shadow_outline_size", 18)
	title.add_theme_constant_override("shadow_offset_x", 0)
	title.add_theme_constant_override("shadow_offset_y", 0)
	_card.add_child(title)
	_prompt = Label.new()
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.add_theme_font_size_override("font_size", 12)
	_prompt.add_theme_color_override("font_color", Color8(0xf0, 0xd6, 0xd3))
	_card.add_child(_prompt)
	_hint = Label.new()
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hint.custom_minimum_size = Vector2(420, 0)
	_hint.add_theme_font_size_override("font_size", 11)
	_hint.add_theme_color_override("font_color", Color8(0xf0, 0xc9, 0xc4))
	_card.add_child(_hint)
	_apply()


## Shown (fading in over 0.6 s) or hidden at once; `hint` says what killed him (empty: nothing).
func display(on: bool, hint: String = "") -> void:
	_wanted = 1.0 if on else 0.0
	if not on:
		_shown = 0.0
	_hint.text = hint
	_hint.visible = not hint.is_empty()
	_apply()


func _process(delta: float) -> void:
	if _shown == _wanted:
		return
	_shown = move_toward(_shown, _wanted, delta / 0.6)
	_apply()


func _apply() -> void:
	# A pad in use shows its button, else the key.
	_prompt.text = ("A" if Input.get_connected_joypads().size() > 0 else "ENTRÉE") + "    RECOMMENCER"
	visible = _shown > 0.0
	_veil.modulate.a = _shown
	_card.modulate.a = _shown
