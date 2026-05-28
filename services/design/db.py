"""
SQLite persistence for user profiles.
All JSON fields are stored as TEXT (SQLite has no native JSONB).
Thread-safe via threading.Lock + check_same_thread=False.
"""
import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "data" / "profiles.db"
DB_PATH.parent.mkdir(exist_ok=True)

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _migrate(_conn)
    return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        email           TEXT PRIMARY KEY,
        name            TEXT NOT NULL DEFAULT '',
        password_hash   TEXT NOT NULL DEFAULT '',
        auth_token      TEXT UNIQUE,
        personal_profile TEXT NOT NULL DEFAULT '{}',
        designer_workspace TEXT NOT NULL DEFAULT '{"projects":[]}',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
        id                  TEXT PRIMARY KEY,
        user_email          TEXT NOT NULL REFERENCES users(email),
        mode                TEXT NOT NULL DEFAULT 'personal',
        designer_project_id TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)
    conn.commit()


# ─── Auth ───

def upsert_user(email: str, name: str, password_hash: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO users (email, name, password_hash) VALUES (?,?,?)",
            (email, name, password_hash),
        )
        conn.commit()


def get_user_by_email(email: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM users WHERE email=?", (email,)
        ).fetchone()


def get_user_by_token(token: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM users WHERE auth_token=?", (token,)
        ).fetchone()


def set_auth_token(email: str, token: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("UPDATE users SET auth_token=? WHERE email=?", (token, email))
        conn.commit()


def revoke_token(token: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("UPDATE users SET auth_token=NULL WHERE auth_token=?", (token,))
        conn.commit()


# ─── Personal Profile ───

def get_personal_profile(email: str) -> dict:
    with _lock:
        row = _get_conn().execute(
            "SELECT personal_profile FROM users WHERE email=?", (email,)
        ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row["personal_profile"]) or {}
        except Exception:
            return {}


def save_personal_profile(email: str, profile: dict) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE users SET personal_profile=? WHERE email=?",
            (json.dumps(profile, ensure_ascii=False), email),
        )
        conn.commit()


# ─── Designer Workspace ───

def get_designer_workspace(email: str) -> dict:
    with _lock:
        row = _get_conn().execute(
            "SELECT designer_workspace FROM users WHERE email=?", (email,)
        ).fetchone()
        if not row:
            return {"projects": []}
        try:
            return json.loads(row["designer_workspace"]) or {"projects": []}
        except Exception:
            return {"projects": []}


def save_designer_workspace(email: str, workspace: dict) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE users SET designer_workspace=? WHERE email=?",
            (json.dumps(workspace, ensure_ascii=False), email),
        )
        conn.commit()


# ─── Chat Sessions ───

def create_chat_session(
    session_id: str, user_email: str, mode: str, designer_project_id: Optional[str]
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO chat_sessions (id, user_email, mode, designer_project_id) VALUES (?,?,?,?)",
            (session_id, user_email, mode, designer_project_id),
        )
        conn.commit()


def get_chat_session(session_id: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM chat_sessions WHERE id=?", (session_id,)
        ).fetchone()


def count_user_sessions(user_email: str, mode: str, project_id: Optional[str] = None) -> int:
    with _lock:
        if project_id:
            row = _get_conn().execute(
                "SELECT COUNT(*) as c FROM chat_sessions WHERE user_email=? AND mode=? AND designer_project_id=?",
                (user_email, mode, project_id),
            ).fetchone()
        else:
            row = _get_conn().execute(
                "SELECT COUNT(*) as c FROM chat_sessions WHERE user_email=? AND mode=?",
                (user_email, mode),
            ).fetchone()
        return row["c"] if row else 0
