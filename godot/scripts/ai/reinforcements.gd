class_name Reinforcements
extends RefCounted
## Men through the great door, when the game calls for them (summon(); port of
## src/reinforcements.js): the door lamp blinks and an alarm sounds; the door
## slides open; the troopers come out of the corridor one after the other;
## once the last is through and clear, it closes. update(dt, entering)
## returns what happened: "alarm", "open", { type: "spawn", index } (the game
## makes the trooper and marches him in), "close".

var door: LabDoor
var feel: Dictionary
var phase := "idle"
var waves := 0
var _clock := 0.0
var _queue := 0
var _index := 0


func _init(great_door: LabDoor, feel_data: Dictionary = {}) -> void:
	door = great_door
	feel = feel_data if not feel_data.is_empty() else CombatController._load("res://assets/data/feel.json")
	reset()


func reset() -> void:
	phase = "idle"
	waves = 0
	_clock = 0.0
	_queue = 0
	_index = 0
	if door:
		door.alarm = false


## `count` men, now (unless the door is already busy).
func summon(count: int) -> bool:
	if door == null or phase != "idle":
		return false
	phase = "summoned"
	_queue = count
	_index = 0
	waves += 1
	return true


func update(dt: float, entering: int = 0) -> Array:
	var events := []
	if door == null:
		return events
	var r: Dictionary = feel.reinforce
	_clock -= dt
	match phase:
		"summoned":
			phase = "alarm"
			_clock = r.alarm
			door.alarm = true
			events.append("alarm")
		"alarm":
			if _clock <= 0.0:
				phase = "opening"
				door.open()
				events.append("open")
		"opening":
			if door.is_open():
				phase = "spawning"
				_clock = 0.0
		"spawning":
			if _clock <= 0.0 and _queue > 0:
				events.append({ "type": "spawn", "index": _index })
				_index += 1
				_queue -= 1
				_clock = r.spacing
			if _queue == 0:
				phase = "clearing"
				_clock = r.linger
		"clearing":
			# Shut once the last man is through and clear of the doorway.
			if entering > 0:
				_clock = maxf(_clock, 0.6)
			if _clock <= 0.0:
				phase = "closing"
				door.close()
				door.alarm = false
				events.append("close")
		"closing":
			if door.is_closed():
				phase = "idle"
	return events
