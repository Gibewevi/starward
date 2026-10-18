"""
Pre-computed explosion for STARWARD, generated with Blender (Mantaflow + Cycles).

A grenade going off on the floor: a real fire-and-smoke simulation. A charge
of fuel bursts out broken up by a noise texture (a lumpy fireball, not a
ball), burning fragments fly out on ballistic arcs trailing fire and soot,
the fuel burns out fast while the smoke keeps billowing, thick, then thins
away. Detail comes from the simulation: a fine base grid plus Mantaflow's
noise upres. The look: light, lit smoke over dark soot, the fire's colour
from its flame grid through a ramp, an orange light inside that flashes and
fades so the smoke is lit from within, and a hue-keeping tone curve when the
frames are packed (orange stays orange, only the hottest core whitens).

Rendered from the game's isometric camera — same direction, orthographic —
on a transparent background, packed into one PNG flipbook with its metadata.

Run headless (it does not touch an open Blender session):
  blender -b --factory-startup --python scripts/explosion-blender.py -- public/fx [size] [frames]
Environment: RESOLUTION (base grid, 128), UPRES (noise upres, 2), SAMPLES (128), EXPOSURE (1).
"""
import bpy, json, math, os, random, shutil, sys, tempfile
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'public/fx')
SIZE = int(argv[1]) if len(argv) > 1 else 192     # pixels per frame: the game shows it at about 1:1 (4x pixels)
FRAMES = int(argv[2]) if len(argv) > 2 else 56     # frames kept in the flipbook
RESOLUTION = int(os.environ.get('RESOLUTION', 96))
UPRES = int(os.environ.get('UPRES', 1))
SAMPLES = int(os.environ.get('SAMPLES', 128))
ORTHO = 6.6                                        # metres across a frame
TARGET = Vector((0, 0, 1.7))                       # the frame's centre, in Blender space (Z up)
# The game camera looks along -(8, 8.2, 10) in three.js (Y up); in Blender (Z up) that offset is (8, -10, 8.2).
OFFSET = Vector((8, -10, 8.2)).normalized()
FPS = 30
random.seed(7)

os.makedirs(OUT, exist_ok=True)
work = tempfile.mkdtemp(prefix='starward-explosion-')
scene = bpy.context.scene
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
scene.frame_start, scene.frame_end = 1, FRAMES + 4
scene.render.fps = FPS


def keyframes_constant(obj):
    action = obj.animation_data.action if obj.animation_data else None
    if not action:
        return
    curves = getattr(action, 'fcurves', None)
    if curves is None:  # layered actions (Blender 4.4+)
        curves = [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for point in fc.keyframe_points:
            point.interpolation = 'CONSTANT'


# ---- Simulation ---------------------------------------------------------------
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 3.0))
domain = bpy.context.active_object
domain.name = 'Domain'
domain.scale = (3.9, 3.9, 3.0)
bpy.ops.object.transform_apply(scale=True)
fluid = domain.modifiers.new('Fluid', 'FLUID')
fluid.fluid_type = 'DOMAIN'
d = fluid.domain_settings
d.domain_type = 'GAS'
d.resolution_max = RESOLUTION
d.cache_directory = os.path.join(work, 'cache')
d.cache_type = 'ALL'
d.cache_frame_start, d.cache_frame_end = 1, FRAMES + 4
d.use_adaptive_domain = False  # an adaptive domain chokes a fast blast
d.adapt_margin = 6
d.adapt_threshold = 0.004
d.alpha = 0.0             # smoke neither sinks nor lifts by its weight
d.beta = 1.25             # heat lifts it into a column
d.vorticity = float(os.environ.get('VORTICITY', 0.6))
d.use_dissolve_smoke = True
d.dissolve_speed = 200
d.use_dissolve_smoke_log = True
d.burning_rate = float(os.environ.get('BURN', 0.5))      # the fire rolls on for most of a second
d.flame_smoke = 4.0       # burning makes thick smoke
d.flame_vorticity = 0.7
d.flame_max_temp = 3.0
d.flame_ignition = 1.25
d.flame_smoke_color = (0.7, 0.63, 0.56)   # smoke from the burning
d.timesteps_max = 8
d.timesteps_min = 2
d.use_noise = UPRES > 1
d.noise_scale = max(UPRES, 1)
d.noise_strength = 1.6
d.noise_pos_scale = 2.2
d.noise_time_anim = 0.12


def flow(obj, *, fuel, temperature, density, color, normal=0.0, source=0.0, coord=None, texture=None, distance=0.2):
    m = obj.modifiers.new('Fluid', 'FLUID')
    m.fluid_type = 'FLOW'
    s = m.flow_settings
    s.flow_type = 'BOTH'
    s.flow_behavior = 'INFLOW'
    s.flow_source = 'MESH'
    s.surface_distance = distance
    s.fuel_amount = fuel
    s.temperature = temperature
    s.density = density
    s.smoke_color = color
    s.use_initial_velocity = True
    s.velocity_factor = source
    s.velocity_normal = normal
    if coord:
        s.velocity_coord = coord
    if texture:
        s.use_texture = True
        s.noise_texture = texture
        s.texture_map_type = 'AUTO'
        s.texture_size = 0.6
    obj.hide_render = True
    return s


# The blast: a burst of hundreds of particles thrown out of the charge and
# braked by drag, each one emitting fuel and smoke along its path. A gas sim
# is incompressible, so pushing the gas outward does little; particles flying
# out are what make the fireball balloon in a few frames, then slow down.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.3, location=(0, 0, 0.55))
charge = bpy.context.active_object
charge.name = 'Charge'
charge.modifiers.new('Burst', 'PARTICLE_SYSTEM')
burst = charge.particle_systems[0]
p = burst.settings
p.count = int(os.environ.get('PARTICLES', 500))
p.frame_start, p.frame_end = 1, 3
p.lifetime, p.lifetime_random = int(os.environ.get('LIFE', 5)), 0.4
p.emit_from = 'FACE'
p.use_emit_random = True
p.normal_factor = float(os.environ.get('BURST', 7.5))
p.factor_random = 3.0
p.physics_type = 'NEWTON'
p.drag_factor = float(os.environ.get('DRAG', 0.6))
p.damping = 0.03
p.effector_weights.gravity = 0.25
p.render_type = 'NONE'
charge.show_instancer_for_render = False
m = charge.modifiers.new('Fluid', 'FLUID')
m.fluid_type = 'FLOW'
s = m.flow_settings
s.flow_type = 'BOTH'
s.flow_behavior = 'INFLOW'
s.flow_source = 'PARTICLES'
s.particle_system = burst
s.use_particle_size = False
s.particle_size = float(os.environ.get('PUFF', 0.7))
s.subframes = 2
s.fuel_amount = 2.2
s.temperature = 3.0
s.density = 1.4
s.smoke_color = (0.92, 0.86, 0.78)
s.use_initial_velocity = True
s.velocity_factor = 1.0
charge.hide_render = True

# Burning fragments thrown out on ballistic arcs: fingers of fire and soot.
for i in range(5):
    angle = i / 5 * math.tau + random.uniform(-0.3, 0.3)
    speed = random.uniform(5.5, 8.5)
    lift = random.uniform(3.0, 7.0)
    start = Vector((math.cos(angle) * 0.3, math.sin(angle) * 0.3, 0.5))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=random.uniform(0.09, 0.15), location=start)
    shard = bpy.context.active_object
    shard.name = f'Fragment{i}'
    flow(shard, fuel=1.2, temperature=2.4, density=0.7, color=(0.24, 0.2, 0.18), source=0.5, distance=0.12)
    life = random.randint(7, 11)
    for frame in range(1, life + 1):
        t = (frame - 1) / FPS
        shard.location = start + Vector((math.cos(angle) * speed * t, math.sin(angle) * speed * t, lift * t - 4.9 * t * t))
        shard.location.z = max(shard.location.z, 0.15)
        shard.keyframe_insert('location', frame=frame)
    shard.location = (0, 0, -50)
    shard.keyframe_insert('location', frame=life + 1)

print('baking...', flush=True)
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
domain.select_set(True)
bpy.context.view_layer.objects.active = domain
with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
    bpy.ops.fluid.bake_all()
print('baked', flush=True)

# ---- Look ---------------------------------------------------------------------
material = bpy.data.materials.new('Explosion')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
nodes.clear()
output = nodes.new('ShaderNodeOutputMaterial')
volume = nodes.new('ShaderNodeVolumePrincipled')
volume.inputs['Anisotropy'].default_value = float(os.environ.get('ANISOTROPY', -0.1))  # lit from the camera's side: no forward scattering
volume.inputs['Absorption Color'].default_value = (0.0, 0.0, 0.0, 1)


def attribute(name):
    node = nodes.new('ShaderNodeAttribute')
    node.attribute_name = name
    return node


def math_node(operation, value, source):
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    node.inputs[1].default_value = value
    links.new(source, node.inputs[0])
    return node.outputs[0]


# Smoke: crisp billows (density sharpened), its colour from the simulation
# (light charge smoke, dark soot).
density = attribute('density')
sharp = nodes.new('ShaderNodeMapRange')
sharp.inputs['From Min'].default_value = 0.02
sharp.inputs['From Max'].default_value = 0.55
links.new(density.outputs['Fac'], sharp.inputs['Value'])
links.new(math_node('MULTIPLY', float(os.environ.get('THICK', 5.0)), math_node('POWER', 1.35, sharp.outputs['Result'])), volume.inputs['Density'])
# The smoke's colour grid is stored weighted by density: the node's own
# colour attribute undoes that (an Attribute node would darken thin smoke).
volume.inputs['Color'].default_value = (1, 1, 1, 1)
volume.inputs['Color Attribute'].default_value = 'color'
volume.inputs['Density Attribute'].default_value = ''

# Fire: the flame grid through a ramp, intensity rising steeply with it.
flame = attribute('flame')
ramp = nodes.new('ShaderNodeValToRGB')
stops = [(0.0, (0, 0, 0, 1)), (0.08, (0.4, 0.02, 0.0, 1)), (0.25, (1.0, 0.18, 0.01, 1)), (0.5, (1.0, 0.42, 0.05, 1)), (0.78, (1.0, 0.66, 0.2, 1)), (1.0, (1.0, 0.85, 0.55, 1))]
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = stops[0]
ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = stops[-1]
for position, color in stops[1:-1]:
    ramp.color_ramp.elements.new(position).color = color
links.new(flame.outputs['Fac'], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], volume.inputs['Emission Color'])
links.new(math_node('MULTIPLY', float(os.environ.get('GLOW', 22.0)), math_node('POWER', 1.6, flame.outputs['Fac'])), volume.inputs['Emission Strength'])
links.new(volume.outputs['Volume'], output.inputs['Volume'])
domain.data.materials.clear()
domain.data.materials.append(material)

# Light: the game's key from above, and the blast's own light inside the
# cloud — a flash that fades as the fire burns out, lighting the smoke from within.
# The key comes from above and from the camera's side (front-left), so the
# billows the camera sees are lit, with their shadows falling behind them.
right = (-OFFSET).cross(Vector((0, 0, 1))).normalized()
toward_light = (OFFSET * 0.7 + Vector((0, 0, 1.1)) - right * 0.6).normalized()
bpy.ops.object.light_add(type='SUN', rotation=(-toward_light).to_track_quat('-Z', 'Y').to_euler())
bpy.context.active_object.data.angle = math.radians(8)
sun = bpy.context.active_object.data
sun.energy = float(os.environ.get('SUN', 18.0))
sun.color = (1.0, 0.9, 0.8)
bpy.ops.object.light_add(type='POINT', location=(0, 0, 0.9))
blast = bpy.context.active_object.data
blast.color = (1.0, 0.48, 0.14)
blast.shadow_soft_size = 0.9
for frame, energy in ((1, 40000), (5, 30000), (12, 16000), (20, 6000), (30, 1500), (42, 0)):
    blast.energy = energy
    blast.keyframe_insert('energy', frame=frame)
world = bpy.data.worlds.new('Dark')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.1, 0.12, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
scene.world = world

# ---- Camera: the game's view ----------------------------------------------------
bpy.ops.object.camera_add(location=TARGET + OFFSET * 30)
camera = bpy.context.active_object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = ORTHO
camera.data.clip_end = 100
camera.rotation_euler = (TARGET - camera.location).normalized().to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera

render = scene.render
render.engine = 'CYCLES'
render.resolution_x = render.resolution_y = SIZE
render.resolution_percentage = 100
render.film_transparent = True
# Linear HDR frames: the tone curve is applied when packing (see below).
render.image_settings.file_format = 'OPEN_EXR'
render.image_settings.color_mode = 'RGBA'
render.image_settings.color_depth = '16'
scene.view_settings.view_transform = 'Standard'
cycles = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(device.type == kind for device in prefs.devices):
            break
    except TypeError:
        continue
for device in prefs.devices:
    device.use = device.type in ('OPTIX', 'CUDA')
cycles.device = 'GPU'
cycles.samples = SAMPLES
cycles.use_denoising = True
cycles.volume_bounces = 12
cycles.max_bounces = 12
cycles.volume_step_rate = 0.5
cycles.use_adaptive_sampling = True

frames_dir = os.path.join(work, 'frames')
os.makedirs(frames_dir, exist_ok=True)
for index in range(FRAMES):
    scene.frame_set(index + 2)
    render.filepath = os.path.join(frames_dir, f'{index:03d}.exr')
    bpy.ops.render.render(write_still=True)
    print(f'frame {index + 1}/{FRAMES}', flush=True)

# ---- Flipbook -------------------------------------------------------------------
EXPOSURE = float(os.environ.get('EXPOSURE', 1.0))


def tone(premultiplied):
    """Compress by the brightest channel (the hue survives), whiten only the hottest core."""
    rgb, alpha = premultiplied[..., :3] * EXPOSURE, premultiplied[..., 3:4]
    peak = rgb.max(axis=-1, keepdims=True)
    knee = 0.7
    soft = np.where(peak > knee, knee + (1 - knee) * (1 - np.exp(-(peak - knee) / (1 - knee))), peak)
    rgb = rgb * (soft / np.maximum(peak, 1e-6))
    whiten = np.clip((peak - 3.0) / 9.0, 0, 1) * 0.45
    rgb = rgb * (1 - whiten) + soft * whiten
    straight = np.where(alpha > 1e-4, np.clip(rgb / np.maximum(alpha, 1e-4), 0, 1), 0)
    encoded = np.where(straight <= 0.0031308, straight * 12.92, 1.055 * np.power(straight, 1 / 2.4) - 0.055)
    return np.concatenate([encoded, np.clip(alpha, 0, 1)], axis=-1)


columns = math.ceil(math.sqrt(FRAMES))
rows = math.ceil(FRAMES / columns)
sheet = np.zeros((rows * SIZE, columns * SIZE, 4), dtype=np.float32)
for index in range(FRAMES):
    image = bpy.data.images.load(os.path.join(frames_dir, f'{index:03d}.exr'))
    pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = tone(pixels.reshape(SIZE, SIZE, 4))  # rows bottom-up, as Blender stores them
    column, row = index % columns, index // columns
    top = (rows - 1 - row) * SIZE  # frame 0 at the top-left of the sheet
    sheet[top:top + SIZE, column * SIZE:(column + 1) * SIZE] = pixels
    bpy.data.images.remove(image)
packed = bpy.data.images.new('ExplosionSheet', columns * SIZE, rows * SIZE, alpha=True)
packed.pixels.foreach_set(sheet.ravel())
packed.filepath_raw = os.path.join(OUT, 'explosion.png')
packed.file_format = 'PNG'
packed.save()
meta = {
    'image': 'explosion.png', 'frames': FRAMES, 'columns': columns, 'rows': rows, 'size': SIZE, 'fps': FPS,
    # Metres across a frame, and the frame centre's height above the blast point:
    # in the game the sprite is laid over the same iso view, pixel for pixel.
    'width': ORTHO, 'centre': round(TARGET.z, 3),
    'source': 'scripts/explosion-blender.py (Blender Mantaflow + Cycles)',
}
with open(os.path.join(OUT, 'explosion.json'), 'w') as handle:
    json.dump(meta, handle, indent=2)
if os.environ.get('KEEP_FRAMES'):
    shutil.copytree(frames_dir, os.environ['KEEP_FRAMES'], dirs_exist_ok=True)
shutil.rmtree(work, ignore_errors=True)
print('flipbook', os.path.join(OUT, 'explosion.png'), columns, 'x', rows, flush=True)
