import base64
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from database import server as database_server


ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "database" / "server.py"


class AttachmentSchemaMigrationTest(unittest.TestCase):
    def test_version_nine_pdf_attachment_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix="sermon-attachment-migration-") as folder:
            database_path = Path(folder) / "sermon-register.db"
            connection = sqlite3.connect(database_path)
            connection.row_factory = sqlite3.Row
            connection.executescript(
                """
                CREATE TABLE texts (
                  id TEXT PRIMARY KEY,
                  text TEXT NOT NULL COLLATE NOCASE,
                  description TEXT,
                  tags TEXT,
                  scripture_reference TEXT,
                  songs_for_text TEXT,
                  notes TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE text_attachments (
                  id TEXT PRIMARY KEY,
                  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
                  original_file_name TEXT NOT NULL,
                  storage_key TEXT NOT NULL UNIQUE,
                  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
                  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
                  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                  created_at TEXT NOT NULL
                );
                INSERT INTO texts
                  (id, text, created_at, updated_at)
                VALUES ('text-1', 'Existing Text', '2026-01-01', '2026-01-01');
                INSERT INTO text_attachments
                  (id, text_id, original_file_name, storage_key, mime_type,
                   byte_size, sha256, created_at)
                VALUES ('file-1', 'text-1', 'existing.pdf',
                        'texts/text-1/file-1.pdf', 'application/pdf', 12,
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        '2026-01-01');
                PRAGMA user_version = 9;
                """
            )
            database_server.ensure_schema(connection, database_path)
            migrated = connection.execute(
                """SELECT original_file_name, display_name, mime_type, sort_order,
                          display_storage_key, last_page
                     FROM text_attachments WHERE id = 'file-1'"""
            ).fetchone()
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 10)
            self.assertEqual(migrated["display_name"], "existing.pdf")
            self.assertEqual(migrated["mime_type"], "application/pdf")
            self.assertEqual(migrated["sort_order"], 1)
            self.assertIsNone(migrated["display_storage_key"])
            self.assertEqual(migrated["last_page"], 1)
            connection.close()


class TextIdentityApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="sermon-text-identity-")
        cls.data_path = Path(cls.temporary.name)
        cls.db_path = cls.data_path / "sermon-register.db"
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        environment = os.environ.copy()
        environment.update(
            {
                "SERMON_DB_PATH": str(cls.db_path),
                "SERMON_UPLOADS_PATH": str(cls.data_path / "uploads"),
                "API_HOST": "127.0.0.1",
                "API_PORT": str(cls.port),
                "APP_ORIGIN": "http://localhost:3000",
            }
        )
        cls.process = subprocess.Popen(
            [sys.executable, str(SERVER)],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                cls.request("GET", "/texts")
                break
            except OSError:
                time.sleep(0.1)
        else:
            output = cls.process.stdout.read() if cls.process.stdout else ""
            raise RuntimeError(f"Database server did not start: {output}")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
        if cls.process.stdout:
            cls.process.stdout.close()
        cls.temporary.cleanup()

    @classmethod
    def request(cls, method, path, payload=None, expected=200):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"http://127.0.0.1:{cls.port}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urlopen(request, timeout=5) as response:
                body = json.loads(response.read().decode("utf-8"))
                if response.status != expected:
                    raise AssertionError(
                        f"Expected HTTP {expected}, received {response.status}: {body}"
                    )
                return body
        except HTTPError as error:
            body = json.loads(error.read().decode("utf-8"))
            if error.code != expected:
                raise AssertionError(
                    f"Expected HTTP {expected}, received {error.code}: {body}"
                )
            return body

    @classmethod
    def create_service(cls, text, service_type="LEHR", date="2026-08-01"):
        return cls.request(
            "POST",
            "/services",
            {
                "date": date,
                "type": service_type,
                "song": "",
                "songBy": "",
                "text": text,
                "textBy": "",
                "vorrade": "",
                "vorradeBy": "",
                "status": "IN_PROGRESS" if service_type == "LEHR" else "",
                "progressIntent": "START" if service_type == "LEHR" else "AUTO",
                "completed": False,
                "notes": "",
            },
            201,
        )

    @classmethod
    def edit_service(cls, service, text, action, target_id=""):
        return cls.request(
            "PUT",
            "/services",
            {
                "id": service["id"],
                "date": service["service_date"],
                "type": service["service_type"],
                "song": service.get("song") or "",
                "songBy": service.get("song_by") or "",
                "text": text,
                "currentTextId": service["text_id"],
                "textAction": action,
                "targetTextId": target_id,
                "textBy": service.get("text_by") or "",
                "vorrade": service.get("vorrade") or "",
                "vorradeBy": service.get("vorrade_by") or "",
                "status": "",
                "progressIntent": "START",
                "completed": False,
                "statusChanged": False,
                "progressChanged": False,
                "notes": service.get("notes") or "",
            },
        )

    def test_rename_relink_cleanup_merge_and_progress_safety(self):
        original = self.create_service("Original Text")
        original_progress = original["progress_id"]
        continuation = self.create_service("Original Text", "GEBET", "2026-08-02")
        self.assertEqual(continuation["progress_id"], original_progress)
        renamed = self.edit_service(original, "Original Text: Corrected", "RENAME")
        self.assertEqual(renamed["text_id"], original["text_id"])
        self.assertEqual(renamed["progress_id"], original_progress)
        self.assertEqual(renamed["text_action"], "RENAMED")
        self.assertEqual(renamed["affected_service_count"], 2)
        renamed_services = [
            service
            for service in self.request("GET", "/services")
            if service["id"] in (original["id"], continuation["id"])
        ]
        self.assertTrue(
            all(service["text_title"] == "Original Text: Corrected" for service in renamed_services)
        )
        self.assertEqual(
            [record["text"] for record in self.request("GET", "/texts")],
            ["Original Text: Corrected"],
        )

        linked = self.create_service("Linked Existing Text", "LEHR", "2026-08-05")
        linked_progress = linked["progress_id"]
        linked_target = self.request(
            "POST",
            "/texts",
            {"text": "Different Existing Text", "description": "", "tags": []},
            201,
        )
        linked_result = self.edit_service(
            linked, linked_target["text"], "RELINK", linked_target["id"]
        )
        self.assertEqual(linked_result["progress_id"], linked_progress)
        self.assertFalse(linked_result["removed_old_text"])
        progress_connection = sqlite3.connect(self.db_path)
        try:
            progress_text_id = progress_connection.execute(
                "SELECT text_id FROM lehr_progress WHERE id = ?", (linked_progress,)
            ).fetchone()[0]
        finally:
            progress_connection.close()
        self.assertEqual(progress_text_id, linked["text_id"])

        legacy = self.create_service("Legacy Typo", "GEBET", "2025-12-27")
        connection = sqlite3.connect(self.db_path)
        try:
            connection.execute(
                "DELETE FROM lehr_progress_services WHERE service_id = ?", (legacy["id"],)
            )
            connection.execute(
                "DELETE FROM lehr_progress WHERE start_service_id = ?", (legacy["id"],)
            )
            connection.commit()
        finally:
            connection.close()
        target = self.request(
            "POST",
            "/texts",
            {"text": "Legacy Correct", "description": "", "tags": []},
            201,
        )
        relinked = self.edit_service(legacy, target["text"], "RELINK", target["id"])
        self.assertEqual(relinked["text_id"], target["id"])
        self.assertIsNone(relinked["progress_id"])
        self.assertTrue(relinked["removed_old_text"])
        self.assertNotIn(
            "Legacy Typo", [record["text"] for record in self.request("GET", "/texts")]
        )

        disposable = self.create_service("Delete Empty Text", "LEHR", "2026-08-09")
        deletion = self.request("DELETE", "/services", {"id": disposable["id"]})
        self.assertTrue(deletion["removed_text"])
        self.assertNotIn(
            "Delete Empty Text",
            [record["text"] for record in self.request("GET", "/texts")],
        )

        source = self.request(
            "POST",
            "/texts",
            {
                "text": "Merge Source",
                "description": "Source Description",
                "scriptureReference": "",
                "songsForText": "",
                "notes": "Source Notes",
                "tags": ["Faith"],
            },
            201,
        )
        merge_target = self.request(
            "POST",
            "/texts",
            {
                "text": "Merge Target",
                "description": "Target Description",
                "scriptureReference": "John 3:16",
                "songsForText": "",
                "notes": "",
                "tags": ["Christmas"],
            },
            201,
        )
        source_service = self.create_service("Merge Source", "LEHR", "2026-08-10")
        self.request(
            "POST",
            "/text-attachments",
            {
                "textId": source["id"],
                "fileName": "source.pdf",
                "mimeType": "application/pdf",
                "data": base64.b64encode(b"%PDF-1.4\n%%EOF\n").decode("ascii"),
            },
            201,
        )
        merged = self.request(
            "PUT",
            "/texts",
            {
                "id": source["id"],
                "text": merge_target["text"],
                "description": source["description"],
                "scriptureReference": source["scripture_reference"],
                "songsForText": source["songs_for_text"],
                "notes": source["notes"],
                "tags": ["Faith"],
                "mergeTargetId": merge_target["id"],
                "mergeChoices": {"description": "TARGET"},
            },
        )
        self.assertEqual(merged["id"], merge_target["id"])
        self.assertEqual(merged["description"], "Target Description")
        self.assertEqual(merged["notes"], "Source Notes")
        self.assertEqual({tag["name"] for tag in merged["tag_records"]}, {"Faith", "Christmas"})
        self.assertEqual(merged["attachment_count"], 1)
        merged_service = next(
            row for row in self.request("GET", "/services") if row["id"] == source_service["id"]
        )
        self.assertEqual(merged_service["text_id"], merge_target["id"])
        self.assertEqual(merged_service["progress_id"], source_service["progress_id"])

    def test_times_used_counts_starts_and_legacy_unlinked_gebets(self):
        lehr = self.create_service("Usage Lehr", "LEHR", "2026-01-01")
        lehr_continuation = self.create_service(
            "Usage Lehr", "GEBET", "2026-01-02"
        )
        self.assertEqual(lehr_continuation["progress_id"], lehr["progress_id"])

        gebet_start = self.create_service(
            "Usage Gebet Start", "GEBET", "2026-02-01"
        )
        gebet_continuation = self.create_service(
            "Usage Gebet Start", "GEBET", "2026-02-02"
        )
        self.assertEqual(
            gebet_continuation["progress_id"], gebet_start["progress_id"]
        )

        legacy_first = self.create_service(
            "Usage Legacy Gebet", "GEBET", "2025-01-01"
        )
        legacy_second = self.create_service(
            "Usage Legacy Gebet", "GEBET", "2025-06-01"
        )
        connection = sqlite3.connect(self.db_path)
        try:
            connection.execute(
                "DELETE FROM lehr_progress_services WHERE service_id IN (?, ?)",
                (legacy_first["id"], legacy_second["id"]),
            )
            connection.execute(
                "DELETE FROM lehr_progress WHERE text_id = ?",
                (legacy_first["text_id"],),
            )
            connection.commit()
        finally:
            connection.close()

        mixed_gebet = self.create_service(
            "Usage Mixed Starts", "GEBET", "2026-03-01"
        )
        mixed_lehr = self.create_service(
            "Usage Mixed Starts", "LEHR", "2026-04-01"
        )
        self.assertNotEqual(mixed_gebet["progress_id"], mixed_lehr["progress_id"])
        self.request(
            "POST",
            "/texts",
            {"text": "Usage Never Used", "description": "", "tags": []},
            201,
        )

        texts = {row["text"]: row for row in self.request("GET", "/texts")}
        self.assertEqual(texts["Usage Never Used"]["times_used"], 0)
        self.assertEqual(texts["Usage Never Used"]["usage_history"], [])
        self.assertEqual(texts["Usage Lehr"]["times_used"], 1)
        self.assertEqual(texts["Usage Lehr"]["last_used"], "2026-01-01")
        self.assertEqual(
            texts["Usage Lehr"]["usage_history"],
            [{"id": lehr["id"], "date": "2026-01-01", "type": "LEHR"}],
        )
        self.assertEqual(texts["Usage Gebet Start"]["times_used"], 1)
        self.assertEqual(texts["Usage Gebet Start"]["last_used"], "2026-02-01")
        self.assertEqual(
            texts["Usage Gebet Start"]["usage_history"],
            [{"id": gebet_start["id"], "date": "2026-02-01", "type": "GEBET"}],
        )
        self.assertEqual(texts["Usage Legacy Gebet"]["times_used"], 2)
        self.assertEqual(texts["Usage Legacy Gebet"]["last_used"], "2025-06-01")
        self.assertEqual(
            texts["Usage Legacy Gebet"]["usage_history"],
            [
                {"id": legacy_second["id"], "date": "2025-06-01", "type": "GEBET"},
                {"id": legacy_first["id"], "date": "2025-01-01", "type": "GEBET"},
            ],
        )
        self.assertEqual(texts["Usage Mixed Starts"]["times_used"], 2)
        self.assertEqual(texts["Usage Mixed Starts"]["last_used"], "2026-04-01")
        self.assertEqual(
            texts["Usage Mixed Starts"]["usage_history"],
            [
                {"id": mixed_lehr["id"], "date": "2026-04-01", "type": "LEHR"},
                {"id": mixed_gebet["id"], "date": "2026-03-01", "type": "GEBET"},
            ],
        )

    def test_z_photo_pdf_attachment_management_and_backup_files(self):
        text = self.request(
            "POST",
            "/texts",
            {"text": "Attachment Test", "description": "", "tags": []},
            201,
        )
        original_photo = b"\xff\xd8\xff\xe0original-photo"
        display_photo = b"\xff\xd8\xff\xe0optimized-photo"
        photo = self.request(
            "POST",
            "/text-attachments",
            {
                "textId": text["id"],
                "fileName": "notes.heic",
                "displayName": "Attachment Test - Notes.jpg",
                "mimeType": "image/jpeg",
                "data": base64.b64encode(original_photo).decode("ascii"),
                "displayData": base64.b64encode(display_photo).decode("ascii"),
                "displayMimeType": "image/jpeg",
                "crop": {"unit": "%", "x": 0, "y": 0, "width": 100, "height": 100},
                "rotation": 0,
            },
            201,
        )
        pdf = self.request(
            "POST",
            "/text-attachments",
            {
                "textId": text["id"],
                "fileName": "sermon.pdf",
                "displayName": "Sermon Notes.pdf",
                "mimeType": "application/pdf",
                "data": base64.b64encode(b"%PDF-1.4\n%%EOF\n").decode("ascii"),
            },
            201,
        )
        attachments = self.request(
            "GET", f"/text-attachments?textId={text['id']}"
        )
        self.assertEqual([row["id"] for row in attachments], [photo["id"], pdf["id"]])
        self.assertEqual(photo["mime_type"], "image/jpeg")
        self.assertEqual(photo["display_name"], "Attachment Test - Notes.jpg")

        renamed = self.request(
            "PUT",
            "/text-attachments",
            {"id": photo["id"], "action": "RENAME", "displayName": "My Notes.jpg"},
        )
        self.assertEqual(renamed["display_name"], "My Notes.jpg")
        positioned = self.request(
            "PUT",
            "/text-attachments",
            {"id": pdf["id"], "action": "POSITION", "lastPage": 3, "lastOffset": 0.4},
        )
        self.assertEqual(positioned["last_page"], 3)
        reordered = self.request(
            "PUT",
            "/text-attachments",
            {
                "textId": text["id"],
                "action": "REORDER",
                "ids": [pdf["id"], photo["id"]],
            },
        )
        self.assertEqual([row["id"] for row in reordered], [pdf["id"], photo["id"]])

        with urlopen(
            f"http://127.0.0.1:{self.port}/text-attachments?fileId={photo['id']}",
            timeout=5,
        ) as response:
            self.assertEqual(response.headers.get_content_type(), "image/jpeg")
            self.assertEqual(response.read(), display_photo)
        with urlopen(
            f"http://127.0.0.1:{self.port}/text-attachments?fileId={photo['id']}&original=1",
            timeout=5,
        ) as response:
            self.assertEqual(response.read(), original_photo)

        connection = sqlite3.connect(self.db_path)
        try:
            storage_keys = connection.execute(
                """SELECT storage_key, display_storage_key
                     FROM text_attachments WHERE id = ?""",
                (photo["id"],),
            ).fetchone()
        finally:
            connection.close()
        self.assertTrue((self.data_path / "uploads" / storage_keys[0]).is_file())
        self.assertTrue((self.data_path / "uploads" / storage_keys[1]).is_file())
        self.request("DELETE", "/text-attachments", {"id": photo["id"]})
        self.assertFalse((self.data_path / "uploads" / storage_keys[0]).exists())
        self.assertFalse((self.data_path / "uploads" / storage_keys[1]).exists())


if __name__ == "__main__":
    unittest.main()
