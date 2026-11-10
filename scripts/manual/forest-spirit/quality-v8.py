"""Frozen v8 image-quality instrument; never a Live2D/model acceptance claim.

Install into an isolated environment (no global packages):
  python -m venv output/.venv-forest-spirit-quality-v8
  output/.venv-forest-spirit-quality-v8/Scripts/python.exe -m pip install scikit-image==0.26.0 Pillow

Compare a full 971x1620 neutral RGBA PNG, without registration or resizing:
  output/.venv-forest-spirit-quality-v8/Scripts/python.exe scripts/manual/forest-spirit/quality-v8.py \
    --candidate path/to/neutral.png --out output/forest-spirit-production-v2/front-v8/quality/run-name

Exit 0: numeric thresholds met; 2: a numeric threshold failed; 3: invalid input.
Manual semantic checks, production-art approval and real Cubism/browser acceptance
remain separate even when every image metric passes.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import skimage
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.metrics import structural_similarity

ROOT = Path(__file__).resolve().parents[3]
SPEC_PATH = ROOT / "doc/design/forest-spirit/production/front-v8/quality-spec.json"
QUALITY_ROOT = ROOT / "output/forest-spirit-production-v2/front-v8/quality"
FROZEN_SPEC_SHA256 = "b846c3652f18c8854e6f05d88747464ca627214d160898c600d10454bcd5151a"
REQUIRED_SKIMAGE_VERSION = "0.26.0"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_frozen_input(source: Path, target: Path, expected_sha256: str | None = None) -> dict:
    """Score exactly these bytes even if the artist saves a later revision afterward."""
    data=source.read_bytes()
    digest=hashlib.sha256(data).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("Reference hash does not match the locked v8 mother image")
    if sha256(source) != digest:
        raise ValueError("Candidate/reference changed while being snapshotted; wait for the writer to finish and retry")
    if source.resolve() != target.resolve(): target.write_bytes(data)
    if sha256(target) != digest:
        raise ValueError("Frozen input copy failed its SHA-256 verification")
    return {"sourcePath":str(source),"frozenPath":str(target),"sha256":digest,"bytes":len(data),"sourceStableDuringSnapshot":True}


def load_frozen_spec(path: Path = SPEC_PATH) -> dict:
    if sha256(path) != FROZEN_SPEC_SHA256:
        raise ValueError("Frozen quality specification hash differs; do not change ROIs or thresholds after seeing a result")
    spec = json.loads(path.read_text(encoding="utf-8"))
    if skimage.__version__ != REQUIRED_SKIMAGE_VERSION:
        raise ValueError(f"Requires scikit-image=={REQUIRED_SKIMAGE_VERSION}, found {skimage.__version__}")
    width, height = spec["reference"]["width"], spec["reference"]["height"]
    for region in spec["regions"] + spec["metrics"]["deltaE00"]["regions"]:
        left, top, right, bottom = region["rect"]
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise ValueError(f"Invalid frozen region: {region['id']}")
    return spec


def load_rgba(path: Path, width: int, height: int) -> tuple[np.ndarray, dict]:
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError("Input must be a lossless PNG screenshot/composite")
        if image.size != (width, height):
            raise ValueError(f"Fixed canvas required: {width}x{height}, got {image.width}x{image.height}; no automatic resize or registration")
        if image.mode != "RGBA":
            raise ValueError(f"Input must contain explicit 8-bit RGBA channels, got mode {image.mode}; no inferred or removed background")
        # The instrument never applies EXIF orientation, ICC conversion or premultiplication.
        # Reject unmanaged profiles instead of quietly altering the candidate to fit.
        icc = image.info.get("icc_profile")
        if icc:
            from io import BytesIO
            from PIL import ImageCms
            try:
                profile = ImageCms.ImageCmsProfile(BytesIO(icc))
                profile_name = ImageCms.getProfileName(profile).strip()
            except Exception as error:
                raise ValueError("Unreadable embedded ICC profile") from error
            if "srgb" not in profile_name.lower():
                raise ValueError(f"Non-sRGB profile is not accepted without an explicit upstream conversion: {profile_name}")
        else:
            profile_name = "untagged PNG interpreted as sRGB per the frozen contract"
        return np.asarray(image).copy(), {"mode": image.mode, "width": width, "height": height, "colorProfile": profile_name}


def rect_mask(shape: tuple[int, int], rect: list[int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    left, top, right, bottom = rect
    mask[top:bottom, left:right] = True
    return mask


def alpha_metrics(reference: np.ndarray, candidate: np.ndarray, support: np.ndarray, threshold: float, foreground_threshold: float) -> dict:
    first = (reference >= threshold) & support
    second = (candidate >= threshold) & support
    union = first | second
    intersection = first & second
    union_count = int(union.sum())
    mae_support = support & ((reference > foreground_threshold) | (candidate > foreground_threshold))
    return {
        "iou": float(intersection.sum() / union_count) if union_count else 1.0,
        "intersectionPixels": int(intersection.sum()),
        "unionPixels": union_count,
        "normalizedMae": float(np.abs(reference[mae_support] - candidate[mae_support]).mean()) if mae_support.any() else None,
        "samplePixels": int(mae_support.sum()),
        "iouScopePixels": int(support.sum()),
        "maeSupport": "reference alpha>0.05 OR candidate alpha>0.05, intersected with the reported region",
    }


def composite(rgb: np.ndarray, alpha: np.ndarray, background: list[int]) -> np.ndarray:
    return rgb * alpha[..., None] + np.asarray(background, dtype=np.float64)[None, None, :] / 255.0 * (1.0-alpha[..., None])


def evaluate_arrays(reference8: np.ndarray, candidate8: np.ndarray, spec: dict) -> tuple[dict, dict]:
    expected = (spec["reference"]["height"], spec["reference"]["width"], 4)
    if reference8.shape != expected or candidate8.shape != expected:
        raise ValueError(f"Fixed image array shape required: {expected}; no alignment or resize is implemented")
    if reference8.dtype != np.uint8 or candidate8.dtype != np.uint8:
        raise ValueError("The frozen instrument accepts uint8 RGBA inputs only")
    reference, candidate = reference8.astype(np.float64)/255.0, candidate8.astype(np.float64)/255.0
    reference_alpha, candidate_alpha = reference[..., 3], candidate[..., 3]
    ssim_spec, alpha_spec, color_spec = (spec["metrics"][name] for name in ("ssim", "alpha", "deltaE00"))
    foreground = (reference_alpha > ssim_spec["foregroundAlphaThreshold"]) | (candidate_alpha > ssim_spec["foregroundAlphaThreshold"])
    masks = {region["id"]: rect_mask(foreground.shape, region["rect"]) for region in spec["regions"]}
    maps = {"foreground_union": foreground, "alpha_abs_error": np.abs(reference_alpha-candidate_alpha)}
    ssim_results = {}
    ssim_pass = True
    for background in spec["backgrounds"]:
        first = composite(reference[..., :3], reference_alpha, background["rgb8"])
        second = composite(candidate[..., :3], candidate_alpha, background["rgb8"])
        _, channel_map = structural_similarity(first, second,
            data_range=ssim_spec["dataRange"], channel_axis=ssim_spec["channelAxis"],
            gaussian_weights=ssim_spec["gaussianWeights"], sigma=ssim_spec["sigma"],
            use_sample_covariance=ssim_spec["useSampleCovariance"], win_size=ssim_spec["windowSize"], full=True)
        score_map = channel_map.mean(axis=-1)
        maps[f"ssim_{background['id']}"] = score_map
        global_score = float(score_map[foreground].mean()) if foreground.any() else None
        region_scores = {}
        for region in spec["regions"]:
            support = masks[region["id"]] & foreground
            value = float(score_map[support].mean()) if support.any() else None
            passed = value is not None and value >= ssim_spec["minimum"]
            region_scores[region["id"]] = {"score": value, "samplePixels": int(support.sum()), "passed": passed}
            ssim_pass &= passed
        global_pass = global_score is not None and global_score >= ssim_spec["minimum"]
        ssim_pass &= global_pass
        ssim_results[background["id"]] = {"rgb8": background["rgb8"], "global": {"score": global_score, "samplePixels": int(foreground.sum()), "passed": global_pass}, "regions": region_scores}
        del first, second, channel_map
    alpha = alpha_metrics(reference_alpha, candidate_alpha, np.ones(foreground.shape, dtype=bool), alpha_spec["iouThreshold"], ssim_spec["foregroundAlphaThreshold"])
    alpha["iouPassed"] = alpha["iou"] >= alpha_spec["iouMinimum"]
    alpha["maePassed"] = alpha["normalizedMae"] <= alpha_spec["normalizedMaeMaximum"]
    alpha["regionsDiagnosticOnly"] = {key: alpha_metrics(reference_alpha, candidate_alpha, mask, alpha_spec["iouThreshold"], ssim_spec["foregroundAlphaThreshold"]) for key, mask in masks.items()}
    color_union = np.zeros(foreground.shape, dtype=bool)
    material_masks = {}
    for region in color_spec["regions"]:
        support = rect_mask(foreground.shape, region["rect"]) & (reference_alpha >= color_spec["referenceSolidAlphaMinimum"])
        if not support.any():
            raise ValueError(f"Frozen solid material region contains no reference support: {region['id']}")
        material_masks[region["id"]] = support
        color_union |= support
    # Convert only the frozen sample pixels. Candidate alpha does not change these samples.
    differences = deltaE_ciede2000(rgb2lab(reference[..., :3][color_union]), rgb2lab(candidate[..., :3][color_union]))
    color_map = np.full(foreground.shape, np.nan, dtype=np.float64)
    color_map[color_union] = differences
    maps["delta_e00"] = color_map
    maps["material_union"] = color_union
    color_results = {}
    color_pass = True
    for key, support in {"union": color_union, **material_masks}.items():
        values = color_map[support]
        median = float(np.median(values))
        p95 = float(np.percentile(values, 95, method="linear"))
        passed = median <= color_spec["medianMaximum"] and p95 <= color_spec["p95Maximum"]
        color_pass &= passed
        color_results[key] = {"median": median, "p95": p95, "samplePixels": int(support.sum()), "passed": passed,
            "candidateSolidAlphaCoverageDiagnostic": float((candidate_alpha[support] >= color_spec["referenceSolidAlphaMinimum"]).mean())}
    identical_visible = bool(np.array_equal(reference8[foreground], candidate8[foreground]))
    result = {
        "ssim": {"passed": bool(ssim_pass), "minimum": ssim_spec["minimum"], "backgrounds": ssim_results},
        "alpha": alpha,
        "deltaE00": {"passed": bool(color_pass), "medianMaximum": color_spec["medianMaximum"], "p95Maximum": color_spec["p95Maximum"], "regions": color_results},
        "numericThresholdsPassed": bool(ssim_pass and alpha["iouPassed"] and alpha["maePassed"] and color_pass),
        "fixedCoordinateComparison": True,
        "registrationApplied": False,
        "rescalingApplied": False,
        "foregroundVisiblePixelsIdentical": identical_visible,
        "foregroundUnionPixels": int(foreground.sum()),
    }
    return result, maps


def font(size: int = 16):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/arial.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def draw_regions(image8: np.ndarray, regions: list[dict], title: str) -> Image.Image:
    rgba = image8.astype(np.float64)/255.0
    rgb = np.rint(composite(rgba[..., :3], rgba[..., 3], [224,234,216])*255).astype(np.uint8)
    out = Image.new("RGB", (rgb.shape[1]+390, rgb.shape[0]+44), (243,244,237))
    out.paste(Image.fromarray(rgb), (0,44))
    draw = ImageDraw.Draw(out)
    draw.text((10,10), title, font=font(18), fill=(23,48,31))
    palette = [(192,30,62),(0,94,179),(164,76,0),(132,30,176),(0,121,91)]
    for index, region in enumerate(regions):
        left, top, right, bottom = region["rect"]
        color = palette[index % len(palette)]
        draw.rectangle((left,top+44,right-1,bottom+43), outline=color, width=2)
        draw.text((left+2,top+45), str(index+1), font=font(14), fill=color, stroke_width=1, stroke_fill=(255,255,255))
        row_y=64+index*64
        draw.text((rgb.shape[1]+12,row_y), f"{index+1}. {region['id']}",font=font(17),fill=color)
        draw.text((rgb.shape[1]+12,row_y+23), str(region["rect"]),font=font(15),fill=(40,48,40))
    return out


def save_heatmap(values: np.ndarray, support: np.ndarray, maximum: float, title: str, destination: Path):
    normalized = np.clip(np.nan_to_num(values, nan=0.0)/maximum, 0.0, 1.0)
    # Fixed cyan -> yellow -> red scale; never auto-normalize a candidate to hide a defect.
    colors = np.stack((np.clip(normalized*2,0,1), np.clip(2-normalized*2,0,1), np.clip(1-normalized*2,0,1)), axis=-1)
    colors[~support] = [0.08,0.09,0.08]
    pixels = np.rint(colors*255).astype(np.uint8)
    out = Image.new("RGB", (pixels.shape[1],pixels.shape[0]+54),(242,243,237))
    out.paste(Image.fromarray(pixels),(0,54))
    draw=ImageDraw.Draw(out)
    draw.text((8,6),title,font=font(17),fill=(24,44,30))
    draw.text((8,29),f"Fixed display scale: 0 to {maximum:g}; black = outside evaluated support",font=font(14),fill=(24,44,30))
    out.save(destination)


def allowed_output(path: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(QUALITY_ROOT.resolve()):
        raise ValueError(f"Write reports under {QUALITY_ROOT}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_quality(candidate_path: Path, output: Path, purpose: str = "production-candidate", reference_path: Path | None = None) -> dict:
    spec = load_frozen_spec()
    reference_path = (reference_path or ROOT/spec["reference"]["path"]).resolve()
    candidate_path = candidate_path.resolve()
    output = allowed_output(output)
    # Snapshot first, then evaluate only the frozen copies. Do not hash a later artist save.
    reference_receipt=copy_frozen_input(reference_path,output/"reference.png",spec["reference"]["sha256"])
    candidate_receipt=copy_frozen_input(candidate_path,output/"candidate.png")
    reference8, reference_info = load_rgba(output/"reference.png",spec["reference"]["width"],spec["reference"]["height"])
    candidate8, candidate_info = load_rgba(output/"candidate.png",spec["reference"]["width"],spec["reference"]["height"])
    metrics, maps = evaluate_arrays(reference8,candidate8,spec)
    draw_regions(reference8,spec["regions"],"FROZEN v8 ROIs - reference coordinates; no alignment").save(output/"fixed-rois.png")
    draw_regions(reference8,spec["metrics"]["deltaE00"]["regions"],"FROZEN v8 solid-material DeltaE00 regions").save(output/"fixed-material-rois.png")
    for background in spec["backgrounds"]:
        name=background["id"]
        save_heatmap(1-maps[f"ssim_{name}"],maps["foreground_union"],0.25,f"{name}: masked SSIM loss (1 - SSIM)",output/f"ssim-loss-{name}.png")
        previews=[]
        for source in (reference8,candidate8):
            a=source.astype(np.float64)/255.0
            previews.append(Image.fromarray(np.rint(composite(a[...,:3],a[...,3],background["rgb8"])*255).astype(np.uint8)))
        comparison=Image.new("RGB",(spec["reference"]["width"]*2,spec["reference"]["height"]+44),(243,244,237))
        draw=ImageDraw.Draw(comparison)
        for index,(preview,label) in enumerate(zip(previews,("Locked reference","Candidate - image metrics only"))):
            comparison.paste(preview,(index*preview.width,44)); draw.text((index*preview.width+10,10),f"{label} / {name}",font=font(18),fill=(24,44,30))
        comparison.save(output/f"comparison-{name}.png")
    save_heatmap(maps["alpha_abs_error"],np.ones(maps["foreground_union"].shape,dtype=bool),0.1,"Normalized alpha absolute error",output/"alpha-error.png")
    save_heatmap(maps["delta_e00"],maps["material_union"],10.0,"DeltaE00 on frozen solid-material samples",output/"delta-e00.png")
    environment={"python":platform.python_version(),"platform":platform.platform(),"scikit-image":skimage.__version__}
    for package in ("numpy","scipy","Pillow","imageio","networkx","tifffile","packaging","lazy-loader"):
        environment[package]=importlib.metadata.version(package)
    (output/"environment.txt").write_text("\n".join(f"{key}=={value}" for key,value in environment.items())+"\n",encoding="utf-8")
    report={
        "schemaVersion":1,"instrument":"forest-spirit-front-v8-image-quality","createdAtUtc":datetime.now(timezone.utc).isoformat(),
        "purpose":purpose,"evidenceType":"instrument_self_test_not_model_evidence" if purpose=="instrument-self-test" else "fixed_neutral_image_comparison_only",
        "spec":{"path":str(SPEC_PATH),"sha256":FROZEN_SPEC_SHA256,"id":spec["specId"]},
        "reference":{"path":str(reference_path),"sha256":reference_receipt["sha256"],"snapshot":reference_receipt,**reference_info},
        "candidate":{"path":str(candidate_path),"sha256":candidate_receipt["sha256"],"snapshot":candidate_receipt,**candidate_info},
        "environment":environment,"metrics":metrics,
        "status":"numeric_thresholds_met_manual_review_pending" if metrics["numericThresholdsPassed"] else "numeric_thresholds_failed",
        "modelAcceptance":"not_evaluated","productionArtAcceptance":"not_granted_by_this_instrument",
        "manualChecks":[{"check":check,"status":"pending_manual_review"} for check in spec["manualChecksNotReplacedByMetrics"]],
        "identityInputWarning":"Identical visible pixels are not proof of layer separation, motion, SDK rendering or production approval" if metrics["foregroundVisiblePixelsIdentical"] else None,
    }
    if purpose=="instrument-self-test": report["status"]="instrument_self_test_numeric_pass" if metrics["numericThresholdsPassed"] else "instrument_self_test_numeric_fail"
    report["artifacts"]=[{"path":file.name,"sha256":sha256(file),"bytes":file.stat().st_size} for file in sorted(output.iterdir()) if file.is_file() and file.name!="report.json"]
    (output/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    return report


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--candidate",required=True,type=Path)
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--reference",type=Path,help="Optional archived copy; the locked SHA-256 must still match")
    parser.add_argument("--purpose",choices=("production-candidate","instrument-self-test"),default="production-candidate")
    args=parser.parse_args()
    try:
        report=run_quality(args.candidate,args.out,args.purpose,args.reference)
        print(json.dumps({"report":str(args.out/"report.json"),"status":report["status"],"numericThresholdsPassed":report["metrics"]["numericThresholdsPassed"],"modelAcceptance":report["modelAcceptance"]},ensure_ascii=True))
        return 0 if report["metrics"]["numericThresholdsPassed"] else 2
    except (ValueError,OSError,KeyError) as error:
        invalid={"schemaVersion":1,"status":"invalid_input_or_instrument_contract","error":str(error),"modelAcceptance":"not_evaluated"}
        try:
            output=allowed_output(args.out)
            (output/"invalid-input.json").write_text(json.dumps(invalid,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        except (ValueError,OSError): pass
        print(json.dumps(invalid,ensure_ascii=True),file=sys.stderr)
        return 3


if __name__=="__main__": raise SystemExit(main())
