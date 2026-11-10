"""Continuous paper rolls and clean strap ownership, from locked v8 pixels.

Hidden texture extends original material along its local axis. Source-visible
pixels are preserved or reassigned with masks. This produces a real 72-layer
WIP input for native binding; it does not certify a pose or a finished model.
"""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageChops,ImageDraw
from scipy.ndimage import map_coordinates,label

ROOT=Path(__file__).resolve().parents[3];W,H=971,1620
SRC=ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
BASE=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions/b8"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def poly(points):
    m=Image.new("L",(W,H));ImageDraw.Draw(m).polygon(points,fill=255);return m
def union(a,b):return ImageChops.lighter(a,b)
def inter(a,b):return ImageChops.darker(a,b)
def sub(a,b):return ImageChops.subtract(a,b)
def binary(a):return a.point(lambda v:255 if v else 0)
def clear(im):
    a=np.array(im);a[a[:,:,3]==0,:3]=0;return Image.fromarray(a)
def bg(im):
    b=Image.new("RGBA",im.size,(52,60,52,255));b.alpha_composite(im);return b.convert("RGB")

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="p1");ap.add_argument("--base",default="output/forest-spirit-production-v2/front-v8/fullbody/ownership-study/o3/metadata.json");args=ap.parse_args()
    mp=ROOT/args.base;data=json.loads(mp.read_text(encoding="utf-8"));original_data=json.loads(json.dumps(data));items={p["id"]:p for p in data["layers"]}
    out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/pouch-study"/args.revision
    assert not (out/"metadata.json").exists(),"Use a new revision"
    for d in ("layers","masks","source-visible","qa"):(out/d).mkdir(parents=True,exist_ok=True)
    source=Image.open(SRC).convert("RGBA");sa=np.asarray(source);normal=source.getchannel("A").point(lambda v:255 if v>=250 else v)
    assert sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
    def resolve(q):return q if q.is_absolute() else mp.parent/q
    def get(name):return Image.open(resolve(Path(items[name]["path"]))).convert("RGBA")
    def own(name):return Image.open(BASE/f"masks/{name}-source-ownership.png").convert("L")
    overrides={};own_overrides={};reports=[]
    yy,xx=np.mgrid[:H,:W]
    def axial_texture(left,right,donor_y,period):
        # Native axial sampling, no resize of the original character. Preserve
        # relative position across the original cylindrical/lighted strip.
        sy=donor_y+(yy-donor_y)%period
        u=np.clip((xx-left(yy))/np.maximum(right(yy)-left(yy),1),.055,.945)
        sx=left(sy)+u*(right(sy)-left(sy))
        colors=np.stack([map_coordinates(sa[:,:,c].astype(float),[sy,sx],order=1,mode="nearest") for c in range(3)],axis=2)
        return np.clip(np.rint(colors),0,255).astype(np.uint8)
    def save_source(name,mask):
        im=source.copy();im.putalpha(inter(mask,source.getchannel("A")));clear(im).save(out/f"source-visible/{name}.png");mask.save(out/f"masks/{name}-source-ownership.png");own_overrides[name]=mask
    # Remove cream bodice stitches and green scraps outside the actual brown
    # strap, not by globally recoloring or erasing the source character.
    left=lambda y:np.interp(y,[722,740,780,820,860,900,940,962],[419,434,469,502,535,570,600,615])
    right=lambda y:np.interp(y,[722,740,780,820,860,900,940,962],[464,477,516,549,580,614,637,643])
    shape=poly([(int(left(y)),y) for y in range(722,963,2)]+[(int(right(y)),y) for y in range(962,721,-2)])
    strap_own=own("Pouch_Strap");buckle=inter(strap_own,poly([(589,921),(632,921),(632,962),(589,962)]));shape=union(shape,buckle)
    foreign=sub(strap_own,shape);kept=sub(strap_own,foreign)
    bodice=get("Bodice_Olive");ba=np.array(bodice);fm=np.asarray(foreign)>0;ba[fm,:3]=sa[fm,:3];ba[fm,3]=np.asarray(normal)[fm]
    overrides["Bodice_Olive"]=Image.fromarray(ba);foreign.save(out/"masks/Pouch_Strap-foreign-cloth-to-bodice.png")
    cloth_own=union(own("Bodice_Olive"),foreign);save_source("Bodice_Olive",cloth_own)
    # Former higher strap ownership hid lower-layer padding. Removing such
    # padding exactly on the transferred source mask keeps the neutral intact.
    for p in data["layers"]:
        if items["Bodice_Olive"]["order"]<p["order"]<items["Pouch_Strap"]["order"]:
            im=get(p["id"]);cut=inter(foreign,im.getchannel("A"))
            if np.any(np.asarray(cut)>0):
                im.putalpha(sub(im.getchannel("A"),cut));overrides[p["id"]]=clear(im);cut.save(out/f"masks/{p['id']}-transferred-cloth-hidden-pad-trim.png")
    high=Image.new("L",(W,H))
    for p in data["layers"]:
        if p.get("visible",True) and p["order"]>items["Pouch_Strap"]["order"]:high=union(high,get(p["id"]).getchannel("A").point(lambda v:255 if v>=250 else 0))
    # Neckline is covered by scarf despite its earlier draw order: keep only a
    # short hidden 6-pixel root, then the body's original strap contour.
    neckline=inter(shape,poly([(419,726),(474,726),(474,738),(419,738)]))
    hidden=inter(sub(shape,kept),high)
    colors=axial_texture(left,right,750,30);result=np.zeros((H,W,4),np.uint8);hm=np.asarray(hidden)>0;km=np.asarray(kept)>0
    result[hm,:3]=colors[hm];result[hm,3]=255;result[km,:3]=sa[km,:3];result[km,3]=np.asarray(normal)[km]
    overrides["Pouch_Strap"]=Image.fromarray(result);save_source("Pouch_Strap",kept);hidden.save(out/"masks/Pouch_Strap-continuous-hidden-leather.png")
    reports.append({"id":"Pouch_Strap","foreignOriginalPixelsMovedToBodice":int(fm.sum()),"sourceVisibleRgbChanged":0,"hiddenPaintPixels":int(hm.sum()),"method":"original native leather sampled along strap axis, hidden only; no extra layer"})
    # Complete each original roll below its opening. Its visible opening/rim and
    # original print remain untouched. All three retain separate stable IDs.
    roll_params={
      "Tool_Roll_A":(lambda y:724-.25*(y-770),lambda y:766-.27*(y-770),750,976,770,28),
      "Tool_Roll_B":(lambda y:767-.27*(y-770),lambda y:822-.42*(y-770),770,980,779,30),
      "Tool_Roll_C":(lambda y:745-.31*(y-850),lambda y:806-.4*(y-850),850,982,865,25),
    }
    front=get("Pouch_Front");fa=np.array(front);front_own=own("Pouch_Front")
    # This ID contains the visible rolled front lip in the actual source. Its
    # lip must occlude the paper roots. Retain its name, document corrected real
    # draw order, and remove only former hidden padding over original tools.
    back=get("Pouch_Back");original_tools=Image.new("L",(W,H))
    for tool in ("Tool_Roll_A","Tool_Roll_B","Tool_Roll_C","Tool_Scissors"):original_tools=union(original_tools,own(tool))
    back.putalpha(sub(back.getchannel("A"),original_tools));overrides["Pouch_Back"]=clear(back)
    back_own=own("Pouch_Back")
    items["Pouch_Back"]["order"]=1335;items["Pouch_Back"]["drawOrderReason"]="Source ID includes rolled front lip, which occludes continuous tool roots; hidden pad over original tool pixels removed."
    for name,(xl,xr,y0,y1,dy,period) in roll_params.items():
        original=own(name);valid=original.copy();misowned=Image.new("L",(W,H))
        if name=="Tool_Roll_A":
            components,n=label(np.asarray(original)>0);sizes=np.bincount(components.ravel());major=int(np.argmax(sizes[1:])+1)
            mm=(components>0)&(components!=major);m=Image.fromarray(mm.astype(np.uint8)*255);valid=sub(original,m)
            scissors=overrides.get("Tool_Scissors",get("Tool_Scissors"));sc=np.array(scissors);sc[mm,:3]=sa[mm,:3];sc[mm,3]=np.asarray(normal)[mm];overrides["Tool_Scissors"]=Image.fromarray(sc)
            save_source("Tool_Scissors",union(own("Tool_Scissors"),m));m.save(out/"masks/Tool_Roll_A-scissor-shadow-original-pixels.png")
        if name=="Tool_Roll_B":
            # Disconnected brown lip beneath the roll is the pouch, not a second
            # paper island. Keep its actual original pixels on the front lip.
            components,n=label(np.asarray(original)>0);sizes=np.bincount(components.ravel());major=int(np.argmax(sizes[1:])+1)
            mm=(components>0)&(components!=major)&(yy>=900)
            misowned=Image.fromarray(mm.astype(np.uint8)*255);valid=sub(original,misowned)
            fa[mm,:3]=sa[mm,:3];fa[mm,3]=np.asarray(normal)[mm];front_own=union(front_own,misowned)
            overrides["Pouch_Front"]=Image.fromarray(fa)
        # Brown rolled-lip pixels at the original insertion boundary must move
        # with the pouch rather than remain a horizontal stripe on the paper.
        lip=(np.asarray(valid)>0)&(yy>=902)&(sa[:,:,0]<195)&(sa[:,:,1]<160)&((sa[:,:,0].astype(int)-sa[:,:,2])>45)
        lipmask=Image.fromarray(lip.astype(np.uint8)*255);valid=sub(valid,lipmask)
        if lip.any():
            backarray=np.array(overrides["Pouch_Back"]);backarray[lip,:3]=sa[lip,:3];backarray[lip,3]=np.asarray(normal)[lip];overrides["Pouch_Back"]=Image.fromarray(backarray);back_own=union(back_own,lipmask)
        lipmask.save(out/f"masks/{name}-original-brown-lip-to-pouch.png")
        complete=union(valid,poly([(int(xl(y)),y) for y in range(y0,y1+1)]+[(int(xr(y)),y) for y in range(y1,y0-1,-1)]))
        cover=Image.new("L",(W,H))
        for p in data["layers"]:
            if p.get("visible",True) and p["order"]>items[name]["order"]:cover=union(cover,overrides.get(p["id"],get(p["id"])).getchannel("A").point(lambda v:255 if v>=250 else 0))
        cover=union(cover,misowned)
        hidden=inter(sub(complete,valid),cover);mask=union(valid,hidden)
        native=axial_texture(xl,xr,dy,period);a=np.zeros((H,W,4),np.uint8);hm=np.asarray(hidden)>0;vm=np.asarray(valid)>0
        a[hm,:3]=native[hm];a[hm,3]=255;a[vm,:3]=sa[vm,:3];a[vm,3]=np.asarray(normal)[vm]
        overrides[name]=Image.fromarray(a);save_source(name,valid);hidden.save(out/f"masks/{name}-continuous-hidden-paper.png");misowned.save(out/f"masks/{name}-pouch-lip-reassignment.png")
        _,components=label(a[:,:,3]>0,structure=np.ones((3,3)))
        reports.append({"id":name,"sourceVisibleRgbChanged":0,"hiddenPaintPixels":int(hm.sum()),"connectedComponents8NeighborAfter":components,"pouchLipPixelsReassigned":int((np.asarray(misowned)>0).sum())+int(lip.sum()),"nativeAxialDonorRows":[dy,dy+period],"requiredReview":"Cylinder contour and paper pattern under independent native deformation; no pose acceptance"})
    overrides["Pouch_Front"]=Image.fromarray(fa);save_source("Pouch_Front",front_own)
    save_source("Pouch_Back",back_own)
    for name,im in overrides.items():clear(im).save(out/f"layers/{name}.png")
    for p in data["layers"]:
        for key in ("path","sourceVisible","sourceMask","uncompletedOcclusionMask"):
            if p.get(key):p[key]=str(resolve(Path(p[key])).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str(resolve(Path(q)).resolve()) for q in p["patchMasks"]]
        if p["id"] in overrides:p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"]);p["status"]="WIP_CONTINUOUS_POUCH_MATERIAL_READY_FOR_NATIVE_BINDING_STUDY"
        if p["id"] in own_overrides:p["sourceVisible"]=f"source-visible/{p['id']}.png";p["sourceMask"]=f"masks/{p['id']}-source-ownership.png"
        if p["id"] in ("Cape_Back","Cape_R","Cape_L"):
            p["group"]="Outer_Cape";p["groupOverrideReason"]="Cape panels must cover reconstructed right shoulder roots. This subgroup preserves real draw order and contiguous PSD groups without changing stable part IDs."
    data["status"]="WIP_72_LAYER_NATIVE_BINDING_INPUT_NOT_PRODUCTION_ACCEPTED";data["baseMetadata"]=str(mp);data["baseMetadataSha256"]=sha(mp);data["materialRevisionReports"]=reports
    data["limitations"]=["72 real nonempty layers; hidden texture candidates still require material and native motion review.","Arm upper/lower hinge needs shared mesh neighborhood and parent-child deformation, not rigid raster seam grading.","Large fully hidden hair/back skirt supports remain WIP; neutral scores do not certify future exposed surfaces.","Scarf lower/body seam needs at least 5-8px clean garment overlap at x370..690,y726..746; r11 native diagnostics are not an acceptance of these raster parts.","Original source edge red/green alpha noise remains pending a separate masked cleanup."]
    (out/"metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    before=Image.new("RGBA",(W,H));after=Image.new("RGBA",(W,H))
    for p in sorted(original_data["layers"],key=lambda p:p["order"]):
        if not p.get("visible",True):continue
        old=Image.open(resolve(Path(p["path"]))).convert("RGBA");before.alpha_composite(old)
    for p in sorted(data["layers"],key=lambda p:p["order"]):
        if not p.get("visible",True):continue
        if p["id"] in overrides:im=overrides[p["id"]]
        else:im=Image.open(Path(p["path"])).convert("RGBA")
        after.alpha_composite(im)
    before.save(out/"qa/baseline-neutral.png");after.save(out/"qa/neutral-candidate.png")
    for name in overrides:
        box=(415,720,645,970) if name in ("Pouch_Strap","Bodice_Olive") else (600,700,865,1000)
        contact=Image.new("RGB",((box[2]-box[0])*3,box[3]-box[1]))
        old=Image.open(resolve(Path(next(p for p in original_data["layers"] if p["id"]==name)["path"]))).convert("RGBA")
        for i,im in enumerate((source,old,overrides[name])):contact.paste(bg(im.crop(box)),((box[2]-box[0])*i,0))
        contact.resize((contact.width*2,contact.height*2)).save(out/f"qa/{name}-source-before-after-200pct.png")
    diff=np.max(abs(np.asarray(after).astype(int)-np.asarray(before).astype(int)),axis=2)
    audit={"type":"72_REAL_RASTER_WIP_NATIVE_BINDING_INPUT","layers":len(data["layers"]),"temporaryLayerCount":sum(bool(p.get("temporary")) for p in data["layers"]),"sourceUnchanged":sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e","baselineCompositeChangedPixels":int((diff>0).sum()),"baselineCompositeMaxRgbaDelta":int(diff.max()),"reports":reports,"productionAccepted":False,"modelAccepted":False}
    (out/"qa/audit.json").write_text(json.dumps(audit,indent=2),encoding="utf-8");print(json.dumps(audit,indent=2))

if __name__=="__main__":main()
