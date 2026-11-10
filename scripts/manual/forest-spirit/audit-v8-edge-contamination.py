"""Read-only boundary color diagnosis; all crops retain original pixels."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, label


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--actual", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists():
        raise FileExistsError(out)
    out.mkdir(parents=True)
    metadata_path = args.metadata.resolve()
    metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    master = Path(metadata["source"])
    tracked = [metadata_path, master, args.actual.resolve()]
    initial_hashes = {str(path): file_sha(path) for path in tracked}
    before = Image.new("RGBA", (971, 1620))
    layer_rows = []
    for item in sorted(metadata["layers"], key=lambda row: row["order"]):
        path = Path(item["path"])
        if not path.is_absolute():
            path = metadata_path.parent / path
        initial_hashes[str(path.resolve())] = file_sha(path)
        im = Image.open(path).convert("RGBA")
        layer_rows.append((item["id"], np.array(im)))
        if item.get("visible", True):
            before.alpha_composite(im)
    images = {"master": Image.open(master).convert("RGBA"), "source": before,
              "actual": Image.open(args.actual).convert("RGBA")}
    masks = {}
    report = {"kind": "READ_ONLY_COLOR_BOUNDARY_DIAGNOSIS", "modelAccepted": False,
              "inputs": {"metadata": str(metadata_path), "actual": str(args.actual.resolve()),
                         "master": str(master)}, "inputSha256": initial_hashes, "images": {}}
    for name, im in images.items():
        a = np.array(im)
        rgb = a[:, :, :3].astype(int)
        alpha = a[:, :, 3]
        inner_distance = distance_transform_edt(alpha >= 128)
        r, g, b = rgb.transpose(2, 0, 1)
        red = (r > 150) & (r - g > 65) & (r - b > 45)
        green = (g > 150) & (g - b > 90) & (g - r > -15)
        blue = (b > 160) & (b - r > 65) & (b - g > 40)
        mask = (red | green | blue) & (alpha > 0) & (inner_distance <= 3.5)
        masks[name] = mask
        Image.fromarray((mask * 255).astype(np.uint8)).save(out / f"{name}-suspect-mask.png")
        labels, count = label(mask, structure=np.ones((3, 3)))
        clusters = []
        for index in range(1, count + 1):
            part = labels == index
            y, x = np.where(part)
            clusters.append({"bbox": [int(x.min()), int(y.min()), int(x.max()) + 1, int(y.max()) + 1],
                             "pixels": int(part.sum()), "maxAlpha": int(alpha[part].max()),
                             "weightedAlpha": float(alpha[part].sum() / 255)})
        clusters.sort(key=lambda row: row["weightedAlpha"], reverse=True)
        report["images"][name] = {"rgbaSha256": hashlib.sha256(a.tobytes()).hexdigest(),
                                  "suspectPixels": int(mask.sum()), "clusters": clusters,
                                  "alphaBands": {f"{lo}-{hi}": int((mask & (alpha >= lo) & (alpha <= hi)).sum())
                                                 for lo, hi in [(1, 8), (9, 32), (33, 127), (128, 254), (255, 255)]}}
    report["sourceOwners"] = [{"id": name, "suspectNontransparentPixels": int((masks["source"] & (a[:, :, 3] > 0)).sum())}
                              for name, a in layer_rows if (masks["source"] & (a[:, :, 3] > 0)).any()]
    regions = {"hat": (490, 35, 790, 140), "hair-right": (800, 300, 945, 720),
               "waist-right": (820, 880, 955, 1110), "skirt": (660, 1110, 880, 1295),
               "socks": (430, 1240, 555, 1430), "boots": (280, 1500, 760, 1610)}
    backgrounds = {"white": (255, 255, 255), "pale_green": (224, 234, 216), "deep_green": (26, 53, 37)}
    for region, box in regions.items():
        width, height = box[2] - box[0], box[3] - box[1]
        for bg_name, color in backgrounds.items():
            sheet = Image.new("RGB", (width * 3, height + 22), (246, 246, 242))
            draw = ImageDraw.Draw(sheet)
            for column, (name, im) in enumerate(images.items()):
                bg = Image.new("RGBA", im.size, (*color, 255))
                bg.alpha_composite(im)
                sheet.paste(bg.convert("RGB").crop(box), (column * width, 22))
                draw.text((column * width + 3, 3), name, fill="black")
            sheet.save(out / f"{region}-{bg_name}-1x.png")
            sheet.resize((sheet.width * 3, sheet.height * 3), Image.Resampling.NEAREST).save(out / f"{region}-{bg_name}-3x.png")
    report["policy"] = "No source, alpha, RGB, texture, mesh or model was modified. Suspect mask is diagnostic, not approval to remove pixels."
    changed_inputs = [path for path, expected in initial_hashes.items() if file_sha(Path(path)) != expected]
    if changed_inputs:
        raise RuntimeError(f"Inputs changed during audit: {changed_inputs}")
    report["inputsUnchanged"] = True
    report["artifacts"] = [{"path": path.name, "sha256": file_sha(path)}
                           for path in sorted(out.iterdir()) if path.is_file()]
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: {k: v for k, v in row.items() if k != "clusters"} for name, row in report["images"].items()}))


if __name__ == "__main__":
    main()
