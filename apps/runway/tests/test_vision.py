from dataclasses import replace

import pytest
from test_pipeline import LocalStorage, MemoryRepository

from fashion_runway.config import Settings
from fashion_runway.pipeline import Pipeline


@pytest.mark.parametrize("feedback,expected,adjusted", [("TOO_BIG", "checked", True), ("PASS", "checked", False), (None, "unavailable", False)])
def test_legacy_vision_is_bounded_and_durable(tmp_path, feedback, expected, adjusted):
    repository = MemoryRepository()
    storage = LocalStorage(tmp_path)
    initial = Pipeline(Settings.from_env(), repository, storage)
    initial.advance()
    run, state = initial.current()
    source = state["mediaByStage"]["model"][0]
    settings = replace(Settings.from_env(), mode="live", vision_key="test-only")

    class FakeProviders:
        vision_calls = 0
        edit_calls = 0

        def inspect_scale(self, _path):
            self.vision_calls += 1
            return feedback

        def image(self, _prompt, _references, output, kind, index):
            self.edit_calls += 1
            initial.tools.mock_image(output, kind, index)

    providers = FakeProviders()
    pipeline = Pipeline(settings, repository, storage, providers)
    result = pipeline.inspect_storyboard(run, state, source, 0)
    repeated = pipeline.inspect_storyboard(run, state, source, 0)
    assert result == repeated
    assert providers.vision_calls == 1
    assert providers.edit_calls == (1 if adjusted else 0)
    assert state["visionChecks"]["0"]["status"] == expected
    assert (result != source) is adjusted


def test_unconfigured_vision_records_skipped_manual_review(tmp_path):
    repository = MemoryRepository()
    pipeline = Pipeline(replace(Settings.from_env(), mode="live", vision_key=""), repository, LocalStorage(tmp_path))
    run, state = pipeline.current()
    assert pipeline.inspect_storyboard(run, state, "reference", 0) == "reference"
    assert state["visionChecks"]["0"]["reason"] == "VISION_NOT_CONFIGURED"
    assert not repository.attempts


def test_interrupted_vision_does_not_repeat_remote_call(tmp_path):
    repository = MemoryRepository()
    pipeline = Pipeline(replace(Settings.from_env(), mode="live", vision_key="test-only"), repository, LocalStorage(tmp_path))
    run, state = pipeline.current()
    repository.begin_attempt("run", "storyboard:vision:0:reference", "storyboard", "legacy_vision", {})
    assert pipeline.inspect_storyboard(run, state, "reference", 0) == "reference"
    assert state["visionChecks"]["0"]["reason"] == "VISION_PREVIOUS_RESULT_UNCERTAIN"
