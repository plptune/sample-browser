-- Migration 2 : masquer des fichiers ou des dossiers (jamais de suppression, `is:hidden` pour les retrouver).
ALTER TABLE files ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
