"""Register reviewed local donors into locked, neutral-occluded b12 source regions only."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--prior", default="output/forest-spirit-production-v2/front-v8/fullbody/candidates/b12-arm-waist/r4")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    body = repo / "output/forest-spirit-production-v2/front-v8/fullbody"
    base = body / "revisions/b11"
    prior = (repo / args.prior).resolve()
    assert prior.is_relative_to(repo / "output")
    requests = body / "candidates/b12-local-donor-requests"
    generated = Path("C:/Users/朱奕玮/.codex/generated_images/01a1ab2e-73ec-7642-9c8b-1925d42c4358")
    raw_inputs = {"braid-tip": generated / "exec-1dc01c78-b426-43e7-8792-3371adf568f8.png",
                  "peplum-outer-right": generated / "exec-56ae1886-bde1-417e-a220-d792fb11ddaa.png"}
    expected = {"braid-tip": "5dafc09f9145d154a74867fabd2cdf894c668525776fa1815d83d401b16bfd80",
                "peplum-outer-right": "229c5025120c5ab0a451f0490a38b3f9a46ead0d998e0868a8a2e652af949d97"}
    out = Path(args.out).resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    out.mkdir(parents=True)
    for name in ("layers", "source-visible", "masks", "qa", "donor-registration"):
        (out / name).mkdir()
    outputs = requests / "outputs"
    outputs.mkdir(exist_ok=True)
    meta_path = prior / "fullbody-candidate.metadata.json"
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    frozen_meta_path = base / "fullbody-with-r9.metadata.json"
    frozen = json.loads(frozen_meta_path.read_text(encoding="utf-8"))
    rows = {row["id"]: row for row in metadata["layers"]}
    originals = {}
    for row in frozen["layers"]:
        p = Path(row["path"])
        originals[row["id"]] = np.array(Image.open(p if p.is_absolute() else base / p).convert("RGBA"))
    images = {name: np.array(Image.open(row["path"]).convert("RGBA")) for name, row in rows.items()}
    donor_reports = []
    for name, source in raw_inputs.items():
        assert sha(source) == expected[name]
        copied = outputs / (name + "-generated-r1.png")
        if copied.exists():
            assert sha(copied) == expected[name]
        else:
            shutil.copyfile(source, copied)
        reg_path = requests / name / "registration.json"
        reg = json.loads(reg_path.read_text(encoding="utf-8"))
        x0, y0, x1, y1 = reg["roi"]
        size = (x1 - x0, y1 - y0)
        donor_original = Image.open(copied).convert("RGBA")
        registered = np.array(donor_original.resize(size, Image.Resampling.LANCZOS))
        clean = registered.copy()
        alpha = clean[:, :, 3]
        labels, count = ndimage.label(alpha > 8, np.ones((3, 3)))
        assert count > 0
        counts = np.bincount(labels.ravel()); counts[0] = 0
        main_component = labels == int(np.argmax(counts))
        keep = ndimage.binary_dilation(main_component)
        clean[~keep] = 0
        # Preserve antialias alpha, replace only chromatic fringe RGB from interior donor texels.
        rgb = clean[:, :, :3].astype(int)
        edge = (clean[:, :, 3] > 0) & (ndimage.distance_transform_edt(clean[:, :, 3] > 127) < 2.1)
        chromatic = (rgb[:, :, 0] > rgb[:, :, 1] + 22) | (rgb[:, :, 1] > rgb[:, :, 0] + 22)
        dirty = edge & chromatic
        interior = (clean[:, :, 3] > 240) & ~edge & ~chromatic
        assert np.any(interior)
        _, nearest = ndimage.distance_transform_edt(~interior, return_indices=True)
        clean[dirty, :3] = clean[nearest[0][dirty], nearest[1][dirty], :3]
        allowed = np.array(Image.open(requests / name / "allowed-hidden-mask.png")) > 0
        contour_trim = np.zeros_like(allowed)
        if name == "peplum-outer-right":
            gy, gx = np.indices(allowed.shape)
            prior_alpha = clean[:, :, 3].copy()
            # Two generated rim protrusions observed in the fixed 152x148 ROI.
            # Smooth only permitted hidden alpha, leaving all locked source pixels untouched.
            lower = allowed & (gy >= 84) & (gy <= 100) & (gx >= 37) & (gx < 63)
            left_edge = 56 - (gy - 84) * (14 / 16)
            lower_cap = np.rint(np.clip(gx - left_edge + 0.5, 0, 1) * 255).astype(np.uint8)
            clean[:, :, 3][lower] = np.minimum(clean[:, :, 3][lower], lower_cap[lower])
            upper = allowed & (gy >= 9) & (gy <= 20) & (gx >= 100) & (gx < 130)
            upper_cap = np.rint(np.clip(gy - 19 + 0.5, 0, 1) * 255).astype(np.uint8)
            clean[:, :, 3][upper] = np.minimum(clean[:, :, 3][upper], upper_cap[upper])
            contour_trim = clean[:, :, 3] != prior_alpha
        part = reg["destinationPart"]
        source_visible = originals["Braid_Tip"] if name == "braid-tip" else originals["Peplum_R"]
        source_crop = source_visible[y0:y1, x0:x1]
        overlap = (source_crop[:, :, 3] == 255) & (clean[:, :, 3] > 240) & ~allowed
        if name == "braid-tip":
            # Exclude the old gray cloth and the green tie from the color reference.
            overlap &= source_crop[:, :, 0].astype(int) - source_crop[:, :, 1].astype(int) >= 16
        assert np.count_nonzero(overlap) > 20
        color_delta = np.median(source_crop[overlap, :3].astype(float) - clean[overlap, :3], axis=0)
        color_delta = np.clip(color_delta, -16, 16)
        donor_rgb = np.clip(np.rint(clean[:, :, :3].astype(float) + color_delta), 0, 255).astype(np.uint8)
        images[part] = originals[part].copy()
        region = images[part][y0:y1, x0:x1]
        if name == "peplum-outer-right":
            # The permitted area is a limit, not a demand to fill it. New donor alpha supplies
            # a natural outer contour; old hidden tile/floating cloth is removed in that area.
            region[allowed] = 0
        use = allowed & (clean[:, :, 3] > 0)
        region[use, :3] = donor_rgb[use]
        region[use, 3] = clean[use, 3]
        Image.fromarray(registered).save(out / f"donor-registration/{name}-registered.png")
        Image.fromarray(clean).save(out / f"donor-registration/{name}-edge-cleaned.png")
        Image.fromarray((dirty.astype(np.uint8) * 255)).save(out / f"donor-registration/{name}-fringe-rgb-mask.png")
        Image.fromarray((contour_trim.astype(np.uint8) * 255)).save(out / f"donor-registration/{name}-hidden-contour-trim-mask.png")
        Image.fromarray((use.astype(np.uint8) * 255)).save(out / f"donor-registration/{name}-used-mask-crop.png")
        full_mask = np.zeros((1620, 971), dtype=np.uint8)
        full_mask[y0:y1, x0:x1] = use * 255
        Image.fromarray(full_mask).save(out / f"masks/{part}-donor-used.png")
        donor_reports.append({"name": name, "rawGeneratedSource": str(source), "copiedOriginal": str(copied), "rawSha256": sha(copied),
                              "registrationFile": str(reg_path), "registrationSha256": sha(reg_path), "roi": reg["roi"],
                              "generatedSize": list(donor_original.size), "registeredSize": list(size),
                              "mapping": "Full input frame mapped directly to fixed ROI with documented independent x/y scale; no fitting to acceptance metrics",
                              "scaleXY": [size[0] / donor_original.width, size[1] / donor_original.height],
                              "edgeRgbCleanupPixels": int(dirty.sum()), "hiddenContourTrimPixels": int(contour_trim.sum()), "usedPixels": int(use.sum()),
                              "colorOffsetOnlyInsideUsedMask": color_delta.tolist(), "destinationPart": part})

    def composite(items: dict[str, np.ndarray], omit_arm: bool = False) -> Image.Image:
        image = Image.new("RGBA", (971, 1620))
        for row in sorted(metadata["layers"], key=lambda r: r["order"]):
            if not row.get("visible", True) or omit_arm and row["id"] in {"Arm_R_Upper", "Arm_R_Lower", "Hand_R"}:
                continue
            image = Image.alpha_composite(image, Image.fromarray(items[row["id"]]))
        return image

    before = composite(originals)
    after = composite(images)
    difference = np.abs(np.array(before).astype(int) - np.array(after).astype(int))
    before.save(out / "qa/neutral-before-b11-asset-composite.png")
    after.save(out / "qa/neutral-after-donor-asset-composite.png")
    changed = [name for name in images if not np.array_equal(images[name], originals[name])]
    for name in changed:
        p = out / f"layers/{name}.png"
        Image.fromarray(images[name]).save(p)
        rows[name]["path"] = str(p); rows[name]["sha256"] = sha(p)
        rows[name]["status"] = "b12_masked_local_donor_candidate_pending_native_review"
    for name in ("Braid_Tip", "Arm_R_Upper", "Arm_R_Lower"):
        source = Path(rows[name]["sourceVisiblePath"])
        target = out / f"source-visible/{name}.png"
        shutil.copyfile(source, target)
        rows[name]["sourceVisible"] = rows[name]["sourceVisiblePath"] = str(target)
        alpha = np.array(Image.open(target))[:, :, 3]
        p = out / f"masks/{name}-source-ownership.png"
        Image.fromarray((alpha > 0).astype(np.uint8) * 255).save(p)
        rows[name]["sourceMask"] = str(p); rows[name]["sourcePixelCount"] = int(np.count_nonzero(alpha))
    metadata.update(status="b12_masked_local_donor_candidate_pending_visual_psd_and_native_pose_review",
                    productionAccepted=False, modelAccepted=False, artProductionAccepted=False,
                    donorReports=str(out / "donor-integration-report.json"))
    (out / "fullbody-candidate.metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Source-only exposure preview is explicitly not an actual animated model result.
    roi = (125, 825, 420, 1100)
    preview = Image.new("RGB", (590, 323), (224, 234, 216)); draw = ImageDraw.Draw(preview)
    for col, (items, label) in enumerate(((originals, "b11 source"), (images, "masked donor candidate"))):
        comp = composite(items, True)
        crop = Image.alpha_composite(Image.new("RGBA", comp.size, (224, 234, 216, 255)), comp).convert("RGB").crop(roi)
        preview.paste(crop, (295 * col, 48)); draw.text((295 * col + 3, 4), label, fill="black")
        draw.text((295 * col + 3, 20), "Arm sources hidden. NOT model pose.", fill="black")
    preview.save(out / "qa/source-hidden-material-preview.png")
    report = {"scope": "Masked local donor source-art candidate, no model/pose acceptance", "script": str(Path(__file__).resolve()),
              "scriptSha256": sha(Path(__file__).resolve()), "frozenSourceMetadata": str(frozen_meta_path), "frozenSourceMetadataSha256": sha(frozen_meta_path),
              "priorMetadata": str(meta_path), "priorMetadataSha256": sha(meta_path),
              "changedIds": changed, "donors": donor_reports, "neutralMaximumRgbaDifference": difference.max(axis=(0, 1)).tolist(),
              "neutralChangedPixels": int(np.any(difference > 0, axis=2).sum()), "exactNeutralRgbaPreserved": not np.any(difference),
              "productionAccepted": False, "modelAccepted": False,
              "limitations": ["Only allowed hidden masks contain generated donor texels; original visible texels are locked.",
                              "Material seams and contours must be visually reviewed before PSD/native integration.",
                              "New source alpha outside original mesh requires local coverage extension and native atlas rasterization."]}
    (out / "donor-integration-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("changedIds", "neutralMaximumRgbaDifference", "neutralChangedPixels", "exactNeutralRgbaPreserved")}))
    assert report["exactNeutralRgbaPreserved"]


if __name__ == "__main__":
    main()
