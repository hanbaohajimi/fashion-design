"""Restricted hidden support alpha study; never alters the frozen artwork or a CMO."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--overlap", type=float, default=1.5)
    args = parser.parse_args()
    metadata = Path("output/forest-spirit-production-v2/front-v8/fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json")
    frozen = metadata.read_bytes()
    assert digest(frozen) == "2375cd52b9cff8e598eb81ced977aaa52802268cc7b09eb20a55143c85a0f440"
    layers = json.loads(frozen)["layers"]
    source = {row["id"]: metadata.parent / row["path"] for row in layers}
    pixels = {name: np.asarray(Image.open(path).convert("RGBA")) for name, path in source.items()}
    above = Image.new("RGBA", (971, 1620))
    at = next(i for i, row in enumerate(layers) if row["id"] == "Scarf_Back")
    for row in layers[at + 1:]:
        above = Image.alpha_composite(above, Image.fromarray(pixels[row["id"]]))
    allowed = np.zeros((1620, 971), bool)
    # Each side only. The central backing behind the face and neck stays intact.
    allowed[620:735, 330:390] = True
    allowed[620:735, 670:715] = True
    allowed &= np.asarray(above)[..., 3] == 255
    front = np.logical_or.reduce([pixels[name][..., 3] >= 128 for name in ["Scarf_Upper", "Scarf_Middle", "Scarf_Lower"]])
    distance = distance_transform_edt(~front) - distance_transform_edt(front)
    # A negative overlap is an explicit inner support inset; only fully hidden neutral pixels may change.
    limit = np.clip(args.overlap + 1 - distance, 0, 1)
    original = pixels["Scarf_Back"]
    revised = original.copy()
    revised[..., 3][allowed] = np.minimum(original[..., 3], np.rint(limit * 255).astype(np.uint8))[allowed]
    changed = revised[..., 3] != original[..., 3]
    assert changed.any() and not np.any(changed & ~allowed)
    assert np.array_equal(revised[..., :3], original[..., :3])
    before = Image.new("RGBA", (971, 1620))
    after = Image.new("RGBA", (971, 1620))
    for row in layers:
        name = row["id"]
        before = Image.alpha_composite(before, Image.fromarray(pixels[name]))
        after = Image.alpha_composite(after, Image.fromarray(revised if name == "Scarf_Back" else pixels[name]))
    assert np.array_equal(np.asarray(before), np.asarray(after)), "Visible neutral RGBA changed"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    Image.fromarray(revised).save(out / "Scarf_Back.png")
    Image.fromarray(original).save(out / "Scarf_Back-before.png")
    Image.fromarray((allowed * 255).astype(np.uint8)).save(out / "allowed-hidden-mask.png")
    Image.fromarray((changed * 255).astype(np.uint8)).save(out / "alpha-change-mask.png")
    after.save(out / "neutral-composite.png")
    yy, xx = np.where(changed)
    report = {"scope": "Hidden scarf-side contour source study only; no native or Core acceptance", "sideOverlapPx": args.overlap, "metadataSha256": digest(frozen), "sourcePath": str(source["Scarf_Back"]), "sourceSha256": digest(source["Scarf_Back"].read_bytes()), "candidateSha256": digest((out / "Scarf_Back.png").read_bytes()), "changedAlphaPixels": int(changed.sum()), "changedRgbPixels": 0, "changedBBox": [int(xx.min()), int(yy.min()), int(xx.max() + 1), int(yy.max() + 1)], "aboveAlphaAtEveryChange": 255, "neutralRgbaExactlyEqual": True, "sourceUnchanged": digest(metadata.read_bytes()) == digest(frozen), "productionApproval": False}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
