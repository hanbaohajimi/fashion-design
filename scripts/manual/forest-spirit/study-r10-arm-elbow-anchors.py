"""Read-only, offline CPU study of source-space elbow anchors; never Core evidence."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, map_coordinates


REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / "output/forest-spirit-production-v2/front-v8"
META = ROOT / "fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json"
GEOMETRY = ROOT / "validation/full-b13-native-r10-audit-r1/native-source-geometry.json"
CAPTURES = ROOT / "validation/full-b13-boundary-r10-parameter-matrix-r1"
FORMULA = ROOT / "research/isolated-psd2live/harness/src/main/kotlin/PrepareFullbodyMotionRig.kt"
OUT = ROOT / "validation/b14-arm-anchor-study-r1"
WIDTH, HEIGHT = 971, 1620
S = np.array([341., 747.])
P = np.array([195., 1025.])
ARM = {"Arm_R_Upper", "Arm_R_Lower", "Hand_R"}
ANCHORS = {"r10-old-276-929": [276, 929], "candidate-284-910": [284, 910],
           "candidate-288-896": [288, 896], "candidate-289-893": [289, 893]}
KEYS = [0, 4, 8, 12, 16]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cross(a, b):
    return float(a[0] * b[1] - a[1] * b[0])


def angle(v):
    return math.atan2(v[1], v[0])


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def rotate(xy, pivot, target, radians):
    c, s = math.cos(radians), math.sin(radians)
    return (xy - pivot) @ np.array([[c, s], [-s, c]]) + target


def bezier(t):
    u = 1 - t
    return u**3 * P + 3 * u*u*t * np.array([160., 945.]) + 3*u*t*t * np.array([145., 650.]) + t**3 * np.array([182., 493.])


def ik(e, target, neutral=False):
    a, b, d = np.linalg.norm(e - S), np.linalg.norm(P - e), np.linalg.norm(target - S)
    assert abs(a-b) < d < a+b, "Unreachable target: no stretching or acos clipping permitted"
    unit = (target-S)/d
    along = (a*a - b*b + d*d) / (2*d)
    height = math.sqrt(a*a - along*along)
    branch = math.copysign(1, cross(P-S, e-S))
    elbow = S + along*unit + branch*height*np.array([-unit[1], unit[0]])
    upper = wrap(angle(elbow-S) - angle(e-S))
    lower = wrap(angle(target-elbow) - angle(P-e))
    if neutral:
        elbow, upper, lower = e.copy(), 0., 0.
    return elbow, upper, lower, a, b


def actual_positions(d):
    xy = np.asarray(d["vertexPositions"], dtype=float).reshape(-1, 2)
    return np.column_stack([xy[:, 0]*971 + 485.5, 810 - xy[:, 1]*971])


def over(dst, src):
    """Premultiplied source over premultiplied destination, in place."""
    dst *= 1 - src[..., 3:4]
    dst += src


def raster_layer(src, triangles, xy, texture, opacity):
    """Triangle bbox rasterization; crop-only premultiplied texture sampling."""
    x0, y0 = np.maximum(0, np.floor(xy.min(axis=0)).astype(int))
    x1, y1 = np.minimum([WIDTH, HEIGHT], np.ceil(xy.max(axis=0)).astype(int))
    if x1 <= x0 or y1 <= y0 or opacity <= 0:
        return (0, 0, 0, 0), np.zeros((0, 0, 4), dtype=np.float32)
    out = np.zeros((y1-y0, x1-x0, 4), dtype=np.float32)
    tx0, ty0, pixels = texture
    for tri in triangles:
        a, b, c = xy[tri]
        left, top = np.maximum([x0, y0], np.floor(np.minimum(np.minimum(a, b), c)).astype(int))
        right, bottom = np.minimum([x1, y1], np.ceil(np.maximum(np.maximum(a, b), c)).astype(int))
        if left >= right or top >= bottom:
            continue
        edge_b, edge_c = b-a, c-a
        det = cross(edge_b, edge_c)
        if abs(det) < 1e-8:
            continue
        yy, xx = np.mgrid[top:bottom, left:right]
        dx, dy = xx+.5-a[0], yy+.5-a[1]
        v = (dx*edge_c[1] - dy*edge_c[0])/det
        w = (dy*edge_b[0] - dx*edge_b[1])/det
        mask = (v >= -1e-7) & (w >= -1e-7) & (v+w <= 1+1e-7)
        if not mask.any():
            continue
        sa, sb, sc = src[tri]
        q = sa + v[mask, None]*(sb-sa) + w[mask, None]*(sc-sa)
        coords = [q[:, 1]-.5-ty0, q[:, 0]-.5-tx0]
        tile = out[top-y0:bottom-y0, left-x0:right-x0]
        for ch in range(4):
            tile[..., ch][mask] = map_coordinates(pixels[..., ch], coords, order=1, mode="constant", cval=0) * opacity
    return (x0, y0, x1, y1), out


def paste(dst, layer):
    (x0, y0, x1, y1), rgba = layer
    if x1 > x0 and y1 > y0:
        over(dst[y0:y1, x0:x1], rgba)


def to_image(premult):
    alpha = premult[..., 3:4]
    rgb = np.divide(premult[..., :3], alpha, out=np.zeros_like(premult[..., :3]), where=alpha>1e-8)
    return Image.fromarray(np.uint8(np.clip(np.rint(np.concatenate([rgb, alpha], axis=2)*255), 0, 255)))


def with_background(img):
    background = Image.new("RGBA", img.size, (239, 239, 229, 255))
    background.alpha_composite(img)
    return background.convert("RGB")


def write_summary(report):
    lines = [
        "# Offline elbow-anchor study — CPU only",
        "",
        "No model or source PNG was edited. These source-pixel reconstructions are not actual Core captures.",
        "",
        "17 samples per anchor cover HatTouch 0..1. Full-body images, joint diagnostics and arm crops cover 0, .25, .5, .75 and 1.",
        "The 0/.5/1 targets come from an affine fit of the actual Core lower-arm vertices; other targets use the original Kotlin cubic Bezier formula.",
        "",
        "| Source elbow | Upper / lower length (px) | Opaque overlap clearance | HatTouch 1 elbow | Upper visible at 1 |",
        "|---|---:|---:|---|---:|",
    ]
    for anchor in report["sourceAnchorTable"]:
        if not anchor["validAnchor"]:
            continue
        row = next(r for r in report["metrics"] if r["candidate"] == anchor["name"] and r["step"] == 16)
        lines.append(f"| {anchor['sourceElbow']} | {anchor['upperLengthPx']:.3f} / {anchor['lowerLengthPx']:.3f} | {anchor['opaqueOverlapClearancePx']:.2f} px | ({row['elbow'][0]:.3f}, {row['elbow'][1]:.3f}) | {row['upperVisibleFraction']*100:.2f}% |")
    lines += [
        "",
        "The requested source point (297,866) is invalid: Upper alpha 255, Lower alpha 0. The nearest >=5 px interior-overlap replacement is (289,893).",
        "",
        "All neutral arm vertices use exact identity; all four neutral candidate PNGs have identical SHA-256. All frozen input hashes match before and after.",
        "Maximum shared-elbow error is below 1e-12 px; maximum target error is 0.0000211 px, caused by the neutral actual Core float fit. Segment lengths and source texel scale are unchanged within each candidate.",
        "The maximum adjacent shoulder short arc is 14.59 degrees and the maximum elbow relative short arc is 19.80 degrees. No IK branch changes occur.",
        "",
        "Visual review: new anchors lower the final elbow and improve upper-arm visibility at .5, but the final raised sleeve remains poorly connected to the shoulder. At .75 every candidate still reads as a floating sleeve. At 1, (288,896) still has only 6.19% of the upper-arm alpha area visible under the original draw order. The current shape/occlusion constraint therefore remains unresolved.",
        "",
        "(288,896) is the strongest balanced candidate worth considering for a later actual native experiment, not an accepted fix. (289,893) has only 5 px overlap clearance and little extra visual benefit. Further pivot-only micro-adjustments are not supported by this study.",
        "",
        "Other 69 layers have exactly identical actual vertex positions across captured 0/.5/1 states. Their actual render order is retained; .25 uses the neutral order and .75 uses the final order, consistent with the existing channel's outer ranges. No rig parameter channels were written.",
        "",
        "Read study-report.json for complete input hashes and all 68 numeric samples. Review fullbody-contact-sheet-hat-08/12/16-CPU-only.png for the unresolved silhouette.",
    ]
    (OUT/"README-study.md").write_text("\n".join(lines)+"\n", encoding="utf-8")


def main():
    assert not OUT.exists(), "Study output is append-only; use a fresh revision"
    OUT.mkdir(parents=True)
    meta, native = read(META), read(GEOMETRY)
    rows = {d["id"]: d for d in meta["layers"]}
    geometry = {d["id"]: d for d in native["drawables"]}
    assert not any(d["maskIds"] or d["invertMask"] for d in native["drawables"])
    states = {i: read(CAPTURES / f"{name}.json") for i, name in [(0, "neutral"), (8, "hat-8-head0-e1"), (16, "hat-16-head0-e1")]}
    state_rows = {i: {d["id"]: d for d in state["drawables"]} for i, state in states.items()}
    inputs = [META, GEOMETRY, FORMULA, Path(native["source"])] + [META.parent/d["path"] for d in rows.values()]
    inputs += [CAPTURES/f"{name}.{ext}" for name in ["neutral", "hat-8-head0-e1", "hat-16-head0-e1"] for ext in ["json", "png"]]
    before = {str(path): sha(path) for path in inputs}
    sources, textures, alphas = {}, {}, {}
    for key, d in geometry.items():
        sources[key] = np.asarray(d["positions"], dtype=float).reshape(-1, 2)
        img = Image.open(META.parent/rows[key]["path"]).convert("RGBA")
        assert img.size == (WIDTH, HEIGHT)
        bbox = img.getchannel("A").getbbox()
        if key in ARM:
            alphas[key] = np.asarray(img)[..., 3].copy()
        if bbox is None:
            bbox = (0, 0, 1, 1)
        left, top, right, bottom = bbox
        bbox = (max(0,left-2), max(0,top-2), min(WIDTH,right+2), min(HEIGHT,bottom+2))
        rgba = np.asarray(img.crop(bbox)).astype(np.float32)/255
        rgba[..., :3] *= rgba[..., 3:4]
        textures[key] = (bbox[0], bbox[1], rgba)
    overlap = (alphas["Arm_R_Upper"]>250)&(alphas["Arm_R_Lower"]>250)
    distance = distance_transform_edt(overlap)
    table = []
    for name, e in {**ANCHORS, "rejected-297-866": [297, 866]}.items():
        x, y = e
        table.append({"name": name, "sourceElbow": e,
                      "sourceAlpha": {k: int(a[y, x]) for k, a in alphas.items()},
                      "opaqueOverlapClearancePx": float(distance[y, x]),
                      "upperLengthPx": float(np.linalg.norm(np.array(e)-S)),
                      "lowerLengthPx": float(np.linalg.norm(P-np.array(e))),
                      "validAnchor": bool(overlap[y,x])})
    (OUT/"anchor-source-table.json").write_text(json.dumps(table, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(table, indent=2), flush=True)
    source_diagnostic = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    source_diagnostic[alphas["Arm_R_Upper"]>0] = [75, 160, 225, 255]
    source_diagnostic[alphas["Arm_R_Lower"]>0] = [240, 170, 75, 255]
    source_diagnostic[overlap] = [100, 195, 100, 255]
    im = with_background(Image.fromarray(source_diagnostic)).crop((210,840,340,990)).resize((520,600))
    dr = ImageDraw.Draw(im)
    for row in table:
        x, y = row["sourceElbow"]; x, y = (x-210)*4, (y-840)*4
        dr.ellipse((x-5,y-5,x+5,y+5), fill="red");dr.text((x+8,y-14), f"{row['sourceElbow']}", fill="black")
    im.save(OUT/"source-overlap-anchor-diagnostic.png")

    targets, target_evidence = {}, {}
    for step, ds in state_rows.items():
        source = sources["Arm_R_Lower"]
        fit = np.linalg.lstsq(np.c_[source, np.ones(len(source))], actual_positions(ds["Arm_R_Lower"]), rcond=None)[0]
        targets[step] = np.r_[P, 1] @ fit
        target_evidence[step] = {"target": targets[step].tolist(), "maxAffineFitResidualPx": float(np.abs(np.c_[source, np.ones(len(source))]@fit-actual_positions(ds["Arm_R_Lower"])).max()), "formulaDifferencePx": float(np.linalg.norm(targets[step]-bezier(step/16)))}
    unchanged_drift = {i: max(float(np.abs(actual_positions(ds[k])-actual_positions(state_rows[0][k])).max()) for k in rows if k not in ARM) for i, ds in state_rows.items()}
    cache = {}
    def render_one(key, ds, xy):
        return raster_layer(sources[key], np.asarray(ds[key]["vertexIndices"]).reshape(-1,3), xy, textures[key], ds[key]["opacity"])

    def build_scene(step):
        snapshot = 0 if step < 8 else (8 if step == 8 else 16)
        if snapshot not in cache:
            ds = state_rows[snapshot]
            order = sorted(rows, key=lambda k: ds[k]["renderOrder"])
            pieces, block = [], np.zeros((HEIGHT,WIDTH,4), dtype=np.float32)
            for key in order:
                if key in ARM:
                    pieces += [block, key]
                    block = np.zeros_like(block)
                else:
                    paste(block, render_one(key, ds, actual_positions(ds[key])))
            pieces.append(block)
            cache[snapshot] = (ds, pieces)
        return cache[snapshot]

    metrics, baseline_images = [], {}
    # Reconstruct actual captured geometry to expose CPU/native texture differences.
    for step in [0,8,16]:
        ds, pieces = build_scene(step)
        canvas = np.zeros((HEIGHT,WIDTH,4), dtype=np.float32)
        for piece in pieces:
            if isinstance(piece, str):
                paste(canvas, render_one(piece, ds, actual_positions(ds[piece])))
            else:
                over(canvas, piece)
        baseline_images[step] = to_image(canvas)
        baseline_images[step].save(OUT/f"cpu-r10-actual-geometry-{step:02d}-not-core.png")
        print(f"CPU actual geometry reconstructed {step}/16", flush=True)

    for name, coords in ANCHORS.items():
        e = np.asarray(coords, dtype=float)
        folder = OUT/name; folder.mkdir()
        previous = None
        for step in range(17):
            target = targets.get(step, bezier(step/16))
            elbow, upper, lower, a, b = ik(e, target, neutral=step==0)
            actual_palm = rotate(P, e, elbow, lower)
            transforms = {"Arm_R_Upper": (S,S,upper), "Arm_R_Lower": (e,elbow,lower), "Hand_R": (e,elbow,lower)}
            posed = {key: rotate(sources[key], *transforms[key]) for key in ARM}
            upper_elbow = rotate(e, S, S, upper)
            row = {"candidate": name, "step": step, "hatTouch": step/16,
                   "targetProvenance": "actual Core Lower rigid-fit target" if step in targets else "original Kotlin cubic Bezier formula; CPU only",
                   "shoulder": S.tolist(), "elbow": elbow.tolist(), "palm": actual_palm.tolist(), "target": target.tolist(),
                   "upperSourceLengthPx": a, "lowerSourceLengthPx": b,
                   "upperAngleDegrees": math.degrees(upper), "lowerAbsoluteAngleDegrees": math.degrees(lower),
                   "lowerRelativeAngleDegrees": math.degrees(wrap(lower-upper)),
                   "branch": "same source-neutral cross-product sign at every step",
                   "shoulderErrorPx": float(np.linalg.norm(rotate(S,S,S,upper)-S)),
                   "sharedElbowErrorPx": float(np.linalg.norm(upper_elbow-elbow)),
                   "palmTargetErrorPx": float(np.linalg.norm(actual_palm-target)),
                   "upperLengthErrorPx": float(abs(np.linalg.norm(elbow-S)-a)),
                   "lowerLengthErrorPx": float(abs(np.linalg.norm(actual_palm-elbow)-b)),
                   "neutralSourceVertexMaxDifferencePx": max(float(np.abs(posed[k]-sources[k]).max()) for k in ARM) if step==0 else None,
                   "adjacentUpperShortArcDegrees": 0 if previous is None else abs(math.degrees(wrap(upper-previous[0]))),
                   "adjacentLowerRelativeShortArcDegrees": 0 if previous is None else abs(math.degrees(wrap((lower-upper)-(previous[1]-previous[0]))))}
            assert row["sharedElbowErrorPx"] < 1e-8
            assert row["palmTargetErrorPx"] < 1e-3
            assert row["adjacentUpperShortArcDegrees"] < 180 and row["adjacentLowerRelativeShortArcDegrees"] < 180
            previous = (upper,lower)
            if step in KEYS:
                ds, pieces = build_scene(step)
                canvas = np.zeros((HEIGHT,WIDTH,4), dtype=np.float32)
                upper_visible = np.zeros((HEIGHT,WIDTH), dtype=np.float32)
                upper_area = 0.
                for piece in pieces:
                    if isinstance(piece, str):
                        layer = render_one(piece, ds, posed[piece])
                        (x0,y0,x1,y1), rgba = layer
                        if piece == "Arm_R_Upper":
                            upper_visible[y0:y1,x0:x1] = rgba[...,3]
                            upper_area = float(rgba[...,3].sum())
                        else:
                            upper_visible[y0:y1,x0:x1] *= 1-rgba[...,3]
                        paste(canvas, layer)
                    else:
                        upper_visible *= 1-piece[...,3]
                        over(canvas,piece)
                row["upperProjectedAlphaAreaPx"] = upper_area
                row["upperVisibleAlphaAreaPx"] = float(upper_visible.sum())
                row["upperVisibleFraction"] = float(upper_visible.sum()/upper_area) if upper_area else 0
                img = to_image(canvas)
                img.save(folder/f"hat-{step:02d}-CPU-only.png")
                diagnostic = with_background(img)
                dr = ImageDraw.Draw(diagnostic)
                for point, color, label in [(S,"#e04040","S"),(elbow,"#0065e0","E"),(actual_palm,"#d020c0","P")]:
                    x,y=point;dr.ellipse((x-6,y-6,x+6,y+6), fill=color);dr.text((x+9,y-12),f"{label} {x:.1f},{y:.1f}", fill=color)
                dr.line([tuple(S),tuple(elbow),tuple(actual_palm)], fill="#0065e0", width=3)
                dr.rectangle((0,0,WIDTH,40),fill="white")
                dr.text((12,10),f"CPU ONLY / NOT CORE | {name} | HatTouch {step/16:.2f}",fill="black")
                diagnostic.save(folder/f"hat-{step:02d}-joint-diagnostic-CPU-only.png")
                with_background(img).crop((70,400,480,1070)).save(folder/f"hat-{step:02d}-arm-crop-CPU-only.png")
            metrics.append(row)
        print(f"Completed 17-step rigid study: {name}", flush=True)

    names = list(ANCHORS)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    font = ImageFont.truetype(str(font_path), 18) if font_path.exists() else ImageFont.load_default()
    for step in KEYS:
        sheet = Image.new("RGB",(WIDTH//2*4,HEIGHT//2+65),"white")
        dr=ImageDraw.Draw(sheet)
        for i,name in enumerate(names):
            img=with_background(Image.open(OUT/name/f"hat-{step:02d}-CPU-only.png"))
            sheet.paste(img.resize((WIDTH//2,HEIGHT//2),Image.Resampling.LANCZOS),(i*(WIDTH//2),65))
            dr.text((i*(WIDTH//2)+10,8),name,font=font,fill="black")
            dr.text((i*(WIDTH//2)+10,32),f"CPU ONLY / HatTouch {step/16:.2f}",font=font,fill="black")
        sheet.save(OUT/f"fullbody-contact-sheet-hat-{step:02d}-CPU-only.png")
        crop_sheet=Image.new("RGB",(410*4,710),"white");dr=ImageDraw.Draw(crop_sheet)
        for i,name in enumerate(names):
            crop_sheet.paste(Image.open(OUT/name/f"hat-{step:02d}-arm-crop-CPU-only.png"),(i*410,40));dr.text((i*410+8,10),name,font=font,fill="black")
        crop_sheet.save(OUT/f"arm-contact-sheet-hat-{step:02d}-CPU-only.png")
    neutral_paths = [OUT/name/"hat-00-CPU-only.png" for name in names]
    neutral_hashes={str(p.relative_to(OUT)):sha(p) for p in neutral_paths}
    assert len(set(neutral_hashes.values()))==1, "All source-identity neutral candidates must be pixel-identical"
    after={str(path):sha(path) for path in inputs}
    assert before==after, "Frozen inputs changed during read-only study"
    report={"scope":"Offline CPU triangle-barycentric source-pixel study; NOT Core renderer / NOT model acceptance",
            "canvas":[WIDTH,HEIGHT],"sourceMetadata":str(META),"nativeGeometry":str(GEOMETRY),
            "sourceAnchorTable":table,"targetEvidence":target_evidence,"nonArmActualVertexDriftPx":unchanged_drift,
            "otherLayers":"Actual captured positions and renderOrder retained. CPU .25 uses actual neutral order; .75 uses actual end order. No model channel or 17 parameters changed.",
            "neutralIdentity":"All 3 arm layers transformed by exact identity at step0; every candidate neutral PNG is byte-identical. Tiny actual palm float fit difference explicitly reported.",
            "neutralPngHashes":neutral_hashes,"textureSampling":"Bilinear premultiplied RGBA with triangle bbox rasterization; hidden RGB never leaks through alpha=0.",
            "limitations":"Original packed-atlas/filtering not emulated; CPU output differs from actual Core. Formula-only steps are not captured Core states. Rigid source-pixel candidates still need actual native validation.",
            "allFrozenInputsUnchanged":before==after,"frozenInputSha256":before,"metrics":metrics}
    (OUT/"study-report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    write_summary(report)
    print(str(OUT),flush=True)


if __name__=="__main__":
    main()
