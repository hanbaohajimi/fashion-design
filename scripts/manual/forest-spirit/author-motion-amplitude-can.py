"""Scale two reviewed native CAN curves into an isolated PROGRAM_DRAFT.

No model, source CAN, official export, curve time, or physics track is edited.
The copied native format is the already Editor-reopened four-scene r4 template.
"""
from pathlib import Path
import argparse
import ast
import copy
import hashlib
import json
import math
import struct
import xml.etree.ElementTree as ET
import zlib

REPO = Path(__file__).resolve().parents[3]
STAGE = REPO / "output/forest-spirit-production-v2/front-v8"
SOURCE = STAGE / "cubism/forest_spirit_front_v8_four_scene_fullbody_WIP_r4.can3"
EXPORTS = STAGE / "cubism/exports/four-scene-fullbody-WIP-r4-editor"
SOURCE_SHA = "37d585ac4dbd2cb2efdb4c7ef8edc8db2076116732803832e2dec8db62c4f04c"
CHANGES = {("Idle_STAGE", "ParamBreath"): (0.22, 1.0), ("Hover_STAGE", "ParamAngleY"): (3.0, 27.0)}
PHYSICS = {"ParamFSHairBackSway", "ParamFSBraidSway", "ParamFSHatBrimSway", "ParamFSScarfSway", "ParamFSSkirtSway", "ParamFSPouchSway"}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", required=True, help="Unused directory below repository output/")
args = parser.parse_args()
out = (REPO / args.out).resolve()
assert out.is_relative_to((REPO / "output").resolve()) and not out.exists()
out.mkdir(parents=True)
dest = out / "forest_spirit_front_v8_four_scene_amplitude_PROGRAM_DRAFT_r1.can3"
inputs = []


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    data = path.read_bytes()
    inputs.append({"path": str(path), "sha256": digest(data), "bytes": len(data)})
    return data


# Only definitions, not the old audit's top-level write operations, are reused.
helper_path = STAGE / "quality/can-idle-r1-audit/audit-and-copy.py"
helper = ast.parse(read(helper_path).decode("utf8"))
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n, ast.FunctionDef) and n.name in ["decode", "named", "scalar"]], type_ignores=[]), str(helper_path), "exec"))
source = read(SOURCE)
assert digest(source) == SOURCE_SHA, "Native source changed; stop before altering the copy"
xml, container = decode(source)
root = ET.fromstring(xml)
original = copy.deepcopy(root)


def inspect(tree):
    refs = {n.get("xs.id"): n for n in tree.iter() if n.get("xs.id")}
    assert len(refs) == len([n for n in tree.iter() if n.get("xs.id")])
    assert all(n.get("xs.ref") in refs for n in tree.iter() if n.get("xs.ref"))
    animation = next(n for n in refs.values() if n.tag == "CAnimation")
    globals_ = {key for key, n in refs.items() if n.tag in ["CAnimation", "CResourceManager", "CResourceGuid", "CResourceGroupGuid", "CResourceData"]}

    def closure(ident):
        seen, pending = set(), [ident]
        while pending:
            key = pending.pop()
            if key in seen or key in globals_:
                continue
            seen.add(key)
            pending.extend(n.get("xs.ref") for n in refs[key].iter() if n.get("xs.ref"))
        return [refs[key] for key in sorted(seen)]

    scenes = {}
    for ref in named(animation, "_scenes"):
        scene = refs[ref.get("xs.ref")]
        name = scalar(scene, "sceneName")
        attrs = {}
        for node in closure(ref.get("xs.ref")):
            if node.tag != "CMvAttrF":
                continue
            idnode = named(named(node, "super"), "id")
            ident = refs.get(idnode.get("xs.ref"), idnode).get("idstr")
            if ident.startswith("live2dParam_"):
                attrs[ident.removeprefix("live2dParam_")] = node
        assert len(attrs) == 17
        scenes[name] = (scene, attrs)
    assert set(scenes) == {"Idle_STAGE", "Hover_STAGE", "DragHold_STAGE", "PutDown_STAGE"}
    return animation, scenes


def sequence(attr):
    return named(attr, "valueData")


def points(attr):
    return list(named(sequence(attr), "points"))


def motion_keys(curve):
    values = curve["Segments"]
    keys = [{"frame": values[0] * 60, "value": values[1]}]
    for at in range(2, len(values), 7):
        assert values[at] == 1
        t1, v1, t2, v2, t3, v3 = values[at + 1:at + 7]
        keys[-1]["next"] = (t1 * 60, v1)
        keys.append({"frame": t3 * 60, "value": v3, "prev": (t2 * 60, v2)})
    return keys


animation, scenes = inspect(root)
_, before_scenes = inspect(original)
checks = []
changes = []
motion_dir = out / "motion-inputs-PROGRAM_DRAFT"
motion_dir.mkdir()
manifest = {"designation": "PROGRAM_DRAFT", "editorExported": False, "productionApproval": False, "characterId": "forest-spirit-front-v8", "files": [], "excludedPhysicsOutputParameters": sorted(PHYSICS), "loopPolicy": {"Idle_STAGE": True, "Hover_STAGE": False, "DragHold_STAGE": False, "PutDown_STAGE": False}, "sourceMethod": "Only two value/control-value scalings of actual Editor r4 motion inputs; native CAN is separately scaled at original precise times. All other official inputs are byte copies, not new exports."}

for scene_name, (scene, attrs) in scenes.items():
    official_path = EXPORTS / f"{scene_name}.motion3.json"
    official_bytes = read(official_path)
    official = json.loads(official_bytes)
    movie = named(scene, "movieInfo")
    assert float(scalar(movie, "fps")) == official["Meta"]["Fps"] == 60
    assert int(scalar(movie, "duration")) == round(official["Meta"]["Duration"] * 60)
    assert len(official["Curves"]) == 11
    assert len([a for a in attrs.values() if points(a)]) == 11
    assert all(not points(attrs[ident]) for ident in PHYSICS)
    for curve in official["Curves"]:
        ident = curve["Id"]
        assert curve["Target"] == "Parameter" and ident not in PHYSICS
        have = points(attrs[ident])
        expected = motion_keys(curve)
        assert len(have) == len(expected)
        errors = []
        anchor_errors = []
        for point, key in zip(have, expected):
            anchor_errors.append(abs(float(scalar(named(point, "anchor"), "pos")) - key["frame"]))
            assert abs(float(scalar(named(point, "anchor"), "doubleValue")) - key["value"]) < 1e-9
            for direction in ("prev", "next"):
                if direction in key:
                    control = named(point, direction)
                    assert scalar(control, "isPosOptimized") == "false"
                    frame, value = key[direction]
                    errors.append(abs(float(scalar(control, "posF")) - frame))
                    assert abs(float(scalar(control, "doubleValue")) - value) < 1e-9
        # Actual native exporter writes time to three decimals, <=.0005s.
        assert max(errors + anchor_errors, default=0) <= 0.030001
        checks.append({"scene": scene_name, "parameter": ident, "sourceCanAndActualExportAnchorValuesExact": True, "sourceHandleValuesExact": True, "maxExportAnchorTimeQuantizationFrames": max(anchor_errors, default=0), "maxExportHandleTimeQuantizationFrames": max(errors, default=0)})
    candidate = copy.deepcopy(official)
    for curve in candidate["Curves"]:
        key = (scene_name, curve["Id"])
        if key not in CHANGES:
            continue
        old_peak, new_peak = CHANGES[key]
        attr = attrs[curve["Id"]]
        values = [float(scalar(named(p, "anchor"), "doubleValue")) for p in points(attr)]
        assert min(values) == 0 and max(values) == old_peak
        assert float(scalar(attr, "rangeMin")) <= 0 <= new_peak <= float(scalar(attr, "rangeMax"))
        for point in points(attr):
            for direction in ("anchor", "prev", "next"):
                field = named(named(point, direction), "doubleValue")
                field.text = repr(float(field.text) / old_peak * new_peak)
        state = named(sequence(attr), "super")
        changed_state = []
        for field in ("curMin", "curMax", "lastValue", "baseValue"):
            element = named(state, field)
            old = element.text
            # Native NaN is a cached-value sentinel, not an authored key. Keep
            # its exact Java spelling; Python's lowercase nan is not equivalent.
            if math.isfinite(float(old)):
                element.text = repr(float(old) / old_peak * new_peak)
            changed_state.append({"field": field, "before": old, "after": element.text})
        segments = curve["Segments"]
        segments[1] = segments[1] / old_peak * new_peak
        for at in range(2, len(segments), 7):
            for offset in (2, 4, 6):
                segments[at + offset] = segments[at + offset] / old_peak * new_peak
        changes.append({"scene": scene_name, "parameter": curve["Id"], "oldPeak": old_peak, "newPeak": new_peak, "valueScale": new_peak / old_peak, "stateFields": changed_state, "anchorAndBothHandleValuesScaled": True, "allTimesUnchanged": True, "neutralFirstLast": [segments[1], segments[-1]]})
    # Unchanged motions remain exact copies including official exporter formatting.
    data = official_bytes if candidate == official else (json.dumps(candidate, ensure_ascii=False, indent=2) + "\n").encode()
    target = motion_dir / official_path.name
    target.write_bytes(data)
    manifest["files"].append({"path": str(target), "sha256": digest(data), "source": str(official_path), "sourceSha256": digest(official_bytes), "scaled": candidate != official, "duration": candidate["Meta"]["Duration"], "curveCount": 11, "metaPreserved": candidate["Meta"] == official["Meta"], "actualExportLoopField": candidate["Meta"]["Loop"]})

# Only two attribute value subtrees plus the copied project's self path may differ.
text_changes = []
allowed_ids = {scenes[s][1][p].get("xs.id") for s, p in CHANGES}
for before, after in zip(original.iter(), root.iter()):
    assert before.tag == after.tag and before.attrib == after.attrib and before.tail == after.tail
    if before.text != after.text:
        text_changes.append({"field": before.get("xs.n"), "before": before.text, "after": after.text})
for scene_name, (_, attrs) in scenes.items():
    for ident, attr in attrs.items():
        if (scene_name, ident) not in CHANGES:
            assert ET.tostring(attr) == ET.tostring(before_scenes[scene_name][1][ident])
# Restore the two full attr copies in an audit tree, then require entire XML tree exact.
audit = copy.deepcopy(root)
_, audit_scenes = inspect(audit)
for s, ident in CHANGES:
    target = audit_scenes[s][1][ident]
    prior = before_scenes[s][1][ident]
    target.clear(); target.tag = prior.tag; target.attrib.update(prior.attrib)
    target.text = prior.text; target.tail = prior.tail
    target.extend(copy.deepcopy(list(prior)))
assert ET.tostring(audit) == ET.tostring(original)
assert len(allowed_ids) == 2 and len(checks) == 44
old_project_path = named(animation, "file").text
named(animation, "file").text = str(dest)
prologue = xml[:xml.index(b"<root")]
new_xml = prologue + ET.tostring(root, encoding="utf-8") + b"\n"
ET.fromstring(new_xml)
compressor = zlib.compressobj(level=1, wbits=-15)
compressed = compressor.compress(new_xml) + compressor.flush()
payload = container["payload"][:container["start"]] + compressed + struct.pack("<4sIII", b"PK\x07\x08", zlib.crc32(new_xml), len(compressed), len(new_xml))
prefix = bytearray(source[:container["offset"]])
prefix[container["size_at"]:container["size_at"] + 4] = (len(payload) ^ container["key"]).to_bytes(4, "big")
candidate = bytes(prefix) + bytes(v ^ (container["key"] & 255) for v in payload) + source[-2:]
assert decode(candidate)[0] == new_xml
with dest.open("xb") as file:
    file.write(candidate)
assert decode(dest.read_bytes())[0] == new_xml
inspect(ET.fromstring(decode(dest.read_bytes())[0]))
assert all(digest(Path(item["path"]).read_bytes()) == item["sha256"] for item in inputs)
(out / "candidate-main.xml").write_bytes(new_xml)
(motion_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
report = {"designation": "PROGRAM_DRAFT", "editorOpened": False, "editorExported": False, "productionApproval": False, "visualAcceptance": False, "source": str(SOURCE), "candidate": {"path": str(dest), "sha256": digest(candidate), "bytes": len(candidate)}, "changes": changes, "textChanges": text_changes, "projectSelfPath": {"before": old_project_path, "after": str(dest)}, "sourceCanVsActualMotionChecks": checks, "unchangedCurveCount": 42, "authoredCurveCount": 44, "physicsTrackCountPerScene": 6, "allOtherXmlFieldsExact": True, "allRefsAndIdentitiesPreserved": True, "linkedModelUnchanged": "r8 native source link retained; final model replacement remains an explicit Editor action", "inputs": inputs, "inputsUnchanged": True, "predictionsOnly": {"canvasHeight": 1620, "cssHeight": 220, "fit": .96, "unexecutedRigPlan": {"fullBreathUpperChestSourcePx": 3.6, "headY0To30SourcePx": 6}, "idleUpperChestMaxPeakToPeakCss": 3.6 * 220 / 1620 * .96, "hoverHeadRiseCss": 6 * 27 / 30 * 220 / 1620 * .96, "caveat": "Upper-chest breath weight varies across garments; these are planned maximum displacements, not observed final model motion"}, "pending": ["Actual SDK offline curve/solver report", "Editor reopen/resave and actual export", "Future amplitude rig joint/collision/visual checks", "Final motion and physics continuous rendering"]}
(out / "can-amplitude-build-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
print(json.dumps({"candidate": str(dest), "sha256": digest(candidate), "changes": len(changes), "sourceCurveChecks": len(checks), "allOtherXmlFieldsExact": True, "editorOpened": False}, ensure_ascii=False))
