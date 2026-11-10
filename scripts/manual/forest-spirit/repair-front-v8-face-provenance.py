"""Repair derived Face_Base provenance without editing any production PNG/model."""
from __future__ import annotations
import copy
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="output/forest-spirit-production-v2/front-v8/fullbody/provenance/b12-face-r1")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    body = root / "fullbody"
    out = (repo / args.out).resolve()
    assert out.is_relative_to(repo / "output")
    assert not out.exists()
    for d in ("historical", "derived", "qa"):
        (out / d).mkdir(parents=True, exist_ok=True)
    master_path = repo / "output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
    b8 = body / "revisions/b8"
    o3 = body / "ownership-study/o3"
    current_meta = body / "revisions/b12-combined-source-r2/fullbody.metadata.json"
    current = json.loads(current_meta.read_text(encoding="utf-8"))
    face_row = next(x for x in current["layers"] if x["id"] == "Face_Base")
    current_png = current_meta.parent / face_row["path"]
    baseline_visible = b8 / "source-visible/Face_Base.png"
    baseline_mask = b8 / "masks/Face_Base.png"
    baseline_reassign = b8 / "masks/Face_Base-original-cloth-reassigned-from-temporary-head.png"
    cheek_path = o3 / "masks/Face_Base-received-original-cheek.png"
    assert sha(master_path) == "da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
    assert sha(baseline_mask) == "fba9847b3fbc2c464c48bc3c9ba87772f57ed5778c778e49cf9b5d5d6f74c819"
    inputs = [master_path, current_meta, current_png, baseline_visible, baseline_mask, baseline_reassign, cheek_path]
    frozen_before = {str(p): sha(p) for p in inputs}
    src = np.array(Image.open(master_path).convert("RGBA"))
    old_visible = np.array(Image.open(baseline_visible).convert("RGBA"))
    production = np.array(Image.open(current_png).convert("RGBA"))
    previous = old_visible[:, :, 3] > 0
    cheek = np.array(Image.open(cheek_path).convert("L")) > 0
    assert not np.any(previous & cheek) and int(cheek.sum()) == 4361
    assert np.array_equal(src[previous, :3], old_visible[previous, :3])
    assert np.array_equal(src[cheek, :3], production[cheek, :3])
    ownership = previous | cheek
    mismatch = ownership & np.any(production[:, :, :3] != src[:, :, :3], axis=2)
    patches = np.zeros((1620, 971), dtype=bool)
    for path in face_row["patchMasks"]:
        p = current_meta.parent / path
        inputs.append(p); frozen_before[str(p)] = sha(p)
        patches |= np.array(Image.open(p).convert("L")) > 0
    assert not np.any(mismatch & ~patches), "Current source colors changed outside declared face patches"
    assert not np.any(ownership & (production[:, :, 3] == 0))
    retained = ownership & ~mismatch
    previous_reassign = np.array(Image.open(baseline_reassign).convert("L")) > 0
    masks = {
        "Face_Base-derived-current-source-ownership-mask.png": ownership,
        "Face_Base-derived-current-retained-original-rgb-mask.png": retained,
        "Face_Base-derived-current-production-alpha-mask.png": production[:, :, 3] > 0,
        "Face_Base-derived-original-source-replaced-by-declared-patches-mask.png": mismatch,
        "Face_Base-derived-current-reassignment-union-mask.png": previous_reassign | cheek,
        "Face_Base-derived-production-alpha-normalization-mask.png": ownership & (production[:, :, 3] != src[:, :, 3]),
    }
    for name, mask in masks.items():
        Image.fromarray(mask.astype(np.uint8) * 255).save(out / "derived" / name)
    derived_visible = np.zeros_like(src)
    derived_visible[ownership] = src[ownership]
    Image.fromarray(derived_visible).save(out / "derived/Face_Base-derived-current-source-visible.png")
    for p, name in ((baseline_mask, "b8-Face_Base-production-mask-original.png"), (baseline_visible, "b8-Face_Base-source-visible-original.png"), (baseline_reassign, "b8-Face_Base-original-cloth-reassignment-mask.png"), (cheek_path, "o3-Face_Base-received-original-cheek-original.png")):
        shutil.copyfile(p, out / "historical" / name)
        assert sha(p) == sha(out / "historical" / name)
    chain = []
    for label, p in (("b8", b8 / "fullbody-with-r9.metadata.json"), ("a6", body / "arm-study/a6/metadata.json"), ("o3", o3 / "metadata.json"), ("b9", body / "revisions/b9/fullbody-with-r9.metadata.json"), ("b10", body / "revisions/b10/fullbody-with-r9.metadata.json"), ("b11", body / "revisions/b11/fullbody-with-r9.metadata.json"), ("b12", current_meta)):
        data = json.loads(p.read_text(encoding="utf-8"))
        row = next(x for x in data["layers"] if x["id"] == "Face_Base")
        layer_path = p.parent / row["path"]
        assert sha(layer_path) == row["sha256"]
        chain.append({"revision": label, "metadata": str(p), "metadataSha256": sha(p), "layer": str(layer_path), "layerSha256": sha(layer_path), "inheritedMaskReference": row.get("mask"), "sourceVisibleReference": row.get("sourceVisible")})
        frozen_before[str(p)] = sha(p); frozen_before[str(layer_path)] = sha(layer_path)
    assert chain[0]["layerSha256"] == chain[1]["layerSha256"]
    assert len({r["layerSha256"] for r in chain[2:]}) == 1
    # A separate delivery manifest repairs references. Existing b12 input/hash is untouched.
    delivery = copy.deepcopy(current)
    delivery["combinedSourceProvenance"] = str((current_meta.parent / current["combinedSourceProvenance"]).resolve())
    delivery["donorReports"] = [str((current_meta.parent / p).resolve()) for p in current["donorReports"]]
    for row in delivery["layers"]:
        for key in ("path", "sourceVisible", "sourceVisiblePath", "sourceMask", "mask", "sourceReassignmentMask", "uncompletedOcclusionMask", "alphaCleanupMask"):
            if row.get(key) and isinstance(row[key], str):
                row[key] = str((current_meta.parent / row[key]).resolve())
        for key in ("patchMasks", "localRevisionMasks", "historicalSupersededRevisionMasks", "activeB12ChangeMasks"):
            if isinstance(row.get(key), list):
                row[key] = [str((current_meta.parent / p).resolve()) for p in row[key] if p]
        if row["id"] == "Face_Base":
            row.update(mask=str(out / "derived/Face_Base-derived-current-production-alpha-mask.png"),
                       sourceMask=str(out / "derived/Face_Base-derived-current-source-ownership-mask.png"),
                       sourceVisible=str(out / "derived/Face_Base-derived-current-source-visible.png"),
                       sourceVisiblePath=str(out / "derived/Face_Base-derived-current-source-visible.png"),
                       sourceReassignmentMask=str(out / "derived/Face_Base-derived-current-reassignment-union-mask.png"),
                       retainedOriginalRgbMask=str(out / "derived/Face_Base-derived-current-retained-original-rgb-mask.png"),
                       sourcePixelCount=int(ownership.sum()), retainedOriginalRgbPixelCount=int(retained.sum()),
                       provenanceStatus="derived_current_masks_reconstructed_from_actual_b8_source_extraction_and_original_o3_transfer_no_production_pixels_changed")
    delivery["provenanceCorrection"] = {"report": str(out / "provenance-report.json"), "originalFrozenMetadata": str(current_meta), "originalFrozenMetadataSha256": sha(current_meta), "productionPixelChanges": 0, "notANewModelInput": True}
    delivery_path = out / "fullbody.provenance-corrected.metadata.json"
    delivery_path.write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    canvas = Image.new("RGB", (397 * 4, 320), "white")
    draw = ImageDraw.Draw(canvas)
    roi = (326, 343, 723, 631)
    labels = ["Original ownership before o3", "o3 cheek transfer (4361 px)", "Derived current source RGB", "Production Face_Base, unchanged"]
    cheek_visible = np.zeros_like(src); cheek_visible[cheek] = src[cheek]
    for i, arr in enumerate((old_visible, cheek_visible, derived_visible, production)):
        image = Image.alpha_composite(Image.new("RGBA", (971, 1620), (224, 234, 216, 255)), Image.fromarray(arr)).convert("RGB").crop(roi)
        canvas.paste(image, (i * 397, 32)); draw.text((i * 397 + 3, 8), labels[i], fill="black")
    canvas.save(out / "qa/face-source-provenance-contact.png")
    report = {"scope": "Derived current ownership evidence only; frozen production PNG, PSD and CMO inputs are unchanged", "script": str(Path(__file__).resolve()), "scriptSha256": sha(Path(__file__).resolve()), "chain": chain,
              "historicalMissingReference": str(body / "revisions/b11/masks/Face_Base.png"), "missingHistoricalFileWasNotFabricated": True,
              "baselineProductionMaskPixels": int((np.array(Image.open(baseline_mask).convert("L")) > 0).sum()),
              "baselineOriginalSourceOwnershipPixels": int(previous.sum()), "o3OriginalCheekPixels": int(cheek.sum()), "ownershipIntersectionPixels": 0,
              "derivedCurrentOriginalOwnershipPixels": int(ownership.sum()), "retainedOriginalRgbInCurrentProductionPixels": int(retained.sum()),
              "originalSourcePixelsReplacedByDeclaredFeatureOrHiddenPatches": int(mismatch.sum()), "unexplainedOriginalRgbReplacementPixels": int((mismatch & ~patches).sum()),
              "all4361TransferredCheekRgbExactlyMatchLockedMaster": True, "derivedSourceVisibleRgbAndAlphaExactlyMatchMasterInsideOwnership": bool(np.array_equal(derived_visible[ownership], src[ownership])),
              "productionLayerSha256": sha(current_png), "frozenMetadataSha256": sha(current_meta), "deliveryMetadata": str(delivery_path), "deliveryMetadataSha256": sha(delivery_path),
              "inputs": [{"path": p, "sha256": h} for p, h in frozen_before.items()], "allInputsUnchanged": all(sha(Path(p)) == h for p, h in frozen_before.items()),
              "interpretation": ["Historical b8 mask is production coverage, not proof that every underlying texel remains original.", "Derived source-visible records original pixel provenance before declared feature-removal patches; it is not the production Face_Base PNG.", "Derived retained-original-rgb mask identifies the subset actually unchanged in current production.", "New metadata repairs provenance references only; current source/coverage/native input hashes remain frozen."], "modelWritten": False, "productionAccepted": False}
    (out / "provenance-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("derivedCurrentOriginalOwnershipPixels", "retainedOriginalRgbInCurrentProductionPixels", "originalSourcePixelsReplacedByDeclaredFeatureOrHiddenPatches", "unexplainedOriginalRgbReplacementPixels", "allInputsUnchanged", "deliveryMetadata")}))


if __name__ == "__main__":
    main()
