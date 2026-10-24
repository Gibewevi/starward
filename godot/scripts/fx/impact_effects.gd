class_name ImpactEffects
extends RefCounted
## What the blows leave behind (src/impact-effects.js). For now only the
## cauterised glow: a cut's ring, a scorch across the armour, a bolt's burn
## cool from white-hot to scorched over a few seconds. Sparks, flashes,
## bursts, smoke and the red drops come with step 4 of the migration: their
## calls are here, and do nothing yet.

const HOT := Color(3.2, 1.35, 0.4)
const COLD := Color(0.055, 0.05, 0.05)

var _glows: Array = []


## A material that cools from white-hot to scorched over `duration` seconds.
func glow(material: BaseMaterial3D, duration: float = 4.5) -> void:
	_glows.append({ "material": material, "age": 0.0, "duration": duration })
	material.albedo_color = HOT


func update(dt: float) -> void:
	for entry in _glows:
		entry.age += dt
		var t := minf(1.0, entry.age / entry.duration)
		if is_instance_valid(entry.material):
			entry.material.albedo_color = HOT.lerp(COLD, 1.0 - pow(1.0 - t, 2.2))
	_glows = _glows.filter(func(entry: Dictionary) -> bool: return entry.age < entry.duration)


func clear() -> void:
	_glows.clear()


# Step 4: sparks, the impact's flash, a clean cut's burst, smoke from a cut, red drops.
func sparks(_point: Vector3, _direction: Vector3, _normal: Vector3, _options: Dictionary = {}) -> void:
	pass


func flash(_point: Vector3, _power: float = 1.0, _options: Dictionary = {}) -> void:
	pass


func burst(_point: Vector3, _options: Dictionary = {}) -> void:
	pass


func smoulder(_node: Node3D, _duration: float = 3.0) -> void:
	pass


func bleed(_point: Vector3, _direction: Vector3, _normal: Vector3, _options: Dictionary = {}) -> void:
	pass


func drip(_cap: Node3D, _amount: float = 1.0) -> void:
	pass
