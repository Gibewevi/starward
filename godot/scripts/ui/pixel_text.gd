class_name PixelText
extends RefCounted
## The menu's tiny bitmap alphabet (port of src/menu-pixels.js): no font,
## no smoothing — each letter a few pixels, drawn white on a 10-pixel-high
## image, accents dropped (an É gets its mark on top), to be shown enlarged
## with the nearest pixel and tinted as wanted.

const ROWS := {
	"A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
	"B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
	"C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
	"D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
	"E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
	"F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
	"G": ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
	"H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
	"I": ["111", "010", "010", "010", "010", "010", "111"],
	"J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
	"K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
	"L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
	"M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
	"N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
	"O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
	"P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
	"Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
	"R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
	"S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
	"T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
	"U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
	"V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
	"W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
	"X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
	"Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
	"Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
	"1": ["010", "110", "010", "010", "010", "010", "111"],
	"2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
	" ": ["000", "000", "000", "000", "000", "000", "000"],
}


## `text` as an image, 10 pixels high (white letters on nothing).
static func image(text: String, spacing: int = 2) -> Image:
	var plain := text.replace("É", "E").replace("È", "E").replace("Ê", "E").replace("À", "A")
	var width := -spacing
	for char in plain:
		width += (ROWS[char][0] as String).length() + spacing if ROWS.has(char) else 3 + spacing
	var picture := Image.create(maxi(1, width), 10, false, Image.FORMAT_RGBA8)
	var x := 0
	for index in plain.length():
		var glyph: Array = ROWS.get(plain[index], ROWS[" "])
		for y in glyph.size():
			var row: String = glyph[y]
			for dx in row.length():
				if row[dx] == "1":
					picture.set_pixel(x + dx, y + 3, Color.WHITE)
		if text[index] == "É":
			picture.set_pixel(x + 3, 0, Color.WHITE)
			picture.set_pixel(x + 2, 1, Color.WHITE)
		x += (glyph[0] as String).length() + spacing
	return picture


## A TextureRect showing `text` `height` pixels high on screen, tinted `colour`.
static func label(text: String, height: float, colour: Color = Color.WHITE, spacing: int = 2) -> TextureRect:
	var picture := image(text, spacing)
	var rect := TextureRect.new()
	rect.texture = ImageTexture.create_from_image(picture)
	rect.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.custom_minimum_size = Vector2(picture.get_width() * height / 10.0, height)
	rect.size = rect.custom_minimum_size
	rect.modulate = colour
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Its own size in a container, never stretched.
	rect.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return rect
