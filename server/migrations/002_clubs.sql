-- Phase 10 : clubs multi-terrains. Un club possède des canaux (devices) ;
-- un canal sans club (club_id NULL) est un canal perso, comme avant.
CREATE TABLE clubs (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  club_key_hash TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

-- Codes d'invitation à usage unique (hachés) ; used_at et club_id remplis à l'usage.
CREATE TABLE club_invites (
  code_hash  TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  used_at    INTEGER,
  club_id    INTEGER REFERENCES clubs(id)
);

ALTER TABLE devices ADD COLUMN club_id  INTEGER REFERENCES clubs(id);
ALTER TABLE devices ADD COLUMN position INTEGER;
CREATE INDEX devices_club ON devices(club_id, position);

PRAGMA user_version = 2;
