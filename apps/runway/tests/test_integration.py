"""Real PostgreSQL + checkpoint saver + S3 + FFmpeg; remote AI alone is mocked."""

import os
import uuid

import pytest
from psycopg.types.json import Jsonb

from fashion_runway.checkpoints import saver
from fashion_runway.config import Settings
from fashion_runway.media import ObjectStorage
from fashion_runway.pipeline import Pipeline
from fashion_runway.repository import LostLease, Repository
from fashion_runway.worker import execute_command

pytestmark = [pytest.mark.integration, pytest.mark.skipif(os.getenv("RUNWAY_INTEGRATION") != "1", reason="isolated integration environment required")]


@pytest.fixture
def environment(monkeypatch):
    monkeypatch.setenv("RUNWAY_PROVIDER_MODE", "mock")
    monkeypatch.setenv("RUNWAY_ENABLED", "true")
    settings = Settings.from_env()
    repository = Repository(settings)
    user, workspace, project, show, run = [str(uuid.uuid4()) for _ in range(5)]
    connection = repository.connection
    connection.execute("INSERT INTO users(id,email) VALUES(%s,%s)", (user, f"runway-{user}@example.invalid"))
    connection.execute("INSERT INTO workspaces(id,name,owner_id) VALUES(%s,'runway test',%s)", (workspace, user))
    connection.execute("INSERT INTO projects(id,ws_id,name,updated_at) VALUES(%s,%s,'runway test',CURRENT_TIMESTAMP)", (project, workspace))
    draft = {"prompt": "A calm green runway", "modelCount": 2, "withMusic": True, "inputs": []}
    connection.execute("INSERT INTO runway_shows(id,project_id,owner_id,title,draft,request_key) VALUES(%s,%s,%s,'runway test',%s,%s)", (show, project, user, Jsonb(draft), str(uuid.uuid4())))
    connection.execute("INSERT INTO runway_runs(id,show_id,project_id,user_id,input_snapshot,model_snapshot,request_key) VALUES(%s,%s,%s,%s,%s,%s,%s)", (run, show, project, user, Jsonb(draft), Jsonb({"mode": "mock"}), str(uuid.uuid4())))
    with saver(settings, initialize=True):
        pass
    data = {"settings": settings, "repository": repository, "user": user, "project": project, "show": show, "run": run}
    yield data
    repository = data["repository"]
    connection = repository.connection
    keys = connection.execute("SELECT object_key FROM runway_media WHERE project_id=%s", (project,)).fetchall()
    storage = ObjectStorage(settings)
    for row in keys:
        storage.client.delete_object(Bucket=settings.s3_bucket, Key=row["object_key"])
    connection.execute("DELETE FROM projects WHERE id=%s", (project,))
    connection.execute("DELETE FROM workspaces WHERE id=%s", (workspace,))
    connection.execute("DELETE FROM users WHERE id=%s", (user,))
    repository.close()


def submit(environment, kind="start", **payload):
    repository = environment["repository"]
    command = str(uuid.uuid4())
    repository.connection.execute("INSERT INTO runway_commands(id,run_id,kind,payload,request_key) VALUES(%s,%s,%s,%s,%s)",
                                  (command, environment["run"], kind, Jsonb({"actorUserId": environment["user"], **payload}), command))
    repository.connection.execute("UPDATE runway_runs SET status='QUEUED' WHERE id=%s", (environment["run"],))
    assert repository.claim()["id"] == command
    execute_command(repository, environment["settings"])
    repository.release()
    return repository.run(environment["run"])


def test_postgres_restart_review_and_complete(environment):
    run = submit(environment)
    assert run["status"] == "WAITING_INPUT", run["state"]
    assert run["pending_input"]["stage"] == "prepare"
    # Construct a new Python repository and graph to prove progress is not process memory.
    original = environment["repository"]
    environment["repository"] = Repository(environment["settings"])
    original.close()
    run = submit(environment, "confirm", interruptId=run["pending_input"]["interruptId"])
    assert run["pending_input"]["kind"] == "pair"
    pending = run["pending_input"]
    run = submit(environment, "pair", interruptId=pending["interruptId"], pairings=[{"modelMediaId": pending["models"][i], "clothMediaId": pending["clothes"][i]} for i in range(2)])
    assert run["pending_input"]["stage"] == "tryon"
    run = submit(environment, "confirm", interruptId=run["pending_input"]["interruptId"])
    assert run["pending_input"]["stage"] == "storyboard"
    run = submit(environment, "confirm", interruptId=run["pending_input"]["interruptId"])
    assert run["status"] == "SUCCEEDED", run["state"]
    assert run["stage"] == "finished"
    assert len(run["state"]["mediaByStage"]["video"]) == 2
    assert run["state"]["mediaByStage"]["final_video"]
    events = environment["repository"].connection.execute("SELECT sequence FROM runway_events WHERE run_id=%s ORDER BY sequence", (run["id"],)).fetchall()
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))


def test_revoked_project_stops_execution(environment):
    repository = environment["repository"]
    repository.connection.execute("UPDATE projects SET archived=true WHERE id=%s", (environment["project"],))
    run = submit(environment)
    assert run["status"] == "CANCELED"
    assert run["state"]["errorCode"] == "PROJECT_ACCESS_REVOKED"
    assert not repository.connection.execute("SELECT id FROM runway_media WHERE run_id=%s", (run["id"],)).fetchall()


def test_execution_epoch_fences_stale_result(environment):
    repository = environment["repository"]
    command = str(uuid.uuid4())
    repository.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (command, environment["run"], command))
    assert repository.claim()
    repository.connection.execute("UPDATE runway_commands SET execution_epoch=execution_epoch+1 WHERE id=%s", (command,))
    with pytest.raises(LostLease):
        repository.update_run(environment["run"], status="SUCCEEDED", stage="finished", state={})
    repository.release()


def test_upload_to_metadata_crash_recovers_without_resubmit(environment):
    repository = environment["repository"]
    command = str(uuid.uuid4())
    repository.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (command, environment["run"], command))
    assert repository.claim()
    pipeline = Pipeline(environment["settings"], repository)
    original_save = repository.save_media_and_complete

    def crash(*_):
        raise OSError("injected termination after S3 upload before database registration")

    repository.save_media_and_complete = crash
    with pytest.raises(OSError):
        pipeline.advance()
    assert not repository.connection.execute("SELECT id FROM runway_media WHERE run_id=%s", (environment["run"],)).fetchall()
    repository.save_media_and_complete = original_save
    repository.release()
    repository.connection.execute("UPDATE runway_commands SET lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=%s", (command,))
    assert repository.claim()["execution_epoch"] == 2
    recovered = Pipeline(environment["settings"], repository)
    original_image = recovered.providers.image
    calls = []

    def count(*args):
        calls.append(args[3])
        return original_image(*args)

    recovered.providers.image = count
    assert recovered.advance()["stage"] == "prepare"
    assert len(calls) == 4  # The first model is recovered from private S3, not regenerated.
    assert repository.one("SELECT count(*) AS count FROM runway_media WHERE run_id=%s", (environment["run"],))["count"] == 5
    repository.release()


def test_locked_expired_run_does_not_starve_other_queued_run(environment):
    first = environment["repository"]
    first_id = str(uuid.uuid4())
    first.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (first_id, environment["run"], first_id))
    assert first.claim()["id"] == first_id
    first.connection.execute("UPDATE runway_commands SET lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=%s", (first_id,))
    second_run, second_command = str(uuid.uuid4()), str(uuid.uuid4())
    first.connection.execute("""INSERT INTO runway_runs(id,show_id,project_id,user_id,input_snapshot,request_key)
        SELECT %s,show_id,project_id,user_id,input_snapshot,%s FROM runway_runs WHERE id=%s""", (second_run, second_run, environment["run"]))
    first.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (second_command, second_run, second_command))
    second = Repository(environment["settings"])
    try:
        assert second.claim()["id"] == second_command
    finally:
        second.release()
        second.close()
        first.release()


def test_mock_worker_skips_live_run_and_claims_matching_mode(environment):
    repository = environment["repository"]
    live_command = str(uuid.uuid4())
    repository.connection.execute("UPDATE runway_runs SET model_snapshot=%s WHERE id=%s", (Jsonb({"mode": "live"}), environment["run"]))
    repository.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (live_command, environment["run"], live_command))
    mock_run, mock_command = str(uuid.uuid4()), str(uuid.uuid4())
    repository.connection.execute("""INSERT INTO runway_runs(id,show_id,project_id,user_id,input_snapshot,model_snapshot,request_key)
        SELECT %s,show_id,project_id,user_id,input_snapshot,%s,%s FROM runway_runs WHERE id=%s""", (mock_run, Jsonb({"mode": "mock"}), mock_run, environment["run"]))
    repository.connection.execute("INSERT INTO runway_commands(id,run_id,kind,request_key) VALUES(%s,%s,'start',%s)", (mock_command, mock_run, mock_command))
    try:
        claimed = repository.claim()
        assert claimed["id"] == mock_command
        untouched = repository.one("SELECT status,execution_epoch FROM runway_commands WHERE id=%s", (live_command,))
        assert untouched == {"status": "QUEUED", "execution_epoch": 0}
    finally:
        repository.release()
