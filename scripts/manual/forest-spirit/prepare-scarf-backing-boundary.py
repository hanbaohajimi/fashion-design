"""Hidden-alpha-only scarf backing boundary candidate, with source-coordinate evidence.

Original RGB / visible art / rig / master are immutable. CPU pose diagnostics are not Core.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from scipy.interpolate import PchipInterpolator
_spec=importlib.util.spec_from_file_location('scarf_ownership',Path(__file__).with_name('inspect-scarf-source-ownership.py'))
_ownership=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ownership)
raster_layer=_ownership.raster_layer

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--shape',choices=['rings','tube'],default='rings');args=parser.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=False)
    base=Path('output/forest-spirit-production-v2/front-v8')
    metadata=base/'fullbody/revisions/b11/fullbody-with-r9.metadata.json'
    meta=json.loads(metadata.read_text(encoding='utf8'));layers=meta['layers']
    pixels={x['id']:np.asarray(Image.open(metadata.parent/x['path']).convert('RGBA')).copy() for x in layers}
    old=pixels['Scarf_Back'];union=np.maximum.reduce([pixels[f'Scarf_{x}'][...,3] for x in ['Upper','Middle','Lower']])>0
    # The backing remains within the three authored scarf rings plus a 2px support overlap.
    # Its original central neck coverage is retained (Neck bbox + 10px), no skin is removed.
    neck=pixels['Neck'][...,3]>0
    keep=np.minimum(distance_transform_edt(~union),distance_transform_edt(~neck)-10)
    factor=np.clip(3-keep,0,1)
    if args.shape=='tube':
        # A smooth hidden wrap silhouette retains support outside the front rings. This is
        # recorded geometry of a hidden-art candidate, never a replacement scoring master.
        ys=np.array([565,580,600,620,640,660,680,700,720,725])
        left=np.array([352,350,348,346,344,342,339,337,345,355])
        right=np.array([688,690,692,694,696,698,702,706,701,695])
        yy,xx=np.indices(old.shape[:2]);l=PchipInterpolator(ys,left)(np.clip(yy,565,725));r=PchipInterpolator(ys,right)(np.clip(yy,565,725))
        factor=np.clip(np.minimum(xx+.5-l,r-(xx+.5)),0,1)
    new=old.copy();new[...,3]=np.minimum(old[...,3],np.rint(old[...,3]*factor).astype(np.uint8))
    changed=new[...,3]!=old[...,3]
    visible_path=metadata.parent/next(x['sourceVisiblePath'] for x in layers if x['id']=='Scarf_Back')
    visible=np.asarray(Image.open(visible_path).convert('RGBA'))[...,3]
    assert np.array_equal(old[...,:3],new[...,:3])
    assert not np.any(changed&(visible>0))
    (out/'layers').mkdir();(out/'masks').mkdir();(out/'qa').mkdir()
    Image.fromarray(new).save(out/'layers/Scarf_Back.png')
    Image.fromarray(changed.astype(np.uint8)*255).save(out/'masks/Scarf_Back-hidden-alpha-removal.png')
    def composite(replacement=None):
        canvas=Image.new('RGBA',(971,1620))
        for x in sorted(layers,key=lambda v:v['order']):
            if not x.get('visible',True):continue
            p=(replacement if x['id']=='Scarf_Back' and replacement is not None else pixels[x['id']]).copy()
            p[...,3]=np.rint(p[...,3]*float(x.get('opacity',1))).astype(np.uint8)
            canvas=Image.alpha_composite(canvas,Image.fromarray(p))
        return np.asarray(canvas)
    before=composite();after=composite(new)
    Image.fromarray(after).save(out/'qa/72-part-neutral-candidate.png')
    ys,xs=np.where(changed)
    checks={'originalRgbUnchanged':bool(np.array_equal(old[...,:3],new[...,:3])),
            'sourceVisiblePixelsUnchanged':not bool(np.any(changed&(visible>0))),
            '72PartNeutralRgbaExactlyUnchanged':bool(np.array_equal(before,after)),
            'centralNeckSupportFullyRetained':bool(np.array_equal(new[...,3][neck],old[...,3][neck]))}
    capture=base/'validation/full-b11-rig-uv-r7-parameter-matrix-r1'
    root=ET.parse(base/'validation/full-b11-native-physics-r8-audit-r1/r8-main.xml').getroot();sampling={}
    for e in root.iter('CArtMeshSource'):
        if not e.get('xs.id'):continue
        name=next(n.text for n in e.iter('s') if n.get('xs.n')=='localName')
        sampling[name]=np.fromstring(next(n.text for n in e if n.get('xs.n')=='positions'),sep=' ')
    roi=[290,565,775,795];pose_rows=[]
    for state in ['neutral','head-y-1-z-1-s-1-e1','head-y1-z1-s1-e1']:
        doc=json.loads((capture/(state+'.json')).read_text(encoding='utf8'))
        composed=np.zeros((roi[3]-roi[1],roi[2]-roi[0],4));old_composed=np.zeros_like(composed)
        for d in sorted(doc['drawables'],key=lambda v:v['renderOrder']):
            if d['opacity']<=0:continue
            a=raster_layer(d,sampling[d['id']],pixels[d['id']],roi)
            b=raster_layer(d,sampling[d['id']],pixels[d['id']],roi,new) if d['id']=='Scarf_Back' else a
            old_composed=a+old_composed*(1-a[...,3:4]);composed=b+composed*(1-b[...,3:4])
        alpha_loss=old_composed[...,3]-composed[...,3]
        rgba=np.concatenate([np.divide(composed[...,:3],composed[...,3:4],out=np.zeros_like(composed[...,:3]),where=composed[...,3:4]>0),composed[...,3:4]],axis=-1)
        rendered=Image.fromarray(np.clip(np.rint(rgba*255),0,255).astype(np.uint8))
        rendered.save(out/f'qa/{state}--CPU-candidate.png')
        actual=Image.open(capture/(state+'.png')).convert('RGBA').crop(tuple(roi));bg=Image.new('RGBA',actual.size,(26,53,37,255))
        panel=Image.new('RGB',(actual.width*2,actual.height+24),'white');panel.paste(Image.alpha_composite(bg,actual),(0,24));panel.paste(Image.alpha_composite(bg,rendered),(actual.width,24));draw=ImageDraw.Draw(panel);draw.text((4,5),'Actual r7 Core before',(0,0,0));draw.text((actual.width+4,5),'Predicted hidden-alpha repair (CPU, not Core)',(0,0,0));panel.save(out/f'qa/{state}--comparison.png')
        pose_rows.append({'state':state,'cpuPixelsAlphaDropOverPointOne':int(np.count_nonzero(alpha_loss>.1)),'cpuLargestAlphaDrop':float(alpha_loss.max())})
    report={'scope':'Hidden-alpha-only Scarf_Back production candidate; no native CMO or Core approval','shape':args.shape,'baseMetadata':str(metadata.resolve()),'baseMetadataSha256':sha(metadata),'source':str((metadata.parent/'layers/Scarf_Back.png').resolve()),'sourceSha256':sha(metadata.parent/'layers/Scarf_Back.png'),'candidate':str((out/'layers/Scarf_Back.png').resolve()),'candidateSha256':sha(out/'layers/Scarf_Back.png'),'changedAlphaPixels':int(changed.sum()),'changedAlphaBounds':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'checks':checks,'poses':pose_rows,'parametersOrRigChanged':False,'sourceSamplingCoordinatesChanged':False,'nativeExportRequired':True,'remainingRisks':['CPU preview only; retained existing triangles and real official atlas must be rerasterized after texture update','Actual all head/scarf combinations, neck coverage, and source/material continuity still require native export review']}
    (out/'scarf-boundary-candidate-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps(report,indent=2))
    assert all(checks.values())

if __name__=='__main__':main()
