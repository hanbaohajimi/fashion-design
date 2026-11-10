"""Prepare b14 source coverage before same-source arm mesh partitioning, if accepted."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import Polygon, unary_union

loader = importlib.util.spec_from_file_location("local_coverage", Path(__file__).with_name("prepare-local-coverage-repair.py"))
local = importlib.util.module_from_spec(loader)
loader.loader.exec_module(local)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def t_junctions(p, t):
    edges = set()
    for a, b, c in t:
        edges.update((tuple(sorted((int(a), int(b)))), tuple(sorted((int(b), int(c)))), tuple(sorted((int(c), int(a))))))
    result = set()
    for a, b in edges:
        d = p[b] - p[a]
        length = float(np.linalg.norm(d))
        if length < 1e-8:
            continue
        f = ((p - p[a]) @ d) / length ** 2
        perpendicular = np.abs(local.cross2(d, p - p[a])) / length
        for v in np.where((f > 1e-7) & (f < 1 - 1e-7) & (perpendicular < .0001))[0]:
            if int(v) not in (a, b):
                result.add((a, b, int(v)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--geometry", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists()
    args.out.mkdir(parents=True)
    geometry = json.loads(args.geometry.read_text(encoding="utf-8"))
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    assert geometry["sourceSha256"] == "1a32dabeca86d3d481d45b833e292f5d423e70417b14cd5f2b6ea15154a93339"
    assert sha(Path(geometry["source"])) == geometry["sourceSha256"]
    assert local.shapely.__version__ == "2.1.2"
    sources = {x["id"]: x for x in metadata["layers"]}
    assert len(sources) == len(geometry["drawables"]) == 72
    repairs, unchanged, audits = [], [], []
    for d in geometry["drawables"]:
        row = sources[d["id"]]
        p = args.metadata.parent / row["path"]
        assert sha(p) == row["sha256"]
        assert d["sourceToCanvas"] == [1., 0., 0., 0., 1., 0.]
        alpha = np.asarray(Image.open(p).convert("RGBA"))[:, :, 3]
        result = local.repair_local(d["positions"], d["indices"], alpha)
        if result is None:
            unchanged.append(d["id"])
            continue
        assert d["id"] in {"Arm_R_Upper", "Braid_Tip", "Hair_BackMass", "Bodice_Olive", "Body_Base", "Hand_R", "Cape_R", "Scarf_Back"}
        # Existing draw-order-induced cells are retained, never flattened by this input.
        assert not d["geometryAxes"], "New b14 coverage must not silently extend an animated geometry grid"
        before = result.pop("sourceCoverageBeforeMask")
        after = result.pop("sourceCoverageAfterMask")
        Image.fromarray(((alpha > 0) & ~before).astype(np.uint8) * 255).save(args.out / f"{d['id']}-missing-before.png")
        Image.fromarray(((alpha > 0) & ~after).astype(np.uint8) * 255).save(args.out / f"{d['id']}-missing-after.png")
        # Native arrays are IEEE float32; JSON uses their shortest round-trip decimals.
        old_p = np.asarray(d["positions"], dtype=np.float32).astype(float).reshape(-1, 2)
        old_t = np.asarray(d["indices"], dtype=int).reshape(-1, 3)
        new_p = np.asarray(result["positions"], dtype=float).reshape(-1, 2)
        new_t = np.asarray(result["indices"], dtype=int).reshape(-1, 3)
        old_poly = [Polygon(old_p[t]) for t in old_t]
        new_poly = [Polygon(new_p[t]) for t in new_t]
        old_union, new_union = unary_union(old_poly), unary_union(new_poly)
        old_junctions, new_junctions = t_junctions(old_p, old_t), t_junctions(new_p, new_t)
        added_junctions = new_junctions - old_junctions
        overlap = max(0., sum(x.area for x in new_poly) - new_union.area)
        audits.append({"id": d["id"], "oldTJunctionCount": len(old_junctions), "newTJunctionCount": len(added_junctions), "introducedTJunctions": sorted(added_junctions), "triangleOverlapArea": overlap, "oldUnionLostArea": old_union.difference(new_union).area, "originalVertexPrefixUnchanged": np.array_equal(old_p, new_p[:len(old_p)])})
        assert not added_junctions and overlap < .00001
        assert audits[-1]["originalVertexPrefixUnchanged"]
        result.update(id=d["id"], sourceSha256=row["sha256"], originalPositions=d["positions"], originalIndices=d["indices"], originalUvs=d["uvs"], originalPlacement=d["placement"], existingGeometryAxes=d["geometryAxes"], requiresExtendEveryNativeLocalForm=True)
        repairs.append(result)
        print(json.dumps({"id": d["id"], "missingBefore": result["missingSourcePixelsBefore"], "missingAfter": result["missingSourcePixelsAfter"], "newVertices": result["newVertexCount"] - result["originalVertexCount"]}), flush=True)
    report = {"status": "b14_source_geometry_input_not_native_model", "sourceCmoSha256": geometry["sourceSha256"], "geometryInputSha256": sha(args.geometry), "metadataSha256": sha(args.metadata), "scriptSha256": sha(Path(__file__)), "repairAlgorithmSha256": sha(Path(local.__file__)), "selfTests": local.self_test(), "repairs": repairs, "unchangedDrawables": unchanged, "preserves": "Original source vertex prefix; only incident old triangles subdivided; local Forms not written by this script", "requiresActualEditorAtlasRerasterAndRepack": True, "requiresNativeLocalFormsExtension": True, "requiresRawSamplingDomainPreservation": True, "armPartitionStatus": "Not included; must use these augmented source triangles as its starting point if accepted"}
    (args.out / "local-coverage-repair-plan.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    topology = {"scope": "Float32 source-domain topology only; native parent-space and actual Core remain untested", "layers": audits, "summary": {"newTJunctionCount": sum(a["newTJunctionCount"] for a in audits), "maximumTriangleOverlapArea": max([a["triangleOverlapArea"] for a in audits], default=0.), "missingSourcePixelsBefore": sum(r["missingSourcePixelsBefore"] for r in repairs), "missingSourcePixelsAfter": sum(r["missingSourcePixelsAfter"] for r in repairs)}}
    (args.out / "local-topology-audit.json").write_text(json.dumps(topology, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"changedDrawables": len(repairs), "unchangedDrawables": len(unchanged), **topology["summary"]}))


if __name__ == "__main__":
    main()
