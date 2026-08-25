import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(
    os.environ.get("SERMON_DB_PATH", ROOT / "data" / "sermon-register.db")
)
UPLOADS_PATH = Path(
    os.environ.get("SERMON_UPLOADS_PATH", DB_PATH.parent / "uploads")
)
SCHEMA_PATH = ROOT / "database" / "schema.sql"
APP_ORIGIN = os.environ.get("APP_ORIGIN", "http://localhost:3000")
API_HOST = os.environ.get("API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("API_PORT", "3001"))
MAX_PDF_BYTES = 25 * 1024 * 1024
APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "America/Los_Angeles")
try:
    LOCAL_TIMEZONE = ZoneInfo(APP_TIMEZONE)
except ZoneInfoNotFoundError:
    LOCAL_TIMEZONE = datetime.now().astimezone().tzinfo or timezone.utc
try:
    APP_VERSION = os.environ.get("APP_VERSION") or json.loads(
        (ROOT / "package.json").read_text(encoding="utf-8")
    )["version"]
except (OSError, KeyError, json.JSONDecodeError):
    APP_VERSION = "unknown"

BACKUP_TEMP_PATH = DB_PATH.parent / "backups" / ".temporary"
BACKUP_HISTORY_KEY = "backup_history_v1"
LAST_SUCCESSFUL_BACKUP_KEY = "last_successful_backup_v1"
BACKUP_FORMAT_VERSION = 1
BACKUP_JOB_TTL_SECONDS = 60 * 60
DATA_WRITE_LOCK = threading.RLock()
BACKUP_JOBS_LOCK = threading.Lock()
BACKUP_JOBS = {}


SERVICES_V2_SQL = """
CREATE TABLE services_v2 (
  id TEXT PRIMARY KEY,
  service_date TEXT NOT NULL CHECK (
    length(service_date) = 10 AND
    service_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  service_type TEXT NOT NULL CHECK (service_type IN ('LEHR', 'GEBET')),
  song_id TEXT REFERENCES songs(id) ON DELETE RESTRICT,
  song_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE RESTRICT,
  text_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  vorrade_id TEXT REFERENCES vorraden(id) ON DELETE RESTRICT,
  vorrade_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  lehr_status TEXT CHECK (lehr_status IN ('IN_PROGRESS', 'FINISHED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (service_type = 'GEBET' AND vorrade_id IS NULL AND
      vorrade_by_person_id IS NULL AND lehr_status IS NULL)
    OR
    (service_type = 'LEHR' AND
      ((vorrade_id IS NULL AND vorrade_by_person_id IS NULL) OR
       (vorrade_id IS NOT NULL)))
  )
)
"""

SONGS_V2_SQL = """
CREATE TABLE songs_v2 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
"""

TEXTS_V2_SQL = """
CREATE TABLE texts_v2 (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  tags TEXT,
  scripture_reference TEXT,
  songs_for_text TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
"""


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def connect():
    con = sqlite3.connect(DB_PATH, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def schema_backup(database_path, connection):
    backup_dir = database_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup_path = backup_dir / f"sermon-register-before-schema-change-{stamp}.db"
    with sqlite3.connect(backup_path) as backup:
        connection.backup(backup)
    return backup_path


def ensure_schema(connection, database_path=DB_PATH):
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    existing_text_table = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'texts'"
    ).fetchone()
    existing_text_columns = (
        {
            row["name"]
            for row in connection.execute("PRAGMA table_info(texts)")
        }
        if existing_text_table
        else set()
    )
    bootstrap_schema = schema_sql
    if existing_text_table and "text" not in existing_text_columns:
        bootstrap_schema = bootstrap_schema.replace(
            "CREATE INDEX IF NOT EXISTS texts_text_idx ON texts(text COLLATE NOCASE);",
            "",
        )
    connection.executescript(bootstrap_schema)
    columns = {
        row["name"]: row for row in connection.execute("PRAGMA table_info(services)")
    }
    table_sql_row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'services'"
    ).fetchone()
    table_sql = table_sql_row["sql"] if table_sql_row else ""
    needs_migration = (
        (columns.get("song_id") and columns["song_id"]["notnull"])
        or (columns.get("song_by_person_id") and columns["song_by_person_id"]["notnull"])
        or (columns.get("text_by_person_id") and columns["text_by_person_id"]["notnull"])
        or "lehr_status IS NOT NULL" in table_sql
    )
    backup_path = None
    if needs_migration:
        backup_path = schema_backup(database_path, connection)
        connection.commit()
        connection.execute("PRAGMA foreign_keys = OFF")
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(SERVICES_V2_SQL)
            connection.execute(
                """INSERT INTO services_v2
                   (id, service_date, service_type, song_id, song_by_person_id,
                    text_id, text_by_person_id, vorrade_id, vorrade_by_person_id,
                    lehr_status, notes, created_at, updated_at)
                   SELECT id, service_date, service_type, song_id, song_by_person_id,
                          text_id, text_by_person_id, vorrade_id, vorrade_by_person_id,
                          lehr_status, notes, created_at, updated_at
                     FROM services"""
            )
            connection.execute("DROP TRIGGER IF EXISTS validate_lehr_gebet_link_insert")
            connection.execute("DROP TRIGGER IF EXISTS validate_lehr_gebet_link_update")
            connection.execute("DROP TABLE services")
            connection.execute("ALTER TABLE services_v2 RENAME TO services")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.execute("PRAGMA foreign_keys = ON")

    link_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(lehr_gebet_links)")
    }
    if "lehr_status_after" not in link_columns:
        if not backup_path:
            backup_path = schema_backup(database_path, connection)
        connection.execute(
            """ALTER TABLE lehr_gebet_links
               ADD COLUMN lehr_status_after TEXT
               CHECK (lehr_status_after IN ('IN_PROGRESS', 'FINISHED'))"""
        )
        connection.execute("PRAGMA user_version = 3")
        connection.commit()

    song_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(songs)")
    }
    if "song_number" in song_columns or "tags" not in song_columns:
        if not backup_path:
            backup_path = schema_backup(database_path, connection)
        connection.commit()
        connection.execute("PRAGMA foreign_keys = OFF")
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(SONGS_V2_SQL)
            connection.execute(
                """INSERT INTO songs_v2
                   (id, title, tags, notes, created_at, updated_at)
                   SELECT id,
                          COALESCE(NULLIF(TRIM(title), ''), song_number),
                          NULL,
                          notes,
                          created_at,
                          updated_at
                     FROM songs"""
            )
            connection.execute("DROP TABLE songs")
            connection.execute("ALTER TABLE songs_v2 RENAME TO songs")
            connection.execute("PRAGMA user_version = 4")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.execute("PRAGMA foreign_keys = ON")

    text_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(texts)")
    }
    if "title" in text_columns or "description" not in text_columns:
        if not backup_path:
            backup_path = schema_backup(database_path, connection)
        connection.commit()
        connection.execute("PRAGMA foreign_keys = OFF")
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(TEXTS_V2_SQL)
            connection.execute(
                """INSERT INTO texts_v2
                   (id, text, description, tags, scripture_reference,
                    songs_for_text, notes, created_at, updated_at)
                   SELECT id, title, text_information, NULL, scripture_reference,
                          NULL, notes, created_at, updated_at
                     FROM texts"""
            )
            connection.execute("DROP TABLE texts")
            connection.execute("ALTER TABLE texts_v2 RENAME TO texts")
            connection.execute("PRAGMA user_version = 6")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.execute("PRAGMA foreign_keys = ON")

    text_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(texts)")
    }
    if "songs_for_text" not in text_columns:
        if not backup_path:
            backup_path = schema_backup(database_path, connection)
        connection.execute("ALTER TABLE texts ADD COLUMN songs_for_text TEXT")
        connection.execute("PRAGMA user_version = 6")
        connection.commit()

    connection.executescript(schema_sql)
    if not metadata_value(connection, "text_tags_migration_v1"):
        text_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(texts)")
        }
        has_legacy_tags = (
            "tags" in text_columns
            and connection.execute(
                "SELECT 1 FROM texts WHERE NULLIF(TRIM(tags), '') IS NOT NULL LIMIT 1"
            ).fetchone()
        )
        if has_legacy_tags and not backup_path:
            backup_path = schema_backup(database_path, connection)
        migrate_legacy_text_tags(connection)
    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise RuntimeError(f"Schema migration created foreign key errors: {violations}")
    return backup_path


def initialize_database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADS_PATH.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        ensure_schema(con, DB_PATH)
        seed_legacy_lehr_progress(con)
        run_one_time_status_cleanup(con, DB_PATH)
        run_one_time_legacy_gebet_progress_cleanup(con, DB_PATH)
        con.commit()
    cleanup_stale_backup_files()


def master_id(con, table, value_column, value, extra=None):
    row = con.execute(
        f"SELECT id FROM {table} WHERE {value_column} = ? COLLATE NOCASE LIMIT 1",
        (value,),
    ).fetchone()
    if row:
        return row["id"]
    record_id = str(uuid.uuid4())
    stamp = now()
    columns = ["id", value_column, "created_at", "updated_at"]
    values = [record_id, value, stamp, stamp]
    if extra:
        for key, val in extra.items():
            columns.append(key)
            values.append(val)
    marks = ", ".join("?" for _ in values)
    con.execute(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({marks})", values
    )
    return record_id


def optional_master_id(con, table, value_column, value, extra=None):
    value = str(value or "").strip()
    return master_id(con, table, value_column, value, extra) if value else None


def as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def normalize_tags(value):
    tags = []
    seen = set()
    for raw_tag in str(value or "").split(","):
        tag = raw_tag.strip()
        key = tag.casefold()
        if tag and key not in seen:
            tags.append(tag)
            seen.add(key)
    return ", ".join(tags) or None


def normalize_tag_name(value):
    """Return one stable Title Case display name for a sermon tag."""
    cleaned = " ".join(str(value or "").strip().split()).lower()
    return re.sub(
        r"(^|[\s-])([^\s-])",
        lambda match: match.group(1) + match.group(2).upper(),
        cleaned,
    )


def tag_names(value):
    raw_values = value if isinstance(value, list) else str(value or "").split(",")
    names = []
    seen = set()
    for raw_value in raw_values:
        raw_name = raw_value.get("name", "") if isinstance(raw_value, dict) else raw_value
        name = normalize_tag_name(raw_name)
        key = name.casefold()
        if name and key not in seen:
            names.append(name)
            seen.add(key)
    return names


def tag_id_for_name(con, name):
    display_name = normalize_tag_name(name)
    if not display_name:
        raise ValueError("Tag name is required")
    normalized_name = display_name.casefold()
    row = con.execute(
        "SELECT id FROM tags WHERE normalized_name = ?", (normalized_name,)
    ).fetchone()
    if row:
        return row["id"]
    tag_id = str(uuid.uuid4())
    stamp = now()
    con.execute(
        """INSERT INTO tags
           (id, name, normalized_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)""",
        (tag_id, display_name, normalized_name, stamp, stamp),
    )
    return tag_id


def sync_text_tags(con, text_id, value):
    names = tag_names(value)
    desired_ids = [tag_id_for_name(con, name) for name in names]
    con.execute("DELETE FROM text_tags WHERE text_id = ?", (text_id,))
    stamp = now()
    for tag_id in desired_ids:
        con.execute(
            """INSERT INTO text_tags(text_id, tag_id, created_at)
               VALUES (?, ?, ?)""",
            (text_id, tag_id, stamp),
        )
    # Keep the legacy column synchronized on upgraded databases. It is not the
    # source of truth and new code always reads through text_tags.
    text_columns = {
        row["name"] for row in con.execute("PRAGMA table_info(texts)")
    }
    if "tags" in text_columns:
        con.execute(
            "UPDATE texts SET tags = ? WHERE id = ?",
            (", ".join(names) or None, text_id),
        )


def migrate_legacy_text_tags(con):
    text_columns = {
        row["name"] for row in con.execute("PRAGMA table_info(texts)")
    }
    if "tags" in text_columns:
        for row in con.execute(
            "SELECT id, tags FROM texts WHERE NULLIF(TRIM(tags), '') IS NOT NULL"
        ).fetchall():
            stamp = now()
            for name in tag_names(row["tags"]):
                tag_id = tag_id_for_name(con, name)
                con.execute(
                    """INSERT OR IGNORE INTO text_tags(text_id, tag_id, created_at)
                       VALUES (?, ?, ?)""",
                    (row["id"], tag_id, stamp),
                )
    set_metadata(con, "text_tags_migration_v1", now())
    con.execute("PRAGMA user_version = 9")
    con.commit()


def tag_rows(con):
    return [
        dict(row)
        for row in con.execute(
            """SELECT tags.id, tags.name,
                      COUNT(text_tags.text_id) AS sermon_count
                 FROM tags
            LEFT JOIN text_tags ON text_tags.tag_id = tags.id
             GROUP BY tags.id, tags.name
             ORDER BY tags.name COLLATE NOCASE"""
        )
    ]


def tag_records_by_text(con):
    records = {}
    for row in con.execute(
        """SELECT text_tags.text_id, tags.id, tags.name
             FROM text_tags
             JOIN tags ON tags.id = text_tags.tag_id
            ORDER BY tags.name COLLATE NOCASE"""
    ):
        records.setdefault(row["text_id"], []).append(
            {"id": row["id"], "name": row["name"]}
        )
    return records


def song_rows(con):
    sql = """
    SELECT songs.id, songs.title, songs.tags, songs.notes,
           COUNT(services.id) AS times_used,
           MAX(services.service_date) AS last_used
      FROM songs
 LEFT JOIN services ON services.song_id = songs.id
  GROUP BY songs.id, songs.title, songs.tags, songs.notes
  ORDER BY songs.title COLLATE NOCASE
    """
    return [dict(row) for row in con.execute(sql)]


def text_rows(con):
    sql = """
    SELECT texts.id, texts.text, texts.description,
           texts.scripture_reference, texts.songs_for_text, texts.notes,
           (SELECT COUNT(*)
              FROM lehr_progress progress
             WHERE progress.text_id = texts.id) AS times_used,
           (SELECT COUNT(*)
              FROM services
             WHERE services.text_id = texts.id) AS service_count,
           (SELECT MAX(start_service.service_date)
              FROM lehr_progress progress
              JOIN services start_service
                ON start_service.id = progress.start_service_id
             WHERE progress.text_id = texts.id) AS last_used,
           (SELECT COUNT(*)
              FROM text_attachments attachments
             WHERE attachments.text_id = texts.id) AS attachment_count
      FROM texts
  ORDER BY texts.text COLLATE NOCASE
    """
    records_by_text = tag_records_by_text(con)
    rows = [dict(row) for row in con.execute(sql)]
    for row in rows:
        row["tag_records"] = records_by_text.get(row["id"], [])
        row["tags"] = ", ".join(tag["name"] for tag in row["tag_records"])
    return rows


def people_rows(con):
    return [
        dict(row)
        for row in con.execute(
            """SELECT people.id, people.name,
                      MAX(person_usage.service_date) AS last_used
                 FROM people
            LEFT JOIN (
                       SELECT song_by_person_id AS person_id, service_date
                         FROM services
                        WHERE song_by_person_id IS NOT NULL
                       UNION ALL
                       SELECT text_by_person_id AS person_id, service_date
                         FROM services
                        WHERE text_by_person_id IS NOT NULL
                       UNION ALL
                       SELECT vorrade_by_person_id AS person_id, service_date
                         FROM services
                        WHERE vorrade_by_person_id IS NOT NULL
                      ) person_usage ON person_usage.person_id = people.id
                WHERE people.active = 1
             GROUP BY people.id, people.name
             ORDER BY people.name COLLATE NOCASE"""
        )
    ]


def text_attachment_rows(con, text_id):
    return [
        dict(row)
        for row in con.execute(
            """SELECT id, text_id, original_file_name, byte_size, created_at
                 FROM text_attachments
                WHERE text_id = ?
                ORDER BY created_at DESC""",
            (text_id,),
        )
    ]


def attachment_path(storage_key):
    root = UPLOADS_PATH.resolve()
    candidate = (UPLOADS_PATH / storage_key).resolve()
    if os.path.commonpath((str(root), str(candidate))) != str(root):
        raise ValueError("Invalid attachment storage path")
    return candidate


def matching_lehr_id(con, gebet_date, text_id, gebet_id=None):
    row = con.execute(
        """SELECT id
             FROM services
            WHERE service_type = 'LEHR'
              AND text_id = ?
              AND service_date <= ?
              AND service_date >= date(?, '-1 year')
              AND id <> COALESCE(?, '')
            ORDER BY service_date DESC, created_at DESC
            LIMIT 1""",
        (text_id, gebet_date, gebet_date, gebet_id),
    ).fetchone()
    return row["id"] if row else None


def backfill_gebet_links(con):
    gebets = con.execute(
        """SELECT s.id, s.service_date, s.text_id
             FROM services s
            WHERE s.service_type = 'GEBET'
              AND NOT EXISTS (
                    SELECT 1
                      FROM lehr_gebet_links link
                     WHERE link.gebet_service_id = s.id
              )
            ORDER BY s.service_date, s.created_at"""
    ).fetchall()
    stamp = now()
    for gebet in gebets:
        lehr_id = matching_lehr_id(
            con, gebet["service_date"], gebet["text_id"], gebet["id"]
        )
        if not lehr_id:
            continue
        sequence_number = con.execute(
            """SELECT COALESCE(MAX(sequence_number), 0) + 1
                 FROM lehr_gebet_links
                WHERE lehr_service_id = ?""",
            (lehr_id,),
        ).fetchone()[0]
        con.execute(
            """INSERT INTO lehr_gebet_links
               (id, lehr_service_id, gebet_service_id, sequence_number,
                lehr_status_after, created_at)
               VALUES (?, ?, ?, ?, NULL, ?)""",
            (str(uuid.uuid4()), lehr_id, gebet["id"], sequence_number, stamp),
        )


def sync_lehr_status_from_links(con, lehr_id, stamp):
    statuses = con.execute(
        """SELECT
               SUM(CASE WHEN lehr_status_after = 'FINISHED' THEN 1 ELSE 0 END),
               SUM(CASE WHEN lehr_status_after = 'IN_PROGRESS' THEN 1 ELSE 0 END)
             FROM lehr_gebet_links
            WHERE lehr_service_id = ?""",
        (lehr_id,),
    ).fetchone()
    status = "FINISHED" if statuses[0] else "IN_PROGRESS"
    con.execute(
        "UPDATE services SET lehr_status = ?, updated_at = ? WHERE id = ?",
        (status, stamp, lehr_id),
    )


def set_gebet_lehr_link(con, gebet_id, lehr_id, lehr_status, stamp):
    lehr_id = str(lehr_id or "").strip() or None
    lehr_status = str(lehr_status or "").strip() or None
    if lehr_status not in (None, "IN_PROGRESS", "FINISHED"):
        raise ValueError("Invalid Lehr status")

    existing = con.execute(
        """SELECT lehr_service_id, lehr_status_after
             FROM lehr_gebet_links
            WHERE gebet_service_id = ?""",
        (gebet_id,),
    ).fetchone()

    if not lehr_id:
        if existing:
            con.execute(
                "DELETE FROM lehr_gebet_links WHERE gebet_service_id = ?",
                (gebet_id,),
            )
            sync_lehr_status_from_links(con, existing["lehr_service_id"], stamp)
        return

    lehr = con.execute(
        "SELECT id FROM services WHERE id = ? AND service_type = 'LEHR'",
        (lehr_id,),
    ).fetchone()
    if not lehr:
        raise ValueError("The selected Lehr could not be found")

    if not existing or existing["lehr_service_id"] != lehr_id:
        if existing:
            con.execute(
                "DELETE FROM lehr_gebet_links WHERE gebet_service_id = ?",
                (gebet_id,),
            )
            sync_lehr_status_from_links(con, existing["lehr_service_id"], stamp)
        sequence_number = con.execute(
            """SELECT COALESCE(MAX(sequence_number), 0) + 1
                 FROM lehr_gebet_links
                WHERE lehr_service_id = ?""",
            (lehr_id,),
        ).fetchone()[0]
        con.execute(
            """INSERT INTO lehr_gebet_links
               (id, lehr_service_id, gebet_service_id, sequence_number,
                lehr_status_after, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()), lehr_id, gebet_id, sequence_number,
                lehr_status, stamp,
            ),
        )
    elif lehr_status:
        con.execute(
            """UPDATE lehr_gebet_links
                  SET lehr_status_after = ?
                WHERE gebet_service_id = ?""",
            (lehr_status, gebet_id),
        )

    if lehr_status:
        sync_lehr_status_from_links(con, lehr_id, stamp)


def metadata_value(con, key):
    row = con.execute(
        "SELECT value FROM app_metadata WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else None


def set_metadata(con, key, value):
    con.execute(
        """INSERT INTO app_metadata(key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE
             SET value = excluded.value, updated_at = excluded.updated_at""",
        (key, value, now()),
    )


class BackupCancelled(Exception):
    pass


def local_now():
    return datetime.now(LOCAL_TIMEZONE)


def human_bytes(value):
    size = float(value or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024


def backup_history(con):
    raw_value = metadata_value(con, BACKUP_HISTORY_KEY)
    if not raw_value:
        return []
    try:
        records = json.loads(raw_value)
        return records if isinstance(records, list) else []
    except json.JSONDecodeError:
        return []


def record_backup_attempt(status, job):
    record = {
        "id": job["id"],
        "createdAt": job.get("createdAt") or now(),
        "finishedAt": now(),
        "status": status,
        "fileName": job.get("fileName"),
        "byteSize": int(job.get("byteSize") or 0),
        "pdfCount": int(job.get("pdfCount") or 0),
        "error": job.get("error"),
    }
    with DATA_WRITE_LOCK:
        with connect() as con:
            records = [
                item for item in backup_history(con)
                if item.get("id") != job["id"]
            ]
            records.insert(0, record)
            set_metadata(con, BACKUP_HISTORY_KEY, json.dumps(records[:5]))
            if status == "SUCCESS":
                set_metadata(
                    con,
                    LAST_SUCCESSFUL_BACKUP_KEY,
                    json.dumps(
                        {
                            "createdAt": record["finishedAt"],
                            "fileName": record["fileName"],
                            "byteSize": record["byteSize"],
                            "pdfCount": record["pdfCount"],
                        }
                    ),
                )
            con.commit()


def cleanup_stale_backup_files():
    backup_root = (DB_PATH.parent / "backups").resolve()
    temporary_root = BACKUP_TEMP_PATH.resolve()
    if os.path.commonpath((str(backup_root), str(temporary_root))) != str(backup_root):
        raise RuntimeError("Invalid temporary backup path")
    if temporary_root.exists():
        shutil.rmtree(temporary_root)
    temporary_root.mkdir(parents=True, exist_ok=True)


def attachment_backup_rows(con):
    rows = []
    specifications = (
        ("service_attachments", "service_id", "services"),
        ("text_attachments", "text_id", "texts"),
        ("vorrade_attachments", "vorrade_id", "vorraden"),
    )
    for table, owner_column, category in specifications:
        for row in con.execute(
            f"""SELECT id, {owner_column} AS owner_id, original_file_name,
                       storage_key, byte_size, sha256
                  FROM {table}
              ORDER BY storage_key"""
        ):
            record = dict(row)
            record["category"] = category
            rows.append(record)
    return rows


def backup_counts(con):
    tables = ("services", "texts", "songs", "vorraden", "people")
    return {
        table: int(con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in tables
    }


def backup_overview():
    with connect() as con:
        counts = backup_counts(con)
        pdf_count = sum(
            con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "service_attachments", "text_attachments", "vorrade_attachments"
            )
        )
        pdf_bytes = sum(
            con.execute(
                f"SELECT COALESCE(SUM(byte_size), 0) FROM {table}"
            ).fetchone()[0]
            for table in (
                "service_attachments", "text_attachments", "vorrade_attachments"
            )
        )
        last_raw = metadata_value(con, LAST_SUCCESSFUL_BACKUP_KEY)
        try:
            last_success = json.loads(last_raw) if last_raw else None
        except json.JSONDecodeError:
            last_success = None
        history = backup_history(con)
    last_created = last_success.get("createdAt") if last_success else None
    reminder = "NEVER"
    next_recommended = None
    if last_created:
        try:
            last_time = datetime.fromisoformat(last_created.replace("Z", "+00:00"))
            age_days = max(
                0, int((datetime.now(timezone.utc) - last_time).total_seconds() // 86400)
            )
            reminder = "RED" if age_days >= 30 else "AMBER" if age_days >= 14 else "CURRENT"
            next_recommended = (
                last_time.timestamp() + (14 * 86400)
            )
            next_recommended = datetime.fromtimestamp(
                next_recommended, timezone.utc
            ).isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError):
            reminder = "NEVER"
    return {
        "appVersion": APP_VERSION,
        "timeZone": APP_TIMEZONE,
        "reminder": reminder,
        "lastSuccessfulBackup": last_success,
        "nextRecommendedAt": next_recommended,
        "databaseBytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
        "pdfBytes": int(pdf_bytes or 0),
        "pdfCount": int(pdf_count or 0),
        "counts": counts,
        "history": history[:5],
    }


def file_sha256(file_path, cancel_event=None):
    digest = hashlib.sha256()
    with file_path.open("rb") as file_handle:
        while True:
            if cancel_event and cancel_event.is_set():
                raise BackupCancelled()
            block = file_handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def set_backup_job(job_id, **values):
    with BACKUP_JOBS_LOCK:
        job = BACKUP_JOBS.get(job_id)
        if job:
            job.update(values)


def public_backup_job(job):
    return {
        key: value
        for key, value in job.items()
        if key not in ("cancelEvent", "directory", "zipPath", "finishedEpoch")
    }


def check_backup_cancelled(job):
    if job["cancelEvent"].is_set():
        raise BackupCancelled()


def backup_restore_instructions(manifest):
    return "\n".join(
        (
            "Lehr Register Backup",
            "====================",
            "",
            f"Backup Format Version: {manifest['backupFormatVersion']}",
            f"Application Version: {manifest['applicationVersion']}",
            f"Database Schema Version: {manifest['databaseSchemaVersion']}",
            "",
            "This backup contains a transactionally consistent SQLite database",
            "and the exact private upload layout used by Lehr Register.",
            "",
            "Do not copy these files over a running application.",
            "The supported in-app restore workflow will be added after restore",
            "testing is complete. Until then, preserve this ZIP unchanged and use",
            "the documented server recovery procedure for the matching or a newer",
            "compatible application version.",
            "",
        )
    )


def create_backup_job(job_id):
    with BACKUP_JOBS_LOCK:
        job = BACKUP_JOBS[job_id]
    job_directory = Path(job["directory"])
    snapshot_path = job_directory / "sermon-register.db"
    staged_uploads = job_directory / "uploads"
    try:
        set_backup_job(job_id, status="RUNNING", stage="CHECKING_DATABASE")
        check_backup_cancelled(job)
        with DATA_WRITE_LOCK:
            with connect() as source:
                integrity = source.execute("PRAGMA quick_check").fetchone()[0]
                if str(integrity).lower() != "ok":
                    raise RuntimeError("The SQLite Database Integrity Check Failed.")
                attachments = attachment_backup_rows(source)
                expected_upload_bytes = sum(
                    int(attachment["byte_size"]) for attachment in attachments
                )
                database_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
                required_bytes = expected_upload_bytes + (database_bytes * 2) + 50 * 1024 * 1024
                available_bytes = shutil.disk_usage(DB_PATH.parent).free
                if available_bytes < required_bytes:
                    raise RuntimeError(
                        "Not Enough Server Space To Create The Backup. "
                        f"Required {human_bytes(required_bytes)}, "
                        f"Available {human_bytes(available_bytes)}."
                    )

                set_backup_job(job_id, stage="CREATING_SNAPSHOT")
                job_directory.mkdir(parents=True, exist_ok=False)
                snapshot = sqlite3.connect(snapshot_path)
                try:
                    def backup_progress(status, remaining, total):
                        check_backup_cancelled(job)
                    source.backup(snapshot, pages=256, progress=backup_progress)
                finally:
                    snapshot.close()

                for attachment in attachments:
                    check_backup_cancelled(job)
                    source_path = attachment_path(attachment["storage_key"])
                    if not source_path.is_file():
                        raise RuntimeError(
                            f"A PDF File Is Missing (File ID {attachment['id']})."
                        )
                    destination = staged_uploads / attachment["storage_key"]
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        os.link(source_path, destination)
                    except OSError as exc:
                        raise RuntimeError(
                            "The Server Data Volume Could Not Create A Safe Backup Snapshot."
                        ) from exc

        check_backup_cancelled(job)
        set_backup_job(job_id, stage="VERIFYING_PDFS")
        snapshot = sqlite3.connect(snapshot_path)
        try:
            snapshot.row_factory = sqlite3.Row
            integrity = snapshot.execute("PRAGMA quick_check").fetchone()[0]
            if str(integrity).lower() != "ok":
                raise RuntimeError("The SQLite Backup Snapshot Integrity Check Failed.")
            counts = backup_counts(snapshot)
            schema_version = int(snapshot.execute("PRAGMA user_version").fetchone()[0])
        finally:
            snapshot.close()

        manifest_files = []
        for attachment in attachments:
            check_backup_cancelled(job)
            staged_path = staged_uploads / attachment["storage_key"]
            actual_size = staged_path.stat().st_size
            if actual_size != int(attachment["byte_size"]):
                raise RuntimeError(
                    f"A PDF File Has An Unexpected Size (File ID {attachment['id']})."
                )
            actual_hash = file_sha256(staged_path, job["cancelEvent"])
            if actual_hash.lower() != str(attachment["sha256"]).lower():
                raise RuntimeError(
                    f"A PDF File Failed Verification (File ID {attachment['id']})."
                )
            manifest_files.append(
                {
                    "id": attachment["id"],
                    "ownerId": attachment["owner_id"],
                    "category": attachment["category"],
                    "originalFileName": attachment["original_file_name"],
                    "storageKey": attachment["storage_key"],
                    "byteSize": actual_size,
                    "sha256": actual_hash,
                }
            )

        created_local = local_now()
        manifest = {
            "backupFormatVersion": BACKUP_FORMAT_VERSION,
            "applicationVersion": APP_VERSION,
            "databaseSchemaVersion": schema_version,
            "createdAt": now(),
            "createdAtLocal": created_local.isoformat(),
            "timeZone": APP_TIMEZONE,
            "dataPath": "/app/data",
            "databaseIntegrity": "passed",
            "counts": counts,
            "pdfCount": len(manifest_files),
            "pdfBytes": sum(item["byteSize"] for item in manifest_files),
            "files": manifest_files,
        }
        manifest_path = job_directory / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
        )
        restore_path = job_directory / "RESTORE.txt"
        restore_path.write_text(
            backup_restore_instructions(manifest), encoding="utf-8"
        )

        check_backup_cancelled(job)
        set_backup_job(job_id, stage="PACKAGING_BACKUP")
        zip_path = Path(job["zipPath"])
        with zipfile.ZipFile(
            zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
            allowZip64=True,
        ) as archive:
            archive.write(snapshot_path, "sermon-register.db")
            archive.write(manifest_path, "manifest.json")
            archive.write(restore_path, "RESTORE.txt")
            for attachment in manifest_files:
                check_backup_cancelled(job)
                storage_key = attachment["storageKey"].replace("\\", "/")
                archive.write(staged_uploads / attachment["storageKey"], f"uploads/{storage_key}")

        check_backup_cancelled(job)
        with zipfile.ZipFile(zip_path, "r") as archive:
            damaged_entry = archive.testzip()
            if damaged_entry:
                raise RuntimeError(f"The Backup ZIP Failed Verification ({damaged_entry}).")
        byte_size = zip_path.stat().st_size
        set_backup_job(
            job_id,
            status="READY",
            stage="READY_TO_DOWNLOAD",
            byteSize=byte_size,
            pdfCount=len(manifest_files),
            counts=counts,
            sha256=file_sha256(zip_path, job["cancelEvent"]),
            finishedEpoch=time.time(),
        )
    except BackupCancelled:
        set_backup_job(
            job_id,
            status="CANCELLED",
            stage="CANCELLED",
            finishedEpoch=time.time(),
        )
        record_backup_attempt("CANCELLED", job)
        shutil.rmtree(job_directory, ignore_errors=True)
        Path(job["zipPath"]).unlink(missing_ok=True)
    except Exception as exc:
        set_backup_job(
            job_id,
            status="FAILED",
            stage="FAILED",
            error=str(exc),
            finishedEpoch=time.time(),
        )
        job["error"] = str(exc)
        record_backup_attempt("FAILED", job)
        shutil.rmtree(job_directory, ignore_errors=True)
        Path(job["zipPath"]).unlink(missing_ok=True)


def cleanup_expired_backup_jobs():
    cutoff = time.time() - BACKUP_JOB_TTL_SECONDS
    expired = []
    with BACKUP_JOBS_LOCK:
        for job_id, job in list(BACKUP_JOBS.items()):
            if job.get("finishedEpoch", float("inf")) < cutoff:
                expired.append(BACKUP_JOBS.pop(job_id))
    for job in expired:
        shutil.rmtree(Path(job["directory"]), ignore_errors=True)
        Path(job["zipPath"]).unlink(missing_ok=True)


def start_backup_job():
    cleanup_expired_backup_jobs()
    with BACKUP_JOBS_LOCK:
        active = next(
            (
                job for job in BACKUP_JOBS.values()
                if job["status"] in ("QUEUED", "RUNNING", "READY", "DOWNLOADING")
            ),
            None,
        )
        if active:
            raise ValueError("A Backup Is Already In Progress.")
        job_id = str(uuid.uuid4())
        timestamp = local_now().strftime("%Y-%m-%d-%H%M")
        file_name = f"lehr-register-backup-{timestamp}-v{APP_VERSION}.zip"
        job_directory = BACKUP_TEMP_PATH / job_id
        zip_path = BACKUP_TEMP_PATH / f"{job_id}.zip"
        job = {
            "id": job_id,
            "status": "QUEUED",
            "stage": "WAITING_TO_START",
            "createdAt": now(),
            "fileName": file_name,
            "byteSize": 0,
            "pdfCount": 0,
            "error": None,
            "cancelEvent": threading.Event(),
            "directory": str(job_directory),
            "zipPath": str(zip_path),
        }
        BACKUP_JOBS[job_id] = job
    threading.Thread(
        target=create_backup_job,
        args=(job_id,),
        name=f"backup-{job_id[:8]}",
        daemon=True,
    ).start()
    return public_backup_job(job)


def seed_legacy_lehr_progress(con):
    """Copy existing relationships without changing historical service records."""
    if metadata_value(con, "lehr_progress_seed_v1"):
        return
    stamp = now()
    lehrs = con.execute(
        """SELECT id, text_id, lehr_status, created_at
             FROM services
            WHERE service_type = 'LEHR'
            ORDER BY service_date, created_at"""
    ).fetchall()
    for lehr in lehrs:
        progress = con.execute(
            "SELECT id FROM lehr_progress WHERE start_service_id = ?",
            (lehr["id"],),
        ).fetchone()
        progress_id = progress["id"] if progress else str(uuid.uuid4())
        if not progress:
            con.execute(
                """INSERT INTO lehr_progress
                   (id, text_id, start_service_id, status,
                    completion_service_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                (
                    progress_id,
                    lehr["text_id"],
                    lehr["id"],
                    lehr["lehr_status"],
                    lehr["created_at"] or stamp,
                    stamp,
                ),
            )
        con.execute(
            """INSERT OR IGNORE INTO lehr_progress_services
               (progress_id, service_id, sequence_number, intent,
                role_visible, created_at)
               VALUES (?, ?, 1, 'START', 1, ?)""",
            (progress_id, lehr["id"], lehr["created_at"] or stamp),
        )
        links = con.execute(
            """SELECT link.gebet_service_id, link.sequence_number,
                      link.lehr_status_after, link.created_at
                 FROM lehr_gebet_links link
                WHERE link.lehr_service_id = ?
                ORDER BY link.sequence_number""",
            (lehr["id"],),
        ).fetchall()
        completion_id = None
        for index, link in enumerate(links, start=2):
            con.execute(
                """INSERT OR IGNORE INTO lehr_progress_services
                   (progress_id, service_id, sequence_number, intent,
                    role_visible, created_at)
                   VALUES (?, ?, ?, 'LEGACY', 0, ?)""",
                (progress_id, link["gebet_service_id"], index, link["created_at"]),
            )
            if link["lehr_status_after"] == "FINISHED":
                completion_id = link["gebet_service_id"]
        if completion_id and lehr["lehr_status"] == "FINISHED":
            con.execute(
                """UPDATE lehr_progress
                      SET completion_service_id = ?, updated_at = ?
                    WHERE id = ?""",
                (completion_id, stamp, progress_id),
            )
    set_metadata(con, "lehr_progress_seed_v1", stamp)
    con.commit()


def status_cleanup_backup(database_path, connection):
    backup_dir = database_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup_path = backup_dir / f"sermon-register-before-status-cleanup-{stamp}.db"
    with sqlite3.connect(backup_path) as backup:
        connection.backup(backup)
    return backup_path


def run_one_time_status_cleanup(con, database_path=DB_PATH):
    if metadata_value(con, "old_status_cleanup_v1"):
        return
    con.commit()
    try:
        backup_path = status_cleanup_backup(database_path, con)
    except Exception as exc:
        print(
            f"[database] Status cleanup skipped because backup failed: {exc}",
            flush=True,
        )
        return
    cutoff = con.execute("SELECT date('now', '-2 months')").fetchone()[0]
    old_progress = con.execute(
        """SELECT progress.id, progress.start_service_id
             FROM lehr_progress progress
            WHERE COALESCE(
                    (SELECT MAX(service.service_date)
                       FROM lehr_progress_services member
                       JOIN services service ON service.id = member.service_id
                      WHERE member.progress_id = progress.id),
                    '0000-00-00'
                  ) < ?""",
        (cutoff,),
    ).fetchall()
    stamp = now()
    for progress in old_progress:
        con.execute(
            """UPDATE lehr_progress
                  SET status = NULL, completion_service_id = NULL, updated_at = ?
                WHERE id = ?""",
            (stamp, progress["id"]),
        )
        con.execute(
            "UPDATE services SET lehr_status = NULL, updated_at = ? WHERE id = ?",
            (stamp, progress["start_service_id"]),
        )
        con.execute(
            """UPDATE lehr_progress_services
                  SET role_visible = CASE WHEN sequence_number = 1 THEN role_visible ELSE 0 END
                WHERE progress_id = ?""",
            (progress["id"],),
        )
        con.execute(
            """UPDATE lehr_gebet_links
                  SET lehr_status_after = NULL
                WHERE lehr_service_id = ?""",
            (progress["start_service_id"],),
        )
    set_metadata(
        con,
        "old_status_cleanup_v1",
        json.dumps(
            {
                "cutoff": cutoff,
                "backup": str(backup_path),
                "clearedProgressRecords": len(old_progress),
            }
        ),
    )
    con.commit()
    print(
        f"[database] One-time status cleanup cleared {len(old_progress)} old records; "
        f"backup: {backup_path}",
        flush=True,
    )


def run_one_time_legacy_gebet_progress_cleanup(con, database_path=DB_PATH):
    """Remove old, single-record Gebet progress created by the edit bug."""
    if metadata_value(con, "legacy_gebet_progress_cleanup_v1"):
        return
    cutoff = con.execute("SELECT date('now', '-2 months')").fetchone()[0]
    progress_rows = con.execute(
        """SELECT progress.id, progress.start_service_id
             FROM lehr_progress progress
             JOIN services service ON service.id = progress.start_service_id
            WHERE service.service_type = 'GEBET'
              AND service.service_date < ?
              AND NOT EXISTS (
                    SELECT 1
                      FROM lehr_progress_services member
                     WHERE member.progress_id = progress.id
                       AND member.service_id <> progress.start_service_id
                  )""",
        (cutoff,),
    ).fetchall()
    backup_path = None
    if progress_rows:
        con.commit()
        try:
            backup_path = status_cleanup_backup(database_path, con)
        except Exception as exc:
            print(
                f"[database] Legacy Gebet progress cleanup skipped because backup failed: {exc}",
                flush=True,
            )
            return
        for progress in progress_rows:
            con.execute(
                "DELETE FROM lehr_progress_services WHERE progress_id = ?",
                (progress["id"],),
            )
            con.execute("DELETE FROM lehr_progress WHERE id = ?", (progress["id"],))
    set_metadata(
        con,
        "legacy_gebet_progress_cleanup_v1",
        json.dumps(
            {
                "cutoff": cutoff,
                "backup": str(backup_path) if backup_path else None,
                "removedProgressRecords": len(progress_rows),
            }
        ),
    )
    con.commit()
    print(
        f"[database] One-time legacy Gebet cleanup removed "
        f"{len(progress_rows)} accidental progress records.",
        flush=True,
    )


def matching_progress(con, service_date, text_id, service_id=None):
    row = con.execute(
        """WITH activity AS (
               SELECT progress.id, progress.start_service_id,
                      MAX(service.service_date) AS last_date,
                      MAX(CASE WHEN service.service_date = ?
                               THEN service.created_at ELSE '' END) AS same_day_order
                 FROM lehr_progress progress
                 JOIN lehr_progress_services member
                   ON member.progress_id = progress.id
                 JOIN services service ON service.id = member.service_id
                WHERE progress.text_id = ?
                  AND progress.status = 'IN_PROGRESS'
                  AND member.service_id <> COALESCE(?, '')
                  AND service.service_date <= ?
                GROUP BY progress.id, progress.start_service_id
           )
           SELECT activity.id, activity.start_service_id,
                  activity.last_date, start_service.service_type,
                  texts.text AS start_text
             FROM activity
             JOIN services start_service ON start_service.id = activity.start_service_id
             JOIN texts ON texts.id = start_service.text_id
            WHERE activity.last_date >= date(?, '-9 months')
            ORDER BY activity.last_date DESC, activity.same_day_order DESC
            LIMIT 1""",
        (service_date, text_id, service_id, service_date, service_date),
    ).fetchone()
    return dict(row) if row else None


def progress_members(con, progress_id):
    return con.execute(
        """SELECT member.service_id, member.sequence_number, member.intent,
                  member.role_visible, service.service_date, service.service_type,
                  text.text
             FROM lehr_progress_services member
             JOIN services service ON service.id = member.service_id
             JOIN texts text ON text.id = service.text_id
            WHERE member.progress_id = ?
            ORDER BY service.service_date, service.created_at, member.sequence_number""",
        (progress_id,),
    ).fetchall()


def resequence_progress(con, progress_id):
    members = progress_members(con, progress_id)
    for sequence, member in enumerate(members, start=1):
        con.execute(
            """UPDATE lehr_progress_services SET sequence_number = ?
                WHERE progress_id = ? AND service_id = ?""",
            (1000000 + sequence, progress_id, member["service_id"]),
        )
    for sequence, member in enumerate(members, start=1):
        con.execute(
            """UPDATE lehr_progress_services SET sequence_number = ?
                WHERE progress_id = ? AND service_id = ?""",
            (sequence, progress_id, member["service_id"]),
        )


def create_progress(con, service_id, text_id, status, intent, stamp):
    progress_id = str(uuid.uuid4())
    con.execute(
        """INSERT INTO lehr_progress
           (id, text_id, start_service_id, status, completion_service_id,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)""",
        (progress_id, text_id, service_id, status, stamp, stamp),
    )
    con.execute(
        """INSERT INTO lehr_progress_services
           (progress_id, service_id, sequence_number, intent, role_visible, created_at)
           VALUES (?, ?, 1, ?, 1, ?)""",
        (progress_id, service_id, intent, stamp),
    )
    return progress_id


def add_progress_member(con, progress_id, service_id, intent, stamp):
    sequence = con.execute(
        """SELECT COALESCE(MAX(sequence_number), 0) + 1
             FROM lehr_progress_services WHERE progress_id = ?""",
        (progress_id,),
    ).fetchone()[0]
    con.execute(
        """INSERT INTO lehr_progress_services
           (progress_id, service_id, sequence_number, intent, role_visible, created_at)
           VALUES (?, ?, ?, ?, 1, ?)""",
        (progress_id, service_id, sequence, intent, stamp),
    )
    resequence_progress(con, progress_id)


def set_progress_status(con, progress_id, status, completion_service_id, stamp,
                        reveal_history=False):
    if status not in (None, "IN_PROGRESS", "FINISHED"):
        raise ValueError("Invalid Lehr status")
    if status != "FINISHED":
        completion_service_id = None
    if completion_service_id:
        owner = con.execute(
            """SELECT 1 FROM lehr_progress_services
                WHERE progress_id = ? AND service_id = ?""",
            (progress_id, completion_service_id),
        ).fetchone()
        if not owner:
            raise ValueError("The completing service is not part of this Lehr")
    con.execute(
        """UPDATE lehr_progress
              SET status = ?, completion_service_id = ?, updated_at = ?
            WHERE id = ?""",
        (status, completion_service_id, stamp, progress_id),
    )
    if reveal_history:
        con.execute(
            "UPDATE lehr_progress_services SET role_visible = 1 WHERE progress_id = ?",
            (progress_id,),
        )
    start = con.execute(
        """SELECT service.id, service.service_type
             FROM lehr_progress progress
             JOIN services service ON service.id = progress.start_service_id
            WHERE progress.id = ?""",
        (progress_id,),
    ).fetchone()
    if start and start["service_type"] == "LEHR":
        con.execute(
            "UPDATE services SET lehr_status = ?, updated_at = ? WHERE id = ?",
            (status, stamp, start["id"]),
        )


def assign_new_service_progress(con, service_id, service_type, service_date,
                                text_id, intent, status, completed, stamp):
    intent = str(intent or "").upper()
    completed = bool(completed)
    if service_type == "LEHR" and intent == "CONTINUE":
        match = matching_progress(con, service_date, text_id, service_id)
        if not match:
            raise ValueError(
                "No In-Progress Lehr With This Text Was Found Within Nine Months."
            )
        progress_id = match["id"]
        add_progress_member(con, progress_id, service_id, "CONTINUE", stamp)
        if completed:
            set_progress_status(
                con, progress_id, "FINISHED", service_id, stamp, reveal_history=True
            )
        return progress_id
    if service_type == "GEBET":
        match = matching_progress(con, service_date, text_id, service_id)
        if match:
            progress_id = match["id"]
            add_progress_member(con, progress_id, service_id, "AUTO", stamp)
        else:
            progress_id = create_progress(
                con, service_id, text_id, "IN_PROGRESS", "AUTO", stamp
            )
        if completed:
            set_progress_status(
                con, progress_id, "FINISHED", service_id, stamp, reveal_history=True
            )
        return progress_id
    normalized_status = status or "IN_PROGRESS"
    progress_id = create_progress(
        con, service_id, text_id, normalized_status, "START", stamp
    )
    if normalized_status == "FINISHED":
        set_progress_status(
            con, progress_id, "FINISHED", service_id, stamp, reveal_history=True
        )
    return progress_id


def latest_progress_service_id(con, progress_id):
    row = con.execute(
        """SELECT service.id
             FROM lehr_progress_services member
             JOIN services service ON service.id = member.service_id
            WHERE member.progress_id = ?
            ORDER BY service.service_date DESC, service.created_at DESC,
                     member.sequence_number DESC
            LIMIT 1""",
        (progress_id,),
    ).fetchone()
    return row["id"] if row else None


def move_progress_member(con, service_id, target_progress_id, intent, stamp):
    current = con.execute(
        """SELECT progress_id FROM lehr_progress_services
            WHERE service_id = ?""",
        (service_id,),
    ).fetchone()
    if current and current["progress_id"] == target_progress_id:
        con.execute(
            """UPDATE lehr_progress_services
                  SET intent = ?, role_visible = 1
                WHERE service_id = ?""",
            (intent, service_id),
        )
        return
    if current:
        old_progress_id = current["progress_id"]
        old = con.execute(
            "SELECT completion_service_id FROM lehr_progress WHERE id = ?",
            (old_progress_id,),
        ).fetchone()
        con.execute(
            "DELETE FROM lehr_progress_services WHERE service_id = ?", (service_id,)
        )
        if old and old["completion_service_id"] == service_id:
            set_progress_status(con, old_progress_id, "IN_PROGRESS", None, stamp)
        resequence_progress(con, old_progress_id)
    add_progress_member(con, target_progress_id, service_id, intent, stamp)


def update_service_progress(con, service_id, service_type, service_date, text_id,
                            intent, status, completed, status_changed,
                            progress_changed, relationship_changed, stamp):
    membership = con.execute(
        """SELECT member.progress_id, member.intent,
                  progress.start_service_id, progress.status,
                  progress.completion_service_id
             FROM lehr_progress_services member
             JOIN lehr_progress progress ON progress.id = member.progress_id
            WHERE member.service_id = ?""",
        (service_id,),
    ).fetchone()
    if not membership:
        if not status_changed and not progress_changed:
            return None
        return assign_new_service_progress(
            con, service_id, service_type, service_date, text_id,
            intent, status, completed, stamp
        )

    progress_id = membership["progress_id"]
    is_start = membership["start_service_id"] == service_id
    if not status_changed and not progress_changed:
        if is_start and service_type == "LEHR" and relationship_changed:
            con.execute(
                """UPDATE lehr_progress
                      SET text_id = ?, updated_at = ?
                    WHERE id = ?""",
                (text_id, stamp, progress_id),
            )
        return progress_id
    if (
        status_changed
        and not completed
        and membership["completion_service_id"] == service_id
    ):
        set_progress_status(con, progress_id, "IN_PROGRESS", None, stamp)
    desired_intent = "AUTO" if service_type == "GEBET" else str(
        intent or membership["intent"] or "START"
    ).upper()
    if service_type == "LEHR" and desired_intent not in ("START", "CONTINUE"):
        desired_intent = "START"

    if is_start and desired_intent == "CONTINUE":
        match = matching_progress(con, service_date, text_id, service_id)
        if not match or match["id"] == progress_id:
            raise ValueError(
                "No In-Progress Lehr With This Text Was Found Within Nine Months."
            )
        old_members = progress_members(con, progress_id)
        old_completion = membership["completion_service_id"]
        con.execute(
            "DELETE FROM lehr_progress_services WHERE progress_id = ?", (progress_id,)
        )
        con.execute("DELETE FROM lehr_progress WHERE id = ?", (progress_id,))
        for old_member in old_members:
            member_intent = (
                "CONTINUE" if old_member["service_id"] == service_id
                else old_member["intent"] if old_member["intent"] != "START" else "AUTO"
            )
            add_progress_member(
                con, match["id"], old_member["service_id"], member_intent, stamp
            )
            con.execute(
                """UPDATE lehr_progress_services SET role_visible = ?
                    WHERE service_id = ?""",
                (1 if old_member["service_id"] == service_id else old_member["role_visible"],
                 old_member["service_id"]),
            )
        if old_completion:
            set_progress_status(
                con, match["id"], "FINISHED", old_completion, stamp,
                reveal_history=True
            )
        elif completed:
            set_progress_status(
                con, match["id"], "FINISHED", service_id, stamp,
                reveal_history=True
            )
        return match["id"]

    if is_start:
        con.execute(
            """UPDATE lehr_progress
                  SET text_id = ?, updated_at = ?
                WHERE id = ?""",
            (text_id, stamp, progress_id),
        )
        con.execute(
            """UPDATE lehr_progress_services
                  SET intent = ?, role_visible = 1
                WHERE service_id = ?""",
            ("AUTO" if service_type == "GEBET" else "START", service_id),
        )
        requested_status = status if status in (None, "IN_PROGRESS", "FINISHED") else None
        if status_changed and (requested_status == "FINISHED" or completed):
            completion_id = latest_progress_service_id(con, progress_id) or service_id
            set_progress_status(
                con, progress_id, "FINISHED", completion_id, stamp,
                reveal_history=True
            )
        elif status_changed and requested_status == "IN_PROGRESS":
            set_progress_status(con, progress_id, "IN_PROGRESS", None, stamp)
        elif status_changed and requested_status is None and membership["status"] is None:
            set_progress_status(con, progress_id, None, None, stamp)
        resequence_progress(con, progress_id)
        return progress_id

    if not relationship_changed:
        con.execute(
            """UPDATE lehr_progress_services
                  SET intent = ?, role_visible = 1
                WHERE service_id = ?""",
            (desired_intent, service_id),
        )
        if status_changed and completed:
            set_progress_status(
                con, progress_id, "FINISHED", service_id, stamp,
                reveal_history=True
            )
        return progress_id

    if service_type == "LEHR" and desired_intent == "START":
        old_progress_id = progress_id
        was_completion = membership["completion_service_id"] == service_id
        con.execute(
            "DELETE FROM lehr_progress_services WHERE service_id = ?", (service_id,)
        )
        if was_completion:
            set_progress_status(con, old_progress_id, "IN_PROGRESS", None, stamp)
        resequence_progress(con, old_progress_id)
        normalized_status = status or "IN_PROGRESS"
        return create_progress(
            con, service_id, text_id, normalized_status, "START", stamp
        )

    match = matching_progress(con, service_date, text_id, service_id)
    if not match:
        if service_type == "LEHR":
            raise ValueError(
                "No In-Progress Lehr With This Text Was Found Within Nine Months."
            )
        old_progress_id = progress_id
        was_completion = membership["completion_service_id"] == service_id
        con.execute(
            "DELETE FROM lehr_progress_services WHERE service_id = ?", (service_id,)
        )
        if was_completion:
            set_progress_status(con, old_progress_id, "IN_PROGRESS", None, stamp)
        resequence_progress(con, old_progress_id)
        new_progress = create_progress(
            con, service_id, text_id, "IN_PROGRESS", "AUTO", stamp
        )
        if completed:
            set_progress_status(
                con, new_progress, "FINISHED", service_id, stamp,
                reveal_history=True
            )
        return new_progress

    move_progress_member(con, service_id, match["id"], desired_intent, stamp)
    if status_changed and completed:
        set_progress_status(
            con, match["id"], "FINISHED", service_id, stamp,
            reveal_history=True
        )
    elif status_changed and membership["completion_service_id"] == service_id:
        set_progress_status(con, match["id"], "IN_PROGRESS", None, stamp)
    return match["id"]


def progress_role_label(row):
    if not row.get("progress_id"):
        return None
    if not row.get("progress_role_visible") and row.get("service_type") == "GEBET":
        return None
    is_start = row.get("progress_start_service_id") == row.get("id")
    if is_start and row.get("service_type") == "LEHR":
        return row.get("progress_status")
    if row.get("progress_completion_service_id") == row.get("id"):
        return "COMPLETED_LEHR"
    if is_start:
        return "STARTED_LEHR"
    return "CONTINUED"


def service_rows(con):
    sql = """
    SELECT s.id, s.service_date, s.service_type, s.notes,
           COALESCE(progress.status, s.lehr_status) AS lehr_status,
           COALESCE(songs.title, '') AS song,
           COALESCE(song_person.name, '') AS song_by,
           texts.id AS text_id,
           texts.text AS text_title,
           COALESCE(text_person.name, '') AS text_by,
           vorraden.title AS vorrade,
           vorrade_person.name AS vorrade_by,
           progress.id AS progress_id,
           member.intent AS progress_intent,
           member.role_visible AS progress_role_visible,
           progress.status AS progress_status,
           progress.start_service_id AS progress_start_service_id,
           progress.completion_service_id AS progress_completion_service_id,
           start_service.service_date AS linked_lehr_date,
           start_text.text AS linked_lehr_text,
           progress.start_service_id AS linked_lehr_id,
           progress.status AS linked_lehr_current_status
      FROM services s
 LEFT JOIN songs ON songs.id = s.song_id
 LEFT JOIN people song_person ON song_person.id = s.song_by_person_id
      JOIN texts ON texts.id = s.text_id
 LEFT JOIN people text_person ON text_person.id = s.text_by_person_id
 LEFT JOIN vorraden ON vorraden.id = s.vorrade_id
 LEFT JOIN people vorrade_person ON vorrade_person.id = s.vorrade_by_person_id
 LEFT JOIN lehr_progress_services member ON member.service_id = s.id
 LEFT JOIN lehr_progress progress ON progress.id = member.progress_id
 LEFT JOIN services start_service ON start_service.id = progress.start_service_id
 LEFT JOIN texts start_text ON start_text.id = progress.text_id
  ORDER BY s.service_date DESC, s.created_at DESC
    """
    rows = [dict(row) for row in con.execute(sql)]
    tags_by_text = tag_records_by_text(con)
    history_by_progress = {}
    for history_row in con.execute(
        """SELECT member.progress_id, member.service_id, member.role_visible,
                  service.service_date, service.service_type,
                  progress.start_service_id, progress.completion_service_id
             FROM lehr_progress_services member
             JOIN services service ON service.id = member.service_id
             JOIN lehr_progress progress ON progress.id = member.progress_id
            ORDER BY member.progress_id, service.service_date,
                     service.created_at, member.sequence_number"""
    ):
        visible = bool(history_row["role_visible"])
        is_start = history_row["service_id"] == history_row["start_service_id"]
        role = None
        if visible or history_row["service_type"] == "LEHR":
            if history_row["service_id"] == history_row["completion_service_id"]:
                role = "COMPLETED_LEHR"
            elif is_start and history_row["service_type"] == "GEBET":
                role = "STARTED_LEHR"
            elif not is_start:
                role = "CONTINUED"
        history_by_progress.setdefault(history_row["progress_id"], []).append(
            {
                "id": history_row["service_id"],
                "date": history_row["service_date"],
                "type": history_row["service_type"],
                "role": role,
            }
        )
    for row in rows:
        row["text_tag_records"] = tags_by_text.get(row["text_id"], [])
        row["text_tags"] = ", ".join(
            tag["name"] for tag in row["text_tag_records"]
        )
        row["status_label"] = progress_role_label(row)
        row["linked_lehr_status"] = (
            "FINISHED"
            if row["progress_completion_service_id"] == row["id"]
            else "IN_PROGRESS" if row["progress_id"] else None
        )
        row["progress_history"] = history_by_progress.get(row["progress_id"], [])
    return rows


class Handler(BaseHTTPRequestHandler):
    def allowed_origin(self):
        origin = self.headers.get("Origin")
        if not origin or origin == APP_ORIGIN:
            return origin or APP_ORIGIN

        origin_host = urlparse(origin).hostname
        request_host = urlparse(f"//{self.headers.get('Host', '')}").hostname
        if origin_host and origin_host == request_host:
            return origin
        return APP_ORIGIN

    def send_json_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def json(self, payload, status=200):
        self.send_json_headers(status)
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_json_headers(204)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def create_tag(self):
        try:
            body = self.body()
            name = normalize_tag_name(body.get("name"))
            if not name:
                return self.json({"error": "Tag Name is required"}, 400)
            with connect() as con:
                existing = con.execute(
                    "SELECT id FROM tags WHERE normalized_name = ?",
                    (name.casefold(),),
                ).fetchone()
                if existing:
                    record = next(
                        row for row in tag_rows(con) if row["id"] == existing["id"]
                    )
                    return self.json(record)
                tag_id = tag_id_for_name(con, name)
                con.commit()
                record = next(row for row in tag_rows(con) if row["id"] == tag_id)
                return self.json(record, 201)
        except Exception as exc:
            return self.json({"error": str(exc)}, 500)

    def update_tag(self):
        try:
            body = self.body()
            action = str(body.get("action", "rename")).strip().lower()
            tag_id = str(body.get("id", "")).strip()
            if not tag_id:
                return self.json({"error": "Tag is required"}, 400)
            with connect() as con:
                tag = con.execute(
                    "SELECT id, name FROM tags WHERE id = ?", (tag_id,)
                ).fetchone()
                if not tag:
                    return self.json({"error": "Tag not found"}, 404)
                if action == "merge":
                    target_id = str(body.get("targetId", "")).strip()
                    if not target_id or target_id == tag_id:
                        return self.json({"error": "Choose a different target Tag"}, 400)
                    target = con.execute(
                        "SELECT id FROM tags WHERE id = ?", (target_id,)
                    ).fetchone()
                    if not target:
                        return self.json({"error": "Target Tag not found"}, 404)
                    con.execute(
                        """INSERT OR IGNORE INTO text_tags(text_id, tag_id, created_at)
                           SELECT text_id, ?, created_at
                             FROM text_tags
                            WHERE tag_id = ?""",
                        (target_id, tag_id),
                    )
                    con.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
                    con.commit()
                    return self.json(
                        {
                            "mergedId": tag_id,
                            "target": next(
                                row for row in tag_rows(con) if row["id"] == target_id
                            ),
                        }
                    )
                if action != "rename":
                    return self.json({"error": "Invalid Tag action"}, 400)
                name = normalize_tag_name(body.get("name"))
                if not name:
                    return self.json({"error": "Tag Name is required"}, 400)
                duplicate = con.execute(
                    """SELECT id FROM tags
                        WHERE normalized_name = ? AND id <> ?""",
                    (name.casefold(), tag_id),
                ).fetchone()
                if duplicate:
                    return self.json(
                        {"error": "This Tag already exists. Use Merge instead."}, 409
                    )
                con.execute(
                    """UPDATE tags
                          SET name = ?, normalized_name = ?, updated_at = ?
                        WHERE id = ?""",
                    (name, name.casefold(), now(), tag_id),
                )
                con.commit()
                return self.json(next(row for row in tag_rows(con) if row["id"] == tag_id))
        except Exception as exc:
            return self.json({"error": str(exc)}, 500)

    def delete_tag(self):
        try:
            body = self.body()
            tag_id = str(body.get("id", "")).strip()
            if not tag_id:
                return self.json({"error": "Tag is required"}, 400)
            with connect() as con:
                tag = con.execute(
                    """SELECT tags.id, tags.name, COUNT(text_tags.text_id) AS sermon_count
                         FROM tags
                    LEFT JOIN text_tags ON text_tags.tag_id = tags.id
                        WHERE tags.id = ?
                     GROUP BY tags.id, tags.name""",
                    (tag_id,),
                ).fetchone()
                if not tag:
                    return self.json({"error": "Tag not found"}, 404)
                con.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
                con.commit()
                return self.json(
                    {
                        "id": tag_id,
                        "name": tag["name"],
                        "sermonCount": tag["sermon_count"],
                    }
                )
        except Exception as exc:
            return self.json({"error": str(exc)}, 500)

    def create_song(self):
        try:
            body = self.body()
            title = str(body.get("title", "")).strip()
            if not title:
                return self.json({"error": "Song Title is required"}, 400)
            with connect() as con:
                existing = con.execute(
                    "SELECT id FROM songs WHERE title = ? COLLATE NOCASE", (title,)
                ).fetchone()
                if existing:
                    return self.json({"error": "This Song already exists"}, 409)
                song_id = str(uuid.uuid4())
                stamp = now()
                con.execute(
                    """INSERT INTO songs
                       (id, title, tags, notes, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        song_id,
                        title,
                        normalize_tags(body.get("tags")),
                        str(body.get("notes", "")).strip() or None,
                        stamp,
                        stamp,
                    ),
                )
                con.commit()
                record = next(row for row in song_rows(con) if row["id"] == song_id)
                self.json(record, 201)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def update_song(self):
        try:
            body = self.body()
            song_id = str(body.get("id", "")).strip()
            title = str(body.get("title", "")).strip()
            if not song_id or not title:
                return self.json({"error": "Song and Title are required"}, 400)
            with connect() as con:
                existing = con.execute(
                    "SELECT id FROM songs WHERE id = ?", (song_id,)
                ).fetchone()
                if not existing:
                    return self.json({"error": "Song not found"}, 404)
                duplicate = con.execute(
                    """SELECT id FROM songs
                        WHERE title = ? COLLATE NOCASE AND id <> ?""",
                    (title, song_id),
                ).fetchone()
                if duplicate:
                    return self.json({"error": "This Song already exists"}, 409)
                con.execute(
                    """UPDATE songs
                          SET title = ?, tags = ?, notes = ?, updated_at = ?
                        WHERE id = ?""",
                    (
                        title,
                        normalize_tags(body.get("tags")),
                        str(body.get("notes", "")).strip() or None,
                        now(),
                        song_id,
                    ),
                )
                con.commit()
                record = next(row for row in song_rows(con) if row["id"] == song_id)
                self.json(record)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def create_text(self):
        try:
            body = self.body()
            text = str(body.get("text", "")).strip()
            if not text:
                return self.json({"error": "Text is required"}, 400)
            with connect() as con:
                existing = con.execute(
                    "SELECT id FROM texts WHERE text = ? COLLATE NOCASE", (text,)
                ).fetchone()
                if existing:
                    return self.json({"error": "This Text already exists"}, 409)
                text_id = str(uuid.uuid4())
                stamp = now()
                con.execute(
                    """INSERT INTO texts
                       (id, text, description, scripture_reference,
                        songs_for_text, notes, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        text_id,
                        text,
                        str(body.get("description") or "").strip() or None,
                        str(body.get("scriptureReference") or "").strip() or None,
                        str(body.get("songsForText") or "").strip() or None,
                        str(body.get("notes") or "").strip() or None,
                        stamp,
                        stamp,
                    ),
                )
                sync_text_tags(con, text_id, body.get("tags", []))
                con.commit()
                record = next(row for row in text_rows(con) if row["id"] == text_id)
                self.json(record, 201)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def update_text(self):
        try:
            body = self.body()
            text_id = str(body.get("id", "")).strip()
            text = str(body.get("text", "")).strip()
            if not text_id or not text:
                return self.json({"error": "Text record and Text are required"}, 400)
            with connect() as con:
                existing = con.execute(
                    "SELECT id FROM texts WHERE id = ?", (text_id,)
                ).fetchone()
                if not existing:
                    return self.json({"error": "Text not found"}, 404)
                duplicate = con.execute(
                    """SELECT id FROM texts
                        WHERE text = ? COLLATE NOCASE AND id <> ?""",
                    (text, text_id),
                ).fetchone()
                if duplicate:
                    return self.json({"error": "This Text already exists"}, 409)
                con.execute(
                    """UPDATE texts
                          SET text = ?, description = ?,
                              scripture_reference = ?, songs_for_text = ?, notes = ?,
                              updated_at = ?
                        WHERE id = ?""",
                    (
                        text,
                        str(body.get("description") or "").strip() or None,
                        str(body.get("scriptureReference") or "").strip() or None,
                        str(body.get("songsForText") or "").strip() or None,
                        str(body.get("notes") or "").strip() or None,
                        now(),
                        text_id,
                    ),
                )
                sync_text_tags(con, text_id, body.get("tags", []))
                con.commit()
                record = next(row for row in text_rows(con) if row["id"] == text_id)
                self.json(record)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def create_text_attachment(self):
        final_path = None
        try:
            body = self.body()
            text_id = str(body.get("textId", "")).strip()
            file_name = str(body.get("fileName", "")).strip()
            mime_type = str(body.get("mimeType", "")).strip().lower()
            encoded_data = str(body.get("data", "")).strip()
            if not text_id or not file_name or not encoded_data:
                return self.json({"error": "Text and PDF file are required"}, 400)
            if mime_type not in ("application/pdf", ""):
                return self.json({"error": "Only PDF files can be attached"}, 400)
            try:
                file_data = base64.b64decode(encoded_data, validate=True)
            except (binascii.Error, ValueError):
                return self.json({"error": "The PDF data is invalid"}, 400)
            if len(file_data) > MAX_PDF_BYTES:
                return self.json({"error": "PDF files must be 25 MB or smaller"}, 413)
            if not file_data.startswith(b"%PDF-"):
                return self.json({"error": "The selected file is not a valid PDF"}, 400)

            with connect() as con:
                owner = con.execute(
                    "SELECT id FROM texts WHERE id = ?", (text_id,)
                ).fetchone()
                if not owner:
                    return self.json({"error": "Text not found"}, 404)
                attachment_id = str(uuid.uuid4())
                storage_key = f"texts/{text_id}/{attachment_id}.pdf"
                final_path = attachment_path(storage_key)
                final_path.parent.mkdir(parents=True, exist_ok=True)
                temporary_path = final_path.with_suffix(".tmp")
                with temporary_path.open("xb") as file_handle:
                    file_handle.write(file_data)
                os.replace(temporary_path, final_path)
                con.execute(
                    """INSERT INTO text_attachments
                       (id, text_id, original_file_name, storage_key, mime_type,
                        byte_size, sha256, created_at)
                       VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, ?)""",
                    (
                        attachment_id,
                        text_id,
                        Path(file_name).name,
                        storage_key,
                        len(file_data),
                        hashlib.sha256(file_data).hexdigest(),
                        now(),
                    ),
                )
                con.commit()
                record = next(
                    row
                    for row in text_attachment_rows(con, text_id)
                    if row["id"] == attachment_id
                )
                self.json(record, 201)
        except Exception as exc:
            if final_path:
                final_path.unlink(missing_ok=True)
            self.json({"error": str(exc)}, 500)

    def send_text_attachment(self, attachment_id, download=False):
        with connect() as con:
            attachment = con.execute(
                """SELECT original_file_name, storage_key, byte_size
                     FROM text_attachments WHERE id = ?""",
                (attachment_id,),
            ).fetchone()
        if not attachment:
            return self.json({"error": "PDF attachment not found"}, 404)
        try:
            file_path = attachment_path(attachment["storage_key"])
            file_data = file_path.read_bytes()
        except (OSError, ValueError):
            return self.json({"error": "The PDF file could not be read"}, 404)
        safe_name = (
            attachment["original_file_name"]
            .replace('"', "")
            .replace("\r", "")
            .replace("\n", "")
        )
        disposition = "attachment" if download else "inline"
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(file_data)))
        self.send_header("Content-Disposition", f'{disposition}; filename="{safe_name}"')
        self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(file_data)

    def backup_job_status(self, job_id):
        cleanup_expired_backup_jobs()
        with BACKUP_JOBS_LOCK:
            job = BACKUP_JOBS.get(job_id)
            if not job:
                return self.json({"error": "Backup Job Not Found."}, 404)
            payload = public_backup_job(job)
        return self.json(payload)

    def send_backup_download(self, job_id):
        with BACKUP_JOBS_LOCK:
            job = BACKUP_JOBS.get(job_id)
            if not job:
                return self.json({"error": "Backup Job Not Found."}, 404)
            if job["status"] != "READY":
                return self.json({"error": "The Backup Is Not Ready To Download."}, 409)
            job["status"] = "DOWNLOADING"
            job["stage"] = "STARTING_DOWNLOAD"
        zip_path = Path(job["zipPath"])
        if not zip_path.is_file():
            set_backup_job(
                job_id,
                status="FAILED",
                stage="FAILED",
                error="The Temporary Backup File Is Missing.",
                finishedEpoch=time.time(),
            )
            return self.json({"error": "The Temporary Backup File Is Missing."}, 404)
        safe_name = job["fileName"].replace('"', "").replace("\r", "").replace("\n", "")
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(zip_path.stat().st_size))
            self.send_header(
                "Content-Disposition", f'attachment; filename="{safe_name}"'
            )
            self.send_header("X-Backup-Job-Id", job_id)
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
            self.send_header("Vary", "Origin")
            self.end_headers()
            with zip_path.open("rb") as file_handle:
                while True:
                    check_backup_cancelled(job)
                    block = file_handle.read(1024 * 1024)
                    if not block:
                        break
                    self.wfile.write(block)
            self.wfile.flush()
            record_backup_attempt("SUCCESS", job)
            shutil.rmtree(Path(job["directory"]), ignore_errors=True)
            zip_path.unlink(missing_ok=True)
            set_backup_job(
                job_id,
                status="COMPLETE",
                stage="DOWNLOAD_COMPLETE",
                finishedEpoch=time.time(),
            )
        except (BackupCancelled, BrokenPipeError, ConnectionResetError, OSError):
            error = "The Backup Download Was Interrupted."
            set_backup_job(
                job_id,
                status="FAILED",
                stage="FAILED",
                error=error,
                finishedEpoch=time.time(),
            )
            job["error"] = error
            record_backup_attempt("FAILED", job)
            shutil.rmtree(Path(job["directory"]), ignore_errors=True)
            zip_path.unlink(missing_ok=True)

    def cancel_backup_job(self, job_id):
        with BACKUP_JOBS_LOCK:
            job = BACKUP_JOBS.get(job_id)
            if not job:
                return self.json({"error": "Backup Job Not Found."}, 404)
            if job["status"] in ("COMPLETE", "FAILED", "CANCELLED"):
                return self.json(public_backup_job(job))
            job["cancelEvent"].set()
            ready = job["status"] == "READY"
            if ready:
                job["status"] = "CANCELLED"
                job["stage"] = "CANCELLED"
                job["finishedEpoch"] = time.time()
            payload = public_backup_job(job)
        if ready:
            record_backup_attempt("CANCELLED", job)
            shutil.rmtree(Path(job["directory"]), ignore_errors=True)
            Path(job["zipPath"]).unlink(missing_ok=True)
        return self.json(payload)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/backups":
            parameters = parse_qs(parsed.query)
            job_id = str(parameters.get("jobId", [""])[0]).strip()
            if not job_id:
                return self.json(backup_overview())
            if str(parameters.get("download", [""])[0]) == "1":
                return self.send_backup_download(job_id)
            return self.backup_job_status(job_id)
        if path == "/songs":
            with connect() as con:
                return self.json(song_rows(con))
        if path == "/texts":
            with connect() as con:
                return self.json(text_rows(con))
        if path == "/tags":
            with connect() as con:
                return self.json(tag_rows(con))
        if path == "/people":
            with connect() as con:
                return self.json(people_rows(con))
        if path == "/progress-match":
            parameters = parse_qs(parsed.query)
            service_date = str(parameters.get("date", [""])[0]).strip()
            text_value = str(parameters.get("text", [""])[0]).strip()
            service_id = str(parameters.get("serviceId", [""])[0]).strip() or None
            if not service_date or not text_value:
                return self.json({"match": None})
            with connect() as con:
                text_row = con.execute(
                    "SELECT id FROM texts WHERE text = ? COLLATE NOCASE",
                    (text_value,),
                ).fetchone()
                match = (
                    matching_progress(con, service_date, text_row["id"], service_id)
                    if text_row else None
                )
                return self.json({"match": match})
        if path == "/text-attachments":
            parameters = parse_qs(parsed.query)
            attachment_id = str(parameters.get("fileId", [""])[0]).strip()
            if attachment_id:
                return self.send_text_attachment(
                    attachment_id,
                    str(parameters.get("download", [""])[0]) == "1",
                )
            text_id = str(parameters.get("textId", [""])[0]).strip()
            if not text_id:
                return self.json({"error": "Text id is required"}, 400)
            with connect() as con:
                return self.json(text_attachment_rows(con, text_id))
        if path != "/services":
            return self.json({"error": "Not found"}, 404)
        with connect() as con:
            self.json(service_rows(con))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/backups":
            try:
                return self.json(start_backup_job(), 202)
            except ValueError as exc:
                return self.json({"error": str(exc)}, 409)
            except Exception as exc:
                return self.json({"error": str(exc)}, 500)
        with DATA_WRITE_LOCK:
            return self.do_data_POST()

    def do_data_POST(self):
        path = urlparse(self.path).path
        if path == "/songs":
            return self.create_song()
        if path == "/texts":
            return self.create_text()
        if path == "/tags":
            return self.create_tag()
        if path == "/text-attachments":
            return self.create_text_attachment()
        if path != "/services":
            return self.json({"error": "Not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            required = ["date", "type", "text"]
            if any(not str(body.get(key, "")).strip() for key in required):
                return self.json({"error": "Required fields are missing"}, 400)
            if body["type"] not in ("LEHR", "GEBET"):
                return self.json({"error": "Invalid service type"}, 400)

            with connect() as con:
                song_id = optional_master_id(con, "songs", "title", body.get("song"))
                song_by = optional_master_id(
                    con, "people", "name", body.get("songBy")
                )
                text_id = master_id(con, "texts", "text", body["text"].strip())
                text_by = optional_master_id(
                    con, "people", "name", body.get("textBy")
                )
                vorrade_id = None
                vorrade_by = None
                lehr_status = None
                if body["type"] == "LEHR" and str(body.get("vorrade", "")).strip():
                    vorrade_id = master_id(
                        con, "vorraden", "title", body["vorrade"].strip()
                    )
                    if str(body.get("vorradeBy", "")).strip():
                        vorrade_by = master_id(
                            con, "people", "name", body["vorradeBy"].strip()
                        )
                if body["type"] == "LEHR":
                    progress_intent = str(
                        body.get("progressIntent", "START")
                    ).strip().upper()
                    if progress_intent not in ("START", "CONTINUE"):
                        return self.json({"error": "Invalid Lehr progress choice"}, 400)
                    lehr_status = str(body.get("status", "")).strip() or "IN_PROGRESS"
                    if lehr_status not in (None, "IN_PROGRESS", "FINISHED"):
                        return self.json({"error": "Invalid Lehr status"}, 400)
                else:
                    progress_intent = "AUTO"
                service_id = str(uuid.uuid4())
                stamp = now()
                con.execute(
                    """INSERT INTO services
                    (id, service_date, service_type, song_id, song_by_person_id,
                     text_id, text_by_person_id, vorrade_id, vorrade_by_person_id,
                     lehr_status, notes,
                     created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        service_id, body["date"], body["type"], song_id, song_by,
                        text_id, text_by, vorrade_id, vorrade_by,
                        lehr_status,
                        str(body.get("notes", "")).strip() or None, stamp, stamp,
                    ),
                )
                completed = as_bool(body.get("completed")) or (
                    str(body.get("linkedLehrStatus", "")).strip() == "FINISHED"
                )
                progress_id = assign_new_service_progress(
                    con,
                    service_id,
                    body["type"],
                    body["date"],
                    text_id,
                    progress_intent,
                    lehr_status,
                    completed,
                    stamp,
                )
                progress = con.execute(
                    "SELECT start_service_id FROM lehr_progress WHERE id = ?",
                    (progress_id,),
                ).fetchone()
                if body["type"] == "LEHR" and progress["start_service_id"] != service_id:
                    con.execute(
                        "UPDATE services SET lehr_status = NULL WHERE id = ?",
                        (service_id,),
                    )
                con.commit()
                record = next(row for row in service_rows(con) if row["id"] == service_id)
                self.json(record, 201)
        except ValueError as exc:
            self.json({"error": str(exc)}, 400)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def do_PUT(self):
        with DATA_WRITE_LOCK:
            return self.do_data_PUT()

    def do_data_PUT(self):
        path = urlparse(self.path).path
        if path == "/songs":
            return self.update_song()
        if path == "/texts":
            return self.update_text()
        if path == "/tags":
            return self.update_tag()
        if path != "/services":
            return self.json({"error": "Not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            required = ["id", "date", "type", "text"]
            if any(not str(body.get(key, "")).strip() for key in required):
                return self.json({"error": "Required fields are missing"}, 400)
            if body["type"] not in ("LEHR", "GEBET"):
                return self.json({"error": "Invalid service type"}, 400)

            with connect() as con:
                existing = con.execute(
                    """SELECT service.id, service.service_type,
                              service.service_date, service.text_id,
                              member.intent AS progress_intent
                         FROM services service
                    LEFT JOIN lehr_progress_services member
                           ON member.service_id = service.id
                        WHERE service.id = ?""",
                    (body["id"],),
                ).fetchone()
                if not existing:
                    return self.json({"error": "Service not found"}, 404)

                song_id = optional_master_id(con, "songs", "title", body.get("song"))
                song_by = optional_master_id(
                    con, "people", "name", body.get("songBy")
                )
                text_id = master_id(con, "texts", "text", body["text"].strip())
                text_by = optional_master_id(
                    con, "people", "name", body.get("textBy")
                )
                vorrade_id = None
                vorrade_by = None
                lehr_status = None
                if body["type"] == "LEHR":
                    if str(body.get("vorrade", "")).strip():
                        vorrade_id = master_id(
                            con, "vorraden", "title", body["vorrade"].strip()
                        )
                        if str(body.get("vorradeBy", "")).strip():
                            vorrade_by = master_id(
                                con, "people", "name", body["vorradeBy"].strip()
                            )
                    lehr_status = str(body.get("status", "")).strip() or None
                    if lehr_status not in (None, "IN_PROGRESS", "FINISHED"):
                        return self.json({"error": "Invalid Lehr status"}, 400)
                    progress_intent = str(
                        body.get("progressIntent", "START")
                    ).strip().upper()
                    if progress_intent not in ("START", "CONTINUE"):
                        return self.json({"error": "Invalid Lehr progress choice"}, 400)
                else:
                    progress_intent = "AUTO"

                stamp = now()
                con.execute(
                    """UPDATE services
                       SET service_date = ?, service_type = ?, song_id = ?,
                           song_by_person_id = ?, text_id = ?, text_by_person_id = ?,
                           vorrade_id = ?, vorrade_by_person_id = ?,
                           lehr_status = ?, notes = ?, updated_at = ?
                     WHERE id = ?""",
                    (
                        body["date"], body["type"], song_id, song_by, text_id,
                        text_by, vorrade_id, vorrade_by, lehr_status,
                        str(body.get("notes", "")).strip() or None,
                        stamp, body["id"],
                    ),
                )
                completed = as_bool(body.get("completed")) or (
                    str(body.get("linkedLehrStatus", "")).strip() == "FINISHED"
                )
                progress_id = update_service_progress(
                    con,
                    body["id"],
                    body["type"],
                    body["date"],
                    text_id,
                    progress_intent,
                    lehr_status,
                    completed,
                    as_bool(body.get("statusChanged")),
                    as_bool(body.get("progressChanged")),
                    (
                        existing["service_type"] != body["type"]
                        or existing["service_date"] != body["date"]
                        or existing["text_id"] != text_id
                        or (
                            body["type"] == "LEHR"
                            and existing["progress_intent"] not in (None, progress_intent)
                        )
                    ),
                    stamp,
                )
                membership = con.execute(
                    """SELECT progress.start_service_id
                         FROM lehr_progress progress WHERE progress.id = ?""",
                    (progress_id,),
                ).fetchone()
                if body["type"] == "LEHR" and membership and membership["start_service_id"] != body["id"]:
                    con.execute(
                        "UPDATE services SET lehr_status = NULL WHERE id = ?",
                        (body["id"],),
                    )
                con.commit()
                record = next(row for row in service_rows(con) if row["id"] == body["id"])
                self.json(record)
        except ValueError as exc:
            self.json({"error": str(exc)}, 400)
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/backups":
            try:
                body = self.body()
                job_id = str(body.get("jobId", "")).strip()
                if not job_id:
                    return self.json({"error": "Backup Job Is Required."}, 400)
                return self.cancel_backup_job(job_id)
            except Exception as exc:
                return self.json({"error": str(exc)}, 500)
        with DATA_WRITE_LOCK:
            return self.do_data_DELETE()

    def do_data_DELETE(self):
        path = urlparse(self.path).path
        if path == "/tags":
            return self.delete_tag()
        if path == "/texts":
            try:
                body = self.body()
                text_id = str(body.get("id", "")).strip()
                if not text_id:
                    return self.json({"error": "Text id is required"}, 400)
                with connect() as con:
                    text_record = con.execute(
                        "SELECT id FROM texts WHERE id = ?", (text_id,)
                    ).fetchone()
                    if not text_record:
                        return self.json({"error": "Text not found"}, 404)
                    service_count = con.execute(
                        "SELECT COUNT(*) FROM services WHERE text_id = ?", (text_id,)
                    ).fetchone()[0]
                    if service_count:
                        return self.json(
                            {
                                "error": (
                                    "This Text has been used in a service and cannot "
                                    "be deleted"
                                )
                            },
                            409,
                        )
                    attachment_paths = [
                        attachment_path(row["storage_key"])
                        for row in con.execute(
                            "SELECT storage_key FROM text_attachments WHERE text_id = ?",
                            (text_id,),
                        )
                    ]
                    con.execute("DELETE FROM texts WHERE id = ?", (text_id,))
                    con.commit()
                for file_path in attachment_paths:
                    try:
                        file_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                return self.json({"id": text_id})
            except Exception as exc:
                return self.json({"error": str(exc)}, 500)
        if path == "/text-attachments":
            try:
                body = self.body()
                attachment_id = str(body.get("id", "")).strip()
                if not attachment_id:
                    return self.json({"error": "PDF attachment id is required"}, 400)
                with connect() as con:
                    attachment = con.execute(
                        "SELECT storage_key FROM text_attachments WHERE id = ?",
                        (attachment_id,),
                    ).fetchone()
                    if not attachment:
                        return self.json({"error": "PDF attachment not found"}, 404)
                    con.execute(
                        "DELETE FROM text_attachments WHERE id = ?", (attachment_id,)
                    )
                    con.commit()
                attachment_path(attachment["storage_key"]).unlink(missing_ok=True)
                return self.json({"id": attachment_id})
            except Exception as exc:
                return self.json({"error": str(exc)}, 500)
        if path != "/services":
            return self.json({"error": "Not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            service_id = str(body.get("id", "")).strip()
            if not service_id:
                return self.json({"error": "Service id is required"}, 400)
            with connect() as con:
                service = con.execute(
                    "SELECT service_type FROM services WHERE id = ?", (service_id,)
                ).fetchone()
                membership = con.execute(
                    """SELECT member.progress_id, progress.start_service_id,
                              progress.completion_service_id,
                              (SELECT COUNT(*) FROM lehr_progress_services count_member
                                WHERE count_member.progress_id = member.progress_id) AS member_count
                         FROM lehr_progress_services member
                         JOIN lehr_progress progress ON progress.id = member.progress_id
                        WHERE member.service_id = ?""",
                    (service_id,),
                ).fetchone()
                if membership and membership["start_service_id"] == service_id and membership["member_count"] > 1:
                    return self.json(
                        {
                            "error": (
                                "This Service Starts A Lehr With Continuations And "
                                "Cannot Be Deleted."
                            )
                        },
                        409,
                    )
                if membership:
                    progress_id = membership["progress_id"]
                    con.execute(
                        "DELETE FROM lehr_progress_services WHERE service_id = ?",
                        (service_id,),
                    )
                    if membership["start_service_id"] == service_id:
                        con.execute("DELETE FROM lehr_progress WHERE id = ?", (progress_id,))
                    else:
                        if membership["completion_service_id"] == service_id:
                            set_progress_status(
                                con, progress_id, "IN_PROGRESS", None, now()
                            )
                        resequence_progress(con, progress_id)
                if service and service["service_type"] == "GEBET":
                    con.execute(
                        "DELETE FROM lehr_gebet_links WHERE gebet_service_id = ?",
                        (service_id,),
                    )
                deleted = con.execute(
                    "DELETE FROM services WHERE id = ?", (service_id,)
                )
                if not deleted.rowcount:
                    return self.json({"error": "Service not found"}, 404)
                con.commit()
                self.json({"id": service_id})
        except Exception as exc:
            self.json({"error": str(exc)}, 500)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    initialize_database()
    print(f"[database] SQLite ready at {DB_PATH}", flush=True)
    print(f"[database] API listening on {API_HOST}:{API_PORT}", flush=True)
    ThreadingHTTPServer((API_HOST, API_PORT), Handler).serve_forever()
