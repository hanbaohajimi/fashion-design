"""Read-only actual atlas check for the Upper front/back shared source.

Neutral views can conceal Front behind the cape. Check its independent opaque
interior directly in the actual exported texture, using the native placement.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import io
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from skimage.color import rgb2lab, deltaE_ciede2000


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for key in ["model", "geometry", "metadata", "drawable-map", "out"]:
        ap.add_argument("--"+key, type=Path, required=True)
    args = ap.parse_args()
    assert not args.out.exists()
    frozen = {}
    def read_frozen(path):
        path = Path(path).resolve(); data = path.read_bytes(); frozen[str(path)] = hashlib.sha256(data).hexdigest(); return data
    def frozen_sha(path):
        return frozen[str(Path(path).resolve())]
    read_frozen(__file__)
    doc = json.loads(read_frozen(args.geometry)); meta = json.loads(read_frozen(args.metadata))
    declaration = json.loads(read_frozen(args.drawable_map)); model = json.loads(read_frozen(args.model))
    read_frozen(doc["source"])
    assert frozen_sha(doc["source"]) == doc["sourceSha256"]
    assert doc["sourceMetadataSha256"] == frozen_sha(args.metadata) == declaration["sourceMetadataSha256"]
    assert doc["drawableDeclarationSha256"] == frozen_sha(args.drawable_map)
    assert declaration["sourceLayerCount"] == 72 and declaration["drawableCount"] == 73
    assert declaration["sourceToDrawables"]["Arm_R_Upper"] == ["Arm_R_Upper", "Arm_R_Upper_Front"]
    by_id = {d["id"]: d for d in doc["drawables"]}; front = by_id["Arm_R_Upper_Front"]; back = by_id["Arm_R_Upper"]
    assert len(by_id) == 73 and front["sourceLayerId"] == back["sourceLayerId"] == "Arm_R_Upper"
    assert front["sourceTileId"] == back["sourceTileId"] and front["positions"] == back["positions"] and front["uvs"] == back["uvs"]
    assert front["placement"] == back["placement"]
    row = next(r for r in meta["layers"] if r["id"] == "Arm_R_Upper")
    source_path = args.metadata.parent / row["path"]; source_bytes = read_frozen(source_path); assert frozen_sha(source_path) == row["sha256"]
    source = np.asarray(Image.open(io.BytesIO(source_bytes)).convert("RGBA"), dtype=float)
    coverage_path = Path(__file__).with_name("audit-neutral-mesh-coverage.py"); read_frozen(coverage_path)
    spec = importlib.util.spec_from_file_location("coverage", coverage_path); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    xy = np.asarray(front["positions"], dtype=float).reshape(-1, 2)
    front_mask = module.triangles_mask(xy, np.asarray(front["indices"]), 971, 1620)
    solid = (distance_transform_edt(front_mask) > 2) & (distance_transform_edt(source[..., 3] >= 254) > 2)
    p = front["placement"]; assert p["scaleX"] == p["scaleY"] == 1 and p["pageWidth"] == p["pageHeight"] == 2048
    texture_path = args.model.parent / model["FileReferences"]["Textures"][p["page"]]
    texture = np.asarray(Image.open(io.BytesIO(read_frozen(texture_path))).convert("RGBA"), dtype=float); assert texture.shape == (2048, 2048, 4)
    # Texture samples are at integer texel centers. Inverse-map their centers
    # through the native atlas transform; no fitted registration or scoring warp.
    yy, xx = np.mgrid[:2048, :2048]; ax = xx+.5-p["x"]; ay = yy+.5-p["y"]
    theta = np.deg2rad(p["rotation"]); sx = np.cos(theta)*ax+np.sin(theta)*ay; sy = -np.sin(theta)*ax+np.cos(theta)*ay
    ix = np.floor(sx).astype(int); iy = np.floor(sy).astype(int)
    inside = (ix >= 0) & (ix < 971) & (iy >= 0) & (iy < 1620)
    sample = np.zeros_like(inside); sample[inside] = solid[iy[inside], ix[inside]]
    assert np.count_nonzero(sample) >= 100
    tx, ty = sx[sample]-.5, sy[sample]-.5
    x0, y0 = np.floor(tx).astype(int), np.floor(ty).astype(int)
    fx, fy = tx-x0, ty-y0
    assert (x0 >= 0).all() and (x0+1 < 971).all() and (y0 >= 0).all() and (y0+1 < 1620).all()
    expected = source[y0, x0]*(1-fx[:, None])*(1-fy[:, None])+source[y0, x0+1]*fx[:, None]*(1-fy[:, None])+source[y0+1, x0]*(1-fx[:, None])*fy[:, None]+source[y0+1, x0+1]*fx[:, None]*fy[:, None]
    actual = texture[sample]
    assert np.min(expected[:, 3]) >= 254
    color = deltaE_ciede2000(rgb2lab(np.clip(expected[:, :3]/255, 0, 1)), rgb2lab(actual[:, :3]/255))
    missing = actual[:, 3] < 254
    checks = {"opaqueFrontInteriorHasNoAtlasAlphaHoles": not missing.any(), "frontInteriorDeltaEMedianAtMost3": float(np.median(color)) <= 3, "frontInteriorDeltaE95AtMost8": float(np.percentile(color, 95)) <= 8}
    args.out.mkdir(parents=True)
    Image.fromarray((solid*255).astype("uint8")).save(args.out/"front-source-interior-mask.png")
    marked = np.zeros((2048, 2048, 4), dtype="uint8"); marked[sample] = (40, 180, 110, 180)
    ys, xs = np.where(sample); marked[ys[missing], xs[missing]] = (255, 0, 80, 255)
    Image.alpha_composite(Image.fromarray(texture.astype("uint8")), Image.fromarray(marked)).save(args.out/"actual-atlas-front-interior-samples.png")
    checks["allInputsUnchanged"] = all(sha(path) == expected for path, expected in frozen.items())
    report = {"scope": "Actual exported atlas opaque Front interior audit, independent of neutral visibility. No runtime motion or final visual acceptance.", "passed": all(checks.values()), "checks": checks, "frozenInputs": frozen, "sourceMetadataSha256": frozen_sha(args.metadata), "nativeGeometrySha256": frozen_sha(args.geometry), "nativeCmoSha256": doc["sourceSha256"], "modelSha256": frozen_sha(args.model), "actualTextureSha256": frozen_sha(texture_path), "sourcePngSha256": frozen_sha(source_path), "sampleCount": int(sample.sum()), "alphaHoleCount": int(missing.sum()), "minimumActualAlpha": float(actual[:, 3].min()), "maximumAlphaDifference": float(np.max(np.abs(expected[:, 3]-actual[:, 3]))), "deltaEMedian": float(np.median(color)), "deltaE95": float(np.percentile(color, 95)), "deltaEMaximum": float(np.max(color)), "placement": p, "edgeExclusionSourcePixels": 2, "registrationFitted": False, "productionApproval": False}
    (args.out/"shared-source-atlas-report.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf8")
    print(json.dumps(report))
    if not report["passed"]: raise SystemExit(2)


if __name__ == "__main__":
    main()
