import pytest

from fashion_runway.config import Settings, postgres_dsn
from fashion_runway.contracts import Action, Draft
from fashion_runway.worker import captured_settings


def test_prisma_schema_removed_without_losing_ssl():
    assert postgres_dsn("postgresql://user:pass@localhost/db?schema=public&sslmode=require") == "postgresql://user:pass@localhost/db?sslmode=require"


def test_blank_optional_values_use_defaults(monkeypatch):
    monkeypatch.setenv("RUNWAY_DATABASE_URL", "")
    monkeypatch.setenv("DATABASE_URL", "postgresql://local/db?schema=public")
    monkeypatch.setenv("RUNWAY_TEMP_DIR", "")
    monkeypatch.setenv("RUNWAY_IMAGE_MODEL", "")
    settings = Settings.from_env()
    assert settings.database_url == "postgresql://local/db"
    assert settings.image_model == "google/gemini-3-pro-image"
    assert str(settings.temp_dir)


def test_snapshot_keeps_model_selection_and_not_credentials(monkeypatch):
    monkeypatch.setenv("RUNWAY_IMAGE_API_KEY", "private-test-value")
    monkeypatch.setenv("RUNWAY_PROVIDER_MODE", "live")
    settings = Settings.from_env()
    frozen = captured_settings(settings, {"mode": "live", "imageModel": "previous-model"})
    assert frozen.image_model == "previous-model"
    assert frozen.image_key == "private-test-value"
    assert "private-test-value" not in str(settings.model_snapshot())
    assert "private-test-value" not in str(settings.capabilities())


def test_run_snapshot_cannot_escalate_mock_worker_to_live(monkeypatch):
    from fashion_runway.repository import ExecutionStopped

    monkeypatch.setenv("RUNWAY_PROVIDER_MODE", "mock")
    with pytest.raises(ExecutionStopped, match="PROVIDER_MODE_MISMATCH"):
        captured_settings(Settings.from_env(), {"mode": "live"})
    assert captured_settings(Settings.from_env(), {"mode": None}).mode == "mock"


def test_provider_mode_whitespace_matches_api_normalization(monkeypatch):
    monkeypatch.setenv("RUNWAY_PROVIDER_MODE", " LiVe ")
    assert Settings.from_env().mode == "live"


@pytest.mark.parametrize("value", ["public;DROP SCHEMA public", "a-b", "UPPER"])
def test_checkpoint_schema_is_identifier(monkeypatch, value):
    monkeypatch.setenv("RUNWAY_CHECKPOINT_SCHEMA", value)
    with pytest.raises(ValueError):
        Settings.from_env()


def test_contract_defaults_and_required_action_fields():
    assert Draft(prompt="show").modelCount == 6
    assert Draft(prompt="show").withMusic
    with pytest.raises(ValueError):
        Draft(prompt="show", modelCount=0)
    with pytest.raises(ValueError):
        Action(kind="edit", requestKey="key", expectedVersion=1)
    with pytest.raises(ValueError):
        Action(kind="pair", requestKey="key", expectedVersion=1, pairings=[])
    assert Action(kind="confirm", requestKey="key", expectedVersion=1, interruptId="pending").kind == "confirm"
