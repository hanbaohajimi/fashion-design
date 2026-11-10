"""Read-only native atlas triangle-union packing audit, not visual acceptance."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import Polygon, unary_union
from shapely.ops import nearest_points


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--geometry", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--drawable-map", type=Path)
    args = parser.parse_args()
    assert not args.out.exists()
    args.out.mkdir(parents=True)
    raw_bytes = args.geometry.read_bytes()
    data = json.loads(raw_bytes.decode("utf-8"))
    source = Path(data["source"])
    assert sha(source) == data["sourceSha256"]
    declaration_bytes = None
    if args.drawable_map:
        declaration_bytes = args.drawable_map.read_bytes()
        declaration = json.loads(declaration_bytes.decode("utf-8"))
        assert declaration["schemaVersion"] == 1 and declaration["characterId"] == "forest-spirit-front-v8"
        assert declaration["sourceLayerCount"] == 72 and declaration["drawableCount"] == 73
        assert data["sourceMetadataSha256"] == declaration["sourceMetadataSha256"]
        assert data["drawableDeclarationSha256"] == hashlib.sha256(declaration_bytes).hexdigest()
        sources = declaration["sourceToDrawables"]
        assert len(sources) == 72 and sources["Arm_R_Upper"] == ["Arm_R_Upper", "Arm_R_Upper_Front"]
        assert all(ids == [name] for name, ids in sources.items() if name != "Arm_R_Upper")
        expected_ids = [name for ids in sources.values() for name in ids]
        assert len(expected_ids) == len(set(expected_ids)) == 73
        assert len(data["drawables"]) == 73 and {d["id"] for d in data["drawables"]} == set(expected_ids)
    else:
        assert len(data["drawables"]) == 72
        sources = {d["id"]: [d["id"]] for d in data["drawables"]}
    geometries, rows, vertices, mesh_geometries, mesh_rows = {}, [], {}, {}, []
    for d in data["drawables"]:
        assert d["sourceToCanvas"] == [1., 0., 0., 0., 1., 0.]
        p = d["placement"]
        assert p["scaleX"] == p["scaleY"] == 1 and p["pageWidth"] == p["pageHeight"] == 2048
        xy = np.asarray(d["positions"], dtype=np.float32).astype(float).reshape(-1, 2)
        angle = math.radians(p["rotation"])
        transformed = np.column_stack((p["x"] + math.cos(angle) * xy[:, 0] - math.sin(angle) * xy[:, 1], p["y"] + math.sin(angle) * xy[:, 0] + math.cos(angle) * xy[:, 1]))
        indices = np.asarray(d["indices"], dtype=int).reshape(-1, 3)
        assert indices.min() >= 0 and indices.max() < len(xy)
        polygons = [Polygon(transformed[t]) for t in indices]
        combined = unary_union(polygons)
        assert combined.is_valid and not combined.is_empty
        mesh_geometries[d["id"]] = combined
        vertices[d["id"]] = transformed
        bounds = combined.bounds
        mesh_rows.append({"id": d["id"], "page": p["page"], "bounds": list(bounds), "triangleCount": len(indices), "triangleUnionArea": combined.area, "selfTriangleOverlapArea": max(0., sum(t.area for t in polygons) - combined.area)})
    by_id = {d["id"]: d for d in data["drawables"]}
    mesh_by_id = {d["id"]: d for d in mesh_rows}
    tile_ids = []
    for source_id, drawable_ids in sources.items():
        first = by_id[drawable_ids[0]]
        tile_id = first.get("sourceTileId", source_id)
        tile_ids.append(tile_id)
        if args.drawable_map:
            assert all(by_id[name]["sourceLayerId"] == source_id and by_id[name]["sourceTileId"] == tile_id for name in drawable_ids)
        assert all(by_id[name]["placement"] == first["placement"] for name in drawable_ids)
        if len(drawable_ids) > 1:
            assert all(by_id[name]["positions"] == first["positions"] and by_id[name]["uvs"] == first["uvs"] for name in drawable_ids)
        pieces = [mesh_geometries[name] for name in drawable_ids]
        combined = unary_union(pieces)
        piece_overlap = max(0., sum(part.area for part in pieces) - combined.area)
        assert piece_overlap <= 1e-5, "Same-source triangles must not double-cover atlas area"
        bounds = combined.bounds
        geometries[source_id] = combined
        rows.append({"id": source_id, "sourceTileId": tile_id, "drawableIds": drawable_ids,
                     "page": first["placement"]["page"], "bounds": list(bounds),
                     "triangleCount": sum(mesh_by_id[name]["triangleCount"] for name in drawable_ids),
                     "triangleUnionArea": combined.area, "sameSourceMeshOverlapArea": piece_overlap,
                     "within2048Page": bounds[0] >= -1e-6 and bounds[1] >= -1e-6 and bounds[2] <= 2048 + 1e-6 and bounds[3] <= 2048 + 1e-6,
                     "pageEdgeMinimumDistancePx": min(bounds[0], bounds[1], 2048 - bounds[2], 2048 - bounds[3]),
                     "selfTriangleOverlapArea": sum(mesh_by_id[name]["selfTriangleOverlapArea"] for name in drawable_ids) + piece_overlap})
    assert len(rows) == len(set(tile_ids)) == 72
    pairs = []
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if a["page"] != b["page"]:
                continue
            ga, gb = geometries[a["id"]], geometries[b["id"]]
            intersection = ga.intersection(gb).area
            distance = ga.distance(gb)
            aa, bb = a["bounds"], b["bounds"]
            bbox_overlap = max(0., min(aa[2], bb[2]) - max(aa[0], bb[0])) * max(0., min(aa[3], bb[3]) - max(aa[1], bb[1]))
            near_a, near_b = nearest_points(ga, gb)
            pairs.append({"page": a["page"], "ids": [a["id"], b["id"]], "triangleUnionIntersectionArea": intersection, "triangleUnionDistancePx": distance, "bboxIntersectionAreaDiagnosticOnly": bbox_overlap, "nearestPoints": [list(near_a.coords)[0], list(near_b.coords)[0]], "atLeast3pxPerSidePadding": distance >= 6. - 1e-5})
    pairs.sort(key=lambda x: x["triangleUnionDistancePx"])
    overlap = [p for p in pairs if p["triangleUnionIntersectionArea"] > 1e-5]
    narrow = [p for p in pairs if not p["atLeast3pxPerSidePadding"]]
    for page in sorted({r["page"] for r in rows}):
        image = Image.new("RGB", (2048, 2048), (245, 245, 245))
        draw = ImageDraw.Draw(image)
        for i, row in enumerate(r for r in rows if r["page"] == page):
            geometry = geometries[row["id"]]
            color = ((i * 47 + 70) % 150 + 50, (i * 31 + 90) % 150 + 50, (i * 67 + 110) % 150 + 50)
            for polygon in ([geometry] if geometry.geom_type == "Polygon" else geometry.geoms):
                draw.polygon(list(polygon.exterior.coords), fill=color, outline=(15, 15, 15), width=1)
                for interior in polygon.interiors:
                    draw.polygon(list(interior.coords), fill=(245, 245, 245))
            x, y, _, _ = row["bounds"]
            draw.text((max(1, x + 3), max(1, y + 3)), row["id"], fill=(0, 0, 0), stroke_width=1, stroke_fill=(255, 255, 255))
        for pair in narrow:
            if pair["page"] == page:
                draw.line([tuple(p) for p in pair["nearestPoints"]], fill=(255, 0, 0), width=4)
        image.save(args.out / f"page-{page}-actual-triangle-unions.png")
    report = {"scope": "Actual native source sampling transformed by saved atlas placement; true triangle unions, bbox overlap is diagnostic only. No texture or model edit.", "geometry": str(args.geometry.resolve()), "geometrySha256": hashlib.sha256(raw_bytes).hexdigest(), "nativeCmo": str(source), "nativeCmoSha256": data["sourceSha256"], "scriptSha256": sha(Path(__file__)), "pages": {str(p): sum(r["page"] == p for r in rows) for p in sorted({r["page"] for r in rows})}, "layers": rows, "pairs": pairs, "summary": {"outOfPageLayers": [r["id"] for r in rows if not r["within2048Page"]], "actualTriangleUnionOverlapPairs": len(overlap), "minimumSamePageUnionDistancePx": min(p["triangleUnionDistancePx"] for p in pairs), "pairsBelow6pxCombinedPadding": len(narrow), "minimumPageEdgeDistancePx": min(r["pageEdgeMinimumDistancePx"] for r in rows), "bboxOverlapsWithoutActualTriangleOverlap": sum(p["bboxIntersectionAreaDiagnosticOnly"] > 1e-5 and p["triangleUnionIntersectionArea"] <= 1e-5 for p in pairs)}, "actualOverlapPairs": overlap, "narrowMarginPairs": narrow, "allInputsUnchanged": args.geometry.read_bytes() == raw_bytes and sha(source) == data["sourceSha256"], "productionApproval": False, "limitations": ["Geometric separation does not prove texture raster edge dilation, filtered sampling quality or actual animation quality.", "Six-pixel combined distance is the explicit 3px-per-layer margin diagnostic; it does not overwrite any Cubism native atlas margin setting."]}
    report.update(sourceLayerCount=72, sourceTileCount=72, drawableCount=len(mesh_rows), drawables=mesh_rows,
                  packingComparisonUnit="Independent atlas source tile union; a shared Upper/Front edge is not an inter-tile padding failure")
    if declaration_bytes is not None:
        report["drawableDeclarationSha256"] = hashlib.sha256(declaration_bytes).hexdigest()
        report["allInputsUnchanged"] &= args.drawable_map.read_bytes() == declaration_bytes
    (args.out / "native-atlas-packing-audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.out / "native-atlas-packing-audit.json"), "summary": report["summary"], "allInputsUnchanged": report["allInputsUnchanged"]}))
    assert report["allInputsUnchanged"] and not overlap and all(r["within2048Page"] for r in rows)


if __name__ == "__main__":
    main()
