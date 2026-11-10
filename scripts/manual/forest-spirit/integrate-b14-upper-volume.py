"""Register a local donor and transfer only bounded hidden low-frequency luminance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_erosion, distance_transform_edt, gaussian_filter, map_coordinates
from scipy.optimize import differential_evolution


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def linear(rgb):
    v = rgb / 255
    return np.where(v <= .04045, v / 12.92, ((v + .055) / 1.055) ** 2.4)


def srgb(v):
    return np.where(v <= .0031308, v * 12.92, 1.055 * np.maximum(v, 0) ** (1 / 2.4) - .055) * 255


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    mp = root / "fullbody/revisions/b14-combined-source-r1/fullbody.metadata.json"
    assert sha(mp) == "0e02a13c9ca90c24dac74b194dfed6cd3a2d0c9cf6f72b42111fa1d6315b5ad3"
    request = root / "fullbody/candidates/b14-upper-volume-local-request-r1"
    registration = json.loads((request / "registration.json").read_text(encoding="utf-8"))
    donor_path = root / "fullbody/candidates/b14-upper-volume-generated-donor-r1/local-sleeve-volume-donor.png"
    assert sha(donor_path) == "5de49366e64f56531d02f1cf7945e26c4f0c0d57dc355270d96074f7bbc8d2a9"
    meta = json.loads(mp.read_text(encoding="utf-8"))
    row = next(row for row in meta["layers"] if row["id"] == "Arm_R_Upper")
    source_path = mp.parent / row["path"]
    assert sha(source_path) == row["sha256"] == registration["targetSourceSha256"]
    original = np.array(Image.open(source_path).convert("RGBA"))
    source_visible = np.array(Image.open(mp.parent / row["sourceVisible"]).convert("RGBA"))
    allowed = np.array(Image.open(request / "allowed-hidden-material-mask-full.png").convert("L")) > 0
    assert int(allowed.sum()) == 14213 and not np.any(allowed & (source_visible[:, :, 3] > 0))
    x0, y0, x1, y1 = registration["roi"]
    w, h = x1 - x0, y1 - y0
    target = original[y0:y1, x0:x1]
    donor_original = Image.open(donor_path).convert("RGBA")
    donor = np.array(donor_original.resize((w, h), Image.Resampling.LANCZOS)).astype(float)
    yy, xx = np.mgrid[:h, :w].astype(float)
    target_alpha = target[:, :, 3].astype(float) / 255
    donor_alpha = donor[:, :, 3] / 255
    def sample_alpha(p):
        sx, sy, tx, ty = p
        return map_coordinates(donor_alpha, [(yy - ty) / sy, (xx - tx) / sx], order=1, mode="constant", cval=0)
    def objective(p):
        a = sample_alpha(p)
        return 1 - float(np.minimum(target_alpha, a).sum() / np.maximum(target_alpha, a).sum())
    fit = differential_evolution(objective, [(.94, 1.08), (.94, 1.08), (-8, 8), (-8, 8)], seed=20261106, maxiter=45, popsize=8, polish=True, workers=1)
    sx, sy, tx, ty = fit.x
    registered = np.stack([map_coordinates(donor[:, :, c], [(yy - ty) / sy, (xx - tx) / sx], order=1, mode="constant", cval=0) for c in range(4)], axis=2)
    # Donor alpha is a sampling-validity test only. It never replaces source alpha.
    valid = (registered[:, :, 3] >= 250) & (np.ptp(registered[:, :, :3], axis=2) < 65)
    valid = binary_erosion(valid, iterations=2)
    use = allowed[y0:y1, x0:x1] & valid
    assert use.any()
    weights = np.array([.2126, .7152, .0722])
    donor_l = linear(registered[:, :, :3]) @ weights
    source_linear = linear(target[:, :, :3].astype(float))
    source_l = source_linear @ weights
    sigma = 8.0
    dlow = gaussian_filter(donor_l * valid, sigma=sigma) / np.maximum(gaussian_filter(valid.astype(float), sigma=sigma), 1e-9)
    opaque = target_alpha > .99
    slow = gaussian_filter(source_l * opaque, sigma=sigma) / np.maximum(gaussian_filter(opaque.astype(float), sigma=sigma), 1e-9)
    raw_gain = dlow / np.maximum(slow, 1e-8)
    # Normalize donor exposure; only its rounded volume relative to the original
    # cloth is transferred. Chroma and original high-frequency weave stay local.
    normalization = float(np.median(raw_gain[use]))
    gain = np.clip(raw_gain / normalization, .82, 1.12)
    distance = distance_transform_edt(use)
    t = np.clip(distance / 6, 0, 1)
    feather = t * t * (3 - 2 * t)
    applied_gain = 1 + (gain - 1) * feather
    candidate = original.copy()
    patch = candidate[y0:y1, x0:x1]
    rgb = np.clip(np.rint(srgb(source_linear * applied_gain[:, :, None])), 0, 255).astype(np.uint8)
    patch[use, :3] = rgb[use]
    changed = np.any(candidate != original, axis=2)
    assert not np.any(changed & ~allowed)
    assert np.array_equal(candidate[:, :, 3], original[:, :, 3])
    assert np.array_equal(candidate[source_visible[:, :, 3] > 0], original[source_visible[:, :, 3] > 0])
    def composite(data):
        im = Image.new("RGBA", (971, 1620))
        for layer in sorted(meta["layers"], key=lambda r: r["order"]):
            if layer.get("visible", True):
                src = Image.fromarray(data) if layer["id"] == "Arm_R_Upper" else Image.open(mp.parent / layer["path"]).convert("RGBA")
                im.alpha_composite(src)
        return im
    before, after = composite(original), composite(candidate)
    assert np.array_equal(np.array(before), np.array(after)), "Reject: neutral changed"
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    for directory in ["layers", "masks", "qa", "registration"]:
        (out / directory).mkdir(parents=True, exist_ok=True)
    Image.fromarray(candidate).save(out / "layers/Arm_R_Upper.png")
    Image.fromarray(changed.astype(np.uint8) * 255).save(out / "masks/hidden-rgb-changed.png")
    Image.fromarray(allowed.astype(np.uint8) * 255).save(out / "masks/allowed-hidden-material.png")
    Image.fromarray(np.clip(np.rint(registered), 0, 255).astype(np.uint8)).save(out / "registration/registered-donor-crop.png")
    Image.fromarray(valid.astype(np.uint8) * 255).save(out / "registration/donor-valid-opaque-crop.png")
    np.savez_compressed(out / "registration/luminance-transfer.npz", applied_gain=applied_gain, low_frequency_donor=dlow, low_frequency_source=slow, use_mask=use, feather=feather)
    before.save(out / "qa/neutral-before.png"); after.save(out / "qa/neutral-after.png")
    sheet = Image.new("RGB", (w * 3 * 3, h * 3 + 25), "white")
    draw = ImageDraw.Draw(sheet)
    panels = [("PRIOR Upper", Image.fromarray(target)), ("Registered donor / RGB only", Image.fromarray(np.clip(np.rint(registered), 0, 255).astype(np.uint8))), ("CANDIDATE original weave + volume", Image.fromarray(candidate[y0:y1, x0:x1]))]
    for i, (label, image) in enumerate(panels):
        picture = Image.alpha_composite(Image.new("RGBA", image.size, (224, 234, 216, 255)), image).resize((w * 3, h * 3), Image.Resampling.NEAREST)
        sheet.paste(picture, (i * w * 3, 25)); draw.text((i * w * 3 + 3, 5), label, fill="black")
    sheet.save(out / "qa/upper-material-comparison-3x.png")
    report = {"scope": "Hidden-only low-frequency lighting candidate; not original-pixel paint or model acceptance", "sourceMetadata": str(mp), "sourceMetadataSha256": sha(mp), "sourceUpperSha256": sha(source_path), "generatedDonor": str(donor_path), "generatedDonorSha256": sha(donor_path), "roi": [x0, y0, x1, y1], "donorOriginalSize": list(donor_original.size), "initialRegisteredSize": [w, h], "registration": {"sourceCropXYEquals": "diag(sx,sy)*resizedDonorXY+[tx,ty]", "sx": float(sx), "sy": float(sy), "tx": float(tx), "ty": float(ty), "softAlphaIoUBefore": 1 - objective([1, 1, 0, 0]), "softAlphaIoUAfter": 1 - float(fit.fun)}, "allowedPixels": int(allowed.sum()), "validDonorAllowedPixels": int(use.sum()), "changedRgbPixels": int(changed.sum()), "maximumRgbByteChange": int(np.abs(candidate.astype(int) - original.astype(int)).max()), "algorithm": "8px sigma alpha-weighted linear-light luminance; donor/source exposure-normalized ratio limited .82..1.12; smoothstep feather over6px; source linear RGB scaled equally to retain chroma and original local weave", "gainNormalization": normalization, "appliedGainRange": [float(applied_gain[use].min()), float(applied_gain[use].max())], "donorAlphaUsedForOutput": False, "allSourceAlphaExact": True, "allOriginalSourceVisibleRgbaExact": True, "neutralRgbaChangedPixels": 0, "productionAccepted": False, "scriptSha256": sha(Path(__file__))}
    (out / "integration-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    subset = {"schemaVersion": 1, "characterId": "forest-spirit-front-v8", "canvas": {"width": 971, "height": 1620}, "stage": "source-candidate-subset", "baselineMetadataSha256": sha(mp), "layers": [{"id": "Arm_R_Upper", "path": "layers/Arm_R_Upper.png", "sha256": sha(out / "layers/Arm_R_Upper.png")} ]}
    (out / "subset.metadata.json").write_text(json.dumps(subset, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
