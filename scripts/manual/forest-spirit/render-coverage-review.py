"""Diagnostic crops only: frozen source, prior actual Core, repaired actual Core.

No source image, model, or scored comparison is changed. Nearest-neighbor zoom is
for inspection; all bounds and actual-input hashes are recorded beside the crops.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    inputs = [("b11 production composite", args.source), ("r3 actual Core BEFORE", args.before), ("r5 actual Core AFTER", args.after)]
    images = [(label, Image.open(path).convert("RGBA")) for label, path in inputs]
    assert all(image.size == (971, 1620) for _, image in images)
    regions = {
        "hat-hole-and-acorns": ((275, 215, 418, 290), 4),
        "hat-brim": ((130, 390, 207, 447), 4),
        "hat-leaf": ((370, 118, 418, 172), 4),
        "face-and-eyes": ((345, 395, 705, 630), 2),
        "scarf": ((325, 610, 722, 751), 2),
        "pouch-and-skirt": ((570, 890, 823, 1060), 2),
        "skirt-fringe": ((130, 1180, 880, 1270), 1),
        "braid-side": ((222, 727, 338, 865), 3),
        "socks-and-boots": ((278, 1250, 720, 1598), 1),
    }
    backgrounds = {"white": (255, 255, 255), "light-green": (224, 234, 216), "dark-green": (26, 53, 37)}
    output_files = []
    for name, (bbox, zoom) in regions.items():
        width, height = (bbox[2] - bbox[0]) * zoom, (bbox[3] - bbox[1]) * zoom
        for bg_name, bg in backgrounds.items():
            board = Image.new("RGB", (3 * width, height + 40), "#ededed")
            draw = ImageDraw.Draw(board)
            for index, (label, image) in enumerate(images):
                crop = image.crop(bbox)
                crop = Image.alpha_composite(Image.new("RGBA", crop.size, (*bg, 255)), crop).convert("RGB")
                crop = crop.resize((width, height), Image.Resampling.NEAREST)
                board.paste(crop, (index * width, 40))
                draw.text((index * width + 5, 4), label, fill="black")
                draw.text((index * width + 5, 20), f"{bbox} nearest {zoom}x / {bg_name}", fill="black")
            path = args.out / f"{name}-{bg_name}.png"
            board.save(path)
            output_files.append(str(path.resolve()))
    report = {"scope": "Visual crops only, not scored/resized acceptance inputs", "inputs": [{"label": label, "path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for label, path in inputs], "regions": regions, "backgrounds": backgrounds, "outputs": output_files}
    (args.out / "contact-inputs.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(args.out.resolve()), "contactCount": len(output_files)}))


if __name__ == "__main__":
    main()
