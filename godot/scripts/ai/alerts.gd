class_name Alerts
extends Node3D
## What the enemies feel, drawn above their heads in pixel art (port of
## src/alerts.js): a yellow "?" when one hears or glimpses something, a red
## "!" when he spots the hero, and little sound marks beside the helmet, on
## the side a noise came from. Every icon pops: it bursts in white-hot and
## oversized, overshoots, and settles to its size with a spring (the "?"
## tilts as it lands, puzzled); it leaves by shrinking away. Always drawn on
## top, so it reads at a glance.

const GLYPHS := {
	# . empty, o outline, # fill, + highlight
	"!": [
		"..ooo..", ".o+##o.", ".o+##o.", ".o+##o.", ".o+##o.", ".o+##o.", "..o#o..", "..o#o..", "...o...", "..ooo..", ".o+##o.", ".o###o.", "..ooo..",
	],
	"?": [
		"..ooooo..", ".o+####o.", "o+##oo##o", "o##o..o#o", ".oo..o##o", "....o##o.", "...o##o..", "...o#o...", "....o....", "...ooo...", "..o+#o...", "..o##o...", "...oo....",
	],
	"sound": [".#...#..", "..#...#.", "..#...#.", "..#...#.", ".#...#.."],
}
const PALETTE := {
	"!": { "#": Color8(235, 48, 40), "+": Color8(255, 150, 120), "o": Color8(32, 6, 8) },
	"?": { "#": Color8(255, 214, 74), "+": Color8(255, 246, 190), "o": Color8(44, 30, 4) },
	"sound": { "#": Color8(236, 236, 230), "+": Color8(255, 255, 255), "o": Color8(30, 30, 30) },
}
## Render pixels per metre at the default zoom: icons are drawn about 1:1.
const PIXEL := 1.0 / 30.0

var textures := {}
var flashes := {}
var entries := {}
var camera: Camera3D


func _init() -> void:
	name = "Alerts"
	for glyph in GLYPHS:
		textures[glyph] = _texture(glyph)
	flashes["!"] = _texture("!", true)
	flashes["?"] = _texture("?", true)


static func _texture(glyph: String, flash: bool = false) -> ImageTexture:
	var rows: Array = GLYPHS[glyph]
	var image := Image.create_empty(rows[0].length(), rows.size(), false, Image.FORMAT_RGBA8)
	for y in rows.size():
		for x in rows[y].length():
			var c: String = rows[y][x]
			if c == ".":
				continue
			# The flash frame: the glyph all white inside its outline.
			image.set_pixel(x, y, Color.WHITE if flash and c != "o" else PALETTE[glyph][c])
	return ImageTexture.create_from_image(image)


func _sprite(glyph: String) -> Sprite3D:
	var sprite := Sprite3D.new()
	sprite.name = "Alert " + glyph
	sprite.texture = textures[glyph]
	sprite.pixel_size = PIXEL
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	sprite.no_depth_test = true
	sprite.shaded = false
	sprite.render_priority = 20
	sprite.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sprite.visible = false
	add_child(sprite)
	return sprite


func _entry(owner: Object) -> Dictionary:
	if not entries.has(owner):
		entries[owner] = { "icon": _sprite("!"), "marks": _sprite("sound"), "kind": "", "age": 0.0, "leaving": -1.0, "hold": INF, "mark_age": INF, "mark_side": 1.0 }
	return entries[owner]


## Pops a "?" or a "!" over him (a "!" replaces a "?"); it stays for `hold` seconds, or until hidden.
func alert(owner: Object, kind: String, hold: float = INF) -> bool:
	var e := _entry(owner)
	if e.kind == kind and e.leaving < 0.0:
		e.hold = maxf(e.hold, e.age + hold)
		return false
	e.kind = kind
	e.icon.texture = textures[kind]
	e.age = 0.0
	e.leaving = -1.0
	e.hold = hold
	e.icon.visible = true
	return true


## The icon goes (shrinking away).
func dismiss(owner: Object) -> void:
	if entries.has(owner) and entries[owner].kind != "" and entries[owner].leaving < 0.0:
		entries[owner].leaving = 0.0


## Sound marks beside his helmet, on the side the noise came from (side: + the screen's right).
func sound(owner: Object, side: float = 1.0) -> void:
	var e := _entry(owner)
	e.mark_age = 0.0
	e.mark_side = 1.0 if side >= 0.0 else -1.0
	e.marks.visible = true


func kind_of(owner: Object) -> String:
	return entries[owner].kind if entries.has(owner) else ""


## head(owner) gives the top of his head (or null); camera_right: the screen's right on the floor.
func update(dt: float, head: Callable, camera_right: Vector3 = Vector3(1, 0, 0)) -> void:
	var facing := camera.global_basis if camera else Basis.IDENTITY
	for owner in entries.keys():
		var e: Dictionary = entries[owner]
		var top: Variant = head.call(owner) if is_instance_valid(owner) else null
		if top == null:
			e.icon.visible = false
			e.marks.visible = false
			continue
		if e.kind != "":
			e.age += dt
			if e.leaving < 0.0 and e.age > e.hold:
				e.leaving = 0.0
			var big: bool = e.kind == "!"
			# Pop: burst in oversized, overshoot, settle — then a gentle bob.
			var scale_now := 1.0
			if e.age < 0.09:
				scale_now = (1.5 if big else 1.3) * Stormtrooper.ease_by("outQuart", e.age / 0.09)
			elif e.age < 0.34:
				scale_now = 1.0 + (0.5 if big else 0.3) * cos((e.age - 0.09) / 0.25 * PI * 1.5) * (1.0 - Stormtrooper.ease_by("outCubic", (e.age - 0.09) / 0.25))
			var lift: float = 0.12 * sin(minf(1.0, e.age / 0.3) * PI) * (1.0 - minf(1.0, e.age / 0.3)) if big else 0.0
			lift += sin(e.age * 3.2) * 0.012
			var gone := false
			if e.leaving >= 0.0:
				e.leaving += dt
				var out := minf(1.0, e.leaving / 0.2)
				scale_now *= 1.0 - Stormtrooper.ease_by("inCubic", out) * 1.1 + 0.1 * sin(out * PI)
				if out >= 1.0:
					e.kind = ""
					e.icon.visible = false
					gone = true
			if not gone:
				# A white flash frame, then its own colour, bright at first; a "?" lands tilted and rights itself.
				e.icon.texture = flashes[e.kind] if e.age < 0.06 else textures[e.kind]
				e.icon.modulate = Color(1.6, 1.6, 1.6).lerp(Color.WHITE, Stormtrooper.ease_by("outQuad", minf(1.0, e.age / 0.2)))
				var tilt: float = 0.35 * exp(-e.age * 7.0) * cos(e.age * 22.0) if e.kind == "?" else 0.0
				var size := maxf(0.0001, scale_now)
				e.icon.global_transform = Transform3D(facing * Basis(Vector3(0, 0, 1), tilt) * Basis.from_scale(Vector3(size, size, 1)), top + Vector3(0, 0.34 + lift, 0))
		if e.mark_age < 0.75:
			e.mark_age += dt
			var p := minf(1.0, e.mark_age / 0.75)
			var s := Stormtrooper.ease_by("outBack", minf(1.0, e.mark_age / 0.14)) * (1.0 - Stormtrooper.ease_by("inQuad", maxf(0.0, (p - 0.55) / 0.45)))
			var at: Vector3 = top + camera_right * (e.mark_side * (0.2 + 0.08 * Stormtrooper.ease_by("outCubic", p)))
			at.y -= 0.08
			e.marks.global_transform = Transform3D(facing * Basis.from_scale(Vector3(maxf(0.0001, s) * e.mark_side, maxf(0.0001, s), 1)), at)
			e.marks.visible = s > 0.01
		else:
			e.marks.visible = false


func clear() -> void:
	for e in entries.values():
		e.kind = ""
		e.icon.visible = false
		e.marks.visible = false
		e.mark_age = INF
