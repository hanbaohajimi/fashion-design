"""Offline 73-mesh same-source upper-arm partition study; never native/Core evidence."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_erosion, distance_transform_edt, label, map_coordinates

sys.dont_write_bytecode=True
SPEC=importlib.util.spec_from_file_location('arm_anchor_study',Path(__file__).with_name('study-r10-arm-elbow-anchors.py'))
A=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(A)
OUT=A.ROOT/'validation/b14-upper-depth-partition-r1'
UPPER='Arm_R_Upper';FRONT='Arm_R_Upper_Front'
BRAID={'Braid_Root','Braid_Mid','Braid_Tip','Hair_BraidTie'}
ANCHORS={'old-276-929':np.array([276.,929.]),'balanced-288-896':np.array([288.,896.])}
KEYS=[0,4,8,12,16]


def triangle_raster(xy):
    a,b,c=xy;x0,y0=np.floor(xy.min(0)).astype(int);x1,y1=np.ceil(xy.max(0)).astype(int)
    yy,xx=np.mgrid[y0:y1,x0:x1];eb,ec=b-a,c-a;det=A.cross(eb,ec)
    if abs(det)<1e-8:return (x0,y0,x1,y1),np.zeros((y1-y0,x1-x0),bool)
    v=((xx+.5-a[0])*ec[1]-(yy+.5-a[1])*ec[0])/det
    w=((yy+.5-a[1])*eb[0]-(xx+.5-a[0])*eb[1])/det
    return (x0,y0,x1,y1),(v>=-1e-7)&(w>=-1e-7)&(v+w<=1+1e-7)


def pixel_diff(left,right):
    a=np.asarray(left,dtype=np.int16);b=np.asarray(right,dtype=np.int16);diff=np.abs(a-b)
    active=(a[...,3]>0)|(b[...,3]>0);rgb=np.max(diff[...,:3],axis=2)
    return {'changedRgbaPixels':int((diff.max(axis=2)>0).sum()),'changedVisibleRgbPixels':int(((rgb>0)&active).sum()),
            'changedAlphaPixels':int((diff[...,3]>0).sum()),'maximumVisibleRgbByteDifference':int(rgb[active].max()) if active.any() else 0,
            'maximumAlphaByteDifference':int(diff[...,3].max()),'meanAbsoluteRgbaByteDifference':float(diff.mean())}


def shared_upper_shape(xy,time):
    """Bounded transverse garment shaping, same function for both mesh pieces."""
    if time==0:return xy.copy()
    shoulder=A.S;elbow=np.array([276.,929.]);length=np.linalg.norm(elbow-shoulder);axis=(elbow-shoulder)/length;normal=np.array([-axis[1],axis[0]])
    delta=xy-shoulder;t=delta@axis;n=delta@normal
    def smooth(v):v=np.clip(v,0,1);return v*v*(3-2*v)
    envelope=12*smooth(t/25)*smooth((length-t)/35)*np.exp(-.5*((t-65)/65)**2)
    transverse=np.sin(np.clip(n/50,-1,1)*np.pi/2)
    displacement=-smooth(time)*envelope*transverse
    displacement[(t<=0)|(t>=length)|(np.abs(n)<1e-9)]=0
    return xy+displacement[:,None]*normal


def conform_float32_partition(pieces):
    """One float32 vertex/UV pool, with all incident triangles split at T nodes."""
    positions=[];uvs=[];lookup={};maximum_uv_disagreement=0.;indices={}
    for name,piece in pieces.items():
        remap=[]
        for point,uv in zip(piece['positions'],piece['uv']):
            point=np.asarray(point,np.float32);uv=np.asarray(uv,np.float32);key=tuple(float(v) for v in point)
            if key not in lookup:lookup[key]=len(positions);positions.append(point);uvs.append(uv)
            else:maximum_uv_disagreement=max(maximum_uv_disagreement,float(np.abs(uv-uvs[lookup[key]]).max()))
            remap.append(lookup[key])
        indices[name]=np.asarray(remap)[piece['triangles']].tolist()
    xy=np.asarray(positions,np.float32).astype(float);uv=np.asarray(uvs,np.float32).astype(float);tol=1.3e-4
    def junctions(a,b):
        direction=xy[b]-xy[a];length=np.linalg.norm(direction)
        if length<tol:return []
        t=(xy-xy[a])@direction/(length*length)
        off=np.abs((xy[:,0]-xy[a,0])*direction[1]-(xy[:,1]-xy[a,1])*direction[0])/length
        selected=np.flatnonzero((t>tol/length)&(t<1-tol/length)&(off<tol))
        return selected[np.argsort(t[selected])].tolist()
    split_count=0
    for name,tri_list in indices.items():
        queue=tri_list[:];done=[]
        while queue:
            tri=queue.pop();changed=False
            for j in range(3):
                a,b,c=tri[j],tri[(j+1)%3],tri[(j+2)%3];inside=junctions(a,b)
                if inside:
                    chain=[a]+inside+[b];queue.extend([[chain[k],chain[k+1],c] for k in range(len(chain)-1)]);split_count+=1;changed=True;break
            if not changed:done.append(tri)
            assert len(queue)+len(done)<10000,'Non-conforming subdivision did not converge'
        indices[name]=np.asarray(done,int)
    edge_owners={}
    for name,tri_list in indices.items():
        for tri in tri_list:
            for i in range(3):edge=tuple(sorted((int(tri[i]),int(tri[(i+1)%3]))));edge_owners.setdefault(edge,[]).append(name)
    remaining=[edge for edge in edge_owners if junctions(*edge)]
    shared=[edge for edge,owners in edge_owners.items() if 'front' in owners and 'back' in owners]
    assert not remaining
    result={name:{'positions':xy,'uv':uv,'triangles':tri_list} for name,tri_list in indices.items()}
    audit={'vertexStorage':'single shared float32 source position and UV tables; separate disjoint triangle lists',
           'uniqueVertices':len(xy),'incidentTriangleSplitOperations':split_count,'remainingTJunctionEdges':len(remaining),
           'sharedFrontBackEdges':len(shared),'sharedFrontBackSourceAndUvMaximumDifference':0,
           'maximumPreCanonicalFloat32UvDisagreement':maximum_uv_disagreement,'collinearityToleranceSourcePx':tol,
           'positions':xy.tolist(),'uvs':uv.tolist(),'frontIndices':indices['front'].tolist(),'backIndices':indices['back'].tolist(),'sharedEdges':shared}
    return result,audit


def write_review_conclusion(report):
    cuts=report['switchWindowDiagnostic']
    lines=[
        '# CPU depth-partition review: rejected as a visual fix',
        '',
        'No model, source PNG, UV, material, braid geometry or parameter channel was changed. This is a CPU-only 73-mesh experiment from the original 72 source layers.',
        '',
        f'Whole-Upper depth promotion has no zero-difference state among the 17 sampled HatTouch values. Visible RGB changes range from {min(r["changedVisibleRgbPixels"] for r in cuts)} to {max(r["changedVisibleRgbPixels"] for r in cuts)} pixels. These samples provide no valid hard-switch window; they are not a proof about every real-valued parameter.',
        '',
        'Six existing triangles qualify for a permanently front segment: 20, 21, 22, 23, 26, 27. Every triangle footprint and vertex is strictly within Cape_R alpha255 eroded inward 1px at neutral. The remaining 41 triangles stay at the original Upper depth. Both sets retain the same source texture and rigid parent transform.',
        '',
        'Both anchors preserve exact neutral RGBA. Opaque Cape/Scarf pixels remain byte-identical at all 34 sampled poses. The front segment has no opacity fade or depth switch; it emerges by geometric movement from behind the protected Cape/Scarf masks.',
        '',
        'Visual failure: the eligible partition exposes straight internal triangle edges. At HatTouch 1 the old anchor produces an isolated diagonal gray-green strip on the braid; at .75 it becomes a disconnected trapezoid. The balanced anchor has the same structural problem. Exact neutral identity and continuous visibility do not make this an acceptable shoulder/elbow silhouette.',
        '',
        'The eligible region is only the Cape-covered shoulder-side part of Upper; it excludes the source elbow. Existing triangle eligibility therefore does not provide the full visible sleeve connection. Do not promote the complete Upper layer or accept these CPU images as a repair.',
        '',
        'Artifacts: source-triangle-partition.json contains all 47 eligibility decisions and exact UV/indices; whole-upper-depth-switch-differences.json contains all 17 switch comparisons; study-report.json contains all 34 partition samples and frozen input hashes. hat-12/16-fullbody-contact-sheet-CPU-only.png show the visible rejection reason.',
    ]
    (OUT/'review-conclusion.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')


def analyze_connected_eligibility():
    """Read-only eligibility supplement; no remeshing and no new posed render."""
    out=A.ROOT/'validation/b14-upper-depth-partition-r2-source-analysis'
    assert not out.exists();out.mkdir(parents=True)
    meta,native=A.read(A.META),A.read(A.GEOMETRY)
    rows={d['id']:d for d in meta['layers']};geo={d['id']:d for d in native['drawables']}
    snapshot={d['id']:d for d in A.read(A.CAPTURES/'neutral.json')['drawables']}
    paths=[A.META,A.GEOMETRY]+[A.META.parent/r['path'] for r in rows.values()]
    before={str(p):A.sha(p) for p in paths}
    upper_alpha=np.zeros((A.HEIGHT,A.WIDTH),np.float32);lower_alpha=np.zeros_like(upper_alpha);cape_alpha=np.zeros_like(upper_alpha)
    trans_after_upper=np.ones_like(upper_alpha);braid_visible=np.zeros_like(upper_alpha);seen_upper=False
    for key in sorted(rows,key=lambda k:snapshot[k]['renderOrder']):
        img=Image.open(A.META.parent/rows[key]['path']).convert('RGBA');bbox=img.getchannel('A').getbbox() or (0,0,1,1)
        x0,y0,x1,y1=bbox;bbox=(max(0,x0-2),max(0,y0-2),min(A.WIDTH,x1+2),min(A.HEIGHT,y1+2))
        rgba=np.asarray(img.crop(bbox)).astype(np.float32)/255;rgba[...,:3]*=rgba[...,3:4]
        src=np.asarray(geo[key]['positions'],float).reshape(-1,2)
        posed=src if key in A.ARM else A.actual_positions(snapshot[key])
        (x0,y0,x1,y1),rendered=A.raster_layer(src,np.asarray(snapshot[key]['vertexIndices']).reshape(-1,3),posed,(bbox[0],bbox[1],rgba),snapshot[key]['opacity'])
        alpha=rendered[...,3];sl=np.s_[y0:y1,x0:x1]
        braid_visible[sl]*=1-alpha
        if key in BRAID:braid_visible[sl]+=alpha
        if seen_upper:trans_after_upper[sl]*=1-alpha
        if key==UPPER:upper_alpha[sl]=alpha;seen_upper=True
        elif key=='Arm_R_Lower':lower_alpha[sl]=alpha
        elif key=='Cape_R':cape_alpha[sl]=alpha
    material=upper_alpha>1e-7
    cape=cape_alpha>=1-1e-7;lower=lower_alpha>=1-1e-7
    visible=(trans_after_upper>=1-1e-7)&material
    excluded_braid=braid_visible>1e-7
    safe=material&(cape|lower|visible)&~excluded_braid
    components,n=label(safe);elbow=(276,929);shoulder=(341,747)
    elbow_component=int(components[elbow[1],elbow[0]])
    connected=components==elbow_component if elbow_component else np.zeros_like(safe)
    dist=distance_transform_edt(safe)
    width_checks=[]
    for clearance in [0,1,2,3,5,8,10,15]:
        core=safe&(dist>=clearance);labels,count=label(core);eid=int(labels[elbow[1],elbow[0]])
        reaching=(labels==eid)&cape if eid else np.zeros_like(core)
        y,x=np.nonzero(reaching)
        width_checks.append({'minimumPixelClearance':clearance,'elbowComponentReachesCape':bool(reaching.any()),
                             'reachableCapePixels':int(reaching.sum()),'minimumReachableCapeY':int(y.min()) if len(y) else None})
    src=np.asarray(geo[UPPER]['positions'],float).reshape(-1,2);tris=np.asarray(snapshot[UPPER]['vertexIndices']).reshape(-1,3)
    tri_rows=[];whole=[];covered_by_whole=np.zeros_like(safe)
    for i,tri in enumerate(tris):
        (x0,y0,x1,y1),mask=triangle_raster(src[tri]);sl=np.s_[y0:y1,x0:x1]
        solid=mask&material[sl];ok=bool(solid.any() and safe[sl][solid].all())
        in_elbow=int((solid&connected[sl]).sum())
        if ok:whole.append(i);covered_by_whole[sl]|=mask&safe[sl]
        tri_rows.append({'triangleIndex':i,'indices':tri.tolist(),'sourcePositions':src[tri].tolist(),
                         'upperMaterialPixels':int(solid.sum()),'eligibleMaterialPixels':int((solid&safe[sl]).sum()),
                         'eligibleElbowComponentPixels':in_elbow,'unsafeMaterialPixels':int((solid&~safe[sl]).sum()),
                         'excludedVisibleBraidMaterialPixels':int((solid&excluded_braid[sl]).sum()),'wholeTriangleEligible':ok})
    wl,n=label(covered_by_whole);we=int(wl[elbow[1],elbow[0]])
    whole_reaches=bool(we and ((wl==we)&cape).any())
    y,x=np.nonzero(connected)
    report={'scope':'Source eligibility only on frozen b13 source; NOT a new pose or final-current-source qualification',
            'rule':'Projected Upper material intersect (Cape_R fully opaque OR Lower fully opaque OR Upper entirely unobscured final contribution), minus ANY final visible braid contribution. Lower must protect a future front segment.',
            'sourceMetadata':str(A.META),'sourceHashes':before,'inputHashesUnchanged':before=={str(p):A.sha(p) for p in paths},
            'sourceElbow':list(elbow),'sourceShoulder':list(shoulder),
            'safeMaterialPixels':int(safe.sum()),'elbowInsideSafe':bool(elbow_component),'elbowSafeClearancePx':float(dist[elbow[1],elbow[0]]),
            'elbowComponentPixels':int(connected.sum()),'elbowComponentBBox':[int(x.min()),int(y.min()),int(x.max()),int(y.max())] if len(x) else None,
            'elbowComponentReachesCape':bool((connected&cape).any()),'elbowComponentReachesExactShoulder':bool(connected[shoulder[1],shoulder[0]]),
            'sourceShoulderFinalVisibleBraid':bool(excluded_braid[shoulder[1],shoulder[0]]),'sourceShoulderCapeOpaque':bool(cape[shoulder[1],shoulder[0]]),
            'clearanceConnectivity':width_checks,'wholeTriangleEligibleIndices':whole,'wholeTriangleUnionConnectsElbowToCape':whole_reaches,
            'triangles':tri_rows,'subdivisionPerformed':False,
            'limitations':'Pixel-center eligibility is a screening map, not a guaranteed subpixel/vector clip. Any future subdivision must retain exact original triangle union, original UV interpolation, and rerun neutral RGBA against the new Upper/Cape source revision.'}
    (out/'eligibility-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    visual=np.zeros((A.HEIGHT,A.WIDTH,4),np.uint8);visual[material]=[180,70,70,255];visual[safe]=[70,170,85,255];visual[connected]=[40,195,150,255];visual[material&excluded_braid]=[220,155,45,255]
    img=A.with_background(Image.fromarray(visual));dr=ImageDraw.Draw(img)
    for point,tag in [(elbow,'E'),(shoulder,'S')]:x,y=point;dr.ellipse((x-4,y-4,x+4,y+4),fill='black');dr.text((x+5,y-12),tag,fill='black')
    img.crop((170,650,430,1020)).resize((520,740)).save(out/'source-safe-component.png')
    for name,mask in [('safe-material',safe),('elbow-connected-component',connected),('whole-triangle-safe-material',covered_by_whole),('final-visible-braid',excluded_braid)]:Image.fromarray((mask*255).astype(np.uint8)).save(out/f'{name}.png')
    print(json.dumps({k:v for k,v in report.items() if k not in ['sourceHashes','triangles']},indent=2),flush=True)


def study_connected_subdivision(smooth=False,shape=False,latest=False,donor=False):
    """One old-axis local subdivision experiment, with exact neutral RGBA gate."""
    import shapely
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union

    out=A.ROOT/('validation/b14-upper-depth-subdivision-r5-volume-texture' if donor else 'validation/b14-upper-depth-subdivision-r4-b14-corridor' if latest else 'validation/b14-upper-depth-subdivision-r3-shared-shape' if shape else 'validation/b14-upper-depth-subdivision-r2-smooth' if smooth else 'validation/b14-upper-depth-subdivision-r1')
    assert not out.exists();out.mkdir(parents=True)
    meta_path=A.ROOT/'fullbody/revisions/b14-combined-source-r1/fullbody.metadata.json' if latest else A.META
    geometry_path=A.ROOT/'research/isolated-psd2live/results/b14-source-coverage-inputs-r1/upper-augmented-source-geometry-NOT-NATIVE.json' if latest else A.GEOMETRY
    meta,native=A.read(meta_path),A.read(geometry_path);rows={r['id']:r for r in meta['layers']};geo={r['id']:r for r in native['drawables']}
    states={i:{d['id']:d for d in A.read(A.CAPTURES/f'{name}.json')['drawables']} for i,name in [(0,'neutral'),(8,'hat-8-head0-e1'),(16,'hat-16-head0-e1')]}
    source={k:np.asarray(d['positions'],float).reshape(-1,2) for k,d in geo.items()};triangles={k:np.asarray(states[0][k]['vertexIndices']).reshape(-1,3) for k in rows}
    if latest:triangles[UPPER]=np.asarray(geo[UPPER]['indices']).reshape(-1,3)
    donor_path=A.ROOT/'fullbody/candidates/b14-upper-volume-integrated-r1/layers/Arm_R_Upper.png' if donor else None
    frozen=[meta_path,geometry_path,Path(native['source'])]+[meta_path.parent/r['path'] for r in rows.values()]+([donor_path] if donor else []);hashes={str(p):A.sha(p) for p in frozen}
    alphas={};textures={};covered=np.zeros((A.HEIGHT,A.WIDTH),bool)
    for key,row in rows.items():
        img=Image.open(donor_path if donor and key==UPPER else meta_path.parent/row['path']).convert('RGBA');alphas[key]=np.asarray(img)[...,3].copy()
        if donor and key==UPPER:assert np.array_equal(alphas[key],np.asarray(Image.open(meta_path.parent/row['path']).convert('RGBA'))[...,3])
        if states[0][key]['renderOrder']>states[0][UPPER]['renderOrder']:covered|=alphas[key]>0
        bb=img.getchannel('A').getbbox() or (0,0,1,1);x0,y0,x1,y1=bb;bb=(max(0,x0-2),max(0,y0-2),min(A.WIDTH,x1+2),min(A.HEIGHT,y1+2))
        rgba=np.asarray(img.crop(bb)).astype(np.float32)/255;rgba[...,:3]*=rgba[...,3:4];textures[key]=(bb[0],bb[1],rgba)
    if latest:
        braid_contribution=np.zeros((A.HEIGHT,A.WIDTH),np.float32)
        for key in sorted(rows,key=lambda k:states[0][k]['renderOrder']):
            alpha=alphas[key].astype(np.float32)/255*states[0][key]['opacity'];braid_contribution*=1-alpha
            if key in BRAID:braid_contribution+=alpha
        exclusion=braid_contribution>1e-7
    else:
        previous=A.ROOT/'validation/b14-upper-depth-partition-r2-source-analysis'
        exclusion=np.asarray(Image.open(previous/'final-visible-braid.png'))>0
        previous_report=A.read(previous/'eligibility-report.json')
        assert all(A.sha(Path(p))==h for p,h in previous_report['sourceHashes'].items())
    safe=(alphas[UPPER]>0)&((alphas['Cape_R']==255)|(alphas['Arm_R_Lower']==255)|~covered)&~exclusion
    components,n=label(safe);eid=components[929,276];assert eid
    safe=components==eid
    distance=distance_transform_edt(safe);clearance=[]
    for radius in [1,2,5,10,15,20]:
        core,n=label(safe&(distance>=radius));cid=core[929,276];y,x=np.nonzero((core==cid)&(alphas['Cape_R']==255)) if cid else ([],[])
        clearance.append({'clearancePx':radius,'reachesCape':bool(len(x)),'minimumCapeY':int(y.min()) if len(y) else None})
    # Union row runs into an exact pixel-cell planning boundary. This is a source-only
    # partition: each original triangle is split against it, never expanded.
    runs=[]
    for y in range(A.HEIGHT):
        padded=np.r_[False,safe[y],False].astype(np.int8);delta=np.diff(padded);starts=np.flatnonzero(delta==1);ends=np.flatnonzero(delta==-1)
        runs.extend(box(int(x0),y,int(x1),y+1) for x0,x1 in zip(starts,ends))
    planned=unary_union(runs)
    planning_info={'mode':'exact pixel-cell boundary','safeAreaPx':planned.area}
    if smooth:
        original_safe=planned
        # Net 3 px inset plus rounded corners, then subpixel simplification.
        # Verify containment instead of clipping a smoothed edge back to stairs.
        planned=planned.buffer(-6,quad_segs=12).buffer(3,quad_segs=12).simplify(.7,preserve_topology=True)
        assert not planned.is_empty and planned.difference(original_safe).area<1e-10
        planning_info={'mode':'inside safe domain: buffer(-6), round buffer(+3), simplify(0.7)',
                       'safeAreaPx':original_safe.area,'frontPlanningAreaPx':planned.area,
                       'outsideSafeAreaPx':planned.difference(original_safe).area}
        (out/'smoothed-front-boundary.geojson').write_text(shapely.to_geojson(planned)+'\n',encoding='utf-8')
    if latest:
        shoulder=A.S;elbow=np.array([276.,929.]);length=np.linalg.norm(elbow-shoulder);axis=(elbow-shoulder)/length;normal=np.array([-axis[1],axis[0]])
        ts=np.linspace(0,length,65)
        def ss(v):v=np.clip(v,0,1);return v*v*(3-2*v)
        radii=np.where(ts<=length/2,9+(45-9)*ss(ts/(length/2)),45+(32-45)*ss((ts-length/2)/(length/2)))
        left=shoulder+ts[:,None]*axis+radii[:,None]*normal
        right=shoulder+ts[::-1,None]*axis-radii[::-1,None]*normal
        end_angles=np.linspace(np.pi/2,-np.pi/2,25);start_angles=np.linspace(-np.pi/2,-3*np.pi/2,25)
        end=elbow+32*(np.cos(end_angles)[:,None]*axis+np.sin(end_angles)[:,None]*normal)
        start=shoulder+9*(np.cos(start_angles)[:,None]*axis+np.sin(start_angles)[:,None]*normal)
        corridor=Polygon(np.concatenate([left,end[1:],right[1:],start[1:]]))
        planned=planned.intersection(corridor)
        planning_info['corridor']={'shoulderRoundCapRadiusPx':9,'middleHalfWidthPx':45,'elbowRoundCapRadiusPx':32,'field':'No extra narrowing deformation; original rigid Upper transform retained.'}
        planning_info['corridorFrontAreaPx']=planned.area
        (out/'corridor-front-boundary.geojson').write_text(shapely.to_geojson(planned)+'\n',encoding='utf-8')
    original_uv=np.asarray(geo[UPPER]['uvs'],float).reshape(-1,2)
    pieces={'front':{'positions':[],'uv':[],'triangles':[]},'back':{'positions':[],'uv':[],'triangles':[]}}
    area_rows=[]
    for i,tri in enumerate(triangles[UPPER]):
        xy=source[UPPER][tri];polygon=Polygon(xy);front=polygon.intersection(planned);back=polygon.difference(planned)
        area_rows.append({'originalTriangle':i,'originalArea':polygon.area,'frontArea':front.area,'backArea':back.area,
                          'partitionUnionSymmetricDifferenceArea':front.union(back).symmetric_difference(polygon).area,'overlapArea':front.intersection(back).area})
        mat=np.column_stack([xy[1]-xy[0],xy[2]-xy[0]])
        for name,geometry in [('front',front),('back',back)]:
            if geometry.is_empty:continue
            for polygon_piece in shapely.get_parts(geometry):
                if polygon_piece.geom_type!='Polygon' or polygon_piece.area<1e-10:continue
                for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(polygon_piece)):
                    coords=np.asarray(triangle.exterior.coords)[:3]
                    if triangle.area<1e-10:continue
                    bary=np.linalg.solve(mat,(coords-xy[0]).T).T
                    uv=original_uv[tri[0]]+bary[:,0,None]*(original_uv[tri[1]]-original_uv[tri[0]])+bary[:,1,None]*(original_uv[tri[2]]-original_uv[tri[0]])
                    start=len(pieces[name]['positions']);pieces[name]['positions'].extend(coords.tolist());pieces[name]['uv'].extend(uv.tolist());pieces[name]['triangles'].append([start,start+1,start+2])
    for piece in pieces.values():piece['positions']=np.asarray(piece['positions']);piece['uv']=np.asarray(piece['uv']);piece['triangles']=np.asarray(piece['triangles'])
    canonical_audit=None
    if latest:
        pieces,canonical_audit=conform_float32_partition(pieces)
        if donor:
            reference=A.read(A.ROOT/'validation/b14-upper-depth-subdivision-r4-b14-corridor/shared-float32-partition-NOT-NATIVE.json')
            for key in ['positions','uvs','frontIndices','backIndices']:assert canonical_audit[key]==reference[key],f'Donor must not change {key}'
        (out/'shared-float32-partition-NOT-NATIVE.json').write_text(json.dumps(canonical_audit,indent=2)+'\n',encoding='utf-8')
    assert max(r['partitionUnionSymmetricDifferenceArea'] for r in area_rows)<1e-7
    assert max(r['overlapArea'] for r in area_rows)<1e-7
    Image.fromarray((safe*255).astype(np.uint8)).save(out/'source-front-planning-mask.png')
    evidence={'scope':'Exact original-triangle subdivision; original 72 PNGs, CPU73 meshes, old elbow only',
              'planningBoundary':planning_info,
              'eligibility':'8bit source Cape255 OR Lower255 OR entirely unobscured Upper; exclude actual-neutral final visible braid. Elbow-connected component only. Final neutral RGBA gate is separate and mandatory.',
              'clearanceConnectivity':clearance,'sourceLayerCount':72,'cpuMeshCount':73,'originalTriangleCount':len(triangles[UPPER]),
              'frontTriangleCount':len(pieces['front']['triangles']),'backTriangleCount':len(pieces['back']['triangles']),
              'partitionAreaChecks':area_rows,'geometry':{name:{k:v.tolist() for k,v in p.items()} for name,p in pieces.items()}}
    (out/'subdivision-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'sourceConnected':True,'sourceClearance':clearance,'frontTriangles':evidence['frontTriangleCount'],'backTriangles':evidence['backTriangleCount']}),flush=True)
    targets={}
    for step,st in states.items():src=source['Arm_R_Lower'];fit=np.linalg.lstsq(np.c_[src,np.ones(len(src))],A.actual_positions(st['Arm_R_Lower']),rcond=None)[0];targets[step]=np.r_[A.P,1]@fit
    fixed={}
    def build_fixed(step):
        at=0 if step<8 else 8 if step==8 else 16
        if at not in fixed:
            st=states[at];front_order=max(st[k]['renderOrder'] for k in BRAID)+.5
            order=sorted(list(rows)+[FRONT],key=lambda k:front_order if k==FRONT else st[k]['renderOrder'])
            blocks=[];canvas=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32);protect=np.zeros((A.HEIGHT,A.WIDTH),np.float32);count=0
            for key in order:
                if key in A.ARM or key==FRONT:
                    if count:blocks.append(canvas)
                    blocks.append(key);canvas=np.zeros_like(canvas);count=0
                else:
                    layer=A.raster_layer(source[key],triangles[key],A.actual_positions(st[key]),textures[key],st[key]['opacity']);(x0,y0,x1,y1),rgba=layer;A.paste(canvas,layer);count+=1
                    if key=='Cape_R' or key.startswith('Scarf_'):
                        sub=protect[y0:y1,x0:x1];sub[:]=1-(1-sub)*(1-rgba[...,3])
            if count:blocks.append(canvas)
            fixed[at]=(st,blocks,protect,front_order)
        return fixed[at]
    def render(step,partition):
        st,blocks,protect,front_order=build_fixed(step);protect=protect.copy();e=np.array([276.,929.]);target=targets.get(step,A.bezier(step/16));elbow,upper,lower,_,_=A.ik(e,target,neutral=step==0)
        arm={}
        for key in A.ARM:
            xy=A.rotate(source[key],*((A.S,A.S,upper) if key==UPPER else (e,elbow,lower)))
            arm[key]=A.raster_layer(source[key],triangles[key],xy,textures[key],st[key]['opacity'])
        if True:
            (x0,y0,x1,y1),rgba=arm['Arm_R_Lower'];sub=protect[y0:y1,x0:x1];sub[:]=1-(1-sub)*(1-rgba[...,3])
        if partition:
            for name,p in pieces.items():
                posed_source=shared_upper_shape(p['positions'],step/16) if shape else p['positions']
                arm[name]=A.raster_layer(p['positions'],p['triangles'],A.rotate(posed_source,A.S,A.S,upper),textures[UPPER],st[UPPER]['opacity'])
        canvas=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32)
        for block in blocks:
            if isinstance(block,str):
                if block==FRONT:
                    if not partition:continue
                    (x0,y0,x1,y1),rgba=arm['front'];layer=((x0,y0,x1,y1),rgba*(1-protect[y0:y1,x0:x1,None]))
                else:layer=arm['back' if partition and block==UPPER else block]
                A.paste(canvas,layer)
            else:A.over(canvas,block)
        return A.to_image(canvas),elbow,A.rotate(A.P,e,elbow,lower),target
    results=[]
    shape_sweep=[];previous={}
    steps=[0,16,12,8]+([s for s in range(17) if s not in [0,16,12,8]] if (shape or latest) and not donor else [])
    for step in steps:
        baseline,_,_,_=render(step,False);candidate,elbow,palm,target=render(step,True);difference=pixel_diff(baseline,candidate)
        candidate.save(out/f'hat-{step:02d}-73mesh-subdivision-CPU-only.png');baseline.save(out/f'hat-{step:02d}-72mesh-original-CPU-only.png')
        if donor:
            prior=A.ROOT/'validation/b14-upper-depth-subdivision-r4-b14-corridor'
            if step==0:assert pixel_diff(Image.open(prior/'hat-00-72mesh-original-CPU-only.png'),baseline)['changedRgbaPixels']==0
            old=Image.open(prior/f'hat-{step:02d}-73mesh-subdivision-CPU-only.png').convert('RGBA')
            sheet=Image.new('RGB',(A.WIDTH*2,A.HEIGHT+45),'white');sheet.paste(A.with_background(old),(0,45));sheet.paste(A.with_background(candidate),(A.WIDTH,45));dr=ImageDraw.Draw(sheet)
            dr.text((12,12),'Frozen r4 texture / CPU ONLY',fill='black');dr.text((A.WIDTH+12,12),'Same frozen geometry + source RGB donor / CPU ONLY',fill='black');sheet.save(out/f'hat-{step:02d}-texture-comparison-CPU-only.png')
        results.append({'step':step,'hatTouch':step/16,'differenceFromOriginal72Mesh':difference,'elbow':elbow.tolist(),'palm':palm.tolist(),'palmTargetErrorPx':float(np.linalg.norm(palm-target))})
        print(json.dumps({'ready':str(out/f'hat-{step:02d}-73mesh-subdivision-CPU-only.png'),'difference':difference}),flush=True)
        if step==0 and difference['changedRgbaPixels']:
            print('REJECTED: exact neutral RGBA gate failed; no posed candidates will be rendered',flush=True);break
    if shape:
        all_meshes={**pieces,'original':{'positions':source[UPPER],'triangles':triangles[UPPER]}}
        for step in range(17):
            row={'step':step,'hatTouch':step/16,'meshes':{}}
            for name,p in all_meshes.items():
                xy=p['positions'];posed=shared_upper_shape(xy,step/16);tr=p['triangles'];before_tri=xy[tr];after_tri=posed[tr]
                def signed(v):b=v[:,1]-v[:,0];c=v[:,2]-v[:,0];return b[:,0]*c[:,1]-b[:,1]*c[:,0]
                before_area=signed(before_tri);after_area=signed(after_tri);valid=np.abs(before_area)>1e-9;ratios=after_area[valid]/before_area[valid]
                before_edges=np.linalg.norm(before_tri-np.roll(before_tri,1,axis=1),axis=2);after_edges=np.linalg.norm(after_tri-np.roll(after_tri,1,axis=1),axis=2);edges=after_edges[before_edges>1e-9]/before_edges[before_edges>1e-9]
                eps=.001;jx=(shared_upper_shape(xy+np.array([eps,0]),step/16)-shared_upper_shape(xy-np.array([eps,0]),step/16))/(2*eps)
                jy=(shared_upper_shape(xy+np.array([0,eps]),step/16)-shared_upper_shape(xy-np.array([0,eps]),step/16))/(2*eps)
                jac=np.stack([jx,jy],axis=2);det=np.linalg.det(jac);sv=np.linalg.svd(jac,compute_uv=False)
                row['meshes'][name]={'flippedOrCollapsedTriangles':int((ratios<=0).sum()),'triangleAreaRatioMin':float(ratios.min()),'triangleAreaRatioMax':float(ratios.max()),
                    'edgeLengthRatioMin':float(edges.min()),'edgeLengthRatioMax':float(edges.max()),'jacobianDeterminantMin':float(det.min()),'jacobianSingularValueMin':float(sv.min()),'jacobianSingularValueMax':float(sv.max()),
                    'maximumSourceDisplacementPx':float(np.linalg.norm(posed-xy,axis=1).max()),'maximumAdjacentShapeDisplacementPx':0 if name not in previous else float(np.linalg.norm(posed-previous[name],axis=1).max())}
                previous[name]=posed
            anchors=np.linspace(A.S,np.array([276.,929.]),33)
            row['maximumShoulderElbowBoneAxisDriftPx']=float(np.abs(shared_upper_shape(anchors,step/16)-anchors).max())
            shape_sweep.append(row)
        assert all(m['flippedOrCollapsedTriangles']==0 for r in shape_sweep for m in r['meshes'].values())
    report={'scope':'One CPU-only old-axis subdivision candidate; no native Core evidence','sourceMetadata':str(meta_path),'sourceGeometry':str(geometry_path),
            'sourceRgbTextureOverride':{'path':str(donor_path),'sha256':hashes[str(donor_path)],'alphaIdentical':True,'positionsUvsAndIndicesIdenticalToR4':True,'neutralIdenticalToFrozenR4':True} if donor else None,
            'neutralExactRgbaIdentity':results[0]['differenceFromOriginal72Mesh']['changedRgbaPixels']==0,
            'sharedUpperShape':{'enabled':shape,'maximumAllowedSourceShiftPx':12,'field':'Source shoulder-elbow (t,n): dn=-smoothstep(Hat)*12*smoothstep(t/25)*smoothstep((L-t)/35)*exp(-0.5*((t-65)/65)^2)*sin(clamp(n/50,-1,1)*pi/2). Exact zero on bone axis and outside shoulder-elbow endpoints. Same function for front/back, UV unchanged.','sweep':shape_sweep},
            'sourceHashesUnchanged':hashes=={str(p):A.sha(p) for p in frozen},'frozenInputSha256':hashes,'results':results,
            'policy':'Front/back are disjoint subdivisions of every original triangle with original UV linearly interpolated. Front constant visible after Braid; FIXED inverse mask union is Cape_R, four Scarf layers, Arm_R_Lower at every pose. No parameter-conditional mask, opacity transition or braid movement.',
            'canonicalPartitionAudit':{k:v for k,v in canonical_audit.items() if k not in ['positions','uvs','frontIndices','backIndices','sharedEdges']} if canonical_audit else None,
            'limitations':'Frozen b13 source only; current future Upper/Cape revisions must requalify. Planning uses source8bit alpha but final neutral equality is checked against actual-position CPU composite. Pixel-cell partition boundaries still require visual review.'}
    (out/'study-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


def freeze_r4_handoff():
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    out=A.ROOT/'validation/b14-upper-depth-subdivision-r4-b14-corridor'
    canonical=A.read(out/'shared-float32-partition-NOT-NATIVE.json');study=A.read(out/'study-report.json')
    geometry_path=Path(study['sourceGeometry']);native=A.read(geometry_path);upper=next(d for d in native['drawables'] if d['id']==UPPER)
    old=np.asarray(upper['positions'],float).reshape(-1,2);old_uv=np.asarray(upper['uvs'],float).reshape(-1,2)
    canonical_xy=np.asarray(canonical['positions'],np.float32);canonical_uv=np.asarray(canonical['uvs'],np.float32)
    positions=old.tolist();uvs=old_uv.tolist();lookup={tuple(np.float32(p).tolist()):i for i,p in enumerate(positions)};mapping=[]
    for point,uv in zip(canonical_xy,canonical_uv):
        key=tuple(point.tolist())
        if key not in lookup:lookup[key]=len(positions);positions.append(point.tolist());uvs.append(uv.tolist())
        mapping.append(lookup[key])
    remap=np.asarray(mapping);front=remap[np.asarray(canonical['frontIndices'])];back=remap[np.asarray(canonical['backIndices'])]
    xy=np.asarray(positions,np.float32).astype(float)
    def orient(triangles):
        v=xy[triangles];b=v[:,1]-v[:,0];c=v[:,2]-v[:,0];sign=b[:,0]*c[:,1]-b[:,1]*c[:,0]
        result=triangles.copy();result[sign<0]=result[sign<0][:,[0,2,1]];return result
    front,back=orient(front),orient(back)
    old_tri=np.asarray(upper['indices']).reshape(-1,3)
    f=unary_union([Polygon(xy[t]) for t in front]);b=unary_union([Polygon(xy[t]) for t in back]);original=unary_union([Polygon(old[t]) for t in old_tri])
    assert f.intersection(b).area<1e-7 and f.union(b).symmetric_difference(original).area<1e-7
    assert np.asarray(positions)[:len(old)].tolist()==old.tolist()
    areas=[]
    for triangles in [front,back]:v=xy[triangles];eb=v[:,1]-v[:,0];ec=v[:,2]-v[:,0];areas.extend((eb[:,0]*ec[:,1]-eb[:,1]*ec[:,0]).tolist())
    assert min(areas)>1e-9
    manifest={'scope':'FROZEN CPU-derived 73-mesh WIP handoff. NOT native/Core acceptance; known dynamic AA and material issues retained.',
        'sourceMetadata':study['sourceMetadata'],'sourceMetadataSha256':A.sha(Path(study['sourceMetadata'])),
        'sourceGeometry':str(geometry_path),'sourceGeometrySha256':A.sha(geometry_path),
        'sourceLayerCount':72,'targetDrawableCount':73,'originalUpperId':UPPER,'frontId':FRONT,
        'coordinateSpace':'source canvas pixels (971x1620). Native writer must use original Upper source-to-parent-local conversion, not blindly store world coordinates.',
        'parentDeformerId':'FS8_ArmRShoulder','originalPositions':upper['positions'],'originalUvs':upper['uvs'],'originalIndices':upper['indices'],
        'positions':np.asarray(positions).reshape(-1).tolist(),'uvs':np.asarray(uvs).reshape(-1).tolist(),
        'frontIndices':front.reshape(-1).tolist(),'backIndices':back.reshape(-1).tolist(),'fullIndices':np.concatenate([back,front]).reshape(-1).tolist(),
        'originalVertexCount':len(old),'vertexCount':len(positions),'originalTriangleCount':len(old_tri),'frontTriangleCount':len(front),'backTriangleCount':len(back),
        'originalPrefixExactlyPreserved':True,'sourcePositionAndUvStorage':'One float32-equivalent table shared by front and back; original 50 coverage vertices occupy unchanged prefix.',
        'frontMaskIds':['Cape_R','Scarf_Back','Scarf_Lower','Scarf_Middle','Scarf_Upper','Arm_R_Lower'],'frontInvertMask':True,
        'frontOpacity':1.0,'frontConstantDrawOrder':500.0,'frontTiePlacement':{'afterDrawableId':'Hair_BraidTie','beforeDrawableId':'Hair_Bangs_Center'},
        'drawOrderWarning':'All original neutral native static values are 500; intended depth relies on stable drawable/layer tie placement. Do not substitute 500.5 and assume it means after Braid but before hair. Verify actual Core renderOrder after export.',
        'backDrawOrder':'preserve original Upper drawOrder and channels','deformation':'Original old-axis rigid Upper parent. No shared narrowing field in this r4 corridor; source texel scale remains rigid.',
        'audit':{'remainingTJunctionEdges':canonical['remainingTJunctionEdges'],'sharedFrontBackEdges':canonical['sharedFrontBackEdges'],
                 'sourceAndUvSharedBoundaryDifference':0,'minimumPositiveTriangleDoubleAreaPx2':min(areas),'frontBackOverlapArea':f.intersection(b).area,
                 'fullUnionSymmetricDifferenceFromCoverageGeometryArea':f.union(b).symmetric_difference(original).area,
                 'neutralExactRgbaIdentity':study['neutralExactRgbaIdentity'],'poseSamples':len(study['results']),'frozenSourceHashesUnchanged':study['sourceHashesUnchanged']},
        'knownIssues':['Fixed Lower inverse mask plus foreground Lower causes dynamic AA differences: Hat0.0625 100 alpha pixels, max64/255. Preserve for visual/native review, not silently discard.',
                       'Sleeve material and shoulder silhouette remain WIP; current geometry is not an acceptance claim.',
                       'Only Upper coverage is augmented in this geometry input; the native writer must also apply the separately supplied full b14 coverage plan for BackMass/Tip.'],
        'cpuEvidence':str(out/'study-report.json')}
    path=out/'native-handoff-manifest.json';assert not path.exists();path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    evidence=out/'aa-hat-01-evidence';evidence.mkdir(exist_ok=False)
    before=Image.open(out/'hat-01-72mesh-original-CPU-only.png').convert('RGBA');after=Image.open(out/'hat-01-73mesh-subdivision-CPU-only.png').convert('RGBA')
    delta=np.asarray(after,dtype=np.int16)[...,3]-np.asarray(before,dtype=np.int16)[...,3];ys,xs=np.nonzero(delta)
    roi=[max(0,int(xs.min())-12),max(0,int(ys.min())-12),min(A.WIDTH,int(xs.max())+13),min(A.HEIGHT,int(ys.max())+13)]
    w,h=roi[2]-roi[0],roi[3]-roi[1];cropped=[before.crop(roi),after.crop(roi)];font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
    for bg_name in ['white','charcoal','checker']:
        if bg_name=='checker':
            yy,xx=np.mgrid[:h,:w];gray=np.where(((xx//8+yy//8)%2)==0,210,245).astype(np.uint8);bg=Image.fromarray(np.dstack([gray,gray,gray,np.full_like(gray,255)]))
        else:bg=Image.new('RGBA',(w,h),'white' if bg_name=='white' else (24,24,24,255))
        panels=[Image.alpha_composite(bg,p).convert('RGB') for p in cropped]
        for scale in [1,4]:
            sheet=Image.new('RGB',(w*scale*2,h*scale+45),'white');dr=ImageDraw.Draw(sheet)
            for i,panel in enumerate(panels):sheet.paste(panel.resize((w*scale,h*scale),Image.Resampling.NEAREST),(i*w*scale,45));dr.text((i*w*scale+5,5),('72 mesh baseline' if i==0 else '73 mesh fixed6 masks'),font=font,fill='black')
            dr.text((5,24),f'CPU Hat0.0625 | ROI {roi} | {scale}x | {bg_name}',font=font,fill='black');sheet.save(evidence/f'{bg_name}-{scale}x.png')
    local=delta[roi[1]:roi[3],roi[0]:roi[2]];heat=np.full((h,w,3),255,np.uint8);heat[local<0]=[220,30,30];heat[local>0]=[30,100,230]
    Image.fromarray(heat).resize((w*4,h*4),Image.Resampling.NEAREST).save(evidence/'alpha-difference-locations-4x.png')
    annotation={'hatTouch':.0625,'roi':roi,'alphaChangedPixels':len(xs),'maxAbsoluteAlphaDifference':int(abs(delta).max()),
                'positiveAlphaPixels':int((delta>0).sum()),'negativeAlphaPixels':int((delta<0).sum()),
                'positions':[{'x':int(x),'y':int(y),'alphaDeltaCandidateMinusBaseline':int(delta[y,x])} for x,y in zip(xs,ys)],
                'meaning':'Difference evidence only. Dynamic alpha difference is not automatically a visual defect; inspect against three backgrounds and actual Core.'}
    (evidence/'alpha-difference-coordinates.json').write_text(json.dumps(annotation,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'manifest':str(path),'sha256':A.sha(path),'vertexCount':len(positions),'frontTriangles':len(front),'backTriangles':len(back),'aaEvidence':str(evidence),'alphaRoi':roi}),flush=True)


def main():
    assert not OUT.exists(),'Use a new immutable output revision'
    OUT.mkdir(parents=True)
    meta,native=A.read(A.META),A.read(A.GEOMETRY)
    rows={d['id']:d for d in meta['layers']};geo={d['id']:d for d in native['drawables']}
    states={i:A.read(A.CAPTURES/f'{name}.json') for i,name in [(0,'neutral'),(8,'hat-8-head0-e1'),(16,'hat-16-head0-e1')]}
    snapshots={i:{d['id']:d for d in s['drawables']} for i,s in states.items()}
    frozen=[A.META,A.GEOMETRY,A.FORMULA,Path(native['source']),Path(A.__file__)]+[A.META.parent/d['path'] for d in rows.values()]
    frozen += [A.CAPTURES/f'{name}.json' for name in ['neutral','hat-8-head0-e1','hat-16-head0-e1']]
    hashes={str(p):A.sha(p) for p in frozen}
    source={k:np.asarray(d['positions'],dtype=float).reshape(-1,2) for k,d in geo.items()}
    triangles={k:np.asarray(snapshots[0][k]['vertexIndices']).reshape(-1,3) for k in rows}
    textures,source_alpha={},{}
    for key,row in rows.items():
        img=Image.open(A.META.parent/row['path']).convert('RGBA')
        source_alpha[key]=np.asarray(img)[...,3].copy()
        bbox=img.getchannel('A').getbbox() or (0,0,1,1);x0,y0,x1,y1=bbox
        bbox=(max(0,x0-2),max(0,y0-2),min(A.WIDTH,x1+2),min(A.HEIGHT,y1+2))
        rgba=np.asarray(img.crop(bbox)).astype(np.float32)/255;rgba[...,:3]*=rgba[...,3:4];textures[key]=(bbox[0],bbox[1],rgba)
    opaque_inside=binary_erosion(source_alpha['Cape_R']==255,iterations=1)
    eligibility=[];eligible=[]
    for i,tri in enumerate(triangles[UPPER]):
        xy=source[UPPER][tri];(x0,y0,x1,y1),mask=triangle_raster(xy)
        vertex_inside=map_coordinates(opaque_inside.astype(float),[xy[:,1]-.5,xy[:,0]-.5],order=1,mode='constant',cval=0)
        sample=opaque_inside[y0:y1,x0:x1][mask]
        ok=bool(sample.size and sample.all() and (vertex_inside==1).all())
        if ok:eligible.append(i)
        eligibility.append({'triangleIndex':i,'indices':tri.tolist(),'sourcePositions':xy.tolist(),
                            'rasterSamples':int(sample.size),'samplesOutsideErodedOpaqueCape':int((~sample).sum()),
                            'minimumVertexErodedCapeBilinearValue':float(vertex_inside.min()),
                            'upperAlphaAreaPx':float((source_alpha[UPPER][y0:y1,x0:x1][mask]/255).sum()),'eligible':ok})
    assert eligible,'No eligible triangles: refuse partition'
    rejected=[i for i in range(len(triangles[UPPER])) if i not in eligible]
    front_tris=triangles[UPPER][eligible];back_tris=triangles[UPPER][rejected]
    assert set(eligible).isdisjoint(rejected) and sorted(eligible+rejected)==list(range(len(triangles[UPPER])))
    partition={'sourceLayerCount':72,'cpuMeshCount':73,'sourcePath':str(A.META.parent/rows[UPPER]['path']),
               'sourceSha256':hashes[str(A.META.parent/rows[UPPER]['path'])],
               'originalVertexPositions':source[UPPER].tolist(),'originalUV':geo[UPPER]['uvs'],
               'frontTriangleIndices':eligible,'backTriangleIndices':rejected,'frontTriangles':front_tris.tolist(),'backTriangles':back_tris.tolist(),
               'eligibility':'Entire original triangle pixel-center footprint AND all bilinearly sampled vertices must lie in Cape_R alpha255 eroded inward 1px. Same source/UV/rigid transform. No new color or material.',
               'triangles':eligibility}
    (OUT/'source-triangle-partition.json').write_text(json.dumps(partition,indent=2)+'\n',encoding='utf-8')
    source_diagnostic=A.with_background(Image.open(A.META.parent/rows[UPPER]['path']).convert('RGBA'))
    dr=ImageDraw.Draw(source_diagnostic)
    for row in eligibility:
        points=[tuple(p) for p in row['sourcePositions']];dr.line(points+[points[0]],fill='#179d36' if row['eligible'] else '#c93b46',width=2)
        if row['eligible']:center=np.mean(row['sourcePositions'],axis=0);dr.text(tuple(center),str(row['triangleIndex']),fill='#004500')
    source_diagnostic.crop((170,650,430,1020)).resize((520,740)).save(OUT/'source-triangle-partition-diagnostic.png')
    print(json.dumps({'eligibleTriangles':eligible,'totalTriangles':len(triangles[UPPER]),'frontAlphaAreaPx':sum(r['upperAlphaAreaPx'] for r in eligibility if r['eligible'])}),flush=True)
    targets={}
    for step,snapshot in snapshots.items():
        src=source['Arm_R_Lower'];fit=np.linalg.lstsq(np.c_[src,np.ones(len(src))],A.actual_positions(snapshot['Arm_R_Lower']),rcond=None)[0];targets[step]=np.r_[A.P,1]@fit
    def snapshot_for(step):return 0 if step<8 else 8 if step==8 else 16
    cached_fixed={};cached_dynamic={}
    def raster(key,snapshot,xy,tris=None):return A.raster_layer(source[key],triangles[key] if tris is None else tris,xy,textures[key],snapshot[key]['opacity'])
    def fixed(step):
        at=snapshot_for(step)
        if at not in cached_fixed:
            snapshot=snapshots[at]
            protected={'Cape_R'}|{k for k in rows if k.startswith('Scarf_')}
            protect=np.zeros((A.HEIGHT,A.WIDTH),np.float32)
            braid_top=max(snapshot[k]['renderOrder'] for k in BRAID)
            order=sorted(list(rows)+[FRONT],key=lambda k:braid_top+.5 if k==FRONT else snapshot[k]['renderOrder'])
            blocks=[];block=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32);count=0
            for key in order:
                if key in A.ARM or key==FRONT:
                    if count:blocks.append(block)
                    blocks.append(key);block=np.zeros_like(block);count=0
                else:
                    rendered=raster(key,snapshot,A.actual_positions(snapshot[key]));(x0,y0,x1,y1),rgba=rendered
                    A.paste(block,rendered);count+=1
                    if key in protected:
                        dst=protect[y0:y1,x0:x1];dst[:]=1-(1-dst)*(1-rgba[...,3])
            if count:blocks.append(block)
            cached_fixed[at]=(snapshot,blocks,protect)
        return cached_fixed[at]
    def arm_pose(anchor,step):
        e=ANCHORS[anchor];target=targets.get(step,A.bezier(step/16));elbow,upper,lower,a,b=A.ik(e,target,neutral=step==0)
        posed={k:A.rotate(source[k],*((A.S,A.S,upper) if k==UPPER else (e,elbow,lower))) for k in A.ARM}
        return posed,elbow,A.rotate(A.P,e,elbow,lower),target
    def dynamic_layers(anchor,step):
        key=(anchor,step)
        if key not in cached_dynamic:
            snapshot,_,_=fixed(step);posed,elbow,palm,target=arm_pose(anchor,step)
            layers={k:raster(k,snapshot,posed[k]) for k in A.ARM}
            layers['back']=raster(UPPER,snapshot,posed[UPPER],back_tris)
            layers['front']=raster(UPPER,snapshot,posed[UPPER],front_tris)
            cached_dynamic[key]=(layers,elbow,palm,target)
        return cached_dynamic[key]
    def render(anchor,step,mode):
        snapshot,blocks,protect=fixed(step);layers,elbow,palm,target=dynamic_layers(anchor,step)
        canvas=np.zeros((A.HEIGHT,A.WIDTH,4),np.float32);upper_vis=np.zeros((A.HEIGHT,A.WIDTH),np.float32);front_vis=np.zeros_like(upper_vis)
        for block in blocks:
            if isinstance(block,str):
                key=block
                if key==FRONT:
                    if mode=='base':continue
                    layer=layers[UPPER if mode=='full-raise-diagnostic' else 'front']
                    (x0,y0,x1,y1),rgba=layer;rgba=rgba*(1-protect[y0:y1,x0:x1,None]);layer=((x0,y0,x1,y1),rgba)
                    upper_vis[y0:y1,x0:x1]*=1-rgba[...,3]
                    front_vis[y0:y1,x0:x1]=rgba[...,3]
                else:
                    if key==UPPER and mode=='full-raise-diagnostic':continue
                    layer=layers['back' if key==UPPER and mode=='partition' else key];(x0,y0,x1,y1),rgba=layer
                    if key==UPPER:upper_vis[y0:y1,x0:x1]=rgba[...,3]
                    else:upper_vis[y0:y1,x0:x1]*=1-rgba[...,3]
                    front_vis[y0:y1,x0:x1]*=1-rgba[...,3]
                A.paste(canvas,layer)
            else:
                upper_vis*=1-block[...,3];front_vis*=1-block[...,3];A.over(canvas,block)
        img=A.to_image(canvas)
        return img,{'backVisibleAlphaAreaPx':float(upper_vis.sum()),'frontVisibleAlphaAreaPx':float(front_vis.sum()),
                    'totalUpperVisibleAlphaAreaPx':float(upper_vis.sum()+front_vis.sum()),'elbow':elbow.tolist(),'palm':palm.tolist(),
                    'palmTargetErrorPx':float(np.linalg.norm(palm-target))}
    metrics=[];cut_metrics=[];base_images={};partition_images={}
    # Full-layer promotion is only a rejected/switch-window diagnostic, never a candidate.
    for step in range(17):
        base,base_row=render('old-276-929',step,'base');raised,raised_row=render('old-276-929',step,'full-raise-diagnostic')
        difference=pixel_diff(base,raised);difference.update({'step':step,'hatTouch':step/16,'scope':'Whole Upper front/back switch diagnostic with Cape/Scarf protection; not a proposed rig change'})
        cut_metrics.append(difference);base_images[('old-276-929',step)]=(base,base_row)
    (OUT/'whole-upper-depth-switch-differences.json').write_text(json.dumps(cut_metrics,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'wholeLayerSwitchZeroDifferenceSteps':[r['step'] for r in cut_metrics if r['changedRgbaPixels']==0],
                      'minimumChangedVisibleRgbPixels':min(r['changedVisibleRgbPixels'] for r in cut_metrics)}),flush=True)
    work=[('old-276-929',16),('old-276-929',12),('old-276-929',0),('balanced-288-896',16),('balanced-288-896',12)]
    work += [(anchor,step) for anchor in ANCHORS for step in range(17) if (anchor,step) not in work]
    for anchor,step in work:
        img,row=render(anchor,step,'partition')
        if (anchor,step) not in base_images:base_images[(anchor,step)]=render(anchor,step,'base')
        base,base_row=base_images[(anchor,step)];difference=pixel_diff(base,img)
        opaque_protect=fixed(step)[2]>=1-1e-7
        a=np.asarray(img,dtype=np.int16);b=np.asarray(base,dtype=np.int16)
        row.update({'anchor':anchor,'step':step,'hatTouch':step/16,'differenceFromOriginal72Mesh':difference,
                    'originalUpperVisibleAlphaAreaPx':base_row['totalUpperVisibleAlphaAreaPx'],
                    'opaqueCapeScarfMaximumRgbaByteDifference':int(np.abs(a-b)[opaque_protect].max()) if opaque_protect.any() else 0})
        metrics.append(row)
        if step in KEYS:
            folder=OUT/anchor;folder.mkdir(exist_ok=True)
            img.save(folder/f'hat-{step:02d}-73mesh-partition-CPU-only.png');base.save(folder/f'hat-{step:02d}-72mesh-original-CPU-only.png')
            partition_images[(anchor,step)]=img
            diagnostic=A.with_background(img);dr=ImageDraw.Draw(diagnostic)
            dr.rectangle((0,0,A.WIDTH,40),fill='white');dr.text((10,10),f'CPU ONLY / 73 MESH SAME SOURCE | {anchor} | Hat {step/16:.2f}',fill='black')
            dr.line([tuple(A.S),tuple(row['elbow']),tuple(row['palm'])],fill='#2467dc',width=3)
            diagnostic.save(folder/f'hat-{step:02d}-joint-diagnostic-CPU-only.png')
            print(json.dumps({'ready':str(folder/f'hat-{step:02d}-73mesh-partition-CPU-only.png'),'frontVisibleAlpha':row['frontVisibleAlphaAreaPx'],'neutralOrPoseDifference':difference,'protectedMaxDiff':row['opaqueCapeScarfMaximumRgbaByteDifference']}),flush=True)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
    for step in KEYS:
        sheet=Image.new('RGB',(A.WIDTH//2*4,A.HEIGHT//2+65),'white');dr=ImageDraw.Draw(sheet)
        for i,(anchor,mode) in enumerate([(a,m) for a in ANCHORS for m in ['base','partition']]):
            img=base_images[(anchor,step)][0] if mode=='base' else partition_images[(anchor,step)]
            sheet.paste(A.with_background(img).resize((A.WIDTH//2,A.HEIGHT//2),Image.Resampling.LANCZOS),(i*(A.WIDTH//2),65))
            dr.text((i*(A.WIDTH//2)+8,8),f'{anchor} | {"72 original" if mode=="base" else "73 partition"}',font=font,fill='black')
            dr.text((i*(A.WIDTH//2)+8,32),f'CPU ONLY / HatTouch {step/16:.2f}',font=font,fill='black')
        sheet.save(OUT/f'hat-{step:02d}-fullbody-contact-sheet-CPU-only.png')
    neutral=[r for r in metrics if r['step']==0]
    assert all(r['differenceFromOriginal72Mesh']['changedRgbaPixels']==0 for r in neutral)
    assert all(r['opaqueCapeScarfMaximumRgbaByteDifference']==0 for r in metrics)
    after={str(p):A.sha(p) for p in frozen};assert hashes==after
    report={'scope':'CPU source-texel rendering only, not Core/native model acceptance','sourceLayerCount':72,'cpuMeshCount':73,
            'frontTriangleIndices':eligible,'backTriangleIndices':rejected,
            'frontPolicy':'Constant visible mesh above all four braid layers, below bangs/side hair/hat. Same source texture, UV, rigid parent transform; non-overlapping original triangle sets. No source recolor, scaling, opacity fade, parameter switch, or braid motion.',
            'protectPolicy':'Front premultiplied RGBA is clipped by the complement of actual projected Cape_R plus four Scarf alpha masks. Opaque protected region must remain byte-identical. Semi-transparent protection edges still require visual/native review.',
            'targetPolicy':'Actual captured Lower rigid-fit target at0/.5/1; original Kotlin Bezier formula elsewhere. Other layers retain actual positions/renderOrder; .25 uses neutral outer order and .75 final outer order.',
            'switchWindowDiagnostic':cut_metrics,'zeroDifferenceWholeUpperSwitchSampleSteps':[r['step'] for r in cut_metrics if r['changedRgbaPixels']==0],
            'switchConclusion':'No hard layer-order switch accepted merely from samples; if every sample differs, reject a hard switch.',
            'neutralExactRgbaIdentity':True,'frozenInputsUnchanged':hashes==after,'frozenInputSha256':hashes,'metrics':metrics,
            'limitations':'Only existing native triangles eligible. A newly exposed internal triangle edge can still look artificial despite exact neutral identity. CPU alpha masks and 73 mesh partition are not implemented in a CMO. No new model or Core captures produced.'}
    (OUT/'study-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    write_review_conclusion(report)
    print(str(OUT),flush=True)


if __name__=='__main__':
    if '--volume-donor' in sys.argv:study_connected_subdivision(smooth=True,latest=True,donor=True)
    elif '--freeze-r4-handoff' in sys.argv:freeze_r4_handoff()
    elif '--b14-corridor' in sys.argv:study_connected_subdivision(smooth=True,latest=True)
    elif '--shape-shared' in sys.argv:study_connected_subdivision(smooth=True,shape=True)
    elif '--subdivide-smooth' in sys.argv:study_connected_subdivision(smooth=True)
    elif '--subdivide-connected' in sys.argv:study_connected_subdivision()
    elif '--analyze-expanded' in sys.argv:analyze_connected_eligibility()
    else:main()
