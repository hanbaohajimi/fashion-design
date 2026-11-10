"""Prepare a review-only hit outline from an actual neutral Core capture.

Does not modify the image, reference, model, manifest, or production gate.
The product renderer's fixed 0.96 fit is applied once about the canvas centre.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
import skimage
from PIL import Image
from skimage.draw import polygon2mask
from skimage.measure import approximate_polygon, find_contours


def digest(data):
    return hashlib.sha256(data).hexdigest()


def signed_area(xy):
    return float(np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - np.roll(xy[:, 0], -1) * xy[:, 1]) / 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    source = args.capture.resolve()
    data = source.read_bytes()
    assert digest(data) == args.sha256.lower(), "Actual capture changed"
    im = Image.open(source)
    assert im.mode == "RGBA" and im.size == (971, 1620)
    alpha = np.asarray(im)[:, :, 3]
    mask = alpha >= 128
    contours = find_contours(np.pad(mask, 1), 0.5, fully_connected="high", positive_orientation="low")
    contours = [c - 1 for c in contours if np.array_equal(c[0], c[-1])]
    areas = [signed_area(c[:, ::-1]) for c in contours]
    outer_sign = np.sign(areas[int(np.argmax(np.abs(areas)))])
    kept = [(c, a) for c, a in zip(contours, areas) if np.sign(a) == outer_sign and abs(a) >= 16]
    assert 1 <= len(kept) <= 64
    source_polygons = []
    outline_mask = np.zeros_like(mask)
    for contour, _ in kept:
        reduced = approximate_polygon(contour, tolerance=1.0)[:-1]
        assert 3 <= len(reduced) <= 512, "Do not silently increase simplification tolerance"
        assert np.isfinite(reduced).all()
        outline_mask |= polygon2mask(mask.shape, reduced)
        # Marching-square coordinates address pixel centres at integer indices;
        # SVG image edges start at 0, with the first pixel centre at 0.5.
        source_polygons.append(reduced[:, ::-1] + 0.5)
    centre = np.array([971 / 2, 1620 / 2])
    product_polygons = [np.round((p - centre) * 0.96 + centre, 4).tolist() for p in source_polygons]
    out = args.out.resolve()
    repo = Path(__file__).resolve().parents[3]
    assert out.is_relative_to(repo / "output")
    out.mkdir(parents=True, exist_ok=False)
    report = {
        "schemaVersion": 1, "characterId": "forest-spirit-front-v8",
        "scope": "Review-only neutral pointer contour; not dynamic/model/production approval",
        "productionApproval": False,
        "tool": {"path": str(Path(__file__).resolve()), "sha256": digest(Path(__file__).read_bytes()), "scikitImage": skimage.__version__},
        "source": {"path": str(source), "sha256": digest(data), "requiredProvenance": "Actual Core neutral 971x1620 DPR1 fit1; caller must preserve capture report"},
        "algorithm": {"alphaThreshold": 128, "simplificationPixels": 1.0, "minimumOuterAreaPixels": 16, "pixelCentreOffset": 0.5, "productFit": 0.96, "centre": centre.tolist(), "internalHolesFilledByContract": True},
        "hitArea": {"approved": False, "viewBox": [971, 1620], "polygons": product_polygons},
        "sourceSpaceChecks": {"foregroundPixels": int(mask.sum()), "missedForegroundPixels": int((mask & ~outline_mask).sum()), "extraHitPixels": int((~mask & outline_mask).sum()), "polygonCount": len(kept), "vertexCounts": [len(p) for p in product_polygons]},
        "remaining": ["Compare with final actual neutral export", "Review 0.96 product mapping at 160/220/280 CSS heights", "Real browser transparent perimeter click-through and same-chat interactions", "Review filled small internal alpha holes separately from the transparent perimeter"],
    }
    (out / "hit-area-candidate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    paths = "".join('<polygon points="' + " ".join(f"{x},{y}" for x, y in p) + '" fill="#eec548" fill-opacity=".12" stroke="#c52d43" stroke-width="2"/>' for p in product_polygons)
    image = base64.b64encode(data).decode("ascii")
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="971" height="1620" viewBox="0 0 971 1620"><rect width="971" height="1620" fill="#e0ead8"/><image href="data:image/png;base64,{image}" x="19.42" y="32.4" width="932.16" height="1555.2"/>{paths}</svg>'
    (out / "product-fit-outline-review.svg").write_text(svg, encoding="utf-8")
    assert source.read_bytes() == data
    print(json.dumps(report["sourceSpaceChecks"]))


if __name__ == "__main__":
    main()
