class_name Tweens
extends RefCounted
## A small tween runner (tween.js's createTweens), for transitions and visual
## effects: each tween maps its eased progress (0 → 1) onto whatever it
## animates — never for the flight of thrown parts, which stays simulated.

var _list: Array = []


## update(eased, progress) each step; complete() once done (or cancelled, or cleared).
func add(duration: float, curve: String, update: Callable, complete: Callable = Callable(), delay: float = 0.0) -> Dictionary:
	var tween := { "duration": maxf(duration, 1e-4), "delay": delay, "curve": curve, "update": update, "complete": complete, "age": 0.0, "done": false }
	_list.append(tween)
	return tween


## Stops a tween where it stands (its complete() still runs).
func cancel(tween: Variant) -> void:
	if tween == null or tween.done:
		return
	tween.done = true
	if tween.complete.is_valid():
		tween.complete.call()


func update(dt: float) -> void:
	for tween in _list:
		if tween.done:
			continue
		tween.age += dt
		if tween.age < tween.delay:
			continue
		var progress := clampf((tween.age - tween.delay) / tween.duration, 0.0, 1.0)
		if tween.update.is_valid():
			tween.update.call(Stormtrooper.ease_by(tween.curve, progress), progress)
		if progress >= 1.0:
			tween.done = true
			if tween.complete.is_valid():
				tween.complete.call()
	_list = _list.filter(func(tween: Dictionary) -> bool: return not tween.done)


## Finishes every tween at once (so each puts back what it borrowed).
func clear() -> void:
	var list := _list
	_list = []
	for tween in list:
		if tween.done:
			continue
		if tween.update.is_valid():
			tween.update.call(Stormtrooper.ease_by(tween.curve, 1.0), 1.0)
		if tween.complete.is_valid():
			tween.complete.call()


func count() -> int:
	return _list.size()
