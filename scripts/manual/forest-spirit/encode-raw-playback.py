"""Encode actual completed-draw PNGs with recorded timing; never synthesize motion."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    capture = args.capture.resolve()
    manifest_path = capture / "raw-frame-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["allSelectedCompletedFramesCaptured"] is True
    assert not args.out.exists(), "Use a new output directory; retain prior attempts"
    args.out.mkdir(parents=True)
    reports = []
    for instance in ["280", "zoom"]:
        frames = [row for row in manifest["frames"] if row["instance"] == instance]
        assert frames and all(b["frameCounter"] == a["frameCounter"] + 1 for a, b in zip(frames, frames[1:]))
        dest = args.out / instance
        dest.mkdir()
        lines = ["ffconcat version 1.0"]
        timeline = []
        first_ms = frames[0]["wallElapsedMs"]
        for i, row in enumerate(frames):
            original = (capture / row["path"]).resolve()
            assert original.is_relative_to(capture) and sha(original) == row["sha256"]
            im = Image.open(original).convert("RGBA")
            assert im.size == (row["width"], row["height"])
            white = Image.new("RGBA", im.size, "white")
            white.alpha_composite(im)
            name = f"frame-{i:05d}.png"
            white.convert("RGB").save(dest / name)
            next_ms = frames[i + 1]["wallElapsedMs"] if i + 1 < len(frames) else manifest["wallDurationMs"]
            duration = (next_ms - row["wallElapsedMs"]) / 1000
            assert duration > 0
            # Per-file 1 kHz input timebase keeps observed irregular spacing,
            # including explicit DragHold pauses, without default 25fps rounding.
            lines += [f"file '{name}'", "option framerate 1000", f"duration {duration:.9f}"]
            timeline.append({"source": row["path"], "sourceSha256": row["sha256"], "composite": name, "compositeSha256": sha(dest / name), "frameCounter": row["frameCounter"], "phase": row["phase"], "actualWallElapsedMs": row["wallElapsedMs"], "relativePtsSeconds": (row["wallElapsedMs"] - first_ms) / 1000, "displayDurationSeconds": duration})
        # Explicit terminal duplicate is solely the final frame's hold endpoint;
        # it is not a newly rendered model frame or interpolated motion frame.
        lines += [f"file 'frame-{len(frames)-1:05d}.png'", "option framerate 1000"]
        (dest / "timeline.ffconcat").write_text("\n".join(lines) + "\n", encoding="utf-8")
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(dest / "timeline.ffconcat"), "-fps_mode", "vfr", "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuv444p", "-row-mt", "1", "-threads", "2", "-deadline", "good", "-cpu-used", "2", str(dest / "actual-wall-time-lossless-vp9.webm")]
        subprocess.run(command, check=True)
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=pts_time", "-of", "json", str(dest / "actual-wall-time-lossless-vp9.webm")]))
        pts = [float(f["pts_time"]) for f in probe["frames"]]
        expected_pts = [t["relativePtsSeconds"] for t in timeline] + [(manifest["wallDurationMs"] - first_ms) / 1000]
        assert len(pts) == len(expected_pts), "Encoded frame count changed"
        errors = [abs(a - b) for a, b in zip(pts, expected_pts)]
        assert max(errors) <= .0011, "Recorded wall intervals were not preserved to 1ms"
        report = {"instance": instance, "sourceFrames": len(frames), "encodedFrames": len(pts), "terminalDuplicateExplicit": True, "firstOriginalWallElapsedMs": first_ms, "recordedDurationSeconds": expected_pts[-1], "maximumPtsRoundingErrorSeconds": max(errors), "timing": "Observed variable wall intervals including holds; no resampling, interpolation or acceleration", "color": "White composite of original RGBA; lossless VP9 yuv444p codec. RGB-to-YUV conversion is not claimed byte-identical to PNG.", "videoSha256": sha(dest / "actual-wall-time-lossless-vp9.webm"), "timeline": timeline, "ffmpegCommand": command}
        (dest / "encoding-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        reports.append({k: v for k, v in report.items() if k not in ["timeline", "ffmpegCommand"]})
    result = {"manifestPath": str(manifest_path), "manifestSha256": sha(manifest_path), "productionApproval": False, "videos": reports}
    (args.out / "report.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
