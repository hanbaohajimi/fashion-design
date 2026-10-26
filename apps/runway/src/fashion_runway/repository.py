"""The platform migration owns all business tables; this worker only consumes them."""

import uuid
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import Settings


class LostLease(RuntimeError):
    pass


class ExecutionStopped(RuntimeError):
    pass


class Repository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.connection = psycopg.connect(settings.database_url, autocommit=True, row_factory=dict_row)
        self.command = None

    def close(self):
        self.connection.close()

    def one(self, query, parameters=()):
        return self.connection.execute(query, parameters).fetchone()

    def claim(self):
        with self.connection.transaction():
            candidates = self.connection.execute("""SELECT c.* FROM runway_commands c
                JOIN runway_runs r ON r.id=c.run_id
                WHERE (c.status='QUEUED' OR (c.status='RUNNING' AND c.lease_until < CURRENT_TIMESTAMP))
                AND COALESCE(r.model_snapshot->>'mode',%s)=%s
                ORDER BY c.created_at FOR UPDATE OF c SKIP LOCKED LIMIT 32""",
                (self.settings.mode, self.settings.mode)).fetchall()
            for candidate in candidates:
                locked = self.one("SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS locked", (candidate["run_id"],))["locked"]
                if not locked:
                    continue
                command = self.one("""UPDATE runway_commands SET status='RUNNING', lease_owner=%s,
                    lease_until=CURRENT_TIMESTAMP + interval '60 seconds', execution_epoch=execution_epoch+1,
                    updated_at=CURRENT_TIMESTAMP WHERE id=%s RETURNING *""", (self.settings.worker_id, candidate["id"]))
                self.command = command
                return command
        return None

    def release(self):
        if self.command:
            self.connection.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (self.command["run_id"],))
            self.command = None

    def heartbeat(self):
        with psycopg.connect(self.settings.database_url, autocommit=True) as connection:
            connection.execute("""INSERT INTO runway_worker_heartbeats(id,mode,capabilities,updated_at) VALUES(%s,%s,%s,CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode,capabilities=EXCLUDED.capabilities,updated_at=CURRENT_TIMESTAMP""",
                               (self.settings.worker_id, self.settings.mode, Jsonb(self.settings.capabilities())))
            if self.command:
                connection.execute("""UPDATE runway_commands SET lease_until=CURRENT_TIMESTAMP+interval '60 seconds',updated_at=CURRENT_TIMESTAMP
                    WHERE id=%s AND status='RUNNING' AND lease_owner=%s AND execution_epoch=%s""",
                                   (self.command["id"], self.settings.worker_id, self.command["execution_epoch"]))

    def run(self, run_id: str):
        run = self.one("SELECT * FROM runway_runs WHERE id=%s", (run_id,))
        if not run:
            raise ExecutionStopped("RUN_NOT_FOUND")
        return run

    def check(self):
        command = self.command
        if not command:
            raise LostLease("NO_COMMAND_LEASE")
        valid = self.one("""SELECT id FROM runway_commands WHERE id=%s AND status='RUNNING'
            AND lease_owner=%s AND execution_epoch=%s AND lease_until>CURRENT_TIMESTAMP""",
                         (command["id"], self.settings.worker_id, command["execution_epoch"]))
        if not valid:
            raise LostLease("COMMAND_LEASE_LOST")
        run = self.run(command["run_id"])
        if run["cancel_requested_at"] or run["status"] == "CANCELED":
            raise ExecutionStopped("CANCEL_REQUESTED")
        actor = command["payload"].get("actorUserId", run["user_id"])
        allowed = self.one("""SELECT p.id FROM projects p JOIN workspaces w ON p.ws_id=w.id
            JOIN users u ON u.id=%s AND u.deleted_at IS NULL
            JOIN runway_shows s ON s.id=%s AND s.archived=false
            WHERE p.id=%s AND p.deleted_at IS NULL AND p.archived=false
            AND (w.owner_id=%s OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id
                AND m.user_id=%s AND m.role IN ('OWNER','EDITOR')))""",
                           (actor, run["show_id"], run["project_id"], actor, actor))
        if not allowed:
            raise ExecutionStopped("PROJECT_ACCESS_REVOKED")
        return run

    @contextmanager
    def fenced(self):
        with self.connection.transaction():
            row = self.one("""SELECT id FROM runway_commands WHERE id=%s AND status='RUNNING'
                AND lease_owner=%s AND execution_epoch=%s AND lease_until>CURRENT_TIMESTAMP FOR UPDATE""",
                           (self.command["id"], self.settings.worker_id, self.command["execution_epoch"]))
            if not row:
                raise LostLease("COMMAND_LEASE_LOST")
            yield

    def event(self, run_id: str, event_type: str, data: dict):
        sequence = self.one("UPDATE runway_runs SET event_sequence=event_sequence+1 WHERE id=%s RETURNING event_sequence", (run_id,))["event_sequence"]
        self.connection.execute("INSERT INTO runway_events(id,run_id,sequence,type,data) VALUES(%s,%s,%s,%s,%s)",
                                (str(uuid.uuid4()), run_id, sequence, event_type, Jsonb(data)))

    def update_run(self, run_id: str, *, status: str, stage: str, state: dict, pending=None):
        with self.fenced():
            cursor = self.connection.execute("""UPDATE runway_runs SET status=%s,stage=%s,state=%s,pending_input=%s,
                version=version+1,updated_at=CURRENT_TIMESTAMP,
                finished_at=CASE WHEN %s IN ('SUCCEEDED','CANCELED') THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE id=%s AND cancel_requested_at IS NULL""", (status, stage, Jsonb(state), Jsonb(pending) if pending else None, status, run_id))
            if cursor.rowcount != 1:
                raise ExecutionStopped("CANCEL_REQUESTED")
            self.event(run_id, "state", {"status": status, "stage": stage, "pendingInput": pending})
            if status in {"WAITING_INPUT", "SUCCEEDED"}:
                # Expose the human action and release the active-command constraint together.
                # The advisory session lock remains held until graph checkpointing finishes.
                self.connection.execute("""UPDATE runway_commands SET status='SUCCEEDED',completed_at=CURRENT_TIMESTAMP,
                    lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=%s""", (self.command["id"],))

    def finish_command(self, status="SUCCEEDED", error_code=None):
        existing = self.one("SELECT status FROM runway_commands WHERE id=%s", (self.command["id"],))
        if existing and existing["status"] == "SUCCEEDED":
            return
        with self.fenced():
            self.connection.execute("""UPDATE runway_commands SET status=%s,error_code=%s,completed_at=CURRENT_TIMESTAMP,
                lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=%s""", (status, error_code, self.command["id"]))

    def fail(self, error_code: str, attention=False, canceled=False):
        with self.fenced():
            status = "CANCELED" if canceled else "NEEDS_ATTENTION" if attention else "FAILED"
            self.connection.execute("""UPDATE runway_runs SET status=%s,version=version+1,updated_at=CURRENT_TIMESTAMP,
                state=jsonb_set(state,'{errorCode}',to_jsonb(%s::text)),
                finished_at=CASE WHEN %s='CANCELED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=%s""", (status, error_code, status, self.command["run_id"]))
            self.event(self.command["run_id"], "error", {"status": status, "code": error_code})
            self.connection.execute("""UPDATE runway_commands SET status=%s,error_code=%s,completed_at=CURRENT_TIMESTAMP,
                lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=%s""", ("CANCELED" if canceled else "FAILED", error_code, self.command["id"]))

    def attempt(self, run_id: str, key: str):
        return self.one("SELECT * FROM runway_step_attempts WHERE run_id=%s AND operation_key=%s", (run_id, key))

    def begin_attempt(self, run_id: str, key: str, stage: str, provider: str, inputs: dict):
        with self.fenced():
            self.connection.execute("""INSERT INTO runway_step_attempts(id,run_id,operation_key,stage,status,provider,input,execution_epoch)
                VALUES(%s,%s,%s,%s,'RUNNING',%s,%s,%s) ON CONFLICT(run_id,operation_key) DO NOTHING""",
                                    (str(uuid.uuid4()), run_id, key, stage, provider, Jsonb(inputs), self.command["execution_epoch"]))
        return self.attempt(run_id, key)

    def update_attempt(self, attempt_id: str, **values):
        allowed = {"status", "provider_job_id", "provider_data", "output_media_ids", "error_code"}
        if not values.keys() <= allowed:
            raise ValueError("INVALID_ATTEMPT_UPDATE")
        from psycopg import sql
        fields = [sql.SQL("{}=%s").format(sql.Identifier(key)) for key in values]
        parameters = [Jsonb(value) if key == "provider_data" else value for key, value in values.items()]
        with self.fenced():
            self.connection.execute(sql.SQL("UPDATE runway_step_attempts SET {},updated_at=CURRENT_TIMESTAMP WHERE id=%s").format(sql.SQL(",").join(fields)), (*parameters, attempt_id))

    def media(self, media_id: str):
        item = self.one("SELECT * FROM runway_media WHERE id=%s AND run_id=%s", (media_id, self.command["run_id"]))
        if not item:
            raise ValueError("MEDIA_NOT_IN_RUN")
        return item

    def save_media(self, record: dict):
        from psycopg import sql
        fields = list(record)
        with self.fenced():
            self.connection.execute(sql.SQL("INSERT INTO runway_media ({}) VALUES ({}) ON CONFLICT(id) DO NOTHING").format(
                sql.SQL(",").join(map(sql.Identifier, fields)), sql.SQL(",").join(sql.Placeholder() for _ in fields)),
                [Jsonb(record[key]) if key == "source" else record[key] for key in fields])

    def save_media_and_complete(self, record: dict, attempt_id: str):
        """Metadata and operation completion commit together after the object is durable."""
        with self.fenced():
            self.save_media(record)
            self.connection.execute("""UPDATE runway_step_attempts SET status='SUCCEEDED',output_media_ids=%s,
                updated_at=CURRENT_TIMESTAMP WHERE id=%s""", ([record["id"]], attempt_id))
