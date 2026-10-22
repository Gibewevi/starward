"""Atlas checks (Blender Python); add --continuity for smoke-decay diagnostics."""
import bpy,json,os,sys
import numpy as np
args=sys.argv[sys.argv.index('--')+1:]
folder=os.path.abspath(args[0])
analyze_continuity='--continuity' in args[1:]
with open(os.path.join(folder,'explosion.json')) as f:meta=json.load(f)
size=meta['size'];cols=meta['columns'];rows=meta['rows']

def continuity_metrics(stats, meta):
    """Describe extinction without prescribing an artistic fade curve.

    Normalize against the clip's peak alpha coverage, not each preceding
    image: the latter exaggerates imperceptible changes in the last wisps.
    Use actual timestamps because the burst has denser temporal sampling.
    """
    count=len(stats)
    times=meta.get('frameTimes', [meta['duration']*i/max(1,count-1) for i in range(count)])
    peak_frame=max(range(count),key=lambda i:stats[i]['alphaSum'])
    peak=stats[peak_frame]['alphaSum']
    opaque_peak=max(s['opaquePixels'] for s in stats)
    values=[s['alphaSum']/max(peak,1e-9) for s in stats]
    samples=[dict(frame=i,time=times[i],alphaNormalized=values[i],
                  opaqueNormalized=s['opaquePixels']/max(opaque_peak,1))
             for i,s in enumerate(stats)]
    changes=[]
    for i in range(1,count):
        if times[i-1]<.6: continue
        loss=max(0,values[i-1]-values[i])
        changes.append(dict(fromFrame=i-1,toFrame=i,fromTime=times[i-1],toTime=times[i],
                            normalizedLoss=loss,normalizedLossPerSecond=loss/(times[i]-times[i-1])))
    crossings={}
    for fraction in (.9,.75,.5,.25,.1,.01):
        crossing=None
        for i in range(peak_frame+1,count):
            if values[i-1]>=fraction>=values[i] and values[i-1]>values[i]:
                blend=(values[i-1]-fraction)/(values[i-1]-values[i])
                crossing=times[i-1]+blend*(times[i]-times[i-1])
                break
        crossings[str(fraction)]=crossing
    t90,t10=crossings['0.9'],crossings['0.1']
    visible=[i for i,v in enumerate(values) if v>1e-6]
    return dict(peakFrame=peak_frame,peakTime=times[peak_frame],peakAlphaSum=peak,
                decayCrossings=crossings,
                decay90To10Seconds=None if t90 is None or t10 is None else t10-t90,
                maxFrameLossAfter06=max(changes,key=lambda c:c['normalizedLoss'],default=None),
                maxLossRateAfter06=max(changes,key=lambda c:c['normalizedLossPerSecond'],default=None),
                lastVisibleTime=times[visible[-1]] if visible else None,
                samples=samples)
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
if analyze_continuity:
    report['continuity']=continuity_metrics(stats,meta)
    print('CONTINUITY: time_s alpha_percent_of_peak opaque_pixels_percent_of_peak',flush=True)
    for sample in report['continuity']['samples']:
        if sample['time']>=.6:
            print(f"{sample['time']:.3f} {sample['alphaNormalized']*100:.2f} {sample['opaqueNormalized']*100:.2f}",flush=True)
with open(os.path.join(folder,'validation.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps({k:({a:b for a,b in v.items() if a!='samples'} if k=='continuity' else v)
                  for k,v in report.items() if k!='stats'}),flush=True)
