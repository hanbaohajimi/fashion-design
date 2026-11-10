"""Remove exposed a6 hidden skirt fill outside the locked neutral silhouette."""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[3];W,H=971,1620
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bg(im):
    b=Image.new("RGBA",im.size,(24,30,24,255));b.alpha_composite(im);return b.convert("RGB")
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="e2");args=ap.parse_args()
    mp=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions/b10/fullbody-with-r9.metadata.json";d=json.loads(mp.read_text(encoding="utf-8"))
    out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/edge-cleanup"/args.revision
    assert not (out/"metadata.json").exists()
    for name in ("layers","masks","qa"):(out/name).mkdir(parents=True,exist_ok=True)
    source=Image.open(ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png").convert("RGBA");sa=np.asarray(source)
    before=Image.new("RGBA",(W,H));after=Image.new("RGBA",(W,H));report=[]
    def resolve(p):return p if p.is_absolute() else mp.parent/p
    for p in d["layers"]:
        im=Image.open(resolve(Path(p["path"]))).convert("RGBA");a=np.asarray(im);new=im
        for key in ("path","sourceVisible","sourceVisiblePath","sourceMask","uncompletedOcclusionMask","alphaCleanupMask","hiddenBlendMask"):
            if p.get(key):p[key]=str(resolve(Path(p[key])).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str(resolve(Path(q)).resolve()) for q in p["patchMasks"]]
        if p["id"]=="Skirt_Petal_Side_R":
            own=np.asarray(Image.open(p["sourceMask"]).convert("L"))>0
            remove=(a[:,:,3]>0)&~own&(sa[:,:,3]<250)
            updated=a.copy();updated[remove,3]=0;assert np.array_equal(updated[own],a[own]) and np.array_equal(updated[:,:,:3],a[:,:,:3])
            new=Image.fromarray(updated);new.save(out/f"layers/{p['id']}.png");Image.fromarray((remove*255).astype(np.uint8)).save(out/"masks/Skirt_Petal_Side_R-exposed-hidden-overfill.png")
            p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"]);p["alphaCleanupMask"]="masks/Skirt_Petal_Side_R-exposed-hidden-overfill.png";p["patchMasks"].append(p["alphaCleanupMask"])
            y,x=np.where(remove);report.append({"id":p["id"],"removedHiddenOverfillPixels":int(remove.sum()),"bbox":[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)],"sourceVisibleRgbaChangedPixels":0,"layerRgbChangedPixels":0,"cause":"a6 skirt completion polygon extended hidden opaque paint outside the original neutral silhouette; not a defect of the source master"})
        if p.get("visible",True):before.alpha_composite(im);after.alpha_composite(new)
    before.save(out/"qa/baseline-neutral.png");after.save(out/"qa/neutral-candidate.png")
    box=(120,1000,285,1210);sw,sh=165,210;contact=Image.new("RGB",(sw*4,sh));mask=Image.open(out/"masks/Skirt_Petal_Side_R-exposed-hidden-overfill.png")
    for i,im in enumerate((bg(source),bg(before),mask.convert("RGB"),bg(after))):contact.paste(im.crop(box),(sw*i,0))
    contact.resize((contact.width*3,contact.height*3)).save(out/"qa/left-skirt-source-before-mask-after-300pct.png")
    for name,color in {"white":(255,255,255),"pale-green":(224,234,216),"deep-green":(26,53,37)}.items():
        b=Image.new("RGBA",(W,H),(*color,255));b.alpha_composite(after);b.convert("RGB").save(out/f"qa/{name}-cleaned.png")
    pa=np.asarray(after)[:,:,3];before_extra=(np.asarray(before)[:,:,3]>16)&(sa[:,:,3]<=16);after_extra=(pa>16)&(sa[:,:,3]<=16)
    audit={"type":"EXPOSED_HIDDEN_FILL_CORRECTION_NOT_MODEL_TEST","parts":report,"extraNeutralForegroundPixelsBefore":int(before_extra.sum()),"extraNeutralForegroundPixelsAfter":int(after_extra.sum()),"sourceMasterChanged":False,"b9Changed":False,"b10Changed":False,"productionAccepted":False,"modelAccepted":False}
    d["status"]="WIP_B11_CANDIDATE_CORRECTED_EXPOSED_SKIRT_FILL";d["baseMetadata"]=str(mp);d["baseMetadataSha256"]=sha(mp);d["exposedHiddenFillCorrection"]=audit
    (out/"metadata.json").write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding="utf-8");(out/"qa/audit.json").write_text(json.dumps(audit,indent=2),encoding="utf-8");print(json.dumps(audit,indent=2))
if __name__=="__main__":main()
