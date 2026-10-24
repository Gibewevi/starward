class_name LabDoor
extends RefCounted
## The lab's great door (the door of src/arena.js): its two leaves slide into
## the wall, a heavy start and a soft stop; the amber lamp above it blinks
## while it moves, stands open or sounds the alarm. Shut, it is a wall
## (an obstacle); past six tenths open, a way through. Where the men stand in
## the corridor behind it, deepest first, in two files (`inside`).

var obstacles: Obstacles
var shut: Dictionary
var leaves: Array = []  ## [{ node, closed, open }]
var lamp: StandardMaterial3D
var lamp_colour := Color(1, 1, 1)
var centre := Vector3.ZERO
var out := Vector3.FORWARD
var along := Vector3.RIGHT
var width := 0.0
var inside: Array[Vector3] = []
var openness := 0.0
var target := 0.0
var alarm := false


func _init(level: Obstacles, data: Dictionary, room: Node) -> void:
	obstacles = level
	shut = level.boxes[int(data.shut)]
	centre = _v(data.centre)
	out = _v(data.out)
	along = _v(data.along)
	width = data.width
	for point in data.inside:
		inside.append(_v(point))
	for leaf in data.leaves:
		var node: Node3D = room.find_child(leaf.name, true, false)
		if node:
			leaves.append({ "node": node, "closed": leaf.closed, "open": leaf.open })
	# The lamp's own material, so it can blink on its own.
	for mesh in room.find_children("*", "MeshInstance3D", true, false):
		if mesh.mesh == null:
			continue
		for surface in mesh.mesh.get_surface_count():
			var material := mesh.mesh.surface_get_material(surface) as StandardMaterial3D
			if material and material.resource_name == "door lamp":
				lamp = material
				lamp_colour = material.albedo_color
	_place()


static func _v(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


func open() -> void:
	target = 1.0


func close() -> void:
	target = 0.0


func is_open() -> bool:
	return openness >= 1.0


func is_closed() -> bool:
	return openness <= 0.0


## Shut at once (a restart).
func reset() -> void:
	target = 0.0
	openness = 0.0
	alarm = false
	_place()
	obstacles.add(shut)


func update(dt: float, time: float) -> void:
	var before := openness
	openness = clampf(openness + signf(target - openness) * dt / 1.3, 0.0, 1.0)
	_place()
	var closed := obstacles.has(shut)
	if openness > 0.6 and closed:
		obstacles.remove(shut)
	if openness <= 0.6 and before > openness and not closed:
		obstacles.add(shut)
	if lamp:
		var busy := target > 0.0 or openness > 0.0 or alarm
		lamp.albedo_color = lamp_colour * ((1.4 if sin(time * 9.0) > 0.0 else 0.15) if busy else 0.6)


func _place() -> void:
	# three.js's smootherstep: 6k⁵ − 15k⁴ + 10k³.
	var k := openness * openness * openness * (openness * (openness * 6.0 - 15.0) + 10.0)
	for leaf in leaves:
		leaf.node.position.x = lerpf(leaf.closed, leaf.open, k)
