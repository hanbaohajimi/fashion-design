from contextlib import contextmanager
from types import SimpleNamespace

from fashion_runway.config import Settings
from fashion_runway.worker import execute_command


def test_checkpoint_failure_after_terminal_business_commit_keeps_worker_alive(monkeypatch):
    class Repository:
        command = {"id": "command", "kind": "start", "payload": {}}

        def check(self):
            return {"id": "run", "model_snapshot": {"mode": "mock"}}

        def one(self, *_):
            return {"status": "SUCCEEDED"}

        def fail(self, *_args, **_kwargs):
            raise AssertionError("completed business state must not be failed again")

    @contextmanager
    def saver(_settings):
        yield None

    class Graph:
        def get_state(self, _config):
            return SimpleNamespace(values={})

        def invoke(self, *_):
            raise RuntimeError("checkpoint write failed after committed wait")

    monkeypatch.setattr("fashion_runway.worker.saver", saver)
    monkeypatch.setattr("fashion_runway.worker.build_graph", lambda *_: Graph())
    execute_command(Repository(), Settings.from_env())
