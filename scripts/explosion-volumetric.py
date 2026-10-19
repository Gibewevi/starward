"""Art-directed, temporally coherent Blender volume explosion for STARWARD.

This is an authored animated 3-D density field, not a fluid-solver bake. The
eight rolling fire pockets share their trajectories and turbulence with the
soot born inside them. The initial pressure impulse expands along the floor;
the pockets cool into dense smoke before they slowly lift and erode.
All density and emissive detail is evaluated in 3-D; no photographed
or generated image is used. The matching game camera renders transparent RGBA
and an independent linear HDR-heat mask. Original Mantaflow source is retained
as explosion-blender.py.

blender -b --factory-startup --python scripts/explosion-volumetric.py -- OUT
Environment: PREVIEW=1, SIZE=256, SAMPLES=64, ENGINE=BLENDER_EEVEE,
             START_FRAME=0, END_FRAME=64. ENGINE=CYCLES is also supported.
"""
import bpy, os, math, json, random, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0] if args else 'artifacts/explosion-volumetric')
os.makedirs(OUT, exist_ok=True)
SIZE = int(os.getenv('SIZE', '256'))
SAMPLES = int(os.getenv('SAMPLES', '64'))
FRAMES, FPS, DURATION = 64, 20, 3.2
FRAME_TIMES = [round(float(t),6) for t in np.concatenate((np.linspace(0,.24,13),np.linspace(.24,DURATION,52)[1:]))]
ORTHO = 7.8
TARGET = Vector((0, 0, .85))
OFFSET = Vector((8, -10, 8.2)).normalized()
RNG = random.Random(319)
scene = bpy.context.scene
for ob in list(bpy.data.objects): bpy.data.objects.remove(ob, do_unlink=True)

def mathn(nodes, links, op, a, b=None):
    n = nodes.new('ShaderNodeMath'); n.operation = op
    for i, v in enumerate((a,b)):
        if v is None: continue
        if isinstance(v, (float,int)): n.inputs[i].default_value = v
        else: links.new(v, n.inputs[i])
    return n.outputs[0]

def ramp(nodes, links, value, stops):
    n=nodes.new('ShaderNodeValToRGB'); n.color_ramp.interpolation='EASE'
    for e in list(n.color_ramp.elements)[2:]: n.color_ramp.elements.remove(e)
    n.color_ramp.elements[0].position, n.color_ramp.elements[0].color = stops[0]
    n.color_ramp.elements[1].position, n.color_ramp.elements[1].color = stops[-1]
    for pos,col in stops[1:-1]: n.color_ramp.elements.new(pos).color=col
    links.new(value,n.inputs['Fac']); return n.outputs['Color']

def volume_material(name, kind, seed):
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    n,l=mat.node_tree.nodes,mat.node_tree.links; n.clear()
    out=n.new('ShaderNodeOutputMaterial'); v=n.new('ShaderNodeVolumePrincipled')
    v.inputs['Color'].default_value=(.19,.17,.17,1) if kind=='smoke' else (.17,.09,.045,1)
    v.inputs['Density Attribute'].default_value=''
    v.inputs['Color Attribute'].default_value=''
    v.inputs['Anisotropy'].default_value=.05
    tex=n.new('ShaderNodeTexCoord')
    coord=n.new('ShaderNodeVectorMath');coord.operation='SUBTRACT';coord.inputs[1].default_value=(.5,.5,.5)
    l.new(tex.outputs['Generated'],coord.inputs[0])
    scale=n.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=2.8
    l.new(coord.outputs['Vector'],scale.inputs[0])
    noise=n.new('ShaderNodeTexNoise');noise.noise_dimensions='4D'
    noise.inputs['Scale'].default_value=1.8 if kind=='smoke' else 2.7
    noise.inputs['Detail'].default_value=4.0;noise.inputs['Roughness'].default_value=.68
    noise.inputs['W'].default_value=seed
    l.new(scale.outputs['Vector'],noise.inputs['Vector'])
    if kind=='smoke':
        soot_color=ramp(n,l,noise.outputs['Fac'],[
            (.2,(.035,.03,.03,1)),(.4,(.09,.075,.07,1)),
            (.6,(.2,.17,.14,1)),(.8,(.26,.23,.22,1))])
        l.new(soot_color,v.inputs['Color'])
    fine=n.new('ShaderNodeTexNoise');fine.noise_dimensions='4D'
    fine.inputs['Scale'].default_value=14 if kind=='smoke' else 18
    fine.inputs['Detail'].default_value=3;fine.inputs['Roughness'].default_value=.72
    fine.inputs['W'].default_value=seed+33
    l.new(scale.outputs['Vector'],fine.inputs['Vector'])
    length=n.new('ShaderNodeVectorMath');length.operation='LENGTH';l.new(scale.outputs['Vector'],length.inputs[0])
    # Broad cloud boundary is broken by correlated, advecting turbulence.
    radius=mathn(n,l,'ADD',length.outputs['Value'],mathn(n,l,'MULTIPLY',noise.outputs['Fac'],1.8))
    # Strong low-frequency turbulence breaks the complete spherical contours.
    mask=n.new('ShaderNodeMapRange');mask.clamp=True;mask.interpolation_type='SMOOTHERSTEP'
    mask.inputs['From Min'].default_value=1.88;mask.inputs['From Max'].default_value=1.73
    erosion=n.new('ShaderNodeValue');erosion.name='Erosion';erosion.outputs[0].default_value=0
    l.new(mathn(n,l,'ADD',radius,mathn(n,l,'MULTIPLY',erosion.outputs[0],.5)),mask.inputs['Value'])
    threshold=mathn(n,l,'ADD',.65,mathn(n,l,'MULTIPLY',erosion.outputs[0],2.7))
    detail=mathn(n,l,'MAXIMUM',mathn(n,l,'SUBTRACT',mathn(n,l,'MULTIPLY',fine.outputs['Fac'],2.4),threshold),0)
    density=n.new('ShaderNodeValue');density.name='Density';density.outputs[0].default_value=10 if kind=='smoke' else 3
    field=mathn(n,l,'MULTIPLY',mask.outputs['Result'],detail)
    # A hemispherical pressure burst has a physical floor, not a floating ball.
    geo=n.new('ShaderNodeNewGeometry');xyz=n.new('ShaderNodeSeparateXYZ')
    l.new(geo.outputs['Position'],xyz.inputs[0])
    floor=n.new('ShaderNodeMapRange');floor.interpolation_type='SMOOTHERSTEP';floor.clamp=True
    floor.inputs['From Min'].default_value=.005;floor.inputs['From Max'].default_value=.06
    l.new(xyz.outputs['Z'],floor.inputs['Value'])
    field=mathn(n,l,'MULTIPLY',field,floor.outputs['Result'])
    l.new(mathn(n,l,'MULTIPLY',field,density.outputs[0]),v.inputs['Density'])
    heat=n.new('ShaderNodeValue');heat.name='Heat';heat.outputs[0].default_value=0
    hot=mathn(n,l,'POWER',noise.outputs['Fac'],2.7)
    heatfield=mathn(n,l,'MULTIPLY',mathn(n,l,'MULTIPLY',field,hot),heat.outputs[0])
    if kind=='fire':
        color=ramp(n,l,noise.outputs['Fac'],[
            (.05,(.28,.004,.0001,1)),(.30,(1,.026,.0002,1)),
            (.50,(1,.25,.001,1)),(.67,(1,.62,.025,1)),(.85,(1,.88,.32,1)),
            (1,(1,.95,.75,1))])
        l.new(color,v.inputs['Emission Color'])
        l.new(heatfield,v.inputs['Emission Strength'])
    l.new(v.outputs['Volume'],out.inputs['Volume'])
    return mat, density, heat, noise, fine, erosion

lobes=[]
def lobe(name, kind, destination, radius, stretch=(1,1,1), delay=0, life=1, packet=None, seed=None):
    # Cubes bound smooth irregular density fields. Their surfaces never render.
    bpy.ops.mesh.primitive_cube_add(size=2.8)
    ob=bpy.context.object;ob.name=name
    mat,density,heat,noise,fine,erosion=volume_material(name,kind,RNG.uniform(0,40) if seed is None else seed)
    ob.data.materials.append(mat)
    lobes.append(dict(ob=ob,kind=kind,dest=Vector(destination),radius=radius,
                      stretch=Vector(stretch),delay=delay,life=life,density=density,
                      heat=heat,noise=noise,fine=fine,erosion=erosion,packet=packet,
                      seed=noise.inputs['W'].default_value))

# Seven radial pressure channels plus one central roll. Soot is the same parcel after a short
# cooling delay, not a separate canopy translated above the fire.
packets=[]
for i,(angle,distance,radius,delay,lift) in enumerate([
    (.12,1.45,.68,.075,.48),(.98,.95,1.0,.055,.80),
    (1.87,1.35,.78,.045,.69),(2.84,1.48,.92,.065,.52),
    (3.64,1.10,.56,.095,.38),(4.55,1.65,.72,.14,.33),
    (5.48,1.22,.83,.12,.50),(2.2,.24,.64,.22,.68),
]):
    p=dict(angle=angle,distance=distance,radius=radius,delay=delay,lift=lift,seed=RNG.uniform(0,40))
    packets.append(p)
    lobe('Flame_%02d'%i,'fire',(0,0,0),radius,(1.12,1,.82),life=RNG.uniform(.58,.8),packet=p,seed=p['seed'])
    lobe('Soot_%02d'%i,'smoke',(0,0,0),radius,(1.03,.97,1.0),delay=delay,packet=p,seed=p['seed'])

# Fragmented incandescent heart connects the spreading lobes across the floor.
for i,(x,y,z,r) in enumerate([(0,0,.50,1.0),(-.42,.18,.36,.72),(.25,-.4,.28,.77),(.28,.42,.42,.65)]):
    lobe('Core_%02d'%i,'fire',(x,y,z),r,(1.15,1.1,.73),life=.70)

# Narrow jets follow selected channels and break the outside flame outline.
for i in (0,2,3,5,6):
    p=packets[i]
    lobe('Tongue_%02d'%i,'fire',(0,0,0),.25,(1.6,.7,.8),life=.42,packet=p,seed=p['seed']+8)

def set_time(t):
    for q in lobes:
        age=max(0,t-q['delay']); grow=1-math.exp(-t*32)
        ob=q['ob']; dest=q['dest']; smoke=q['kind']=='smoke';p=q['packet']
        if p:
            a=p['angle'];distance=p['distance']*grow
            # Outward roll slows rapidly; buoyancy only acts after the impulse.
            roll=(1-math.exp(-age*3))* (.43 if smoke else .15)
            rise=max(0,age-.18)*(.22 if smoke else .04)
            ob.location=(math.cos(a)*(distance+roll),math.sin(a)*(distance+roll),.10+p['lift']*grow+rise)
            if ob.name.startswith('Tongue_'):
                extension=1.48 if ob.name in ('Tongue_00','Tongue_03') else 1.22
                ob.location.x*=extension;ob.location.y*=extension;ob.location.z*=.68
        else:
            ob.location=dest*grow
        if smoke:
            birth=1-math.exp(-age*20)
            r=q['radius']*(.08+.92*birth)*(1+.10*(1-math.exp(-age*2)))
            # Erode individual cavities late; keep surviving curls opaque.
            erosion=max(0,min(1,(age-1.1)/1.65))**1.35
            q['density'].outputs[0].default_value=24*birth
            q['erosion'].outputs[0].default_value=erosion
            q['heat'].outputs[0].default_value=0
        else:
            burn=max(0,1-t/q['life'])
            r=q['radius']*(.015+.985*grow)
            q['density'].outputs[0].default_value=4.5*min(1,t*70)*burn
            strength=2400 if ob.name=='Core_00' else (550 if ob.name.startswith('Core_') else 240)
            q['heat'].outputs[0].default_value=strength*min(1,t*90)*burn**1.25
            q['erosion'].outputs[0].default_value=max(0,1-burn)*.28
        ob.scale=tuple(q['stretch']*r)
        # Only the hot pressure impulse rolls whole parcels. Let that angular
        # velocity die away smoothly, otherwise the cold soot looks like solid
        # balls spinning on the spot. Translation and cavity erosion continue.
        turn_time=t if not smoke or t<=.30 else .30+.12*(1-math.exp(-(t-.30)/.12))
        turn_age=max(0,turn_time-q['delay'])
        ob.rotation_euler=(.18*math.sin(q['seed']+turn_age*2),.16*math.cos(q['seed']+turn_age*2),p['angle']+.35*turn_age if p else .12*t)
        # Cool the texture turbulence as well as the parcel rotation. Running
        # 4D noise at full speed makes detached dark puffs appear to churn even
        # with a fixed object transform. The explosion's first .45 s is intact.
        noise_time=t if not smoke or t<=.45 else .45+.20*(1-math.exp(-(t-.45)/.20))
        q['noise'].inputs['W'].default_value=q['seed']+.3*noise_time+.35*(1-math.exp(-noise_time*9))
        q['fine'].inputs['W'].default_value=q['seed']+33+.6*noise_time
    blast.data.energy=2600*math.exp(-t*4.8)

bpy.ops.object.light_add(type='AREA',location=(-4,-6,8));key=bpy.context.object
key.rotation_euler=(Vector((0,0,1))-key.location).to_track_quat('-Z','Y').to_euler()
key.data.energy=1700;key.data.shape='DISK';key.data.size=1.7;key.data.color=(.9,.85,.82)
bpy.ops.object.light_add(type='POINT',location=(0,-.35,.45));blast=bpy.context.object
blast.data.color=(1,.21,.015);blast.data.shadow_soft_size=.4
world=bpy.data.worlds.new('Charcoal stage');world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.22,.30,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35;scene.world=world
bpy.ops.object.camera_add(location=TARGET+OFFSET*30);camera=bpy.context.object
camera.data.type='ORTHO';camera.data.ortho_scale=ORTHO
camera.rotation_euler=(TARGET-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
scene.render.engine=os.getenv('ENGINE','BLENDER_EEVEE');scene.render.resolution_x=scene.render.resolution_y=SIZE
scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='16';scene.view_settings.view_transform='Standard'
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU';scene.cycles.samples=SAMPLES;scene.cycles.use_denoising=True
scene.cycles.volume_bounces=2;scene.cycles.max_bounces=6;scene.cycles.volume_step_rate=.5
scene.cycles.use_adaptive_sampling=True
if scene.render.engine=='BLENDER_EEVEE':
    scene.eevee.taa_render_samples=SAMPLES
    scene.eevee.volumetric_tile_size='1'
    scene.eevee.volumetric_samples=192
    scene.eevee.use_volume_custom_range=True
    scene.eevee.volumetric_start=25
    scene.eevee.volumetric_end=36
    scene.eevee.use_volumetric_shadows=True
    scene.eevee.volumetric_shadow_samples=32

def read_frame(path):
    im=bpy.data.images.load(path,check_existing=False)
    px=np.empty(SIZE*SIZE*4,dtype=np.float32);im.pixels.foreach_get(px)
    bpy.data.images.remove(im);return px.reshape(SIZE,SIZE,4)

def encode(px):
    a=np.clip(px[...,3:4],0,1)
    rgb=np.where(a>1e-5,np.maximum(px[...,:3],0)/np.maximum(a,1e-5),0)
    peak=rgb.max(-1,keepdims=True)
    # Preserve saturated fire until the very hot core; retain opaque charcoal.
    soft=1-np.exp(-peak*.8)
    col=rgb/np.maximum(peak,1e-7)*soft
    whiten=np.clip((peak-12)/60,0,.75)
    col=col*(1-whiten)+soft*whiten*np.array([1,1,.8],dtype=np.float32)
    straight=np.clip(col,0,1)
    srgb=np.where(straight<=.0031308,straight*12.92,1.055*np.power(straight,1/2.4)-.055)
    color=np.concatenate([srgb,a],-1)
    heat=np.clip((peak-.8)/25,0,1)*a
    return color,np.concatenate([heat,heat,heat,a],-1)

def write_png(path,px):
    h,w=px.shape[:2];im=bpy.data.images.new(os.path.basename(path),w,h,alpha=True)
    im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(px.astype(np.float32).ravel());im.filepath_raw=path;im.file_format='PNG';im.save()
    bpy.data.images.remove(im)

preview=os.getenv('PREVIEW')=='1'
if preview:
    times=[float(v) for v in os.getenv('PREVIEW_TIMES',os.getenv('TIME','.24')).split(',')]
    contact=np.zeros((SIZE,SIZE*len(times),4),np.float32)
    for j,t in enumerate(times):
        set_time(t)
        stem='preview' if len(times)==1 else 'preview-%03d'%round(t*1000)
        scene.render.filepath=os.path.join(OUT,stem+'.exr');bpy.ops.render.render(write_still=True)
        color,heat=encode(read_frame(scene.render.filepath))
        write_png(os.path.join(OUT,stem+'.png'),color);write_png(os.path.join(OUT,stem+'-heat.png'),heat)
        contact[:,j*SIZE:(j+1)*SIZE]=color
    write_png(os.path.join(OUT,'contact.png'),contact)
    print('PREVIEW_READY',os.path.join(OUT,'contact.png'),times,flush=True)
else:
    frames_dir=os.path.join(OUT,'frames');os.makedirs(frames_dir,exist_ok=True)
    scene.frame_start=1;scene.frame_end=round(DURATION*60)+1;scene.render.fps=60
    # Persist the exact procedural animation, not just a still or a cache link.
    for i in range(FRAMES):
        keyframe=1+FRAME_TIMES[i]*60
        scene.frame_set(math.floor(keyframe),subframe=keyframe%1);set_time(FRAME_TIMES[i])
        for q in lobes:
            ob=q['ob']
            for path in ('location','scale','rotation_euler'):ob.keyframe_insert(path,frame=keyframe)
            for key in ('density','heat','erosion'):q[key].outputs[0].keyframe_insert('default_value',frame=keyframe)
            for key in ('noise','fine'):q[key].inputs['W'].keyframe_insert('default_value',frame=keyframe)
        blast.data.keyframe_insert('energy',frame=keyframe)
    scene.frame_set(15)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'explosion.blend'))
    start=int(os.getenv('START_FRAME','0'));end=int(os.getenv('END_FRAME',str(FRAMES)))
    for i in range(start,end):
        keyframe=1+FRAME_TIMES[i]*60
        scene.frame_set(math.floor(keyframe),subframe=keyframe%1)
        set_time(FRAME_TIMES[i])
        scene.render.filepath=os.path.join(frames_dir,'%03d.exr'%i)
        bpy.ops.render.render(write_still=True)
        print('FRAME',i+1,'/',FRAMES,flush=True)
    if all(os.path.exists(os.path.join(frames_dir,'%03d.exr'%i)) for i in range(FRAMES)):
        sheet=np.zeros((SIZE*8,SIZE*8,4),np.float32);heat_sheet=np.zeros_like(sheet)
        for i in range(FRAMES):
            color,heat=encode(read_frame(os.path.join(frames_dir,'%03d.exr'%i)))
            if i==FRAMES-1:color[:]=0;heat[:]=0
            x,y=(i%8)*SIZE,(7-i//8)*SIZE
            sheet[y:y+SIZE,x:x+SIZE]=color;heat_sheet[y:y+SIZE,x:x+SIZE]=heat
        write_png(os.path.join(OUT,'explosion.png'),sheet)
        write_png(os.path.join(OUT,'explosion-heat.png'),heat_sheet)
        meta=dict(image='explosion.png',heatImage='explosion-heat.png',frames=FRAMES,columns=8,rows=8,
                  size=SIZE,fps=FPS,duration=DURATION,width=ORTHO,centre=round(TARGET.z,3),
                  cameraOffset=[8,8.2,10],playback='linear',peakTime=.20,frameTimes=FRAME_TIMES,
                  glow=1.1,dissipation='erosion',
                  source='scripts/explosion-volumetric.py (authored 3D turbulent density fields, Blender '+('Eevee Next' if scene.render.engine=='BLENDER_EEVEE' else 'Cycles')+')',
                  alpha='straight',heatEncoding='linear radiance mask, no sRGB')
        with open(os.path.join(OUT,'explosion.json'),'w') as f:json.dump(meta,f,indent=2)
        print('FLIPBOOK_READY',OUT,flush=True)
