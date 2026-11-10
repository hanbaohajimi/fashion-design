"""Read-only pixel-center coverage of actual Core triangles against frozen fullbody art.

This diagnoses discarded pixels; it does not replace a model, score baseline, or artwork.
The fixed canvas transform is read from the actual export's declared PPU/origin arguments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(mask: np.ndarray):
    yy, xx = np.where(mask)
    return None if not len(xx) else [int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1]


def triangles_mask(vertices: np.ndarray, indices: np.ndarray, width: int, height: int):
    covered = np.zeros((height, width), dtype=bool)
    for triangle in indices.reshape(-1, 3):
        a, b, c = vertices[triangle]
        left = max(0, int(np.floor(min(a[0], b[0], c[0]))))
        top = max(0, int(np.floor(min(a[1], b[1], c[1]))))
        right = min(width, int(np.ceil(max(a[0], b[0], c[0]))))
        bottom = min(height, int(np.ceil(max(a[1], b[1], c[1]))))
        if left >= right or top >= bottom:
            continue
        yy, xx = np.mgrid[top:bottom, left:right]
        xx = xx + .5
        yy = yy + .5
        e0 = (b[0] - a[0]) * (yy - a[1]) - (b[1] - a[1]) * (xx - a[0])
        e1 = (c[0] - b[0]) * (yy - b[1]) - (c[1] - b[1]) * (xx - b[0])
        e2 = (a[0] - c[0]) * (yy - c[1]) - (a[1] - c[1]) * (xx - c[0])
        covered[top:bottom, left:right] |= ((e0 >= -1e-7) & (e1 >= -1e-7) & (e2 >= -1e-7)) | ((e0 <= 1e-7) & (e1 <= 1e-7) & (e2 <= 1e-7))
    return covered


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--drawable-map", type=Path)
    parser.add_argument("--native-geometry", type=Path)
    args = parser.parse_args()
    if args.out.exists():
        raise RuntimeError("New evidence output directory required")
    args.out.mkdir(parents=True)
    for folder in ["coverage", "source-missing", "visible-missing"]:
        (args.out / folder).mkdir()
    capture = json.loads(args.capture.read_text(encoding="utf-8"))
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    assert metadata["canvas"] == {"width": 971, "height": 1620}
    assert capture["canvas"] == {"width": 971, "height": 1620, "devicePixelRatio": 1, "fit": 1}
    source_ids = [x["id"] for x in metadata["layers"]]
    assert len(source_ids) == len(set(source_ids)) == 72
    source_to_drawables = {x: [x] for x in source_ids}
    native_by_id = None
    if args.drawable_map:
        declaration = json.loads(args.drawable_map.read_text(encoding="utf-8"))
        assert declaration["schemaVersion"] == 1 and declaration["characterId"] == "forest-spirit-front-v8"
        assert declaration["sourceLayerCount"] == 72 and declaration["drawableCount"] == 73
        assert declaration["sourceMetadataSha256"] == sha(args.metadata)
        source_to_drawables["Arm_R_Upper"] = ["Arm_R_Upper", "Arm_R_Upper_Front"]
        assert declaration["sourceToDrawables"] == source_to_drawables
        assert args.native_geometry is not None
        native = json.loads(args.native_geometry.read_text(encoding="utf-8"))
        assert sha(Path(native["source"])) == native["sourceSha256"]
        assert native["sourceMetadataSha256"] == sha(args.metadata)
        assert native["drawableDeclarationSha256"] == sha(args.drawable_map)
        native_by_id = {d["id"]: d for d in native["drawables"]}
        assert len(native_by_id) == 73
        for source, ids in source_to_drawables.items():
            for mesh_id in ids:
                assert native_by_id[mesh_id]["sourceLayerId"] == source
                assert native_by_id[mesh_id]["sourceTileId"] == native_by_id[source]["sourceTileId"]
    expected_ids = {i for ids in source_to_drawables.values() for i in ids}
    assert capture["officialEditorExport"] and capture["snapshot"]["drawableCount"] == len(expected_ids)
    assert capture["motionAndPhysicsStopped"]
    # Exact export condition confirmed by actual CMO/Core integration: no fitted registration.
    width, height, ppu, origin_x, origin_y = 971, 1620, 971.0, 485.5, 810.0
    core_canvas = capture["snapshot"].get("canvasInfo")
    if core_canvas is not None:
        assert core_canvas == {"widthPixels": width, "heightPixels": height, "originX": origin_x, "originY": origin_y, "pixelsPerUnit": ppu}
        assert capture["snapshot"]["pixelsPerUnit"] == ppu
    by_id = {x["id"]: x for x in capture["snapshot"]["drawables"]}
    assert len(by_id) == len(expected_ids) and set(by_id) == expected_ids
    remaining = np.ones((height, width), dtype=np.float64)
    covered_remaining = np.ones_like(remaining)
    all_visible_loss = np.zeros_like(remaining)
    all_missing = np.zeros((height, width), dtype=bool)
    rows = []
    for layer in sorted(metadata["layers"], key=lambda x: x["order"], reverse=True):
        drawable = by_id[layer["id"]]
        source = args.metadata.parent / layer["path"]
        assert sha(source) == layer["sha256"]
        rgba = np.asarray(Image.open(source).convert("RGBA"))
        raw_alpha = rgba[:, :, 3].astype(np.float64) / 255
        alpha = raw_alpha * drawable["opacity"]
        mesh_ids = source_to_drawables[layer["id"]]
        mask = np.zeros((height, width), dtype=bool)
        triangle_count = vertex_count = 0
        split_unions = []
        for mesh_id in mesh_ids:
            part = by_id[mesh_id]
            assert part["opacity"] == drawable["opacity"]
            vertices = np.asarray(part["vertexPositions"], dtype=np.float64).reshape(-1, 2)
            vertices[:, 0] = vertices[:, 0] * ppu + origin_x
            vertices[:, 1] = origin_y - vertices[:, 1] * ppu
            indices = np.asarray(part["vertexIndices"], dtype=np.int64)
            assert np.isfinite(vertices).all() and len(indices) % 3 == 0
            if native_by_id is not None:
                raw = np.asarray(native_by_id[mesh_id]["positions"], dtype=float).reshape(-1, 2)
                assert raw.shape == vertices.shape and np.max(np.abs(raw - vertices)) <= .001
                native_indices = np.asarray(native_by_id[mesh_id]["indices"], dtype=np.int64).reshape(-1, 3)
                assert np.array_equal(indices.reshape(-1, 3), native_indices[:, ::-1])
                if len(mesh_ids) > 1:
                    from shapely.geometry import Polygon
                    from shapely.ops import unary_union
                    split_unions.append(unary_union([Polygon(raw[t]) for t in native_indices]))
            mask |= triangles_mask(vertices, indices, width, height)
            triangle_count += len(indices) // 3
            vertex_count += len(vertices)
        if split_unions:
            assert len(split_unions) == 2 and split_unions[0].intersection(split_unions[1]).area <= .00001, "Shared-source pieces may not duplicate triangle area"
        visible = alpha * remaining
        missing = (raw_alpha > 0) & ~mask
        visible_loss = visible * ~mask
        important = visible_loss >= .1
        labels, count = ndimage.label(important)
        components = []
        for label, slices in enumerate(ndimage.find_objects(labels), start=1):
            if slices is None:
                continue
            yy, xx = slices
            pixels = labels[slices] == label
            components.append({"bbox": [xx.start, yy.start, xx.stop, yy.stop], "pixels": int(pixels.sum()), "alphaMass": float(visible_loss[slices][pixels].sum()), "maximumContribution": float(visible_loss[slices][pixels].max())})
        components.sort(key=lambda x: x["alphaMass"], reverse=True)
        rows.append({"id": layer["id"], "drawableIds": mesh_ids, "order": layer["order"], "sourceSha256": layer["sha256"], "opacity": drawable["opacity"], "verticesAcrossMeshes": vertex_count, "triangles": triangle_count, "uncoveredSourceAlphaPixels": int(missing.sum()), "sourceMissingBounds": bounds(missing), "visibleMissingContributionAtLeast0_1": int(important.sum()), "visibleMissingContributionAtLeast0_5": int((visible_loss >= .5).sum()), "visibleAlphaMassLost": float(visible_loss.sum()), "visibleMissingBounds": bounds(important), "importantComponents": components})
        Image.fromarray(mask.astype(np.uint8) * 255).save(args.out / "coverage" / f"{layer['id']}.png")
        if missing.any():
            Image.fromarray(missing.astype(np.uint8) * 255).save(args.out / "source-missing" / f"{layer['id']}.png")
        if important.any():
            Image.fromarray(np.clip(np.rint(visible_loss * 255), 0, 255).astype(np.uint8)).save(args.out / "visible-missing" / f"{layer['id']}.png")
        all_visible_loss += visible_loss
        all_missing |= missing
        remaining *= 1 - alpha
        covered_remaining *= 1 - alpha * mask
    ideal_alpha = 1 - remaining
    predicted_alpha = 1 - covered_remaining
    predicted_deficit = np.clip(ideal_alpha - predicted_alpha, 0, 1)
    actual_path = Path(capture["png"]["path"])
    actual = np.asarray(Image.open(actual_path).convert("RGBA"))
    actual_alpha = actual[:, :, 3].astype(np.float64) / 255
    actual_deficit = np.clip(ideal_alpha - actual_alpha, 0, 1)
    Image.fromarray(np.rint(predicted_deficit * 255).astype(np.uint8)).save(args.out / "predicted-alpha-deficit.png")
    Image.fromarray(np.clip(np.rint(all_visible_loss * 255), 0, 255).astype(np.uint8)).save(args.out / "visible-contribution-deficit.png")
    Image.fromarray(np.rint(actual_deficit * 255).astype(np.uint8)).save(args.out / "actual-alpha-deficit.png")
    overlay = Image.alpha_composite(Image.new("RGBA", (width, height), (224, 234, 216, 255)), Image.fromarray(actual, "RGBA")).convert("RGB")
    overlay_pixels = np.asarray(overlay).copy()
    marks = all_visible_loss >= .1
    overlay_pixels[marks] = (255, 0, 80)
    Image.fromarray(overlay_pixels).save(args.out / "visible-missing-overlay.png")
    rows.sort(key=lambda x: x["visibleAlphaMassLost"], reverse=True)
    region = np.s_[245:280, 285:325]
    report = {"status": "coverage_diagnostic_not_acceptance", "capture": str(args.capture.resolve()), "captureSha256": sha(args.capture), "metadata": str(args.metadata.resolve()), "metadataSha256": sha(args.metadata), "actualPngSha256": sha(actual_path), "canvas": [width, height], "pixelCenter": .5, "fixedCoreTransform": {"ppu": ppu, "originX": origin_x, "originY": origin_y, "x": "coreX*971+485.5", "y": "810-coreY*971", "fittedRegistration": False}, "layerOrderBasis": "Frozen 72 layer metadata back-to-front order already audited identical in actual native CMO; actual exported per-layer opacity used", "layers": rows, "summary": {"sourceUncoveredPixelsUnion": int(all_missing.sum()), "visibleContributionMissingAtLeast0_1Pixels": int(marks.sum()), "visibleContributionMissingAtLeast0_5Pixels": int((all_visible_loss >= .5).sum()), "predictedAlphaDropAtLeast0_1Pixels": int((predicted_deficit >= .1).sum()), "actualAlphaDropAtLeast0_1Pixels": int((actual_deficit >= .1).sum()), "predictedAndActualDropOverlapAtLeast0_1Pixels": int(((predicted_deficit >= .1) & (actual_deficit >= .1)).sum()), "hatRegionPredictedVsActualAlphaDeficitMAE": float(np.abs(predicted_deficit[region] - actual_deficit[region]).mean())}, "limitations": ["Coverage uses actual Core triangles at pixel centers; antialiasing and texture bilinear sampling remain separately visible in actual screenshots.", "No source pixels, model, atlas or benchmark altered.", "Hidden uncovered art and neutrally visible losses are reported separately; not every hidden pixel is currently required by a limited motion."]}
    report.update({"sourceLayerCount": 72, "drawableCount": len(expected_ids), "sourceToDrawables": source_to_drawables})
    if args.drawable_map:
        report.update({"drawableDeclarationSha256": sha(args.drawable_map), "nativeGeometrySha256": sha(args.native_geometry)})
        report["limitations"].append("Shared-source coverage is the union of two disjoint native triangle sets, before clipping. Each production PNG contributes only once to the ideal neutral source composite. This is not a mask/order/render-equivalence proof; actual Core images must be tested separately.")
    (args.out / "coverage-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.out / "coverage-report.json"), "summary": report["summary"], "largest": [{k: row[k] for k in ["id", "visibleMissingContributionAtLeast0_1", "visibleAlphaMassLost", "importantComponents"]} for row in rows[:12]]}))


if __name__ == "__main__":
    main()
