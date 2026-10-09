-- Migration 1 : index des fichiers, tags, collections, dossiers virtuels, réglages.
-- Les fichiers de l'utilisateur ne sont jamais modifiés : tout vit ici.

CREATE TABLE folders (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,  -- NULL = source
  path      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  offline   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX folders_parent ON folders(parent_id);

CREATE TABLE files (
  id          INTEGER PRIMARY KEY,
  folder_id   INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  path        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,           -- sans extension
  ext         TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mtime       INTEGER NOT NULL,        -- millisecondes depuis 1970
  duration_ms INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL,
  bit_depth   INTEGER NOT NULL,        -- 0 = sans objet (mp3, ogg)
  channels    INTEGER NOT NULL,
  bpm         REAL NULL,
  musical_key TEXT NULL,
  kind        TEXT NULL,               -- 'loop' | 'oneshot'
  fav         INTEGER NOT NULL DEFAULT 0,
  missing     INTEGER NOT NULL DEFAULT 0,
  peaks       BLOB NULL,
  analyzed_at INTEGER NULL
);
CREATE INDEX files_folder ON files(folder_id);
CREATE INDEX files_fav ON files(fav);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE file_tags (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id)
);
CREATE INDEX file_tags_tag ON file_tags(tag_id);

CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('manual', 'smart')),
  query      TEXT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, file_id)
);

CREATE TABLE virtual_folders (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER NULL REFERENCES virtual_folders(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  pinned    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE virtual_items (
  folder_id INTEGER NOT NULL REFERENCES virtual_folders(id) ON DELETE CASCADE,
  file_id   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (folder_id, file_id)
);

-- Sous-dossiers épinglés comme raccourcis dans Bibliothèque.
CREATE TABLE pinned_folders (
  folder_id INTEGER PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('favorites_pinned', '1');
