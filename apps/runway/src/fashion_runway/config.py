"""Explicit server-only configuration with safe diagnostic output."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def boolean(value: str | None, default: bool = False) -> bool:
    return default if value is None else value.strip().lower() in {"1", "true", "yes"}


def postgres_dsn(value: str) -> str:
    """Prisma's schema query parameter is not a libpq connection option."""
    url = urlsplit(value)
    query = [(key, val) for key, val in parse_qsl(url.query) if key != "schema"]
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), url.fragment))


@dataclass(frozen=True)
class Settings:
    enabled: bool
    mode: str
    database_url: str
    checkpoint_schema: str
    concurrency: int
    worker_id: str
    temp_dir: Path
    ffmpeg: str
    ffprobe: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    s3_path_style: bool
    image_base_url: str
    image_model: str
    image_key: str
    llm_base_url: str
    llm_model: str
    llm_key: str
    vision_base_url: str
    vision_model: str
    vision_key: str
    volc_ak: str
    volc_sk: str
    video_req_key: str
    video_frames: int
    video_timeout: float
    poll_interval: float
    music_base_url: str
    music_model: str
    music_key: str
    request_timeout: float

    @classmethod
    def from_env(cls) -> "Settings":
        import socket
        import uuid

        def get(key, default=None):
            return os.getenv(key) or default
        mode = get("RUNWAY_PROVIDER_MODE", "mock").strip().lower()
        if mode not in {"mock", "live"}:
            raise ValueError("RUNWAY_PROVIDER_MODE must be mock or live")
        schema = get("RUNWAY_CHECKPOINT_SCHEMA", "runway_checkpoints")
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema):
            raise ValueError("RUNWAY_CHECKPOINT_SCHEMA must be a SQL identifier")
        concurrency = int(get("RUNWAY_WORKER_CONCURRENCY", "1"))
        if concurrency < 1:
            raise ValueError("RUNWAY_WORKER_CONCURRENCY must be positive")
        return cls(
            enabled=boolean(get("RUNWAY_ENABLED")), mode=mode,
            database_url=postgres_dsn(get("RUNWAY_DATABASE_URL", get("DATABASE_URL", ""))),
            checkpoint_schema=schema, concurrency=concurrency,
            worker_id=get("RUNWAY_WORKER_ID", f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"),
            temp_dir=Path(get("RUNWAY_TEMP_DIR", "/tmp/runway" if os.name != "nt" else str(Path(os.getenv("TEMP", ".")) / "fashion-runway"))),
            ffmpeg=get("RUNWAY_FFMPEG_PATH", "ffmpeg"), ffprobe=get("RUNWAY_FFPROBE_PATH", "ffprobe"),
            s3_endpoint=get("S3_ENDPOINT", "http://127.0.0.1:9000"),
            s3_region=get("S3_REGION", "us-east-1"), s3_bucket=get("S3_BUCKET", "fashion-assets"),
            s3_access_key=get("S3_ACCESS_KEY_ID", ""), s3_secret_key=get("S3_SECRET_ACCESS_KEY", ""),
            s3_path_style=boolean(get("S3_FORCE_PATH_STYLE"), True),
            image_base_url=get("RUNWAY_IMAGE_BASE_URL", "https://api.closeai-proxy.xyz/google"),
            image_model=get("RUNWAY_IMAGE_MODEL", "google/gemini-3-pro-image"),
            image_key=get("RUNWAY_IMAGE_API_KEY", ""),
            llm_base_url=get("RUNWAY_LLM_BASE_URL", "https://openrouter.ai/api/v1"),
            llm_model=get("RUNWAY_LLM_MODEL", "openai/gpt-4o"), llm_key=get("RUNWAY_LLM_API_KEY", ""),
            vision_base_url=get("RUNWAY_VISION_BASE_URL", "https://api.closeai-proxy.xyz/v1"),
            vision_model=get("RUNWAY_VISION_MODEL", "gpt-4o"), vision_key=get("RUNWAY_VISION_API_KEY", ""),
            volc_ak=get("RUNWAY_VOLC_AK", get("RUNWAY_VIDEO_AK", "")), volc_sk=get("RUNWAY_VOLC_SK", get("RUNWAY_VIDEO_SK", "")),
            video_req_key=get("RUNWAY_VIDEO_REQ_KEY", "jimeng_i2v_first_v30"),
            video_frames=int(get("RUNWAY_VIDEO_FRAMES", "121")),
            video_timeout=float(get("RUNWAY_VIDEO_TIMEOUT_SECONDS", "900")),
            poll_interval=float(get("RUNWAY_POLL_INTERVAL_SECONDS", "3")),
            music_base_url=get("RUNWAY_MUSIC_BASE_URL", "https://api.minimaxi.com"),
            music_model=get("RUNWAY_MUSIC_MODEL", "music-2.6"), music_key=get("RUNWAY_MUSIC_API_KEY", ""),
            request_timeout=float(get("RUNWAY_REQUEST_TIMEOUT_SECONDS", "180")),
        )

    def capabilities(self) -> dict:
        if self.mode == "mock":
            return {"mode": "mock", "llm": True, "image": True, "video": True, "music": True, "vision": False}
        return {"mode": "live", "llm": bool(self.llm_key), "image": bool(self.image_key),
                "video": bool(self.volc_ak and self.volc_sk), "music": bool(self.music_key),
                "vision": bool(self.vision_key)}

    def model_snapshot(self) -> dict:
        return {"mode": self.mode, "llm": self.llm_model, "image": self.image_model,
                "video": self.video_req_key, "music": self.music_model, "vision": self.vision_model}
