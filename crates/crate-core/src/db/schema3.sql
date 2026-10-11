-- Migration 3 : tags automatiques (posés par l'analyse, vocabulaire fermé) et tags en minuscules.
-- La recherche `#tag` est en minuscules : un tag « Kick » n'était pas trouvé.
UPDATE OR IGNORE tags SET name = lower(name);
-- `loop` / `oneshot` viennent désormais du type du sample (`type:`), affichés comme des tags.
DELETE FROM tags WHERE name IN ('loop', 'oneshot');

-- Hors de `file_tags` : un fichier disparu qui n'a que des tags automatiques n'est pas gardé (introuvable).
-- `rejected` = 1 : retiré à la main, jamais reposé par l'analyse.
CREATE TABLE file_auto_tags (
  file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  rejected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, tag_id)
);
CREATE INDEX file_auto_tags_tag ON file_auto_tags(tag_id);
