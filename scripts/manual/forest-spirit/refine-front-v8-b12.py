"""Local b11 source-ownership/hidden-contour candidate. Never edits frozen inputs.

Uses original RGBA texels and explicitly masked local texture donors, not character generation.
Neutral RGBA equality is a gate; pose/material acceptance remains separate and false.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.interpolate import CubicSpline


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygon(points: list[tuple[int, int]], shape: tuple[int, int]) -> np.ndarray:
    h, w = shape
    image = Image.new("L", (w * 4, h * 4))
    closed = np.array(points + [points[0]], dtype=float)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))])
    curve = CubicSpline(lengths, closed, bc_type="periodic")(np.linspace(0, lengths[-1], 300))
    ImageDraw.Draw(image).polygon([(round(x * 4), round(y * 4)) for x, y in curve], fill=255)
    return np.asarray(image.resize((w, h), Image.Resampling.LANCZOS)).copy()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    src = repo / "output/forest-spirit-production-v2/front-v8/fullbody/revisions/b11"
    meta_path = src / "fullbody-with-r9.metadata.json"
    original_metadata_sha = sha(meta_path)
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    rows = {item["id"]: item for item in metadata["layers"]}
    ordered = sorted(rows, key=lambda item: rows[item]["order"])
    out = Path(args.out).resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    out.mkdir(parents=True)
    for sub in ("layers", "source-visible", "masks", "qa"):
        (out / sub).mkdir()

    def source_path(value: str) -> Path:
        path = Path(value)
        return path if path.is_absolute() else src / path

    originals = {name: np.array(Image.open(source_path(row["path"])).convert("RGBA")) for name, row in rows.items()}
    images = {name: array.copy() for name, array in originals.items()}
    h, w = images[ordered[0]].shape[:2]
    assert (w, h) == (971, 1620) and len(images) == 72
    yy, xx = np.indices((h, w))
    mask_records: dict[str, np.ndarray] = {}
    modified_sources: dict[str, np.ndarray] = {}

    # Two observed cloth fragments in Braid_Tip, traced by actual cloth color and component.
    braid = originals["Braid_Tip"]
    rgb = braid[:, :, :3].astype(int)
    initial = (braid[:, :, 3] > 0) & (xx >= 160) & (xx < 270) & (yy >= 865) & (yy < 985)
    initial &= (rgb[:, :, 0] - rgb[:, :, 1] < 12) & (rgb[:, :, 1] - rgb[:, :, 2] > 1)
    labels, _ = ndimage.label(initial, np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    components = np.flatnonzero(sizes >= 20)
    components = components[components != 0]
    initial = np.isin(labels, components)
    transfer = ndimage.binary_dilation(initial) & (braid[:, :, 3] > 0)
    transfer &= (rgb[:, :, 0] - rgb[:, :, 1] < 18) & (rgb[:, :, 1] - rgb[:, :, 2] > 0)
    assert int(transfer.sum()) == 1601
    remaining_labels, _ = ndimage.label((braid[:, :, 3] > 0) & ~transfer, np.ones((3, 3)))
    remaining_counts = np.bincount(remaining_labels.ravel()); remaining_counts[0] = 0
    main_hair = int(np.argmax(remaining_counts))
    # The 35-pixel detached dark rim belongs to the same sleeve cuff, not a new hair curl.
    cuff_rim = (remaining_labels != 0) & (remaining_labels != main_hair) & (xx >= 170) & (yy >= 960)
    assert int(cuff_rim.sum()) == 35
    transfer |= cuff_rim
    assert int(transfer.sum()) == 1636
    braid_source = np.array(Image.open(source_path(rows["Braid_Tip"]["sourceVisiblePath"])).convert("RGBA"))
    for name, select in (("Arm_R_Upper", transfer & (yy < 929)), ("Arm_R_Lower", transfer & (yy >= 929))):
        images[name][select] = braid[select]
        visible = np.array(Image.open(source_path(rows[name]["sourceVisiblePath"])).convert("RGBA"))
        visible[select] = braid_source[select]
        modified_sources[name] = visible
        mask_records[name + "-ownership-transfer"] = select
    images["Braid_Tip"][transfer] = 0
    braid_source[transfer] = 0
    modified_sources["Braid_Tip"] = braid_source
    mask_records["Braid_Tip-removed-cloth"] = transfer

    arms = Image.new("RGBA", (w, h))
    for name in ("Arm_R_Upper", "Arm_R_Lower", "Hand_R"):
        arms = Image.alpha_composite(arms, Image.fromarray(images[name]))
    arm_hidden = np.array(arms)[:, :, 3] == 255

    # A small rear hair fill is behind the actual arm, not painted over its neutral visible cloth.
    hair_outline = polygon([(200, 858), (238, 878), (222, 908), (207, 942),
                            (193, 964), (173, 981), (151, 970), (133, 944), (136, 899), (162, 874)], (h, w))
    hair_mask = arm_hidden & (hair_outline > 0) & (xx >= 125) & (xx < 245) & (yy >= 855) & (yy < 985)
    donor_valid = (braid[:, :, 3] == 255) & ~transfer & (rgb[:, :, 0] - rgb[:, :, 1] >= 16)
    _, nearest = ndimage.distance_transform_edt(~donor_valid, return_indices=True)
    donor_y = np.maximum(0, yy - 6)
    donor_x = np.maximum(0, xx - 20)
    valid_shift = donor_valid[donor_y, donor_x]
    donor_y = np.where(valid_shift, donor_y, nearest[0])
    donor_x = np.where(valid_shift, donor_x, nearest[1])
    images["Hair_BackMass"][hair_mask, :3] = braid[donor_y[hair_mask], donor_x[hair_mask], :3]
    images["Hair_BackMass"][hair_mask, 3] = hair_outline[hair_mask]
    mask_records["Hair_BackMass-local-tip-fill"] = hair_mask

    # Fully opaque fore-arm/hand source coverage is the permitted neutral-hidden area.
    # These changes must not fill the surrounding body-exterior negative space.
    def hidden_contour(name: str, points: list[tuple[int, int]], region: tuple[int, int, int, int], donor: tuple[int, int, int, int]) -> None:
        x0, y0, x1, y1 = region
        permitted = arm_hidden & (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        desired = polygon(points, (h, w))
        fill = permitted & (desired > 0)
        original = originals[name]
        dx0, dy0, dx1, dy1 = donor
        tile = original[dy0:dy1, dx0:dx1, :3]
        assert tile.size and np.all(original[dy0:dy1, dx0:dx1, 3] > 0)
        texture = tile[(yy - dy0) % tile.shape[0], (xx - dx0) % tile.shape[1]].astype(float)
        boundary_seed = ~permitted & (original[:, :, 3] == 255)
        border_distance, nearest = ndimage.distance_transform_edt(~boundary_seed, return_indices=True)
        border_rgb = original[nearest[0], nearest[1], :3].astype(float)
        blend = np.exp(-border_distance / 7.0)[:, :, None]
        texture = texture * (1 - blend) + border_rgb * blend
        # Local edge shading gives the hidden cloth edge a padded thickness; no new embroidery.
        distance = ndimage.distance_transform_edt(desired > 127)
        shading = -12 * np.exp(-distance / 2.4) + 3 * np.exp(-((distance - 4) / 2.5) ** 2)
        texture = np.clip(np.rint(texture + shading[:, :, None]), 0, 255).astype(np.uint8)
        images[name][permitted] = 0
        images[name][fill, :3] = texture[fill]
        images[name][fill, 3] = desired[fill]
        mask_records[name + "-permitted-neutral-hidden"] = permitted
        mask_records[name + "-contour-fill"] = fill
        mask_records[name + "-contour-remove"] = permitted & (original[:, :, 3] > 0) & ~fill

    hidden_contour("Peplum_R", [(341, 924), (319, 925), (299, 937), (282, 954), (266, 978),
                                (258, 998), (261, 1014), (274, 1027), (293, 1030), (320, 1015),
                                (342, 984), (362, 944), (362, 928)],
                   (230, 914, 363, 1042), (353, 965, 377, 993))
    hidden_contour("Skirt_Petal_Side_R", [(311, 1004), (356, 1031), (373, 1100), (304, 1180),
                                          (201, 1190), (144, 1167), (149, 1135), (199, 1090),
                                          (239, 1045), (273, 1015)],
                   (170, 995, 370, 1135), (216, 1101, 248, 1129))

    def composite(collection: dict[str, np.ndarray]) -> Image.Image:
        result = Image.new("RGBA", (w, h))
        for name in ordered:
            if rows[name].get("visible", True):
                result = Image.alpha_composite(result, Image.fromarray(collection[name]))
        return result

    before = composite(originals)
    after = composite(images)
    diff = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    before.save(out / "qa/neutral-before-b11-asset-composite.png")
    after.save(out / "qa/neutral-after-b12-asset-composite.png")
    changed = [name for name in ordered if not np.array_equal(images[name], originals[name])]
    for name in changed:
        Image.fromarray(images[name]).save(out / f"layers/{name}.png")
    for name, array in modified_sources.items():
        Image.fromarray(array).save(out / f"source-visible/{name}.png")
        Image.fromarray((array[:, :, 3] > 0).astype(np.uint8) * 255).save(out / f"masks/{name}-source-ownership.png")
    for name, mask in mask_records.items():
        Image.fromarray((mask.astype(np.uint8) * 255)).save(out / f"masks/{name}.png")
    candidate = json.loads(json.dumps(metadata))
    candidate.update(status="b12_local_arm_waist_candidate_not_pose_or_production_accepted", baseMetadata=str(meta_path),
                     baseMetadataSha256=original_metadata_sha, productionAccepted=False, modelAccepted=False)
    for row in candidate["layers"]:
        name = row["id"]
        for key in ("path", "sourceVisible", "sourceVisiblePath", "sourceMask", "mask", "uncompletedOcclusionMask", "alphaCleanupMask"):
            if key in row:
                row[key] = str(source_path(row[key]).resolve())
        if "patchMasks" in row:
            row["patchMasks"] = [str(source_path(item).resolve()) for item in row["patchMasks"]]
        if name in changed:
            row["path"] = str((out / f"layers/{name}.png").resolve())
            row["sha256"] = sha(Path(row["path"]))
            row["status"] = "b12_local_candidate_pending_native_pose_review"
            row["localRevisionMasks"] = [str((out / f"masks/{key}.png").resolve()) for key in mask_records if key.startswith(name + "-")]
        if name in modified_sources:
            row["sourceVisible"] = row["sourceVisiblePath"] = str((out / f"source-visible/{name}.png").resolve())
            row["sourceMask"] = str((out / f"masks/{name}-source-ownership.png").resolve())
            row["sourcePixelCount"] = int(np.count_nonzero(modified_sources[name][:, :, 3]))
    (out / "fullbody-candidate.metadata.json").write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = dict(scope="Source PNG candidate and asset alpha composite only; not actual Core pose acceptance", sourceMetadataSha256=original_metadata_sha,
                  scriptPath=str(Path(__file__).resolve()), scriptSha256=sha(Path(__file__).resolve()),
                  changedIds=changed, movedOriginalClothPixels=int(transfer.sum()), hiddenHairPixels=int(hair_mask.sum()),
                  neutralMaximumRgbaDifference=diff.max(axis=(0, 1)).tolist(), neutralChangedPixels=int(np.any(diff > 0, axis=2).sum()),
                  exactNeutralRgbaPreserved=not np.any(diff), sourceMetadataUnchanged=sha(meta_path) == original_metadata_sha,
                  masks={key: int(value.sum()) for key, value in mask_records.items()}, productionAccepted=False,
                  localDonors={"Hair_BackMass": {"source": "frozen b11 Braid_Tip original blond texels", "preferredOffsetXY": [-20, -6], "fallback": "nearest valid original blond texel"},
                               "Peplum_R": {"sourceBox": [353, 965, 377, 993], "method": "local texture candidate plus 7px edge color transition"},
                               "Skirt_Petal_Side_R": {"sourceBox": [216, 1101, 248, 1129], "method": "local texture candidate plus 7px edge color transition"}},
                  limitations=["Rear hair fill is in Hair_BackMass; small relative braid/back-hair motion requires actual native review.",
                               "All new source pixels require mesh/atlas coverage audit before use; no topology was edited here.",
                               "Peplum and skirt hidden donor texture/edge candidates require visual review; no broad body-exterior gap was filled.",
                               "Scarf layers are untouched and assigned to the independent scarf repair."])
    (out / "local-source-candidate-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    if not report["exactNeutralRgbaPreserved"] or not report["sourceMetadataUnchanged"]:
        raise SystemExit("Candidate is not accepted: exact neutral/source guard failed; evidence retained")


if __name__ == "__main__":
    main()
