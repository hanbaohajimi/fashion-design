"""Local hidden alpha contour study; source colors and visible neutral pixels stay exact."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    metadata = Path("output/forest-spirit-production-v2/front-v8/fullbody/revisions/b12-combined-source-r2/fullbody.metadata.json")
    frozen = metadata.read_bytes()
    assert sha(frozen) == "d2ddf7ce7b63ae7e77ad9e510ddc0f0212ef62b29b7c0daf5d2be093bf6748d5"
    layers = json.loads(frozen)["layers"]
    source = {row["id"]: metadata.parent / row["path"] for row in layers}
    pixels = {name: np.asarray(Image.open(path).convert("RGBA")) for name, path in source.items()}
    index = next(i for i, row in enumerate(layers) if row["id"] == "Scarf_Back")
    above = Image.new("RGBA", (971, 1620))
    for row in layers[index + 1:]:
        above = Image.alpha_composite(above, Image.fromarray(pixels[row["id"]]))
    allowed = np.zeros((1620, 971), bool)
    allowed[700:734, 320:390] = True
    allowed &= np.asarray(above)[..., 3] == 255
    original = pixels["Scarf_Back"]
    lower = pixels["Scarf_Lower"][..., 3] >= 128
    distance = distance_transform_edt(~lower)
    # A small 1.5px fully opaque hidden overlap plus a1px alpha ramp follows the
    # actual Lower silhouette. No rectangle cuts, recolor, global alpha fix or neck motion change.
    limit = np.clip(2.5 - distance, 0, 1)
    revised = original.copy()
    proposed = np.minimum(original[..., 3], np.rint(limit * 255).astype(np.uint8))
    revised[..., 3][allowed] = proposed[allowed]
    changed = np.any(revised != original, axis=-1)
    assert changed.any() and not np.any(changed & ~allowed)
    assert np.array_equal(revised[..., :3], original[..., :3])
    before = Image.new("RGBA", (971, 1620))
    after = Image.new("RGBA", (971, 1620))
    for row in layers:
        name = row["id"]
        before = Image.alpha_composite(before, Image.fromarray(pixels[name]))
        after = Image.alpha_composite(after, Image.fromarray(revised if name == "Scarf_Back" else pixels[name]))
    equal = np.array_equal(np.asarray(before), np.asarray(after))
    assert equal, "Reject any neutral RGBA change"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    Image.fromarray(revised).save(out / "Scarf_Back.png")
    Image.fromarray((allowed * 255).astype(np.uint8)).save(out / "allowed-hidden-mask.png")
    Image.fromarray((changed * 255).astype(np.uint8)).save(out / "alpha-change-mask.png")
    Image.fromarray(pixels["Scarf_Back"]).save(out / "Scarf_Back-before.png")
    after.save(out / "neutral-composite.png")
    y, x = np.where(changed)
    report = {"scope": "Hidden local scarf-back lower-left alpha contour study; not Cubism or Core acceptance", "metadataSha256": sha(frozen), "sourcePath": str(source["Scarf_Back"]), "sourceSha256": sha(source["Scarf_Back"].read_bytes()), "candidateSha256": sha((out / "Scarf_Back.png").read_bytes()), "changedAlphaPixels": int(changed.sum()), "changedRgbPixels": 0, "changedBBox": [int(x.min()), int(y.min()), int(x.max() + 1), int(y.max() + 1)], "aboveAlphaAtEveryChange": 255, "neutralRgbaExactlyEqual": equal, "sourceUnchanged": sha(metadata.read_bytes()) == sha(frozen), "productionApproval": False}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
