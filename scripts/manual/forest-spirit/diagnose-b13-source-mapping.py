"""Map actual Core pose triangles back to native source texels for local ownership QA."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    repo = Path(__file__).resolve().parents[3]
    root = repo / "output/forest-spirit-production-v2/front-v8"
    captures = root / "validation/full-b12-repair-r9-parameter-matrix-r1"
    native_path = root / "validation/full-b12-native-repair-r9-audit-r1/native-source-geometry.json"
    native = json.loads(native_path.read_text(encoding="utf-8"))
    source_geometry = {d["id"]: d for d in native["drawables"]}
    metadata_path = root / "fullbody/revisions/b12-combined-source-r2/fullbody.metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    rows = {d["id"]: d for d in metadata["layers"]}
    out = args.out.resolve()
    assert out.is_relative_to(repo / "output") and not out.exists()
    out.mkdir(parents=True)
    evidence = []
    roi = [110, 770, 440, 1100]
    x0, y0, x1, y1 = roi
    width, height = x1 - x0, y1 - y0
    ids = sorted(rows)
    selected = {"Arm_R_Upper", "Arm_R_Lower", "Hand_R", "Cape_R", "Peplum_R", "Bodice_Olive", "Skirt_Petal_Side_R", "Hair_BackMass", "Braid_Tip"}
    for name in ("axis-ParamFSPickup-maximum", "hat-8-head0-e1", "hat-16-head0-e1"):
        state_path = captures / f"{name}.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        dst = out / name
        dst.mkdir()
        yy, xx = np.mgrid[y0:y1, x0:x1]
        points = np.stack((xx + .5, yy + .5), axis=2)
        owner = np.full((height, width), -1, dtype=np.int16)
        owner_source = np.full((height, width, 2), np.nan, dtype=np.float32)
        composite = np.zeros((height, width, 4), dtype=float)
        layers = []
        for d in sorted(state["drawables"], key=lambda q: q["renderOrder"]):
            if d["opacity"] <= 0:
                continue
            xy = np.asarray(d["vertexPositions"]).reshape(-1, 2)
            xy[:, 0] = xy[:, 0] * 971 + 485.5
            xy[:, 1] = 810 - xy[:, 1] * 971
            if xy[:, 0].max() < x0 or xy[:, 0].min() > x1 or xy[:, 1].max() < y0 or xy[:, 1].min() > y1:
                continue
            src_xy = np.asarray(source_geometry[d["id"]]["positions"], dtype=np.float32).astype(float).reshape(-1, 2)
            assert len(xy) == len(src_xy)
            source_path = metadata_path.parent / rows[d["id"]]["path"]
            source = np.array(Image.open(source_path).convert("RGBA"))
            mapped = np.full((height, width, 2), np.nan)
            covered = np.zeros((height, width), dtype=bool)
            for tri in np.asarray(d["vertexIndices"]).reshape(-1, 3):
                a, b, c = xy[tri]
                left, top = max(x0, int(np.floor(min(a[0], b[0], c[0])))), max(y0, int(np.floor(min(a[1], b[1], c[1]))))
                right, bottom = min(x1, int(np.ceil(max(a[0], b[0], c[0])))), min(y1, int(np.ceil(max(a[1], b[1], c[1]))))
                if left >= right or top >= bottom:
                    continue
                sl = np.s_[top-y0:bottom-y0, left-x0:right-x0]
                p = points[sl]
                edge_b, edge_c = b - a, c - a
                det = edge_b[0] * edge_c[1] - edge_b[1] * edge_c[0]
                assert abs(det) > 1e-6
                v = ((p[..., 0] - a[0]) * edge_c[1] - (p[..., 1] - a[1]) * edge_c[0]) / det
                w = ((p[..., 1] - a[1]) * edge_b[0] - (p[..., 0] - a[0]) * edge_b[1]) / det
                mask = (v >= -1e-7) & (w >= -1e-7) & (v + w <= 1 + 1e-7)
                src_a, src_b, src_c = src_xy[tri]
                sample = src_a + v[..., None] * (src_b-src_a) + w[..., None] * (src_c-src_a)
                mapped[sl][mask] = sample[mask]
                covered[sl] |= mask
            render = np.zeros((height, width, 4), dtype=float)
            if np.any(covered):
                coords = [mapped[..., 1][covered] - .5, mapped[..., 0][covered] - .5]
                # Source RGB is sampled in premultiplied form, then unpremultiplied.
                alpha = map_coordinates(source[:, :, 3].astype(float) / 255, coords, order=1, mode="constant", cval=0)
                render[:, :, 3][covered] = alpha * d["opacity"]
                for ch in range(3):
                    premul = source[:, :, ch].astype(float) * source[:, :, 3] / 255
                    sample = map_coordinates(premul, coords, order=1, mode="constant", cval=0)
                    render[:, :, ch][covered] = np.divide(sample, alpha, out=np.zeros_like(sample), where=alpha > 1e-9)
            a = render[:, :, 3]
            total_a = a + composite[:, :, 3] * (1-a)
            composite[:, :, :3] = np.divide(render[:, :, :3]*a[..., None] + composite[:, :, :3]*composite[:, :, 3, None]*(1-a[..., None]), total_a[..., None], out=np.zeros_like(composite[:, :, :3]), where=total_a[..., None] > 1e-9)
            composite[:, :, 3] = total_a
            solid = a > .5
            owner[solid] = ids.index(d["id"])
            owner_source[solid] = mapped[solid]
            if d["id"] in selected:
                image = np.clip(np.rint(np.concatenate((render[:, :, :3], a[..., None]*255), axis=2)), 0, 255).astype(np.uint8)
                bg = Image.new("RGBA", (width, height), (224, 234, 216, 255))
                bg.alpha_composite(Image.fromarray(image))
                bg.convert("RGB").save(dst / f"diagnostic-mapped-{d['id']}.png")
                np.savez_compressed(dst / f"source-map-{d['id']}.npz", source=mapped.astype(np.float32), covered=covered, alpha=a.astype(np.float32))
                layers.append(d["id"])
        actual_path = captures / f"{name}.png"
        actual = Image.open(actual_path).convert("RGBA").crop(roi)
        actual_bg = Image.alpha_composite(Image.new("RGBA", actual.size, "white"), actual).convert("RGB")
        actual_bg.save(dst / "actual-core-crop-white.png")
        zoom = actual_bg.resize((width*3, height*3), Image.Resampling.NEAREST)
        dr = ImageDraw.Draw(zoom)
        for x in range(0, width, 20):
            dr.line((x*3, 0, x*3, height*3), fill=(120,180,220)); dr.text((x*3+1, 2), str(x+x0), fill=(0,0,0))
        for y in range(0, height, 20):
            dr.line((0, y*3, width*3, y*3), fill=(120,180,220)); dr.text((1, y*3+1), str(y+y0), fill=(0,0,0))
        zoom.save(dst / "actual-core-coordinate-grid-3x.png")
        np.savez_compressed(dst / "visible-owner-map.npz", owner=owner, source=owner_source, ids=np.asarray(ids), roi=np.asarray(roi))
        rgba = np.clip(np.rint(np.concatenate((composite[:, :, :3], composite[:, :, 3, None]*255), axis=2)),0,255).astype(np.uint8)
        Image.fromarray(rgba).save(dst / "DIAGNOSTIC-reconstruction-not-core.png")
        evidence.append({"state": name, "roi": roi, "actualPng": str(actual_path), "actualPngSha256": hashlib.sha256(actual_path.read_bytes()).hexdigest(), "sourceGeometry": str(native_path), "layersMapped": layers, "mapping": "Actual Core posed triangles barycentrically mapped to exact native canvas sampling domain. Diagnostic ownership only, not renderer evidence."})
    (out / "mapping-provenance.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
