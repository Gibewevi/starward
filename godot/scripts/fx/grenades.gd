class_name Grenades
extends Node3D
## Thermal detonators (port of src/grenades.js). Thrown on a ballistic arc, a
## grenade bounces on the floor and off crates, rolls, and goes off when its
## fuse runs out. Before it does, it warns: its red light blinks faster and
## faster (each blink a beep, through `on_beep`), and a red circle on the
## floor shows the blast's reach, a second ring closing in on it as the time
## runs out. The Force can push it away.
##
## throw_at(from, target) launches one that lands about on the target;
## update(dt) moves them and returns where they went off.

const GRAVITY := 9.8
const RADIUS := 0.065

var obstacles: Obstacles
var reach := 3.4
var random: Callable
## on_beep(grenade, progress), on_bounce(grenade, speed).
var on_beep := Callable()
var on_bounce := Callable()
var pool: Array = []


func _init(level: Obstacles = null, blast_reach: float = 3.4, draw: Callable = Callable()) -> void:
	name = "Grenades"
	obstacles = level
	reach = blast_reach
	random = draw if draw.is_valid() else func() -> float: return randf()
	var body := SphereMesh.new()
	body.radius = RADIUS
	body.height = RADIUS * 2.0
	body.radial_segments = 10
	body.rings = 8
	var band := CylinderMesh.new()
	band.top_radius = RADIUS * 1.04
	band.bottom_radius = RADIUS * 1.04
	band.height = 0.025
	band.radial_segments = 12
	var bulb := SphereMesh.new()
	bulb.radius = 0.02
	bulb.height = 0.04
	bulb.radial_segments = 6
	bulb.rings = 4
	var glow := _glow()
	for k in 4:
		var group := Node3D.new()
		group.name = "Grenade"
		var shell := MeshInstance3D.new()
		shell.mesh = body
		shell.material_override = _metal(Color8(0x4a, 0x4f, 0x57), 0.35, 0.8)
		group.add_child(shell)
		var strip := MeshInstance3D.new()
		strip.mesh = band
		strip.material_override = _metal(Color8(0x9a, 0xa0, 0xa8), 0.3, 0.9)
		strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		group.add_child(strip)
		var lamp := MeshInstance3D.new()
		lamp.mesh = bulb
		var lamp_material := StandardMaterial3D.new()
		lamp_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lamp.material_override = lamp_material
		lamp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		lamp.position = Vector3(0, RADIUS * 0.85, 0.025)
		group.add_child(lamp)
		var halo := ImpactEffects.glow_quad(group, "Halo", glow)
		halo.scale = Vector3.ONE * 0.32
		halo.material_override.set_shader_parameter("tint", Color(0.9, 0.02, 0.02, 0.8))
		group.visible = false
		add_child(group)
		# Danger: the blast's reach on the floor, and a ring closing in with the fuse.
		var zone := _ring("Danger zone")
		var closing := _ring("Danger closing")
		pool.append({
			"group": group, "lamp": lamp, "halo": halo, "zone": zone, "closing": closing, "live": false,
			"position": Vector3.ZERO, "velocity": Vector3.ZERO, "spin": Vector3.ZERO,
			"fuse": 0.0, "time": 0.0, "phase": 0.0, "lit": false, "rolling": false,
		})


static func _metal(color: Color, roughness: float, metallic: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	return material


## The halo's soft dot (a 16² texture, falling off squared).
static func _glow() -> ImageTexture:
	var n := 16
	var image := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var d := minf(1.0, Vector2((x + 0.5) / n * 2.0 - 1.0, (y + 0.5) / n * 2.0 - 1.0).length())
			image.set_pixel(x, y, Color8(255, 255, 255, roundi(pow(1.0 - d, 2.0) * 255.0)))
	return ImageTexture.create_from_image(image)


func _ring(label: String) -> MeshInstance3D:
	var ring := MeshInstance3D.new()
	ring.name = label
	ring.mesh = Stormtrooper._ring(0.93, 1.0, 56)
	ring.rotation.x = -PI / 2.0
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	material.albedo_color = Color(0.85, 0.02, 0.02, 0.0)
	ring.material_override = material
	ring.visible = false
	add_child(ring)
	return ring


## A velocity that carries it from `from` to `target` in about `time` seconds.
static func aim(from: Vector3, target: Vector3, time: float) -> Vector3:
	return Vector3((target.x - from.x) / time, (target.y - from.y) / time + 0.5 * GRAVITY * time, (target.z - from.z) / time)


func _launch(from: Vector3, velocity: Vector3, fuse: float) -> Dictionary:
	var grenade: Dictionary = pool[0]
	for entry in pool:
		if not entry.live:
			grenade = entry
			break
	grenade.live = true
	grenade.fuse = fuse
	grenade.time = 0.0
	grenade.lit = false
	grenade.rolling = false
	grenade.position = from
	grenade.velocity = velocity
	grenade.spin = Vector3(random.call() - 0.5, random.call() - 0.5, random.call() - 0.5) * 14.0
	grenade.group.visible = true
	grenade.zone.visible = true
	grenade.closing.visible = true
	grenade.group.position = from
	return grenade


## Thrown from `from` to land near `target`.
func throw_at(from: Vector3, target: Vector3, fuse: float = NAN) -> Dictionary:
	if is_nan(fuse):
		fuse = 2.1 + random.call() * 0.4
	var distance := Vector2(target.x - from.x, target.z - from.z).length()
	var time := clampf(distance / 6.5, 0.6, 1.15)
	return _launch(from, aim(from, Vector3(target.x, RADIUS, target.z), time), fuse)


## Dropped where it is (the thrower was knocked over mid-throw).
func drop(from: Vector3, fuse: float = 1.6) -> Dictionary:
	return _launch(from, Vector3((random.call() - 0.5) * 1.2, 0.5, (random.call() - 0.5) * 1.2), fuse)


## The Force pushes grenades in a cone in front of `from`.
func push(from: Vector3, direction: Vector3, range_: float = 6.0, cone: float = 0.95, speed: float = 9.0) -> int:
	var pushed := 0
	for grenade in pool:
		if not grenade.live:
			continue
		var offset: Vector3 = grenade.position - from
		offset.y = 0.0
		var distance := offset.length()
		if distance > range_ or (distance > 0.3 and SquadMind._angle(offset, direction) > cone):
			continue
		var falloff := 1.0 - 0.5 * distance / range_
		var velocity := (offset.normalized() + direction).normalized() * (speed * falloff)
		velocity.y = 3.2 * falloff
		grenade.velocity = velocity
		grenade.rolling = false
		pushed += 1
	return pushed


func _step(grenade: Dictionary, h: float) -> void:
	var p: Vector3 = grenade.position
	var v: Vector3 = grenade.velocity
	v.y -= GRAVITY * h
	p += v * h
	# Floor: it bounces, then rolls to a stop.
	if p.y < RADIUS:
		p.y = RADIUS
		if v.y < -1.2:
			if on_bounce.is_valid():
				on_bounce.call(grenade, -v.y)
			v.y *= -0.38
			v.x *= 0.72
			v.z *= 0.72
			grenade.spin = grenade.spin * 0.6 + Vector3(v.z, 0, -v.x) * (1.0 / RADIUS * 0.4)
		else:
			v.y = 0.0
			grenade.rolling = true
			var roll := exp(-2.4 * h)
			v.x *= roll
			v.z *= roll
			grenade.spin = Vector3(v.z, 0, -v.x) / RADIUS
	# Crates and barrels: it bounces off.
	if obstacles:
		for box in obstacles.boxes:
			var low: Vector3 = box.min
			var high: Vector3 = box.max
			var closest := Vector3(clampf(p.x, low.x, high.x), clampf(p.y, low.y, high.y), clampf(p.z, low.z, high.z))
			var n := p - closest
			var distance := n.length()
			if distance >= RADIUS:
				continue
			n = Vector3.UP if distance < 1e-6 else n / distance
			p += n * (RADIUS - distance)
			var into := v.dot(n)
			if into < 0.0:
				if into < -1.2 and on_bounce.is_valid():
					on_bounce.call(grenade, -into)
				v += n * (-into * 1.45)
				v *= 0.8
			if n.y > 0.7 and absf(v.y) < 1.2:
				v.y = maxf(0.0, v.y)
				grenade.rolling = true
				v.x *= exp(-2.4 * h)
				v.z *= exp(-2.4 * h)
	grenade.position = p
	grenade.velocity = v


## Moves them; returns where each one that went off did (on the floor).
func update(dt: float) -> Array[Vector3]:
	var blasts: Array[Vector3] = []
	for grenade in pool:
		if not grenade.live:
			continue
		var left := dt
		while left > 1e-6:
			_step(grenade, minf(left, 1.0 / 240.0))
			left -= 1.0 / 240.0
		var group: Node3D = grenade.group
		group.position = grenade.position
		var angle: float = grenade.spin.length() * dt
		if angle > 1e-6:
			group.quaternion = (Quaternion(grenade.spin.normalized(), angle) * group.quaternion).normalized()
		grenade.time += dt
		# The countdown: blinking (and beeping) faster and faster.
		var progress := minf(1.0, grenade.time / grenade.fuse)
		var rate := 2.2 + 14.0 * pow(progress, 2.2)
		grenade.phase += rate * dt
		var lit := fmod(grenade.phase, 1.0) < 0.45
		if lit and not grenade.lit and on_beep.is_valid():
			on_beep.call(grenade, progress)
		grenade.lit = lit
		(grenade.lamp.material_override as StandardMaterial3D).albedo_color = Color(2.6, 0.1, 0.06) if lit else Color(0.25, 0.01, 0.01)
		grenade.halo.visible = lit
		var fade := minf(1.0, grenade.time / 0.25)
		for ring: MeshInstance3D in [grenade.zone, grenade.closing]:
			ring.position = Vector3(grenade.position.x, 0.02, grenade.position.z)
		grenade.zone.scale = Vector3.ONE * reach
		(grenade.zone.material_override as StandardMaterial3D).albedo_color.a = (0.5 if lit else 0.18) * fade
		grenade.closing.scale = Vector3.ONE * (reach * (1.0 - progress) + 0.2)
		(grenade.closing.material_override as StandardMaterial3D).albedo_color.a = 0.35 * fade
		if grenade.fuse - grenade.time <= 0.0:
			_hide(grenade)
			blasts.append(Vector3(grenade.position.x, 0, grenade.position.z))
	return blasts


func _hide(grenade: Dictionary) -> void:
	grenade.live = false
	grenade.group.visible = false
	grenade.zone.visible = false
	grenade.closing.visible = false


func clear() -> void:
	for grenade in pool:
		_hide(grenade)


func live() -> Array:
	return pool.filter(func(grenade: Dictionary) -> bool: return grenade.live)
