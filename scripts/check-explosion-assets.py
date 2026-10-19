"""Read-only atlas checks (run with Blender Python); optionally export peak tile."""
import bpy,json,os,sys
import numpy as np
args=sys.argv[sys.argv.index('--')+1:]
folder=os.path.abspath(args[0])
with open(os.path.join(folder,'explosion.json')) as f:meta=json.load(f)
size=meta['size'];cols=meta['columns'];rows=meta['rows']
def read(name):
    im=bpy.data.images.load(os.path.join(folder,name),check_existing=False)
    im.colorspace_settings.name='Non-Color'
    assert tuple(im.size)==(size*cols,size*rows)
    px=np.empty(size*cols*size*rows*4,np.float32);im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(size*rows,size*cols,4)
sheet=read(meta['image']);heat=read(meta['heatImage'])
stats=[]
for i in range(meta['frames']):
    x,y=(i%cols)*size,(rows-1-i//cols)*size
    tile=sheet[y:y+size,x:x+size];a=tile[...,3]
    edge=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]])
    stats.append(dict(frame=i,edgeAlpha=float(edge.max()),alphaSum=float(a.sum()),
                      opaquePixels=int((a>.9).sum()),hotPixels=int((heat[y:y+size,x:x+size,0]>.5).sum())))
assert np.isfinite(sheet).all() and np.isfinite(heat).all()
assert max(s['alphaSum'] for s in stats)>100
assert stats[-1]['alphaSum']==0,'Last frame must be transparent.'
assert all(s['edgeAlpha']<.02 for s in stats),'A visible smoke volume touches the atlas tile border.'
assert max(s['hotPixels'] for s in stats)>50,'Missing hot core in linear heat mask.'
assert abs(meta['duration']-meta['frames']/meta['fps'])<1e-6
if 'frameTimes' in meta:
    times=meta['frameTimes']
    assert len(times)==meta['frames'] and times[0]==0
    assert all(a<b for a,b in zip(times,times[1:]))
    assert abs(times[-1]-meta['duration'])<1e-6
report=dict(passed=True,frames=meta['frames'],textureSize=list(sheet.shape[:2]),
            maxBorderAlpha=max(s['edgeAlpha'] for s in stats),lastFrameTransparent=True,
            animatedFrames=sum(s['alphaSum']>0 for s in stats),stats=stats)
with open(os.path.join(folder,'validation.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps({k:v for k,v in report.items() if k!='stats'}),flush=True)
