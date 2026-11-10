"""Local hidden sleeve continuity and peplum contour candidate, retaining neutral pixels."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.morphology import convex_hull_image, disk


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--transfer-forearm", action="store_true")
    args = ap.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    meta_path = root / "fullbody/revisions/b12-combined-source-r2/fullbody.metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    rows = {x["id"]: x for x in meta["layers"]}
    images = {name: np.array(Image.open(meta_path.parent / row["path"]).convert("RGBA")) for name, row in rows.items()}
    original = {name: im.copy() for name, im in images.items()}
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    for folder in ("layers", "masks", "qa"):
        (out / folder).mkdir(parents=True, exist_ok=True)
    transfer_report = None
    if args.transfer_forearm:
        mask_path = root / "fullbody/candidates/b12-arm-waist/r4/masks/Arm_R_Upper-ownership-transfer.png"
        transfer = np.array(Image.open(mask_path).convert("L")) > 0
        assert int(transfer.sum()) == 708
        b11_upper = np.array(Image.open(root / "fullbody/revisions/b11/layers/Arm_R_Upper.png").convert("RGBA"))
        images["Arm_R_Lower"][transfer] = images["Arm_R_Upper"][transfer]
        images["Arm_R_Upper"][transfer] = b11_upper[transfer]
        Image.fromarray(transfer.astype(np.uint8)*255).save(out / "masks/original-sleeve-Upper-to-Lower-ownership-transfer.png")
        transfer_report = {"pixels":708,"from":"Arm_R_Upper","to":"Arm_R_Lower","sourceMask":str(mask_path),"sourceMaskSha256":sha(mask_path),"reason":"Remove artificial horizontal y929 split of one continuous original forearm sleeve patch; restore original complete upper-arm capsule beneath it"}
    opaque_above, coverage = {}, np.zeros((1620, 971), dtype=bool)
    for row in sorted(meta["layers"], key=lambda r: r["order"], reverse=True):
        opaque_above[row["id"]] = coverage.copy()
        if row.get("visible", True):
            coverage |= images[row["id"]][:, :, 3] == 255
    reports = []
    arm_regions = (("Arm_R_Upper", (165, 865, 250, 954), (70, 0)), ("Arm_R_Lower", (157, 865, 295, 954), (65, 0))) if args.transfer_forearm else (("Arm_R_Upper", (165, 865, 250, 954), (70, 0)), ("Arm_R_Lower", (157, 880, 250, 954), (65, 0)))
    for name, box, shift in arm_regions:
        old = images[name].copy()
        alpha = old[:, :, 3]
        hull = convex_hull_image(alpha > 127)
        roi = np.zeros(alpha.shape, dtype=bool)
        x0, y0, x1, y1 = box
        roi[y0:y1, x0:x1] = True
        allowed = opaque_above[name] & roi
        joint_copy = np.zeros(alpha.shape, dtype=bool)
        if args.transfer_forearm and name == "Arm_R_Lower":
            # A forearm root needs continuous overlap under the upper sleeve.
            # Copy the exact existing back-layer composite at these empty texels,
            # rather than painting a new visible colour into the neutral image.
            joint_copy = hull & roi & (alpha == 0) & (images["Arm_R_Upper"][:, :, 3] == 255) & ~allowed
        # Complete local negative cuts inside the sleeve's measured original outline.
        fill = hull & allowed & (alpha < 255)
        ys, xs = np.where(fill)
        sy, sx = ys + shift[1], xs + shift[0]
        # Fall back only to a nearest solid native sleeve texel if the selected
        # translated donor touches its true silhouette. No transparent RGB sampled.
        bad_donor = old[sy, sx, 3] != 255
        if np.any(bad_donor):
            _, nearest_donor = ndimage.distance_transform_edt(old[:, :, 3] != 255, return_indices=True)
            new_sy = nearest_donor[0][sy[bad_donor], sx[bad_donor]]
            new_sx = nearest_donor[1][sy[bad_donor], sx[bad_donor]]
            sy[bad_donor], sx[bad_donor] = new_sy, new_sx
        assert np.all(old[sy, sx, 3] == 255)
        rgb = old[sy, sx, :3].astype(float)
        # Per-row low-frequency matching uses nearest solid native cloth, not a generated face/body.
        native = (alpha == 255) & roi
        _, nearest = ndimage.distance_transform_edt(~native, return_indices=True)
        nearby = old[nearest[0][ys, xs], nearest[1][ys, xs], :3].astype(float)
        adjustment = np.clip(np.median(nearby - rgb, axis=0), -12, 12) if len(rgb) else np.zeros(3)
        images[name][ys, xs, :3] = np.clip(np.rint(rgb + adjustment), 0, 255).astype(np.uint8)
        images[name][ys, xs, 3] = 255
        if joint_copy.any():
            backing = Image.new("RGBA", (971,1620))
            for row in sorted(meta["layers"], key=lambda r:r["order"]):
                if row["order"] >= rows[name]["order"]: break
                if row.get("visible",True):backing.alpha_composite(Image.fromarray(images[row["id"]]))
            backing_array=np.array(backing)
            assert np.all(backing_array[joint_copy,3]==255)
            images[name][joint_copy]=backing_array[joint_copy]
        Image.fromarray(joint_copy.astype(np.uint8)*255).save(out/f"masks/{name}-exact-existing-cloth-joint-overlap.png")
        Image.fromarray(fill.astype(np.uint8) * 255).save(out / f"masks/{name}-hidden-fill.png")
        Image.fromarray(allowed.astype(np.uint8) * 255).save(out / f"masks/{name}-allowed-neutral-occluded.png")
        reports.append({"id": name, "filledPixels": int(fill.sum()),"exactExistingClothJointOverlapPixels":int(joint_copy.sum()), "roi": box, "sourceDonorShiftXY": shift,"nearestSolidDonorPixels":int(bad_donor.sum()), "rgbOffsetOnlyInsideFill": adjustment.tolist(), "method": "Native sleeve texture copied within neutral occlusion plus separately recorded exact existing back-cloth overlap", "requiresVisualMaterialReview": True})
    name = "Peplum_R"
    old = original[name]
    cuff_transfer = np.zeros((1620,971), dtype=bool)
    if args.transfer_forearm:
        # The remaining gray cuff loops were misassigned to the waist. Select
        # their original visible cloth texels, not a rectangular paint patch.
        region=Image.new('L',(971,1620));ImageDraw.Draw(region).polygon([(271,985),(285,987),(285,997),(279,1008),(270,1019),(254,1024),(244,1020),(254,1009),(264,997)],fill=255)
        peplum_visible=np.array(Image.open(meta_path.parent/rows[name]['sourceVisible']).convert('RGBA'))
        rgb=old[:,:,:3].astype(int)
        cuff_transfer=(np.array(region)>0)&(old[:,:,3]==255)&(peplum_visible[:,:,3]>0)&(rgb[:,:,0]-rgb[:,:,1]<10)&(rgb[:,:,1]-rgb[:,:,2]<32)
        images['Arm_R_Lower'][cuff_transfer]=old[cuff_transfer]
        donor_path=root/'fullbody/candidates/b12-arm-waist/donor-r3/donor-registration/peplum-outer-right-edge-cleaned.png'
        donor=np.array(Image.open(donor_path).convert('RGBA'));assert donor.shape==(148,152,4)
        dy,dx=np.where(cuff_transfer)
        images[name][dy,dx]=donor[dy-900,dx-230]
        Image.fromarray(cuff_transfer.astype(np.uint8)*255).save(out/'masks/original-cuff-Peplum-to-Lower-ownership-transfer.png')
        # The donor is only an interior texture source here: its wider outline
        # must not leave isolated olive copies of the removed cuff loops.
        contour_before=images[name][:,:,3].copy()
        for cy in range(985,1006):
            boundary=float(np.interp(cy+.5,[981,987,993,1000,1008],[289,283,278,272,266]))
            for cx in range(260,292):
                if opaque_above[name][cy,cx] or cuff_transfer[cy,cx]:
                    factor=np.clip(cx+1-boundary,0,1)
                    images[name][cy,cx,3]=min(int(images[name][cy,cx,3]),int(round(255*factor)))
        contour_change=images[name][:,:,3]!=contour_before
        Image.fromarray(contour_change.astype(np.uint8)*255).save(out/'masks/Peplum_R-transferred-cuff-hidden-contour-trim.png')
        reports.append({'id':'Peplum_R','contourChangedPixels':int(contour_change.sum()),'method':'Continuous measured original waist slope after gray cuff ownership transfer; alpha only, restricted to original opaque overdraw or new opaque cuff'})
        reports.append({'id':'Peplum_R','originalGrayCuffTransferredPixels':int(cuff_transfer.sum()),'destination':'Arm_R_Lower','regionPolygon':[(271,985),(285,987),(285,997),(279,1008),(270,1019),(254,1024),(244,1020),(254,1009),(264,997)],'hiddenWaistDonor':str(donor_path),'hiddenWaistDonorSha256':sha(donor_path),'method':'Transfer exact existing opaque gray cuff pixels to forearm; reuse previously registered waist donor only under that now-opaque cuff mask'})
    allowed = opaque_above[name]
    roi = np.zeros((1620, 971), dtype=bool); roi[976:1030, 238:298] = True
    solid = old[:, :, 3] > 127
    opened = ndimage.binary_opening(solid, structure=disk(3))
    # Trim only source-hidden contour protrusions; no extension into exterior background.
    trim = solid & ~opened & allowed & roi
    images[name][trim & ~cuff_transfer] = 0
    Image.fromarray(trim.astype(np.uint8) * 255).save(out / f"masks/{name}-hidden-contour-trim.png")
    reports.append({"id": name, "trimmedPixels": int(trim.sum()), "roi": [238, 976, 298, 1030], "method": "Radius3 local contour opening only where neutral overlying art is fully opaque; native donor weave and original visible texels unchanged", "requiresVisualMaterialReview": True})

    def composite(items):
        im = Image.new("RGBA", (971, 1620))
        for row in sorted(meta["layers"], key=lambda r: r["order"]):
            if row.get("visible", True):
                im.alpha_composite(Image.fromarray(items[row["id"]]))
        return im

    before, after = composite(original), composite(images)
    diff = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    before.save(out / "qa/b12-neutral.png"); after.save(out / "qa/b13-neutral.png")
    assert not np.any(diff), "Do not alter neutral visible production pixels"
    for row in meta["layers"]:
        old_path = (meta_path.parent / row["path"]).resolve()
        assert sha(old_path) == row["sha256"]
        row["path"] = str(old_path)
        for key in ("sourceVisible", "sourceVisiblePath", "mask", "sourceMask"):
            if row.get(key):
                row[key] = str((meta_path.parent / row[key]).resolve())
        if row["id"] in {r["id"] for r in reports}:
            name = row["id"]; p = out / f"layers/{name}.png"
            Image.fromarray(images[name]).save(p)
            row["path"] = str(p); row["sha256"] = sha(p); row["status"] = "b13_hidden_sleeve_and_waist_candidate_not_native_validated"
        if args.transfer_forearm and row["id"] in {"Arm_R_Upper","Arm_R_Lower"}:
            sv=np.array(Image.open(row["sourceVisible"]).convert("RGBA"))
            if row["id"]=="Arm_R_Upper":sv[transfer]=0
            else:
                master=np.array(Image.open(repo/"output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png").convert("RGBA"));sv[transfer]=master[transfer]
                sv[cuff_transfer]=master[cuff_transfer]
            p=out/f"layers/{row['id']}-source-visible-evidence.png";Image.fromarray(sv).save(p)
            row["sourceVisible"]=row["sourceVisiblePath"]=str(p)
        if args.transfer_forearm and row['id']=='Peplum_R':
            sv=np.array(Image.open(row['sourceVisible']).convert('RGBA'));sv[cuff_transfer]=0
            p=out/f"layers/{row['id']}-source-visible-evidence.png";Image.fromarray(sv).save(p);row['sourceVisible']=row['sourceVisiblePath']=str(p)
    meta.update(status="b13_hidden_sleeve_and_waist_source_candidate", productionAccepted=False, modelAccepted=False)
    (out / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, box in (("Arm_R_Upper", (150, 850, 370, 990)), ("Arm_R_Lower", (140, 860, 350, 1030)), ("Peplum_R", (230, 960, 330, 1040))):
        w, h = box[2]-box[0], box[3]-box[1]
        sheet = Image.new("RGB", (w*2, h+25), (224,234,216)); dr=ImageDraw.Draw(sheet)
        for i, (items, label) in enumerate(((original, "b12 source"), (images, "b13 hidden-source candidate"))):
            crop = Image.alpha_composite(Image.new("RGBA", (971,1620),(224,234,216,255)), Image.fromarray(items[name])).convert("RGB").crop(box)
            sheet.paste(crop,(i*w,25));dr.text((i*w+2,6),label,fill="black")
        sheet.save(out/f"qa/{name}-before-after.png")
    report={"scope":"Masked local source candidate only; existing mesh/rig not edited and no model pose acceptance", "baseMetadata":str(meta_path),"baseMetadataSha256":sha(meta_path),"scriptSha256":sha(Path(__file__)),"ownershipTransfer":transfer_report,"layers":reports,"neutralRgbaChangedPixels":int(np.any(diff,axis=2).sum()),"neutralMaximumRgbaDifference":diff.max(axis=(0,1)).tolist(),"productionAccepted":False,"nativeModelWritten":False,"pending":["Actual local source material and contour inspection", "Append source mesh coverage and all parent-local Forms for added alpha", "HatTouch and Pickup actual Core frames; joint continuity cannot be inferred from this source composite", "Separate inverse-Cape mask/draw-order candidate for original braid-tie end occlusion"]}
    (out/"source-refinement-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


if __name__ == "__main__":
    main()
