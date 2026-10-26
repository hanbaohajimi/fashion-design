"""Private object materialization and deterministic browser-compatible media."""

import hashlib
import json
import subprocess
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageDraw
from pillow_heif import register_heif_opener

from .config import Settings

register_heif_opener()


def run_tool(arguments: list[str], timeout: float = 300) -> None:
    result = subprocess.run(arguments, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"MEDIA_TOOL_FAILED:{Path(arguments[0]).name}:{result.returncode}")


class MediaTools:
    def __init__(self, settings: Settings):
        self.settings = settings

    def probe(self, path: Path) -> dict:
        result = subprocess.run([self.settings.ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
        data = json.loads(result.stdout)
        stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
        return {"duration_ms": round(float(data.get("format", {}).get("duration", 0)) * 1000),
                "width": stream.get("width"), "height": stream.get("height")}

    def mock_image(self, path: Path, kind: str, index: int = 0) -> None:
        palette = [(216, 230, 221), (233, 224, 211), (213, 221, 233)]
        image = Image.new("RGB", (512, 768), palette[index % len(palette)])
        draw = ImageDraw.Draw(image)
        if kind != "background":
            draw.ellipse((212, 90, 300, 178), fill=(196, 155, 126))
            draw.polygon([(205, 190), (306, 190), (340, 490), (170, 490)], fill=(53 + index * 13 % 100, 85, 73))
            draw.rectangle((200, 489, 235, 685), fill=(58, 62, 57))
            draw.rectangle((275, 489, 310, 685), fill=(58, 62, 57))
        else:
            draw.polygon([(0, 768), (170, 300), (340, 300), (512, 768)], fill=(241, 239, 230))
        draw.rectangle((0, 0, 512, 50), fill=(32, 51, 46))
        draw.text((16, 17), f"MOCK / TEST ONLY - {kind.upper()} {index + 1}", fill="white")
        image.save(path, "PNG")

    def mock_video(self, image: Path, path: Path) -> None:
        run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", str(image), "-t", "1", "-vf", "scale=360:540:force_original_aspect_ratio=decrease,pad=360:540:(ow-iw)/2:(oh-ih)/2", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)])

    def mock_music(self, path: Path, seconds: float) -> None:
        run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100", "-t", str(max(seconds, 1)), "-af", "volume=0.08", "-c:a", "libmp3lame", str(path)])

    def compose(self, paths: list[Path], destination: Path, check=lambda: None) -> None:
        if not paths:
            raise ValueError("NO_VIDEO_SEGMENTS")
        normalized = []
        for index, path in enumerate(paths):
            check()
            target = destination.parent / f"normalized-{index}.mp4"
            run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-an", "-vf", "scale=720:1080:force_original_aspect_ratio=decrease,pad=720:1080:(ow-iw)/2:(oh-ih)/2,setsar=1", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(target)])
            normalized.append(target)
        manifest = destination.parent / "concat.txt"
        # Only UUID-generated filenames in our private cache, never user text.
        manifest.write_text("\n".join(f"file '{p.name}'" for p in normalized), encoding="utf-8")
        check()
        run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1", "-i", str(manifest), "-c", "copy", "-movflags", "+faststart", str(destination)])
        if self.probe(destination)["duration_ms"] <= 0:
            raise ValueError("INVALID_COMPOSED_VIDEO")

    def mix(self, video: Path, audio: Path, destination: Path) -> None:
        duration = self.probe(video)["duration_ms"] / 1000
        run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-stream_loop", "-1", "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-t", str(duration), "-c:v", "copy", "-c:a", "aac", "-af", f"afade=t=out:st={max(0, duration - 1)}:d=1", "-movflags", "+faststart", str(destination)])
        self.probe(destination)

    def poster(self, video: Path, destination: Path) -> None:
        run_tool([self.settings.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-frames:v", "1", str(destination)])


class ObjectStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config
            self._client = boto3.client("s3", endpoint_url=self.settings.s3_endpoint, region_name=self.settings.s3_region,
                                       aws_access_key_id=self.settings.s3_access_key, aws_secret_access_key=self.settings.s3_secret_key,
                                       config=Config(s3={"addressing_style": "path" if self.settings.s3_path_style else "auto"}, connect_timeout=10, read_timeout=60))
        return self._client

    def upload(self, path: Path, project_id: str, run_id: str, media_id: str, content_type: str) -> tuple[str, str, int]:
        checksum = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                checksum.update(chunk)
        digest = checksum.hexdigest()
        key = f"runway/{project_id}/{run_id}/{media_id}{path.suffix}"
        self.client.upload_file(str(path), self.settings.s3_bucket, key, ExtraArgs={"ContentType": content_type})
        return key, digest, path.stat().st_size

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            self.client.head_object(Bucket=self.settings.s3_bucket, Key=key)
            return True
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise

    def download(self, object_key: str, path: Path) -> None:
        self.client.download_file(self.settings.s3_bucket, object_key, str(path))

    @contextmanager
    def workspace(self):
        self.settings.temp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=uuid.uuid4().hex + "-", dir=self.settings.temp_dir) as temporary:
            yield Path(temporary)
