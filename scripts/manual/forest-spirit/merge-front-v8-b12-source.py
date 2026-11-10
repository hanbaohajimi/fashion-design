"""Freeze disjoint b12 local source revisions as 72 real layers; no model acceptance."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def rgba(p: Path):
    a = np.array(Image.open(p).convert("RGBA"))
    assert a.shape == (1620, 971, 4)
    return a


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm-metadata", type=Path, required=True)
    parser.add_argument("--neck", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    base_meta = repo / "output/forest-spirit-production-v2/front-v8/fullbody/revisions/b11/fullbody-with-r9.metadata.json"
    arm_meta = args.arm_metadata.resolve()
    neck = args.neck.resolve()
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    source_files = {base_meta, arm_meta, neck / "donor-integration-report.json"}
    original = read(base_meta)
    merged = copy.deepcopy(read(arm_meta))
    assert merged["canvas"] == original["canvas"] == {"width": 971, "height": 1620}
    assert merged["characterId"] == original["characterId"] == "forest-spirit-front-v8"
    assert len(merged["layers"]) == len(original["layers"]) == 72
    old_by_id = {x["id"]: x for x in original["layers"]}
    assert set(old_by_id) == {x["id"] for x in merged["layers"]}
    old_images, final_images, evidence, changes, missing_historical_evidence = {}, {}, [], [], []
    neck_report = read(neck / "donor-integration-report.json")
    neck_entries = {x["layerId"]: x for x in neck_report["donors"]}
    assert neck_report["baseMetadataSha256"] == sha(base_meta)
    assert set(neck_entries) == {"Hair_BackMass", "Scarf_Back"}
    for folder in ("layers", "source-visible", "evidence", "qa"):
        (out / folder).mkdir(parents=True, exist_ok=True)

    def copy_evidence(value, part, field):
        if isinstance(value, list):
            return [copy_evidence(v, part, f"{field}-{i}") for i, v in enumerate(value)]
        if not isinstance(value, str) or not value.lower().endswith(".png"):
            return value
        source = Path(value)
        source = source if source.is_absolute() else arm_meta.parent / source
        if not source.is_file():
            assert field not in {"sourceVisible", "sourceVisiblePath"}, source
            missing_historical_evidence.append({"id": part, "field": field, "inheritedMissingPath": str(source), "status": "not_copied_not_fabricated"})
            return None
        destination = out / ("source-visible" if field in {"sourceVisible", "sourceVisiblePath"} else "evidence") / f"{part}-{field}.png"
        shutil.copyfile(source, destination)
        assert sha(source) == sha(destination)
        source_files.add(source)
        evidence.append({"source": str(source), "sha256": sha(source), "copy": str(destination.relative_to(out))})
        return destination.relative_to(out).as_posix()

    for row in merged["layers"]:
        name = row["id"]
        old_path = Path(old_by_id[name]["path"])
        old_path = old_path if old_path.is_absolute() else base_meta.parent / old_path
        candidate_path = Path(row["path"])
        candidate_path = candidate_path if candidate_path.is_absolute() else arm_meta.parent / candidate_path
        assert sha(old_path) == old_by_id[name]["sha256"] and sha(candidate_path) == row["sha256"]
        source_files.update((old_path, candidate_path))
        old = rgba(old_path)
        candidate = rgba(candidate_path)
        arm_diff = np.any(candidate != old, axis=2)
        neck_diff = np.zeros((1620, 971), dtype=bool)
        if name in neck_entries:
            neck_path = neck / "layers" / f"{name}.png"
            neck_mask_path = neck / "masks" / f"{name}-all-changes.png"
            source_files.update((neck_path, neck_mask_path))
            assert sha(neck_path) == neck_entries[name]["outputSha256"]
            neck_image = rgba(neck_path)
            neck_diff = np.any(neck_image != old, axis=2)
            declared = np.array(Image.open(neck_mask_path).convert("L")) > 0
            assert np.array_equal(neck_diff, declared), name
            assert not np.any(arm_diff & neck_diff), f"Overlapping independent changes: {name}"
            candidate[neck_diff] = neck_image[neck_diff]
        old_images[name], final_images[name] = old, candidate
        destination = out / "layers" / f"{name}.png"
        if not neck_diff.any():
            shutil.copyfile(candidate_path, destination)
        elif not arm_diff.any():
            shutil.copyfile(neck / "layers" / f"{name}.png", destination)
        else:
            Image.fromarray(candidate).save(destination)
        assert np.array_equal(rgba(destination), candidate)
        for key in ("sourceVisible", "sourceVisiblePath", "sourceMask", "mask", "patchMasks", "uncompletedOcclusionMask", "alphaCleanupMask", "localRevisionMasks"):
            if key in row:
                row[key] = copy_evidence(row[key], name, key)
        if name == "Hair_BackMass":
            # Earlier r4 procedural fill was explicitly rejected and reset before donor use.
            row["historicalSupersededRevisionMasks"] = row.pop("localRevisionMasks", [])
        changed = np.any(candidate != old, axis=2)
        if changed.any():
            masks = []
            for label, mask in (("arm-waist", arm_diff), ("neck", neck_diff), ("combined", changed)):
                if not mask.any():
                    continue
                p = out / "evidence" / f"{name}-{label}-rgba-change-mask.png"
                Image.fromarray(mask.astype(np.uint8) * 255).save(p)
                masks.append(p.relative_to(out).as_posix())
            row["activeB12ChangeMasks"] = masks
            row["status"] = "b12_combined_local_source_candidate_pending_native_visual_review"
            changes.append({"id": name, "b11Sha256": sha(old_path), "armWaistSha256": sha(candidate_path), "finalSha256": sha(destination), "armWaistChangedPixels": int(arm_diff.sum()), "neckChangedPixels": int(neck_diff.sum()), "changeMaskIntersectionPixels": int((arm_diff & neck_diff).sum()), "finalChangedPixels": int(changed.sum())})
        row["path"] = destination.relative_to(out).as_posix()
        row["sha256"] = sha(destination)
        row["rgbaNonemptyPixels"] = int(np.count_nonzero(candidate[:, :, 3]))
        row["poseAccepted"] = False

    def composite(images):
        result = Image.new("RGBA", (971, 1620))
        for row in sorted(merged["layers"], key=lambda x: x["order"]):
            if row.get("visible", True):
                assert row.get("opacity", 1) == 1
                result = Image.alpha_composite(result, Image.fromarray(images[row["id"]]))
        return result

    before, after = composite(old_images), composite(final_images)
    diff = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    before.save(out / "qa/b11-neutral-source-composite.png")
    after.save(out / "qa/b12-neutral-source-composite.png")
    assert not np.any(diff), "Combined source changed neutral RGBA"
    for color, label in (((255, 255, 255, 255), "white"), ((224, 234, 216, 255), "pale-green"), ((24, 48, 40, 255), "deep-green")):
        Image.alpha_composite(Image.new("RGBA", after.size, color), after).convert("RGB").save(out / f"qa/b12-neutral-{label}.png")
    for label, source_report in (("arm-waist", arm_meta.parent / "donor-integration-report.json"), ("neck", neck / "donor-integration-report.json")):
        shutil.copyfile(source_report, out / "evidence" / f"{label}-donor-integration-report.json")
        source_files.add(source_report)
    inputs = [{"path": str(p), "sha256": sha(p)} for p in sorted(source_files)]
    merged.update(status="b12_combined_source_WIP_neutral_exact_native_dynamic_review_pending", productionAccepted=False, modelAccepted=False, artProductionAccepted=False, baseRevision="b11_immutable", sourceMasterChanged=False,
                  combinedSourceProvenance="source-merge-report.json", donorReports=["evidence/arm-waist-donor-integration-report.json", "evidence/neck-donor-integration-report.json"])
    merged["revisionChain"] += ["b12: disjoint arm/waist donor-r3 plus neck donor n1; 72 real pixel layers; neutral RGBA unchanged"]
    merged["limitations"].append("B12 added source alpha requires appended source-domain mesh coverage, full native local form extension, actual atlas rerasterization and worst-pose visual checks; source/PSD scores cannot approve dynamic seams.")
    metadata_path = out / "fullbody.metadata.json"
    metadata_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"status": "combined_source_candidate_not_model_acceptance", "script": str(Path(__file__).resolve()), "scriptSha256": sha(Path(__file__).resolve()), "inputs": inputs, "metadataSha256": sha(metadata_path), "layers": 72, "temporaryLayers": 0, "changes": changes, "copiedEvidence": evidence, "missingInheritedHistoricalEvidence": missing_historical_evidence, "neutralChangedPixels": int(np.any(diff > 0, axis=2).sum()), "neutralMaximumRgbaDifference": diff.max(axis=(0, 1)).tolist(), "disjointChangeMasksVerified": True, "sourceFilesUnchanged": all(sha(Path(x["path"])) == x["sha256"] for x in inputs), "modelWritten": False, "productionAccepted": False}
    (out / "source-merge-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metadata": str(metadata_path), "sha256": sha(metadata_path), "changedIds": [r["id"] for r in changes], "neutralChangedPixels": report["neutralChangedPixels"]}))


if __name__ == "__main__":
    main()
