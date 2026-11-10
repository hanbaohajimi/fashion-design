"""Offline shared braid-field clearance study. No Core/CMO/source edits."""
from __future__ import annotations

import importlib.util
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import label

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("arm_anchor_study", Path(__file__).with_name("study-r10-arm-elbow-anchors.py"))
A = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(A)
OUT = A.ROOT / "validation/b14-braid-clearance-study-r1"
BRAID = {"Braid_Root", "Braid_Mid", "Braid_Tip", "Hair_BraidTie"}
DYNAMIC = A.ARM | BRAID
ANCHORS = {"old-276-929": np.array([276.,929.]), "balanced-288-896": np.array([288.,896.])}
KEYS = [0,4,8,12,16]
AMPLITUDES = [35,20,50]
RAMP_END = 760.


def smoothstep(t):
    t=np.clip(t,0,1)
    return t*t*(3-2*t)


def field(xy, amplitude, time):
    result=xy.copy()
    result[:,0] += amplitude*smoothstep(time)*smoothstep((xy[:,1]-620)/(RAMP_END-620))
    return result


def area(xy, triangles):
    v=xy[triangles]
    b=v[:,1]-v[:,0];c=v[:,2]-v[:,0]
    return b[:,0]*c[:,1]-b[:,1]*c[:,0]


def audit_top_owners():
    """Explain remaining upper-arm blockers at endpoint; alpha-weighted owner diagnostic."""
    meta,native=A.read(A.META),A.read(A.GEOMETRY)
    rows={d['id']:d for d in meta['layers']};geo={d['id']:d for d in native['drawables']}
    snapshot={d['id']:d for d in A.read(A.CAPTURES/'hat-16-head0-e1.json')['drawables']}
    ids=sorted(rows);source={k:np.asarray(d['positions'],dtype=float).reshape(-1,2) for k,d in geo.items()}
    textures={}
    for key,row in rows.items():
        img=Image.open(A.META.parent/row['path']).convert('RGBA');bbox=img.getchannel('A').getbbox() or (0,0,1,1)
        x0,y0,x1,y1=bbox;bbox=(max(0,x0-2),max(0,y0-2),min(A.WIDTH,x1+2),min(A.HEIGHT,y1+2))
        rgba=np.asarray(img.crop(bbox)).astype(np.float32)/255;rgba[...,:3]*=rgba[...,3:4];textures[key]=(bbox[0],bbox[1],rgba)
    src=source['Arm_R_Lower'];fit=np.linalg.lstsq(np.c_[src,np.ones(len(src))],A.actual_positions(snapshot['Arm_R_Lower']),rcond=None)[0];target=np.r_[A.P,1]@fit
    cache={};records=[]
    for anchor,e in ANCHORS.items():
        elbow,upper,lower,_,_=A.ik(e,target)
        for amplitude in [0,50]:
            owner=np.full((A.HEIGHT,A.WIDTH),-1,np.int16);upper_mask=np.zeros((A.HEIGHT,A.WIDTH),np.float32)
            for key in sorted(rows,key=lambda k:snapshot[k]['renderOrder']):
                cache_key=(key,anchor if key in A.ARM else amplitude if key in BRAID else 0)
                if cache_key not in cache:
                    if key in A.ARM:xy=A.rotate(source[key],*((A.S,A.S,upper) if key=='Arm_R_Upper' else (e,elbow,lower)))
                    elif key in BRAID:xy=A.actual_positions(snapshot[key])+field(source[key],amplitude,1)-source[key]
                    else:xy=A.actual_positions(snapshot[key])
                    cache[cache_key]=A.raster_layer(source[key],np.asarray(snapshot[key]['vertexIndices']).reshape(-1,3),xy,textures[key],snapshot[key]['opacity'])
                (x0,y0,x1,y1),rgba=cache[cache_key]
                if key=='Arm_R_Upper':upper_mask[y0:y1,x0:x1]=rgba[...,3]
                owner[y0:y1,x0:x1][rgba[...,3]>.5]=ids.index(key)
            owners=[{'id':key,'upperSourceProjectedAlphaUnderOwnerPx':float(upper_mask[owner==i].sum())} for i,key in enumerate(ids)]
            owners=sorted([r for r in owners if r['upperSourceProjectedAlphaUnderOwnerPx']>1],key=lambda r:-r['upperSourceProjectedAlphaUnderOwnerPx'])
            records.append({'anchor':anchor,'maxShiftPx':amplitude,'hatTouch':1,'topOwners':owners})
    (OUT/'endpoint-upper-occlusion-owners.json').write_text(json.dumps({'scope':'CPU topmost alpha>0.5 ownership weighted by projected upper-arm alpha; diagnostic, not Core evidence','records':records},indent=2)+'\n',encoding='utf-8')
    return records


def main():
    assert not OUT.exists(), "Read-only study revisions are append-only"
    OUT.mkdir(parents=True)
    meta,native=A.read(A.META),A.read(A.GEOMETRY)
    rows={d['id']:d for d in meta['layers']}
    geometry={d['id']:d for d in native['drawables']}
    states={i:A.read(A.CAPTURES/f'{name}.json') for i,name in [(0,'neutral'),(8,'hat-8-head0-e1'),(16,'hat-16-head0-e1')]}
    ds={i:{d['id']:d for d in state['drawables']} for i,state in states.items()}
    inputs=[A.META,A.GEOMETRY,A.FORMULA,Path(native['source']),Path(A.__file__)]+[A.META.parent/d['path'] for d in rows.values()]
    inputs += [A.CAPTURES/f'{name}.json' for name in ['neutral','hat-8-head0-e1','hat-16-head0-e1']]
    hashes={str(p):A.sha(p) for p in inputs}
    source={key:np.asarray(d['positions'],dtype=float).reshape(-1,2) for key,d in geometry.items()}
    triangles={key:np.asarray(d['indices']).reshape(-1,3) for key,d in geometry.items()}
    textures,alphas={},{}
    for key,row in rows.items():
        img=Image.open(A.META.parent/row['path']).convert('RGBA')
        if key in BRAID: alphas[key]=np.asarray(img)[...,3].copy()
        bbox=img.getchannel('A').getbbox() or (0,0,1,1)
        x0,y0,x1,y1=bbox;bbox=(max(0,x0-2),max(0,y0-2),min(A.WIDTH,x1+2),min(A.HEIGHT,y1+2))
        rgba=np.asarray(img.crop(bbox)).astype(np.float32)/255;rgba[...,:3]*=rgba[...,3:4]
        textures[key]=(bbox[0],bbox[1],rgba)
    root_mask=alphas['Braid_Root']>250
    yy,xx=np.nonzero(root_mask)
    root_evidence={'opaqueBBox':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],
                   'stationaryOpaquePixelsYAtMost620':int(root_mask[:621].sum()),
                   'stationarySourceRegion':'All source positions y<=620 are exactly unchanged; root opaque begins y598.'}
    overlaps={}
    for left,right in [('Braid_Root','Braid_Mid'),('Braid_Mid','Hair_BraidTie'),('Hair_BraidTie','Braid_Tip')]:
        y,x=np.nonzero((alphas[left]>250)&(alphas[right]>250))
        overlaps[f'{left}+{right}']={'opaqueOverlapPixels':len(x),'bbox':[int(x.min()),int(y.min()),int(x.max()),int(y.max())]}
    targets={}
    for step,snapshot in ds.items():
        src=source['Arm_R_Lower'];fit=np.linalg.lstsq(np.c_[src,np.ones(len(src))],A.actual_positions(snapshot['Arm_R_Lower']),rcond=None)[0]
        targets[step]=np.r_[A.P,1]@fit
    static_cache={};layer_cache={};baseline={};metrics=[];ids=sorted(rows);braid_ids=[ids.index(k) for k in BRAID]
    protection={
        'face':{'Face_Base','Blush_R','Blush_L','Brow_R','Brow_L','Nose','Mouth','Eye_R_Open','Eye_L_Open','Eye_R_Closed','Eye_L_Closed','Eye_R_Cross','Eye_L_Cross'},
        'hat':{k for k in rows if k.startswith('Hat_')},
        'scarf':{k for k in rows if k.startswith('Scarf_')},
    }
    def layer(key, snapshot, xy):
        return A.raster_layer(source[key],triangles[key],xy,textures[key],snapshot[key]['opacity'])

    def snapshot_for(step):
        return 0 if step<8 else 8 if step==8 else 16

    def static(step):
        at=snapshot_for(step)
        if at not in static_cache:
            snapshot=ds[at];pieces=[];block=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32);owner=np.full((A.HEIGHT,A.WIDTH),-1,np.int16);count=0
            for key in sorted(rows,key=lambda k:snapshot[k]['renderOrder']):
                if key in DYNAMIC:
                    if count: pieces.append((block,owner))
                    pieces.append(key);block=np.zeros_like(block);owner=np.full_like(owner,-1);count=0
                else:
                    rendered=layer(key,snapshot,A.actual_positions(snapshot[key]));(x0,y0,x1,y1),rgba=rendered
                    A.paste(block,rendered);owner[y0:y1,x0:x1][rgba[...,3]>.5]=ids.index(key);count+=1
            if count:pieces.append((block,owner))
            static_cache[at]=(snapshot,pieces)
        return static_cache[at]

    def pose(anchor,step,amplitude):
        target=targets.get(step,A.bezier(step/16));e=ANCHORS[anchor]
        elbow,upper,lower,a,b=A.ik(e,target,neutral=step==0)
        posed={key:A.rotate(source[key],*( (A.S,A.S,upper) if key=='Arm_R_Upper' else (e,elbow,lower))) for key in A.ARM}
        snapshot=ds[snapshot_for(step)]
        for key in BRAID:
            # Shared source-coordinate field adds to each exact actual neutral/head0 world placement.
            posed[key]=A.actual_positions(snapshot[key])+(field(source[key],amplitude,step/16)-source[key])
        return posed,elbow,A.rotate(A.P,e,elbow,lower)

    def render(anchor,step,amplitude):
        snapshot,pieces=static(step);posed,elbow,palm=pose(anchor,step,amplitude)
        canvas=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32);owner=np.full((A.HEIGHT,A.WIDTH),-1,np.int16)
        visible=np.zeros((A.HEIGHT,A.WIDTH),np.float32);upper_area=0.;braid_union=np.zeros((A.HEIGHT,A.WIDTH),bool)
        for piece in pieces:
            if isinstance(piece,str):
                cache_key=(piece,anchor if piece in A.ARM else amplitude,step)
                if cache_key not in layer_cache:layer_cache[cache_key]=layer(piece,snapshot,posed[piece])
                rendered=layer_cache[cache_key];(x0,y0,x1,y1),rgba=rendered
                if piece=='Arm_R_Upper':visible[y0:y1,x0:x1]=rgba[...,3];upper_area=float(rgba[...,3].sum())
                else:visible[y0:y1,x0:x1]*=1-rgba[...,3]
                if piece in BRAID:braid_union[y0:y1,x0:x1]|=rgba[...,3]>.5
                owner[y0:y1,x0:x1][rgba[...,3]>.5]=ids.index(piece)
                A.paste(canvas,rendered)
            else:
                block,blockowner=piece;visible*=1-block[...,3];A.over(canvas,block);m=blockowner>=0;owner[m]=blockowner[m]
        components,n=label(braid_union);sizes=np.bincount(components.ravel())[1:]
        return A.to_image(canvas),owner,{'upperProjectedAlphaAreaPx':upper_area,'upperVisibleAlphaAreaPx':float(visible.sum()),'upperVisibleFraction':float(visible.sum()/upper_area),
                    'braidComponentsLargerThan100Px':int((sizes>100).sum()),'braidLargestComponentPixels':int(sizes.max()),'elbow':elbow.tolist(),'palm':palm.tolist()}

    # Prioritize root-reviewable 35 px endpoint and .75 examples before the complete matrix.
    work=[('balanced-288-896',35,16),('balanced-288-896',35,12),('old-276-929',35,16),('old-276-929',35,12)]
    work=[w for w in work if w[0] in ANCHORS and w[1] in AMPLITUDES and w[2] in KEYS]
    work += [(anchor,amp,step) for anchor in ANCHORS for amp in AMPLITUDES for step in KEYS if (anchor,amp,step) not in work]
    for anchor,amp,step in work:
        out=OUT/f'{anchor}-shift-{amp:02d}';out.mkdir(exist_ok=True)
        img,owner,row=render(anchor,step,amp)
        if (anchor,step) not in baseline:
            base_img,base_owner,base_row=render(anchor,step,0)
            baseline[(anchor,step)]=(base_owner,base_row)
            base_folder=OUT/f'{anchor}-shift-00';base_folder.mkdir(exist_ok=True)
            base_img.save(base_folder/f'hat-{step:02d}-CPU-only.png')
        base_owner,base_row=baseline[(anchor,step)]
        is_braid=np.isin(owner,braid_ids)
        row.update({'anchor':anchor,'maxSourceShiftPx':amp,'step':step,'hatTouch':step/16,
                    'timeWeight':float(smoothstep(step/16)),'baselineUpperVisibleFraction':base_row['upperVisibleFraction'],
                    'baselineUpperVisibleAlphaAreaPx':base_row['upperVisibleAlphaAreaPx'],
                    'newBraidOverpaintReferenceProtectedPixels':{name:int((is_braid & np.isin(base_owner,[ids.index(k) for k in keys])).sum()) for name,keys in protection.items()}})
        img.save(out/f'hat-{step:02d}-CPU-only.png')
        diagnostic=A.with_background(img);dr=ImageDraw.Draw(diagnostic)
        dr.rectangle((0,0,A.WIDTH,40),fill='white');dr.text((10,10),f'CPU ONLY / NOT CORE | {anchor} | shift {amp}px | Hat {step/16:.2f}',fill='black')
        dr.line([tuple(A.S),tuple(row['elbow']),tuple(row['palm'])],fill='#1467dd',width=3)
        for p in [A.S,row['elbow'],row['palm']]:x,y=p;dr.ellipse((x-5,y-5,x+5,y+5),fill='#1467dd')
        diagnostic.save(out/f'hat-{step:02d}-diagnostic-CPU-only.png')
        metrics.append(row)
        print(json.dumps({'ready':str(out/f'hat-{step:02d}-CPU-only.png'),'upperVisible':row['upperVisibleFraction'],'protectedOverpaint':row['newBraidOverpaintReferenceProtectedPixels']}),flush=True)

    sweep=[]
    for anchor in ANCHORS:
        for amp in AMPLITUDES:
            previous=None
            for step in range(17):
                posed,elbow,palm=pose(anchor,step,amp)
                ratios=[];flips=0;root_drift=0.;max_delta=0.
                for key in BRAID:
                    original=A.actual_positions(ds[snapshot_for(step)][key]);original_area=area(original,triangles[key]);current_area=area(posed[key],triangles[key]);good=np.abs(original_area)>1e-7
                    ratio=current_area[good]/original_area[good];ratios.extend(ratio.tolist());flips+=int((ratio<=0).sum())
                    stationary=source[key][:,1]<=620
                    if stationary.any():root_drift=max(root_drift,float(np.abs(posed[key][stationary]-original[stationary]).max()))
                    if previous is not None:max_delta=max(max_delta,float(np.linalg.norm(posed[key]-previous[key],axis=1).max()))
                target=targets.get(step,A.bezier(step/16));e=ANCHORS[anchor]
                sweep.append({'anchor':anchor,'maxSourceShiftPx':amp,'step':step,'hatTouch':step/16,
                    'palmTargetErrorPx':float(np.linalg.norm(palm-target)),'upperLengthErrorPx':float(abs(np.linalg.norm(elbow-A.S)-np.linalg.norm(e-A.S))),
                    'lowerLengthErrorPx':float(abs(np.linalg.norm(palm-elbow)-np.linalg.norm(A.P-e))),
                    'braidFlippedTriangles':flips,'braidTriangleAreaRatioMin':min(ratios),'braidTriangleAreaRatioMax':max(ratios),
                    'stationaryRootVertexMaximumDifferencePx':root_drift,'maximumAdjacentBraidVertexStepPx':max_delta})
                previous={k:posed[k] for k in BRAID}
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
    for anchor in ANCHORS:
        for step in KEYS:
            sheet=Image.new('RGB',(A.WIDTH//2*(len(AMPLITUDES)+1),A.HEIGHT//2+65),'white');dr=ImageDraw.Draw(sheet)
            for i,amp in enumerate([0]+sorted(AMPLITUDES)):
                img=A.with_background(Image.open(OUT/f'{anchor}-shift-{amp:02d}'/f'hat-{step:02d}-CPU-only.png'))
                sheet.paste(img.resize((A.WIDTH//2,A.HEIGHT//2),Image.Resampling.LANCZOS),(i*(A.WIDTH//2),65))
                dr.text((i*(A.WIDTH//2)+10,8),f'{anchor} | shift {amp}px',font=font,fill='black');dr.text((i*(A.WIDTH//2)+10,32),f'CPU ONLY / HatTouch {step/16:.2f}',font=font,fill='black')
            sheet.save(OUT/f'{anchor}-hat-{step:02d}-contact-sheet-CPU-only.png')
    neutral_paths=list(OUT.glob('*/hat-00-CPU-only.png'));neutral_hashes={str(p.relative_to(OUT)):A.sha(p) for p in neutral_paths}
    assert len(set(neutral_hashes.values()))==1
    assert all(s['braidFlippedTriangles']==0 and s['stationaryRootVertexMaximumDifferencePx']==0 for s in sweep)
    after={str(p):A.sha(p) for p in inputs};assert hashes==after
    report={'scope':'CPU-only shared braid clearance test; no native Core or physics acceptance','canvas':[A.WIDTH,A.HEIGHT],
            'field':f'x += maxShift * smoothstep(HatTouch) * smoothstep(clamp((sourceY-620)/{RAMP_END-620})); y unchanged. Same source-world field for Root/Mid/Tip/Tie; no independent pivots.',
            'rootEvidence':root_evidence,'sourceConnectionOverlaps':overlaps,
            'drawOrder':'Every layer retains actual snapshot renderOrder; .25 uses neutral outer range; .75 uses final outer range.',
            'unchangedLayers':65,'inputHashesUnchanged':hashes==after,'frozenInputSha256':hashes,'neutralHashes':neutral_hashes,
            'parameterChannelsChanged':0,'sourcePngsChanged':0,'meshSweep':sweep,'renderMetrics':metrics,
            'limitations':'Captured actual targets used only 0/.5/1; other targets from original Kotlin formula. CPU source PNG sampling differs from native atlas. Shared vertex field may require actual native lattice/physics validation. Protected-overpaint metrics count newly visible braid over baseline face/hat/scarf ownership, not raw source overlap.'}
    (OUT/'study-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    audit_top_owners()
    print(str(OUT),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--ramp-end',type=float,default=760.)
    parser.add_argument('--out',type=Path)
    parser.add_argument('--quick-balanced',action='store_true')
    args=parser.parse_args()
    assert args.ramp_end>620
    RAMP_END=args.ramp_end
    if args.out is not None:
        OUT=args.out.resolve()
        assert OUT.is_relative_to(A.ROOT/'validation')
    if args.quick_balanced:
        ANCHORS={'balanced-288-896':ANCHORS['balanced-288-896']}
        AMPLITUDES=[35,50]
        KEYS=[0,12,16]
    main()
