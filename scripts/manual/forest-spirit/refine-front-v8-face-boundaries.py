"""Reassign actual side-cheek cloth from hair ownership, preserving source RGB.

This is a semantic raster revision, not a new face generation or Cubism test.
The locked source and frozen r9 remain read-only. Output is an independent
72-layer metadata revision with original-pixel ownership evidence.
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw

ROOT=Path(__file__).resolve().parents[3]
W,H=971,1620
SOURCE=ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
BASE=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions/b8"

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def poly(points):
    im=Image.new("L",(W,H));ImageDraw.Draw(im).polygon(points,fill=255);return im
def union(a,b):return ImageChops.lighter(a,b)
def inter(a,b):return ImageChops.darker(a,b)
def paintbg(im):
    bg=Image.new("RGBA",im.size,(52,60,52,255));bg.alpha_composite(im);return bg.convert("RGB")
def clear(im):
    a=np.array(im);a[a[:,:,3]==0,:3]=0;return Image.fromarray(a)

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="o2");ap.add_argument("--base",default="output/forest-spirit-production-v2/front-v8/fullbody/arm-study/a6/metadata.json");args=ap.parse_args()
    mp=ROOT/args.base;data=json.loads(mp.read_text(encoding="utf-8"));items={p["id"]:p for p in data["layers"]}
    out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/ownership-study"/args.revision
    assert not (out/"metadata.json").exists(),"Frozen revision must not be overwritten"
    for name in ("layers","masks","source-visible","qa"):(out/name).mkdir(parents=True,exist_ok=True)
    assert sha(SOURCE)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
    src=Image.open(SOURCE).convert("RGBA");source=np.asarray(src);changes={};report=[]
    def resolved(p):return p if p.is_absolute() else mp.parent/p
    def layer(name):return Image.open(resolved(Path(items[name]["path"]))).convert("RGBA")
    face=layer("Face_Base");before_face=face.copy();face_new=np.array(face)
    # Curves traced against the source at 4x: lateral golden fibers remain hair,
    # the continuous soft-pink embroidered facecloth belongs to Face_Base.
    right=[(390,430),(379,442),(370,455),(362,468),(355,483),(352,500),(352,520),(355,537),(360,549),(368,563),(380,577),(395,588),(419,599),(450,607)]
    left=[(665,430),(680,444),(690,460),(696,479),(698,501),(697,522),(692,540),(682,556),(669,568),(649,582),(626,595),(600,604)]
    face_region=poly(right+[(526,623)]+left[::-1]+[(640,375),(411,375)])
    transferred=Image.new("L",(W,H))
    for name,box in [("Hair_Side_R",(325,420,425,620)),("Hair_Side_L",(620,420,720,620))]:
        old=layer(name);own=Image.open(BASE/f"masks/{name}-source-ownership.png").convert("L")
        move=inter(own,face_region);ma=np.asarray(move)>0
        assert ma.any();transferred=union(transferred,move)
        olda=np.array(old);newa=olda.copy();newa[ma]=0
        # Remove hidden fringe behind the reassigned cheek as well. Its old
        # local patch is a source of false facecloth moving with the hair.
        remove=inter(face_region,Image.fromarray((olda[:,:,3]>0).astype(np.uint8)*255))
        newa[np.asarray(remove)>0]=0
        new=Image.fromarray(newa);new.save(out/f"layers/{name}.png");changes[name]=new
        source_own=ImageChops.subtract(own,move);s=src.copy();s.putalpha(inter(source_own,src.getchannel("A")));clear(s).save(out/f"source-visible/{name}.png")
        move.save(out/f"masks/{name}-cheek-to-face.png");source_own.save(out/f"masks/{name}-source-ownership.png");remove.save(out/f"masks/{name}-old-face-fringe-removal.png")
        face_new[ma,:3]=source[ma,:3];face_new[ma,3]=np.where(source[ma,3]>=250,255,source[ma,3])
        contact=Image.new("RGB",(3*(box[2]-box[0]),box[3]-box[1]))
        for i,im in enumerate((src,old,new)):contact.paste(paintbg(im.crop(box)),(i*(box[2]-box[0]),0))
        contact.resize((contact.width*3,contact.height*3)).save(out/f"qa/{name}-source-before-after-300pct.png")
        report.append({"id":name,"transferredSourcePixels":int(ma.sum()),"sourceRgbChanged":0,"oldHiddenFringeRemovedPixels":int(((np.asarray(remove)>0)&~ma).sum()),"review":"source cheek reassigned; hair hidden edge still requires controlled sway coverage review"})
    changes["Face_Base"]=Image.fromarray(face_new);changes["Face_Base"].save(out/"layers/Face_Base.png");transferred.save(out/"masks/Face_Base-received-original-cheek.png")
    # Two bangs had hidden padding below the former Hair_Side order. Moving
    # original cheek pixels behind them would expose those padded pixels; trim
    # precisely this overlap, never any visible original bangs ownership.
    hidden_trim=[]
    for name in ("Hair_Bangs_R","Hair_Bangs_L"):
        im=layer(name);own=Image.open(BASE/f"masks/{name}-source-ownership.png").convert("L")
        cut=inter(transferred,im.getchannel("A"))
        assert not np.any((np.asarray(cut)>0)&(np.asarray(own)>0))
        if np.any(np.asarray(cut)>0):
            im.putalpha(ImageChops.subtract(im.getchannel("A"),cut));im=clear(im);changes[name]=im;im.save(out/f"layers/{name}.png");cut.save(out/f"masks/{name}-cheek-hidden-pad-removal.png")
            hidden_trim.append({"id":name,"trimmedHiddenPixels":int((np.asarray(cut)>0).sum()),"originalVisiblePixelsChanged":0})
    for p in data["layers"]:
        for key in ("path","sourceVisible","sourceMask","uncompletedOcclusionMask"):
            if p.get(key):p[key]=str(resolved(Path(p[key])).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str(resolved(Path(q)).resolve()) for q in p["patchMasks"]]
        if p["id"] in changes:
            p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"]);p["status"]="ORIGINAL_CHEEK_OWNERSHIP_CORRECTION_NOT_MODEL_ACCEPTANCE"
        if p["id"] in ("Hair_Side_L","Hair_Side_R"):
            p["sourceVisible"]=f"source-visible/{p['id']}.png";p["sourceMask"]=f"masks/{p['id']}-source-ownership.png"
    data["status"]="WIP_72_PART_CHEEK_OWNERSHIP_REVISION";data["baseMetadata"]=str(mp);data["baseMetadataSha256"]=sha(mp)
    (out/"metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    # Keep a separate before composite to measure semantic reassignment alone,
    # independently of pre-existing arm edits in this revision's baseline.
    old_data=json.loads(mp.read_text(encoding="utf-8"));before=Image.new("RGBA",(W,H));after=Image.new("RGBA",(W,H))
    for p in sorted(old_data["layers"],key=lambda p:p["order"]):
        if not p.get("visible",True):continue
        old=Image.open(resolved(Path(p["path"]))).convert("RGBA");before.alpha_composite(old);after.alpha_composite(changes.get(p["id"],old))
    before.save(out/"qa/baseline-neutral.png");after.save(out/"qa/neutral-candidate.png")
    delta=np.max(abs(np.asarray(before).astype(int)-np.asarray(after).astype(int)),axis=2)
    audit={"type":"ORIGINAL_PIXEL_OWNERSHIP_REASSIGNMENT_NOT_MODEL_TEST","sourceUnchanged":sha(SOURCE)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e","parts":report,"hiddenPadTrims":hidden_trim,"baselineCompositeChangedPixels":int((delta>0).sum()),"baselineCompositeMaxRgbaDelta":int(delta.max()),"faceReceivedPixels":int((np.asarray(transferred)>0).sum()),"productionAccepted":False,"modelAccepted":False}
    (out/"qa/audit.json").write_text(json.dumps(audit,indent=2),encoding="utf-8");print(json.dumps(audit,indent=2))

if __name__=="__main__":main()
