import argparse
import json
import logging
import shutil
import sys
import tempfile
import time
from pathlib import Path

from .config import Settings


def doctor(settings, config_only=False):
    checks = {"enabled": settings.enabled, "mode": settings.mode, "configured": settings.capabilities(),
              "databaseConfigured": bool(settings.database_url),
              "ffmpeg": bool(shutil.which(settings.ffmpeg)), "ffprobe": bool(shutil.which(settings.ffprobe))}
    if not config_only:
        try:
            from .repository import Repository
            repository = Repository(settings)
            checks["database"] = bool(repository.one("SELECT 1 AS ok")["ok"])
            checks["businessSchema"] = bool(repository.one("SELECT to_regclass('public.runway_runs') AS name")["name"])
            checks["workerOnline"] = repository.one("SELECT EXISTS(SELECT 1 FROM runway_worker_heartbeats WHERE updated_at>CURRENT_TIMESTAMP-interval '40 seconds') AS online")["online"]
            repository.close()
        except Exception as error:
            checks["database"] = type(error).__name__
        try:
            from .media import ObjectStorage
            ObjectStorage(settings).client.head_bucket(Bucket=settings.s3_bucket)
            checks["storage"] = True
        except Exception as error:
            checks["storage"] = type(error).__name__
        try:
            from .checkpoints import saver
            with saver(settings):
                checks["checkpoints"] = True
        except Exception as error:
            checks["checkpoints"] = type(error).__name__
    print(json.dumps(checks, ensure_ascii=False))
    required = ["ffmpeg", "ffprobe"] if config_only else ["ffmpeg", "ffprobe", "database", "businessSchema", "storage", "checkpoints"]
    return 0 if all(checks.get(key) is True for key in required) else 1


def _smoke(settings, provider, output_dir=None):
    from .media import MediaTools
    from .providers import Providers

    adapter = Providers(settings)
    tools = MediaTools(settings)
    from contextlib import nullcontext
    if output_dir:
        Path(output_dir).mkdir(parents=True, exist_ok=True)
    context = nullcontext(output_dir) if output_dir else tempfile.TemporaryDirectory()
    with context as folder:
        started = time.monotonic()
        directory = Path(folder)
        image = directory / "reference.png"
        tools.mock_image(image, "model")
        if provider == "llm":
            result = {"nonempty": bool(adapter.improve("A minimal green sustainable fashion runway"))}
        elif provider == "image":
            output = directory / "output.png"
            adapter.image("One full-body fashion model on plain white background", [], output, "model")
            result = {"bytes": output.stat().st_size}
        elif provider == "video":
            output = directory / "output.mp4"
            if settings.mode == "mock":
                tools.mock_video(image, output)
            else:
                task = adapter.submit_video(image)
                (directory / "provider-job.json").write_text(json.dumps({"providerJobId": task, "model": settings.video_req_key}), encoding="utf-8")
                print(json.dumps({"providerJobId": task, "note": "Preserve this ID if polling fails; do not blindly submit again."}))
                adapter.wait_video(task, output)
            result = tools.probe(output)
        else:
            output = directory / "output.mp3"
            adapter.music("Calm instrumental fashion runway", output, 6)
            result = tools.probe(output)
        evidence = {"provider": provider, "mode": settings.mode, "models": settings.model_snapshot(), "elapsedSeconds": round(time.monotonic() - started, 3), "status": "succeeded", "result": result}
        (directory / "manifest.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(evidence))
    return 0


def smoke(settings, provider, output_dir=None):
    started = time.monotonic()
    try:
        return _smoke(settings, provider, output_dir)
    except Exception as error:
        if output_dir:
            directory = Path(output_dir)
            directory.mkdir(parents=True, exist_ok=True)
            code = getattr(error, "code", type(error).__name__)
            (directory / "manifest.json").write_text(json.dumps({"provider": provider, "mode": settings.mode,
                "models": settings.model_snapshot(), "elapsedSeconds": round(time.monotonic() - started, 3),
                "status": "failed", "error": code, "details": getattr(error, "details", {})}, ensure_ascii=False, indent=2), encoding="utf-8")
        raise


def main():
    parser = argparse.ArgumentParser(prog="fashion-runway")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("worker")
    commands.add_parser("init-checkpoints")
    commands.add_parser("health")
    diagnostic = commands.add_parser("doctor")
    diagnostic.add_argument("--config-only", action="store_true")
    sample = commands.add_parser("smoke")
    sample.add_argument("--provider", required=True, choices=["llm", "image", "video", "music"])
    sample.add_argument("--output-dir")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        settings = Settings.from_env()
        if args.command == "doctor":
            return doctor(settings, args.config_only)
        if args.command == "health":
            from .worker import health
            return 0 if health(settings) else 1
        if args.command == "init-checkpoints":
            from .checkpoints import saver
            with saver(settings, initialize=True):
                print(json.dumps({"checkpoints": "ready", "schema": settings.checkpoint_schema}))
            return 0
        if args.command == "smoke":
            return smoke(settings, args.provider, args.output_dir)
        from .worker import run_worker
        run_worker(settings)
        return 0
    except Exception as error:
        code = getattr(error, "code", None) or (str(error) if isinstance(error, ValueError) else type(error).__name__)
        print(json.dumps({"error": code, "details": getattr(error, "details", {})}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
