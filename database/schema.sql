PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS texts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  scripture_reference TEXT,
  songs_for_text TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Sermon tags are reusable records linked to Texts. The legacy texts.tags
-- column is retained on upgraded databases only long enough to migrate data.
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS text_tags (
  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (text_id, tag_id)
);

CREATE TABLE IF NOT EXISTS vorraden (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
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
);

CREATE TABLE IF NOT EXISTS lehr_gebet_links (
  id TEXT PRIMARY KEY,
  lehr_service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  gebet_service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  lehr_status_after TEXT CHECK (lehr_status_after IN ('IN_PROGRESS', 'FINISHED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (lehr_service_id, sequence_number),
  UNIQUE (lehr_service_id, gebet_service_id),
  CHECK (lehr_service_id <> gebet_service_id)
);

-- Lehr Progress separates a teaching's start/continuation history from the
-- service type. A Lehr or a Gebet may start or continue the same progress.
CREATE TABLE IF NOT EXISTS lehr_progress (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE RESTRICT,
  start_service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE RESTRICT,
  status TEXT CHECK (status IN ('IN_PROGRESS', 'FINISHED')),
  completion_service_id TEXT REFERENCES services(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lehr_progress_services (
  progress_id TEXT NOT NULL REFERENCES lehr_progress(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  intent TEXT NOT NULL CHECK (intent IN ('START', 'CONTINUE', 'AUTO', 'LEGACY')),
  role_visible INTEGER NOT NULL DEFAULT 1 CHECK (role_visible IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (progress_id, service_id),
  UNIQUE (progress_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS validate_lehr_gebet_link_insert
BEFORE INSERT ON lehr_gebet_links
BEGIN
  SELECT CASE
    WHEN (SELECT service_type FROM services WHERE id = NEW.lehr_service_id) <> 'LEHR'
      THEN RAISE(ABORT, 'lehr_service_id must reference a LEHR')
    WHEN (SELECT service_type FROM services WHERE id = NEW.gebet_service_id) <> 'GEBET'
      THEN RAISE(ABORT, 'gebet_service_id must reference a GEBET')
  END;
END;

CREATE TRIGGER IF NOT EXISTS validate_lehr_gebet_link_update
BEFORE UPDATE OF lehr_service_id, gebet_service_id ON lehr_gebet_links
BEGIN
  SELECT CASE
    WHEN (SELECT service_type FROM services WHERE id = NEW.lehr_service_id) <> 'LEHR'
      THEN RAISE(ABORT, 'lehr_service_id must reference a LEHR')
    WHEN (SELECT service_type FROM services WHERE id = NEW.gebet_service_id) <> 'GEBET'
      THEN RAISE(ABORT, 'gebet_service_id must reference a GEBET')
  END;
END;

CREATE TABLE IF NOT EXISTS service_attachments (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  original_file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_imports (
  source_key TEXT PRIMARY KEY,
  service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  source_file_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 1),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS text_attachments (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  original_file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vorrade_attachments (
  id TEXT PRIMARY KEY,
  vorrade_id TEXT NOT NULL REFERENCES vorraden(id) ON DELETE CASCADE,
  original_file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS services_date_idx ON services(service_date DESC);
CREATE INDEX IF NOT EXISTS services_type_date_idx ON services(service_type, service_date DESC);
CREATE INDEX IF NOT EXISTS services_song_idx ON services(song_id);
CREATE INDEX IF NOT EXISTS services_song_by_idx ON services(song_by_person_id);
CREATE INDEX IF NOT EXISTS services_text_idx ON services(text_id);
CREATE INDEX IF NOT EXISTS services_text_by_idx ON services(text_by_person_id);
CREATE INDEX IF NOT EXISTS services_vorrade_idx ON services(vorrade_id);
CREATE INDEX IF NOT EXISTS services_vorrade_by_idx ON services(vorrade_by_person_id);
CREATE INDEX IF NOT EXISTS people_name_idx ON people(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS texts_text_idx ON texts(text COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS texts_scripture_idx ON texts(scripture_reference COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS tags_name_idx ON tags(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS text_tags_tag_idx ON text_tags(tag_id, text_id);
CREATE INDEX IF NOT EXISTS vorraden_title_idx ON vorraden(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS songs_title_idx ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS service_attachments_owner_idx ON service_attachments(service_id);
CREATE INDEX IF NOT EXISTS vorrade_attachments_owner_idx ON vorrade_attachments(vorrade_id);
CREATE INDEX IF NOT EXISTS service_imports_service_idx ON service_imports(service_id);
CREATE INDEX IF NOT EXISTS text_attachments_owner_idx ON text_attachments(text_id);
CREATE INDEX IF NOT EXISTS lehr_progress_text_status_idx
  ON lehr_progress(text_id, status);
CREATE INDEX IF NOT EXISTS lehr_progress_services_progress_idx
  ON lehr_progress_services(progress_id, sequence_number);

PRAGMA user_version = 9;
