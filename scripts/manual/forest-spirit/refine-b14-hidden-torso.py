"""Candidate-only original sleeve ownership and narrow hidden torso contour repair."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import distance_transform_edt


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    metadata_path = root / "fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json"
    assert sha(metadata_path) == "2375cd52b9cff8e598eb81ced977aaa52802268cc7b09eb20a55143c85a0f440"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    rows = {row["id"]: row for row in metadata["layers"]}
    old = {name: np.array(Image.open(metadata_path.parent / row["path"]).convert("RGBA")) for name, row in rows.items()}
    images = {name: data.copy() for name, data in old.items()}
    changed_ids = ["Bodice_Olive", "Arm_R_Upper", "Body_Base"]
    visible = {name: np.array(Image.open(metadata_path.parent / rows[name]["sourceVisible"]).convert("RGBA")) for name in changed_ids}
    visible_before = {name: data.copy() for name, data in visible.items()}
    master_path = root.parent / "front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
    master = np.array(Image.open(master_path).convert("RGBA"))
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    for directory in ["layers", "source-visible", "masks", "qa"]:
        (out / directory).mkdir(parents=True, exist_ok=True)
    yy, xx = np.mgrid[:1620, :971]
    polygon = Image.new("L", (971, 1620))
    ImageDraw.Draw(polygon).polygon([(358, 881), (366, 884), (362, 897), (357, 908), (350, 916), (344, 915), (346, 902), (352, 890)], fill=255)
    color = old["Bodice_Olive"][:, :, :3].astype(int)
    transfer = (np.array(polygon) > 0) & (visible["Bodice_Olive"][:, :, 3] > 0) & (old["Arm_R_Upper"][:, :, 3] == 0)
    transfer &= (color[:, :, 0] - color[:, :, 1] <= 12) & (color[:, :, 1] >= 56) & (color[:, :, 1] - color[:, :, 2] >= 12)
    assert transfer.any()
    assert np.array_equal(old["Bodice_Olive"][:, :, :3][transfer], master[:, :, :3][transfer])
    images["Arm_R_Upper"][transfer] = old["Bodice_Olive"][transfer]
    visible["Arm_R_Upper"][transfer] = visible["Bodice_Olive"][transfer]
    visible["Bodice_Olive"][transfer] = 0
    # Local cloth donor from the adjacent already reconstructed olive weave, same Y,
    # 18 source pixels left. Only the newly occluded transferred sleeve region is painted.
    donor_x = np.maximum(xx - 18, 0)
    donor_y = yy.copy()
    valid_donor = (xx >= 328) & (xx < 350) & (yy >= 878) & (yy < 933)
    valid_donor &= (old["Bodice_Olive"][:, :, 3] == 255) & (color[:, :, 0] - color[:, :, 1] >= 12)
    distances, nearest = distance_transform_edt(~valid_donor, return_indices=True)
    fallback = transfer & ~valid_donor[donor_y, donor_x]
    assert float(distances[transfer].max()) <= 25
    donor_y[fallback], donor_x[fallback] = nearest[0][fallback], nearest[1][fallback]
    donor = old["Bodice_Olive"][donor_y, donor_x, :3]
    assert np.all(valid_donor[donor_y[transfer], donor_x[transfer]])
    images["Bodice_Olive"][transfer, :3] = donor[transfer]
    images["Bodice_Olive"][transfer, 3] = 255
    # Narrow, smooth body-exterior boundary. This clips a concealed angular flare;
    # it does not fill the natural outside-body background or change visible source.
    roi = (320, 880, 375, 935)
    curve = PchipInterpolator([878, 887, 899, 912, 923, 935], [329, 330, 331, 335, 339, 351])
    boundary = curve(np.clip(yy + .5, 878, 935))
    edge_alpha = np.clip(xx + .5 - boundary + .5, 0, 1)
    in_roi = (xx >= roi[0]) & (xx < roi[2]) & (yy >= roi[1]) & (yy < roi[3])
    # Verify every potentially edited old texel is entirely occluded in neutral.
    def over_alpha(name):
        result = np.zeros((1620, 971), dtype=float)
        for row in sorted(metadata["layers"], key=lambda row: row["order"]):
            if row["order"] > rows[name]["order"] and row.get("visible", True):
                a = old[row["id"]][:, :, 3].astype(float) / 255
                result = a + result * (1 - a)
        return result
    trims = {}
    for name in ["Bodice_Olive", "Body_Base"]:
        allowed = in_roi & (visible[name][:, :, 3] == 0) & (over_alpha(name) == 1)
        new_alpha = np.minimum(images[name][:, :, 3], np.rint(edge_alpha * 255).astype(np.uint8))
        change = allowed & (new_alpha != images[name][:, :, 3])
        images[name][change, 3] = new_alpha[change]
        images[name][change & (new_alpha == 0)] = 0
        trims[name] = change
    # The skin-colored support is never intended to be exposed beside this sleeve.
    # Limit its concealed exterior alpha to the actual olive layer's continuous edge.
    body_allowed = in_roi & (over_alpha("Body_Base") == 1)
    body_new_alpha = np.minimum(images["Body_Base"][:, :, 3], images["Bodice_Olive"][:, :, 3])
    body_change = body_allowed & (body_new_alpha != images["Body_Base"][:, :, 3])
    images["Body_Base"][body_change, 3] = body_new_alpha[body_change]
    images["Body_Base"][body_change & (body_new_alpha == 0)] = 0
    trims["Body_Base"] |= body_change

    def composite(items):
        image = Image.new("RGBA", (971, 1620))
        for row in sorted(metadata["layers"], key=lambda row: row["order"]):
            if row.get("visible", True):
                image.alpha_composite(Image.fromarray(items[row["id"]]))
        return image

    before, after = composite(old), composite(images)
    delta = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    neutral_changed = int(np.any(delta, axis=2).sum())
    # Preserve a rejected candidate's evidence if this exact neutral guard fails.
    before.save(out / "qa/neutral-before.png")
    after.save(out / "qa/neutral-after.png")
    masks = {"original-sleeve-Bodice-to-Upper": transfer, "hidden-olive-under-sleeve-donor": transfer,
             "Bodice-hidden-alpha-trim": trims["Bodice_Olive"], "Body-hidden-alpha-trim": trims["Body_Base"]}
    for name, mask in masks.items():
        Image.fromarray(mask.astype(np.uint8) * 255).save(out / "masks" / f"{name}.png")
    for name in changed_ids:
        Image.fromarray(images[name]).save(out / "layers" / f"{name}.png")
        Image.fromarray(visible[name]).save(out / "source-visible" / f"{name}.png")
    qa_roi = (300, 850, 390, 945)
    panels = [("MASTER", master), ("Bodice before", old["Bodice_Olive"]), ("Bodice candidate", images["Bodice_Olive"]), ("Upper added sleeve", images["Arm_R_Upper"]), ("Body candidate", images["Body_Base"])]
    sheet = Image.new("RGB", (360 * len(panels), 405), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (label, data) in enumerate(panels):
        rgba = Image.fromarray(data)
        picture = Image.alpha_composite(Image.new("RGBA", rgba.size, (224, 234, 216, 255)), rgba).crop(qa_roi).resize((360, 380), Image.Resampling.NEAREST)
        sheet.paste(picture, (i * 360, 25)); draw.text((i * 360 + 3, 5), label, fill="black")
    sheet.save(out / "qa/torso-original-candidate-4x.png")
    subset = {"schemaVersion": 1, "characterId": "forest-spirit-front-v8", "canvas": {"width": 971, "height": 1620}, "stage": "source-candidate-subset", "layers": []}
    for name in changed_ids:
        subset["layers"].append({"id": name, "path": f"layers/{name}.png", "sha256": sha(out / "layers" / f"{name}.png"), "sourceVisible": f"source-visible/{name}.png"})
    (out / "subset.metadata.json").write_text(json.dumps(subset, indent=2) + "\n", encoding="utf-8")
    np.savez_compressed(out / "masks/hidden-olive-donor-map.npz", target_y=yy[transfer], target_x=xx[transfer], donor_y=donor_y[transfer], donor_x=donor_x[transfer])
    report = {"scope": "Original sleeve ownership and narrowly bounded hidden torso candidate; no rig or actual Core validation", "sourceMetadata": str(metadata_path), "sourceMetadataSha256": sha(metadata_path), "originalSleevePixelsTransferred": int(transfer.sum()), "neutralRgbaChangedPixels": neutral_changed, "neutralMaxDifference": int(delta.max()), "changedIds": changed_ids, "alphaTrimCounts": {n: int(m.sum()) for n, m in trims.items()}, "donor": {"source": "unchanged Bodice_Olive prior source", "mapping": "same source Y, source X minus 18 where valid; nearest local dark-olive opaque texel inside fixed [328,878,350,933] otherwise", "fallbackPixels": int(fallback.sum()), "maximumFallbackDistance": float(distances[transfer].max()), "usedOnlyUnderTransferredOriginalSleeve": True}, "sourceMasterChanged": False, "productionAcceptance": False, "scriptSha256": sha(Path(__file__))}
    (out / "repair-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    assert neutral_changed == 0, "Candidate rejected: neutral RGBA changed"


if __name__ == "__main__":
    main()
