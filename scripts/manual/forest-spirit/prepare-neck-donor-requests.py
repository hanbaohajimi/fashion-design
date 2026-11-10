"""Prepare registered hidden-only donor requests; never alter frozen art or native models."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_dilation

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    base=Path('output/forest-spirit-production-v2/front-v8');out=base/'fullbody/candidates/b12-neck-local-donor-requests-r3';out.mkdir(parents=True,exist_ok=False)
    meta_path=base/'fullbody/revisions/b11/fullbody-with-r9.metadata.json';meta=json.loads(meta_path.read_text(encoding='utf8'))
    layers={x['id']:x for x in meta['layers']};images={n:np.array(Image.open(meta_path.parent/x['path']).convert('RGBA')) for n,x in layers.items()}
    master_path=base.parent/'front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png'
    master=np.array(Image.open(master_path).convert('RGBA'))
    roi=[300,550,780,800];x0,y0,x1,y1=roi
    old_back=images['Scarf_Back'];trim_path=base/'fullbody/revisions/b12-scarf-s2/layers/Scarf_Back.png';trim=np.array(Image.open(trim_path).convert('RGBA'))
    yy,xx=np.indices(master.shape[:2])
    bounds=((xx>=325)&(xx<=370)&(yy>=565)&(yy<=735))|((xx>=675)&(xx<=755)&(yy>=565)&(yy<=748))
    above=np.zeros(master.shape[:2],dtype=float)
    for item in sorted(meta['layers'],key=lambda x:x['order']):
        if item['order']<=layers['Hair_BackMass']['order'] or not item.get('visible',True):continue
        alpha=images[item['id']][...,3].astype(float)/255*item.get('opacity',1)
        # Predict the proposed trimmed backing. Every allowed hair pixel must still be
        # fully covered at neutral after that trim, rather than only by the removed rectangle.
        if item['id']=='Scarf_Back':alpha=trim[...,3].astype(float)/255
        above=alpha+above*(1-alpha)
    source_visible=np.array(Image.open(meta_path.parent/layers['Hair_BackMass']['sourceVisiblePath']).convert('RGBA'))[...,3]
    # The locked original scarf interior has alpha252..254, not255. This threshold is
    # only a conservative internal donor mask, not an alteration of quality acceptance.
    internal=(master[...,3]>=250)&(above>=1-1e-9)
    hair_allowed=bounds&internal&(source_visible==0)
    # The donor is only hidden material inside the approved foreground. Preserve all
    # original visible pixels, external transparency, tools, and original texture outside it.
    scarf_visible=np.array(Image.open(meta_path.parent/layers['Scarf_Back']['sourceVisiblePath']).convert('RGBA'))[...,3]
    scarf_allowed=(trim[...,3]>0)&(scarf_visible==0)&(master[...,3]>=250)
    requests=[('hair-neck-underlap','Hair_BackMass',hair_allowed,
               'Paint only concealed light-blonde wool hair underlap in the allowed green areas. Continue the adjacent original hair fibre direction and loose curved strands, left and right sides separately. These areas sit behind the head, front side hair and scarf. Keep a soft natural internal overlap without straight triangular strips, repeated tiled texture, skin, new ornaments or white margins. Do not fill any external negative space; outside the registered mask is locked. The output will contribute only within this hidden mask.'),
              ('scarf-back-round-wrap','Scarf_Back',scarf_allowed,
               'Paint the concealed back wrap of the existing brown taupe knitted scarf only inside the allowed mask. Match the original front scarf yarn, subtle embroidered knit pattern, scale, warm brown-grey colour, and soft shaded rounded cloth volume. The existing flat repeated tile is defective. Give side folds coherent curvature and fibre continuation rather than straight rectangular corners, pointed spikes or a repeating wallpaper. Keep the provided silhouette mask; no bow, trailing ribbon, neckline skin, new clothing or exterior negative-space fill. The visible three front rings and character are locked; output is a hidden donor only.')]
    manifest=[]
    context=Image.fromarray(master).crop(tuple(roi));context.save(out/'v8-locked-context.png')
    for name,layer_id,allowed,prompt in requests:
        directory=out/name;directory.mkdir()
        full_mask=(allowed.astype(np.uint8)*255);full_locked=np.where(allowed,0,255).astype(np.uint8)
        Image.fromarray(full_mask).save(directory/'allowed-hidden-mask-full-971x1620.png')
        Image.fromarray(full_locked).save(directory/'locked-mask-full-971x1620.png')
        Image.fromarray(full_mask).crop(tuple(roi)).save(directory/'allowed-hidden-mask.png')
        Image.fromarray(full_locked).crop(tuple(roi)).save(directory/'locked-mask.png')
        Image.fromarray(images[layer_id]).crop(tuple(roi)).save(directory/'current-part.png')
        visible_path=meta_path.parent/layers[layer_id]['sourceVisiblePath']
        Image.open(visible_path).convert('RGBA').crop(tuple(roi)).save(directory/'original-visible-part.png')
        context.save(directory/'locked-context.png')
        guide=np.array(context);a=allowed[y0:y1,x0:x1]
        guide[a,:3]=np.rint(.55*guide[a,:3]+.45*np.array([30,235,120])).astype(np.uint8)
        Image.fromarray(guide).save(directory/'guide-green-allowed.png')
        if layer_id=='Scarf_Back':Image.fromarray(trim).crop(tuple(roi)).save(directory/'proposed-rounded-alpha-guide.png')
        ys,xs=np.where(allowed)
        registration={'schemaVersion':1,'role':'hidden donor request, not production art or accepted model','layerId':layer_id,'canvas':[971,1620],'crop':roi,'cropSize':[x1-x0,y1-y0],'scale':1,'translate':[x0,y0], 'registrationPolicy':'No optical flow or automatic affine alignment; exact crop-origin translation, generated resampling only if required and disclosed. Only the fixed allowed mask can affect source.','allowedPixels':int(allowed.sum()),'allowedBounds':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'master':str(master_path.resolve()),'masterSha256':sha(master_path),'originalLayer':str((meta_path.parent/layers[layer_id]['path']).resolve()),'originalLayerSha256':sha(meta_path.parent/layers[layer_id]['path']),'maskSha256':sha(directory/'allowed-hidden-mask-full-971x1620.png'),'lockedOriginalVisiblePixels':int(np.count_nonzero(np.array(Image.open(visible_path).convert('RGBA'))[...,3])),'sourceInteriorAlphaThreshold':250,'allowedOutsideOpaqueMotherForeground':int(np.count_nonzero(allowed&(master[...,3]<250))),'sourceOrModelModified':False,'dynamicAcceptance':False,'prompt':prompt}
        assert not registration['allowedOutsideOpaqueMotherForeground']
        (directory/'registration.json').write_text(json.dumps(registration,indent=2)+'\n',encoding='utf8');(directory/'PROMPT.txt').write_text(prompt+'\n',encoding='utf8');manifest.append(registration)
    (out/'README.md').write_text('''# Neck boundary hidden donor requests

These are requests, not completed production art. b11/r7/r8 remain immutable.

Both requests use the exact v8 crop `[300,550,780,800]` at **480 x 250 pixels**, translated by `(300,550)` back into the **971 x 1620** source canvas. Use the fixed full-canvas masks when integrating. Do not use generation output as a new master or score reference. All original visible layer pixels and exterior negative space are locked.

1. `hair-neck-underlap`: real blonde fibre underlap for both sides of the scarf. The allowed mask excludes every original Hair_BackMass visible pixel, excludes any exterior transparency, and is fully hidden at neutral even after the proposed Scarf_Back trim. It does not overlap the independently assigned braid-tail patch at y865..982.
2. `scarf-back-round-wrap`: replace the defective tiled hidden backing with a coherent rounded brown knitted wrap, inside its proposed internal alpha silhouette. This layer has zero original source-visible pixels. The previous simple alpha trimming study preserved neutral exactly but exposed gaps at head extremes; it is **not accepted**. The hair underlap and coherent cloth side are needed together.

Required integration evidence: unchanged pixels outside masks; identical 72-part neutral composite; donor registration and sampled source hashes; local mesh coverage on any added hair alpha; native absolute local forms and source sampling coordinates kept separate. Then actual Editor re-rasterization/export and the complete head X/Y/Z x scarf x hair physics endpoint/intermediate matrix. Check scalp/head joins, both scarf edges, skin exposure, original negative spaces, braid/side-hair seams, and left/right head-to-body transitions. A full-layer reparenting study reduced a right gap but caused another left seam; it is not approved or written to a CMO. Use continuous local overlap/deformation at cuts, not a reduced parameter range.

Scarf_Back s1/s2 alpha studies and hair parent study are diagnostic failures/proposals only. No final model or source patch has been accepted here.
''',encoding='utf8')
    (out/'requests.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8');print(json.dumps([{'layer':r['layerId'],'allowedPixels':r['allowedPixels'],'bounds':r['allowedBounds']} for r in manifest],indent=2))

if __name__=='__main__':main()
