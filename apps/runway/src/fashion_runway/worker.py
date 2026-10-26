import json
import logging
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

from .checkpoints import saver
from .config import Settings
from .pipeline import Pipeline, build_graph
from .providers import ProviderError
from .repository import ExecutionStopped, LostLease, Repository

logger = logging.getLogger("runway")


def captured_settings(settings, snapshot):
    """Model selection belongs to the run; credentials remain environment-only."""
    mode = snapshot.get("mode") or settings.mode
    if mode != settings.mode:
        raise ExecutionStopped("PROVIDER_MODE_MISMATCH")
    return replace(settings, mode=mode,
                   llm_model=snapshot.get("llmModel", settings.llm_model),
                   image_model=snapshot.get("imageModel", settings.image_model),
                   vision_model=snapshot.get("visionModel", settings.vision_model),
                   video_req_key=snapshot.get("videoReqKey", settings.video_req_key),
                   music_model=snapshot.get("musicModel", settings.music_model))


def execute_command(repository, settings):
    from langgraph.types import Command

    command = repository.command

    def record_failure(code, *, attention=False, canceled=False):
        try:
            stored = repository.one("SELECT status FROM runway_commands WHERE id=%s", (command["id"],))
            if stored and stored["status"] == "SUCCEEDED":
                # Business wait/result already committed. The next command can rebuild
                # graph metadata from authoritative state if this checkpoint write failed.
                logger.error("checkpoint_persistence_warning code=%s command=%s", code, command["id"])
                return
            repository.fail(code, attention=attention, canceled=canceled)
        except LostLease:
            logger.warning("failure_after_lease_lost command=%s", command["id"])

    try:
        run = repository.check()
        settings = captured_settings(settings, run["model_snapshot"])
        pipeline = Pipeline(settings, repository)
        if command["kind"] != "start":
            pipeline.apply_action({**command["payload"], "kind": command["kind"]})
        with saver(settings) as checkpointer:
            graph = build_graph(pipeline, checkpointer)
            config = {"configurable": {"thread_id": run["id"]}, "recursion_limit": 100}
            snapshot = graph.get_state(config)
            if not snapshot.values:
                graph.invoke({"runId": run["id"]}, config)
            elif any(task.interrupts for task in snapshot.tasks):
                graph.invoke(Command(resume={"commandId": command["id"]}), config)
            elif snapshot.next:
                graph.invoke(None, config)
            elif repository.run(run["id"])["status"] != "SUCCEEDED":
                # New forks have a new thread, this branch handles repaired terminal graph metadata.
                graph.invoke({"runId": run["id"]}, config)
        repository.finish_command()
    except LostLease:
        logger.warning("command_lost_lease", extra={"command_id": command["id"]})
    except ExecutionStopped as error:
        record_failure(str(error), canceled=True)
    except ProviderError as error:
        record_failure(error.code, attention=error.uncertain)
        logger.warning("provider_failed code=%s command=%s", error.code, command["id"])
    except Exception as error:
        # Detailed provider responses and input content are deliberately absent from logs.
        code = str(error) if isinstance(error, ValueError) else f"EXECUTION_{type(error).__name__.upper()}"
        record_failure(code)
        logger.error("execution_failed code=%s command=%s", code, command["id"])


def local_heartbeat(settings: Settings):
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    target = settings.temp_dir / "worker-heartbeat.json"
    temporary = target.with_suffix(f".{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps({"workerId": settings.worker_id, "timestamp": time.time()}), encoding="utf-8")
    temporary.replace(target)


def run_worker(settings: Settings):
    if not settings.enabled:
        raise ValueError("RUNWAY_DISABLED")
    if not settings.database_url:
        raise ValueError("RUNWAY_DATABASE_URL_REQUIRED")
    # Fail before advertising readiness if checkpoint persistence is unavailable.
    with saver(settings):
        pass
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    def consume(index):
        worker_settings = replace(settings, worker_id=f"{settings.worker_id}-{index}")
        repository = Repository(worker_settings)

        def pulse():
            while not stop.is_set():
                try:
                    repository.heartbeat()
                    local_heartbeat(settings)
                except Exception:
                    logger.warning("heartbeat_failed")
                stop.wait(10)

        heartbeat = threading.Thread(target=pulse, daemon=True)
        heartbeat.start()
        try:
            while not stop.is_set():
                command = repository.claim()
                if command:
                    try:
                        execute_command(repository, worker_settings)
                    finally:
                        repository.release()
                else:
                    stop.wait(1)
        except Exception:
            stop.set()
            raise
        finally:
            repository.close()

    with ThreadPoolExecutor(max_workers=settings.concurrency) as pool:
        futures = [pool.submit(consume, i) for i in range(settings.concurrency)]
        for future in futures:
            future.result()


def health(settings):
    target = Path(settings.temp_dir) / "worker-heartbeat.json"
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
        return time.time() - data["timestamp"] < 40
    except (OSError, ValueError, KeyError):
        return False
