"""Real v8 face/scarf pixels, declared local repair, and diagnostic pose previews.

This script does not generate a character, PSD, Cubism model, or GUI evidence.
All imagery derives from the locked PNG, except explicit clean closed-eye arcs.
"""
from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
OUT = ROOT / "output/forest-spirit-production-v2/front-v8/face"
EXPECTED_SHA = "da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
W, H = 971, 1620

# Source-visible cloth only. The notched forehead follows the central fringe.
FACE = [(344,455),(352,438),(366,427),(380,413),(396,392),(415,375),(440,358),(464,349),(486,355),(490,369),(476,391),(455,409),(438,420),(421,428),(422,438),(450,435),(485,425),(516,406),(540,382),(559,361),(577,344),(602,344),(621,361),(637,386),(650,414),(673,435),(691,447),(701,473),(707,503),(703,539),(691,569),(668,590),(635,606),(581,617),(526,623),(472,617),(421,606),(385,593),(362,573),(350,546),(344,510)]
SCARF = [(369,595),(405,606),(465,616),(525,624),(585,616),(633,606),(655,594),(665,606),(668,624),(663,643),(661,658),(664,673),(673,684),(678,698),(674,708),(661,717),(616,732),(560,742),(503,740),(448,732),(393,723),(360,715),(347,705),(347,693),(355,680),(364,666),(364,651),(365,635),(364,617)]
# Diagnostic composite boundary follows the full hair/braid, never a horizontal cut.
HEAD = [(0,0),(971,0),(971,650),(898,668),(851,693),(823,708),(810,735),(785,741),(759,725),(736,699),(701,678),(684,669),(376,654),(357,700),(345,734),(327,772),(301,807),(270,838),(247,857),(239,883),(237,912),(222,941),(197,966),(176,980),(153,968),(135,946),(128,918),(133,885),(148,858),(161,831),(161,803),(158,783),(166,750),(176,717),(188,687),(169,673),(125,647),(0,630)]
HEAD_LEFT_LOWER = [(0,590),(370,590),(358,625),(347,650),(347,673),(349,692),(344,711),(329,728),(313,748),(303,763),(293,779),(280,794),(267,810),(256,827),(246,842),(258,851),(259,861),(241,875),(226,890),(209,907),(199,925),(194,940),(182,945),(175,952),(169,964),(153,968),(145,978),(0,978)]
HEAD_RIGHT_LOWER = [(647,590),(971,590),(971,700),(770,700),(770,723),(730,725),(718,753),(700,740),(681,725),(673,709),(665,680),(661,654),(667,620)]
UPPER_BOUNDARY = [(340,635),(395,646),(450,655),(500,663),(550,663),(600,655),(650,643),(710,630)]
MIDDLE_BOUNDARY = [(330,669),(395,679),(450,689),(500,698),(550,700),(600,694),(650,681),(720,665)]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def blank():
    return Image.new("L", (W,H))


def polygon(points):
    mask = blank(); ImageDraw.Draw(mask).polygon(points, fill=255); return mask


def ellipse(box):
    mask = blank(); ImageDraw.Draw(mask).ellipse(box, fill=255); return mask


def union(*masks):
    result = blank()
    for mask in masks: result = ImageChops.lighter(result, mask)
    return result


def intersect(*masks):
    result = Image.new("L", (W,H), 255)
    for mask in masks: result = ImageChops.darker(result, mask)
    return result


def subtract(a,b):
    return ImageChops.subtract(a,b)


def binary(mask):
    return mask.point(lambda p: 255 if p else 0)


def largest_region(rgb, box, predicate, fill_holes=True):
    x0,y0,x1,y1 = box; tile = rgb.crop(box); width,height = tile.size
    pixels = tile.load(); remaining = {(x,y) for y in range(height) for x in range(width) if predicate(*pixels[x,y])}
    best = set()
    while remaining:
        seed = remaining.pop(); component = {seed}; queue = deque([seed])
        while queue:
            x,y = queue.popleft()
            for neighbor in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if neighbor in remaining: remaining.remove(neighbor); component.add(neighbor); queue.append(neighbor)
        if len(component)>len(best): best=component
    tile_mask = Image.new("L",(width+2,height+2)); draw = ImageDraw.Draw(tile_mask)
    for x,y in best: draw.point((x+1,y+1),fill=255)
    if fill_holes:
        ImageDraw.floodfill(tile_mask,(0,0),128)
        tile_mask = tile_mask.point(lambda p: 0 if p==128 else 255)
    result = blank(); result.paste(tile_mask.crop((1,1,width+1,height+1)),(x0,y0)); return result


def cloth_patch(rgb, target, donor_box, color_match=True):
    """Tile only the declared repair region using a local clean source cloth patch."""
    sample = rgb.crop(donor_box); texture = Image.new("RGB",(W,H)); sw,sh=sample.size
    box = target.getbbox()
    if not box: return rgb.copy()
    for y in range(box[1],box[3],sh):
        for x in range(box[0],box[2],sw): texture.paste(sample,(x,y))
    if color_match:
        ring = subtract(target.filter(ImageFilter.MaxFilter(11)),target)
        target_mean = ImageStat.Stat(rgb,ring).mean if ring.getbbox() else ImageStat.Stat(sample).mean
        source_mean = ImageStat.Stat(sample).mean
        texture = Image.merge("RGB",[band.point(lambda p,delta=t-s:round(max(0,min(255,p+delta)))) for band,t,s in zip(texture.split(),target_mean,source_mean)])
    result=rgb.copy(); result.paste(texture,(0,0),target); return result


def translated_patch(rgb, mask, dx,dy):
    donor = ImageChops.offset(rgb,-dx,-dy)
    rim = subtract(mask.filter(ImageFilter.MaxFilter(13)),mask)
    if rim.getbbox():
        target_mean = ImageStat.Stat(rgb,rim).mean; source_mean=ImageStat.Stat(donor,rim).mean
        donor = Image.merge("RGB",[band.point(lambda p,delta=t-s:round(max(0,min(255,p+delta)))) for band,t,s in zip(donor.split(),target_mean,source_mean)])
    result=rgb.copy();result.paste(donor,(0,0),mask);return result


def split_boundary(points):
    return polygon([(0,0),(W,0),(W,points[-1][1]),*reversed(points),(0,points[0][1])])


def run():
    assert digest(SOURCE)==EXPECTED_SHA, "Locked source differs"
    src=Image.open(SOURCE).convert("RGBA"); assert src.size==(W,H)
    rgb=src.convert("RGB"); source_alpha=src.getchannel("A")
    for folder in (OUT,OUT/"layers",OUT/"masks",OUT/"source-visible",OUT/"patches",OUT/"qa"):
        folder.mkdir(parents=True,exist_ok=True)
    # Opaque correction is limited to already solid source pixels. Edge alpha is retained.
    solid=source_alpha.point(lambda p:255 if p>=250 else 0)
    normalized_alpha=ImageChops.lighter(source_alpha,solid)
    solid.save(OUT/"masks/alpha-normalization-solid-only.png")
    face=polygon(FACE)
    # Move the visible fringe pixels to the real head-hair diagnostic composite.
    # Wider guard strips include local cloth edges, but never the original brows.
    hair_guard=union(
        polygon([(342,440),(350,425),(377,401),(401,371),(425,347),(444,341),(463,349),(463,364),(442,384),(423,401),(402,414),(381,428),(357,447)]),
        polygon([(575,327),(599,340),(582,373),(560,400),(535,418),(501,434),(461,444),(420,449),(415,434),(446,421),(480,407),(516,384),(545,351)]),
        polygon([(618,340),(653,347),(665,376),(681,408),(710,438),(722,474),(718,527),(704,569),(687,586),(684,566),(696,531),(697,493),(686,458),(664,441),(647,415),(630,382)]),
        polygon([(334,449),(359,445),(362,480),(358,518),(363,548),(380,576),(370,588),(348,572),(334,538)])
    )
    brown_guard=lambda r,g,b:r<205 and g<150 and b<115 and r-g>20
    brow_guard=union(largest_region(rgb,(389,384,465,420),brown_guard).filter(ImageFilter.MaxFilter(15)),largest_region(rgb,(580,383,658,422),brown_guard).filter(ImageFilter.MaxFilter(15)))
    eye_guard=union(ellipse((393,438,459,528)),ellipse((593,438,659,528)))
    hair_guard=subtract(hair_guard.filter(ImageFilter.MaxFilter(25)),union(brow_guard,eye_guard))
    face=subtract(face,hair_guard)
    hair_guard.save(OUT/"masks/fringe-reassigned-to-head-hair.png")
    scarf=subtract(polygon(SCARF),face)
    # These contours were checked against labeled source crops. Keep dark hair
    # grooves inside the hair part instead of fragmenting them by color threshold.
    head=intersect(union(polygon([(0,0),(W,0),(W,590),(0,590)]),polygon(HEAD_LEFT_LOWER),polygon(HEAD_RIGHT_LOWER)),binary(source_alpha))
    # Preserve the original hair-edge shadow with the moving hair instead of
    # leaving a dark static stripe baked into the cape. Only the internal
    # hair/garment junction receives this local soft overlap, never the silhouette.
    lower_junction=union(polygon([(110,675),(380,675),(380,980),(110,980)]),polygon([(650,650),(722,650),(722,756),(650,756)]))
    shadow_color=blank();source_pixels=rgb.load();shadow_pixels=shadow_color.load()
    for y in range(650,980):
        for x in range(110,723):
            r,g,b=source_pixels[x,y]
            if r-g>=20 and g-b>=12 and b<165:shadow_pixels[x,y]=255
    shadow_overlap=intersect(subtract(head.filter(ImageFilter.MaxFilter(25)),head),shadow_color,solid,lower_junction).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.65))
    shadow_overlap=intersect(shadow_overlap,solid,lower_junction)
    head=union(head,shadow_overlap)
    shadow_overlap.save(OUT/"patches/__TEMP_HeadHairHat-internal-shadow-overlap-mask.png")
    head_hair=subtract(subtract(head,face),scarf)
    body_visible=subtract(binary(source_alpha),union(face,binary(head_hair),scarf))
    for name,mask in (("face-source-visible",face),("scarf-source-visible",scarf),("head-diagnostic-source-visible",head_hair),("body-diagnostic-source-visible",body_visible)):
        mask.save(OUT/"masks"/(name+".png"))
    brown=lambda r,g,b:r<205 and g<150 and b<115 and r-g>20
    eye_masks={"R":largest_region(rgb,(390,432,462,533),brown),"L":largest_region(rgb,(590,432,663,533),brown)}
    masks={"Eye_R_Open":eye_masks["R"],"Eye_L_Open":eye_masks["L"],"Brow_R":largest_region(rgb,(389,384,465,420),brown),"Brow_L":largest_region(rgb,(580,383,658,422),brown),"Nose":largest_region(rgb,(502,497,547,533),lambda r,g,b:r-g>28 and r-b>36 and g<200),"Mouth":largest_region(rgb,(493,530,556,568),brown)}
    masks["Eye_R_Open"]=union(masks["Eye_R_Open"],ellipse((396,442,456,525)))
    masks["Eye_L_Open"]=union(masks["Eye_L_Open"],ellipse((596,442,656,525)))
    masks["Blush_R"]=ellipse((353,510,458,575));masks["Blush_L"]=ellipse((591,509,698,575))
    cross={"R":largest_region(rgb,(410,461,446,501),lambda r,g,b:r>210 and g>190 and b>160,False),"L":largest_region(rgb,(611,461,647,501),lambda r,g,b:r>210 and g>190 and b>160,False)}
    clean=rgb.copy(); repair_masks={}; extracted={}
    donors={"Eye_R_Open":(85,-5),"Eye_L_Open":(-85,-5),"Brow_R":(80,60),"Brow_L":(-75,65),"Nose":(-32,-55),"Mouth":(-35,37),"Blush_R":(95,0),"Blush_L":(-100,0)}
    for name,(dx,dy) in donors.items():
        support=intersect(masks[name].filter(ImageFilter.MaxFilter(7)),face)
        # All original pixels touched by patch feathering are restored by the visible part.
        repair=intersect(support.filter(ImageFilter.GaussianBlur(1.1)),face)
        exact_support=binary(repair)
        if name.startswith("Blush"):
            side=name[-1]
            eye_guard=binary(eye_masks[side].filter(ImageFilter.MaxFilter(19)))
            exact_support=subtract(exact_support,eye_guard);repair=intersect(repair,exact_support)
        if name.startswith("Eye_") or name.startswith("Blush_"):
            clean=cloth_patch(clean,repair,(488,445,550,490),True)
        else:
            clean=translated_patch(clean,repair,dx,dy)
        extracted[name]=exact_support;repair_masks[name]=repair
        repair.save(OUT/"patches"/(name+"-repair-mask.png"))
    # Fill only concealed forehead/ear-edge support behind the actual hair layer.
    hidden_cap=polygon([(0,0),(W,0),(W,565),(0,565)])
    full_face=union(intersect(ellipse((329,326,720,625)),hidden_cap),face)
    hidden_face=subtract(full_face,face)
    clean=cloth_patch(clean,hidden_face,(500,448,546,495),False)
    hidden_face.save(OUT/"patches/Face_Base-hidden-cloth-mask.png")
    feature_repair=union(*repair_masks.values());feature_repair.save(OUT/"patches/Face_Base-feature-removal-mask.png")
    entries=[]; images={}; visible_masks={}; metadata_by_id={}
    def deliver(name,group,order,colors,visible_mask,hidden_mask=None,visible=True,temporary=False,patches=None,source_note="Original pixels separated with a shape mask"):
        hidden_mask=blank() if hidden_mask is None else hidden_mask
        alpha=union(intersect(visible_mask,normalized_alpha),hidden_mask)
        image=colors.convert("RGBA"); image.putalpha(alpha)
        assert alpha.getbbox(),f"Empty production layer {name}"
        image.save(OUT/"layers"/(name+".png"));alpha.save(OUT/"masks"/(name+".png"))
        original=src.copy();original.putalpha(intersect(visible_mask,source_alpha));original.save(OUT/"source-visible"/(name+".png"))
        item={"id":name,"group":group,"order":order,"path":f"layers/{name}.png","visible":visible,"opacity":1,"temporary":temporary,"sourceVisible":f"source-visible/{name}.png","mask":f"masks/{name}.png","patchMasks":patches or [],"source":source_note,"alphaPixels":sum(alpha.histogram()[1:]),"sha256":digest(OUT/"layers"/(name+".png"))}
        entries.append(item);images[name]=image;visible_masks[name]=visible_mask;metadata_by_id[name]=item
    # Hidden neck/ears are genuine local cloth reconstructions, not blank placeholders.
    neck=ellipse((469,578,579,706));neck_colors=cloth_patch(rgb,neck,(486,566,545,596),False)
    deliver("Neck","Face_Support",30,neck_colors,blank(),neck,False,patches=["patches/Neck-hidden-cloth-mask.png"],source_note="Fully occluded in v8; reconstructed from local face cloth, not extracted visible neck")
    neck.save(OUT/"patches/Neck-hidden-cloth-mask.png")
    for side,box in (("R",(317,472,377,567)),("L",(681,472,741,567))):
        mask=ellipse(box);colors=cloth_patch(rgb,mask,(469,567,516,596),False)
        mask.save(OUT/"patches"/(f"Ear_{side}-hidden-cloth-mask.png"))
        deliver(f"Ear_{side}","Face_Support",35 if side=="R" else 36,colors,blank(),mask,False,patches=[f"patches/Ear_{side}-hidden-cloth-mask.png"],source_note="Fully hair-occluded ear, local cloth reconstruction; anatomy requires review if exposed")
    scarf_back=intersect(ellipse((310,552,741,755)),scarf.filter(ImageFilter.MaxFilter(65)),solid,union(face,head_hair,scarf))
    scarf_back_colors=cloth_patch(rgb,scarf_back,(448,704,504,723),False)
    scarf_back.save(OUT/"patches/Scarf_Back-hidden-cloth-mask.png")
    deliver("Scarf_Back","Scarf",50,scarf_back_colors,blank(),scarf_back,patches=["patches/Scarf_Back-hidden-cloth-mask.png"],source_note="Hidden scarf backing from local brown scarf texture; covers neck through small head tilts")
    upper=intersect(scarf,split_boundary(UPPER_BOUNDARY));middle=intersect(subtract(scarf,upper),split_boundary(MIDDLE_BOUNDARY));lower=subtract(scarf,union(upper,middle))
    for name,mask,order in (("Scarf_Lower",lower,80),("Scarf_Middle",middle,90),("Scarf_Upper",upper,100)):
        # Overlap only into the next front scarf ring or face; never expand onto the cape.
        if name=="Scarf_Lower": overlap=intersect(mask.filter(ImageFilter.MaxFilter(15)),scarf)
        elif name=="Scarf_Middle": overlap=intersect(mask.filter(ImageFilter.MaxFilter(13)),union(upper,middle))
        else: overlap=union(mask,intersect(face,polygon([(360,580),(685,580),(685,640),(360,640)])))
        hidden=subtract(overlap,mask)
        colors=cloth_patch(rgb,hidden,(448,704,504,723),False) if hidden.getbbox() else rgb
        hidden.save(OUT/"patches"/(name+"-overlap-mask.png"))
        deliver(name,"Scarf",order,colors,mask,hidden,patches=[f"patches/{name}-overlap-mask.png"])
    deliver("Face_Base","Face",200,clean,face,hidden_face,patches=["patches/Face_Base-feature-removal-mask.png","patches/Face_Base-hidden-cloth-mask.png"],source_note="Original visible face cloth with local masked feature removal; concealed cloth extended behind hair")
    for index,name in enumerate(("Blush_R","Blush_L","Brow_R","Brow_L","Nose","Mouth")):
        deliver(name,"Face",201+index,rgb,extracted[name])
    for side,center in (("R",(426,479)),("L",(626,479))):
        cmask=intersect(cross[side].filter(ImageFilter.MaxFilter(3)),eye_masks[side])
        # Brown replacement samples the same eye, below and beside its cross.
        clean_eye=cloth_patch(rgb,cmask,(center[0]-8,center[1]+20,center[0]-1,center[1]+29),False)
        cmask.save(OUT/"patches"/(f"Eye_{side}_Open-cross-removal-mask.png"))
        deliver(f"Eye_{side}_Open","Face",210 if side=="R" else 211,clean_eye,extracted[f"Eye_{side}_Open"],patches=[f"patches/Eye_{side}_Open-cross-removal-mask.png"],source_note="Original brown oval with only its cross replaced by neighboring brown stitched pixels")
        deliver(f"Eye_{side}_Cross","Face",214 if side=="R" else 215,rgb,cmask)
        high=Image.new("L",(W*4,H*4));draw=ImageDraw.Draw(high);points=[]
        for i in range(61):
            t=i/60;x=center[0]+(t-.5)*37;y=center[1]+7*(1-(2*t-1)**2);points.append((round(x*4),round(y*4)))
        draw.line(points,fill=255,width=13)
        arc=high.resize((W,H),Image.Resampling.LANCZOS)
        tex=rgb.crop((center[0]-9,center[1]+19,center[0]+9,center[1]+28)).resize((W,H),Image.Resampling.BILINEAR)
        arc.save(OUT/"patches"/(f"Eye_{side}_Closed-new-arc-mask.png"))
        deliver(f"Eye_{side}_Closed","Face",212 if side=="R" else 213,tex,blank(),arc,False,patches=[f"patches/Eye_{side}_Closed-new-arc-mask.png"],source_note="New single clean closed arc using sampled original brown eye texture; no lashes")
    # Body repair zones are solely the cloth that was hidden under hair/braid.
    torso_support=intersect(body_visible.filter(ImageFilter.MaxFilter(75)),polygon([(0,680),(W,680),(W,1080),(0,1080)]))
    soft_overlap_support=binary(subtract(binary(head_hair),head_hair))
    torso_support=union(torso_support,soft_overlap_support)
    left_back=intersect(binary(head_hair),torso_support,polygon([(0,645),(526,645),(526,H),(0,H)]))
    right_back=intersect(binary(head_hair),torso_support,polygon([(526,645),(W,645),(W,H),(526,H)]))
    left_back=intersect(left_back,solid);right_back=intersect(right_back,solid)
    hidden_body=union(left_back,right_back)
    body_rgb=rgb.copy()
    # Translate nearby continuous same-height sleeve/cape pixels into the
    # originally occluded band; avoid repeating a rectangular texture tile.
    body_rgb.paste(ImageChops.offset(rgb,-80,0),(0,0),left_back)
    body_rgb.paste(ImageChops.offset(rgb,100,0),(0,0),right_back)
    hidden_body.save(OUT/"patches/__TEMP_Body-hidden-under-hair-mask.png")
    deliver("__TEMP_Body","__TEMP_Body",0,body_rgb,body_visible,hidden_body,temporary=True,patches=["patches/__TEMP_Body-hidden-under-hair-mask.png"],source_note="Original body diagnostic composite with limited local cloth reconstruction under hair; NOT a production body layer")
    deliver("__TEMP_HeadHairHat","__TEMP_HeadHairHat",300,rgb,head_hair,temporary=True,patches=["patches/__TEMP_HeadHairHat-internal-shadow-overlap-mask.png"],source_note="Original hat and entire hair/braid contour diagnostic composite with local soft source-shadow overlap at garment junction, excludes face and scarf; NOT a production hair/hat layer")
    for item in entries:
        if item["group"]=="Face_Support": item["groupOverrideReason"]="Hidden neck/ear support belongs behind scarf, separate from visible face group; source has no exposed neck/ears."
    entries.sort(key=lambda item:item["order"])
    data={"schemaVersion":1,"characterId":"forest-spirit-front-v8","stage":"head-stage","status":"real_pixel_first_pass_pending_visual_and_pose_quality_review","canvas":{"width":W,"height":H},"source":str(SOURCE),"sourceSha256":EXPECTED_SHA,"sourceUnmodified":digest(SOURCE)==EXPECTED_SHA,"alphaNormalization":{"rule":"Set source alpha>=250 to 255 only where the layer owns a source-visible solid pixel; preserve all softer source edges","mask":"masks/alpha-normalization-solid-only.png"},"layers":entries,"productionLayerCount":20,"temporaryLayerCount":2,"headPivot":[526,618],"limitations":["Hidden ears and neck are local cloth reconstructions, not visible-source extraction.","Hidden face and scarf/body repair need pose review; this is not model validation.","Temporary head and body composites must be excluded from the final production model.","New closed-eye arcs are declared authored art, not extracted from a static open-eye source."]}
    (OUT/"head-stage.metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (OUT/"metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (OUT/"masks/ownership-points.json").write_text(json.dumps({"face":FACE,"scarf":SCARF,"headTopY":590,"headLeftLower":HEAD_LEFT_LOWER,"headRightLower":HEAD_RIGHT_LOWER,"upperBoundary":UPPER_BOUNDARY,"middleBoundary":MIDDLE_BOUNDARY},indent=2),encoding="utf-8")
    render_previews(data,images,src)
    print(json.dumps({"productionLayers":20,"temporaryLayers":2,"sourceUnmodified":digest(SOURCE)==EXPECTED_SHA,"metadata":str(OUT/"head-stage.metadata.json")},ensure_ascii=False,indent=2))


def render_previews(data,images,src):
    def composite(eye_open=1.0,angle=0):
        canvas=Image.new("RGBA",(W,H))
        head_canvas=Image.new("RGBA",(W,H))
        for entry in data["layers"]:
            name=entry["id"]; layer=images[name].copy(); visible=entry["visible"]
            if name.endswith("_Closed"):
                visible=eye_open<=0
            elif name.startswith("Eye_"):
                visible=eye_open>0
                if eye_open<1:
                    # Static raster compression precheck, not Cubism keyforms.
                    box=(390,432,462,533) if name.startswith("Eye_R_") else (590,432,663,533)
                    tile=layer.crop(box).resize((box[2]-box[0],max(1,round((box[3]-box[1])*eye_open))),Image.Resampling.BICUBIC)
                    layer=Image.new("RGBA",(W,H))
                    layer.paste(tile,(box[0],round(479+(box[1]-479)*eye_open)))
            if not visible:continue
            if angle and (name=="__TEMP_HeadHairHat" or entry["group"]=="Face"):
                head_canvas=Image.alpha_composite(head_canvas,layer)
            else:
                canvas=Image.alpha_composite(canvas,layer)
        if angle:
            head_canvas=head_canvas.rotate(angle,resample=Image.Resampling.BICUBIC,center=tuple(data["headPivot"]))
            canvas=Image.alpha_composite(canvas,head_canvas)
        return canvas
    neutral=composite();half=composite(.5);closed=composite(0)
    for name,image in (("neutral",neutral),("half-closed-diagnostic",half),("closed",closed)):
        image.save(OUT/"qa"/(name+".png"))
    # Stable filenames for the independent quality checker.
    neutral.save(OUT/"neutral.png")
    contact=Image.new("RGB",(1600,480),(239,236,227))
    for index,(label,image) in enumerate((("LOCKED SOURCE",src),("NEUTRAL",neutral),("HALF: raster compression",half),("CLOSED",closed))):
        tile=image.crop((324,340,724,800)).resize((400,460));contact.paste(tile,(index*400,20),tile);ImageDraw.Draw(contact).text((index*400+5,5),label,fill=(30,40,30))
    contact.save(OUT/"qa/face-scarf-contact.png")
    images["Face_Base"].crop((315,315,735,645)).resize((840,660)).save(OUT/"qa/face-base-isolated.png")
    pose_contact=Image.new("RGB",(1500,510),(239,236,227));reports=[]
    neck_roi=polygon([(350,575),(705,575),(720,758),(330,758)])
    opaque_ref=src.getchannel("A").point(lambda p:255 if p>=250 else 0)
    for index,angle in enumerate((-5,0,5)):
        posed=composite(1,angle);posed.save(OUT/"qa"/(f"tilt-{angle:+d}.png"))
        exposure=intersect(opaque_ref,neck_roi,posed.getchannel("A").point(lambda p:255 if p<220 else 0))
        exposure.save(OUT/"qa"/(f"tilt-{angle:+d}-neck-exposure-mask.png"))
        marked=posed.copy();red=Image.new("RGBA",(W,H),(235,35,45,0));red.putalpha(exposure.point(lambda p:180 if p else 0));marked=Image.alpha_composite(marked,red)
        tile=marked.crop((275,500,775,990));pose_contact.paste(tile,(index*500,20),tile);ImageDraw.Draw(pose_contact).text((index*500+5,5),f"Raster diagnostic {angle:+d} deg",fill=(30,40,30))
        reports.append({"angle":angle,"neckExposurePixels":sum(exposure.histogram()[1:]),"neckExposureBounds":exposure.getbbox()})
    pose_contact.save(OUT/"qa/tilt-coverage-contact.png")
    difference=ImageChops.difference(src,neutral)
    report={"type":"PROGRAMMATIC_RASTER_DIAGNOSTIC_NOT_CUBISM","neutralMeanRgbaDifference":ImageStat.Stat(difference).mean,"neutralMaxRgbaDifference":[item[1] for item in difference.getextrema()],"tilts":reports,"halfClosedMethod":"50 percent vertical raster compression of matching eye/cross about fixed eye centers; diagnostic only, not Cubism keyforms. Closed arcs are shown only at fully closed.","sourceSha256":EXPECTED_SHA}
    (OUT/"qa/diagnostic-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def repair_cross_from_r2():
    """Repair only the four eye/cross PNGs in a new copy of frozen r2.

    Run with the existing quality venv (numpy + scikit-image). The repair keeps
    every original ivory stitch component, including disconnected shaded arms.
    """
    import shutil
    import numpy as np
    from skimage.restoration import inpaint
    base=ROOT/"output/forest-spirit-production-v2/front-v8/face/revisions/r2"
    if OUT==base or OUT.exists():
        raise SystemExit("Cross repair requires a new revision directory; frozen r2 is read-only")
    shutil.copytree(base,OUT)
    source=Image.open(SOURCE).convert("RGBA"); rgb=source.convert("RGB")
    assert digest(SOURCE)==EXPECTED_SHA
    data=json.loads((OUT/"head-stage.metadata.json").read_text(encoding="utf-8"))
    items={item["id"]:item for item in data["layers"]}
    audit={"type":"SOURCE_LAYER_CROSS_REPAIR_NOT_CUBISM","parentRevision":"r2","sourceSha256":EXPECTED_SHA,"sourceRgbPreservedInCross":True,"eyes":{}}
    for side,eye_box,cross_box in (("R",(390,432,462,533),(410,459,442,494)),("L",(590,432,663,533),(610,459,642,494))):
        # All components, rather than the previous largest-component heuristic.
        light=blank();pixels=rgb.load();mask_pixels=light.load()
        for y in range(cross_box[1],cross_box[3]):
            for x in range(cross_box[0],cross_box[2]):
                r,g,b=pixels[x,y]
                if r>205 and g>180 and b>145:mask_pixels[x,y]=255
        connected=light.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
        # Include the original stitch's tiny cast-shadow rim so it is removed
        # with the ivory cross, rather than leaving an engraved dark plus below.
        complete=connected.filter(ImageFilter.MaxFilter(7))
        complete=intersect(complete,polygon([(cross_box[0],cross_box[1]),(cross_box[2]-1,cross_box[1]),(cross_box[2]-1,cross_box[3]-1),(cross_box[0],cross_box[3]-1)]))
        open_image=Image.open(base/items[f"Eye_{side}_Open"]["path"]).convert("RGBA")
        center_x=426 if side=="R" else 626
        # A clean original brown stitch patch below the plus, copied locally.
        # Boundary interpolation through the old raised-stitch shadow would
        # preserve a dark cross-shaped dent, so it is intentionally not used.
        colors=cloth_patch(rgb,complete,(center_x-9,498,center_x+6,510),False)
        colors.putalpha(open_image.getchannel("A"));open_image=colors
        cross_image=source.copy();cross_image.putalpha(complete)
        patch_path=f"patches/Eye_{side}_Open-complete-cross-removal-mask.png"
        complete.save(OUT/patch_path)
        for name,image in ((f"Eye_{side}_Open",open_image),(f"Eye_{side}_Cross",cross_image)):
            item=items[name];image.save(OUT/item["path"]);image.getchannel("A").save(OUT/item["mask"])
            item["sha256"]=digest(OUT/item["path"]);item["alphaPixels"]=sum(image.getchannel("A").histogram()[1:])
            item["patchMasks"]=[patch_path]
            item["source"]=("Original brown oval; complete cross and its cast-shadow rim replaced only within the declared mask using a neighboring original brown stitch patch" if name.endswith("_Open") else "All original ivory plus-stitch components and natural edge shading; original RGB copied without whitening")
            source_visible=source.copy()
            source_visible.putalpha(intersect(image.getchannel("A"),source.getchannel("A")))
            source_visible.save(OUT/item["sourceVisible"])
        combined=Image.alpha_composite(open_image,cross_image)
        images_to_show=[("SOURCE",source),("OPEN ALONE",open_image),("CROSS ALONE",cross_image),("OPEN + CROSS",combined)]
        tw=(eye_box[2]-eye_box[0])*4;th=(eye_box[3]-eye_box[1])*4
        contact=Image.new("RGBA",(tw*4,th+30),(65,72,63,255))
        for index,(label,image) in enumerate(images_to_show):
            tile=image.crop(eye_box).resize((tw,th),Image.Resampling.NEAREST)
            contact.alpha_composite(tile,(index*tw,30));ImageDraw.Draw(contact).text((index*tw+5,6),label,fill="white")
            tile.save(OUT/"qa"/(f"Eye_{side}-{label.lower().replace(' ','-').replace('+','plus')}-400pct.png"))
        contact.save(OUT/"qa"/(f"Eye_{side}-source-layer-contact-400pct.png"))
        expected=[];missing_old=[];missing_new=[];left_in_open=[];cross_color_errors=[]
        old_cross=Image.open(base/items[f"Eye_{side}_Cross"]["path"]).convert("RGBA")
        for y in range(cross_box[1],cross_box[3]):
            for x in range(cross_box[0],cross_box[2]):
                r,g,b,_=source.getpixel((x,y))
                if r>205 and g>180 and b>145:
                    expected.append([x,y])
                    if old_cross.getpixel((x,y))[3]<128:missing_old.append([x,y])
                    if cross_image.getpixel((x,y))[3]<128:missing_new.append([x,y])
                rr,gg,bb,aa=open_image.getpixel((x,y))
                if complete.getpixel((x,y)) and aa>128 and rr>205 and gg>180 and bb>145:left_in_open.append([x,y])
                if complete.getpixel((x,y)) and cross_image.getpixel((x,y))[:3]!=source.getpixel((x,y))[:3]:cross_color_errors.append([x,y])
        audit["eyes"][side]={"fixedCrossRoi":cross_box,"sourceLightStitchPixels":len(expected),"r2MissingLightStitchPixels":len(missing_old),"correctedMissingLightStitchPixels":len(missing_new),"lightStitchPixelsRemainingInBrownOpenLayer":len(left_in_open),"crossRgbPixelsChangedFromSource":len(cross_color_errors),"crossAlphaBbox":cross_image.getchannel("A").getbbox(),"missingOldCoordinates":missing_old}
    unchanged=[];changed=[]
    for item in data["layers"]:
        (unchanged if digest(base/item["path"])==digest(OUT/item["path"]) else changed).append(item["id"])
    audit["changedLayerIds"]=changed;audit["unchangedLayerIds"]=unchanged
    data["status"]="complete_original_cross_source_repaired_pending_editor_reimport"
    data["revisionParent"]="r2";data["revisionReason"]="Fix disconnected cross arms left by largest-component extraction; only four eye/cross PNGs changed"
    for filename in ("head-stage.metadata.json","metadata.json"):
        (OUT/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    images={item["id"]:Image.open(OUT/item["path"]).convert("RGBA") for item in data["layers"]}
    render_previews(data,images,source)
    (OUT/"qa/cross-source-repair-audit.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"revision":str(OUT),"eyes":{key:{k:v for k,v in value.items() if k!="missingOldCoordinates"} for key,value in audit["eyes"].items()},"changedLayers":changed,"unchangedLayerCount":len(unchanged)},ensure_ascii=False,indent=2))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overwrite",action="store_true",help="Explicitly regenerate existing draft pixels after coordinating import")
    parser.add_argument("--revision",help="Write to a separate revision directory, for example r3; never overwrites a frozen import revision implicitly")
    parser.add_argument("--qa-only",action="store_true",help="Read existing revision layers and update only diagnostic previews, never production pixels or metadata")
    parser.add_argument("--cross-fix-from-r2",action="store_true",help="Use quality venv to make a new r2-derived revision changing only the four original eye/cross pixels")
    args=parser.parse_args()
    if args.revision:
        if not args.revision.startswith("r") or not args.revision[1:].isdigit():
            raise SystemExit("Revision must be r followed by digits")
        if args.revision=="r2":
            raise SystemExit("r2 is the frozen import revision; create a later revision")
        OUT=OUT/"revisions"/args.revision
    if args.cross_fix_from_r2:
        if not args.revision:raise SystemExit("Cross repair needs --revision r8 or later")
        repair_cross_from_r2()
    elif args.qa_only:
        data=json.loads((OUT/"head-stage.metadata.json").read_text(encoding="utf-8"))
        images={entry["id"]:Image.open(OUT/entry["path"]).convert("RGBA") for entry in data["layers"]}
        render_previews(data,images,Image.open(SOURCE).convert("RGBA"))
    elif (OUT/"head-stage.metadata.json").exists() and not args.overwrite:
        raise SystemExit("Existing draft detected; coordinate import before --overwrite.")
    else:
        run()
