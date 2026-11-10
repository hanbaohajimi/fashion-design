"""Diagnostic crops/alpha measurements of actual Core PNGs; never modifies model art."""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("capture_directory", type=Path)
parser.add_argument("--output-directory", type=Path)
args = parser.parse_args()
root = args.capture_directory.resolve()
assert "output" in root.parts
destination = (args.output_directory or root / "seam-review").resolve()
assert "output" in destination.parts
destination.mkdir(parents=True, exist_ok=True)
for name in ["positive-combination-seams-three-backgrounds-2x.png", "head-scarf-seams-contact-2x.png", "seam-analysis.json"]:
    assert not (destination / name).exists(), "Use a new review directory; previous evidence is immutable"
names = ["neutral", "grid-y30-z30-s1-eye1", "grid-y30-z-30-s-1-eye1", "grid-y-30-z30-s1-eye1", "grid-y-30-z-30-s-1-eye1", "grid-y30-z30-s1-eye0"]
roi = (295, 555, 760, 790)
interior = (370, 560, 690, 760)
w, h = (roi[2] - roi[0]) * 2, (roi[3] - roi[1]) * 2
sheet = Image.new("RGB", (w * 2, (h + 32) * 3), (245, 245, 240))
draw = ImageDraw.Draw(sheet)
base = np.asarray(Image.open(root / "neutral-971x1620.png").convert("RGBA")).astype(int)
report = {"scope": "Actual Core PNG alpha and seam diagnostic; no visual or production acceptance", "crop": roi, "interior": interior, "scale": 2, "resample": "nearest", "backgrounds": [[255, 255, 255], [224, 234, 216], [26, 53, 37]], "sourceHashes": {}, "poses": []}
for index, name in enumerate(names):
    source = root / (name + "-971x1620.png")
    im = Image.open(source).convert("RGBA")
    assert im.size == (971, 1620)
    report["sourceHashes"][name] = hashlib.sha256(source.read_bytes()).hexdigest()
    background = Image.new("RGBA", im.size, (224, 234, 216, 255))
    background.alpha_composite(im)
    x, y = (index % 2) * w, (index // 2) * (h + 32)
    sheet.paste(background.crop(roi).resize((w, h), Image.Resampling.NEAREST), (x, y + 32))
    draw.text((x + 8, y + 8), name, fill=(0, 0, 0))
    if name == "grid-y30-z30-s1-eye1":
        triple = Image.new("RGB", (w * 3, h + 32), (245, 245, 240))
        td = ImageDraw.Draw(triple)
        for col, color in enumerate(report["backgrounds"]):
            bg = Image.new("RGBA", im.size, (*color, 255))
            bg.alpha_composite(im)
            triple.paste(bg.crop(roi).resize((w, h), Image.Resampling.NEAREST), (col * w, 32))
            td.text((col * w + 8, 8), str(color), fill=(0, 0, 0))
        triple.save(destination / "positive-combination-seams-three-backgrounds-2x.png")
sheet.save(destination / "head-scarf-seams-contact-2x.png")

for name in ["neutral", "head-up", "head-down", "head-z-positive", "head-z-negative", "scarf-positive", "scarf-negative", *names[1:]]:
    source = root / (name + "-971x1620.png")
    a = np.asarray(Image.open(source).convert("RGBA")).astype(int)
    report["sourceHashes"][name] = hashlib.sha256(source.read_bytes()).hexdigest()
    alpha = a[interior[1]:interior[3], interior[0]:interior[2], 3]
    delta = base[:, :, 3] - a[:, :, 3]
    mask = np.zeros(delta.shape, bool)
    mask[interior[1]:interior[3], interior[0]:interior[2]] = True
    mask &= delta >= 50
    yy, xx = np.where(mask)
    points = sorted([(int(delta[y, x]), int(x), int(y), int(base[y, x, 3]), int(a[y, x, 3])) for y, x in zip(yy, xx)], reverse=True)[:12]
    report["poses"].append({"name": name, "minimumAlpha": int(alpha.min()), "pixelsAlphaBelow242": int((alpha < 242).sum()), "alphaDropAtLeast50Pixels": len(xx), "maximumAlphaDrop": int(delta[interior[1]:interior[3], interior[0]:interior[2]].max()), "samplePointsDropXYNeutralPose": points})
(destination / "seam-analysis.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"directory": str(destination), "poses": len(report["poses"]), "productionApproval": False}))
