"""Match concealed paper/strap illumination using only existing hidden masks."""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter,distance_transform_edt,map_coordinates,binary_dilation

ROOT=Path(__file__).resolve().parents[3];W,H=971,1620
SRC=ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bg(im):
    a=Image.new("RGBA",im.size,(52,60,52,255));a.alpha_composite(im);return a.convert("RGB")

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="h1");ap.add_argument("--base",default="output/forest-spirit-production-v2/front-v8/fullbody/edge-cleanup/e1/metadata.json");args=ap.parse_args()
    mp=ROOT/args.base;d=json.loads(mp.read_text(encoding="utf-8"));old=json.loads(json.dumps(d));out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/hidden-seams"/args.revision
    assert not (out/"metadata.json").exists()
    for name in ("layers","masks","source-visible","qa"):(out/name).mkdir(parents=True,exist_ok=True)
    src=np.asarray(Image.open(SRC).convert("RGBA"));yy,xx=np.mgrid[:H,:W]
    def resolve(p):return p if p.is_absolute() else mp.parent/p
    specs={
      "Tool_Roll_A":(lambda y:724-.25*(y-770),lambda y:766-.27*(y-770),770,28,(675,885,748,980)),
      "Tool_Roll_C":(lambda y:745-.31*(y-850),lambda y:806-.4*(y-850),865,25,(700,892,800,985)),
      "Pouch_Strap":(lambda y:np.interp(y,[722,740,780,820,860,900,940,962],[419,434,469,502,535,570,600,615]),lambda y:np.interp(y,[722,740,780,820,860,900,940,962],[464,477,516,549,580,614,637,643]),750,30,(490,782,580,858)),
    }
    overrides={};reports=[];ownership_updates={}
    items={p["id"]:p for p in d["layers"]}
    for p in d["layers"]:
        if p["id"] not in specs:continue
        name=p["id"];xl,xr,dy,period,box=specs[name]
        im=Image.open(resolve(Path(p["path"]))).convert("RGBA");arr=np.asarray(im);own=np.asarray(Image.open(resolve(Path(p["sourceMask"]))).convert("L"))>0
        region=(xx>=box[0])&(xx<box[2])&(yy>=box[1])&(yy<box[3])
        # Baked occluder shadows belong with the button/rolled lip. Reassign
        # only a narrow traced adjacency band of original pixels, retaining the
        # exact neutral composite; never erase or repaint the original master.
        recipient="Chest_Button" if name=="Pouch_Strap" else "Pouch_Back"
        rec=items[recipient]
        rec_own=ownership_updates.get(recipient,np.asarray(Image.open(resolve(Path(rec["sourceMask"]))).convert("L"))>0)
        radius=5 if name=="Pouch_Strap" else 3
        move=own&region&(arr[:,:,3]>0)&(distance_transform_edt(~rec_own)<=radius)
        rec_im=overrides.get(recipient,Image.open(resolve(Path(rec["path"]))).convert("RGBA"));ra=np.array(rec_im)
        ra[move,:3]=arr[move,:3];ra[move,3]=arr[move,3];overrides[recipient]=Image.fromarray(ra);ownership_updates[recipient]=rec_own|move
        own=own&~move;ownership_updates[name]=own
        Image.fromarray((move*255).astype(np.uint8)).save(out/f"masks/{name}-original-occluder-shadow-to-{recipient}.png")
        hidden=(arr[:,:,3]>0)&~own&region
        sy=dy+(yy-dy)%period;u=np.clip((xx-xl(yy))/np.maximum(xr(yy)-xl(yy),1),.055,.945);sx=xl(sy)+u*(xr(sy)-xl(sy))
        donor=np.stack([map_coordinates(src[:,:,c].astype(float),[sy,sx],order=1,mode="nearest") for c in range(3)],axis=2)
        # Original visible material is the boundary, never a destination. Extend
        # its local low-frequency light and shadow into the concealed donor.
        raw=src[:,:,:3].astype(float)-donor;support=gaussian_filter(own.astype(float),sigma=7)
        smooth=np.stack([gaussian_filter(raw[:,:,c]*own,sigma=7)/np.maximum(support,1e-8) for c in range(3)],axis=2)
        dist,idx=distance_transform_edt(~own,return_indices=True);delta=smooth[idx[0],idx[1]];delta=gaussian_filter(delta,sigma=(4,4,0))
        paintbase=arr[:,:,:3].astype(float).copy();paintbase[move]=donor[move]
        weight=np.exp(-dist/58);corrected=np.clip(np.rint(paintbase+delta*weight[:,:,None]),0,255).astype(np.uint8)
        result=arr.copy();result[hidden,:3]=corrected[hidden]
        assert np.array_equal(result[own],arr[own]) and np.array_equal(result[:,:,3],arr[:,:,3])
        updated=Image.fromarray(result);updated.save(out/f"layers/{name}.png");Image.fromarray((hidden*255).astype(np.uint8)).save(out/f"masks/{name}-hidden-low-frequency-match.png");overrides[name]=updated
        viewbox=(box[0]-12,box[1]-12,box[2]+12,box[3]+12);sw,sh=viewbox[2]-viewbox[0],viewbox[3]-viewbox[1];contact=Image.new("RGB",(sw*3,sh))
        contact.paste(bg(im.crop(viewbox)),(0,0));contact.paste(Image.fromarray((hidden*255).astype(np.uint8)).convert("RGB").crop(viewbox),(sw,0));contact.paste(bg(updated.crop(viewbox)),(sw*2,0));contact.resize((contact.width*3,contact.height*3)).save(out/f"qa/{name}-before-mask-after-300pct.png")
        # Adjacent-pixel seams are diagnostic material statistics, not perception
        # or animation acceptance; natural embroidery can have large gradients.
        border=hidden&binary_dilation(own)
        near=src[idx[0],idx[1],:3].astype(float)
        e0=np.linalg.norm(arr[:,:,:3].astype(float)-near,axis=2)[border];e1=np.linalg.norm(result[:,:,:3].astype(float)-near,axis=2)[border]
        reports.append({"id":name,"roi":box,"hiddenChangedPixels":int((hidden&np.any(result[:,:,:3]!=arr[:,:,:3],axis=2)).sum()),"retainedSourceVisibleRgbaChangedPixels":0,"originalShadowPixelsReassigned":int(move.sum()),"shadowRecipient":recipient,"adjacencyRadiusPx":radius,"alphaChangedPixels":0,"boundaryRgbDistanceMedianBefore":float(np.median(e0)) if e0.size else None,"boundaryRgbDistanceMedianAfter":float(np.median(e1)) if e1.size else None,"method":"original narrow shadow pixels reassigned to occluder; continuous native material below; hidden low-frequency boundary match; no original neutral pixels lost","status":"local_material_candidate_pending_native_review"})
    for name,im in overrides.items():im.save(out/f"layers/{name}.png")
    for name,mask in ownership_updates.items():
        Image.fromarray((mask*255).astype(np.uint8)).save(out/f"masks/{name}-source-ownership.png")
        sv=src.copy();sv[~mask]=0;Image.fromarray(sv).save(out/f"source-visible/{name}.png")
    for p in d["layers"]:
        for key in ("path","sourceVisible","sourceVisiblePath","sourceMask","uncompletedOcclusionMask","alphaCleanupMask"):
            if p.get(key):p[key]=str(resolve(Path(p[key])).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str(resolve(Path(q)).resolve()) for q in p["patchMasks"]]
        if p["id"] in overrides:
            p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"])
            if p["id"] in specs:p["hiddenBlendMask"]=f"masks/{p['id']}-hidden-low-frequency-match.png";p.setdefault("patchMasks",[]).append(p["hiddenBlendMask"])
        if p["id"] in ownership_updates:
            p["sourceMask"]=f"masks/{p['id']}-source-ownership.png";p["sourceVisible"]=f"source-visible/{p['id']}.png";p["sourceVisiblePath"]=p["sourceVisible"]
    before=Image.new("RGBA",(W,H));after=Image.new("RGBA",(W,H))
    for p in sorted(old["layers"],key=lambda p:p["order"]):
        if not p.get("visible",True):continue
        im=Image.open(resolve(Path(p["path"]))).convert("RGBA");before.alpha_composite(im);after.alpha_composite(overrides.get(p["id"],im))
    before.save(out/"qa/baseline-neutral.png");after.save(out/"qa/neutral-candidate.png");diff=np.max(abs(np.asarray(before).astype(int)-np.asarray(after).astype(int)),axis=2)
    report={"type":"HIDDEN_ONLY_MATERIAL_BOUNDARY_MATCH_NOT_MODEL","sourceUnchanged":sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e","parts":reports,"neutralRgbaChangedPixels":int((diff>0).sum()),"neutralMaxRgbaDelta":int(diff.max()),"productionAccepted":False,"modelAccepted":False}
    d["status"]="WIP_B10_CANDIDATE_ALPHA_CLEANUP_AND_HIDDEN_MATERIAL_MATCH";d["baseMetadata"]=str(mp);d["baseMetadataSha256"]=sha(mp);d["localHiddenBoundaryReview"]=report
    (out/"metadata.json").write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding="utf-8");(out/"qa/audit.json").write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps(report,indent=2))

if __name__=="__main__":main()
