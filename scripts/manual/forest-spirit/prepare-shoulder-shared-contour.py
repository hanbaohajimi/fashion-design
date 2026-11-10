"""Round a hidden split-layer corner with shared contours and original-pixel hair underlap."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import binary_dilation, distance_transform_edt


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--padding", type=int, default=5)
    ap.add_argument("--extend-donor-max-distance", type=float, default=0)
    args = ap.parse_args()
    base = Path("output/forest-spirit-production-v2/front-v8")
    metadata = base / "fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json"
    assert sha(metadata) == "2375cd52b9cff8e598eb81ced977aaa52802268cc7b09eb20a55143c85a0f440"
    layers = json.loads(metadata.read_text(encoding="utf8"))["layers"]
    paths = {row["id"]: metadata.parent / row["path"] for row in layers}
    pixels = {name: np.array(Image.open(path).convert("RGBA")) for name, path in paths.items()}
    above = {}
    stack = Image.new("RGBA", (971, 1620))
    for row in reversed(layers):
        name = row["id"]
        if name in {"Arm_R_Upper", "Cape_R", "Hair_BackMass"}:
            above[name] = np.array(stack)[..., 3].copy()
        stack = Image.alpha_composite(Image.fromarray(pixels[name]), stack)
    # These are measured opaque Cape_R contour samples outside the discontinuity
    # (the old edge jumps from x334 at y735 to x310 at y740).
    anchors = [(725, 338), (730, 336), (735, 334), (760, 306), (765, 304), (770, 301), (780, 292), (790, 282)]
    for y, x in anchors:
        assert np.flatnonzero(pixels["Cape_R"][y, :, 3] >= 128).min() == x
    curve = PchipInterpolator([p[0] for p in anchors], [p[1] for p in anchors])
    yy, xx = np.indices((1620, 971))
    target = np.clip(xx + 1.0 - curve(np.clip(yy, 725, 790)), 0, 1)
    roi = (xx >= 284) & (xx < 345) & (yy >= 725) & (yy < 787)
    revised, allowed, changed = {}, {}, {}
    for name in ["Arm_R_Upper", "Cape_R"]:
        allowed[name] = roi & (above[name] == 255)
        q = pixels[name].copy()
        q[..., 3][allowed[name]] = np.minimum(q[..., 3], np.rint(target * 255).astype(np.uint8))[allowed[name]]
        revised[name] = q
        changed[name] = np.any(q != pixels[name], axis=-1)
        assert not np.any(changed[name] & ~allowed[name])
        assert np.array_equal(q[..., :3], pixels[name][..., :3])
    donor = np.array(Image.alpha_composite(Image.fromarray(pixels["Braid_Root"]), Image.fromarray(pixels["Braid_Mid"])))
    assert 0 <= args.padding <= 20 and 0 <= args.extend_donor_max_distance <= 20
    dy, dx = np.ogrid[-args.padding:args.padding+1, -args.padding:args.padding+1]
    underlap = binary_dilation(changed["Arm_R_Upper"] | changed["Cape_R"], structure=dx * dx + dy * dy <= args.padding**2)
    distance, nearest = distance_transform_edt(donor[..., 3] != 255, return_indices=True)
    allowed["Hair_BackMass"] = underlap & (above["Hair_BackMass"] == 255) & (distance <= args.extend_donor_max_distance)
    q = pixels["Hair_BackMass"].copy()
    # Only original donor texels are copied, with the source coordinate of every
    # target retained below. No global recolor, invented fill, or frozen-source write.
    q[allowed["Hair_BackMass"]] = donor[nearest[0], nearest[1]][allowed["Hair_BackMass"]]
    revised["Hair_BackMass"] = q
    changed["Hair_BackMass"] = np.any(q != pixels["Hair_BackMass"], axis=-1)
    before = Image.new("RGBA", (971, 1620))
    after = before.copy()
    for row in layers:
        name = row["id"]
        before = Image.alpha_composite(before, Image.fromarray(pixels[name]))
        after = Image.alpha_composite(after, Image.fromarray(revised.get(name, pixels[name])))
    assert np.array_equal(np.asarray(before), np.asarray(after)), "Neutral visible pixel changed"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    changes = []
    for name, q in revised.items():
        Image.fromarray(q).save(out / f"{name}.png")
        Image.fromarray(pixels[name]).save(out / f"{name}-before.png")
        Image.fromarray((allowed[name] * 255).astype(np.uint8)).save(out / f"{name}-allowed-hidden-mask.png")
        Image.fromarray((changed[name] * 255).astype(np.uint8)).save(out / f"{name}-change-mask.png")
        y, x = np.where(changed[name])
        changes.append({"id": name, "sourcePath": str(paths[name]), "sourceSha256": sha(paths[name]), "candidateSha256": sha(out / f"{name}.png"), "changedRgbaPixels": int(changed[name].sum()), "changedRgbPixels": int(np.any(q[..., :3] != pixels[name][..., :3], axis=-1).sum()), "bbox": [int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1)]})
    Image.fromarray(donor).save(out / "same-coordinate-original-braid-donor.png")
    ty, tx = np.where(changed["Hair_BackMass"])
    np.savez_compressed(out / "hair-donor-registration.npz", target_x=tx, target_y=ty, source_x=nearest[1, ty, tx], source_y=nearest[0, ty, tx], distance=distance[ty, tx])
    after.save(out / "neutral-composite.png")
    report = {"scope": "Shared hidden Cape/Upper contour and registered original braid underlap candidate; not native/Core approval", "metadataSha256": sha(metadata), "anchorsMeasuredFromCape": anchors, "alphaTransitionPixels": 1, "hairUnderlapPaddingPixels": args.padding, "donorMaximumAllowedDistancePx": args.extend_donor_max_distance, "donorMaximumUsedDistancePx": float(distance[ty, tx].max()), "donorRegistrationSha256": sha(out / "hair-donor-registration.npz"), "neutralRgbaExactlyEqual": True, "changes": changes, "hairDonorSources": [{"id": name, "path": str(paths[name]), "sha256": sha(paths[name])} for name in ["Braid_Root", "Braid_Mid"]], "productionApproval": False}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
