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

    CREATE TABLE IF NOT EXISTS library_items (
        id                  TEXT PRIMARY KEY,
        user_email          TEXT NOT NULL REFERENCES users(email),
        image_url           TEXT NOT NULL,
        session_id          TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
        generation_prompt   TEXT,
        mode                TEXT NOT NULL DEFAULT 'personal',
        designer_project_id TEXT,
        img_type            TEXT,
        auto_tags           TEXT NOT NULL DEFAULT '{}',
        tag_status          TEXT NOT NULL DEFAULT 'pending',
        user_tags           TEXT NOT NULL DEFAULT '[]',
        is_favorite         INTEGER NOT NULL DEFAULT 0,
        notes               TEXT,
        save_context        TEXT NOT NULL DEFAULT 'auto_save',
        deleted_at          TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_library_user ON library_items(user_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_library_project ON library_items(designer_project_id) WHERE designer_project_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_library_fav ON library_items(user_email, is_favorite) WHERE is_favorite = 1;

    CREATE TABLE IF NOT EXISTS collections (
        id              TEXT PRIMARY KEY,
        user_email      TEXT NOT NULL REFERENCES users(email),
        name            TEXT NOT NULL,
        cover_item_id   TEXT REFERENCES library_items(id) ON DELETE SET NULL,
        is_smart        INTEGER NOT NULL DEFAULT 0,
        smart_rule      TEXT,
        mode            TEXT,
        designer_project_id TEXT,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_items (
        collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        item_id         TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        added_at        TEXT NOT NULL DEFAULT (datetime('now')),
        sort_order      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, item_id)
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


# ─── Library Items ───

def create_library_item(
    item_id: str,
    user_email: str,
    image_url: str,
    session_id: Optional[str],
    generation_prompt: str,
    mode: str,
    designer_project_id: Optional[str],
    img_type: str,
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO library_items
               (id, user_email, image_url, session_id, generation_prompt, mode, designer_project_id, img_type)
               VALUES (?,?,?,?,?,?,?,?)""",
            (item_id, user_email, image_url, session_id, generation_prompt, mode, designer_project_id, img_type),
        )
        conn.commit()


def update_library_item_tags(item_id: str, auto_tags: dict, tag_status: str = "completed") -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE library_items SET auto_tags=?, tag_status=? WHERE id=?",
            (json.dumps(auto_tags, ensure_ascii=False), tag_status, item_id),
        )
        conn.commit()


def patch_library_item(item_id: str, user_email: str, **kwargs) -> Optional[sqlite3.Row]:
    allowed = {"is_favorite", "user_tags", "notes", "save_context"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_library_item(item_id, user_email)
    with _lock:
        conn = _get_conn()
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values())
        # serialize lists to JSON
        for i, k in enumerate(updates):
            if k == "user_tags" and isinstance(vals[i], list):
                vals[i] = json.dumps(vals[i], ensure_ascii=False)
            elif k == "is_favorite":
                vals[i] = 1 if vals[i] else 0
        vals += [item_id, user_email]
        conn.execute(f"UPDATE library_items SET {sets} WHERE id=? AND user_email=?", vals)
        conn.commit()
    return get_library_item(item_id, user_email)


def soft_delete_library_item(item_id: str, user_email: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "UPDATE library_items SET deleted_at=datetime('now') WHERE id=? AND user_email=? AND deleted_at IS NULL",
            (item_id, user_email),
        )
        conn.commit()
        return cur.rowcount > 0


def get_library_item(item_id: str, user_email: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM library_items WHERE id=? AND user_email=? AND deleted_at IS NULL",
            (item_id, user_email),
        ).fetchone()


def list_library_items(
    user_email: str,
    mode: Optional[str] = None,
    designer_project_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    tags: Optional[list] = None,
    page: int = 1,
    limit: int = 30,
) -> tuple[list[sqlite3.Row], int]:
    conditions = ["li.user_email=?", "li.deleted_at IS NULL"]
    params: list = [user_email]

    if mode and mode != "all":
        conditions.append("li.mode=?")
        params.append(mode)
    if designer_project_id:
        conditions.append("li.designer_project_id=?")
        params.append(designer_project_id)
    if is_favorite is True:
        conditions.append("li.is_favorite=1")
    if tags:
        for tag in tags:
            conditions.append("li.auto_tags LIKE ?")
            params.append(f"%{tag}%")

    where = " AND ".join(conditions)

    if collection_id:
        base_sql = f"""
            SELECT li.* FROM library_items li
            JOIN collection_items ci ON ci.item_id = li.id
            WHERE ci.collection_id=? AND {where}
            ORDER BY ci.sort_order ASC, li.created_at DESC
        """
        count_sql = f"""
            SELECT COUNT(*) as c FROM library_items li
            JOIN collection_items ci ON ci.item_id = li.id
            WHERE ci.collection_id=? AND {where}
        """
        count_params = [collection_id] + params
        page_params = [collection_id] + params + [limit, (page - 1) * limit]
    else:
        base_sql = f"SELECT li.* FROM library_items li WHERE {where} ORDER BY li.created_at DESC"
        count_sql = f"SELECT COUNT(*) as c FROM library_items li WHERE {where}"
        count_params = params
        page_params = params + [limit, (page - 1) * limit]

    with _lock:
        conn = _get_conn()
        total = conn.execute(count_sql, count_params).fetchone()["c"]
        rows = conn.execute(base_sql + " LIMIT ? OFFSET ?", page_params).fetchall()
    return rows, total


def count_library_items(user_email: str, mode: Optional[str] = None) -> int:
    with _lock:
        if mode and mode != "all":
            row = _get_conn().execute(
                "SELECT COUNT(*) as c FROM library_items WHERE user_email=? AND mode=? AND deleted_at IS NULL",
                (user_email, mode),
            ).fetchone()
        else:
            row = _get_conn().execute(
                "SELECT COUNT(*) as c FROM library_items WHERE user_email=? AND deleted_at IS NULL",
                (user_email,),
            ).fetchone()
        return row["c"] if row else 0


def get_library_stats(user_email: str) -> dict:
    with _lock:
        conn = _get_conn()
        total = conn.execute(
            "SELECT COUNT(*) as c FROM library_items WHERE user_email=? AND deleted_at IS NULL",
            (user_email,),
        ).fetchone()["c"]
        fav = conn.execute(
            "SELECT COUNT(*) as c FROM library_items WHERE user_email=? AND is_favorite=1 AND deleted_at IS NULL",
            (user_email,),
        ).fetchone()["c"]
        rows = conn.execute(
            "SELECT auto_tags, is_favorite, mode FROM library_items WHERE user_email=? AND deleted_at IS NULL AND tag_status='completed'",
            (user_email,),
        ).fetchall()

    color_freq: dict = {}
    style_freq: dict = {}
    occasion_freq: dict = {}
    silhouette_freq: dict = {}
    mode_dist: dict = {"personal": 0, "designer": 0}

    for row in rows:
        w = 3 if row["is_favorite"] else 1
        mode_dist[row["mode"]] = mode_dist.get(row["mode"], 0) + 1
        try:
            tags = json.loads(row["auto_tags"] or "{}")
        except Exception:
            continue
        for c in tags.get("colors", []):
            color_freq[c] = color_freq.get(c, 0) + w
        for s in tags.get("style_keywords", []):
            style_freq[s] = style_freq.get(s, 0) + w
        for o in tags.get("occasions", []):
            occasion_freq[o] = occasion_freq.get(o, 0) + w
        sil = tags.get("silhouette")
        if sil:
            silhouette_freq[sil] = silhouette_freq.get(sil, 0) + w

    def top(d: dict, n: int = 5):
        return [{"name": k, "count": v} for k, v in sorted(d.items(), key=lambda x: -x[1])[:n]]

    return {
        "total_count": total,
        "favorite_count": fav,
        "top_colors": top(color_freq),
        "top_styles": top(style_freq),
        "top_occasions": top(occasion_freq),
        "top_silhouettes": top(silhouette_freq),
        "mode_distribution": mode_dist,
    }


# ─── Collections ───

def create_collection(
    col_id: str,
    user_email: str,
    name: str,
    is_smart: bool = False,
    smart_rule: Optional[str] = None,
    mode: Optional[str] = None,
    designer_project_id: Optional[str] = None,
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO collections (id, user_email, name, is_smart, smart_rule, mode, designer_project_id)
               VALUES (?,?,?,?,?,?,?)""",
            (col_id, user_email, name, 1 if is_smart else 0, smart_rule, mode, designer_project_id),
        )
        conn.commit()


def list_collections(user_email: str) -> list[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM collections WHERE user_email=? ORDER BY sort_order ASC, created_at ASC",
            (user_email,),
        ).fetchall()


def get_collection(col_id: str, user_email: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM collections WHERE id=? AND user_email=?",
            (col_id, user_email),
        ).fetchone()


def patch_collection(col_id: str, user_email: str, **kwargs) -> Optional[sqlite3.Row]:
    allowed = {"name", "cover_item_id", "sort_order"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_collection(col_id, user_email)
    with _lock:
        conn = _get_conn()
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values()) + [col_id, user_email]
        conn.execute(f"UPDATE collections SET {sets} WHERE id=? AND user_email=?", vals)
        conn.commit()
    return get_collection(col_id, user_email)


def delete_collection(col_id: str, user_email: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "DELETE FROM collections WHERE id=? AND user_email=?",
            (col_id, user_email),
        )
        conn.commit()
        return cur.rowcount > 0


def add_items_to_collection(col_id: str, item_ids: list) -> None:
    with _lock:
        conn = _get_conn()
        conn.executemany(
            "INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?,?)",
            [(col_id, iid) for iid in item_ids],
        )
        conn.commit()


def remove_item_from_collection(col_id: str, item_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "DELETE FROM collection_items WHERE collection_id=? AND item_id=?",
            (col_id, item_id),
        )
        conn.commit()
        return cur.rowcount > 0


def get_collection_item_count(col_id: str) -> int:
    with _lock:
        row = _get_conn().execute(
            "SELECT COUNT(*) as c FROM collection_items WHERE collection_id=?",
            (col_id,),
        ).fetchone()
        return row["c"] if row else 0


def get_collection_cover(col_id: str) -> Optional[str]:
    """Return cover image_url: explicit cover first, then first item."""
    with _lock:
        conn = _get_conn()
        col = conn.execute("SELECT cover_item_id FROM collections WHERE id=?", (col_id,)).fetchone()
        if not col:
            return None
        if col["cover_item_id"]:
            item = conn.execute(
                "SELECT image_url FROM library_items WHERE id=? AND deleted_at IS NULL",
                (col["cover_item_id"],),
            ).fetchone()
            if item:
                return item["image_url"]
        # fallback: first item in collection
        item = conn.execute(
            """SELECT li.image_url FROM library_items li
               JOIN collection_items ci ON ci.item_id=li.id
               WHERE ci.collection_id=? AND li.deleted_at IS NULL
               ORDER BY ci.added_at ASC LIMIT 1""",
            (col_id,),
        ).fetchone()
        return item["image_url"] if item else None
