"""Read-only source ownership diagnostic from actual Core triangles and native canvas samples.

CPU reconstruction is a diagnostic, not a new actual Editor/Core render or acceptance.
"""
from pathlib import Path
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def raster_layer(drawable, sampling, pixels, roi, replacement=None):
    x0,y0,x1,y1=roi
    image=np.zeros((y1-y0,x1-x0,4),dtype=np.float64)
    world=np.array(drawable['vertexPositions'],dtype=float).reshape(-1,2)
    world=world*np.array([971,-971])+np.array([485.5,810])
    source=sampling.reshape(-1,2)
    if len(source)!=len(world): raise ValueError(drawable['id'])
    image_source=pixels if replacement is None else replacement
    for ix in np.array(drawable['vertexIndices']).reshape(-1,3):
        p=world[ix];s=source[ix]
        lo=np.maximum(np.floor(p.min(axis=0)).astype(int),[x0,y0])
        hi=np.minimum(np.ceil(p.max(axis=0)).astype(int),[x1,y1])
        if np.any(hi<=lo): continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0])+.5,np.arange(lo[1],hi[1])+.5)
        d=p[1:]-p[0];det=d[0,0]*d[1,1]-d[1,0]*d[0,1]
        if abs(det)<1e-9: continue
        v=((xx-p[0,0])*d[1,1]-(yy-p[0,1])*d[1,0])/det
        w=((yy-p[0,1])*d[0,0]-(xx-p[0,0])*d[0,1])/det
        inside=(v>=-1e-8)&(w>=-1e-8)&(v+w<=1+1e-8)
        sx=s[0,0]+v*(s[1,0]-s[0,0])+w*(s[2,0]-s[0,0])-.5
        sy=s[0,1]+v*(s[1,1]-s[0,1])+w*(s[2,1]-s[0,1])-.5
        ax=np.floor(sx).astype(int);ay=np.floor(sy).astype(int);fx=sx-ax;fy=sy-ay
        sample=np.zeros(xx.shape+(4,),dtype=float)
        # Premultiplied alpha interpolation avoids diagnostic-only dark fringes.
        for dx,dy,weight in [(0,0,(1-fx)*(1-fy)),(1,0,fx*(1-fy)),(0,1,(1-fx)*fy),(1,1,fx*fy)]:
            cx=np.clip(ax+dx,0,image_source.shape[1]-1);cy=np.clip(ay+dy,0,image_source.shape[0]-1)
            values=image_source[cy,cx].astype(float)/255
            values[...,:3]*=values[...,3:4]
            sample+=values*weight[...,None]
        sample*=float(drawable['opacity'])
        tile=image[lo[1]-y0:hi[1]-y0,lo[0]-x0:hi[0]-x0]
        tile[inside]=sample[inside]
    return image

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);ap.add_argument('--geometry-study');ap.add_argument('--scarf-replacement');ap.add_argument('--hair-replacement');ap.add_argument('--upper-replacement');ap.add_argument('--cape-replacement');ap.add_argument('--sampling-plan');ap.add_argument('--metadata');ap.add_argument('--native-geometry');ap.add_argument('--capture');ap.add_argument('--states',default='neutral,head-y-1-z-1-s-1-e1,head-y1-z1-s1-e1');ap.add_argument('--actual-label',default='ACTUAL Core r7');args=ap.parse_args()
    base=Path('output/forest-spirit-production-v2/front-v8')
    out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
    metadata=Path(args.metadata) if args.metadata else base/'fullbody/revisions/b11/fullbody-with-r9.metadata.json'
    layers=json.loads(metadata.read_text(encoding='utf8'))['layers']
    source={x['id']:metadata.parent/x['path'] for x in layers}
    if args.scarf_replacement:source['Scarf_Back']=Path(args.scarf_replacement)
    if args.hair_replacement:source['Hair_BackMass']=Path(args.hair_replacement)
    if args.upper_replacement:source['Arm_R_Upper']=Path(args.upper_replacement)
    if args.cape_replacement:source['Cape_R']=Path(args.cape_replacement)
    sampling={}
    if args.native_geometry:
        native=json.loads(Path(args.native_geometry).read_text(encoding='utf8'))
        if sha(Path(native['source'])) != native['sourceSha256']:raise ValueError('Native geometry source SHA changed')
        sampling={d['id']:np.asarray(d['positions']) for d in native['drawables']}
    else:
        root=ET.parse(base/'validation/full-b11-native-physics-r8-audit-r1/r8-main.xml').getroot()
        for e in root.iter('CArtMeshSource'):
            if not e.get('xs.id'):continue
            name=next(n.text for n in e.iter('s') if n.get('xs.n')=='localName')
            sampling[name]=np.fromstring(next(n.text for n in e if n.get('xs.n')=='positions'),sep=' ')
    if args.sampling_plan:
        plan=json.loads(Path(args.sampling_plan).read_text(encoding='utf8'));sampling[plan['id']]=np.asarray(plan['positions'])
    roi=[290,565,775,795];rows=[]
    capture=Path(args.capture) if args.capture else base/'validation/full-b11-rig-uv-r7-parameter-matrix-r1'
    states=args.states.split(',')
    assert states and all(name and all(c.isalnum() or c in '-_' for c in name) for name in states)
    for state in states:
        geometry_path=(Path(args.geometry_study) if args.geometry_study else capture)/(state+'.json')
        doc=json.loads(geometry_path.read_text(encoding='utf8'))
        composed=np.zeros((roi[3]-roi[1],roi[2]-roi[0],4))
        owner=np.full(composed.shape[:2],-1,dtype=np.int16)
        contributions={};order=[]
        for idx,d in enumerate(sorted(doc['drawables'],key=lambda x:x['renderOrder'])):
            order.append(d['id'])
            if d['opacity']<=0:continue
            pixels=np.asarray(Image.open(source[d['id']]).convert('RGBA'))
            layer=raster_layer(d,sampling[d['id']],pixels,roi)
            composed=layer+composed*(1-layer[...,3:4])
            owner[layer[...,3]>.5]=idx
            if d['id'].startswith(('Scarf','Hair','Braid','Face','Ear','Neck')):
                a=np.zeros_like(layer);a[...,:3]=np.divide(layer[...,:3],layer[...,3:4],out=np.zeros_like(layer[...,:3]),where=layer[...,3:4]>0);a[...,3]=layer[...,3]
                Image.fromarray(np.clip(np.rint(a*255),0,255).astype('uint8')).save(out/f'{state}--{d["id"]}.png')
        rgba=np.concatenate([np.divide(composed[...,:3],composed[...,3:4],out=np.zeros_like(composed[...,:3]),where=composed[...,3:4]>0),composed[...,3:4]],axis=-1)
        Image.fromarray(np.clip(np.rint(rgba*255),0,255).astype('uint8')).save(out/f'{state}--cpu-diagnostic.png')
        np.save(out/f'{state}--top-owner.npy',owner)
        for idx,name in enumerate(order):
            count=int(np.count_nonzero(owner==idx))
            if count:contributions[name]=count
        (out/f'{state}--owner-ids.json').write_text(json.dumps(order,indent=2)+'\n',encoding='utf8')
        actual=Image.open(capture/(state+'.png')).convert('RGBA').crop(tuple(roi))
        actual.save(out/f'{state}--actual-Core-crop.png')
        background=Image.new('RGBA',actual.size,(26,53,37,255))
        panel=Image.new('RGB',(actual.width*2,actual.height+24),'white')
        panel.paste(Image.alpha_composite(background,actual).convert('RGB'),(0,24))
        panel.paste(Image.alpha_composite(background,Image.open(out/f'{state}--cpu-diagnostic.png')).convert('RGB'),(actual.width,24))
        draw=ImageDraw.Draw(panel);draw.text((5,5),args.actual_label,(0,0,0));draw.text((actual.width+5,5),'CPU source ownership diagnostic (not Core)',(0,0,0));panel.save(out/f'{state}--comparison.png')
        rows.append({'state':state,'visibleOwners':contributions,'geometryPath':str(geometry_path),'geometrySha256':sha(geometry_path),'originalActualSnapshotSha256':sha(capture/(state+'.json'))})
    (out/'report.json').write_text(json.dumps({'scope':'Read-only CPU source ownership diagnostic, not native export or actual Core rendering','geometryStudy':args.geometry_study,'scarfReplacement':args.scarf_replacement,'upperReplacement':args.upper_replacement,'capeReplacement':args.cape_replacement,'metadata':str(metadata),'metadataSha256':sha(metadata),'nativeGeometry':args.native_geometry,'capture':str(capture),'roi':roi,'rows':rows},indent=2)+'\n',encoding='utf8')
    print(json.dumps(rows,indent=2))

if __name__=='__main__':main()
