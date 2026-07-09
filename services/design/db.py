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
        _conn.execute("PRAGMA foreign_keys=ON")
        _migrate(_conn)
    return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        email           TEXT PRIMARY KEY,
        name            TEXT NOT NULL DEFAULT '',
        password_hash   TEXT NOT NULL DEFAULT '',
        personal_profile TEXT NOT NULL DEFAULT '{}',
        designer_workspace TEXT NOT NULL DEFAULT '{"projects":[]}',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
        id              TEXT PRIMARY KEY,
        user_email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        token_hash      TEXT NOT NULL UNIQUE,
        created_at      TEXT NOT NULL,
        last_seen_at    TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        revoked_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
        ON auth_sessions(user_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
        ON auth_sessions(expires_at, revoked_at);

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

    CREATE TABLE IF NOT EXISTS trends (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        name_zh         TEXT,
        season          TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        cover_image     TEXT,
        image_gallery   TEXT NOT NULL DEFAULT '[]',
        keywords        TEXT NOT NULL DEFAULT '[]',
        description     TEXT,
        color_palette   TEXT NOT NULL DEFAULT '[]',
        design_language TEXT NOT NULL DEFAULT '{}',
        style_tags      TEXT NOT NULL DEFAULT '[]',
        occasion_tags   TEXT NOT NULL DEFAULT '[]',
        sort_order      INTEGER NOT NULL DEFAULT 0,
        source_report_id TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trends_season ON trends(season, status);

    CREATE TABLE IF NOT EXISTS user_trend_favorites (
        user_email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        trend_id        TEXT NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_email, trend_id)
    );

    CREATE TABLE IF NOT EXISTS wardrobe_items (
        id              TEXT PRIMARY KEY,
        user_email      TEXT NOT NULL REFERENCES users(email),
        name            TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL DEFAULT 'uncategorized',
        sub_category    TEXT,
        colors          TEXT NOT NULL DEFAULT '[]',
        style_tags      TEXT NOT NULL DEFAULT '[]',
        season          TEXT,
        fabric          TEXT,
        image_url       TEXT NOT NULL,
        thumbnail_url   TEXT,
        source_type     TEXT NOT NULL DEFAULT 'upload',
        source_label    TEXT NOT NULL DEFAULT '我的上传',
        source_ref      TEXT,
        source_image_url TEXT,
        ai_analysis     TEXT NOT NULL DEFAULT '{}',
        ai_status       TEXT NOT NULL DEFAULT 'pending',
        notes           TEXT,
        favorite        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wardrobe_user ON wardrobe_items(user_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wardrobe_category ON wardrobe_items(user_email, category);
    CREATE INDEX IF NOT EXISTS idx_wardrobe_source ON wardrobe_items(user_email, source_type);

    CREATE TABLE IF NOT EXISTS outfits (
        id              TEXT PRIMARY KEY,
        user_email      TEXT NOT NULL REFERENCES users(email),
        name            TEXT NOT NULL DEFAULT '',
        description     TEXT,
        occasion        TEXT,
        season          TEXT,
        style           TEXT,
        cover_image_url TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outfits_user ON outfits(user_email, created_at DESC);

    CREATE TABLE IF NOT EXISTS outfit_items (
        outfit_id           TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
        wardrobe_item_id    TEXT NOT NULL REFERENCES wardrobe_items(id) ON DELETE CASCADE,
        layer_order         INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (outfit_id, wardrobe_item_id)
    );
    """)
    conn.commit()
    _migrate_incremental(conn)


def _migrate_incremental(conn: sqlite3.Connection) -> None:
    """Add columns to existing tables without recreating them."""
    def existing_cols(table: str) -> set:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    li_cols = existing_cols("library_items")
    if "trend_alignments" not in li_cols:
        conn.execute("ALTER TABLE library_items ADD COLUMN trend_alignments TEXT NOT NULL DEFAULT '[]'")

    cs_cols = existing_cols("chat_sessions")
    if "trend_id" not in cs_cols:
        conn.execute("ALTER TABLE chat_sessions ADD COLUMN trend_id TEXT")
    if "trend_enabled" not in cs_cols:
        conn.execute("ALTER TABLE chat_sessions ADD COLUMN trend_enabled INTEGER NOT NULL DEFAULT 0")

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


def create_auth_session(
    session_id: str,
    user_email: str,
    token_hash: str,
    created_at: str,
    expires_at: str,
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """
            INSERT INTO auth_sessions (
                id, user_email, token_hash, created_at, last_seen_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, user_email, token_hash, created_at, created_at, expires_at),
        )
        conn.commit()


def get_user_by_session(
    token_hash: str,
    now_iso: str,
    idle_cutoff_iso: str,
) -> Optional[sqlite3.Row]:
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            """
            SELECT
                u.*,
                s.id AS auth_session_id,
                s.created_at AS auth_created_at,
                s.last_seen_at AS auth_last_seen_at,
                s.expires_at AS auth_expires_at
            FROM auth_sessions s
            JOIN users u ON u.email = s.user_email
            WHERE s.token_hash = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > ?
              AND s.last_seen_at > ?
            """,
            (token_hash, now_iso, idle_cutoff_iso),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE auth_sessions SET last_seen_at=? WHERE id=?",
            (now_iso, row["auth_session_id"]),
        )
        conn.commit()
        return row


def revoke_auth_session(token_hash: str, revoked_at: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """
            UPDATE auth_sessions
            SET revoked_at=?
            WHERE token_hash=? AND revoked_at IS NULL
            """,
            (revoked_at, token_hash),
        )
        conn.commit()


def revoke_all_auth_sessions(user_email: str, revoked_at: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """
            UPDATE auth_sessions
            SET revoked_at=?
            WHERE user_email=? AND revoked_at IS NULL
            """,
            (revoked_at, user_email),
        )
        conn.commit()


def delete_expired_auth_sessions(now_iso: str) -> int:
    with _lock:
        conn = _get_conn()
        cursor = conn.execute(
            "DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
            (now_iso,),
        )
        conn.commit()
        return cursor.rowcount


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


# ─── Trends ───

def upsert_trend(
    trend_id: str,
    name: str,
    name_zh: str,
    season: str,
    cover_image: str,
    image_gallery: list,
    keywords: list,
    description: str,
    color_palette: list,
    design_language: dict,
    style_tags: list,
    occasion_tags: list,
    source_report_id: str = "",
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO trends
               (id, name, name_zh, season, cover_image, image_gallery, keywords, description,
                color_palette, design_language, style_tags, occasion_tags, source_report_id, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
               ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, name_zh=excluded.name_zh, season=excluded.season,
               cover_image=excluded.cover_image, image_gallery=excluded.image_gallery,
               keywords=excluded.keywords, description=excluded.description,
               color_palette=excluded.color_palette, design_language=excluded.design_language,
               style_tags=excluded.style_tags, occasion_tags=excluded.occasion_tags,
               source_report_id=excluded.source_report_id, updated_at=datetime('now')""",
            (
                trend_id, name, name_zh, season, cover_image,
                json.dumps(image_gallery, ensure_ascii=False),
                json.dumps(keywords, ensure_ascii=False),
                description,
                json.dumps(color_palette, ensure_ascii=False),
                json.dumps(design_language, ensure_ascii=False),
                json.dumps(style_tags, ensure_ascii=False),
                json.dumps(occasion_tags, ensure_ascii=False),
                source_report_id,
            ),
        )
        conn.commit()


def list_trends(season: Optional[str] = None, status: str = "active") -> list[sqlite3.Row]:
    with _lock:
        if season:
            return _get_conn().execute(
                "SELECT * FROM trends WHERE status=? AND season=? ORDER BY sort_order ASC, updated_at DESC",
                (status, season),
            ).fetchall()
        return _get_conn().execute(
            "SELECT * FROM trends WHERE status=? ORDER BY sort_order ASC, updated_at DESC",
            (status,),
        ).fetchall()


def get_trend(trend_id: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute("SELECT * FROM trends WHERE id=?", (trend_id,)).fetchone()


def get_latest_trend_season() -> Optional[str]:
    with _lock:
        row = _get_conn().execute(
            "SELECT season FROM trends WHERE status='active' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        return row["season"] if row else None


def add_trend_favorite(user_email: str, trend_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO user_trend_favorites (user_email, trend_id) VALUES (?,?)",
            (user_email, trend_id),
        )
        conn.commit()


def remove_trend_favorite(user_email: str, trend_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "DELETE FROM user_trend_favorites WHERE user_email=? AND trend_id=?",
            (user_email, trend_id),
        )
        conn.commit()


def get_trend_favorite_ids(user_email: str) -> set:
    with _lock:
        rows = _get_conn().execute(
            "SELECT trend_id FROM user_trend_favorites WHERE user_email=?", (user_email,)
        ).fetchall()
        return {r["trend_id"] for r in rows}


def update_session_trend(session_id: str, trend_id: Optional[str], trend_enabled: bool) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE chat_sessions SET trend_id=?, trend_enabled=? WHERE id=?",
            (trend_id, 1 if trend_enabled else 0, session_id),
        )
        conn.commit()


def update_library_item_trend_alignments(item_id: str, alignments: list) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE library_items SET trend_alignments=? WHERE id=?",
            (json.dumps(alignments, ensure_ascii=False), item_id),
        )
        conn.commit()


# ─── Wardrobe Items ───

_SOURCE_LABELS = {
    "trend": "时尚趋势",
    "design": "我的设计",
    "upload": "我的上传",
    "preset": "系统衣物",
    "tryon": "试衣台",
}


def create_wardrobe_item(
    item_id: str,
    user_email: str,
    image_url: str,
    source_type: str = "upload",
    source_ref: Optional[str] = None,
    source_image_url: Optional[str] = None,
    name: str = "",
    category: str = "uncategorized",
) -> None:
    label = _SOURCE_LABELS.get(source_type, "我的上传")
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO wardrobe_items
               (id, user_email, image_url, source_type, source_label, source_ref, source_image_url, name, category)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (item_id, user_email, image_url, source_type, label, source_ref, source_image_url, name, category),
        )
        conn.commit()


def update_wardrobe_item_ai(item_id: str, ai_result: dict, status: str = "completed") -> None:
    with _lock:
        conn = _get_conn()
        updates = ["ai_analysis=?", "ai_status=?", "updated_at=datetime('now')"]
        params: list = [json.dumps(ai_result, ensure_ascii=False), status]
        if ai_result.get("name"):
            updates.append("name=?")
            params.append(ai_result["name"])
        if ai_result.get("category"):
            updates.append("category=?")
            params.append(ai_result["category"])
        if ai_result.get("sub_category"):
            updates.append("sub_category=?")
            params.append(ai_result["sub_category"])
        if ai_result.get("colors"):
            updates.append("colors=?")
            params.append(json.dumps(ai_result["colors"], ensure_ascii=False))
        if ai_result.get("style_tags"):
            updates.append("style_tags=?")
            params.append(json.dumps(ai_result["style_tags"], ensure_ascii=False))
        if ai_result.get("season"):
            updates.append("season=?")
            params.append(ai_result["season"])
        if ai_result.get("fabric"):
            updates.append("fabric=?")
            params.append(ai_result["fabric"])
        params.append(item_id)
        conn.execute(f"UPDATE wardrobe_items SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()


def patch_wardrobe_item(item_id: str, user_email: str, **kwargs) -> Optional[sqlite3.Row]:
    allowed = {"name", "category", "sub_category", "colors", "style_tags", "season", "fabric", "notes", "favorite"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_wardrobe_item(item_id, user_email)
    with _lock:
        conn = _get_conn()
        sets = []
        vals: list = []
        for k, v in updates.items():
            sets.append(f"{k}=?")
            if k in ("colors", "style_tags") and isinstance(v, list):
                vals.append(json.dumps(v, ensure_ascii=False))
            elif k == "favorite":
                vals.append(1 if v else 0)
            else:
                vals.append(v)
        sets.append("updated_at=datetime('now')")
        vals += [item_id, user_email]
        conn.execute(f"UPDATE wardrobe_items SET {', '.join(sets)} WHERE id=? AND user_email=?", vals)
        conn.commit()
    return get_wardrobe_item(item_id, user_email)


def delete_wardrobe_item(item_id: str, user_email: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM wardrobe_items WHERE id=? AND user_email=?", (item_id, user_email))
        conn.commit()
        return cur.rowcount > 0


def delete_wardrobe_items_batch(item_ids: list, user_email: str) -> int:
    if not item_ids:
        return 0
    with _lock:
        conn = _get_conn()
        placeholders = ",".join("?" * len(item_ids))
        cur = conn.execute(
            f"DELETE FROM wardrobe_items WHERE id IN ({placeholders}) AND user_email=?",
            item_ids + [user_email],
        )
        conn.commit()
        return cur.rowcount


def get_wardrobe_item(item_id: str, user_email: str) -> Optional[sqlite3.Row]:
    with _lock:
        return _get_conn().execute(
            "SELECT * FROM wardrobe_items WHERE id=? AND user_email=?", (item_id, user_email)
        ).fetchone()


def list_wardrobe_items(
    user_email: str,
    category: Optional[str] = None,
    source_type: Optional[str] = None,
    season: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
) -> tuple[list[sqlite3.Row], int]:
    conditions = ["user_email=?"]
    params: list = [user_email]
    if category and category != "all":
        conditions.append("category=?")
        params.append(category)
    if source_type:
        conditions.append("source_type=?")
        params.append(source_type)
    if season:
        conditions.append("season=?")
        params.append(season)
    if search:
        conditions.append("(name LIKE ? OR style_tags LIKE ? OR notes LIKE ?)")
        q = f"%{search}%"
        params.extend([q, q, q])
    where = " AND ".join(conditions)
    with _lock:
        conn = _get_conn()
        total = conn.execute(f"SELECT COUNT(*) as c FROM wardrobe_items WHERE {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"SELECT * FROM wardrobe_items WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, (page - 1) * limit],
        ).fetchall()
    return rows, total


def get_wardrobe_stats(user_email: str) -> dict:
    with _lock:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) as c FROM wardrobe_items WHERE user_email=?", (user_email,)).fetchone()["c"]
        cats = conn.execute(
            "SELECT category, COUNT(*) as c FROM wardrobe_items WHERE user_email=? GROUP BY category", (user_email,)
        ).fetchall()
        sources = conn.execute(
            "SELECT source_type, COUNT(*) as c FROM wardrobe_items WHERE user_email=? GROUP BY source_type", (user_email,)
        ).fetchall()
    return {
        "total": total,
        "by_category": {r["category"]: r["c"] for r in cats},
        "by_source": {r["source_type"]: r["c"] for r in sources},
    }


# ─── Outfits ───

def create_outfit(outfit_id: str, user_email: str, name: str, item_ids: list, **kwargs) -> None:
    cover_override = kwargs.get("cover_image_url")
    with _lock:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO outfits (id, user_email, name, description, occasion, season, style)
               VALUES (?,?,?,?,?,?,?)""",
            (outfit_id, user_email, name, kwargs.get("description"), kwargs.get("occasion"),
             kwargs.get("season"), kwargs.get("style")),
        )
        for i, iid in enumerate(item_ids):
            conn.execute(
                "INSERT OR IGNORE INTO outfit_items (outfit_id, wardrobe_item_id, layer_order) VALUES (?,?,?)",
                (outfit_id, iid, i),
            )
        if cover_override:
            conn.execute("UPDATE outfits SET cover_image_url=? WHERE id=?", (cover_override, outfit_id))
        elif item_ids:
            first = conn.execute("SELECT image_url FROM wardrobe_items WHERE id=?", (item_ids[0],)).fetchone()
            if first:
                conn.execute("UPDATE outfits SET cover_image_url=? WHERE id=?", (first["image_url"], outfit_id))
        conn.commit()


def list_outfits(user_email: str, occasion: Optional[str] = None, season: Optional[str] = None) -> list[dict]:
    conditions = ["o.user_email=?"]
    params: list = [user_email]
    if occasion:
        conditions.append("o.occasion=?")
        params.append(occasion)
    if season:
        conditions.append("o.season=?")
        params.append(season)
    where = " AND ".join(conditions)
    with _lock:
        conn = _get_conn()
        rows = conn.execute(f"SELECT * FROM outfits o WHERE {where} ORDER BY o.created_at DESC", params).fetchall()
        result = []
        for r in rows:
            items = conn.execute(
                """SELECT wi.* FROM wardrobe_items wi
                   JOIN outfit_items oi ON oi.wardrobe_item_id = wi.id
                   WHERE oi.outfit_id=? ORDER BY oi.layer_order""",
                (r["id"],),
            ).fetchall()
            result.append({**dict(r), "items": [dict(i) for i in items]})
    return result


def get_outfit(outfit_id: str, user_email: str) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM outfits WHERE id=? AND user_email=?", (outfit_id, user_email)).fetchone()
        if not row:
            return None
        items = conn.execute(
            """SELECT wi.* FROM wardrobe_items wi
               JOIN outfit_items oi ON oi.wardrobe_item_id = wi.id
               WHERE oi.outfit_id=? ORDER BY oi.layer_order""",
            (outfit_id,),
        ).fetchall()
        return {**dict(row), "items": [dict(i) for i in items]}


def patch_outfit(outfit_id: str, user_email: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "description", "occasion", "season", "style"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_outfit(outfit_id, user_email)
    with _lock:
        conn = _get_conn()
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values()) + [outfit_id, user_email]
        conn.execute(f"UPDATE outfits SET {sets}, updated_at=datetime('now') WHERE id=? AND user_email=?", vals)
        conn.commit()
    return get_outfit(outfit_id, user_email)


def delete_outfit(outfit_id: str, user_email: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM outfits WHERE id=? AND user_email=?", (outfit_id, user_email))
        conn.commit()
        return cur.rowcount > 0


def add_outfit_item(outfit_id: str, wardrobe_item_id: str, layer_order: int = 0) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO outfit_items (outfit_id, wardrobe_item_id, layer_order) VALUES (?,?,?)",
            (outfit_id, wardrobe_item_id, layer_order),
        )
        conn.commit()


def remove_outfit_item(outfit_id: str, wardrobe_item_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "DELETE FROM outfit_items WHERE outfit_id=? AND wardrobe_item_id=?",
            (outfit_id, wardrobe_item_id),
        )
        conn.commit()
        return cur.rowcount > 0
