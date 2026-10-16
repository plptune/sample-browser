-- Migration 4 : tags repris de la base locale de Splice (`splice`), à part des tags automatiques que chaque
-- analyse remplace. `rejected` = 1 : retiré à la main, jamais reposé par une synchronisation.
CREATE TABLE file_splice_tags (
  file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  rejected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, tag_id)
);
CREATE INDEX file_splice_tags_tag ON file_splice_tags(tag_id);
