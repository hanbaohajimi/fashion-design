"""Complete original-pixel right sleeve chain and local underpainting study.

Outputs raster/IK diagnostics only. No Cubism operation or model acceptance.
Original source-visible pixels stay exact; texture quilting uses original cloth
at its native pixel scale and logs all newly painted masks.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageChops,ImageDraw,ImageFilter
from scipy.ndimage import label
from skimage.metrics import structural_similarity

ROOT=Path(__file__).resolve().parents[3]
SRC=ROOT/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
BASE=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions/b8"
W,H=971,1620

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def blank():return Image.new("L",(W,H))
def poly(points):
    m=blank();ImageDraw.Draw(m).polygon(points,fill=255);return m
def capsule(a,b,r):
    m=blank();d=ImageDraw.Draw(m);d.line([a,b],fill=255,width=2*r)
    for x,y in (a,b):d.ellipse((x-r,y-r,x+r,y+r),fill=255)
    return m
def union(*ms):
    r=blank()
    for m in ms:r=ImageChops.lighter(r,m)
    return r
def inter(*ms):
    r=Image.new("L",(W,H),255)
    for m in ms:r=ImageChops.darker(r,m)
    return r
def sub(a,b):return ImageChops.subtract(a,b)
def binary(m):return m.point(lambda p:255 if p else 0)
def rgba(rgb,alpha):
    out=rgb.convert("RGBA");out.putalpha(alpha);r=Image.new("RGBA",(W,H));r.paste(out,(0,0),binary(alpha));return r
def onbg(im):
    bg=Image.new("RGBA",im.size,(52,60,52,255));bg.alpha_composite(im);return bg.convert("RGB")

def seam_vertical(error):
    h,w=error.shape;cost=error.copy();parent=np.zeros((h,w),np.int32)
    for y in range(1,h):
        for x in range(w):
            lo=max(0,x-1);hi=min(w,x+2);q=lo+int(np.argmin(cost[y-1,lo:hi]));cost[y,x]+=cost[y-1,q];parent[y,x]=q
    cut=np.zeros(h,np.int32);cut[-1]=int(np.argmin(cost[-1]))
    for y in range(h-1,0,-1):cut[y-1]=parent[y,cut[y]]
    return cut

def quilt(rgb,source_boxes,size,patch=30,overlap=10,seed=38):
    """Native-scale source patches, SSD choice and minimum-error cut seams."""
    rng=np.random.default_rng(seed);arr=np.asarray(rgb).astype(np.float32);samples=[];origins=[]
    for x0,y0,x1,y1 in source_boxes:
        for y in range(y0,y1-patch+1,3):
            for x in range(x0,x1-patch+1,3):samples.append(arr[y:y+patch,x:x+patch]);origins.append([x,y,patch,patch])
    if not samples:raise ValueError("No native source texture patches")
    samples=np.stack(samples);tw,th=size;canvas=np.zeros((th+patch,tw+patch,3),np.float32);known=np.zeros(canvas.shape[:2],bool);chosen=[]
    for y in range(0,th,patch-overlap):
        for x in range(0,tw,patch-overlap):
            old=canvas[y:y+patch,x:x+patch];valid=known[y:y+patch,x:x+patch]
            if valid.any():
                errors=np.mean(((samples-old)**2)[:,valid],axis=(1,2));best=np.argsort(errors)[:min(3,len(samples))];idx=int(rng.choice(best))
            else:idx=int(rng.integers(len(samples)))
            new=samples[idx];take=np.ones((patch,patch),bool)
            if x:
                cut=seam_vertical(np.mean((old[:,:overlap]-new[:,:overlap])**2,axis=2))
                for row,c in enumerate(cut):take[row,:c]=False
            if y:
                cut=seam_vertical(np.mean((old[:overlap]-new[:overlap])**2,axis=2).T)
                for col,c in enumerate(cut):take[:c,col]=False
            take|=~valid;old[take]=new[take];known[y:y+patch,x:x+patch]=True;chosen.append({"destination":[x,y],"source":origins[idx]})
    return Image.fromarray(np.clip(canvas[:th,:tw],0,255).astype(np.uint8)),{"method":"native-scale original pixel patch quilting; overlap SSD and minimum error cut, no global nearest fill or AI generation","patch":patch,"overlap":overlap,"sourceBoxes":source_boxes,"placements":chosen}

def ik(shoulder,elbow,palm,target):
    s=np.array(shoulder,float);e=np.array(elbow,float);p=np.array(palm,float);t=np.array(target,float)
    l1=float(np.linalg.norm(e-s));l2=float(np.linalg.norm(p-e));d=float(np.linalg.norm(t-s));c=(d*d-l1*l1-l2*l2)/(2*l1*l2)
    if abs(c)>1:raise ValueError("Unreachable target without stretching")
    solutions=[]
    for sign in (-1,1):
        bend=sign*math.acos(c);a=math.atan2(t[1]-s[1],t[0]-s[0])-math.atan2(l2*math.sin(bend),l1+l2*math.cos(bend))
        j=s+l1*np.array([math.cos(a),math.sin(a)]);upper=a-math.atan2((e-s)[1],(e-s)[0]);lower=math.atan2((t-j)[1],(t-j)[0])-math.atan2((p-e)[1],(p-e)[0])
        solutions.append({"elbowTarget":j.tolist(),"upperRotationDegreesImageCoordinates":math.degrees(upper),"lowerAbsoluteRotationDegreesImageCoordinates":math.degrees(lower)})
    return {"shoulder":shoulder,"neutralElbow":elbow,"neutralPalmCenter":palm,"hatBrimTarget":target,"upperLengthPx":l1,"lowerToPalmLengthPx":l2,"shoulderToTargetPx":d,"maxReachPx":l1+l2,"stretchFactor":1,"solutions":solutions}

def transform(im,angle,pivot,translation=(0,0)):
    rotated=im.rotate(-angle,Image.Resampling.BICUBIC,center=pivot)
    result=Image.new("RGBA",(W,H));result.alpha_composite(rotated,(round(translation[0]),round(translation[1])));return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--revision",default="a1");args=ap.parse_args();out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/arm-study"/args.revision
    assert not (out/"metadata.json").exists(),"Use a fresh revision"
    for d in ("layers","masks","source-visible","qa"):(out/d).mkdir(parents=True,exist_ok=True)
    assert sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
    src=Image.open(SRC).convert("RGBA");rgb=src.convert("RGB");alpha=src.getchannel("A");solid=alpha.point(lambda p:255 if p>=250 else 0);normal=ImageChops.lighter(alpha,solid)
    data=json.loads((BASE/"fullbody-with-r9.metadata.json").read_text(encoding="utf-8"));items={p["id"]:p for p in data["layers"]}
    def image_for(name):
        q=Path(items[name]["path"]);return Image.open(q if q.is_absolute() else BASE/q).convert("RGBA")
    def visible(name):return binary(Image.open(BASE/f"source-visible/{name}.png").getchannel("A"))
    old_upper=visible("Arm_R_Upper");old_lower=visible("Arm_R_Lower");hand_vis=visible("Hand_R")
    # Remove actual sage sleeve/cuff pixels accidentally owned by the braid tip.
    ar=np.asarray(rgb).astype(np.int16);gray=(ar[:,:,0]-ar[:,:,1]<15)&(ar[:,:,1]-ar[:,:,2]<38)&(ar[:,:,1]>85)
    tip_gray=inter(Image.fromarray((gray*255).astype(np.uint8)),visible("Braid_Tip"),poly([(200,914),(250,914),(250,984),(200,984)]))
    labels,n=label(np.asarray(tip_gray)>0);counts=np.bincount(labels.ravel());tip_gray=Image.fromarray(((labels==(int(np.argmax(counts[1:])+1) if n else -1))*255).astype(np.uint8))
    tip_gray.save(out/"masks/braid-tip-gray-sleeve-reassignment.png")
    sleeve=union(old_upper,old_lower,tip_gray)
    shoulder=(341,747);elbow=(276,929);palm=(195,1025);target=(182,493)
    # One anatomical joint plane prevents disconnected distal cuff scraps from
    # remaining on the upper arm. Source ownership is still a lossless partition.
    gy,gx=np.mgrid[:H,:W];forearm=np.array(palm)-np.array(elbow)
    lower_zone=Image.fromarray((((gx-elbow[0])*forearm[0]+(gy-elbow[1])*forearm[1]>=0)*255).astype(np.uint8))
    lower_vis=inter(sleeve,lower_zone);upper_vis=sub(sleeve,lower_vis)
    # Roots are reconstructed only under actual cape/hair; no neutral silhouette
    # expansion. Both joint layers reuse original gray sleeve pixels in overlap.
    upper_shape=union(capsule(shoulder,elbow,46),upper_vis)
    lower_shape=union(capsule(elbow,(211,993),42),lower_vis)
    hidden_cover=union(binary(image_for("Cape_R").getchannel("A")),binary(image_for("Braid_Root").getchannel("A")),binary(image_for("Braid_Mid").getchannel("A")),binary(image_for("Hair_Side_R").getchannel("A")))
    upper_complete=union(upper_vis,upper_shape)
    lower_complete=union(lower_vis,inter(lower_shape,union(sleeve,hidden_cover),solid))
    hand_complete=union(hand_vis,inter(capsule((211,977),(207,1005),31),sleeve,solid))
    gray_texture,gray_log=quilt(rgb,[(327,764,418,827),(242,886,292,928)],(230,350),patch=30,overlap=10)
    # Match local sleeve illumination using uncovered original gray cloth, not
    # the brighter cape donor or the baked dark cape-edge shadow.
    sample_mask=inter(sleeve,poly([(242,906),(311,906),(311,943),(242,943)]))
    target_median=np.median(np.asarray(rgb)[np.asarray(sample_mask)>0],axis=0)
    texture_median=np.median(np.asarray(gray_texture).reshape(-1,3),axis=0)
    gray_delta=target_median-texture_median
    gray_texture=Image.fromarray(np.clip(np.asarray(gray_texture).astype(float)+gray_delta,0,255).astype(np.uint8));gray_log["localRgbMedianCorrection"]=gray_delta.tolist();gray_log["referenceMaskBox"]=[242,906,311,943]
    gray_full=rgb.copy();gray_full.paste(gray_texture,(177,688));gray_log["targetOrigin"]=[177,688]
    skin_texture,skin_log=quilt(rgb,[(172,1008,211,1045)],(130,150),patch=22,overlap=8,seed=14);skin_full=rgb.copy();skin_full.paste(skin_texture,(135,935));skin_log["targetOrigin"]=[135,935]
    # Original cape cast shadow is baked into sleeve pixels. Brighten only a
    # precisely logged gray-cloth strip; preserve native weave phase and hue.
    cape_vis=visible("Cape_R")
    shadow=sub(cape_vis.filter(ImageFilter.MaxFilter(31)),cape_vis)
    shadow=inter(shadow,sleeve,poly([(234,847),(374,847),(374,910),(234,910)]))
    shadow=inter(shadow.filter(ImageFilter.GaussianBlur(2)),sleeve)
    shadow.save(out/"masks/Arm_R-original-cape-shadow-brightness-repair.png")
    lum=np.asarray(rgb.convert("L").filter(ImageFilter.GaussianBlur(4))).astype(float)
    yy,xx=np.mgrid[:H,:W];ref=lum[np.clip(yy+26,0,H-1),np.clip(xx-8,0,W-1)]
    gain=1+(np.clip(ref/np.maximum(lum,1),1,1.50)-1)*(np.asarray(shadow).astype(float)/255)
    repaired=np.clip(np.rint(np.asarray(rgb).astype(float)*gain[:,:,None]),0,255).astype(np.uint8)
    brightened=Image.fromarray(repaired)
    overrides={};reports=[]
    cuff_zone=poly([(169,941),(194,942),(219,949),(242,962),(258,980),(272,1000),(269,1018),(246,1030),(222,1011),(203,999),(180,989),(163,977),(158,960)])
    arm_donor_path=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/candidates/right-upper-arm-local-request/upper-arm-hidden-donor-r1.png"
    arm_donor=Image.open(arm_donor_path).convert("RGBA");arm_donor_native=arm_donor.resize((210,290),Image.Resampling.LANCZOS)
    donor_registered=Image.new("RGBA",(W,H));donor_registered.paste(arm_donor_native,(195,690))
    donor_rgb=donor_registered.convert("RGB");donor_valid=donor_registered.getchannel("A").point(lambda p:255 if p>=245 else 0)
    calibrate=inter(upper_vis,donor_valid,poly([(220,900),(311,900),(311,945),(220,945)]))
    color_delta=np.median((np.asarray(rgb).astype(float)-np.asarray(donor_rgb).astype(float))[np.asarray(calibrate)>0],axis=0)
    donor_rgb=Image.fromarray(np.clip(np.asarray(donor_rgb).astype(float)+color_delta,0,255).astype(np.uint8))
    for name,own,complete,paint in [("Arm_R_Upper",upper_vis,upper_complete,gray_full),("Arm_R_Lower",lower_vis,lower_complete,gray_full),("Hand_R",hand_vis,hand_complete,skin_full)]:
        reuse=inter(complete,sleeve) if name!="Hand_R" else own
        if name=="Arm_R_Upper":reuse=sub(reuse,cuff_zone)
        painted=sub(complete,union(own,reuse));colors=rgb.copy();colors.paste(paint,(0,0),painted)
        if name!="Hand_R":colors.paste(brightened,(0,0),binary(inter(shadow,reuse)))
        if name=="Arm_R_Upper":
            donor_mask=inter(union(painted,shadow),complete,donor_valid)
            colors.paste(donor_rgb,(0,0),donor_mask);donor_mask.save(out/"masks/Arm_R_Upper-registered-imagegen-local-repair.png")
        im=rgba(colors,union(inter(own,normal),sub(complete,own)));overrides[name]=im;im.save(out/f"layers/{name}.png")
        rgba(rgb,inter(own,alpha)).save(out/f"source-visible/{name}.png");own.save(out/f"masks/{name}-ownership.png");painted.save(out/f"masks/{name}-local-paint.png");sub(reuse,own).save(out/f"masks/{name}-original-sleeve-overlap.png");complete.save(out/f"masks/{name}-complete.png")
        changed=np.any(np.asarray(im)[:,:,:3]!=np.asarray(src)[:,:,:3],axis=2)&(np.asarray(own)>0)
        assert not (changed&(np.asarray(shadow)==0)).any(),"Visible change escaped declared cape-shadow repair"
        reports.append({"id":name,"authoredVisibleShadowRepairPixels":int(changed.sum()),"sourceVisibleExtractionRgbChanged":0,"sourceVisiblePixels":int((np.asarray(own)>0).sum()),"originalJointOverlapPixels":int((np.asarray(sub(reuse,own))>0).sum()),"newPaintPixels":int((np.asarray(painted)>0).sum()),"status":"candidate_full_sleeve_joint_review_required"})
    braid=image_for("Braid_Tip");braid.putalpha(sub(braid.getchannel("A"),tip_gray));braid.save(out/"layers/Braid_Tip.png");overrides["Braid_Tip"]=braid
    cape=image_for("Cape_R");cape_hidden=sub(binary(cape.getchannel("A")),cape_vis)
    clip=inter(cape_hidden,sleeve);cape.putalpha(sub(cape.getchannel("A"),clip));cape.save(out/"layers/Cape_R.png");overrides["Cape_R"]=cape;clip.save(out/"masks/Cape_R-hidden-overlap-draw-order-correction.png")
    # Same original coarse geometric weave for limited moving bodice exposure.
    bodice=image_for("Bodice_Olive");bodice_own=visible("Bodice_Olive");hidden=sub(binary(bodice.getchannel("A")),bodice_own)
    narrow=inter(hidden,bodice_own.filter(ImageFilter.MaxFilter(29)))
    green_texture,green_log=quilt(rgb,[(452,856,520,910)],(365,235),patch=30,overlap=10,seed=17);green_full=rgb.copy();green_full.paste(green_texture,(320,720));green_log["targetOrigin"]=[320,720]
    # Reconstruct the entire hidden cloth field with native source weave. Low
    # frequency illumination is propagated from bare original green cloth only,
    # excluding the scissor/strap silhouette and its narrow cast-shadow border.
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    safe=inter(bodice_own.filter(ImageFilter.MinFilter(19)),poly([(335,758),(650,758),(650,930),(335,930)]))
    sa=np.asarray(safe)>0;indices=distance_transform_edt(~sa,return_distances=False,return_indices=True)
    src_low=gaussian_filter(np.asarray(rgb).astype(float),sigma=(5,5,0))
    propagated=src_low[indices[0],indices[1]];propagated=gaussian_filter(propagated,sigma=(12,12,0))
    texture=np.asarray(green_full).astype(float);detail=texture-gaussian_filter(texture,sigma=(5,5,0))
    hidden_rgb=Image.fromarray(np.clip(propagated+detail,0,255).astype(np.uint8))
    bodice.paste(rgba(hidden_rgb,bodice.getchannel("A")),(0,0),hidden);bodice.save(out/"layers/Bodice_Olive.png");overrides["Bodice_Olive"]=bodice;hidden.save(out/"masks/Bodice_Olive-native-weave-hidden-repair.png")
    # Raising the arm actually reveals these contiguous waist/skirt surfaces.
    # Complete their planned contours instead of leaving source ownership holes.
    peplum_complete=poly([(323,921),(440,932),(427,972),(416,1010),(396,1036),(374,1048),(347,1048),(325,1036),(312,1018),(300,1025),(286,1030),(273,1029),(262,1024),(256,1016),(255,1005),(259,991),(265,976),(273,960),(284,945),(299,932)])
    peplum_own=visible("Peplum_R");peplum_complete=union(peplum_complete,peplum_own);peplum_paint=sub(peplum_complete,peplum_own)
    green_lower,green_lower_log=quilt(rgb,[(348,957,381,995),(452,956,486,1004)],(220,160),patch=24,overlap=8,seed=31);lower_full=rgb.copy();lower_full.paste(green_lower,(235,900));pc=rgb.copy();pc.paste(lower_full,(0,0),peplum_paint)
    peplum=rgba(pc,union(inter(peplum_own,normal),peplum_paint));overrides["Peplum_R"]=peplum;peplum.save(out/"layers/Peplum_R.png");peplum_paint.save(out/"masks/Peplum_R-arm-reveal-completion.png")
    skirt_complete=poly([(285,987),(372,999),(381,1030),(345,1081),(300,1131),(248,1174),(207,1192),(176,1193),(151,1182),(141,1163),(147,1142),(180,1097),(220,1051)])
    skirt_own=visible("Skirt_Petal_Side_R");skirt_complete=union(skirt_complete,skirt_own);skirt_paint=sub(skirt_complete,skirt_own)
    linen,linen_log=quilt(rgb,[(326,1105,377,1150)],(255,235),patch=28,overlap=9,seed=26);linen_full=rgb.copy();linen_full.paste(linen,(135,975));sc=rgb.copy();sc.paste(linen_full,(0,0),skirt_paint)
    skirt=rgba(sc,union(inter(skirt_own,normal),skirt_paint));overrides["Skirt_Petal_Side_R"]=skirt;skirt.save(out/"layers/Skirt_Petal_Side_R.png");skirt_paint.save(out/"masks/Skirt_Petal_Side_R-arm-reveal-completion.png")
    (out/"qa/original-texture-quilting.json").write_text(json.dumps({"gray":gray_log,"skin":skin_log,"green":green_log,"peplum":green_lower_log,"linen":linen_log},indent=2),encoding="utf-8")
    (out/"qa/upper-arm-generated-donor-audit.json").write_text(json.dumps({"donor":str(arm_donor_path),"donorSha256":sha(arm_donor_path),"donorSize":arm_donor.size,"registration":{"targetRoi":[195,690,405,980],"targetSize":[210,290],"method":"near-identical aspect ratio with integer pixel rounding; original alpha retained"},"rgbMedianCorrection":color_delta.tolist(),"mask":"masks/Arm_R_Upper-registered-imagegen-local-repair.png","generatedAlphaUsedAsFinalAlpha":False,"outsideHiddenAndShadowRepairVisibleChange":False,"status":"registered_masked_candidate_pending_visual_and_roi_review"},indent=2),encoding="utf-8")
    pose=ik(shoulder,elbow,palm,target);pose["type"]="TWO_SEGMENT_RASTER_GEOMETRY_STUDY_NOT_CUBISM";pose["motionScope"]={"Hover":"two-segment hat touch; no texture stretch","Idle":"joint continuity while subtle breath; no walking","DragHold":"gentle draw-in, must use same completed joints","PutDown":"return to rest without bounce"}
    (out/"ik-plan.json").write_text(json.dumps(pose,indent=2),encoding="utf-8")
    # Register overrides without changing frozen b8 or r9 source files.
    study=json.loads(json.dumps(data));study["status"]="RIGHT_ARM_TEXTURE_AND_REACH_STUDY_NOT_ACCEPTED";study["baseRevision"]="b8_read_only"
    for p in study["layers"]:
        # Metadata must remain independently resolvable after relocation into a
        # fresh revision; original masks are read-only baseline evidence.
        for key in ("sourceVisible","sourceMask","uncompletedOcclusionMask"):
            if p.get(key) and not Path(p[key]).is_absolute():p[key]=str((BASE/p[key]).resolve())
        if p.get("patchMasks"):p["patchMasks"]=[str((BASE/q).resolve()) if not Path(q).is_absolute() else q for q in p["patchMasks"]]
        if p["id"] in overrides:p["path"]=f"layers/{p['id']}.png";p["sha256"]=sha(out/p["path"])
        elif not Path(p["path"]).is_absolute():p["path"]=str((BASE/p["path"]).resolve())
        if p["id"] in ("Arm_R_Upper","Hand_R","Arm_R_Lower"):
            p["sourceVisible"]=f"source-visible/{p['id']}.png";p["sourceMask"]=f"masks/{p['id']}-ownership.png";p["patchMasks"]=[f"masks/{p['id']}-local-paint.png",f"masks/{p['id']}-original-sleeve-overlap.png"]
            p["order"]={"Arm_R_Upper":615,"Hand_R":616,"Arm_R_Lower":617}[p["id"]];p["group"]="Arm_R";p["groupOverrideReason"]="Complete right sleeve roots sit behind cape; cuff occludes wrist. Hand draw order rises only in actual hat-contact keyform."
    study["layers"].sort(key=lambda p:p["order"]);study["localArmReports"]=reports
    (out/"metadata.json").write_text(json.dumps(study,ensure_ascii=False,indent=2),encoding="utf-8")
    def render(solution=None):
        canvas=Image.new("RGBA",(W,H));arm_top={}
        for p in study["layers"]:
            if not p.get("visible",True):continue
            q=Path(p["path"]);im=Image.open(q if q.is_absolute() else out/q).convert("RGBA")
            if solution and p["id"] in ("Arm_R_Upper","Arm_R_Lower","Hand_R"):
                if p["id"]=="Arm_R_Upper":im=transform(im,solution["upperRotationDegreesImageCoordinates"],shoulder)
                else:
                    delta=np.array(solution["elbowTarget"])-np.array(elbow);im=transform(im,solution["lowerAbsoluteRotationDegreesImageCoordinates"],elbow,delta)
                # Diagnostic foreground arm + static cape occlusion. Actual
                # Editor needs the corresponding draw-order/clipping solution.
                support_cover=union(cape.getchannel("A"),image_for("Scarf_Lower").getchannel("A"),image_for("Scarf_Middle").getchannel("A"),image_for("Scarf_Upper").getchannel("A"))
                im.putalpha(sub(im.getchannel("A"),support_cover))
                arm_top[p["id"]]=im;continue
            canvas.alpha_composite(im)
        for name in ("Arm_R_Upper","Hand_R","Arm_R_Lower"):
            if name in arm_top:canvas.alpha_composite(arm_top[name])
        return canvas
    neutral=render();neutral.save(out/"qa/neutral-candidate.png")
    for i,solution in enumerate(pose["solutions"]):render(solution).save(out/f"qa/hat-touch-ik-solution-{i}.png")
    for name in ("Arm_R_Upper","Arm_R_Lower","Hand_R","Bodice_Olive","Peplum_R","Skirt_Petal_Side_R"):
        im=overrides[name];box=im.getbbox();onbg(im.crop(box)).resize(((box[2]-box[0])*2,(box[3]-box[1])*2)).save(out/f"qa/{name}-isolated-200pct.png")
    source=np.asarray(src);nr=np.asarray(neutral);solidmask=source[:,:,3]>=250;delta=np.max(abs(source[:,:,:3].astype(int)-nr[:,:,:3].astype(int)),axis=2)
    roi=(158,830,378,1035);roi_scores=[]
    for color in [(255,255,255),(30,35,30),(220,218,209)]:
        b=Image.new("RGBA",(W,H),(*color,255));b.alpha_composite(src);c=Image.new("RGBA",(W,H),(*color,255));c.alpha_composite(neutral)
        roi_scores.append({"background":color,"ssim":float(structural_similarity(np.asarray(b.convert("RGB").crop(roi)),np.asarray(c.convert("RGB").crop(roi)),channel_axis=2,data_range=255))})
    audit={"type":"RASTER_SLEEVE_RECONSTRUCTION_PRECHECK_NOT_MODEL","neutralSolidRgbDiffOver3":int((solidmask&(delta>3)).sum()),"neutralMaxSolidChannelDelta":int(delta[solidmask].max()),"sourceUnchanged":sha(SRC)=="da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e","sourceReassignedGrayBraidPixels":int((np.asarray(tip_gray)>0).sum()),"sourceVisibleExtractionRgbChanged":0,"shadowRepairMask":"masks/Arm_R-original-cape-shadow-brightness-repair.png","shadowBrightnessGainLimit":1.50,"fixedSleeveRoi":roi,"fixedSleeveRoiScores":roi_scores,"armParts":reports,"productionAccepted":False,"poseAccepted":False,"modelAccepted":False}
    (out/"qa/audit.json").write_text(json.dumps(audit,indent=2),encoding="utf-8");print(json.dumps(audit,indent=2))

if __name__=="__main__":main()
