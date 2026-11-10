"""Read-only forest-spirit asset checks; writes evidence only to --output.

Pillow is used to compare actual crop pixels, never to generate production art.
This does not parse MOC3 or replace a real Cubism Core/browser validation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

from PIL import Image


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root: Path) -> dict[str, dict]:
    return {
        p.relative_to(root).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(root.rglob("*")) if p.is_file()
    }


def describe(path: Path) -> dict:
    result = {"path": str(path), "exists": path.is_file()}
    if path.is_file():
        result.update(bytes=path.stat().st_size, sha256=digest(path))
        if path.suffix.lower() == ".png":
            with Image.open(path) as im:
                result.update(mode=im.mode, size=list(im.size))
                if "A" in im.getbands():
                    result["alpha_extrema"] = list(im.getchannel("A").getextrema())
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    archive = repo / "doc/design/forest-spirit/handoff-v1"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    def save(name: str, obj) -> None:
        (output / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source_files, archived_files = inventory(args.source), inventory(archive)
    copy_check = {
        "source": str(args.source), "archive": str(archive),
        "source_file_count": len(source_files), "archive_file_count": len(archived_files),
        "missing": sorted(source_files.keys() - archived_files.keys()),
        "extra": sorted(archived_files.keys() - source_files.keys()),
        "different": [name for name in source_files.keys() & archived_files.keys()
                      if source_files[name] != archived_files[name]],
        "files": archived_files,
    }
    copy_check["identical"] = not any(copy_check[k] for k in ("missing", "extra", "different"))
    save("archive-integrity.json", copy_check)

    manifest = json.loads((archive / "specs/reference_manifest.json").read_text(encoding="utf-8"))
    crop_checks = []
    with Image.open(archive / manifest["source_file"]) as board:
        for reference in manifest["references"]:
            if "crop_xyxy" not in reference:
                continue
            with Image.open(archive / reference["file"]) as crop:
                expected = board.crop(reference["crop_xyxy"]).convert("RGBA")
                actual = crop.convert("RGBA")
                crop_checks.append({"file": reference["file"], "size": list(crop.size),
                                    "pixels_identical": expected.size == actual.size and
                                    expected.tobytes() == actual.tobytes()})
    save("pixel-crop-check.json", {"count": len(crop_checks), "checks": crop_checks,
                                   "all_identical": all(c["pixels_identical"] for c in crop_checks)})

    proof = repo / "output/live2d-proof-20261105"
    checks = [
        ("handoff-check", ["check_handoff.py", "--root", str(archive)], 0),
        ("checker-tests", ["test_checks.py"], 0),
        ("production-runtime-missing", ["check_runtime.py", str(archive / "deliverables/live2d/forest_spirit.model3.json")], 1),
        ("legacy-proof-generic-references", ["check_runtime.py", str(proof / "model/SproutProof.model3.json"), "--generic"], 0),
        ("legacy-proof-production-requirements", ["check_runtime.py", str(proof / "model/SproutProof.model3.json")], 1),
    ]
    runs = []
    for label, command, expected_exit in checks:
        cmd = [sys.executable, str(archive / "tools" / command[0]), *command[1:]]
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1")
        result = subprocess.run(cmd, cwd=repo, env=env, capture_output=True, encoding="utf-8")
        (output / f"{label}.stdout.txt").write_text(result.stdout, encoding="utf-8")
        (output / f"{label}.stderr.txt").write_text(result.stderr, encoding="utf-8")
        runs.append({"name": label, "command": cmd, "exit_code": result.returncode,
                     "expected_exit_code": expected_exit, "matches_expected": result.returncode == expected_exit})
    save("check-runs.json", runs)

    sdk = proof / "sdk/CubismSdkForWeb-5-r.5"
    paths = [
        Path("C:/Program Files/Live2D Cubism 5.3/CubismEditor5.exe"),
        proof / "Live2D_Cubism_Setup_5.3.04.exe", proof / "CubismSdkForWeb-5-r.5.zip",
        sdk / "cubism-info.yml", sdk / "Core/live2dcubismcore.min.js",
        sdk / "Framework/src/live2dcubismframework.ts", sdk / "Core/RedistributableFiles.txt",
        sdk / "LICENSE.md", proof / "source/SproutProof.psd",
        *sorted((proof / "model").rglob("*")),
        repo / "doc/design/forest-spirit/amendments/star-eyes-user-reference.png",
        repo / "doc/design/forest-spirit/production/master/forest-spirit-approved-v2.png",
        repo / "doc/design/forest-spirit/production/master/metadata.json",
        repo / "doc/design/forest-spirit/production/layers-v2.json",
        repo / "apps/web/public/live2d/forest-spirit/asset-manifest.json",
        *sorted((repo / "output/forest-spirit-art/candidates").glob("*.png")),
    ]
    save("local-files.json", [describe(path) for path in paths if path.is_file() or not path.exists()])
    production_extensions = {".psd", ".cmo3", ".can3", ".moc3"}
    production_assets = [p.relative_to(archive).as_posix() for p in (archive / "deliverables").rglob("*")
                         if p.is_file() and (p.suffix.lower() in production_extensions or p.name.endswith(".model3.json"))]
    summary = {
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
        "archive_identical_to_source": copy_check["identical"],
        "archived_file_count": len(archived_files),
        "pixel_exact_crops_verified": sum(c["pixels_identical"] for c in crop_checks),
        "checks_match_expected_exit_codes": all(r["matches_expected"] for r in runs),
        "production_deliverable_files_in_original_archive": production_assets,
        "approved_v2_flat_master_exists": (repo / "doc/design/forest-spirit/production/master/forest-spirit-approved-v2.png").is_file(),
        "public_model_entry_exists": (repo / "apps/web/public/live2d/forest-spirit/forest_spirit.model3.json").is_file(),
        "moc3_core_validation_performed_by_this_script": False,
        "browser_render_test_performed_by_this_script": False,
        "limitations": ["Approved flat PNG and layer-plan JSON are not actual layered production art.",
                        "Legacy SproutProof is a different character and is never the approved forest spirit model.",
                        "Reference integrity and checker unit tests do not establish model readiness."],
    }
    save("summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["archive_identical_to_source"] and len(crop_checks) == 25 and all(c["pixels_identical"] for c in crop_checks) and summary["checks_match_expected_exit_codes"] else 1


if __name__ == "__main__":
    sys.exit(main())
