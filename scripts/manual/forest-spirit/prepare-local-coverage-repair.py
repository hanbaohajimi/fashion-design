"""Append local source-alpha coverage and split only incident boundary triangles.

No source art or existing vertex is moved. This emits mesh input, not a CMO/MOC.
Requires pinned Shapely 2.1.2 for exact polygon difference and constrained triangles.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
import shapely
from shapely import Polygon, MultiPoint, box, unary_union, constrained_delaunay_triangles

loader = importlib.util.spec_from_file_location("mesh_coverage", Path(__file__).with_name("audit-neutral-mesh-coverage.py"))
coverage_module = importlib.util.module_from_spec(loader)
loader.loader.exec_module(coverage_module)
coverage_mask = coverage_module.triangles_mask


def cross2(a, b):
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def repair_local(positions, indices, source_alpha):
    positions = np.asarray(positions, dtype=np.float32).reshape(-1, 2)
    indices = np.asarray(indices, dtype=np.int64).reshape(-1, 3)
    height, width = source_alpha.shape
    before_mask = coverage_mask(positions.astype(float), indices, width, height)
    missing = (source_alpha > 0) & ~before_mask
    if not missing.any():
        return None
    old_polygons = [Polygon(positions[t].astype(float)) for t in indices]
    old_union = unary_union(old_polygons)
    assert old_union.is_valid
    label_image, _ = ndimage.label(missing, structure=np.ones((3, 3), dtype=np.uint8))
    local_regions = []
    for label, slices in enumerate(ndimage.find_objects(label_image), start=1):
        if slices is None:
            continue
        yy, xx = np.where(label_image[slices] == label)
        xx += slices[1].start
        yy += slices[0].start
        # Hull is local to one connected missing component, then conservatively padded.
        corners = np.column_stack([np.repeat(xx, 4) + np.tile([0, 1, 1, 0], len(xx)), np.repeat(yy, 4) + np.tile([0, 0, 1, 1], len(yy))])
        local_regions.append(MultiPoint(corners).convex_hull.buffer(1.5, quad_segs=1, join_style="mitre"))
    addition = unary_union(local_regions).difference(old_union)
    assert addition.is_valid
    added_triangles = list(constrained_delaunay_triangles(addition).geoms)
    vertex_list = [p.copy() for p in positions]
    vertex_map = {tuple(map(float, point)): index for index, point in enumerate(vertex_list)}

    def vertex_id(point):
        p = np.asarray(point, dtype=np.float32)
        key = tuple(map(float, p))
        if key not in vertex_map:
            # Boolean intersections within float rounding of an original point use its identity.
            dist = np.abs(positions.astype(float) - p.astype(float)).max(axis=1)
            match = np.where(dist < .00004)[0]
            if len(match):
                return int(match[0])
            vertex_map[key] = len(vertex_list)
            vertex_list.append(p)
        return vertex_map[key]

    sign = np.sign(cross2(positions[indices[0, 1]] - positions[indices[0, 0]], positions[indices[0, 2]] - positions[indices[0, 0]]))
    added_indices = []
    discarded_area = 0.0
    for triangle in added_triangles:
        corners = list(triangle.exterior.coords)[:3]
        tri = [vertex_id(p) for p in corners]
        p = np.asarray([vertex_list[i] for i in tri], dtype=float)
        area = float(cross2(p[1] - p[0], p[2] - p[0]))
        if len(set(tri)) < 3 or abs(area) <= 1e-6:
            discarded_area += triangle.area
            continue
        if np.sign(area) != sign:
            tri[1], tri[2] = tri[2], tri[1]
        added_indices.append(tri)
    original_vertex_count = len(positions)
    edge_triangles = {}
    for triangle_index, tri in enumerate(indices):
        for a, b in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])]:
            edge_triangles.setdefault(tuple(sorted([int(a), int(b)])), []).append(triangle_index)
    split_edges = {}
    added_vertices = np.asarray(vertex_list[original_vertex_count:], dtype=float)
    for (a, b), incident in edge_triangles.items():
        if len(incident) != 1 or not len(added_vertices):
            continue
        av = positions[a].astype(float)
        vector = positions[b].astype(float) - av
        length = float(np.linalg.norm(vector))
        projection = ((added_vertices - av) @ vector) / length ** 2
        perpendicular = np.abs(cross2(vector, added_vertices - av)) / length
        matches = np.where((projection > 1e-7) & (projection < 1 - 1e-7) & (perpendicular < .0001))[0]
        if len(matches):
            split_edges[(a, b)] = [int(i + original_vertex_count) for i in matches[np.argsort(projection[matches])]]
    result_indices = []
    changed_old_triangles = []
    retained_old_triangles = []
    for triangle_index, tri in enumerate(indices):
        ring = []
        split = False
        for a, b in [(int(tri[0]), int(tri[1])), (int(tri[1]), int(tri[2])), (int(tri[2]), int(tri[0]))]:
            ring.append(a)
            key = tuple(sorted([a, b]))
            if key in split_edges:
                middle = split_edges[key]
                if a != key[0]:
                    middle = list(reversed(middle))
                ring.extend(middle)
                split = True
        if not split:
            result_indices.append(tri.tolist())
            retained_old_triangles.append(triangle_index)
            continue
        changed_old_triangles.append(triangle_index)
        center_id = vertex_id(positions[tri].astype(float).mean(axis=0))
        for a, b in zip(ring, ring[1:] + ring[:1]):
            if a != b:
                result_indices.append([a, b, center_id])
    result_indices.extend(added_indices)
    final_positions = np.asarray(vertex_list, dtype=np.float32)
    final_indices = np.asarray(result_indices, dtype=np.int64)
    assert np.array_equal(final_positions[:original_vertex_count], positions)
    areas = cross2(final_positions[final_indices[:, 1]].astype(float) - final_positions[final_indices[:, 0]].astype(float), final_positions[final_indices[:, 2]].astype(float) - final_positions[final_indices[:, 0]].astype(float))
    assert np.isfinite(areas).all() and (np.abs(areas) > 1e-6).all(), "New degenerate triangle"
    final_polygons = [Polygon(final_positions[t].astype(float)) for t in final_indices]
    final_union = unary_union(final_polygons)
    lost_old_area = old_union.difference(final_union).area
    overlap_area = sum(p.area for p in final_polygons) - final_union.area
    # Float32 CMO points can shift by <0.0001px; report geometric area, never hide missing pixels.
    assert lost_old_area < .02, ("Original surface lost", lost_old_area)
    assert overlap_area < .02, ("New triangle overlaps", overlap_area)
    after_mask = coverage_mask(final_positions.astype(float), final_indices, width, height)
    missing_after = (source_alpha > 0) & ~after_mask
    assert not missing_after.any(), f"Still missing {missing_after.sum()} source pixels"
    # Every old boundary split participates in the new topology on both sides.
    edges = {}
    for tri in final_indices:
        for a, b in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])]:
            edges[tuple(sorted([int(a), int(b)]))] = edges.get(tuple(sorted([int(a), int(b)])), 0) + 1
    assert max(edges.values()) <= 2, "Non-manifold overlap edge"
    return {"positions": final_positions.ravel().tolist(), "indices": final_indices.ravel().tolist(), "originalVertexCount": original_vertex_count, "originalTriangleCount": len(indices), "newVertexCount": len(final_positions), "newTriangleCount": len(final_indices), "retainedOldTriangleIndices": retained_old_triangles, "locallySplitOldTriangleIndices": changed_old_triangles, "missingSourcePixelsBefore": int(missing.sum()), "missingSourcePixelsAfter": int(missing_after.sum()), "sourceAlphaAtLeast128MissingBefore": int((missing & (source_alpha >= 128)).sum()), "sourceAlphaAtLeast240MissingBefore": int((missing & (source_alpha >= 240)).sum()), "missingBounds": coverage_module.bounds(missing), "addedGeometryBounds": list(addition.bounds), "addedGeometryArea": addition.area, "originalSurfaceAreaLostAfterFloat32": lost_old_area, "triangleOverlapAreaAfterFloat32": overlap_area, "discardedFloat32SubpixelArea": discarded_area, "minimumAbsoluteTriangleDoubleArea": float(np.abs(areas).min()), "maxEdgeIncidence": max(edges.values()), "sourceCoverageBeforeMask": before_mask, "sourceCoverageAfterMask": after_mask}


def self_test():
    points = np.asarray([[2, 2], [12, 2], [2, 12], [22, 22], [28, 22], [22, 28]], dtype=np.float32)
    triangles = np.asarray([[0, 1, 2], [3, 4, 5]])
    alpha = np.zeros((32, 32), dtype=np.uint8)
    alpha[8:12, 8:12] = 255
    result = repair_local(points, triangles, alpha)
    assert result and result["missingSourcePixelsAfter"] == 0
    assert 1 in result["retainedOldTriangleIndices"]
    assert np.array_equal(np.asarray(result["positions"], dtype=np.float32).reshape(-1, 2)[:6], points)
    alpha2 = np.zeros((32, 32), dtype=np.uint8)
    alpha2[18:20, 4:6] = 255
    separate = repair_local(points, triangles, alpha2)
    assert separate and separate["retainedOldTriangleIndices"] == [0, 1]
    alpha3 = np.zeros((32, 32), dtype=np.uint8)
    alpha3[3, 3] = 255
    assert repair_local(points, triangles, alpha3) is None
    return {"localBoundaryExtension": True, "farTrianglesAndOriginalVerticesUnchanged": True, "disconnectedSourceIslandLocalAddition": True, "alreadyCoveredNoMutation": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--geometry", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    assert shapely.__version__ == "2.1.2"
    tests = self_test()
    if args.out.exists():
        raise RuntimeError("New output directory required")
    args.out.mkdir(parents=True)
    geometry = json.loads(args.geometry.read_text(encoding="utf-8"))
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    sources = {x["id"]: x for x in metadata["layers"]}
    repairs = []
    untouched = []
    for drawable in geometry["drawables"]:
        layer = sources[drawable["id"]]
        path = args.metadata.parent / layer["path"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == layer["sha256"]
        alpha = np.asarray(Image.open(path).convert("RGBA"))[:, :, 3]
        result = repair_local(drawable["positions"], drawable["indices"], alpha)
        if result is None:
            untouched.append(drawable["id"])
            continue
        assert not drawable["geometryAxes"], f"Existing bound mesh requires explicit keyform extension: {drawable['id']}"
        before_mask = result.pop("sourceCoverageBeforeMask")
        after_mask = result.pop("sourceCoverageAfterMask")
        Image.fromarray(((alpha > 0) & ~before_mask).astype(np.uint8) * 255).save(args.out / f"{drawable['id']}-missing-before.png")
        Image.fromarray(((alpha > 0) & ~after_mask).astype(np.uint8) * 255).save(args.out / f"{drawable['id']}-missing-after.png")
        result.update({"id": drawable["id"], "sourceSha256": layer["sha256"], "originalPositions": drawable["positions"], "originalIndices": drawable["indices"], "originalUvs": drawable["uvs"], "originalPlacement": drawable["placement"]})
        repairs.append(result)
        print(json.dumps({"id": drawable["id"], "before": result["missingSourcePixelsBefore"], "after": result["missingSourcePixelsAfter"], "verticesAdded": result["newVertexCount"] - result["originalVertexCount"], "splitTriangles": len(result["locallySplitOldTriangleIndices"])}), flush=True)
    report = {"status": "local_mesh_input_prepared_native_CMO_and_Editor_repack_pending", "sourceCmoSha256": geometry["sourceSha256"], "geometryInputSha256": hashlib.sha256(args.geometry.read_bytes()).hexdigest(), "metadataSha256": hashlib.sha256(args.metadata.read_bytes()).hexdigest(), "libraries": {"shapely": shapely.__version__, "geos": shapely.geos_version_string}, "selfTests": tests, "preserves": "All original vertices; all old triangles except locally incident boundary triangles split at shared added vertices; source art and existing atlas not edited", "repairSourceAlphaThreshold": 1, "paddingPixels": 1.5, "repairs": repairs, "unchangedDrawables": untouched, "requiresActualEditorAtlasRerasterAndRepack": True, "reason": "Expanded local source coverage can exceed old mesh-clipped raster footprint and old atlas page bounds; current new UVs are provisional until actual Editor repack."}
    (args.out / "local-coverage-repair-plan.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.out / "local-coverage-repair-plan.json"), "changedDrawables": len(repairs), "unchangedDrawables": len(untouched), "missingBefore": sum(x['missingSourcePixelsBefore'] for x in repairs), "missingAfter": sum(x['missingSourcePixelsAfter'] for x in repairs)}))


if __name__ == "__main__":
    main()
