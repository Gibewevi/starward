class_name Stormtrooper
extends Node3D
## A stormtrooper (port of src/stormtrooper.js). A trooper in moulded white
## armour over a black suit (assets/baked/stormtrooper.glb), built from rigid
## parts — helmet, torso, pelvis, upper arms, forearms, hands, thighs, shins,
## boots, and an E-11 blaster — each hung on a light skeleton while he
## stands, idle, rifle in hand, feet planted by leg IK; his steps come from
## the captured gait (TrooperGait). Every part is also a rigid body of a
## Verlet ragdoll (Ragdoll) whose particles follow the pose until physics
## takes over. The blade's real sweep is tested against a capsule per part;
## where it crosses decides which predefined joint is severed (shoulder,
## elbow, wrist, hip, knee, ankle, neck, or the waist under a horizontal
## cut), or an armour plate is knocked off. Cuts are cauterised and glow,
## nothing gory. A severed piece is thrown with the blade's momentum, then
## simply simulated. Every hit flashes the struck armour white for an
## instant, and his armour comes apart progressively.
##
## Blows move him: each one shoves him back along the blade and turns him
## away from it, and a felled body carries the blow's momentum and slides.
## The Force moves him: a push throws him off his feet (it never kills); a
## pull drags him in, explosive at first and slowing on arrival; caught by
## it he chokes, clutching at his throat; held, he hangs before the hero; let
## go, he drops onto his feet and runs away. Down but alive, a pull hauls him
## upright first.
##
## Alive, he never goes limp: thrown, his muscles keep working — arms out to
## break the fall, chin tucked, knees drawn — and once down he curls up and
## squirms before getting back up. Only the dead are rag dolls. Knocked down
## unhurt, he lies stunned, gets up, sways, and fetches his rifle if it lies
## close by. A lost hand or forearm: he drops the rifle and holds the stump.
## A lost leg, or too many blows: he falls, alive, and crawls on his elbows
## until he gives out. Beheaded: the body stays up a heartbeat, collapses and
## twitches.
##
## update(dt, time) then strike(previous_base, previous_tip, base, tip, dt)
## each frame; reset() rebuilds him intact. +Z is his front. `root` is his
## body (moved), `debris` holds what came off him (in the world's frame); this
## node itself stays at the origin. tests/test_trooper.gd replays a trace of
## the web's trooper through all of it.

const CUT_SPEED := 2.2
const SLASH_LETHAL_SPEED := 3.5
const SIDES := [["L", 1.0], ["R", -1.0]]
const ORIGIN := Vector3.ZERO
## The rifle at low ready across the belly; shouldered, its stock against the right shoulder.
const LOW_READY_POSITION := Vector3(-0.065, 0.075, 0.22)
const SHOULDERED := Vector3(-0.125, 0.27, 0.23)
## Blind fire from cover: the rifle held up over it at arm's length, in the spine's frame.
const BLIND := Vector3(-0.04, 0.86, 0.26)
## Throwing a grenade, the left hand's path in the spine's frame: from the
## rifle's foregrip, wound up behind the shoulder, swung over the top,
## released in front, following through across the body.
const THROW_GRIP := Vector3(0.05, 0.12, 0.3)
const THROW_WIND := Vector3(0.2, 0.56, -0.2)
const THROW_RELEASE := Vector3(0.11, 0.6, 0.3)
const THROW_FOLLOW := Vector3(-0.03, 0.06, 0.34)
## The muzzle, in the rifle's frame.
const MUZZLE := Vector3(0, 0.012, 0.37)
## The soles in the ankle's frame: heel and toe.
const SOLES := [Vector3(0, -0.1, -0.05), Vector3(0, -0.1, 0.16)]
## Walking and running paces (m/s) and how fast he gets going, slows and turns.
const PACE := { "walk": 1.35, "run": 3.7, "accelerate": 5.5, "brake": 9.0, "turn": 5.5 }
## Floor behaviour of loose pieces: hard and light, they clatter and skid.
const LOOSE_BOUNCE := 0.38
const LOOSE_FRICTION := 0.05
## Where the blade goes through him: on his spine, at the chest.
const WOUND := Vector3(0, 0.2, 0.02)
const REACTION_SPRINGS := ["yaw", "pitch", "roll", "head", "headYaw", "headRoll", "buckle", "armL", "armR", "flareL", "flareR", "dipL", "dipR"]

## Joint hierarchy in the rest pose: name, parent, offset (metres). A compact, sturdy build.
const JOINTS := [
	["pelvis", "", Vector3(0, 0.78, 0)],
	["spine", "pelvis", Vector3(0, 0.13, 0)],
	["neck", "spine", Vector3(0, 0.35, -0.01)],
	["shoulderL", "spine", Vector3(0.235, 0.27, -0.01)],
	["elbowL", "shoulderL", Vector3(0.01, -0.255, 0)],
	["wristL", "elbowL", Vector3(0, -0.23, 0.01)],
	["shoulderR", "spine", Vector3(-0.235, 0.27, -0.01)],
	["elbowR", "shoulderR", Vector3(-0.01, -0.255, 0)],
	["wristR", "elbowR", Vector3(0, -0.23, 0.01)],
	["hipL", "pelvis", Vector3(0.115, -0.06, 0)],
	["kneeL", "hipL", Vector3(0, -0.325, 0.01)],
	["ankleL", "kneeL", Vector3(0, -0.305, -0.01)],
	["hipR", "pelvis", Vector3(-0.115, -0.06, 0)],
	["kneeR", "hipR", Vector3(0, -0.325, 0.01)],
	["ankleR", "kneeR", Vector3(0, -0.305, -0.01)],
]
## Hip to ankle.
const LEG := 0.325 + 0.305

## Ragdoll particles: name, joint, local position, radius, mass.
static var PARTICLES: Array = _particles()
## Bodies: name (= part), particles (the first three define its frame), capsule.
static var BODIES: Array = _bodies()
## Predefined separations: the shared particle, which side comes away, cap size
## and facing. Lethal ones kill; a lost leg fells him alive.
static var CUTS: Dictionary = _cuts()
## How hard the muscles hold each particle to the crawl: hands firmly, the trunk steadily, the legs barely.
static var MUSCLE: Dictionary = _muscle()
## Reflexes in flight and on the floor: the trunk left to physics, the limbs and head held in a live pose.
static var REFLEX: Dictionary = _reflex()
static var LOW_READY_QUATERNION := Quaternion(Basis.from_euler(Vector3(0.32, 1.12, 0), EULER_ORDER_YXZ))
static var _model: PackedScene
static var _plates := {}


static func _particles() -> Array:
	var list := [
		["N", "neck", Vector3(0, 0, 0), 0.065, 1.0], ["HT", "neck", Vector3(0, 0.31, 0), 0.14, 1.5], ["HF", "neck", Vector3(0, 0.16, 0.14), 0.11, 1.0],
		["W", "spine", Vector3(0, 0, 0), 0.14, 3.0],
		["HL", "hipL", Vector3(0, 0, 0), 0.11, 2.0], ["HR", "hipR", Vector3(0, 0, 0), 0.11, 2.0],
		["B0", "holder", Vector3(0, 0, -0.13), 0.035, 0.6], ["B1", "holder", Vector3(0, 0, 0.33), 0.03, 0.6], ["B2", "holder", Vector3(0, 0.07, 0.05), 0.03, 0.4],
	]
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		list.append_array([
			["S" + s, "shoulder" + s, Vector3(0, 0, 0), 0.09, 2.0],
			["E" + s, "elbow" + s, Vector3(0, 0, 0), 0.062, 1.0], ["UA" + s, "shoulder" + s, Vector3(0, -0.125, 0.075), 0.058, 0.5],
			["W" + s, "wrist" + s, Vector3(0, 0, 0), 0.055, 0.8], ["FA" + s, "elbow" + s, Vector3(0, -0.115, 0.07), 0.056, 0.5],
			["HT" + s, "wrist" + s, Vector3(0, -0.1, 0), 0.045, 0.3], ["HP" + s, "wrist" + s, Vector3(sign * 0.01, -0.05, 0.055), 0.04, 0.3],
			["K" + s, "knee" + s, Vector3(0, 0, 0), 0.075, 1.5], ["TH" + s, "hip" + s, Vector3(0, -0.16, 0.1), 0.08, 0.8],
			["SH" + s, "knee" + s, Vector3(0, -0.15, 0.07), 0.06, 0.5],
			["A" + s, "ankle" + s, Vector3(0, 0, 0), 0.065, 1.0], ["T" + s, "ankle" + s, Vector3(0, -0.055, 0.16), 0.04, 0.6], ["HE" + s, "ankle" + s, Vector3(0, -0.06, -0.05), 0.045, 0.4],
		])
	return list


static func _bodies() -> Array:
	# The head's capsule runs from the face to the crown: the big helmet, not the throat below it.
	var list := [
		["head", ["N", "HT", "HF"], ["HF", "HT", 0.15]],
		["torso", ["W", "N", "SL", "SR"], ["W", "N", 0.18]],
		["pelvis", ["W", "HL", "HR"], ["HL", "HR", 0.16]],
		["blaster", ["B0", "B1", "B2"], ["B0", "B1", 0.045]],
	]
	for s in ["L", "R"]:
		list.append_array([
			["upperArm" + s, ["S" + s, "E" + s, "UA" + s], ["S" + s, "E" + s, 0.08]],
			["forearm" + s, ["E" + s, "W" + s, "FA" + s], ["E" + s, "W" + s, 0.072]],
			["hand" + s, ["W" + s, "HT" + s, "HP" + s], ["W" + s, "HT" + s, 0.055]],
			["thigh" + s, ["H" + s, "K" + s, "TH" + s], ["H" + s, "K" + s, 0.1]],
			["shin" + s, ["K" + s, "A" + s, "SH" + s], ["K" + s, "A" + s, 0.085]],
			["foot" + s, ["A" + s, "T" + s, "HE" + s], ["HE" + s, "T" + s, 0.07]],
		])
	return list


static func _cuts() -> Dictionary:
	var cuts := {
		"neck": { "particle": "N", "parent": "torso", "child": "head", "lethal": true, "radius": 0.065, "normal": Vector3(0, 1, 0) },
		"waist": { "particle": "W", "parent": "torso", "child": "pelvis", "lethal": true, "radius": 0.15, "normal": Vector3(0, -1, 0) },
	}
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		cuts["shoulder" + s] = { "particle": "S" + s, "parent": "torso", "child": "upperArm" + s, "lethal": false, "radius": 0.075, "normal": Vector3(sign, 0, 0) }
		cuts["elbow" + s] = { "particle": "E" + s, "parent": "upperArm" + s, "child": "forearm" + s, "lethal": false, "radius": 0.058, "normal": Vector3(0, -1, 0) }
		cuts["wrist" + s] = { "particle": "W" + s, "parent": "forearm" + s, "child": "hand" + s, "lethal": false, "radius": 0.048, "normal": Vector3(0, -1, 0) }
		cuts["hip" + s] = { "particle": "H" + s, "parent": "pelvis", "child": "thigh" + s, "lethal": false, "radius": 0.088, "normal": Vector3(0, -1, 0) }
		cuts["knee" + s] = { "particle": "K" + s, "parent": "thigh" + s, "child": "shin" + s, "lethal": false, "radius": 0.07, "normal": Vector3(0, -1, 0) }
		cuts["ankle" + s] = { "particle": "A" + s, "parent": "shin" + s, "child": "foot" + s, "lethal": false, "radius": 0.058, "normal": Vector3(0, -1, 0) }
	return cuts


static func _muscle() -> Dictionary:
	var muscle := { "W": 1.0, "N": 1.2, "SL": 1.0, "SR": 1.0, "HT": 1.2, "HF": 1.2, "HL": 0.7, "HR": 0.7 }
	for s in ["L", "R"]:
		muscle.merge({ "S" + s: 1.0, "UA" + s: 2.0, "E" + s: 2.5, "FA" + s: 2.5, "W" + s: 3.5, "HT" + s: 3.0, "HP" + s: 3.0, "TH" + s: 0.4, "K" + s: 0.35, "SH" + s: 0.3, "A" + s: 0.25, "T" + s: 0.2, "HE" + s: 0.2 }, true)
	return muscle


static func _reflex() -> Dictionary:
	var reflex := { "W": 0.0, "N": 0.0, "SL": 0.0, "SR": 0.0, "HT": 0.7, "HF": 0.7, "HL": 0.5, "HR": 0.5 }
	for s in ["L", "R"]:
		reflex.merge({ "S" + s: 0.0, "UA" + s: 1.2, "E" + s: 1.4, "FA" + s: 1.4, "W" + s: 1.6, "HT" + s: 1.4, "HP" + s: 1.4, "TH" + s: 0.9, "K" + s: 1.1, "SH" + s: 1.0, "A" + s: 1.1, "T" + s: 0.8, "HE" + s: 0.8 }, true)
	return reflex


# ---- Helpers -------------------------------------------------------------------

static func _wrap(angle: float) -> float:
	return atan2(sin(angle), cos(angle))


static func _smooth(u: float) -> float:
	return u * u * (3.0 - 2.0 * u)


## A linear progress moved towards its target at a fixed pace (tween.js's approach).
static func _approach(current: float, target: float, step: float) -> float:
	return minf(target, current + step) if current < target else maxf(target, current - step)


## Easing curves (tween.js's `ease`), by name.
static func ease_by(curve: String, t: float) -> float:
	match curve:
		"linear":
			return t
		"inQuad":
			return t * t
		"outQuad":
			return 1.0 - (1.0 - t) * (1.0 - t)
		"outCubic":
			return 1.0 - pow(1.0 - t, 3)
		"outQuart":
			return 1.0 - pow(1.0 - t, 4)
		"inCubic":
			return t * t * t
		"inOutCubic":
			return 4.0 * pow(t, 3) if t < 0.5 else 1.0 - pow(-2.0 * t + 2.0, 3) / 2.0
		"inOutSine":
			return -(cos(PI * t) - 1.0) / 2.0
		"outExpo":
			return 1.0 if t >= 1.0 else 1.0 - pow(2.0, -10.0 * t)
		"outSnap":
			var a := 0.12
			var u := t * t / (2.0 * a) if t < a else t - a / 2.0
			return minf(1.0, 1.0 - pow(1.0 - u / (1.0 - a / 2.0), 3))
		"outBack":
			return 1.0 + 2.70158 * pow(t - 1.0, 3) + 1.70158 * pow(t - 1.0, 2)
	return 1.0 - pow(1.0 - t, 3)


## Euler angles in three.js's XYZ order, as a quaternion.
static func _euler(x: float, y: float, z: float) -> Quaternion:
	return Quaternion(Basis.from_euler(Vector3(x, y, z), EULER_ORDER_XYZ))


static func _clamp_length(v: Vector3, low: float, high: float) -> Vector3:
	var length := v.length()
	return v / (length if length != 0.0 else 1.0) * clampf(length, low, high)


static func _set_length(v: Vector3, length: float) -> Vector3:
	var current := v.length()
	return v / (current if current != 0.0 else 1.0) * length


## three.js's Matrix4.lookAt(eye, target = origin, up) as a basis: its +Z points from the origin to `eye`.
static func _look_basis(eye: Vector3, up: Vector3 = Vector3.UP) -> Basis:
	var z := eye
	if z.length_squared() == 0.0:
		z.z = 1.0
	z = z.normalized()
	var x := up.cross(z)
	if x.length_squared() == 0.0:
		if absf(up.z) == 1.0:
			z.x += 0.0001
		else:
			z.z += 0.0001
		z = z.normalized()
		x = up.cross(z)
	x = x.normalized()
	var y := z.cross(x)
	return Basis(x, y, z)


## Each armour plate's bounds in its own frame (assets/data/trooper.json): { name: { min, max } }.
static func plates() -> Dictionary:
	if _plates.is_empty():
		var file := FileAccess.open("res://assets/data/trooper.json", FileAccess.READ)
		var data: Dictionary = JSON.parse_string(file.get_as_text()) if file else {}
		_plates = data.get("plates", {})
	return _plates


static func model() -> PackedScene:
	if _model == null:
		_model = load("res://assets/baked/stormtrooper.glb")
	return _model


# ---- State ----------------------------------------------------------------------

var draw: Callable
var effects: Object
var lab: Obstacles
var feel: Dictionary
var spawn_position := Vector3.ZERO
var spawn_heading := 0.0

var root: Node3D
var debris: Node3D
var dead := false
var fallen := false
var holding := true
var severed := {}
var events: Array = []
var joints := {}
var parts := {}
var pieces := {}
var holder: Node3D
var ragdoll: Ragdoll
var particle_index := {}
var particle_spec: Array = []
var bodies := {}
var caps := {}
var marks: Array[Node3D] = []
var base := Vector3.ZERO
var feet := {}
var mounts := {}
var held_grenade: MeshInstance3D
## His brain's orders (see build()).
var order := {}
## Set by his squad's mind: he has not seen the hero coming (the first blow of the blade kills).
var unaware := false
## Where the threat is (the hero), so that he gets up facing it.
var focus: Variant = null
## Came in through the door.
var reinforcement := false
var last_throw: Variant = null
var reaction := {}

# Time, a pending collapse, the crawl, death throes, and muscle twitches.
var clock := 0.0
var collapse: Variant = null
var crawl: Variant = null
var spasm: Variant = null
var twitches: Array = []
## Lying dead and still for a moment, the body sleeps: no more physics. Anything that touches it wakes it first.
var sleep := { "still": 0.0, "asleep": false, "bounds": [Vector3.ZERO, Vector3.ZERO], "dead": 0.0, "watch": 0.0, "drift": INF, "anchor": Vector3.ZERO }
# Crawl muscles: per particle, where it should be over the current frame.
var muscles: Array = []
var muscle_state := {}
var drive_clock := 0.0
var drive_span := 1.0 / 60.0
# Knocked down unhurt and getting back up; dragged by the Force; fetching the rifle; a slippery spell on the floor; landings.
var recover: Variant = null
var towing: Variant = null
var pickup: Variant = null
var slick: Variant = null
var landed := 0.0
# Down and hurt by a bolt, alive, waiting for a squadmate; dragged by one's hand.
var hurt: Variant = null
var hauled: Variant = null
# Held up by the Force, dropping back down, running away, turning back.
var levitating: Variant = null
var dropping: Variant = null
var flee: Variant = null
var turn_back: Variant = null
# Run through by the blade; down but alive and pulled (the Force first hauls him upright).
var impaled: Variant = null
var lifting: Variant = null
# Throwing a grenade (the left hand).
var throwing: Variant = null
# Blade blows he has taken standing: the first only burns and staggers him.
var blows := 0
var sparing := false
var wounded_at := -INF
var wounding_blow: Variant = null
# Walking over to his rifle.
var fetching: Variant = null
# Motion capture drives his steps; inertia carries his body.
var loco := { "velocity": Vector3.ZERO, "turn_rate": 0.0, "hip_yaw": 0.0, "backward": false, "lean": 0.0, "bank": 0.0, "last_yaw": 0.0 }
var feed: Array = []
var seed := 0.0
var gait: TrooperGait
var _tweens: Array = []
var _flashes := {}
var _pending: Variant = null
var _last_stagger := -INF
var _grip_right := Vector3(0, -0.06, -0.045)
var _grip_left := Vector3(0, -0.03, 0.17)


## draw: his random numbers (0 → 1); effects: sparks and glows (or null); level: the obstacles.
func _init(at: Vector3 = Vector3.ZERO, heading: float = 0.0, random: Callable = Callable(), level: Obstacles = null, fx: Object = null, feel_data: Dictionary = {}) -> void:
	name = "Stormtrooper"
	spawn_position = at
	spawn_heading = heading
	draw = random if random.is_valid() else func() -> float: return randf()
	lab = level
	effects = fx
	feel = feel_data if not feel_data.is_empty() else CombatController._load("res://assets/data/feel.json")
	loco.last_yaw = heading
	seed = draw.call() * 100.0
	gait = TrooperGait.new(LEG, seed * 0.6180339)


func _ready() -> void:
	if root == null:
		build()


func _random() -> float:
	return draw.call()


func _pick(value: Variant) -> float:
	if value is Array:
		return value[0] + (value[1] - value[0]) * _random()
	return float(value)


func _jitter(t: float, a: float, b: float, c: float) -> float:
	return sin(t * a + seed) * 0.5 + sin(t * b + seed * 1.7 + 1.3) * 0.3 + sin(t * c + seed * 2.3 + 2.1) * 0.2


func build() -> void:
	root = Node3D.new()
	root.name = "Body"
	add_child(root)
	joints = {}
	for entry in JOINTS:
		var joint := Node3D.new()
		joint.name = entry[0]
		joint.position = entry[2]
		(joints[entry[1]] if entry[1] != "" else root).add_child(joint)
		joints[entry[0]] = joint
	# The blaster is carried at low ready, across the belly.
	holder = Node3D.new()
	holder.name = "Blaster holder"
	holder.position = LOW_READY_POSITION
	holder.quaternion = LOW_READY_QUATERNION
	joints.spine.add_child(holder)
	joints.holder = holder
	_load_parts()
	held_grenade = MeshInstance3D.new()
	held_grenade.name = "Grenade in hand"
	var sphere := SphereMesh.new()
	sphere.radius = 0.062
	sphere.height = 0.124
	sphere.radial_segments = 14
	sphere.rings = 10
	held_grenade.mesh = sphere
	held_grenade.material_override = _plain(Color("44494f"))
	held_grenade.position = Vector3(0, -0.1, 0.035)
	held_grenade.visible = false
	parts.handL.add_child(held_grenade)
	mounts = { "head": "neck", "torso": "spine", "pelvis": "pelvis", "blaster": "holder" }
	for s in ["L", "R"]:
		mounts.merge({ "upperArm" + s: "shoulder" + s, "forearm" + s: "elbow" + s, "hand" + s: "wrist" + s, "thigh" + s: "hip" + s, "shin" + s: "knee" + s, "foot" + s: "ankle" + s }, true)
	for part_name in mounts:
		joints[mounts[part_name]].add_child(parts[part_name])

	# Cut caps: dark suit inside, a ring that glows when the joint is severed.
	caps = {}
	for cut_name in CUTS:
		var cut: Dictionary = CUTS[cut_name]
		var at: Vector3 = joints[_spec(cut.particle)[1]].global_position
		var normal: Vector3 = cut.normal
		var pair := []
		for side in [[cut.parent, normal], [cut.child, -normal]]:
			var cap := Node3D.new()
			cap.name = "Cut " + cut_name
			var disc := MeshInstance3D.new()
			disc.mesh = _disc(cut.radius * 0.72)
			disc.material_override = _plain(Color("15161a"))
			disc.position = Vector3(0, 0, 0.002)
			cap.add_child(disc)
			var ring := MeshInstance3D.new()
			ring.mesh = _ring(cut.radius * 0.6, cut.radius * 1.08)
			var ring_material := _glowing()
			ring.material_override = ring_material
			cap.add_child(ring)
			cap.position = at
			cap.quaternion = Quaternion(Vector3(0, 0, 1), side[1])
			cap.visible = false
			cap.set_meta("cap", true)
			root.add_child(cap)
			cap.reparent(parts[side[0]], true)
			pair.append({ "cap": cap, "ring": ring_material })
		caps[cut_name] = pair

	# Ragdoll particles at the joints of the standing pose.
	ragdoll = Ragdoll.new()
	particle_index = {}
	particle_spec = []
	for spec in PARTICLES:
		var index := ragdoll.add_particle((joints[spec[1]] as Node3D).to_global(spec[2]), spec[3], spec[4], spec[0])
		particle_index[spec[0]] = index
		particle_spec.resize(index + 1)
		particle_spec[index] = spec
	bodies = {}
	for entry in BODIES:
		var indices := PackedInt32Array()
		for key in entry[1]:
			indices.append(particle_index[key])
		var body := ragdoll.add_body(entry[0], indices, parts[entry[0]])
		body.capsule = entry[2]
		body.capsule_slots = PackedInt32Array([entry[1].find(entry[2][0]), entry[1].find(entry[2][1])])
		body.last_hit = -INF
		bodies[entry[0]] = body
	for cut_name in CUTS:
		ragdoll.connect_bodies(bodies[CUTS[cut_name].parent], bodies[CUTS[cut_name].child])
	# Joint ranges keep the fall anatomical; each belongs to its joint.
	var p := particle_index
	ragdoll.add_limit(p.HT, p.W, 0.6, INF, "neck")
	ragdoll.add_limit(p.HT, p.SL, 0.24, INF, "neck")
	ragdoll.add_limit(p.HT, p.SR, 0.24, INF, "neck")
	ragdoll.add_limit(p.N, p.HL, 0.36, INF, "waist")
	ragdoll.add_limit(p.N, p.HR, 0.36, INF, "waist")
	for s in ["L", "R"]:
		ragdoll.add_limit(p["S" + s], p["W" + s], 0.15, INF, "elbow" + s)
		ragdoll.add_limit(p["E" + s], p["HT" + s], 0.22, INF, "wrist" + s)
		ragdoll.add_limit(p["H" + s], p["A" + s], 0.3, INF, "knee" + s)
		ragdoll.add_limit(p["K" + s], p["T" + s], 0.3, INF, "ankle" + s)
		ragdoll.add_limit(p["K" + s], p.N, 0.45, INF, "hip" + s)
		ragdoll.add_limit(p["E" + s], p.SR if s == "L" else p.SL, 0.26, INF, "shoulder" + s)
	ragdoll.connect_bodies(bodies.blaster, bodies.handR)
	ragdoll.connect_bodies(bodies.blaster, bodies.handL)
	ragdoll.connect_bodies(bodies.blaster, bodies.torso)
	ragdoll.drivers.append(_drive)
	ragdoll.obstacles = lab

	debris = Node3D.new()
	debris.name = "Stormtrooper parts"
	add_child(debris)
	root.position = spawn_position
	root.quaternion = Quaternion(Vector3.UP, spawn_heading)
	dead = false
	fallen = false
	holding = true
	severed = {}
	marks = []
	collapse = null; crawl = null; spasm = null; recover = null; towing = null; pickup = null; slick = null
	levitating = null; dropping = null; flee = null; turn_back = null; lifting = null; fetching = null; throwing = null; impaled = null
	hurt = null
	hauled = null
	sleep.still = 0.0; sleep.dead = 0.0; sleep.watch = 0.0
	sleep.drift = INF
	sleep.asleep = false
	blows = 0
	wounded_at = -INF
	wounding_blow = null
	feed = []
	twitches = []
	muscles = []
	muscle_state = {}
	reaction = {
		"yaw": 0.0, "pitch": 0.0, "roll": 0.0, "head": 0.0, "headYaw": 0.0, "headRoll": 0.0, "buckle": 0.0, "armL": 0.0, "armR": 0.0, "flareL": 0.0, "flareR": 0.0, "dipL": 0.0, "dipR": 0.0,
		"vyaw": 0.0, "vpitch": 0.0, "vroll": 0.0, "vhead": 0.0, "vheadYaw": 0.0, "vheadRoll": 0.0, "vbuckle": 0.0, "varmL": 0.0, "varmR": 0.0, "vflareL": 0.0, "vflareR": 0.0, "vdipL": 0.0, "vdipR": 0.0,
		"offset": Vector3.ZERO, "push": Vector3.ZERO, "imbalance": 0.0,
		"holdL": 1.0, "holdR": 1.0, "letGo": { "L": 0.0, "R": 0.0 }, "hurt": 0.0, "clutch": 0.0, "wound": null, "woundAge": 0.0,
		"press": null, "pressAt": null, "pressHand": null, "pressing": 0.0, "limp": 0.0,
		"linear": { "hurt": 0.0, "clutch": 0.0, "pressing": 0.0, "limp": 0.0, "holdL": 1.0, "holdR": 1.0, "crouch": 0.0, "aim": 0.0, "blind": 0.0, "stoop": 0.0 },
		"kneel": 0.0, "yank": 0.0, "daze": 0.0, "reachFor": null, "stoop": 0.0,
		"knock": Vector3.ZERO, "spin": 0.0, "run": 0.0, "dangle": 0.0, "stride": 0.0, "choke": 0.0,
		"gait": 1.0, "crouch": 0.0, "aim": 0.0, "blind": 0.0, "attention": 0.0, "recoil": 0.0, "vrecoil": 0.0,
	}
	# Orders from his brain: how to move, where to face, what to aim at, whether to crouch;
	# drag: where his free hand holds a fallen squadmate's collar; tend: where it rests on him.
	order = { "velocity": Vector3.ZERO, "face": null, "aim_at": null, "aim": false, "crouch": false, "blind": false, "over": null, "look": null, "drag": null, "tend": null }
	loco.turn_rate = 0.0
	loco.hip_yaw = 0.0
	loco.backward = false
	loco.lean = 0.0
	loco.bank = 0.0
	loco.last_yaw = spawn_heading
	loco.velocity = Vector3.ZERO
	base = joints.pelvis.position
	# Where his feet stand: leg IK keeps them planted while the body sways.
	joints.pelvis.position.y = base.y - 0.015
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		joints["hip" + s].quaternion = _euler(-0.06, 0, sign * 0.06)
		joints["knee" + s].quaternion = _euler(0.12, 0, 0)
		joints["ankle" + s].quaternion = _euler(-0.06, 0, -sign * 0.06)
	var inverse := root.quaternion.inverse()
	feet = {}
	for s in ["L", "R"]:
		var ankle: Node3D = joints["ankle" + s]
		feet[s] = { "position": root.to_local(ankle.global_position), "quaternion": inverse * ankle.global_basis.get_rotation_quaternion() }
	_pose(0.0, 0.0)
	_place_particles(1.0 / 60.0)
	_place_particles(1.0 / 60.0)


func _spec(particle_name: String) -> Array:
	for spec in PARTICLES:
		if spec[0] == particle_name:
			return spec
	return []


## The parts from the baked model: each its own mesh, its plates as pieces of their own.
func _load_parts() -> void:
	var instance := model().instantiate()
	parts = {}
	pieces = {}
	for entry in BODIES:
		var part: Node3D = instance.find_child(entry[0], true, false)
		part.get_parent().remove_child(part)
		part.transform = Transform3D.IDENTITY
		parts[entry[0]] = part
		for child in part.get_children():
			if child is MeshInstance3D:
				continue
			child.set_meta("armour", true)
			# Its bounds in its own frame, as the web measures them: where it is, how big (for knocking it off).
			var bounds: Dictionary = plates().get(String(child.name), {})
			var low := Vector3(bounds.min[0], bounds.min[1], bounds.min[2]) if not bounds.is_empty() else Vector3.ZERO
			var high := Vector3(bounds.max[0], bounds.max[1], bounds.max[2]) if not bounds.is_empty() else Vector3.ZERO
			child.set_meta("box", AABB(low, high - low))
			pieces[child.name] = child
	instance.free()


static func _plain(colour: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.roughness = 0.8
	return material


## A material that glows when told to (effects.glow): unlit, black until then.
static func _glowing() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.albedo_color = Color(0, 0, 0)
	return material


static func _disc(r: float, segments: int = 16) -> ArrayMesh:
	var vertices := PackedVector3Array()
	for k in segments:
		var a := TAU * k / segments
		var b := TAU * (k + 1) / segments
		vertices.append_array([Vector3.ZERO, Vector3(cos(b), sin(b), 0) * r, Vector3(cos(a), sin(a), 0) * r])
	return _mesh(vertices)


static func _ring(inner: float, outer: float, segments: int = 12) -> ArrayMesh:
	var vertices := PackedVector3Array()
	for k in segments:
		var a := TAU * k / segments
		var b := TAU * (k + 1) / segments
		var ia := Vector3(cos(a), sin(a), 0) * inner
		var ib := Vector3(cos(b), sin(b), 0) * inner
		var oa := Vector3(cos(a), sin(a), 0) * outer
		var ob := Vector3(cos(b), sin(b), 0) * outer
		vertices.append_array([ia, ob, oa, ia, ib, ob])
	return _mesh(vertices)


static func _mesh(vertices: PackedVector3Array) -> ArrayMesh:
	var normals := PackedVector3Array()
	normals.resize(vertices.size())
	normals.fill(Vector3(0, 0, 1))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _arm_cut(side: String) -> bool:
	return severed.has("shoulder" + side) or severed.has("elbow" + side) or severed.has("wrist" + side)


## His heading, read from the root whatever its rotation says; _face() sets it.
func heading_of() -> float:
	var forward := root.quaternion * Vector3(0, 0, 1)
	return atan2(forward.x, forward.z)


func _face(angle: float) -> void:
	root.quaternion = Quaternion(Vector3.UP, angle)


func _turn_to(angle: float, rate: float, dt: float) -> void:
	_face(heading_of() + _wrap(angle - heading_of()) * (1.0 - exp(-rate * dt)))


static func _shiver(time: float, scale: float) -> Vector3:
	return Vector3(sin(time * 23.0) * scale, sin(time * 19.0 + 1.0) * scale, sin(time * 29.0 + 2.0) * scale)


# ---- IK (port of src/ik.js) ------------------------------------------------------

## Rotates bone so that the direction from → current becomes from → desired.
static func _aim_bone(bone: Node3D, from: Vector3, current: Vector3, desired: Vector3) -> void:
	var delta := Quaternion((current - from).normalized(), (desired - from).normalized())
	var world := delta * bone.global_basis.get_rotation_quaternion()
	var parent := (bone.get_parent() as Node3D).global_basis.get_rotation_quaternion()
	bone.quaternion = parent.inverse() * world


static func _solve_two_bone(upper: Node3D, lower: Node3D, end: Node3D, target: Vector3, pole: Vector3) -> void:
	var s := upper.global_position
	var e := lower.global_position
	var h := end.global_position
	var length_a := s.distance_to(e)
	var length_b := e.distance_to(h)
	var direction := target - s
	var distance := clampf(direction.length(), absf(length_a - length_b) + 1e-3, length_a + length_b - 1e-3)
	direction = direction.normalized()
	var cosine := clampf((length_a * length_a + distance * distance - length_b * length_b) / (2.0 * length_a * distance), -1.0, 1.0)
	var bend := pole - s
	bend -= direction * bend.dot(direction)
	if bend.length_squared() < 1e-8:
		bend = Vector3(0, -1, 0)
	bend = bend.normalized()
	var elbow := s + direction * (length_a * cosine) + bend * (length_a * sqrt(1.0 - cosine * cosine))
	var reach := s + direction * distance
	_aim_bone(upper, s, e, elbow)
	_aim_bone(lower, lower.global_position, end.global_position, reach)


## Two-bone IK of an arm towards a world target, blended in by weight.
func _reach(side: String, target: Vector3, pole: Vector3, weight: float) -> void:
	if weight < 0.01:
		return
	var shoulder: Node3D = joints["shoulder" + side]
	var elbow: Node3D = joints["elbow" + side]
	var rest_upper := shoulder.quaternion
	var rest_lower := elbow.quaternion
	_solve_two_bone(shoulder, elbow, joints["wrist" + side], target, pole)
	if weight < 1.0:
		shoulder.quaternion = HeroAnimator._slerp(rest_upper, shoulder.quaternion, weight)
		elbow.quaternion = HeroAnimator._slerp(rest_lower, elbow.quaternion, weight)


## Turns an upper arm so its elbow end points at a world target.
func _aim_arm(side: String, target: Vector3, weight: float) -> void:
	var shoulder: Node3D = joints["shoulder" + side]
	var rest_upper := shoulder.quaternion
	_aim_bone(shoulder, shoulder.global_position, (joints["elbow" + side] as Node3D).global_position, target)
	shoulder.quaternion = HeroAnimator._slerp(rest_upper, shoulder.quaternion, weight)


func _off(joint: Node3D, x: float, y: float, z: float) -> void:
	joint.quaternion = joint.quaternion * _euler(x, y, z)


# ---- The pose -----------------------------------------------------------------------

func _spring(key: String, dt: float, k: float = 55.0, damping: float = 7.0) -> void:
	var r := reaction
	r["v" + key] += (-k * r[key] - damping * r["v" + key]) * dt
	r[key] += r["v" + key] * dt


func _glide(key: String, target: float, seconds: float, curve: String, dt: float) -> void:
	var r := reaction
	r.linear[key] = _approach(r.linear[key], target, dt / seconds)
	r[key] = ease_by(curve, r.linear[key])


func _pose(time: float, dt: float) -> void:
	var r := reaction
	# Damped springs: hits kick them, they settle back.
	for key in REACTION_SPRINGS:
		_spring(key, dt)
	# The rifle's kick: sharp, and gone in a moment.
	_spring("recoil", dt, 320.0, 20.0)
	r.push = r.push * exp(-5.0 * dt)
	r.offset = r.offset + r.push * dt
	r.imbalance = maxf(0.0, r.imbalance - dt * 0.4)
	# A wound: he hunches over it, looks down at it, and after a moment of
	# shock draws it in and holds it with the other hand.
	if r.wound != null:
		r.woundAge += dt
	if r.press != null:
		r.press.age += dt
		if r.press.age > r.press.duration:
			r.press = null
	# Blends move at a steady pace and are read through easing curves.
	_glide("hurt", 1.0 if r.wound != null else 0.0, 0.45, "outCubic", dt)
	_glide("clutch", 1.0 if r.wound != null and r.woundAge > 0.35 else 0.0, 0.5, "inOutCubic", dt)
	_glide("pressing", 1.0 if r.press != null else 0.0, 0.22 if r.press != null else 0.45, "inOutSine", dt)
	_glide("limp", 1.0 if collapse != null else 0.0, 0.28, "inQuad", dt)
	# Hands on the rifle, unless hurt, flung off it, or pressed on a burn.
	var o := order
	var grips := {}
	for s in ["L", "R"]:
		r.letGo[s] = maxf(0.0, r.letGo[s] - dt)
		grips[s] = not _arm_cut(s) and r.wound == null and r.letGo[s] <= 0.0 and not (r.press != null and r.pressHand == s) and not (throwing != null and s == "L") and not (s == "L" and (o.drag != null or o.tend != null))
	if holding and not grips.L and not grips.R:
		_drop_blaster(Vector3.ZERO)
	_glide("holdL", 1.0 if holding and grips.L else 0.0, 0.25, "inOutSine", dt)
	_glide("holdR", 1.0 if holding and grips.R else 0.0, 0.25, "inOutSine", dt)
	var toward := (1.0 if r.wound.side == "L" else -1.0) if r.wound != null else 0.0
	var gasp: float = sin(time * 4.2) * 0.025 * r.hurt
	var rock: float = sin(time * 1.3) * 0.035 * r.hurt
	var press_side := 1.0 if r.pressHand == "L" else -1.0

	# Dazed after getting up: he sways and his head lolls for a moment.
	r.daze = maxf(0.0, r.daze - dt)
	var dazed := minf(1.0, r.daze / 0.6)
	var sway := sin(time * 2.6) * 0.1 * dazed
	var loll := sin(time * 3.1 + 1.0) * 0.16 * dazed
	var kneel: float = r.kneel
	var yank: float = r.yank
	# Held in the air the legs dangle and kick.
	r.dangle += ((1.0 if levitating != null or impaled != null else 0.0) - r.dangle) * (1.0 - exp(-8.0 * dt))
	var dangle: float = r.dangle
	# Choked by the Force while it pulls or holds him: the hands fly to the
	# throat at once and let go slowly. On the blade he fights the same way.
	var choking: bool = levitating != null or (towing != null and towing.kind == "stand") or lifting != null or impaled != null
	r.choke += ((1.0 if choking else 0.0) - r.choke) * (1.0 - exp(-(14.0 if choking else 4.0) * dt))
	var choke: float = r.choke
	var fight: float = choke * ((0.25 + 1.1 * impaled.vigour) if impaled != null else 1.0) * (0.7 + 0.3 * sin(time * 1.9 + seed) * sin(time * 0.83 + seed))
	var breathe := sin(time * 1.7)
	# His orders: crouched behind cover, the rifle shouldered and aimed, eyes on something.
	var able := towing == null and levitating == null and dropping == null and lifting == null and pickup == null and fetching == null and flee == null and impaled == null
	_glide("crouch", 1.0 if able and o.crouch and r.wound == null else 0.0, 0.3, "inOutCubic", dt)
	_glide("stoop", 1.0 if able and o.drag != null and r.wound == null else 0.0, 0.25, "inOutSine", dt)
	var aim_target: Variant = o.aim_at
	_glide("aim", 1.0 if able and o.aim and aim_target != null and holding and r.wound == null and r.daze < 0.3 else 0.0, 0.24 if o.aim else 0.4, "outCubic", dt)
	# Blind fire: crouched behind cover, the rifle up over it, head down.
	_glide("blind", 1.0 if able and o.blind and aim_target != null and holding and r.wound == null and r.daze < 0.3 else 0.0, 0.32, "inOutCubic", dt)
	var look_at: Variant = o.look if o.look != null else (aim_target if o.aim else null)
	r.attention = _approach(r.attention, 1.0 if look_at != null and not choking else 0.0, dt / 0.3)
	var crouch: float = r.crouch
	var aim: float = r.aim
	var attend: float = r.attention
	var look: float = (sin(time * 0.33) * 0.22 + sin(time * 0.71) * 0.08) * (1.0 - r.hurt) * (1.0 - r.pressing * 0.7) * (1.0 - dazed) * (1.0 - kneel) * (1.0 - attend)
	var dip: float = r.dipL + r.dipR
	var tilt: float = r.dipR - r.dipL

	# Base layer: the captured gait, on his feet (not while he hangs in the
	# Force's grip or is dragged through the air).
	var grounded: bool = levitating == null and not (towing != null and towing.kind == "stand") and dropping == null and lifting == null and impaled == null
	r.gait = _approach(r.gait, 1.0 if grounded else 0.0, dt / (0.25 if grounded else 0.1))
	var g: float = r.gait
	var keep := 1.0 - g
	gait.update(dt, loco.velocity.length() + r.knock.length() * 0.6, loco.backward, loco.turn_rate)
	gait.twist(loco.hip_yaw * g)
	for joint_name in TrooperGait.JOINTS:
		joints[joint_name].quaternion = HeroAnimator._slerp(Quaternion.IDENTITY, gait.rotations[joint_name], g)
	joints.pelvis.position = base + gait.hips * g
	var root_inverse := root.quaternion.inverse()
	if g > 0.0:
		# Ground pass: the lowest sole meets the floor (the run's flight lifts it).
		var lowest := INF
		for s in ["L", "R"]:
			var ankle: Node3D = joints["ankle" + s]
			for sole: Vector3 in SOLES:
				lowest = minf(lowest, root.to_local(ankle.to_global(sole)).y)
		joints.pelvis.position.y += (gait.ground() - lowest) * g
		# Where the steps put his feet: the legs keep them there while the body reacts.
		for side in SIDES:
			var s: String = side[0]
			var sign: float = side[1]
			var ankle: Node3D = joints["ankle" + s]
			var foot: Dictionary = feet[s]
			foot.position = root.to_local(ankle.global_position)
			foot.quaternion = root_inverse * ankle.global_basis.get_rotation_quaternion()
			# At rest he stands square, feet apart; crouched, one foot steps forward and the other well back.
			foot.position.x += sign * 0.05 * (1.0 - gait.state.motion) * (1.0 - crouch)
			if crouch > 0.0:
				foot.position += Vector3(sign * 0.04, 0, 0.1 if s == "L" else -0.24) * crouch
	# Where he aims and looks, from his chest.
	var aim_yaw := 0.0
	var aim_pitch := 0.0
	var look_yaw := 0.0
	var look_pitch := 0.0
	if aim_target != null and aim > 0.0:
		var t := root.to_local(aim_target)
		aim_yaw = clampf(atan2(t.x, t.z), -0.9, 0.9) * aim
		aim_pitch = clampf(-atan2(t.y - 1.35, Vector2(t.x, t.z).length()), -0.4, 0.5) * aim
	if look_at != null:
		var t := root.to_local(look_at)
		look_yaw = clampf(atan2(t.x, t.z) - aim_yaw, -1.2, 1.2)
		look_pitch = clampf(-atan2(t.y - 1.5, Vector2(t.x, t.z).length()) - aim_pitch, -0.5, 0.6)
	# Throwing: the torso winds up (left shoulder back), whips round as the
	# arm comes over, and follows through; the hand travels its path.
	var throw_yaw := 0.0
	var throw_pitch := 0.0
	var throw_weight := 0.0
	var throw_hand := Vector3.ZERO
	if throwing != null:
		var p := minf(1.0, throwing.age / throwing.duration)
		if p < 0.38:
			var u := ease_by("inOutCubic", p / 0.38)
			throw_hand = THROW_GRIP.lerp(THROW_WIND, u)
			throw_yaw = 0.5 * u
			throw_pitch = -0.12 * u
		elif p < 0.52:
			var u := ease_by("inQuad", (p - 0.38) / 0.14)
			throw_hand = THROW_WIND.lerp(THROW_RELEASE, u)
			throw_yaw = 0.5 - 0.95 * u
			throw_pitch = -0.12 + 0.36 * u
		else:
			var u := ease_by("outCubic", (p - 0.52) / 0.48)
			throw_hand = THROW_RELEASE.lerp(THROW_FOLLOW, u)
			throw_yaw = -0.45 * (1.0 - u)
			throw_pitch = 0.24 * (1.0 - u)
		throw_weight = minf(1.0, p / 0.08) if p < 0.85 else maxf(0.0, 1.0 - (p - 0.85) / 0.15)
	held_grenade.visible = throwing != null and not throwing.released
	# Reactions on top, in each joint's own frame.
	var writhe := func(a: float, b: float, c: float) -> float: return _jitter(time, a, b, c) * fight
	var pelvis: Node3D = joints.pelvis
	pelvis.position.x += sin(time * 0.5) * 0.008 + r.offset.x
	pelvis.position.y -= 0.015 * keep + r.buckle * 0.07 + r.hurt * 0.035 + dip * 0.05 + r.limp * 0.15 + kneel * 0.42 + dazed * 0.025 + crouch * 0.38 + 0.02 * g + r.stoop * 0.2
	pelvis.position.z += r.offset.z - kneel * 0.05 - crouch * 0.05
	# Choking, the hips swing and thrust as he fights the grip.
	_off(pelvis, r.pitch * 0.3 + yank * 0.15 + crouch * 0.22 + writhe.call(4.3, 7.1, 2.3) * 0.28, r.yaw * 0.4 + writhe.call(3.7, 6.3, 1.9) * 0.34, r.roll * 0.4 + tilt * 0.22 + writhe.call(4.1, 6.9, 2.7) * 0.24)
	_off(joints.spine, -0.03 * keep + breathe * 0.012 + r.pitch * 0.7 + r.hurt * 0.26 + gasp + rock + r.pressing * 0.14 + r.limp * 0.45 + kneel * 0.75 + yank * 0.4 + dazed * 0.12 - dangle * 0.1 - choke * 0.14 + writhe.call(5.1, 8.3, 2.9) * 0.24 + crouch * 0.18 + r.stoop * 0.8 + loco.lean + aim_pitch * 0.6 - r.recoil * 0.05 + throw_pitch * throw_weight,
		r.yaw * 0.6 + toward * r.hurt * 0.2 + writhe.call(4.3, 7.7, 2.1) * 0.32 + aim_yaw + throw_yaw * throw_weight, r.roll * 0.6 + toward * r.hurt * 0.06 - tilt * 0.16 + sway + writhe.call(4.9, 8.1, 3.1) * 0.26 + loco.bank)
	# Aiming, his cheek goes down onto the stock.
	_off(joints.neck, 0.05 * keep + r.head * 0.6 + r.hurt * 0.38 + r.pressing * 0.32 - kneel * 0.5 - yank * 0.35 * (1.0 - choke) + dazed * 0.15 - choke * 0.5 + writhe.call(19.7, 29.3, 9.1) * 0.18 + ((look_pitch - aim_pitch * 0.4) * attend + aim * 0.12 - crouch * 0.28) * (1.0 - choke) - r.stoop * 0.45,
		(look + look_yaw * attend - r.yaw * 0.5 + r.head * 0.3 + r.headYaw + toward * r.hurt * 0.35 + press_side * r.pressing * 0.3) * (1.0 - choke) + writhe.call(16.3, 25.9, 7.7) * 0.32, r.roll * -0.3 + r.headRoll + loll - aim * 0.14 + writhe.call(17.3, 27.1, 8.9) * 0.2)
	# Blind fire: head down behind the cover, back bent over.
	if r.blind > 0.001:
		_off(joints.neck, 0.45 * r.blind, 0, 0)
		_off(joints.spine, 0.14 * r.blind, 0, 0)
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		# In the air the legs kick frantically and out of step; slower while only dangling.
		var kick := (sin(time * 4.6 + sign * 1.3) * 0.3 * (1.0 - choke) + _jitter(time + sign * 3.1, 7.9, 12.1, 4.3) * 0.5 * fight) * dangle
		_off(joints["hip" + s], -0.06 * keep - r.buckle * 0.5 - r.hurt * 0.22 - 0.25 * dangle + kick, 0, sign * 0.06 * keep)
		_off(joints["knee" + s], 0.12 * keep + r.buckle * 0.9 + r.hurt * 0.38 + yank * 0.6 + (0.45 + kick) * dangle, 0, 0)
		_off(joints["ankle" + s], -0.06 * keep + 0.55 * dangle, 0, -sign * 0.06 * keep)
		# Without the rifle the arms swing with his steps, flung by the hits —
		# back while he is dragged, forward towards the floor while he crouches —
		# held a little out from the bulky armour.
		var arm: float = r["arm" + s]
		_off(joints["shoulder" + s], -0.15 * keep + arm + yank * 0.9 - kneel * 0.9 - sin(time * 3.7 + sign) * 0.35 * dangle, 0, sign * (0.12 * keep + 0.1 * g + absf(arm) * 0.5 + yank * 0.35) + r["flare" + s])
		_off(joints["elbow" + s], -0.35 * keep - 0.12 * g - r.limp * 0.4 - kneel * 0.4, 0, 0)
	# The rifle: at low ready, or shouldered and aimed — with the recoil's kick.
	holder.position = LOW_READY_POSITION.lerp(SHOULDERED, aim)
	holder.quaternion = LOW_READY_QUATERNION
	if aim_target != null and aim > 0.001:
		var t: Vector3 = (joints.spine as Node3D).to_local(aim_target) - SHOULDERED
		holder.quaternion = HeroAnimator._slerp(holder.quaternion, _look_basis(t).get_rotation_quaternion(), aim)
	if aim_target != null and r.blind > 0.001:
		# Over the top (as high as the cover asks, within reach), pointed roughly
		# his way, wavering: he cannot see where it goes.
		var spine: Node3D = joints.spine
		var over := BLIND
		if o.over != null:
			over = spine.to_global(over)
			over.y = maxf(over.y, o.over)
			over = _clamp_length(spine.to_local(over), 0.0, 1.08)
		holder.position = holder.position.lerp(over, r.blind)
		var t := spine.to_local(aim_target) - over
		t.x += sin(time * 5.1 + seed * 2.0) * 0.45
		t.y += sin(time * 7.3 + seed) * 0.35
		holder.quaternion = HeroAnimator._slerp(holder.quaternion, _look_basis(t).get_rotation_quaternion(), r.blind)
	holder.position.z -= r.recoil * 0.05
	holder.quaternion = holder.quaternion * Quaternion(Vector3(1, 0, 0), -r.recoil * 0.3)
	# Feet stay where the steps put them: the knees take up every dip and sway (unless he is off the ground).
	var root_quaternion := root.quaternion
	if dangle < 0.5 and g > 0.3:
		for side in SIDES:
			var s: String = side[0]
			var sign: float = side[1]
			var knee: Node3D = joints["knee" + s]
			var ankle: Node3D = joints["ankle" + s]
			_solve_two_bone(joints["hip" + s], knee, ankle, root.to_global(feet[s].position), root.to_global(Vector3(sign * 0.12, 0.5, 0.8).rotated(Vector3.UP, loco.hip_yaw)))
			ankle.quaternion = knee.global_basis.get_rotation_quaternion().inverse() * (root_quaternion * feet[s].quaternion)
	# Rifle in hand: each hand reaches its grip.
	for grip in [["R", -1.0, _grip_right], ["L", 1.0, _grip_left]]:
		var s: String = grip[0]
		if _arm_cut(s):
			continue
		_reach(s, holder.to_global(grip[2]), (joints["shoulder" + s] as Node3D).to_global(Vector3(grip[1] * 0.35, -0.3, -0.3)), r["hold" + s])
	# The throwing hand on its path, elbow out and back.
	if throw_weight > 0.01 and not _arm_cut("L"):
		_reach("L", (joints.spine as Node3D).to_global(throw_hand), (joints.shoulderL as Node3D).to_global(Vector3(0.45, -0.05, -0.35)), throw_weight)
	# The wounded arm is drawn in — a forearm across the belly, an upper arm
	# tucked to his side — and the other hand holds the stump, trembling.
	var wound: Variant = r.wound
	if wound != null and r.clutch > 0.01:
		var side: String = wound.side
		var sign := 1.0 if side == "L" else -1.0
		var kind: String = wound.joint.substr(0, wound.joint.length() - 1)
		if kind == "wrist":
			var target := (joints.spine as Node3D).to_global(Vector3(-sign * 0.03, 0.16 + sin(time * 2.1) * 0.01, 0.28))
			_reach(side, target, (joints["shoulder" + side] as Node3D).to_global(Vector3(sign * 0.5, -0.2, -0.4)), r.clutch)
		elif kind == "elbow":
			_aim_arm(side, (joints.spine as Node3D).to_global(Vector3(sign * 0.2, 0.07, 0.17)), r.clutch)
		var healthy := "R" if side == "L" else "L"
		if not _arm_cut(healthy):
			var stump: Node3D = caps[wound.joint][0].cap
			var target: Vector3
			if kind == "shoulder":
				target = stump.to_global(Vector3(0, 0, 0.05))
			else:
				var at := stump.global_position
				var inward := (joints["shoulder" + healthy] as Node3D).global_position - at
				inward.y = 0.0
				inward = inward.normalized()
				target = at + inward * (0.05 if kind == "wrist" else 0.04) + Vector3(0, 0.045, 0)
			target += _shiver(time, 0.006)
			_reach(healthy, target, (joints["shoulder" + healthy] as Node3D).to_global(Vector3(-sign * 0.4, -0.35, -0.2 if kind == "wrist" else 0.1)), r.clutch)
	# Choking: both hands at his throat, tugging at the grip he cannot see.
	# Run through: they clutch at the blade before his chest.
	if choke > 0.01:
		for side in SIDES:
			var s: String = side[0]
			var sign: float = side[1]
			if _arm_cut(s):
				continue
			var tug := _jitter(time + sign * 1.7, 24.1, 37.7, 15.3) * 0.022 * (0.4 + fight)
			var spine: Node3D = joints.spine
			var target := spine.to_global(Vector3(sign * (0.06 + tug * 0.5), 0.17 + tug, 0.27 + tug * 0.8)) if impaled != null else spine.to_global(Vector3(sign * (0.085 + tug * 0.4), 0.27 + tug, 0.155 + tug * 0.6))
			_reach(s, target, (joints["shoulder" + s] as Node3D).to_global(Vector3(sign * 0.45, -0.35, 0.05)), choke)
	# A fallen squadmate: the free hand holds his collar to drag him, or rests on his chest to treat him.
	var tend: Variant = o.drag if o.drag != null else o.tend
	if tend != null and not _arm_cut("L"):
		_reach("L", tend, (joints.shoulderL as Node3D).to_global(Vector3(0.4, -0.3, -0.2)), maxf(maxf(r.stoop, r.crouch if o.tend != null else 0.0), 1.0 - r.holdL))
	# Fetching the rifle: the right hand goes to it.
	if r.reachFor != null:
		_reach("R", r.reachFor.point, (joints.shoulderR as Node3D).to_global(Vector3(-0.35, -0.3, 0.2)), r.reachFor.weight)
	# A fresh scorch: a hand presses on it for a moment.
	if r.pressing > 0.01 and r.pressAt != null and not _arm_cut(r.pressHand):
		var press_at: Vector3 = r.pressAt
		var outward := Vector3(press_at.x, 0, press_at.z).normalized()
		var target := (joints.spine as Node3D).to_global(press_at + outward * 0.07 + Vector3(0, 0.05, 0)) + _shiver(time, 0.004)
		_reach(r.pressHand, target, (joints["shoulder" + r.pressHand] as Node3D).to_global(Vector3(press_side * 0.4, -0.3, -0.2)), r.pressing)


func _place_particles(dt: float) -> void:
	for spec in PARTICLES:
		var index: int = particle_index[spec[0]]
		if ragdoll.is_kinematic(index):
			ragdoll.place(index, (joints[spec[1]] as Node3D).to_global(spec[2]), dt)


func _sync_objects() -> void:
	for body in ragdoll.bodies:
		if not body.dynamic or body.object == null:
			continue
		body.object.transform = ragdoll.object_transform(body)


func _release(names: Array) -> void:
	var list := []
	for entry in names:
		var body: Ragdoll.Body = bodies[entry] if entry is String else entry
		if body.dynamic:
			continue
		var object := body.object
		object.reparent(debris, true)
		ragdoll.bind(body, object.global_transform)
		list.append(body)
	ragdoll.release(list)


func _subtree(part: String, out: Array = []) -> Array:
	out.append(part)
	for cut_name in CUTS:
		if CUTS[cut_name].parent == part and not severed.has(cut_name):
			_subtree(CUTS[cut_name].child, out)
	return out


func _indices_of(names: Array) -> PackedInt32Array:
	var list := PackedInt32Array()
	for part in names:
		list.append_array((bodies[part] as Ragdoll.Body).indices)
	return list


static func _unique(indices: PackedInt32Array) -> PackedInt32Array:
	var seen := {}
	var list := PackedInt32Array()
	for index in indices:
		if not seen.has(index):
			seen[index] = true
			list.append(index)
	return list


func _local(vector: Vector3) -> Vector3:
	return root.quaternion.inverse() * vector


func _world(vector: Vector3) -> Vector3:
	return root.quaternion * vector


## A tumble: velocities around a random axis through the body's centre.
func _spin(names: Array, rate: float) -> void:
	for part in names:
		var body: Ragdoll.Body = bodies[part]
		var centre := Vector3.ZERO
		for index in body.indices:
			centre += ragdoll.position(index)
		centre /= body.indices.size()
		var x := _random() - 0.5
		var y := _random() - 0.5
		var z := _random() - 0.5
		var axis := Vector3(x, y, z).normalized() * rate
		for index in body.indices:
			ragdoll.push(PackedInt32Array([index]), -(ragdoll.position(index) - centre).cross(axis))


func _loosen(indices: PackedInt32Array) -> void:
	for index in indices:
		ragdoll.set_surface(index, LOOSE_FRICTION, LOOSE_BOUNCE)


## Throws a severed piece with the blade's momentum: carried along the sweep
## and popped up into an arc, spinning about the cut like a struck stick.
## Light pieces fly further, a heavy one mostly drops, and a touch of
## controlled chance keeps two throws from matching. From there on it is
## simulated — gravity, drag, tumbling, bounces — never scripted.
func _launch(names: Array, hit: Dictionary, cut_at: Vector3) -> Dictionary:
	var indices := _unique(_indices_of(names))
	var mass := 0.0
	var centre := Vector3.ZERO
	for index in indices:
		var weight := 1.0 / ragdoll.inverse_mass[index]
		mass += weight
		centre += ragdoll.position(index) * weight
	centre /= mass
	# The sweep: how the blade moved across its own length at the contact.
	var sweep: Vector3 = hit.velocity
	if hit.get("direction") != null:
		sweep -= hit.direction * sweep.dot(hit.direction)
	var speed := sweep.length()
	var along: Vector3
	if speed > 1e-3:
		along = sweep / speed
	else:
		var ax := _random() - 0.5
		along = Vector3(ax, 0, _random() - 0.5).normalized()
	var vary := func(amount: float = 0.15) -> float: return 1.0 + (_random() - 0.5) * 2.0 * amount
	var lightness := clampf(2.2 / mass, 0.22, 1.3)
	# Out along the sweep, a little away from his body, turned a touch at random; never far — it lands near him.
	var throw_speed: float = clampf(speed * 0.3, 0.5, 2.6) * lightness * vary.call()
	var velocity := Vector3(along.x, 0, along.z) * throw_speed
	var away := centre - particle("W")
	away.y = 0.0
	if away.length_squared() > 1e-6:
		velocity += away.normalized() * (0.5 * lightness)
	var least := 0.8 * lightness
	if velocity.length() < least:
		velocity = _set_length(velocity, least)
	velocity = velocity.rotated(Vector3.UP, (_random() - 0.5) * 0.4)
	# Up into an arc: high off an upswing, a low skip off a downward chop.
	var lift: float = clampf(2.6 + along.y * 1.6, 1.2, 4.2) * (0.55 + 0.45 * lightness) * clampf(0.6 + speed * 0.08, 0.7, 1.2) * vary.call()
	velocity.y += lift
	# Spin: the blade drives the cut end, so the piece turns about its centre.
	var lever := cut_at - centre
	var spin := Vector3.ZERO
	if lever.length_squared() > 1e-4:
		spin = lever.cross(along) * (clampf(speed * 0.45, 1.5, 6.0) * vary.call(0.25) / lever.length_squared())
		var rate := clampf(spin.length(), 3.0, 15.0) * (0.6 + 0.4 * lightness)
		if spin.length_squared() > 1e-8:
			spin = _set_length(spin, rate)
		spin += lever.normalized() * ((_random() - 0.5) * 6.0)
	for index in indices:
		ragdoll.push(PackedInt32Array([index]), spin.cross(ragdoll.position(index) - centre) + velocity)
	_loosen(indices)
	return { "velocity": velocity, "spin": spin, "mass": mass }


## The struck armour flashes white for an instant, then fades back.
func _flash_part(body: Ragdoll.Body, power: float = 1.0) -> void:
	if body == null or body.object == null:
		return
	var object := body.object
	var meshes: Array = []
	for mesh in object.find_children("*", "MeshInstance3D", true, false):
		if mesh.visible and not mesh.get_parent().has_meta("cap") and not mesh.has_meta("mark"):
			meshes.append(mesh)
	var overlay := StandardMaterial3D.new()
	overlay.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	overlay.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	overlay.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	overlay.albedo_color = Color(0, 0, 0, 1)
	_cancel_tween(_flashes.get(object))
	var tween := _add_tween(0.18, "outQuad",
		func(eased: float, _progress: float) -> void:
			var v := (1.0 - eased) * power
			overlay.albedo_color = Color(v * 1.3, v * 1.22, v * 1.15, 1)
			for mesh in meshes:
				if is_instance_valid(mesh):
					mesh.material_overlay = overlay,
		func() -> void:
			for mesh in meshes:
				if is_instance_valid(mesh) and mesh.material_overlay == overlay:
					mesh.material_overlay = null
			_flashes.erase(object))
	_flashes[object] = tween


func _drop_blaster(velocity: Vector3) -> void:
	if not holding:
		return
	holding = false
	_release(["blaster"])
	_loosen(bodies.blaster.indices)
	ragdoll.push(bodies.blaster.indices, _clamp_length(velocity, 0.0, 4.0) * 0.08 + Vector3(0, 0.25, 0))
	_spin(["blaster"], 2.5)


func _knock_off(piece: Node3D, velocity: Vector3) -> Variant:
	if piece == null or piece.get_parent() == null or piece.get_meta("loose", false):
		return null
	piece.set_meta("loose", true)
	piece.reparent(debris, true)
	var box: AABB = piece.get_meta("box")
	var size := box.size
	var centre := box.get_center()
	# Sized to the piece, so a helmet rolls on its dome and a plate lies flat.
	var radius := clampf(minf(size.x, minf(size.y, size.z)) * 0.5, 0.025, 0.11)
	var indices := PackedInt32Array()
	for offset in [Vector3.ZERO, Vector3(size.x * 0.5, 0, 0), Vector3(0, size.y * 0.5, 0)]:
		indices.append(ragdoll.add_particle(piece.to_global(offset + centre), radius, 0.3 + radius * 2.0, piece.name))
	var body := ragdoll.add_body(piece.name, indices, piece)
	body.debris = true
	_loosen(indices)
	for index in indices:
		ragdoll.ghost[index] = 1
	ragdoll.bind(body, piece.global_transform)
	for index in indices:
		ragdoll.set_kinematic(index, false)
	body.dynamic = true
	# Off and away from him: along the blow, outwards, and up.
	var away := piece.to_global(centre) - particle("W")
	away.y = 0.0
	if away.length_squared() > 1e-6:
		away = away.normalized() * 1.2
	ragdoll.push(indices, _clamp_length(velocity, 0.0, 6.0) * 0.3 + away + Vector3(0, 1.1, 0))
	var x := _random() - 0.5
	var y := _random() - 0.5
	var z := _random() - 0.5
	var axis := Vector3(x, y, z).normalized() * 9.0
	var middle := ragdoll.position(indices[0])
	for index in indices:
		ragdoll.push(PackedInt32Array([index]), -(ragdoll.position(index) - middle).cross(axis))
	feed.append({ "type": "armor", "piece": String(piece.name), "point": ragdoll.position(indices[0]) })
	return body


## Progressive destruction: the plate nearest the blow may come away.
func _chip(body: Ragdoll.Body, point: Vector3, velocity: Vector3, chance: float) -> Variant:
	if body == null or body.object == null or _random() >= chance:
		return null
	var best: Node3D = null
	var nearest := 0.28
	for child in body.object.get_children():
		if not child.has_meta("armour") or child.get_meta("loose", false):
			continue
		var distance: float = (child as Node3D).to_global((child.get_meta("box") as AABB).get_center()).distance_to(point)
		if distance < nearest:
			nearest = distance
			best = child
	return _knock_off(best, velocity) if best else null


## Staggers the standing trooper where and as hard as he was hit (once per sweep).
func _react(velocity: Vector3, contact: Vector3, strength: float, part: String = "torso") -> void:
	if _pending == null or strength > _pending.strength:
		_pending = { "velocity": velocity, "contact": contact, "strength": strength, "part": part }


func _stagger(blow: Dictionary) -> void:
	if dead or fallen:
		return
	var r := reaction
	var push := _local(blow.velocity)
	push.y = 0.0
	# One swing touches several parts over a few frames: the body reels from
	# the first contact, the next ones only add a little.
	var again := clock - _last_stagger < 0.25
	_last_stagger = clock
	var force: float = minf(1.6, push.length() / 4.0) * blow.strength * (0.3 if again else 1.0)
	push = push.normalized()
	var at := _local(blow.contact - root.position)
	var part: String = blow.part
	var last := part.substr(part.length() - 1)
	var side := last if last == "L" or last == "R" else ("L" if at.x > 0.0 else "R")
	var sign := 1.0 if side == "L" else -1.0
	var region := "torso"
	if part == "head":
		region = "head"
	elif part.begins_with("upperArm") or part.begins_with("forearm") or part.begins_with("hand"):
		region = "arm"
	elif part.begins_with("thigh") or part.begins_with("shin") or part.begins_with("foot") or part.begins_with("Knee") or part.begins_with("Shin"):
		region = "leg"
	elif part == "pelvis":
		region = "pelvis"
	# The whole body answers a little; the struck part answers most.
	r.vpitch += push.z * (4.0 if region == "torso" else 1.5) * force
	r.vroll += -push.x * (4.0 if region == "torso" else 1.5) * force
	r.vyaw += (1.0 if at.x > 0.0 else -1.0) * push.z * (5.0 if region == "torso" else 2.0) * force + (_random() - 0.5) * 2.0 * force
	r.vhead += (_random() - 0.3) * 3.0 * force
	match region:
		"head":
			# The head snaps along the blow.
			r.vhead += push.z * 9.0 * force
			r.vheadYaw += push.x * 9.0 * force
			r.vheadRoll += -push.x * 6.0 * force
		"arm":
			# That arm is flung along the blade and lets go of the rifle.
			r["varm" + side] -= push.z * 9.0 * force + 2.0 * force
			r["vflare" + side] += push.x * 7.0 * force
			r.vyaw += sign * push.z * 3.0 * force
			if force > 0.3 and r.wound == null:
				r.letGo[side] = maxf(r.letGo[side], 0.6 + _random() * 0.6)
		"leg":
			# That leg gives: the hip drops on that side.
			r["vdip" + side] += 3.5 * force
			r.vbuckle += force
		"pelvis":
			# Doubled over.
			r.vbuckle += 3.5 * force
			r.vpitch += 2.5 * force
		_:
			r.vbuckle += 2.5 * force
	if region != "arm":
		r.varmL += (_random() - 0.5) * 6.0 * force
		r.varmR += (_random() - 0.5) * 6.0 * force
	r.push = r.push + _world(push) * (0.22 * force * (0.4 if region == "arm" else 0.6 if region == "head" else 1.0))
	# Shoved back along the blow and turned away from it, around where it landed.
	r.knock = _clamp_length(r.knock + _world(push) * (feel.hit.knockback * force * (0.55 if region == "arm" else 0.7 if region == "head" else 1.0)), 0.0, feel.hit.maxKnock)
	r.push = _clamp_length(r.push, 0.0, 0.6)
	r.spin += (at.z * push.x - at.x * push.z) / maxf(0.12, Vector2(at.x, at.z).length()) * feel.hit.spin * force + (_random() - 0.5) * 0.5 * force
	r.spin = clampf(r.spin, -3.5, 3.5)
	r.imbalance += (0.3 if region == "leg" else 0.2) * force
	# Too many blows: his legs go and he falls, still alive — but the first, wounding swing only makes him reel.
	if sparing:
		r.imbalance = minf(r.imbalance, 0.85)
	elif r.imbalance > 1.0:
		_fall("imbalance", blow.velocity)


## A hand goes to a fresh burn on his front, if one is free to.
func _press_wound(point: Vector3) -> void:
	var r := reaction
	var at := (joints.spine as Node3D).to_local(point)
	if at.z < -0.03 or r.wound != null:
		return
	var hand := "L" if at.x > 0.0 else "R"
	if _arm_cut(hand):
		hand = "R" if hand == "L" else "L"
	if _arm_cut(hand):
		return
	r.press = { "age": 0.0, "duration": 1.8 + _random() * 1.2 }
	r.pressAt = at
	r.pressHand = hand


## Knocked out of a throw before letting go: the grenade drops at his feet.
func _abort_throw() -> void:
	if throwing != null and not throwing.released and held_grenade:
		feed.append({ "type": "grenade", "from": held_grenade.global_position, "dropped": true })
	throwing = null
	if held_grenade:
		held_grenade.visible = false


## Pulls the pin and throws at `target` (left hand, rifle kept in the right).
func throw_grenade(target: Vector3) -> bool:
	if not is_free() or throwing != null or _arm_cut("L") or reaction.wound != null:
		return false
	throwing = { "age": 0.0, "duration": 0.95, "target": target, "released": false }
	return true


func _throw_step(dt: float) -> void:
	var t: Dictionary = throwing
	t.age += dt
	if not t.released and t.age >= t.duration * 0.5:
		t.released = true
		feed.append({ "type": "grenade", "from": held_grenade.global_position, "target": t.target })
	if t.age >= t.duration:
		throwing = null


## From standing to the floor; the impulses depend on the cause. Alive, he will crawl or get back up.
func _fall(cause: String, velocity: Vector3 = Vector3.ZERO, cut_child: Variant = null) -> void:
	if fallen:
		return
	_abort_throw()
	fallen = true
	collapse = null
	if holding:
		_drop_blaster(velocity)
	_release(bodies.keys())
	var forward := _world(Vector3(0, 0, 1))
	var shove := velocity
	shove.y = 0.0
	shove = _clamp_length(shove, 0.0, 6.0)
	var along := shove.normalized() if shove.length_squared() > 1e-6 else -forward
	# Every fall carries the stagger already under way.
	ragdoll.push(PackedInt32Array(range(ragdoll.count())), reaction.push)
	var upper := []
	for part in ["head", "torso", "upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR"]:
		if cut_child == null or not (cut_child as Array).has(part):
			upper.append(part)
	var knees := PackedInt32Array([particle_index.KL, particle_index.KR])
	var buckle := forward * (0.5 + _random() * 0.45)
	var topple := 0.35 + _random() * 0.6
	match cause:
		"neck":
			ragdoll.push(_indices_of(upper.filter(func(part: String) -> bool: return part != "head")), along * 0.5)
			ragdoll.push(knees, buckle * 1.4)
		"waist":
			ragdoll.push(knees, buckle)
			ragdoll.push(PackedInt32Array([particle_index.W]), along * -0.3)
		"slash":
			ragdoll.push(_indices_of(upper), along * (topple * 0.8) + Vector3(0, 0.4, 0))
			ragdoll.push(knees, buckle)
		"force", "pull", "impaled":
			pass
		_:
			ragdoll.push(_indices_of(upper), along * topple)
			ragdoll.push(knees, buckle)
	# A twist through the shoulders so no two falls match.
	var twist := forward.cross(Vector3.UP) * ((_random() - 0.5) * 2.2)
	ragdoll.push(PackedInt32Array([particle_index.SL]), twist)
	ragdoll.push(PackedInt32Array([particle_index.SR]), -twist)
	# A body felled by the blade carries the blow and the shove already under
	# way: it does not drop where it was struck, it is thrown and slides.
	if cause != "force" and cause != "pull" and cause != "impaled":
		var carry := velocity
		carry.y = 0.0
		carry = _clamp_length(carry * feel.hit.carry + reaction.knock, 0.0, feel.hit.maxCarry)
		if carry.length_squared() > 0.04:
			carry.y = 0.35 + carry.length() * 0.12
			var indices := _joined_indices()
			ragdoll.push(indices, carry)
			_slip(indices, feel.hit.slide)
	levitating = null; dropping = null; flee = null; turn_back = null; fetching = null
	reaction.run = 0.0
	reaction.dangle = 0.0
	reaction.knock = Vector3.ZERO
	if not dead:
		# Knocked down unhurt, he will get back up; with a leg gone, he crawls.
		if _injured():
			_start_crawl()
		else:
			_start_recovery()
	events.append({ "type": "fall", "cause": cause })


func _injured() -> bool:
	for joint_name in severed:
		for prefix in ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"]:
			if joint_name.begins_with(prefix):
				return true
	return false


func _start_crawl() -> void:
	# Alive on the floor: a moment of agony, then he tries to crawl.
	recover = null
	crawl = {
		"age": 0.0, "stage": "down", "effort": 0.0, "stamina": 9.0 + _random() * 5.0, "origin": Vector3.ZERO, "heading": 0.0, "roll": 0.0, "turn": 0.0,
		"stroke": null, "plant": {}, "hand": {}, "pause": 0.0, "strain": 0.0, "lean": 0.0, "look": 0.0, "slump": 1.0, "kick": { "L": 0.0, "R": 0.0 }, "last": "",
	}
	crawl.staminaTotal = crawl.stamina
	spasm = { "left": 1.2, "total": 1.2, "amplitude": 0.6, "next": 0.1 }


func _start_recovery() -> void:
	crawl = null
	muscles = []
	recover = { "stage": "tumble", "age": 0.0, "stun": _pick(feel.recovery.stun), "effort": 0.0, "support": null }
	if spasm == null or spasm.left < 0.6:
		spasm = { "left": 0.7, "total": 0.7, "amplitude": 0.4, "next": 0.25 }


## Death. A beheaded body stays up for a heartbeat before it collapses, and
## twitches for a few seconds on the floor; other deaths shudder briefly.
func _die(cause: String, velocity: Vector3 = Vector3.ZERO, cut_child: Variant = null, delay: float = 0.0) -> void:
	if dead:
		return
	dead = true
	crawl = null
	recover = null
	lifting = null
	hurt = null
	hauled = null
	flee = null
	turn_back = null
	reaction.run = 0.0
	if towing != null and towing.kind == "stand":
		towing = null
	muscles = []
	if pickup != null:
		_drop_pickup()
	var headless := cause == "neck"
	var spent := cause == "exhaustion"
	spasm = { "left": 3.8 if headless else 1.2 if spent else 1.6, "amplitude": 2.2 if headless else 0.5 if spent else 1.1, "next": 0.3 if headless else 0.15 }
	spasm.total = spasm.left
	if fallen:
		return
	if holding:
		_drop_blaster(velocity)
	if delay > 0.0:
		collapse = { "at": clock + delay, "cause": cause, "velocity": velocity, "cut_child": cut_child }
		# The arms jerk up as the body loses its head.
		reaction.varmL -= 3.0 + _random() * 3.0
		reaction.varmR -= 3.0 + _random() * 3.0
		reaction.vbuckle += 1.5
	else:
		_fall(cause, velocity, cut_child)


## On the floor and alive: a hit makes him writhe and stop crawling (or getting up) for a moment.
func _suffer(strength: float) -> void:
	if lifting != null:
		return
	if recover != null:
		if _injured():
			_start_crawl()
			return
		muscles = []
		recover.stage = "stunned"
		recover.age = 0.0
		recover.stun = maxf(recover.stun, 0.5) + 0.4 * strength
		recover.effort = 0.0
		if spasm == null or spasm.left < 0.5:
			spasm = { "left": 0.5, "total": 0.5, "amplitude": 0.7 * strength, "next": 0.0 }
		return
	if crawl == null:
		return
	crawl.pause = maxf(crawl.pause, 0.5 + _random() * 0.5)
	crawl.stamina -= 1.5 * strength
	crawl.effort *= 0.5
	if spasm == null or spasm.left < 0.6:
		spasm = { "left": 0.7, "total": 0.7, "amplitude": 0.8 * strength, "next": 0.0 }


## A struck body on the floor is jolted along the blade, and its nerves still twitch.
func _jolt(body: Ragdoll.Body, hit: Dictionary) -> void:
	ragdoll.push(body.indices, _clamp_length(hit.velocity, 0.0, 6.0) * 0.3 + Vector3(0, 0.8, 0))
	if dead and (spasm == null or spasm.left < 0.6):
		spasm = { "left": 0.8, "total": 0.8, "amplitude": 1.0, "next": 0.03 }


func _cut(cut_name: String, hit: Dictionary) -> bool:
	if not CUTS.has(cut_name) or severed.has(cut_name):
		return false
	var definition: Dictionary = CUTS[cut_name]
	# Only a cut into the living body is felt; a fallen-off piece is just cut.
	var felt := not dead and _subtree("torso").has(definition.parent)
	var child_bodies := _subtree(definition.child)
	severed[cut_name] = true
	var list := []
	for child in child_bodies:
		list.append(bodies[child])
	ragdoll.sever(particle_index[definition.particle], list, cut_name)
	for entry in caps[cut_name]:
		entry.cap.visible = true
		if effects:
			effects.glow(entry.ring)
			effects.smoulder(entry.cap)
	_release(child_bodies)
	# The severed part is thrown by the blade; the body it leaves stays put.
	# Through the waist it is the upper body that slides off, and the legs give way beneath it.
	if cut_name == "waist":
		var upper := _subtree("torso").filter(func(part: String) -> bool: return not child_bodies.has(part))
		_release(upper)
		var x := (_random() - 0.5) * 0.2
		var y := 0.05 + _random() * 0.12
		var z := (_random() - 0.5) * 0.2
		ragdoll.push(_indices_of(upper), _clamp_length(hit.velocity, 0.0, 4.0) * 0.1 + Vector3(x, y, z))
		_spin(["torso"], 0.6 + _random() * 1.4)
	else:
		last_throw = _launch(child_bodies, hit, ragdoll.position(particle_index[definition.particle]))
	if felt:
		var arm_lost := false
		var leg_lost := false
		for child in child_bodies:
			if child.begins_with("upperArm") or child.begins_with("forearm") or child.begins_with("hand"):
				arm_lost = true
			if child.begins_with("thigh") or child.begins_with("shin") or child.begins_with("foot"):
				leg_lost = true
		if arm_lost:
			_drop_blaster(hit.velocity)
		if pickup != null:
			_drop_pickup()
		var last := cut_name.substr(cut_name.length() - 1)
		if definition.lethal:
			_die(cut_name.substr(0, cut_name.length() - 1) if last == "L" or last == "R" else cut_name, hit.velocity, child_bodies, 0.3 if cut_name == "neck" and not fallen else 0.0)
		elif fallen:
			_suffer(1.0)
		elif leg_lost:
			_fall("leg", hit.velocity, child_bodies)
		else:
			_react(hit.velocity, hit.point, 0.6, definition.child)
			if arm_lost:
				reaction.wound = { "joint": cut_name, "side": last }
				reaction.woundAge = 0.0
				reaction.press = null
	return true


## A glowing scorch across the armour where the blade passed without cutting.
func _scorch(body: Ragdoll.Body, hit: Dictionary) -> void:
	var axis_point: Vector3 = hit.axisPoint
	var normal: Vector3 = (hit.point - axis_point).normalized()
	var along: Vector3 = hit.velocity - normal * hit.velocity.dot(normal)
	along = along.normalized()
	if not is_finite(along.x) or along.length_squared() < 0.5:
		return
	var material := _glowing()
	material.cull_mode = BaseMaterial3D.CULL_BACK
	var mark := MeshInstance3D.new()
	mark.name = "Saber scorch"
	var shape := BoxMesh.new()
	shape.size = Vector3(0.24, 0.016, 0.012)
	mark.mesh = shape
	mark.material_override = material
	mark.set_meta("mark", true)
	debris.add_child(mark)
	mark.global_transform = Transform3D(Basis(along, normal.cross(along), normal), axis_point + normal * (body.capsule[2] * 0.95))
	mark.reparent(body.object, true)
	marks.append(mark)
	if effects:
		effects.glow(material, 5.0)


# ---- On the floor: muscles, crawl, death throes -------------------------

func _usable(side: String) -> bool:
	return not severed.has("shoulder" + side) and not severed.has("elbow" + side)


func _living() -> Array:
	return _subtree("torso")


func _restlessness() -> float:
	var sum := 0.0
	var n := 0
	for part in _living():
		for index in (bodies[part] as Ragdoll.Body).indices:
			sum += ragdoll.speed(index)
			n += 1
	return sum / n if n > 0 else 0.0


## Reads how he lies: along which line, and how far rolled from face down.
func _orient() -> void:
	var c: Dictionary = crawl
	var w := particle("W")
	var n := particle("N")
	var along := n - w
	along.y = 0.0
	if along.length_squared() < 1e-4:
		along = Vector3(sin(c.heading), 0, cos(c.heading))
	along = along.normalized()
	c.heading = atan2(along.x, along.z)
	c.origin = w - along * 0.12
	c.origin.y = 0.0
	var front := (particle("SL") - particle("SR")).cross(n - w)
	front -= along * front.dot(along)
	if front.length_squared() > 1e-6:
		front = front.normalized()
		c.roll = atan2(along.dot(Vector3.DOWN.cross(front)), Vector3.DOWN.dot(front))
	else:
		c.roll = 0.0


var _forward := Vector3.FORWARD
var _leftward := Vector3.LEFT


func _frame(c: Dictionary) -> void:
	_forward = Vector3(sin(c.heading), 0, cos(c.heading))
	_leftward = _forward.cross(Vector3.DOWN)


## Where a hand rests or reaches, on the floor ahead of its shoulder.
func _ahead(c: Dictionary, side: String, distance: float, spread: float) -> Vector3:
	var sign := 1.0 if side == "L" else -1.0
	var at: Vector3 = c.origin + _forward * (0.4 + distance) + _leftward * (sign * (0.2 + spread))
	at.y = 0.07
	return at


## Advances the crawl: lying in agony, rolling onto his front, pulling himself along, giving out.
func _crawl_step(dt: float, time: float) -> void:
	var c: Dictionary = crawl
	c.age += dt
	var arms := ["L", "R"].filter(_usable)
	var tired := 1.0 - clampf(c.stamina / c.staminaTotal, 0.0, 1.0)
	var effort := 0.0
	if c.stage == "down":
		if (c.age > 1.0 and _restlessness() < 0.35) or c.age > 2.2:
			_orient()
			c.stage = "turn"
			c.turn = 0.0
	if c.stage != "down":
		_frame(c)
	if c.stage == "turn":
		# He rolls onto his front and plants his forearms.
		c.turn += dt
		c.roll *= exp(-2.6 * dt)
		for s in ["L", "R"]:
			c.hand[s] = _ahead(c, s, 0.2, -0.1)
		effort = 1.0
		c.slump = maxf(0.0, c.slump - dt * 1.5)
		if c.turn > 1.2:
			c.stage = "crawl"
			c.roll = 0.0
			for s in ["L", "R"]:
				c.plant[s] = c.hand[s]
	elif c.stage == "crawl":
		effort = 0.55 if c.pause > 0.0 else 1.0
		c.stamina -= dt
		if arms.is_empty():
			c.stamina = minf(c.stamina, 2.5)
		if c.pause > 0.0:
			c.pause -= dt
		elif not arms.is_empty():
			# Alternate strokes: one arm reaches forward, plants, and pulls him up to it.
			if c.stroke == null or not arms.has(c.stroke.side):
				var side: String
				if arms.size() == 1:
					side = arms[0]
				elif c.last == "L":
					side = "R"
				elif c.last == "R":
					side = "L"
				else:
					side = arms[int(floor(_random() * 2))]
				var slow := (1.0 + 1.5 * tired * tired) * (1.3 if arms.size() == 1 else 1.0) * (0.9 + _random() * 0.25)
				c.stroke = {
					"side": side, "phase": "reach", "t": 0.0, "done": 0.0, "from": c.plant[side] if c.plant.has(side) else _ahead(c, side, 0.0, 0.0), "to": _ahead(c, side, 0.4, -0.15),
					"reach": 0.45 * slow, "pull": 0.65 * slow, "length": 0.24 * (0.75 if arms.size() == 1 else 1.0) * (1.0 - 0.35 * tired),
					"turn": (1.0 if side == "L" else -1.0) * 0.05 * (1.5 if arms.size() == 1 else 1.0) + (_random() - 0.5) * 0.12,
				}
			var s: Dictionary = c.stroke
			var sign := 1.0 if s.side == "L" else -1.0
			s.t += dt
			if s.phase == "reach":
				var u := minf(1.0, s.t / s.reach)
				c.hand[s.side] = (s.from as Vector3).lerp(s.to, _smooth(u)) + Vector3.UP * (0.11 * sin(PI * u))
				c.strain *= exp(-6.0 * dt)
				c.look += (sign * 0.25 - c.look) * (1.0 - exp(-5.0 * dt))
				if u >= 1.0:
					s.phase = "pull"
					s.t = 0.0
					c.plant[s.side] = s.to
			else:
				var u := minf(1.0, s.t / s.pull)
				var e := _smooth(u)
				c.origin += _forward * (s.length * (e - s.done))
				c.heading += s.turn * (e - s.done)
				s.done = e
				c.strain = sin(PI * u)
				c.lean = sign * c.strain
				if u >= 1.0:
					c.last = s.side
					c.stroke = null
			for arm in arms:
				if not (c.stroke != null and c.stroke.phase == "reach" and c.stroke.side == arm):
					c.hand[arm] = c.plant[arm] if c.plant.has(arm) else _ahead(c, arm, 0.2, -0.1)
			c.kick.L = c.strain if c.stroke != null and c.stroke.side == "L" else c.kick.L * exp(-4.0 * dt)
			c.kick.R = c.strain if c.stroke != null and c.stroke.side == "R" else c.kick.R * exp(-4.0 * dt)
		if c.stamina <= 0.0:
			c.stage = "spent"
			c.spent = 0.0
	elif c.stage == "spent":
		# He gives out: the head sinks, the arms go slack, a last breath.
		c.spent += dt
		effort = 1.0 - _smooth(minf(1.0, c.spent / 2.2))
		c.slump = minf(1.0, c.spent / 1.6)
		c.strain *= exp(-3.0 * dt)
		if c.spent > 2.6:
			_die("exhaustion")
			return
	c.effort += (effort - c.effort) * (1.0 - exp(-3.0 * dt))
	if c.stage != "down":
		_pose_crawl(time)
		_aim_muscles(dt)


func _zero_joints() -> void:
	for joint_name in joints:
		if joints[joint_name] != holder:
			(joints[joint_name] as Node3D).quaternion = Quaternion.IDENTITY


## The crawl pose on the skeleton: prone, chest up on the elbows, legs dragging.
func _pose_crawl(time: float) -> void:
	var c: Dictionary = crawl
	var turn := Basis(_leftward, _forward, Vector3.DOWN).get_rotation_quaternion()
	var roll := Quaternion(_forward, c.roll)
	root.quaternion = roll * turn
	var at: Vector3 = c.origin
	at.y = 0.11 + 0.12 * absf(sin(c.roll))
	root.position = at
	_zero_joints()
	var up: float = 1.0 - c.slump
	var pant := sin(time * 3.6) * 0.03 * up
	joints.pelvis.position = Vector3.ZERO
	joints.pelvis.quaternion = _euler(0.05, c.lean * 0.1, c.lean * 0.08)
	joints.spine.quaternion = _euler((-0.2 - c.strain * 0.14) * up + pant, c.lean * 0.12, -c.lean * 0.16)
	joints.neck.quaternion = _euler((-0.7 - c.strain * 0.15) * up + 0.15 * c.slump, c.look * up, 0)
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		joints["shoulder" + s].quaternion = _euler(-0.3, 0, sign * 0.5)
		joints["elbow" + s].quaternion = _euler(-0.8, 0, 0)
		# The legs drag flat; the one on the pulling side sweeps out a little.
		var push: float = 0.0 if severed.has("hip" + s) else c.kick[s]
		joints["hip" + s].quaternion = _euler(0.04, 0, sign * (0.08 + push * 0.3))
		joints["knee" + s].quaternion = _euler(0.06 + push * 0.12, 0, 0)
		joints["ankle" + s].quaternion = _euler(1.1, 0, 0)
	for s in ["L", "R"]:
		if not _usable(s) or not c.hand.has(s):
			continue
		var sign := 1.0 if s == "L" else -1.0
		var pole := (joints["shoulder" + s] as Node3D).global_position + _leftward * (sign * 0.45) + Vector3.UP * 0.25 - _forward * 0.1
		_reach(s, c.hand[s], pole, 1.0)


## Muscle targets for every particle of his body: the crawl or the rise, frame to frame.
func _aim_muscles(dt: float, mode: String = "crawl") -> void:
	muscles = []
	var seen := {}
	for part in _living():
		for index in (bodies[part] as Ragdoll.Body).indices:
			var spec: Variant = particle_spec[index] if index < particle_spec.size() else null
			if seen.has(index) or spec == null:
				continue
			seen[index] = true
			var target: Vector3 = (joints[spec[1]] as Node3D).to_global(spec[2])
			var muscle: Dictionary
			if not muscle_state.has(index):
				muscle = { "index": index, "weight": 0.0, "from": target, "to": target }
				muscle_state[index] = muscle
			else:
				muscle = muscle_state[index]
				muscle.from = muscle.to
				muscle.to = target
			# Getting up takes every muscle; crawling lets the legs drag.
			muscle.weight = 3.0 if mode == "strong" else (REFLEX.get(spec[0], 0.5) if mode == "reflex" else MUSCLE.get(spec[0], 0.5))
			muscles.append(muscle)
	drive_clock = 0.0
	drive_span = maxf(dt, 1e-4)


## Runs inside every physics step: muscles bear his weight and blend each
## particle's position and velocity towards its target (no springy
## overshoot), and twitches add short pulses of velocity.
func _drive(h: float) -> void:
	var rd := ragdoll
	var effort: float = 0.0 if dead else (lifting.effort if lifting != null else (crawl.effort if crawl != null else (recover.effort if recover != null else 0.0)))
	# How much of his weight the muscles bear: all of it to get up, a little in reflexes.
	var support := 1.0
	if lifting == null and crawl == null and recover != null and recover.support != null:
		support = recover.support
	# A body hauled by the Force: steered towards where the pull carries it, weightless.
	if towing != null and towing.kind == "body" and towing.velocity != null:
		var v: Vector3 = towing.velocity
		for index in towing.indices:
			if rd.kinematic[index] != 0:
				continue
			rd.py[index] -= rd.gravity * h * h
			var mx := rd.px[index] - rd.qx[index]
			var my := rd.py[index] - rd.qy[index]
			var mz := rd.pz[index] - rd.qz[index]
			mx += (v.x * h - mx) * 0.35
			my += (v.y * h - my) * 0.35
			mz += (v.z * h - mz) * 0.35
			rd.qx[index] = rd.px[index] - mx
			rd.qy[index] = rd.py[index] - my
			rd.qz[index] = rd.pz[index] - mz
	if hauled != null and not dead:
		var neck: int = particle_index.N
		var point: Vector3 = hauled.point
		var moving: Vector3 = hauled.velocity
		if rd.kinematic[neck] == 0:
			rd.px[neck] += (point.x - rd.px[neck]) * 0.12
			rd.py[neck] += (point.y - rd.py[neck]) * 0.12
			rd.pz[neck] += (point.z - rd.pz[neck]) * 0.12
			rd.qx[neck] = rd.px[neck] - moving.x * h
			rd.qy[neck] = rd.py[neck] - moving.y * h
			rd.qz[neck] = rd.pz[neck] - moving.z * h
		for key in ["SL", "SR"]:
			var shoulder: int = particle_index[key]
			if rd.kinematic[shoulder] == 0:
				rd.py[shoulder] += (point.y - 0.06 - rd.py[shoulder]) * 0.05
	if effort > 0.01 and not muscles.is_empty():
		drive_clock += h
		var f := minf(1.0, drive_clock / drive_span)
		var weight := rd.gravity * h * h * effort
		for muscle in muscles:
			var index: int = muscle.index
			if rd.kinematic[index] != 0:
				continue
			var k := minf(0.4, muscle.weight * 0.035 * effort)
			if k <= 0.0:
				continue
			# Limply held parts (the dragging legs) keep most of their weight.
			rd.py[index] -= weight * minf(1.0, muscle.weight) * support
			var from: Vector3 = muscle.from
			var to: Vector3 = muscle.to
			var gx := float(from.x) + (float(to.x) - from.x) * f
			var gy := float(from.y) + (float(to.y) - from.y) * f
			var gz := float(from.z) + (float(to.z) - from.z) * f
			var sx := (float(to.x) - from.x) * (h / drive_span)
			var sy := (float(to.y) - from.y) * (h / drive_span)
			var sz := (float(to.z) - from.z) * (h / drive_span)
			var blend := minf(1.0, k * 6.0)
			var mx := rd.px[index] - rd.qx[index]
			var my := rd.py[index] - rd.qy[index]
			var mz := rd.pz[index] - rd.qz[index]
			mx += (sx - mx) * blend
			my += (sy - my) * blend
			mz += (sz - mz) * blend
			rd.px[index] += (gx - rd.px[index]) * k
			rd.py[index] += (gy - rd.py[index]) * k
			rd.pz[index] += (gz - rd.pz[index]) * k
			rd.qx[index] = rd.px[index] - mx
			rd.qy[index] = rd.py[index] - my
			rd.qz[index] = rd.pz[index] - mz
	for twitch in twitches:
		if twitch.t >= twitch.duration:
			continue
		twitch.t += h
		var weight := PI / 2.0 * sin(PI * minf(1.0, twitch.t / twitch.duration))
		var amount: float = twitch.dv * weight * h / twitch.duration
		var direction: Vector3 = twitch.direction
		rd.push_xyz(twitch.indices, direction.x * amount, direction.y * amount, direction.z * amount, h)


func _twitch(indices: PackedInt32Array, direction: Vector3, dv: float, duration: float) -> void:
	twitches.append({ "indices": indices.duplicate(), "direction": direction.normalized(), "dv": dv, "duration": duration, "t": 0.0 })


## Spasms: limbs still joined to the body jerk at random, fading out.
func _convulse(dt: float) -> void:
	if spasm == null:
		return
	spasm.left -= dt
	spasm.next -= dt
	if spasm.left <= 0.0:
		spasm = null
		return
	if spasm.next > 0.0:
		return
	var life: float = spasm.left / spasm.total
	spasm.next = (0.04 + _random() * 0.14) * (1.0 + (1.0 - life) * 2.0)
	var joined := {}
	for part in _subtree("torso") + _subtree("pelvis"):
		joined[part] = true
	var limbs := []
	for part in joined:
		for prefix in ["upperArm", "forearm", "hand", "thigh", "shin", "foot"]:
			if part.begins_with(prefix):
				limbs.append(part)
				break
	if limbs.is_empty():
		return
	var body: Ragdoll.Body = bodies[limbs[int(floor(_random() * limbs.size()))]]
	var strength: float = spasm.amplitude * pow(life, 0.9) * (0.5 + _random())
	# Jerks, quicker than gravity and the floor's grip can smother.
	var x := _random() - 0.5
	var y := 0.5 + _random() * 0.5
	var z := _random() - 0.5
	_twitch(body.indices.slice(1), Vector3(x, y, z), strength, 0.03 + _random() * 0.03)
	# Early on the trunk heaves as well.
	if _random() < 0.3 * life and joined.has("torso"):
		var tx := _random() - 0.5
		_twitch(PackedInt32Array([particle_index.W, particle_index.N]), Vector3(tx, 1.0, _random() - 0.5), strength * 0.5, 0.05)


# ---- The Force, and getting back up ----------------------------------------

## Bodies still joined to him (whatever has not been cut away).
func _joined_bodies() -> Array:
	var list := []
	for part in _subtree("torso") + _subtree("pelvis"):
		if not list.has(part):
			list.append(part)
	return list


func _joined_indices() -> PackedInt32Array:
	return _unique(_indices_of(_joined_bodies()))


func _centroid(indices: PackedInt32Array) -> Vector3:
	var sum := Vector3.ZERO
	for index in indices:
		sum += ragdoll.position(index)
	return sum / indices.size()


## Thrown or shoved on the floor: slippery and bouncy for a while, so he slides, rolls and bounces.
func _slip(indices: PackedInt32Array, seconds: float) -> void:
	if slick != null:
		_settle()
	slick = { "indices": indices, "until": clock + seconds }
	for index in indices:
		ragdoll.set_surface(index, feel.push.friction, feel.push.bounce)


func _settle() -> void:
	if slick == null:
		return
	for index in slick.indices:
		ragdoll.set_surface(index, NAN, NAN)
	slick = null


## Force push (velocity in m/s): thrown off his feet with a tumble — never
## killed by it — or, already down, shoved along the floor.
func _force_push(velocity: Vector3) -> void:
	var v := velocity
	if impaled != null:
		_slide_off()
	if pickup != null:
		_drop_pickup()
	levitating = null
	dropping = null
	flee = null
	turn_back = null
	if lifting != null:
		lifting = null
		muscles = []
		if not dead:
			_start_recovery()
	if not fallen:
		towing = null
		reaction.yank = 0.0
		_fall("force", v)
	else:
		if towing != null and towing.kind == "body":
			towing = null
		v *= 0.75
		if crawl != null:
			crawl.pause = maxf(crawl.pause, 1.4)
			crawl.effort = 0.0
		if recover != null:
			muscles = []
			recover.stage = "tumble"
			recover.age = 0.0
			recover.effort = 0.0
	# Hit in the chest: the upper body flies a touch faster, the whole body
	# tumbles about an axis across the push, each throw a little different.
	var flat := Vector3(v.x, 0, v.z)
	var across := Vector3.UP.cross(flat.normalized() if flat.length_squared() > 1e-6 else Vector3(1, 0, 0))
	var amount := _pick(feel.push.tumble)
	var tumble := across * (amount * (1.0 if _random() < 0.7 else -0.6))
	var indices := _joined_indices()
	var centre := _centroid(indices)
	var joined := _joined_bodies()
	var upper := {}
	for part in ["head", "torso", "upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR"]:
		if joined.has(part):
			for index in (bodies[part] as Ragdoll.Body).indices:
				upper[index] = true
	for index in indices:
		var scale := (1.1 if upper.has(index) else 0.85) * (0.92 + _random() * 0.16)
		ragdoll.push(PackedInt32Array([index]), v * scale + tumble.cross(ragdoll.position(index) - centre))
	_slip(indices, 3.2)
	feed.append({ "type": "pushed", "point": centre })


## Force pull towards `to` (a point before the hero): explosive at first,
## very fast, slowing right down on arrival — eased. Standing, he is dragged
## off his feet and lands staggering, maybe disarmed or felled; on the floor,
## the body is hauled along.
func _force_pull(to: Vector3, hold_on: bool = false, duration: float = NAN) -> bool:
	if is_nan(duration):
		duration = _pick(feel.pull.duration)
	if dead and not fallen:
		return false
	_abort_throw()
	if pickup != null:
		_drop_pickup()
	flee = null
	turn_back = null
	dropping = null
	fetching = null
	reaction.run = 0.0
	if not fallen:
		var from := root.position
		var target := Vector3(to.x, to.y if hold_on else 0.0, to.z)
		var toward := target - from
		toward.y = 0.0
		if toward.length() < 0.2 and not hold_on:
			return false
		# The curve peaks at about 3.2 × the mean speed: keep it under the top speed.
		duration = maxf(duration, 3.2 * toward.length() / feel.pull.topSpeed)
		var lift := _pick(feel.pull.lift)
		var from_heading := heading_of()
		var to_heading: float = atan2(toward.x, toward.z) + (_random() - 0.5) * feel.pull.spin
		var disarm: bool = holding and _random() < feel.pull.dropChance
		var falls: bool = _random() < feel.pull.fallChance
		towing = {
			"kind": "stand", "from": from, "to": target, "age": 0.0, "duration": duration, "lift": lift,
			"fromHeading": from_heading, "toHeading": to_heading, "disarm": disarm, "falls": falls, "direction": toward.normalized(), "hold": hold_on,
		}
		levitating = null
		# His hands go to his throat: the rifle falls where he stood.
		if holding:
			_drop_blaster(toward * 0.6)
		towing.disarm = false
	elif not dead:
		# Down but alive: the Force hauls him upright where he lies, into the
		# air, choking — and only then brings him in.
		var hips := (particle("HL") + particle("HR")) * 0.5
		hips.y = 0.0
		var toward := Vector3(to.x, 0, to.z) - hips
		lifting = { "age": 0.0, "duration": 0.42, "at": hips, "heading": atan2(toward.x, toward.z), "to": to, "hold": hold_on, "effort": 0.0 }
		crawl = null
		recover = null
		towing = null
		spasm = null
		twitches = []
		_settle()
		muscles = []
		muscle_state = {}
		for key in REACTION_SPRINGS:
			reaction[key] = 0.0
			reaction["v" + key] = 0.0
		reaction.kneel = 0.0
		reaction.yank = 0.0
		reaction.imbalance = 0.0
		reaction.press = null
		reaction.daze = 0.0
		reaction.knock = Vector3.ZERO
	else:
		var indices := _joined_indices()
		var from := _centroid(indices)
		towing = { "kind": "body", "indices": indices, "from": from, "to": Vector3(to.x, to.y + 0.3 if hold_on else from.y, to.z), "age": 0.0, "duration": duration * 1.15, "lift": 0.35, "last": from, "velocity": null, "hold": hold_on }
		if crawl != null:
			crawl.pause = maxf(crawl.pause, duration + 0.8)
			crawl.effort = 0.0
		if recover != null:
			muscles = []
			recover.stage = "tumble"
			recover.age = 0.0
			recover.effort = 0.0
	feed.append({ "type": "pulled", "point": particle("W") })
	return true


## Hauled upright by the Force: the muscles take him from lying to standing in the air.
func _lift_step(dt: float, time: float) -> void:
	var l: Dictionary = lifting
	l.age += dt
	var p := minf(1.0, l.age / l.duration)
	root.position = Vector3(l.at.x, ease_by("outCubic", p) * 0.35, l.at.z)
	_face(l.heading)
	reaction.choke = 1.0
	_pose(time, dt)
	_aim_muscles(dt, "strong")
	l.effort = ease_by("outCubic", minf(1.0, l.age / 0.12))
	if p < 1.0:
		return
	var to: Vector3 = l.to
	var hold_on: bool = l.hold
	_stand(root.position, l.heading)
	reaction.daze = 0.0
	_force_pull(to, hold_on)


## Dragged on his feet along the eased path, leaning into it, legs trailing.
func _tow_standing(dt: float) -> void:
	var t: Dictionary = towing
	t.age += dt
	var p := minf(1.0, t.age / t.duration)
	var e := ease_by(feel.pull.curve, p)
	var at := (t.from as Vector3).lerp(t.to, e)
	at.y = t.from.y + (t.to.y - t.from.y) * e + t.lift * sin(PI * p) * (0.5 if t.hold else 1.0)
	root.position = at
	_face(t.fromHeading + _wrap(t.toHeading - t.fromHeading) * ease_by("outCubic", minf(1.0, p * 1.6)))
	reaction.yank = pow(sin(PI * minf(1.0, p * 1.15)), 0.6)
	if p < 1.0:
		return
	if t.hold:
		# Held: he stays up there, before the hero, as long as the Force holds him.
		towing = null
		reaction.yank = 0.0
		levitating = { "point": t.to, "heading": t.toHeading, "age": 0.0, "next": 0.2 }
		if t.disarm:
			_drop_blaster(t.direction * 1.5)
		feed.append({ "type": "held", "point": root.position })
		return
	# Arrival: he lands staggering — whiplash, buckled knees — maybe disarmed, maybe felled.
	towing = null
	reaction.yank = 0.0
	root.position.y = 0.0
	reaction.vpitch = reaction.vpitch - 3.5 - _random() * 2.0
	reaction.vbuckle = reaction.vbuckle + 3.0
	reaction.vhead = reaction.vhead - 4.0
	reaction.varmL += (_random() - 0.5) * 8.0
	reaction.varmR += (_random() - 0.5) * 8.0
	reaction.imbalance += 0.45
	if t.disarm:
		_drop_blaster(t.direction * 2.5)
	feed.append({ "type": "arrived", "point": root.position })
	if t.falls:
		_fall("pull", t.direction * 2.2)


## A body on the floor hauled by the Force.
func _tow_body(dt: float) -> void:
	var t: Dictionary = towing
	t.age += dt
	var p := minf(1.0, t.age / t.duration)
	var e := ease_by(feel.pull.curve, p)
	var target := (t.from as Vector3).lerp(t.to, e)
	target.y = t.from.y + t.lift * sin(PI * p)
	if t.hold and p >= 1.0:
		target = t.to
		target.y += sin(t.age * 2.2) * feel.pull.hold.bob
	t.velocity = (target - t.last) / maxf(dt, 1e-4) + (target - _centroid(t.indices)) * 5.0
	t.last = target
	if p >= 1.0 and not t.hold:
		towing = null


## Keeps a pulled trooper (or body) up where the Force holds him; heading: where he should face.
func _hold(point: Vector3, heading: Variant = null) -> void:
	if levitating != null:
		levitating.point = point
		if heading != null:
			levitating.heading = heading
	elif towing != null and towing.hold:
		towing.to = point
		if towing.kind == "body":
			towing.to.y = point.y + 0.3
		if heading != null and towing.kind == "stand":
			towing.toHeading = heading


## Let go: he drops back to the floor (a body just falls).
func _drop() -> void:
	if towing != null and towing.hold:
		if towing.kind == "body":
			towing = null
		else:
			towing.hold = false
			towing.to.y = 0.0
	if levitating == null:
		return
	levitating = null
	dropping = { "speed": 0.0 }


## Run through by the blade at `point` (the hero facing `heading`): he lets
## go of his rifle and struggles on it for a few seconds, weaker and weaker,
## then dies there and hangs from it. False if he cannot be (down, dead).
func _impale(point: Vector3, heading: float) -> bool:
	if dead or fallen or collapse != null:
		return false
	_abort_throw()
	if pickup != null:
		_drop_pickup()
	towing = null; levitating = null; dropping = null; flee = null; turn_back = null; fetching = null
	reaction.knock = Vector3.ZERO
	reaction.spin = 0.0
	if holding:
		_drop_blaster(Vector3(sin(heading) * 0.6, 0.5, cos(heading) * 0.6))
	impaled = { "point": point, "heading": _wrap(heading + PI), "age": 0.0, "struggle": _pick(feel.impale.struggle), "vigour": 1.0, "next": 0.05, "hang": 0.0, "pinned": false }
	# The jolt of the blade going in.
	reaction.vpitch = reaction.vpitch - 4.0
	reaction.vbuckle = reaction.vbuckle + 2.5
	reaction.vhead = reaction.vhead - 5.0
	reaction.varmL -= 3.0 + _random() * 3.0
	reaction.varmR -= 3.0 + _random() * 3.0
	# Glowing burns where it went in and where it came out.
	var axis := (joints.spine as Node3D).to_global(WOUND)
	var through := Vector3(sin(heading), 0, cos(heading))
	_burn(bodies.torso, axis - through * 0.2, axis)
	_burn(bodies.torso, axis + through * 0.2, axis)
	feed.append({ "type": "impaled", "point": axis })
	return true


## Where the blade holds him now (and which way the hero faces).
func _skewer(point: Vector3, heading: Variant = null) -> void:
	if impaled == null:
		return
	impaled.point = point
	if heading != null:
		impaled.heading = _wrap(heading + PI)


## Off the blade: alive, he dies of it and falls; dead, the body drops.
func _slide_off(velocity: Vector3 = Vector3.ZERO) -> bool:
	if impaled == null:
		return false
	impaled = null
	if not dead:
		_die("impaled", velocity)
		return true
	for index in [particle_index.W, particle_index.N]:
		if not ragdoll.is_kinematic(index):
			continue
		ragdoll.set_kinematic(index, false)
		ragdoll.set_previous(index, ragdoll.position(index) - velocity / 120.0)
	feed.append({ "type": "slid", "point": _centroid(_joined_indices()) })
	return true


## Struggling on the blade: carried so his chest stays on it, on his toes, jerking.
func _impale_step(dt: float, time: float) -> void:
	var s: Dictionary = impaled
	s.age += dt
	s.vigour = 1.0 - smoothstep(s.struggle * 0.4, s.struggle, s.age)
	var wound := (joints.spine as Node3D).to_global(WOUND)
	var target: Vector3 = root.position - wound + s.point
	target.y = maxf(0.0, target.y)
	root.position = root.position.lerp(target, 1.0 - exp(-16.0 * dt))
	_turn_to(s.heading + _jitter(time, 2.3, 4.1, 7.7) * 0.2 * s.vigour, 8.0, dt)
	s.next -= dt
	if s.next <= 0.0:
		s.next = 0.16 + _random() * 0.4
		reaction.vpitch += (_random() - 0.3) * 3.2 * s.vigour
		reaction.vroll += (_random() - 0.5) * 2.6 * s.vigour
		reaction.vbuckle += _random() * 2.0 * s.vigour
	if s.age >= s.struggle:
		_die("impaled")


## Dead on the blade: his chest is held on it, slumped forward over it (the
## torso's two ends placed), the rest hangs and swings from there.
func _hang_step(dt: float) -> void:
	var s: Dictionary = impaled
	var waist: int = particle_index.W
	var neck: int = particle_index.N
	s.age += dt
	if not s.pinned:
		s.pinned = true
		s.length = ragdoll.position(waist).distance_to(ragdoll.position(neck))
		s.from = [ragdoll.position(waist), ragdoll.position(neck)]
		ragdoll.set_kinematic(waist, true)
		ragdoll.set_kinematic(neck, true)
	s.hang = minf(1.0, s.hang + dt / 0.45)
	var slump := 0.15 + 0.4 * ease_by("outCubic", s.hang)
	var forward := Vector3(sin(s.heading), 0, cos(s.heading))
	var along := Vector3(0, cos(slump), 0) + forward * sin(slump)
	var share := minf(0.9, WOUND.y / s.length)
	var k := ease_by("inOutCubic", s.hang)
	ragdoll.place(waist, (s.from[0] as Vector3).lerp(s.point - along * (s.length * share), k), dt)
	ragdoll.place(neck, (s.from[1] as Vector3).lerp(s.point + along * (s.length * (1.0 - share)), k), dt)


## Hanging in the Force's grip: following the point, choking, writhing and jerking.
func _levitate_step(dt: float, time: float) -> void:
	var l: Dictionary = levitating
	l.age += dt
	# The whole body jerks with his struggle, on top of a slow bob.
	var target: Vector3 = l.point
	target.y += sin(time * 2.2) * feel.pull.hold.bob + _jitter(time, 7.3, 11.1, 17.9) * 0.035
	target.x += _jitter(time + 5.0, 6.1, 9.7, 15.3) * 0.02
	target.z += _jitter(time + 9.0, 5.3, 10.9, 14.1) * 0.02
	root.position = root.position.lerp(target, 1.0 - exp(-feel.pull.hold.follow * dt))
	var heading: float = l.heading + _jitter(time, 2.3, 4.1, 7.7) * 0.25
	_turn_to(heading, 6.0, dt)
	# Now and then a convulsion runs through him.
	l.next -= dt
	if l.next <= 0.0:
		l.next = 0.25 + _random() * 0.5
		reaction.vpitch += (_random() - 0.4) * 3.0
		reaction.vroll += (_random() - 0.5) * 2.5
		reaction.vbuckle += _random() * 2.0


## Dropped: he falls onto his feet, buckles, and runs for it.
func _drop_step(dt: float) -> void:
	dropping.speed += 11.0 * dt
	root.position.y -= dropping.speed * dt
	if root.position.y > 0.0:
		return
	root.position.y = 0.0
	for joint_name in severed:
		if joint_name.begins_with("hip") or joint_name.begins_with("knee") or joint_name.begins_with("ankle"):
			dropping = null
			_fall("leg", Vector3.ZERO)
			return
	reaction.vbuckle += 2.5 + dropping.speed * 0.6
	reaction.vpitch += 1.5
	reaction.varmL += (_random() - 0.5) * 6.0
	reaction.varmR += (_random() - 0.5) * 6.0
	dropping = null
	feed.append({ "type": "land", "point": root.position, "speed": 2.0 })
	# Away from the hero, a little off to one side.
	var away: Vector3 = root.position - (focus if focus != null else Vector3.ZERO)
	away.y = 0.0
	if away.length_squared() < 1e-4:
		away = Vector3(sin(heading_of() + PI), 0, cos(heading_of() + PI))
	away = away.normalized().rotated(Vector3.UP, (_random() - 0.5) * 1.1)
	var speed := _pick(feel.flee.speed)
	flee = { "direction": away, "speed": speed, "left": _pick(feel.flee.time), "age": 0.0, "delay": 0.25 }


## Running away: a quick start, he runs, then slows, stops and turns back.
func _flee_step(dt: float) -> void:
	var f: Dictionary = flee
	f.age += dt
	if f.age < f.delay:
		_locomote(dt, Vector3.ZERO, null)
		return
	f.left -= dt
	var pace := 1.0 if f.left > 0.0 else maxf(0.0, 1.0 + f.left / 0.5)
	_locomote(dt, f.direction * (f.speed * pace), null, 9.0)
	root.position.x = clampf(root.position.x, -30.0, 30.0)
	root.position.z = clampf(root.position.z, -30.0, 30.0)
	if pace > 0.0 or loco.velocity.length() > 0.3:
		return
	flee = null
	# He stops and turns back to face the hero, warily.
	if focus != null:
		turn_back = atan2(focus.x - root.position.x, focus.z - root.position.z)


## Walking and running with a body's inertia: he speeds up, slows down and
## turns at human rates, leans into a start and banks into a turn. His legs
## turn towards where he goes while his chest keeps facing where he looks
## (`face_heading`), and he backs away with his steps reversed.
func _locomote(dt: float, desired: Vector3, face_heading: Variant, accelerate: float = PACE.accelerate) -> void:
	var v: Vector3 = loco.velocity
	var before := v
	var rate: float = accelerate if desired.length_squared() > v.length_squared() else PACE.brake
	var change := desired - v
	change.y = 0.0
	v += _clamp_length(change, 0.0, rate * dt)
	loco.velocity = v
	root.position += v * dt
	var speed := v.length()
	var target: Variant = face_heading if face_heading != null else (atan2(v.x, v.z) if speed > 0.25 else null)
	if target != null:
		var turn := _wrap(target - heading_of())
		var limit: float = PACE.turn * dt
		_face(heading_of() + clampf(turn * (1.0 - exp(-9.0 * dt)), -limit, limit))
	# Legs towards the steps; backwards when he backs away.
	var heading := heading_of()
	var hip := 0.0
	if speed > 0.15:
		var angle := _wrap(atan2(v.x, v.z) - heading)
		loco.backward = absf(angle) > (1.75 if loco.backward else 1.95)
		hip = clampf(_wrap(angle + PI) if loco.backward else angle, -1.1, 1.1) * _smooth(minf(1.0, speed / 0.6))
	else:
		loco.backward = false
	loco.hip_yaw += (hip - loco.hip_yaw) * (1.0 - exp(-8.0 * dt))
	# Leaning into a start (and back on braking), more forward at a run.
	var forward_accel := (v.x - before.x) * sin(heading) + (v.z - before.z) * cos(heading)
	var lean := clampf(forward_accel / maxf(dt, 1e-4) * 0.025, -0.14, 0.18) * (-0.5 if loco.backward else 1.0) + minf(speed, PACE.run) * 0.035
	loco.lean += (lean - loco.lean) * (1.0 - exp(-6.0 * dt))
	loco.bank += (clampf(-loco.turn_rate * speed * 0.035, -0.18, 0.18) - loco.bank) * (1.0 - exp(-6.0 * dt))


## Free to act: his brain's orders move him.
func _obey(dt: float) -> void:
	var o := order
	# Dazed, or crouched behind cover, he stays put.
	var desired := Vector3.ZERO
	if not (reaction.daze > 0.25 or (o.crouch and reaction.crouch > 0.3)):
		desired = Vector3(o.velocity.x, 0, o.velocity.z)
		desired = _clamp_length(desired, 0.0, PACE.run * 1.05)
	_locomote(dt, desired, o.face)


## On the floor unhurt: tumbling to a stop, lying stunned, then getting up.
func _recover_step(dt: float, time: float) -> void:
	var r: Dictionary = recover
	r.age += dt
	if r.stage == "tumble" or r.stage == "stunned":
		# Alive all the way: braced in the air, then curled and squirming on the floor.
		var airborne: bool = r.stage == "tumble" and (particle("W").y > 0.42 or _restlessness() > 2.2)
		_pose_reflex(time, "brace" if airborne else "writhe")
		_aim_muscles(dt, "reflex")
		r.effort += ((0.8 if airborne else 0.55) - r.effort) * (1.0 - exp(-10.0 * dt))
		r.support = 0.3 if airborne else 0.45
	if r.stage == "tumble":
		if (r.age > 0.45 and _restlessness() < 0.45) or r.age > 4.0:
			_settle()
			r.stage = "stunned"
			r.age = 0.0
	elif r.stage == "stunned":
		if r.age >= r.stun and towing == null:
			_begin_rise()
	elif r.stage == "rising":
		var p: float = r.age / r.duration
		# From a deep crouch up to standing, eased; the muscles do the work.
		reaction.kneel = 1.0 - ease_by(feel.recovery.riseCurve, clampf((p - 0.15) / 0.85, 0.0, 1.0))
		root.position = r.at
		_face(r.heading)
		_pose(time, dt)
		_aim_muscles(dt, "strong")
		r.effort = ease_by("outCubic", minf(1.0, r.age / 0.22))
		r.support = 1.0
		var error := 0.0
		for muscle in muscles:
			error = maxf(error, ragdoll.position(muscle.index).distance_to(muscle.to))
		if (p >= 1.0 and error < 0.09) or p > 1.7:
			var at: Vector3 = recover.at
			var heading: float = recover.heading
			recover = null
			_stand(at, heading)


## A live pose laid over his body as it lies or flies: the skeleton is fitted
## to the trunk (left to physics), and the limbs and head are set relative to
## it — braced for the fall, or, once down, curled up, squirming.
func _pose_reflex(time: float, kind: String) -> void:
	var w := particle("W")
	var n := particle("N")
	var up := (n - w).normalized()
	var left := particle("SL") - particle("SR")
	left = (left - up * left.dot(up)).normalized()
	if not is_finite(left.x) or left.length_squared() < 0.5:
		return
	var front := left.cross(up)
	_zero_joints()
	joints.pelvis.position = base
	var curl := 0.3 if kind == "brace" else 0.55
	joints.spine.quaternion = _euler(curl + _jitter(time, 1.7, 2.9, 0.9) * 0.12, _jitter(time, 1.2, 2.3, 0.6) * 0.2, _jitter(time, 1.5, 2.6, 0.8) * 0.15)
	joints.neck.quaternion = _euler((0.45 if kind == "brace" else 0.5) + _jitter(time, 2.1, 3.3, 1.1) * 0.2, _jitter(time, 1.9, 3.1, 0.9) * 0.35, 0)
	for side in SIDES:
		var s: String = side[0]
		var sign: float = side[1]
		var t := time + sign * 2.7
		if kind == "brace":
			joints["shoulder" + s].quaternion = _euler(-1.15 + _jitter(t, 4.1, 6.7, 2.3) * 0.35, 0, sign * (0.55 + _jitter(t, 3.3, 5.9, 2.1) * 0.2))
			joints["elbow" + s].quaternion = _euler(-0.5 + _jitter(t, 3.9, 6.1, 1.7) * 0.2, 0, 0)
			joints["hip" + s].quaternion = _euler(-0.55 + _jitter(t, 3.7, 6.1, 1.9) * 0.35, 0, sign * 0.12)
			joints["knee" + s].quaternion = _euler(0.9 + _jitter(t, 3.1, 5.3, 1.3) * 0.35, 0, 0)
		else:
			joints["shoulder" + s].quaternion = _euler(-0.7 + _jitter(t, 1.3, 2.3, 0.7) * 0.3, 0, sign * 0.25)
			joints["elbow" + s].quaternion = _euler(-1.6 + _jitter(t, 1.1, 2.1, 0.6) * 0.25, 0, 0)
			joints["hip" + s].quaternion = _euler(-1.0 + _jitter(t, 1.4, 2.4, 0.8) * 0.4, 0, sign * 0.15)
			joints["knee" + s].quaternion = _euler(1.5 + _jitter(t, 1.2, 2.2, 0.7) * 0.35, 0, 0)
		joints["ankle" + s].quaternion = _euler(0.3, 0, 0)
	# Fit the skeleton so its spine lies where his trunk is.
	var spine_in_root: Transform3D = (joints.pelvis as Node3D).transform * (joints.spine as Node3D).transform
	var fitted := Transform3D(Basis(left, up, front), w) * spine_in_root.affine_inverse()
	root.position = fitted.origin
	root.quaternion = fitted.basis.get_rotation_quaternion()


func _begin_rise() -> void:
	var hips := (particle("HL") + particle("HR")) * 0.5
	hips.y = 0.0
	# He gets up facing the threat if he knows of one, else the way his chest faces.
	var heading: float
	if focus != null:
		heading = atan2(focus.x - hips.x, focus.z - hips.z)
	else:
		var front := (particle("SL") - particle("SR")).cross(particle("N") - particle("W"))
		front.y = 0.0
		heading = atan2(front.x, front.z) if front.length_squared() > 1e-6 else 0.0
	recover.stage = "rising"
	recover.age = 0.0
	recover.duration = _pick(feel.recovery.rise)
	recover.at = hips
	recover.heading = heading
	recover.effort = 0.0
	for key in REACTION_SPRINGS:
		reaction[key] = 0.0
		reaction["v" + key] = 0.0
	reaction.kneel = 1.0
	reaction.yank = 0.0
	reaction.imbalance = 0.0
	reaction.wound = null
	reaction.press = null
	reaction.push = Vector3.ZERO
	reaction.offset = Vector3.ZERO
	muscle_state = {}


## Back on his feet (at `at`, which may be up in the air): the parts return to the skeleton and the pose drives them again.
func _stand(at: Vector3, heading: float) -> void:
	recover = null
	lifting = null
	muscles = []
	muscle_state = {}
	twitches = []
	spasm = null
	_settle()
	fallen = false
	root.position = at
	_face(heading)
	loco.velocity = Vector3.ZERO
	loco.last_yaw = heading
	var joined := _joined_bodies()
	if holding:
		joined.append("blaster")
	for part in bodies:
		var body: Ragdoll.Body = bodies[part]
		if not body.dynamic or not joined.has(part):
			continue
		body.dynamic = false
		for index in body.indices:
			ragdoll.set_kinematic(index, true)
		var object := body.object
		object.reparent(joints[mounts[part]], false)
		object.transform = Transform3D.IDENTITY
	reaction.kneel = 0.0
	reaction.daze = _pick(feel.recovery.daze)
	_pose(clock, 0.0)
	_place_particles(1.0 / 60.0)
	_place_particles(1.0 / 60.0)
	feed.append({ "type": "up", "point": at })


## Up and unarmed: he walks over to his rifle if it lies close enough, and bends down for it.
func _look_for_rifle() -> void:
	if holding or pickup != null or fetching != null or dead or towing != null or reaction.daze > 0.25 or reaction.wound != null or _arm_cut("L") or _arm_cut("R"):
		return
	var blaster: Ragdoll.Body = bodies.blaster
	if not blaster.dynamic:
		return
	var at := _centroid(blaster.indices)
	var distance := Vector2(at.x, at.z).distance_to(Vector2(root.position.x, root.position.z))
	if distance > feel.recovery.reach:
		return
	for index in blaster.indices:
		if ragdoll.speed(index) > 0.3:
			return
	if distance > 0.7:
		fetching = { "at": Vector3(at.x, 0, at.z), "age": 0.0 }
		return
	# The rifle leaves the physics: it is carried by the hand from here.
	blaster.dynamic = false
	for index in blaster.indices:
		ragdoll.set_kinematic(index, true)
	var from := blaster.object.global_transform
	pickup = { "age": 0.0, "duration": feel.recovery.pickup, "position": from.origin, "quaternion": from.basis.get_rotation_quaternion() }


func _pickup_step(dt: float) -> void:
	var k: Dictionary = pickup
	k.age += dt
	var p := minf(1.0, k.age / k.duration)
	reaction.kneel = 0.62 * sin(PI * minf(1.0, p * 1.1))
	var goal := holder.global_transform
	# Lifted from the floor in an arc, eased, into his hands.
	var q := ease_by("inOutCubic", clampf((p - 0.3) / 0.65, 0.0, 1.0))
	var position := (k.position as Vector3).lerp(goal.origin, q) + Vector3.UP * (0.12 * sin(PI * q))
	var turn := HeroAnimator._slerp(k.quaternion, goal.basis.get_rotation_quaternion(), q)
	parts.blaster.global_transform = Transform3D(Basis(turn), position)
	reaction.reachFor = { "point": position, "weight": sin(PI * minf(1.0, p * 1.3)) * (1.0 - q * 0.6) }
	if p < 1.0:
		return
	pickup = null
	reaction.reachFor = null
	reaction.kneel = 0.0
	parts.blaster.reparent(holder, false)
	parts.blaster.transform = Transform3D.IDENTITY
	holding = true
	reaction.letGo.L = 0.0
	reaction.letGo.R = 0.0
	feed.append({ "type": "rearmed", "point": position })


## A few steps to his rifle, briskly, then he stops by it.
func _fetch_step(dt: float) -> void:
	var f: Dictionary = fetching
	f.age += dt
	var toward: Vector3 = f.at - root.position
	toward.y = 0.0
	var distance := toward.length()
	if (distance < 0.62 and loco.velocity.length() < 0.4) or f.age > 5.0:
		fetching = null
		return
	toward /= maxf(distance, 1e-4)
	_locomote(dt, toward * (0.0 if distance < 0.6 else minf(1.6, 0.4 + distance * 1.2)), null)


## Interrupted while fetching the rifle: it falls again.
func _drop_pickup() -> void:
	if pickup == null:
		return
	pickup = null
	reaction.reachFor = null
	reaction.kneel = 0.0
	bodies.blaster.dynamic = false
	_release(["blaster"])


## Hard landings: a piece of armour may come away where he hits the floor.
func _landings(before: Array) -> void:
	if clock - landed < 0.12:
		return
	for entry in before:
		var index: int = entry[0]
		var vy: float = entry[1]
		if vy > -feel.armor.landingSpeed or ragdoll.py[index] > ragdoll.radius[index] + 0.006:
			continue
		landed = clock
		var body: Ragdoll.Body = null
		for owner in ragdoll.owners[index]:
			var candidate: Ragdoll.Body = ragdoll.bodies[owner]
			if not candidate.debris and candidate.name != "blaster":
				body = candidate
				break
		var velocity := ragdoll.velocity(index)
		velocity.y = 1.5
		_chip(body, ragdoll.position(index), velocity, feel.armor.landing)
		feed.append({ "type": "land", "point": ragdoll.position(index), "speed": -vy })
		return


func update(dt: float, time: float) -> void:
	dt = minf(dt, 0.05)
	clock += dt
	_update_tweens(dt)
	if sleep.asleep:
		return
	if not fallen and dt > 0.0:
		if impaled != null:
			_impale_step(dt, time)
		elif towing != null and towing.kind == "stand":
			_tow_standing(dt)
		elif levitating != null:
			_levitate_step(dt, time)
		elif dropping != null:
			_drop_step(dt)
		elif flee != null:
			_flee_step(dt)
		elif fetching != null:
			_fetch_step(dt)
		elif turn_back != null:
			_locomote(dt, Vector3.ZERO, turn_back)
			if absf(_wrap(turn_back - heading_of())) < 0.05:
				turn_back = null
		elif pickup == null:
			_obey(dt)
		if towing != null or levitating != null or dropping != null or impaled != null:
			loco.velocity = Vector3.ZERO
		if throwing != null:
			_throw_step(dt)
		if pickup != null:
			_pickup_step(dt)
		elif levitating == null and dropping == null and flee == null and towing == null and fetching == null and impaled == null:
			_look_for_rifle()
		# Shoved by the blows: he slides back, turning away, then catches himself.
		var r := reaction
		if towing == null and impaled == null:
			root.position.x += r.knock.x * dt
			root.position.z += r.knock.z * dt
			_face(heading_of() + r.spin * dt)
		r.knock = r.knock * exp(-5.5 * dt)
		r.spin *= exp(-6.0 * dt)
		# Crates and barrels: he walks round them, he is not pushed through them.
		if towing == null and levitating == null and impaled == null and lab:
			root.position = lab.push_out(root.position, 0.3)
		# How fast he is turning: a quick turn on the spot takes steps.
		var yaw := heading_of()
		loco.turn_rate += (_wrap(yaw - loco.last_yaw) / dt - loco.turn_rate) * (1.0 - exp(-14.0 * dt))
		loco.last_yaw = yaw
	if not fallen:
		hurt = null
		hauled = null
		_pose(time, dt)
		_place_particles(dt)
		if collapse != null and clock >= collapse.at:
			_fall(collapse.cause, collapse.velocity, collapse.cut_child)
	elif lifting != null and dt > 0.0:
		_lift_step(dt, time)
	else:
		if towing != null and towing.kind == "body" and dt > 0.0:
			_tow_body(dt)
		if impaled != null and dt > 0.0:
			_hang_step(dt)
		if hurt != null and not dead and dt > 0.0:
			hurt.attended = maxf(0.0, hurt.attended - dt)
			if hurt.attended <= 0.0:
				hurt.age += dt
				if hurt.age > hurt.bleed:
					_die("bleed")
		if crawl != null and not dead and dt > 0.0:
			_crawl_step(dt, time)
		elif recover != null and not dead and dt > 0.0:
			_recover_step(dt, time)
		_convulse(dt)
	var before := []
	if fallen and dt > 0.0:
		for index in _joined_indices():
			before.append([index, (ragdoll.py[index] - ragdoll.qy[index]) / (1.0 / 120.0)])
	if dt > 0.0:
		ragdoll.step(dt)
	if not before.is_empty():
		_landings(before)
	if slick != null and clock > slick.until:
		_settle()
	twitches = twitches.filter(func(entry: Dictionary) -> bool: return entry.t < entry.duration)
	_sync_objects()
	# Dead, on the floor, and nothing moving for a second — or, long dead, only
	# trembling where it lies (wedged against a crate): asleep.
	if dead and fallen and dt > 0.0 and impaled == null and towing == null and lifting == null and spasm == null and twitches.is_empty():
		sleep.dead += dt
		sleep.watch += dt
		if sleep.watch >= 0.5:
			var bounds := _measure()
			var centre: Vector3 = (bounds[0] + bounds[1]) * 0.5
			sleep.drift = centre.distance_to(sleep.anchor)
			sleep.anchor = centre
			sleep.watch = 0.0
		var top := _fastest()
		var quiet: bool = (top < 0.05 and slick == null) or (sleep.dead > 4.0 and top < 0.8 and sleep.drift < 0.02)
		sleep.still = sleep.still + dt if quiet else 0.0
		if sleep.still > 1.0:
			_fall_asleep()
	else:
		sleep.still = 0.0
		sleep.dead = 0.0


## The fastest moving particle of his whole body, severed pieces and rifle included (m/s).
func _fastest() -> float:
	var top := 0.0
	for index in ragdoll.count():
		if ragdoll.kinematic[index] == 0:
			var dx := ragdoll.px[index] - ragdoll.qx[index]
			var dy := ragdoll.py[index] - ragdoll.qy[index]
			var dz := ragdoll.pz[index] - ragdoll.qz[index]
			top = maxf(top, (dx * dx + dy * dy + dz * dz) * 14400.0)
	return sqrt(top)


## Where all of him lies (severed pieces included): [min, max].
func _measure() -> Array:
	var low := Vector3(INF, INF, INF)
	var high := Vector3(-INF, -INF, -INF)
	for index in ragdoll.count():
		var p := ragdoll.position(index)
		low = low.min(p)
		high = high.max(p)
	return [low - Vector3.ONE * 0.25, high + Vector3.ONE * 0.25]


## Lying still: the physics stops until something touches him.
func _fall_asleep() -> void:
	sleep.asleep = true
	sleep.still = 0.0
	sleep.bounds = _measure()
	_sync_objects()


## Touched: the physics starts again.
func wake() -> void:
	if not sleep.asleep:
		return
	sleep.asleep = false
	sleep.still = 0.0
	sleep.dead = 0.0
	sleep.drift = INF


## The same blow (numbers or names, or both null).
static func _same(a: Variant, b: Variant) -> bool:
	if a == null or b == null:
		return a == null and b == null
	return typeof(a) == typeof(b) and a == b


static func _boxes_meet(a: Array, b: Array) -> bool:
	return not (b[1].x < a[0].x or b[0].x > a[1].x or b[1].y < a[0].y or b[0].y > a[1].y or b[1].z < a[0].z or b[0].z > a[1].z)


## Closest points between segments p1q1 and p2q2 (Ericson).
static func _closest(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3) -> Dictionary:
	var d1 := q1 - p1
	var d2 := q2 - p2
	var r := p1 - p2
	var a := d1.dot(d1)
	var e := d2.dot(d2)
	var f := d2.dot(r)
	var s := 0.0
	var t := 0.0
	if a <= 1e-9 and e <= 1e-9:
		s = 0.0
		t = 0.0
	elif a <= 1e-9:
		s = 0.0
		t = clampf(f / e, 0.0, 1.0)
	else:
		var c := d1.dot(r)
		if e <= 1e-9:
			t = 0.0
			s = clampf(-c / a, 0.0, 1.0)
		else:
			var b := d1.dot(d2)
			var denominator := a * e - b * b
			s = clampf((b * f - c * e) / denominator, 0.0, 1.0) if denominator > 1e-9 else 0.0
			t = (b * s + f) / e
			if t < 0.0:
				t = 0.0
				s = clampf(-c / a, 0.0, 1.0)
			elif t > 1.0:
				t = 1.0
				s = clampf((b - c) / a, 0.0, 1.0)
	var c1 := p1 + d1 * s
	var c2 := p2 + d2 * t
	return { "s": s, "t": t, "c1": c1, "c2": c2, "distance": c1.distance_to(c2) }


## Tests the blade's sweep since the last frame against every part and
## applies cuts, scorches, armour hits and reactions. Returns the events.
## blow: which of the hero's strikes this is (all its frames are the one blow).
func strike(previous_base: Vector3, previous_tip: Vector3, blade_base: Vector3, blade_tip: Vector3, dt: float, time: float = 0.0, blow: Variant = null) -> Array:
	events = []
	if not (dt > 0.0):
		return events
	var steps := 8
	var from_direction := previous_tip - previous_base
	var to_direction := blade_tip - blade_base
	var from_length := from_direction.length()
	var to_length := to_direction.length()
	if from_length < 0.1 or to_length < 0.1:
		return events
	# Nowhere near him: nothing to test.
	var low := previous_base.min(previous_tip).min(blade_base).min(blade_tip)
	var high := previous_base.max(previous_tip).max(blade_base).max(blade_tip)
	if not _boxes_meet([low, high], sleep.bounds if sleep.asleep else _measure()):
		return events
	from_direction = from_direction.normalized()
	to_direction = to_direction.normalized()
	var turn := Quaternion(from_direction, to_direction)
	var blade := func(k: int) -> Dictionary:
		var f := float(k) / steps
		var partial := HeroAnimator._slerp(Quaternion.IDENTITY, turn, f)
		var at := previous_base.lerp(blade_base, f)
		var direction := partial * from_direction
		var length := from_length + (to_length - from_length) * f
		return { "base": at, "direction": direction, "length": length, "tip": at + direction * length }
	var hits := []
	var done := {}
	var before: Dictionary = blade.call(0)
	for k in range(1, steps + 1):
		var now: Dictionary = blade.call(k)
		for body in ragdoll.bodies:
			if body.capsule.is_empty() or done.has(body) or time - body.last_hit < 0.25:
				continue
			var radius: float = body.capsule[2]
			var p0 := ragdoll.position(body.indices[body.capsule_slots[0]])
			var p1 := ragdoll.position(body.indices[body.capsule_slots[1]])
			var result := _closest(now.base, now.tip, p0, p1)
			if result.distance > radius:
				continue
			done[body] = true
			var previous_point: Vector3 = before.base + before.direction * (before.length * result.s)
			var velocity: Vector3 = (result.c1 - previous_point) / (dt / steps)
			hits.append({ "body": body, "s": result.t, "point": result.c1, "axisPoint": result.c2, "velocity": velocity, "direction": now.direction, "normal": (now.direction as Vector3).cross(velocity).normalized() })
		before = now
	_pending = null
	# Standing and still fresh, he is burnt and staggered — not yet cut apart (the whole swing that wounded him counts as that one blow).
	var same_blow: bool = _same(blow, wounding_blow) if blow != null else clock - wounded_at < 0.25
	# Caught unaware (his squad's mind says he has not seen the hero coming), the first blow kills.
	sparing = not dead and not fallen and not unaware and (blows < feel.hit.toughness or same_blow)
	if not hits.is_empty():
		wake()
	for hit in hits:
		_resolve(hit, time)
	if _pending != null:
		_stagger(_pending)
	# The same swing keeps touching him: it is still that one blow.
	var wounded := false
	for event in events:
		if event.get("wound", false):
			wounded = true
	if wounded:
		if (not _same(blow, wounding_blow)) if blow != null else clock - wounded_at >= 0.25:
			blows += 1
		wounded_at = clock
		wounding_blow = blow
	return events


func _resolve(hit: Dictionary, time: float) -> void:
	var body: Ragdoll.Body = hit.body
	body.last_hit = time
	var velocity: Vector3 = hit.velocity
	var speed := velocity.length()
	var horizontal: bool = absf(hit.normal.y) > 0.6
	var event := { "type": "graze", "part": body.name, "point": hit.point, "velocity": velocity, "normal": hit.normal, "speed": speed }
	var spark_direction := velocity.normalized() if speed > 0.01 else Vector3(0, 1, 0)
	var part := body.name
	var side := part.substr(part.length() - 1)
	var was_dead := dead
	var was_standing := not fallen and not dead
	var alive := not dead
	var standing := not fallen
	if speed < CUT_SPEED:
		# Never twice the same spray.
		if effects:
			effects.sparks(hit.point, spark_direction, hit.normal, { "count": roundi(_pick(feel.sparks.graze) * (0.4 if speed < 0.6 else 1.0)), "speed": 1.5 + speed })
		if speed > 0.6:
			_flash_part(body, 0.35)
		if speed > 0.6:
			if alive and standing:
				_react(velocity, hit.point, 0.35, part)
			elif alive:
				_suffer(0.4)
			elif speed > 1.2:
				_jolt(body, hit)
		if speed > 1.2 and _chip(body, hit.point, velocity, feel.armor.graze) != null:
			event.type = "armor"
		events.append(event)
		return
	var joint: Variant = null
	if part == "head":
		joint = "neck"
	elif part == "torso":
		joint = "neck" if hit.s > 0.78 else ("waist" if hit.s < 0.32 and horizontal else null)
	elif part == "pelvis":
		joint = "waist" if horizontal else ("hipL" if hit.s < 0.5 else "hipR")
	elif part.begins_with("upperArm"):
		joint = ("shoulder" if hit.s < 0.42 else "elbow") + side
	elif part.begins_with("forearm"):
		joint = ("elbow" if hit.s < 0.45 else "wrist") + side
	elif part.begins_with("hand"):
		joint = "wrist" + side
	elif part.begins_with("thigh"):
		joint = ("hip" if hit.s < 0.35 else "knee") + side
	elif part.begins_with("shin"):
		joint = ("knee" if hit.s < 0.45 else "ankle") + side
	elif part.begins_with("foot"):
		joint = "ankle" + side
	# The faster the blade, the bigger the spray — never twice the same
	# (sent once the blow is settled: a limb coming off sends fewer).
	var spray := _pick(feel.sparks.cut) * clampf(0.5 + speed / 12.0, 0.6, 1.2)
	if effects:
		effects.flash(hit.point, minf(1.2, speed / 5.0))
	_flash_part(body, 1.0)
	if sparing and part != "blaster":
		# A wounding blow: a scorch across the armour, a spray, a plate may fly, and he reels from it — limbs stay on.
		event.type = "slash"
		event.wound = true
		_scorch(body, hit)
		if effects:
			effects.burst(hit.point, { "normal": hit.normal, "power": 0.4 })
			effects.sparks(hit.point, spark_direction, hit.normal, { "count": roundi(_pick(feel.sparks.slash)), "speed": 1.5 + minf(speed, 8.0) * 0.4 })
		_chip(body, hit.point, velocity, feel.armor.slash)
		_react(velocity, hit.point, 1.15 if part == "torso" or part == "pelvis" or part == "head" else 1.0, part)
		if part == "torso" or part == "pelvis":
			_press_wound(hit.point)
	elif part == "blaster":
		event.type = "disarm"
		if holding:
			_drop_blaster(velocity)
		else:
			ragdoll.push(body.indices, _clamp_length(velocity, 0.0, 6.0) * 0.3)
	elif joint != null and _cut(joint, hit):
		event.type = "cut"
		event.joint = joint
		# A limb off: fewer sparks, red drops thrown with the blade — as many as the part is big — and more falling from both sides of the cut.
		spray *= feel.severed.sparks
		var kind: String = joint
		var last := kind.substr(kind.length() - 1)
		if last == "L" or last == "R":
			kind = kind.substr(0, kind.length() - 1)
		var amount: float = feel.severed.parts.get(kind, 1.0)
		if effects:
			effects.bleed(hit.point, spark_direction, hit.normal, { "speed": 2.0 + minf(speed, 8.0) * 0.5, "amount": amount })
			for entry in caps[joint]:
				effects.drip(entry.cap, NAN, amount)
		_flash_part(bodies[CUTS[joint].child], 1.0)
		if effects:
			effects.burst(hit.point, { "normal": hit.normal, "power": 0.5 + speed / 10.0 })
		_chip(bodies[CUTS[joint].parent], hit.point, velocity, feel.armor.cut)
		if fallen:
			ragdoll.push(body.indices, _clamp_length(velocity, 0.0, 6.0) * 0.1)
	elif part == "torso" or part == "pelvis":
		event.type = "slash"
		_scorch(body, hit)
		if effects:
			effects.burst(hit.point, { "normal": hit.normal, "power": 0.3 })
			effects.sparks(hit.point, spark_direction, hit.normal, { "count": roundi(_pick(feel.sparks.slash)), "speed": 1.5 + minf(speed, 8.0) * 0.4 })
		_chip(body, hit.point, velocity, feel.armor.slash)
		if alive and standing:
			if speed > SLASH_LETHAL_SPEED:
				_die("slash", velocity)
			else:
				_react(velocity, hit.point, 1.2, part)
				_press_wound(hit.point)
		elif alive:
			_die("slash")
		if fallen:
			_jolt(body, hit)
	else:
		_chip(body, hit.point, velocity, feel.armor.graze)
		if alive and standing:
			_react(velocity, hit.point, 0.8, part)
		elif alive:
			_suffer(0.7)
			_jolt(body, hit)
		else:
			_jolt(body, hit)
	if effects:
		effects.sparks(hit.point, spark_direction, hit.normal, { "count": roundi(spray), "speed": 2.0 + minf(speed, 8.0) * 0.5 })
	if not was_dead and dead:
		event.lethal = true
	if was_standing and fallen:
		event.felled = true
	events.append(event)


func dispose() -> void:
	for node in [root, debris]:
		if node != null and is_instance_valid(node):
			node.get_parent().remove_child(node)
			node.queue_free()
	root = null
	debris = null


func reset() -> void:
	_clear_tweens()
	dispose()
	build()


## Where the standing trooper blocks the hero (null once he is down): { x, z, radius }.
func blocker() -> Variant:
	if fallen:
		return null
	var at := (joints.pelvis as Node3D).global_position
	return { "x": at.x, "z": at.z, "radius": 0.36 }


## Free to act on his own: up, alive, not in the Force's grip, not running off, rearming or reeling.
func is_free() -> bool:
	return not dead and not fallen and towing == null and levitating == null and dropping == null and flee == null and fetching == null and pickup == null and lifting == null and collapse == null and impaled == null and turn_back == null


## Pulls the trigger: a bolt leaves the muzzle along the barrel ({ from, direction }, or null when he cannot fire).
func fire() -> Variant:
	if not holding or not is_free() or (reaction.aim < 0.75 and reaction.blind < 0.75) or reaction.wound != null:
		return null
	var from := holder.to_global(MUZZLE)
	var direction := (holder.global_basis * Vector3(0, 0, 1)).normalized()
	# The kick: the muzzle jumps, the shoulder and head take it.
	reaction.vrecoil += 9.0
	reaction.vpitch -= 0.25
	reaction.vhead -= 0.5
	feed.append({ "type": "shot", "point": from })
	return { "from": from, "direction": direction }


## A blaster bolt travelling from a to b: the part of him it hits first ({ body, s, t, point, axisPoint }), or null.
func bolt_hit(a: Vector3, b: Vector3, radius: float = 0.025) -> Variant:
	var best: Variant = null
	if not _boxes_meet([a.min(b), a.max(b)], sleep.bounds if sleep.asleep else _measure()):
		return null
	for body in ragdoll.bodies:
		if body.capsule.is_empty() or body.name == "blaster":
			continue
		var p0 := ragdoll.position(body.indices[body.capsule_slots[0]])
		var p1 := ragdoll.position(body.indices[body.capsule_slots[1]])
		var result := _closest(a, b, p0, p1)
		if result.distance > body.capsule[2] + radius or (best != null and result.s >= best.s):
			continue
		best = { "body": body, "s": result.s, "t": result.t, "point": result.c1, "axisPoint": result.c2 }
	return best


## A round, glowing burn where a bolt struck the armour.
func _burn(body: Ragdoll.Body, point: Vector3, axis_point: Vector3) -> void:
	var normal := point - axis_point
	if normal.length_squared() < 1e-8:
		return
	normal = normal.normalized()
	var material := _glowing()
	var mark := MeshInstance3D.new()
	mark.name = "Blaster burn"
	mark.mesh = _disc(0.035, 8)
	mark.material_override = material
	mark.set_meta("mark", true)
	debris.add_child(mark)
	mark.global_transform = Transform3D(Basis(Quaternion(Vector3(0, 0, 1), normal)), axis_point + normal * (body.capsule[2] * 0.97))
	mark.reparent(body.object, true)
	marks.append(mark)
	if effects:
		effects.glow(material, 3.0)


## High on the chest, the heart: a bolt there kills like one in the head.
func _heart(point: Vector3) -> bool:
	var w := particle("W")
	var n := particle("N")
	return (point.y - w.y) / maxf(0.05, n.y - w.y) > feel.wounded.heart


## A bolt in the body: he goes down alive, hurt, and stays down until a squadmate treats him — or he bleeds out.
func _down(blow: Vector3) -> void:
	_fall("bolt", blow)
	if dead or recover == null:
		return
	recover.stun = INF
	hurt = { "age": 0.0, "bleed": _pick(feel.wounded.bleed), "attended": 0.0 }


## Treated: he gets up (the next moment), facing the threat.
func _heal() -> bool:
	if hurt == null or dead or recover == null:
		return false
	hurt = null
	hauled = null
	recover.stun = 0.0
	if recover.stage == "stunned":
		recover.age = 0.0
	return true


## A squadmate's hand at his collar (world point, and how it moves); null lets go.
func _drag(point: Variant, velocity: Variant = null) -> void:
	if point == null or hurt == null:
		hauled = null
		return
	if hauled == null:
		hauled = { "point": Vector3.ZERO, "velocity": Vector3.ZERO }
	hauled.point = point
	hauled.velocity = Vector3(velocity.x, 0, velocity.z) if velocity != null else Vector3.ZERO


## Someone is with him: he does not bleed out meanwhile.
func attend() -> void:
	if hurt != null:
		hurt.attended = 0.3


## Nobody left to come: he soon bleeds out.
func abandon() -> void:
	if hurt != null:
		hurt.bleed = minf(hurt.bleed, hurt.age + feel.wounded.alone)


## Struck by a bolt (one the blade sent back): it burns into the armour and
## throws him back. In the head or the heart it kills; elsewhere in the body
## he goes down alive, hurt; in a limb it staggers him, an arm loses the
## rifle, a leg gives way. Returns the event.
func _shot(hit: Dictionary, velocity: Vector3) -> Dictionary:
	var body: Ragdoll.Body = hit.body
	var part := body.name
	var along := velocity.normalized()
	var speed := velocity.length()
	var event := { "type": "shot", "part": part, "point": hit.point, "velocity": velocity, "speed": speed }
	var was_dead := dead
	var was_standing := not fallen and not dead
	if effects:
		effects.sparks(hit.point, (-along + Vector3(0, 0.4, 0)).normalized(), Vector3(along.z, 0, -along.x).normalized(), { "count": roundi(_pick(feel.sparks.slash)), "speed": 3.0 })
		effects.flash(hit.point, 0.9)
		effects.burst(hit.point, { "normal": -along, "power": 0.5 })
	_flash_part(body, 1.0)
	_burn(body, hit.point, hit.axisPoint)
	_chip(body, hit.point, velocity, feel.armor.slash)
	var blow := along * 4.5
	_pending = null
	if was_standing:
		if part == "head" or (part == "torso" and _heart(hit.point)):
			_die("bolt", blow)
		elif part == "torso" or part == "pelvis":
			_down(blow)
		elif part.begins_with("thigh") or part.begins_with("shin") or part.begins_with("foot"):
			_react(blow, hit.point, 1.2, part)
			reaction.imbalance += 0.7
		else:
			_react(blow, hit.point, 1.1, part)
			if part.begins_with("upperArm") or part.begins_with("forearm") or part.begins_with("hand"):
				_drop_blaster(blow)
			else:
				_press_wound(hit.point)
	elif hurt != null:
		_die("bolt", blow)
	elif not dead:
		_suffer(1.0)
		_jolt(body, { "velocity": blow })
	else:
		_jolt(body, { "velocity": blow })
	if _pending != null:
		_stagger(_pending)
	if not was_dead and dead:
		event.lethal = true
	if was_standing and fallen:
		event.felled = true
	return event


# ---- His tweens (tween.js's createTweens) ---------------------------------------

func _add_tween(duration: float, curve: String, on_update: Callable, on_complete: Callable = Callable()) -> Dictionary:
	var tween := { "duration": maxf(duration, 1e-4), "curve": curve, "update": on_update, "complete": on_complete, "age": 0.0, "done": false }
	_tweens.append(tween)
	return tween


func _cancel_tween(tween: Variant) -> void:
	if tween == null or tween.done:
		return
	tween.done = true
	if tween.complete.is_valid():
		tween.complete.call()


func _update_tweens(dt: float) -> void:
	for tween in _tweens:
		if tween.done:
			continue
		tween.age += dt
		var progress := clampf(tween.age / tween.duration, 0.0, 1.0)
		tween.update.call(ease_by(tween.curve, progress), progress)
		if progress >= 1.0:
			tween.done = true
			if tween.complete.is_valid():
				tween.complete.call()
	_tweens = _tweens.filter(func(tween: Dictionary) -> bool: return not tween.done)


func _clear_tweens() -> void:
	var list := _tweens
	_tweens = []
	for tween in list:
		if not tween.done:
			tween.update.call(ease_by(tween.curve, 1.0), 1.0)
			if tween.complete.is_valid():
				tween.complete.call()


# ---- What the game asks of him ---------------------------------------------------

## Where a particle of his is (the world).
func particle(particle_name: String) -> Vector3:
	return ragdoll.position(particle_index[particle_name])


## Where his particle `index` is (severed copies and loose plates included).
func particle_position(index: int) -> Vector3:
	return ragdoll.position(index)


func index_of(particle_name: String) -> int:
	return particle_index[particle_name]


## Slows his flying body (it hit something).
func slow(factor: float) -> void:
	wake()
	for index in _joined_indices():
		if ragdoll.kinematic[index] == 0:
			ragdoll.qx[index] += (ragdoll.px[index] - ragdoll.qx[index]) * (1.0 - factor)
			ragdoll.qy[index] += (ragdoll.py[index] - ragdoll.qy[index]) * (1.0 - factor)
			ragdoll.qz[index] += (ragdoll.pz[index] - ragdoll.qz[index]) * (1.0 - factor)


func cut(joint: String, hit: Dictionary) -> bool:
	wake()
	return _cut(joint, hit)


func die(cause: String, velocity: Vector3 = Vector3.ZERO) -> void:
	wake()
	_die(cause, velocity)


func fall(cause: String, velocity: Vector3 = Vector3.ZERO) -> void:
	wake()
	_fall(cause, velocity)


func force_push(velocity: Vector3) -> void:
	wake()
	_force_push(velocity)


func force_pull(to: Vector3, hold_on: bool = false) -> bool:
	wake()
	return _force_pull(to, hold_on)


func hold(point: Vector3, heading: Variant = null) -> void:
	wake()
	_hold(point, heading)


func drop() -> void:
	wake()
	_drop()


func shot(hit: Dictionary, velocity: Vector3) -> Dictionary:
	wake()
	return _shot(hit, velocity)


func impale(point: Vector3, heading: float) -> bool:
	wake()
	return _impale(point, heading)


func skewer(point: Vector3, heading: Variant = null) -> void:
	wake()
	_skewer(point, heading)


func slide_off(velocity: Vector3 = Vector3.ZERO) -> bool:
	wake()
	return _slide_off(velocity)


func heal() -> bool:
	wake()
	return _heal()


func drag(point: Variant, velocity: Variant = null) -> void:
	wake()
	_drag(point, velocity)


## In the middle of throwing a grenade.
func is_throwing() -> bool:
	return throwing != null


## How he is moving (world, m/s).
func velocity() -> Vector3:
	return loco.velocity


## Where a bolt would leave his rifle.
func muzzle() -> Vector3:
	return holder.to_global(MUZZLE)


## Where his eyes are.
func eye() -> Vector3:
	return (joints.neck as Node3D).to_global(Vector3(0, 0.19, 0.09))


## Where his rifle lies, if it is on the floor (null in his hands, or when he cannot hold one).
func rifle() -> Variant:
	if holding or not bodies.blaster.dynamic or _arm_cut("L") or _arm_cut("R"):
		return null
	var at := _centroid(bodies.blaster.indices)
	return Vector3(at.x, 0, at.z)


## On the blade (struggling, or dead and hanging from it).
func is_impaled() -> bool:
	return impaled != null


## Down, alive and hurt: waiting for a squadmate to drag him to cover and treat him.
func is_hurt() -> bool:
	return hurt != null


## Being dragged by a squadmate's hand.
func is_hauled() -> bool:
	return hauled != null


## Dead, still, and out of the physics until something touches him.
func is_asleep() -> bool:
	return sleep.asleep


## Where all of him lies (severed pieces included): [min, max].
func bounds() -> Array:
	return sleep.bounds if sleep.asleep else _measure()


## News for the game since the last call: landings, armour lost, pulled, up, rearmed.
func take_news() -> Array:
	var list := feed
	feed = []
	return list


## Armour still on him.
func armour() -> int:
	var count := 0
	for piece in pieces.values():
		if not piece.get_meta("loose", false):
			count += 1
	return count


## 'standing', 'wounded', 'impaled', 'pulled', 'held', 'dropping', 'fleeing', 'dazed',
## 'rearming', 'stunned', 'hurt', 'rising', 'down', 'crawling' or 'dead'.
func state() -> String:
	if dead:
		return "dead"
	if not fallen:
		if impaled != null:
			return "impaled"
		if towing != null:
			return "pulled"
		if levitating != null:
			return "held"
		if dropping != null:
			return "dropping"
		if flee != null:
			return "fleeing"
		if pickup != null or fetching != null:
			return "rearming"
		if reaction.daze > 0.2:
			return "dazed"
		if reaction.wound != null:
			return "wounded"
		return "standing"
	if lifting != null:
		return "pulled"
	if recover != null:
		return "rising" if recover.stage == "rising" else ("hurt" if hurt != null else "stunned")
	return "crawling" if crawl != null and crawl.stage == "crawl" else "down"


## The squad's bodies meet: a body thrown into a standing trooper knocks him
## over (and is slowed), and bodies on the floor shove each other aside.
static func collide_squad(troopers: Array) -> void:
	# Where each body lying lies, worked out once for the frame (a sleeping one's is kept).
	var boxes := {}
	for t: Stormtrooper in troopers:
		if t.fallen:
			boxes[t] = t.bounds()
	for ia in troopers.size():
		var a: Stormtrooper = troopers[ia]
		if not a.fallen:
			continue
		for ib in troopers.size():
			var b: Stormtrooper = troopers[ib]
			if a == b:
				continue
			if not b.fallen:
				var block: Variant = b.blocker()
				# Getting up, or dragged by a squadmate's hand, he knocks nobody over.
				if block == null or b.dead or (a.recover != null and a.recover.stage == "rising") or a.hauled != null:
					continue
				for key in ["W", "N", "HT", "HL", "HR"]:
					var index := a.index_of(key)
					var rd := a.ragdoll
					if rd.kinematic[index] != 0 or rd.py[index] > 1.7:
						continue
					if Vector2(rd.px[index] - block.x, rd.pz[index] - block.z).length() > block.radius + rd.radius[index]:
						continue
					var speed := rd.velocity(index)
					# A man lying hurt (writhing, twitching, dragged) trips nobody up; thrown, he does.
					if speed.length() < (5.0 if a.hurt != null else 2.2):
						continue
					var push := speed * 0.65
					push.y = 1.4
					b.force_push(push)
					a.slow(0.45)
					break
			elif ia < ib:
				# Two sleeping bodies do not move; two far apart cannot touch.
				if (a.is_asleep() and b.is_asleep()) or not _boxes_meet(boxes[a], boxes[b]):
					continue
				var pa := a.ragdoll
				var pb := b.ragdoll
				# A particle of his far from all of the other (beyond his box, grown by more than any two radii) meets none of it.
				var near_low: Vector3 = boxes[b][0] - Vector3.ONE * 0.5
				var near_high: Vector3 = boxes[b][1] + Vector3.ONE * 0.5
				for i in pa.count():
					if pa.kinematic[i] != 0:
						continue
					var x := pa.px[i]
					var y := pa.py[i]
					var z := pa.pz[i]
					if x < near_low.x or x > near_high.x or y < near_low.y or y > near_high.y or z < near_low.z or z > near_high.z:
						continue
					for j in pb.count():
						if pb.kinematic[j] != 0:
							continue
						var reach := pa.radius[i] + pb.radius[j]
						var dx := pb.px[j] - pa.px[i]
						var dy := pb.py[j] - pa.py[i]
						var dz := pb.pz[j] - pa.pz[i]
						var squared := dx * dx + dy * dy + dz * dz
						if squared >= reach * reach or squared < 1e-10:
							continue
						var distance := sqrt(squared)
						# Against a sleeping body: one only resting on it is pushed off it alone; one landing on it wakes it.
						if a.is_asleep() or b.is_asleep():
							var moving_a := not a.is_asleep()
							var rd := pa if moving_a else pb
							var k := i if moving_a else j
							var moved := sqrt(pow(rd.px[k] - rd.qx[k], 2) + pow(rd.py[k] - rd.qy[k], 2) + pow(rd.pz[k] - rd.qz[k], 2)) * 120.0
							if moved < 0.5 and reach - distance < 0.03:
								var shift := (reach - distance) / distance * (1.0 if a.is_asleep() else -1.0)
								rd.px[k] += dx * shift; rd.py[k] += dy * shift; rd.pz[k] += dz * shift
								rd.qx[k] += dx * shift; rd.qy[k] += dy * shift; rd.qz[k] += dz * shift
								continue
							a.wake()
							b.wake()
						var half := (reach - distance) * 0.5 / distance
						# Apart without adding speed: bodies piled up stay calm.
						pa.px[i] -= dx * half; pa.py[i] -= dy * half; pa.pz[i] -= dz * half
						pa.qx[i] -= dx * half; pa.qy[i] -= dy * half; pa.qz[i] -= dz * half
						pb.px[j] += dx * half; pb.py[j] += dy * half; pb.pz[j] += dz * half
						pb.qx[j] += dx * half; pb.qy[j] += dy * half; pb.qz[j] += dz * half
