import copy
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest

from fashion_runway.config import Settings
from fashion_runway.pipeline import Pipeline
from fashion_runway.providers import ProviderError


class MemoryRepository:
    """Test-only repository; production always uses PostgreSQL."""
    def __init__(self):
        self.record = {"id": "run", "project_id": "project", "stage": "prepare", "status": "QUEUED",
                       "pending_input": None, "input_snapshot": {"prompt": "green runway", "modelCount": 2, "withMusic": True, "inputs": []},
                       "model_snapshot": {"mode": "mock"}, "state": {}}
        self.command = {"id": "start", "kind": "start", "execution_epoch": 1}
        self.attempts = {}
        self.media_records = {}

    def check(self):
        return copy.deepcopy(self.record)

    def run(self, _):
        return self.check()

    def update_run(self, _, **values):
        self.record.update({key: copy.deepcopy(value) for key, value in values.items() if key != "pending"})
        self.record["pending_input"] = copy.deepcopy(values.get("pending"))

    def attempt(self, _, key):
        return self.attempts.get(key)

    def begin_attempt(self, _, key, stage, provider, inputs):
        self.attempts[key] = {"id": key, "operation_key": key, "stage": stage, "provider": provider,
                              "status": "RUNNING", "input": inputs, "provider_data": {}, "output_media_ids": []}
        return self.attempts[key]

    def update_attempt(self, attempt_id, **values):
        self.attempts[attempt_id].update(copy.deepcopy(values))

    def media(self, media_id):
        return self.media_records[media_id]

    def save_media(self, record):
        self.media_records[record["id"]] = record

    def save_media_and_complete(self, record, attempt_id):
        self.save_media(record)
        self.update_attempt(attempt_id, status="SUCCEEDED", output_media_ids=[record["id"]])

    def one(self, *_):
        return None


class LocalStorage:
    def __init__(self, root):
        self.root = root

    @contextmanager
    def workspace(self):
        import tempfile
        with tempfile.TemporaryDirectory(dir=self.root) as folder:
            yield Path(folder)

    def upload(self, path, project, run, media_id, _mime):
        key = f"runway/{project}/{run}/{media_id}{path.suffix}"
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        return key, "digest", target.stat().st_size

    def exists(self, key):
        return (self.root / key).exists()

    def download(self, key, path):
        shutil.copyfile(self.root / key, path)


def action(pipeline, repository, kind, **values):
    repository.command = {"id": str(uuid.uuid4()), "kind": kind, "execution_epoch": 1}
    payload = {"kind": kind, "interruptId": (repository.record["pending_input"] or {}).get("interruptId"), **values}
    pipeline.apply_action(payload)


def test_review_edit_and_pairing_preserve_history(tmp_path):
    repo = MemoryRepository()
    pipeline = Pipeline(Settings.from_env(), repo, LocalStorage(tmp_path))
    pending = pipeline.advance()
    assert pending["stage"] == "prepare"
    assert len(pending["mediaIds"]) == 5
    old = pending["mediaIds"][0]
    action(pipeline, repo, "edit", mediaId=old, instruction="make green")
    replacement = pipeline.advance()
    assert old not in replacement["mediaIds"]
    assert old in repo.media_records
    assert replacement["interruptId"] != pending["interruptId"]
    action(pipeline, repo, "confirm")
    pair = pipeline.advance()
    assert pair["kind"] == "pair"
    with pytest.raises(ValueError, match="PAIRING_MEDIA_INVALID"):
        action(pipeline, repo, "pair", pairings=[{"modelMediaId": "wrong", "clothMediaId": "wrong"}])
    action(pipeline, repo, "pair", pairings=[{"modelMediaId": pair["models"][0], "clothMediaId": pair["clothes"][0]}])
    assert pipeline.advance()["stage"] == "tryon"


def test_incomplete_generation_resumes_remaining_images(tmp_path):
    repo = MemoryRepository()
    pipeline = Pipeline(Settings.from_env(), repo, LocalStorage(tmp_path))
    original = pipeline.providers.image
    calls = []

    def failing(prompt, references, destination, kind, index=0):
        calls.append((kind, index))
        if len(calls) == 2:
            raise ProviderError("TEST_TRANSIENT")
        original(prompt, references, destination, kind, index)

    pipeline.providers.image = failing
    with pytest.raises(ProviderError):
        pipeline.advance()
    assert len(repo.record["state"]["mediaByStage"]["model"]) == 1
    pipeline.providers.image = original
    pending = pipeline.advance()
    assert len(repo.record["state"]["mediaByStage"]["model"]) == 2
    assert len(pending["mediaIds"]) == 5


def test_live_uncertain_call_requires_explicit_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNWAY_PROVIDER_MODE", "live")
    repo = MemoryRepository()
    pipeline = Pipeline(Settings.from_env(), repo, LocalStorage(tmp_path))
    run, state = pipeline.current()
    repo.begin_attempt("run", "model:0", "model", "legacy_google_gateway", {})
    with pytest.raises(ProviderError) as error:
        pipeline.attempt(run, state, "model:0", "model", "legacy_google_gateway", {})
    assert error.value.uncertain
    state["retryNonce"] = "explicit-request"
    attempt, done = pipeline.attempt(run, state, "model:0", "model", "legacy_google_gateway", {})
    assert not done
    assert attempt["operation_key"] == "model:0:retry:explicit-request"


def test_uploaded_object_recovered_without_second_generation(tmp_path):
    class InterruptedStorage(LocalStorage):
        broken = False

        def upload(self, *args):
            result = super().upload(*args)
            if not self.broken:
                self.broken = True
                raise OSError("simulated crash after successful upload")
            return result

    repository = MemoryRepository()
    storage = InterruptedStorage(tmp_path)
    pipeline = Pipeline(Settings.from_env(), repository, storage)
    calls = []
    original = pipeline.providers.image

    def generate(*args):
        calls.append(args[3:])
        return original(*args)

    pipeline.providers.image = generate
    with pytest.raises(OSError):
        pipeline.advance()
    assert not repository.record["state"]["mediaByStage"]["model"]
    pending = pipeline.advance()
    assert pending["stage"] == "prepare"
    assert len(calls) == 5  # 2 models + 2 garments + 1 background, with no repeated first model.
    assert len(repository.media_records) == 5


@pytest.mark.parametrize("failure,new_submission", [("VIDEO_FAILED", True), ("VIDEO_EXPIRED", True), ("VIDEO_POLL_TIMEOUT", False), ("VIDEO_POLL_FAILED", False), ("PROVIDER_DOWNLOAD_FAILED", False)])
def test_video_retry_distinguishes_terminal_task_from_poll_failure(tmp_path, failure, new_submission):
    repository = MemoryRepository()
    pipeline = Pipeline(Settings.from_env(), repository, LocalStorage(tmp_path))
    run, state = pipeline.current()
    attempt = repository.begin_attempt("run", "video:0", "video", "jimeng", {})
    attempt.update(status="FAILED", provider_job_id="original-provider-task", error_code=failure)
    state["retryNonce"] = "explicit-retry"
    selected, _ = pipeline.attempt(run, state, "video:0", "video", "jimeng", {})
    if new_submission:
        assert selected["operation_key"] == "video:0:retry:explicit-retry"
        assert not selected.get("provider_job_id")
    else:
        assert selected["provider_job_id"] == "original-provider-task"
        assert selected["operation_key"] == "video:0"


def test_selective_fork_regenerates_only_missing_ordered_slots(tmp_path):
    repository = MemoryRepository()
    pipeline = Pipeline(Settings.from_env(), repository, LocalStorage(tmp_path))
    pipeline.advance()
    action(pipeline, repository, "confirm")
    pairing = pipeline.advance()
    action(pipeline, repository, "pair", pairings=[{"modelMediaId": pairing["models"][i], "clothMediaId": pairing["clothes"][i]} for i in range(2)])
    pipeline.advance()
    action(pipeline, repository, "confirm")
    pipeline.advance()
    retained = repository.record["state"]["mediaByStage"]["storyboard"][1]
    repository.record["state"]["mediaByStage"]["storyboard"][0] = None
    repository.record["pending_input"] = None
    repository.attempts = {key: value for key, value in repository.attempts.items() if not key.startswith("storyboard:")}
    calls = []
    original_image = pipeline.providers.image

    def image(*args):
        calls.append(args[-1])
        return original_image(*args)

    pipeline.providers.image = image
    pending = pipeline.advance()
    assert calls == [0]
    assert pending["mediaIds"][1] == retained
    repository.record["state"]["mediaByStage"]["video"] = [None, "retained-video"]
    action(pipeline, repository, "confirm")
    video_calls = []

    def video(_run, _state, index, image_id):
        video_calls.append((index, image_id))
        return "new-video"

    class StopBeforeCompose(Exception):
        pass

    original_persist = pipeline.persist

    def persist(*args, **kwargs):
        if kwargs.get("stage") == "compose":
            raise StopBeforeCompose()
        return original_persist(*args, **kwargs)

    pipeline.video = video
    pipeline.persist = persist
    with pytest.raises(StopBeforeCompose):
        pipeline.advance()
    assert video_calls == [(0, pending["mediaIds"][0])]
    assert repository.record["state"]["mediaByStage"]["video"] == ["new-video", "retained-video"]
