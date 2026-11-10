"""Independent alpha-only cleanup of artificial red/green boundary specks.

The approved master and frozen b9 remain unmodified. True moss colors, source
RGB, interior material pixels, natural blond fibers, and nonmatching hidden
underpainting are protected. This is an explicit review candidate, not a model.
"""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import label,distance_transform_edt

ROOT=Path(__file__).resolve().parents[3];W,H=971,1620
SRC=ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def onbg(im,color):
    bg=Image.new("RGBA",im.size,(*color,255));bg.alpha_composite(im);return bg.convert("RGB")

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="e1");ap.add_argument("--base",default="output/forest-spirit-production-v2/front-v8/fullbody/revisions/b9/fullbody-with-r9.metadata.json");args=ap.parse_args()
    mp=ROOT/args.base;data=json.loads(mp.read_text(encoding="utf-8"));old=json.loads(json.dumps(data));out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/edge-cleanup"/args.revision
    assert not (out/"metadata.json").exists()
    for d in ("layers","masks","qa"):(out/d).mkdir(parents=True,exist_ok=True)
    src=Image.open(SRC).convert("RGBA");a=np.asarray(src);rgb=a[:,:,:3].astype(int);alpha=a[:,:,3]
    assert sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
    labels,n=label(alpha>=128,structure=np.ones((3,3)));counts=np.bincount(labels.ravel());main=labels==int(np.argmax(counts[1:])+1)
    inside=distance_transform_edt(main);outside=distance_transform_edt(~main)
    r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    green=(g>150)&((g-b)>90)&((g-r)>-15)
    red=(r>150)&((r-g)>65)&((r-b)>45)
    blue=(b>160)&((b-r)>65)&((b-g)>40)
    boundary=inside<=3.5
    contaminated=(green|red|blue)&boundary&(alpha>0)
    # Very faint detached components are removable only if distant from actual
    # foreground; never blanket-delete all low-alpha natural hair/lace edges.
    tiny=np.zeros((H,W),bool);lc,nc=label(alpha>0,structure=np.ones((3,3)));cc=np.bincount(lc.ravel())
    faint_components=[]
    for i in range(1,nc+1):
        if cc[i]>48:continue
        m=lc==i
        if alpha[m].max()<=8 and outside[m].min()>3:
            tiny|=m;y,x=np.where(m);faint_components.append({"bbox":[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)],"pixels":int(m.sum()),"maxAlpha":int(alpha[m].max())})
    target=contaminated|tiny
    Image.fromarray((target*255).astype(np.uint8)).save(out/"masks/source-edge-cleanup-candidate.png")
    Image.fromarray((contaminated*255).astype(np.uint8)).save(out/"masks/artificial-saturated-boundary.png")
    Image.fromarray((tiny*255).astype(np.uint8)).save(out/"masks/faint-detached-components.png")
    Image.fromarray(((inside>3.5)*255).astype(np.uint8)).save(out/"masks/protected-interior.png")
    def resolve(p):return p if p.is_absolute() else mp.parent/p
    before=Image.new("RGBA",(W,H));after=Image.new("RGBA",(W,H));parts=[]
    for p in sorted(data["layers"],key=lambda p:p["order"]):
        path=resolve(Path(p["path"]));im=Image.open(path).convert("RGBA");arr=np.array(im)
        # Remove only the contaminated original-source pixels. A good hidden
        # surface occupying the same coordinate remains available underneath.
        same=np.all(arr[:,:,:3]==a[:,:,:3],axis=2)
        layer_mask=target&same&(arr[:,:,3]>0)
        updated=arr.copy();updated[layer_mask,3]=0
        assert np.array_equal(updated[:,:,:3],arr[:,:,:3])
        assert not np.any(layer_mask&(inside>3.5))
        for key in ("path","sourceVisible","sourceVisiblePath","sourceMask","uncompletedOcclusionMask"):
            if p.get(key):p[key]=str(resolve(Path(p[key])).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str(resolve(Path(q)).resolve()) for q in p["patchMasks"]]
        new=Image.fromarray(updated)
        if layer_mask.any():
            new.save(out/f"layers/{p['id']}.png");Image.fromarray((layer_mask*255).astype(np.uint8)).save(out/f"masks/{p['id']}-alpha-cleanup.png")
            p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"]);p["alphaCleanupMask"]=f"masks/{p['id']}-alpha-cleanup.png"
            parts.append({"id":p["id"],"alphaRemovedPixels":int(layer_mask.sum()),"rgbChangedPixels":0})
        if p.get("visible",True):before.alpha_composite(im);after.alpha_composite(new)
    data["status"]="WIP_ALPHA_ONLY_EDGE_CLEANUP_CANDIDATE";data["baseMetadata"]=str(mp);data["baseMetadataSha256"]=sha(mp);data["sourceMasterChanged"]=False
    (out/"metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    before.save(out/"qa/before.png");after.save(out/"qa/neutral-candidate.png")
    backgrounds={"white":(255,255,255),"dark-green":(30,35,30),"neutral":(220,218,209)}
    for name,color in backgrounds.items():
        b=onbg(before,color);c=onbg(after,color);sheet=Image.new("RGB",(W*2,H));sheet.paste(b,(0,0));sheet.paste(c,(W,0));sheet.save(out/f"qa/{name}-before-after.png")
        c.save(out/f"qa/{name}-cleaned.png")
    boxes={"hat-top":(550,50,760,220),"right-hat-hair":(780,275,935,710),"left-braid":(100,840,235,1000),"skirt-socks":(425,1190,545,1400),"boots":(260,1470,735,1605)}
    for name,box in boxes.items():
        sw,sh=box[2]-box[0],box[3]-box[1];sheet=Image.new("RGB",(sw*3,sh))
        sheet.paste(onbg(before,(20,24,20)).crop(box),(0,0));sheet.paste(Image.fromarray((target*255).astype(np.uint8)).convert("RGB").crop(box),(sw,0));sheet.paste(onbg(after,(20,24,20)).crop(box),(sw*2,0));sheet.resize((sheet.width*2,sheet.height*2)).save(out/f"qa/{name}-before-mask-after-200pct.png")
    lc,nc=label(contaminated,structure=np.ones((3,3)));clusters=[]
    for i in range(1,nc+1):
        m=lc==i;y,x=np.where(m)
        clusters.append({"bbox":[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)],"pixels":int(m.sum()),"alphaRange":[int(alpha[m].min()),int(alpha[m].max())]})
    clusters.sort(key=lambda p:-p["pixels"])
    diff=np.max(abs(np.asarray(before).astype(int)-np.asarray(after).astype(int)),axis=2)
    report={"type":"MASKED_ALPHA_CLEANUP_NOT_MODEL_ACCEPTANCE","sourceUnchanged":sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e","sourceTargetPixels":int(target.sum()),"saturatedRedGreenBlueBoundaryPixels":int(contaminated.sum()),"faintDetachedPixels":int(tiny.sum()),"protectedInteriorTouched":0,"layerRgbPixelsChanged":0,"parts":parts,"compositeChangedPixels":int((diff>0).sum()),"artifactClusters":clusters,"faintComponents":faint_components,"thresholds":{"interiorProtectedDistancePx":3.5,"green":"G>150, G-B>90, G-R>-15","red":"R>150, R-G>65, R-B>45","blue":"B>160, B-R>65, B-G>40","faintDetached":"area<=48, alpha<=8, distance>3px"},"productionAccepted":False,"manualReview":"pending actual three-background inspection","modelAccepted":False}
    (out/"qa/audit.json").write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps({k:report[k] for k in ("sourceTargetPixels","compositeChangedPixels","protectedInteriorTouched","layerRgbPixelsChanged","parts")},indent=2))

if __name__=="__main__":main()
