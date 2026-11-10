"""Validate a frozen CPU partition independently and package it for the native-domain writer.

This writes JSON evidence only. It neither edits a model nor claims an Editor/Core result.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import numpy as np
from PIL import Image
from shapely.geometry import Polygon
from shapely.ops import unary_union


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for key in ["manifest", "stage-a-report", "source-geometry", "metadata", "coverage", "out"]:
        ap.add_argument("--" + key, type=Path, required=True)
    args = ap.parse_args()
    assert not args.out.exists()
    frozen = {str(p.resolve()): sha(p) for p in [args.manifest, args.stage_a_report, args.source_geometry, args.metadata, args.coverage]}
    handoff = json.loads(args.manifest.read_text(encoding="utf8"))
    stage_a = json.loads(args.stage_a_report.read_text(encoding="utf8"))
    geometry = json.loads(args.source_geometry.read_text(encoding="utf8"))
    meta = json.loads(args.metadata.read_text(encoding="utf8"))
    coverage = json.loads(args.coverage.read_text(encoding="utf8"))
    assert stage_a["candidateWritten"] and stage_a["passed"] and all(stage_a["checks"].values())
    assert stage_a["metadataSha256"] == sha(args.metadata) == coverage["metadataSha256"]
    assert stage_a["coverageSha256"] == sha(args.coverage)
    assert sha(stage_a["candidate"]) == stage_a["candidateSha256"]
    assert len(meta["layers"]) == 72 and handoff["targetDrawableCount"] == 73
    old = next(x for x in geometry["drawables"] if x["id"] == "Arm_R_Upper")
    patch = next(x for x in coverage["repairs"] if x["id"] == "Arm_R_Upper")
    original = np.asarray(handoff["originalPositions"], np.float32).reshape(-1, 2)
    old_ix = np.asarray(handoff["originalIndices"], np.int64).reshape(-1, 3)
    assert np.array_equal(original.ravel(), np.asarray(old["positions"], np.float32))
    assert np.array_equal(original.ravel(), np.asarray(patch["positions"], np.float32))
    assert np.array_equal(old_ix.ravel(), old["indices"]) and np.array_equal(old_ix.ravel(), patch["indices"])
    points = np.asarray(handoff["positions"], np.float32).reshape(-1, 2).astype(float)
    front = np.asarray(handoff["frontIndices"], np.int64).reshape(-1, 3)
    back = np.asarray(handoff["backIndices"], np.int64).reshape(-1, 3)
    full = np.concatenate([front, back])
    assert full.min() >= 0 and full.max() < len(points)
    def areas(p, ix):
        a, b, c = p[ix[:, 0]], p[ix[:, 1]], p[ix[:, 2]]
        d, e = b-a, c-a
        return d[:, 0]*e[:, 1] - d[:, 1]*e[:, 0]
    old_areas, full_areas = areas(original.astype(float), old_ix), areas(points, full)
    old_union = unary_union([Polygon(original[t]) for t in old_ix])
    new_polys = [Polygon(points[t]) for t in full]
    new_union = unary_union(new_polys)
    front_union = unary_union([Polygon(points[t]) for t in front])
    back_union = unary_union([Polygon(points[t]) for t in back])
    lost_area, extra_area = old_union.difference(new_union).area, new_union.difference(old_union).area
    overlap = front_union.intersection(back_union).area
    all_overlap = sum(p.area for p in new_polys) - new_union.area
    boundary_distance = old_union.boundary.hausdorff_distance(new_union.boundary)
    # One float32 source-coordinate ULP near the 1620 px canvas is 0.000122 px.
    tolerance = .00013
    edges = {tuple(sorted((int(t[i]), int(t[(i+1) % 3])))) for t in full for i in range(3)}
    t_junctions = []
    for a, b in edges:
        edge = points[b] - points[a]; length = np.linalg.norm(edge)
        assert length > 0
        u = (points - points[a]) @ edge / (length*length)
        delta = points-points[a]
        distance = np.abs(edge[0]*delta[:, 1]-edge[1]*delta[:, 0]) / length
        close = np.where((u > tolerance/length) & (u < 1-tolerance/length) & (distance <= tolerance))[0]
        t_junctions += [[a, b, int(v)] for v in close if v not in (a, b)]
    module_spec = importlib.util.spec_from_file_location("source_mesh_coverage", Path(__file__).with_name("audit-neutral-mesh-coverage.py"))
    module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)
    row = next(x for x in meta["layers"] if x["id"] == "Arm_R_Upper")
    source_png = args.metadata.parent / row["path"]
    assert sha(source_png) == row["sha256"]
    source_alpha = np.asarray(Image.open(source_png).convert("RGBA"))[..., 3]
    old_mask = module.triangles_mask(original, old_ix.ravel(), 971, 1620)
    new_mask = module.triangles_mask(points, full.ravel(), 971, 1620)
    missing = int(np.count_nonzero((source_alpha > 0) & ~new_mask))
    pixel_loss = int(np.count_nonzero((source_alpha > 0) & old_mask & ~new_mask))
    ft, bt = set(map(tuple, front)), set(map(tuple, back))
    checks = {
        "originalVertexPrefixPreserved": np.array_equal(points[:len(original)], original),
        "allTriangleSetsFiniteNondegenerate": bool(np.isfinite(points).all() and np.isfinite(full_areas).all() and np.all(np.abs(full_areas) > 1e-6) and np.all(np.sign(full_areas) == np.sign(old_areas[0]))),
        "partitionIsDisjointExactIndexUnion": not (ft & bt) and len(ft)+len(bt) == len(full) and overlap <= 1e-5 and all_overlap <= 1e-5,
        "refinedSurfaceWithinFloat32Tolerance": boundary_distance <= tolerance and lost_area+extra_area <= tolerance*(old_union.length+new_union.length),
        "noNewTJunctions": len(t_junctions) == 0,
        "sourceAlphaCoverageNoLoss": missing == 0 and pixel_loss == 0,
    }
    report = {"scope": "Independent float32 source topology preflight. Not native/Core/visual acceptance.", "checks": checks, "originalVertexCount": len(original), "refinedVertexCount": len(points), "frontTriangles": len(front), "backTriangles": len(back), "lostSurfaceAreaPx2": lost_area, "extraSurfaceAreaPx2": extra_area, "frontBackOverlapAreaPx2": overlap, "allTriangleOverlapAreaPx2": all_overlap, "boundaryHausdorffPx": boundary_distance, "float32BoundaryTolerancePx": tolerance, "newTJunctions": t_junctions, "missingSourceAlphaPixels": missing, "originalSourceAlphaPixelLoss": pixel_loss, "frozenInputs": frozen}
    args.out.mkdir(parents=True)
    audit_path = args.out / "independent-topology-audit.json"
    audit_path.write_text(json.dumps(report, indent=2)+"\n", encoding="utf8")
    assert all(checks.values()), report
    assert handoff["frontMaskIds"] == ["Cape_R", "Scarf_Back", "Scarf_Lower", "Scarf_Middle", "Scarf_Upper", "Arm_R_Lower"]
    assert handoff["frontInvertMask"] and handoff["frontOpacity"] == 1 and handoff["frontConstantDrawOrder"] == 500
    plan = {"scope": "B14 WIP actual writer input; known CPU AA issue retained for actual Core review", "sourceCmoSha256": stage_a["candidateSha256"], "metadataSha256": sha(args.metadata), "coveragePlanSha256": sha(args.coverage), "childManifestSha256": sha(args.manifest), "sourceStageAReportPath": os.path.relpath(args.stage_a_report.resolve(), args.out.resolve()), "sourceStageAReportSha256": sha(args.stage_a_report), "topologyAuditPath": audit_path.name, "topologyAuditSha256": sha(audit_path), "originalPositions": original.ravel().tolist(), "originalIndices": old_ix.ravel().tolist(), "positions": points.ravel().tolist(), "frontIndices": front.ravel().tolist(), "backIndices": back.ravel().tolist(), "fullIndices": full.ravel().tolist(), "frontMaskIds": handoff["frontMaskIds"], "frontInvertMask": True, "frontDrawOrder": 500, "frontTieAfter": "Hair_BraidTie", "frontTieBefore": "Hair_Bangs_Center", "knownIssues": handoff["knownIssues"]}
    target = args.out / "partition-writer-plan.json"
    target.write_text(json.dumps(plan, indent=2)+"\n", encoding="utf8")
    source_map = {"schemaVersion": 1, "characterId": "forest-spirit-front-v8", "sourceLayerCount": 72, "drawableCount": 73, "sourceMetadataSha256": sha(args.metadata), "sourceToDrawables": {row["id"]: (["Arm_R_Upper", "Arm_R_Upper_Front"] if row["id"] == "Arm_R_Upper" else [row["id"]]) for row in meta["layers"]}}
    (args.out / "drawable-source-map.json").write_text(json.dumps(source_map, indent=2)+"\n", encoding="utf8")
    assert all(sha(path) == expected for path, expected in frozen.items())
    print(json.dumps({"passed": True, "plan": str(target), "planSha256": sha(target), "frontBackOverlapArea": overlap, "lostArea": lost_area, "extraArea": extra_area, "T": len(t_junctions), "sourceMissing": missing}))


if __name__ == "__main__":
    main()
