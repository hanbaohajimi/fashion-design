"""Merge independently reviewed b14 pixel deltas without overwriting shared layers."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def rgba(path: Path):
    image = np.array(Image.open(path).convert("RGBA"))
    assert image.shape == (1620, 971, 4), path
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--subset", action="append", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    base_path = root / "fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json"
    assert sha(base_path) == "2375cd52b9cff8e598eb81ced977aaa52802268cc7b09eb20a55143c85a0f440"
    base = read(base_path)
    assert len(base["layers"]) == 72
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    inputs = {str(base_path): sha(base_path)}
    rows = {row["id"]: row for row in base["layers"]}
    original, original_visible = {}, {}
    for name, row in rows.items():
        for field, target in [("path", original), ("sourceVisible", original_visible)]:
            path = (base_path.parent / row[field]).resolve()
            inputs[str(path)] = sha(path)
            if field == "path":
                assert sha(path) == row["sha256"], name
            target[name] = rgba(path)
    images = {name: data.copy() for name, data in original.items()}
    visible = {name: data.copy() for name, data in original_visible.items()}
    used = {name: np.zeros((1620, 971), dtype=bool) for name in rows}
    used_visible = {name: np.zeros((1620, 971), dtype=bool) for name in rows}
    merge_evidence = []
    # All incoming subsets must be independently based on b13. Each layer's actual
    # difference from that fixed base supplies the merge mask, never its rectangle.
    for subset_path in args.subset:
        subset_path = subset_path.resolve()
        subset = read(subset_path)
        inputs[str(subset_path)] = sha(subset_path)
        if "characterId" in subset:
            assert subset["characterId"] == "forest-spirit-front-v8"
            assert subset["canvas"] == {"width": 971, "height": 1620}
        else:
            # The independent neck/shoulder artifact uses a fixed-baseline subset
            # schema; verify its actual origin instead of inventing missing fields.
            assert subset["baselineMetadataSha256"] == sha(base_path)
            assert Path(subset["baselineMetadata"]).resolve() == base_path.resolve()
        for artifact in [subset.get("donorRegistration")]:
            if artifact:
                path = (subset_path.parent / artifact["path"]).resolve()
                assert sha(path) == artifact["sha256"]
                inputs[str(path)] = sha(path)
        seen = set()
        for patch in subset["layers"]:
            name = patch["id"]
            assert name in rows and name not in seen
            seen.add(name)
            path = (subset_path.parent / patch["path"]).resolve()
            assert sha(path) == patch["sha256"]
            inputs[str(path)] = sha(path)
            data = rgba(path)
            difference = np.any(data != original[name], axis=2)
            assert difference.any(), f"Unchanged subset entry {name}"
            if patch.get("baselineSha256"):
                assert patch["baselineSha256"] == rows[name]["sha256"]
            for label, artifact in patch.get("masks", {}).items():
                mask_path = (subset_path.parent / artifact["path"]).resolve()
                assert sha(mask_path) == artifact["sha256"]
                inputs[str(mask_path)] = sha(mask_path)
                mask = np.array(Image.open(mask_path).convert("L")) > 0
                assert mask.shape == difference.shape
                if label == "allowed-hidden-mask":
                    assert not np.any(difference & ~mask), f"Outside declared hidden mask: {name}"
                if label == "change-mask":
                    assert np.array_equal(mask, difference), f"Stale change mask: {name}"
            overlap = difference & used[name]
            assert np.array_equal(images[name][overlap], data[overlap]), f"Conflicting source edits: {name}"
            images[name][difference] = data[difference]
            used[name] |= difference
            visible_difference = np.zeros((1620, 971), dtype=bool)
            if patch.get("sourceVisible"):
                visible_path = (subset_path.parent / patch["sourceVisible"]).resolve()
                inputs[str(visible_path)] = sha(visible_path)
                visible_data = rgba(visible_path)
                visible_difference = np.any(visible_data != original_visible[name], axis=2)
                visible_overlap = visible_difference & used_visible[name]
                assert np.array_equal(visible[name][visible_overlap], visible_data[visible_overlap]), f"Conflicting ownership edits: {name}"
                visible[name][visible_difference] = visible_data[visible_difference]
                used_visible[name] |= visible_difference
            merge_evidence.append({"subset": str(subset_path), "subsetSha256": sha(subset_path), "id": name,
                                   "source": str(path), "sha256": sha(path), "rgbaChangedPixels": int(difference.sum()),
                                   "overlapWithEarlierIdenticalChanges": int(overlap.sum()),
                                   "ownershipChangedPixels": int(visible_difference.sum()),
                                   "declaredMasks": patch.get("masks", {}),
                                   "donorRegistration": subset.get("donorRegistration")})
    def composite(items):
        result = Image.new("RGBA", (971, 1620))
        for row in sorted(base["layers"], key=lambda row: row["order"]):
            if row.get("visible", True):
                assert row.get("opacity", 1) == 1
                result.alpha_composite(Image.fromarray(items[row["id"]]))
        return result
    before, after = composite(original), composite(images)
    difference = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    assert not difference.any(), "Refuse b14 merge: neutral RGBA changed"
    for folder in ["layers", "source-visible", "evidence", "qa"]:
        (out / folder).mkdir(parents=True, exist_ok=True)
    metadata = copy.deepcopy(base)
    # Historic references remain evidence, with their real original paths. Do not
    # invent absent masks or reinterpret production alpha as original ownership.
    descriptive = {"revisionChain", "limitations", "notes", "scope", "status", "description"}
    def resolve_existing(value, key=""):
        if isinstance(value, dict):
            return {k: resolve_existing(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [resolve_existing(v, key) for v in value]
        if isinstance(value, str) and value.lower().endswith((".png", ".json")) and key not in descriptive:
            path = (base_path.parent / value).resolve()
            assert path.is_file(), f"Missing inherited reference {key}: {value}"
            return str(path)
        return value
    metadata = resolve_existing(metadata)
    changes = []
    for row in metadata["layers"]:
        name = row["id"]
        layer_target, visible_target = out / "layers" / f"{name}.png", out / "source-visible" / f"{name}.png"
        if used[name].any():
            Image.fromarray(images[name]).save(layer_target)
        else:
            shutil.copyfile(base_path.parent / rows[name]["path"], layer_target)
        if used_visible[name].any():
            Image.fromarray(visible[name]).save(visible_target)
        else:
            shutil.copyfile(base_path.parent / rows[name]["sourceVisible"], visible_target)
        row.update(path=layer_target.relative_to(out).as_posix(), sha256=sha(layer_target),
                   sourceVisible=visible_target.relative_to(out).as_posix(), sourceVisiblePath=visible_target.relative_to(out).as_posix())
        if used[name].any():
            for field in ["mask", "sourceMask"]:
                if row.get(field):
                    row[f"priorB13{field[0].upper()}{field[1:]}Evidence"] = row[field]
            artifacts = {"derived-current-production-alpha": images[name][:, :, 3],
                         "derived-current-source-ownership": visible[name][:, :, 3],
                         "b13-to-b14-rgba-change": used[name].astype(np.uint8) * 255,
                         "b13-to-b14-source-ownership-change": used_visible[name].astype(np.uint8) * 255}
            for suffix, data in artifacts.items():
                Image.fromarray(data).save(out / "evidence" / f"{name}-{suffix}.png")
            row["mask"] = f"evidence/{name}-derived-current-production-alpha.png"
            row["sourceMask"] = f"evidence/{name}-derived-current-source-ownership.png"
            row["activeB14ChangeMask"] = f"evidence/{name}-b13-to-b14-rgba-change.png"
            row["status"] = "b14_source_candidate_native_dynamic_review_pending"
            row["sourcePixelCount"] = int(np.count_nonzero(visible[name][:, :, 3]))
            row["rgbaNonemptyPixels"] = int(np.count_nonzero(images[name][:, :, 3]))
            changes.append({"id": name, "priorSha256": rows[name]["sha256"], "candidateSha256": sha(layer_target),
                            "rgbaChangedPixels": int(used[name].sum()), "ownershipChangedPixels": int(used_visible[name].sum())})
    before.save(out / "qa/b13-neutral-source-composite.png")
    after.save(out / "qa/b14-neutral-source-composite.png")
    for label, color in [("white", (255, 255, 255, 255)), ("pale-green", (224, 234, 216, 255)), ("deep-green", (24, 48, 40, 255))]:
        Image.alpha_composite(Image.new("RGBA", after.size, color), after).convert("RGB").save(out / "qa" / f"b14-neutral-{label}.png")
    metadata.update(status="b14_combined_source_WIP_neutral_exact_native_dynamic_pending", productionAccepted=False,
                    modelAccepted=False, artProductionAccepted=False, sourceMasterChanged=False,
                    sourceMergeReport="source-merge-report.json", activeB14Inputs=merge_evidence)
    metadata["revisionChain"] += ["b14: exact-base delta union; original ownership transfers and bounded hidden contour repairs; model ArtMesh partition, if accepted, is separate from these 72 source layers"]
    assert all(sha(Path(path)) == digest for path, digest in inputs.items()), "Input changed during freeze"
    metadata_path = out / "fullbody.metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"scope": "72 source PNG layers only, no native rig or dynamic acceptance", "sourceLayerCount": 72,
              "metadataSha256": sha(metadata_path), "sourceBaseMetadata": str(base_path), "sourceBaseMetadataSha256": sha(base_path),
              "changes": changes, "merges": merge_evidence, "neutralRgbaChangedPixels": 0,
              "sourceMasterChanged": False, "productionAccepted": False,
              "inputs": [{"path": path, "sha256": digest} for path, digest in inputs.items()], "inputsUnchanged": True,
              "scriptSha256": sha(Path(__file__))}
    report_path = out / "source-merge-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    def validate_references(value, key=""):
        if isinstance(value, dict):
            for k, v in value.items():
                validate_references(v, k)
        elif isinstance(value, list):
            for v in value:
                validate_references(v, key)
        elif isinstance(value, str) and value.lower().endswith((".png", ".json")) and key not in descriptive:
            path = (out / value).resolve()
            assert path.is_file(), f"Missing b14 metadata reference {key}: {value}"
    validate_references(metadata)
    report["allMetadataFileReferencesExist"] = True
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metadata": str(metadata_path), "sha256": sha(metadata_path), "changes": changes, "neutralRgbaChangedPixels": 0}))


if __name__ == "__main__":
    main()
