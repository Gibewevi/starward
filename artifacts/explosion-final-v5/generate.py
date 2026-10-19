"""Art-directed, temporally coherent Blender volume explosion for STARWARD.

This is an authored animated 3-D density field, not a fluid-solver bake. The
large rolling soot lobes and the hotter, faster lower burst have independent
lifetimes, so dark smoke already surrounds the incandescent core at impact.
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
ORTHO = 7.2
TARGET = Vector((0, 0, 1.85))
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
    scale=n.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=2
    l.new(coord.outputs['Vector'],scale.inputs[0])
    noise=n.new('ShaderNodeTexNoise');noise.noise_dimensions='4D'
    noise.inputs['Scale'].default_value=2.15 if kind=='smoke' else 3.8
    noise.inputs['Detail'].default_value=4.0;noise.inputs['Roughness'].default_value=.68
    noise.inputs['W'].default_value=seed
    l.new(scale.outputs['Vector'],noise.inputs['Vector'])
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
    mask.inputs['From Min'].default_value=1.84;mask.inputs['From Max'].default_value=1.62
    l.new(radius,mask.inputs['Value'])
    detail=mathn(n,l,'MAXIMUM',mathn(n,l,'SUBTRACT',mathn(n,l,'MULTIPLY',fine.outputs['Fac'],2.4),.75),0)
    density=n.new('ShaderNodeValue');density.name='Density';density.outputs[0].default_value=10 if kind=='smoke' else 3
    field=mathn(n,l,'MULTIPLY',mask.outputs['Result'],detail)
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
    return mat, density, heat, noise, fine

lobes=[]
def lobe(name, kind, destination, radius, stretch=(1,1,1), delay=0, life=1):
    # Cubes bound smooth irregular density fields. Their surfaces never render.
    bpy.ops.mesh.primitive_cube_add(size=2)
    ob=bpy.context.object;ob.name=name
    mat,density,heat,noise,fine=volume_material(name,kind,RNG.uniform(0,40))
    ob.data.materials.append(mat)
    lobes.append(dict(ob=ob,kind=kind,dest=Vector(destination),radius=radius,
                      stretch=Vector(stretch),delay=delay,life=life,density=density,
                      heat=heat,noise=noise,fine=fine,seed=noise.inputs['W'].default_value))

# Broad upper and side soot billows, on the far side so the low core reads.
for i,(x,y,z,r) in enumerate([
    (-.8,.45,1.9,.75),(.15,.68,2.3,.9),(.9,.35,1.8,.72),
    (-1.15,.05,1.15,.65),(.88,.6,1.12,.76),(-.45,.8,1.25,.65),
    (.2,.28,2.65,.57),(-.9,.72,2.48,.57),(.92,.75,2.5,.61),
    (-1.45,-.18,.57,.54),(1.28,-.1,.62,.51),
    (-.6,-.25,1.65,.53),(.65,-.08,1.7,.48),
]):
    lobe('Soot_%02d'%i,'smoke',(x,y,z),r,(1,1,RNG.uniform(.94,1.2)),RNG.uniform(0,.05))

# Hot, fragmented flame tongues occupy the bottom half while smoke rolls above.
for i,(x,y,z,r,s) in enumerate([
    (0,-.22,.7,.86,1.2),(-.55,-.45,.65,.6,1.35),(.6,-.2,.7,.62,1.5),
    (-.3,-.4,1.25,.5,1.35),(.4,-.17,1.4,.42,1.7),
    (-1,-.42,.38,.4,.85),(1,-.3,.45,.44,1.1),
    (-.85,.1,1.35,.36,1.5),(.94,.08,1.13,.34,1.7),
    (.05,-.55,.32,.65,.65),(-.4,.36,.6,.6,1.3),
]):
    lobe('Flame_%02d'%i,'fire',(x,y,z),r,(1,.9,s),RNG.uniform(0,.025),RNG.uniform(.85,1.15))

# Curling detached fire fingers, narrow and irregular rather than a radial halo.
for i in range(8):
    a=i*math.tau/8+.35
    r=RNG.uniform(.95,1.5)
    lobe('Tongue_%02d'%i,'fire',(math.cos(a)*r,math.sin(a)*r,RNG.uniform(.4,1.5)),
         RNG.uniform(.18,.29),(.85,.8,RNG.uniform(1.4,2)),RNG.uniform(.03,.07),.65)

# Broken soot curls cross parts of the foreground flame and reveal its depth.
for i,(x,y,z,r) in enumerate([(.72,-.85,.92,.34),(-.12,-.78,.61,.25),
                             (1.0,-.5,.35,.32),(-.68,-.55,.30,.29)]):
    lobe('Foreground_soot_%02d'%i,'smoke',(x,y,z),r,(1.15,.8,1.2),.035)

def set_time(t):
    for q in lobes:
        age=max(0,t-q['delay']); grow=1-math.exp(-age*13)
        ob=q['ob']; dest=q['dest']; smoke=q['kind']=='smoke'
        if smoke:
            drift=max(0,t-.3)
            ob.location=(dest.x*grow+.09*drift, dest.y*grow+.05*drift, .22+(dest.z-.22)*grow+.24*drift)
            r=q['radius']*1.35*(.08+.92*grow)*(1+.09*drift)
            fade=max(0,1-(max(0,t-1.45)/1.75))**1.6
            q['density'].outputs[0].default_value=11*min(1,age*15)*fade
            q['heat'].outputs[0].default_value=0
        else:
            burn=max(0,1-age/(.92*q['life']))
            late=max(0,t-.28)
            ob.location=(dest.x*1.2*grow,dest.y*1.15*grow,.18+(dest.z-.18)*grow+.28*late)
            r=q['radius']*1.4*(.08+.92*grow)*(1+.15*late)
            q['density'].outputs[0].default_value=3.8*min(1,age*25)*burn
            q['heat'].outputs[0].default_value=(1500 if ob.name=='Flame_00' else 620)*min(1,age*30)*burn**1.6
        ob.scale=tuple(q['stretch']*r)
        ob.location.x*=1.25;ob.location.y*=1.25
        ob.scale.x*=1.25;ob.scale.y*=1.25
        ob.rotation_euler=(.1*math.sin(q['seed']+t),.08*math.cos(q['seed']),.12*t)
        q['noise'].inputs['W'].default_value=q['seed']+.75*t
        q['fine'].inputs['W'].default_value=q['seed']+33+1.1*t
    blast.data.energy=1700*math.exp(-t*3.4)

bpy.ops.object.light_add(type='AREA',location=(-4,-6,8));key=bpy.context.object
key.rotation_euler=(Vector((0,0,1))-key.location).to_track_quat('-Z','Y').to_euler()
key.data.energy=2500;key.data.shape='DISK';key.data.size=2.5;key.data.color=(.9,.85,.82)
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
    whiten=np.clip((peak-7)/40,0,.9)
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
    t=float(os.getenv('TIME','.28'));set_time(t)
    scene.render.filepath=os.path.join(OUT,'preview.exr');bpy.ops.render.render(write_still=True)
    color,heat=encode(read_frame(scene.render.filepath))
    write_png(os.path.join(OUT,'preview.png'),color);write_png(os.path.join(OUT,'preview-heat.png'),heat)
    print('PREVIEW_READY',os.path.join(OUT,'preview.png'),flush=True)
else:
    frames_dir=os.path.join(OUT,'frames');os.makedirs(frames_dir,exist_ok=True)
    scene.frame_start=1;scene.frame_end=FRAMES;scene.render.fps=FPS
    # Persist the exact procedural animation, not just a still or a cache link.
    for i in range(FRAMES):
        scene.frame_set(i+1);set_time((i+.35)/FPS)
        for q in lobes:
            ob=q['ob']
            for path in ('location','scale','rotation_euler'):ob.keyframe_insert(path,frame=i+1)
            for key in ('density','heat'):q[key].outputs[0].keyframe_insert('default_value',frame=i+1)
            for key in ('noise','fine'):q[key].inputs['W'].keyframe_insert('default_value',frame=i+1)
        blast.data.keyframe_insert('energy',frame=i+1)
    scene.frame_set(7)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'explosion.blend'))
    start=int(os.getenv('START_FRAME','0'));end=int(os.getenv('END_FRAME',str(FRAMES)))
    for i in range(start,end):
        scene.frame_set(i+1)
        set_time((i+.35)/FPS)
        scene.render.filepath=os.path.join(frames_dir,'%03d.exr'%i)
        bpy.ops.render.render(write_still=True)
        print('FRAME',i+1,'/',FRAMES,flush=True)
    if all(os.path.exists(os.path.join(frames_dir,'%03d.exr'%i)) for i in range(FRAMES)):
        sheet=np.zeros((SIZE*8,SIZE*8,4),np.float32);heat_sheet=np.zeros_like(sheet)
        for i in range(FRAMES):
            color,heat=encode(read_frame(os.path.join(frames_dir,'%03d.exr'%i)))
            tail=min(1,max(0,((i+.35)/FPS-1.5)/1.7))
            fade=1-tail*tail*(3-2*tail)
            color[...,3]*=fade;heat*=fade
            if i==FRAMES-1:color[:]=0;heat[:]=0
            x,y=(i%8)*SIZE,(7-i//8)*SIZE
            sheet[y:y+SIZE,x:x+SIZE]=color;heat_sheet[y:y+SIZE,x:x+SIZE]=heat
        write_png(os.path.join(OUT,'explosion.png'),sheet)
        write_png(os.path.join(OUT,'explosion-heat.png'),heat_sheet)
        meta=dict(image='explosion.png',heatImage='explosion-heat.png',frames=FRAMES,columns=8,rows=8,
                  size=SIZE,fps=FPS,duration=DURATION,width=ORTHO,centre=round(TARGET.z,3),
                  cameraOffset=[8,8.2,10],playback='linear',peakTime=.28,
                  source='scripts/explosion-volumetric.py (authored 3D turbulent density fields, Blender '+('Eevee Next' if scene.render.engine=='BLENDER_EEVEE' else 'Cycles')+')',
                  alpha='straight',heatEncoding='linear radiance mask, no sRGB')
        with open(os.path.join(OUT,'explosion.json'),'w') as f:json.dump(meta,f,indent=2)
        print('FLIPBOOK_READY',OUT,flush=True)
