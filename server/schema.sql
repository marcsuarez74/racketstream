-- Schéma SQLite du backend VPS (phase 8). Équivalent des migrations Supabase,
-- avec les contraintes ajoutées : UNIQUE(channel), UNIQUE(device_key_hash),
-- matches.owner_id lié à la clé. Dates en ms epoch, JSON sérialisé en TEXT.
PRAGMA user_version = 1;

CREATE TABLE devices (
  id              INTEGER PRIMARY KEY,
  device_key_hash TEXT NOT NULL UNIQUE,
  channel         TEXT NOT NULL UNIQUE,
  label           TEXT,
  se_channel_id   TEXT,
  se_jwt          TEXT,
  format          TEXT NOT NULL DEFAULT 'simple',
  name1           TEXT NOT NULL DEFAULT 'MOI',
  name1b          TEXT NOT NULL DEFAULT '',
  name2           TEXT NOT NULL DEFAULT 'LUI',
  name2b          TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE TABLE matches (
  match_id   TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES devices(id),
  device_id  TEXT NOT NULL,            -- UUID d'install envoyé par la montre (informatif)
  channel    TEXT NOT NULL,
  config     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished','archived')),
  started_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);
CREATE INDEX matches_channel_started ON matches(channel, started_at DESC);
CREATE INDEX matches_owner_status ON matches(owner_id, status);

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES matches(match_id),
  sequence   INTEGER NOT NULL CHECK (sequence > 0),
  type       INTEGER NOT NULL CHECK (type BETWEEN 0 AND 5),
  arg        INTEGER NOT NULL DEFAULT 0,
  prev_me    INTEGER,
  prev_opp   INTEGER,
  ts         INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  UNIQUE (match_id, sequence)
);

CREATE TABLE match_state (
  match_id      TEXT PRIMARY KEY REFERENCES matches(match_id),
  status        TEXT NOT NULL CHECK (status IN ('active','set_result','match_finished')),
  current_set   INTEGER NOT NULL DEFAULT 1,
  score_me      INTEGER NOT NULL DEFAULT 0,
  score_opp     INTEGER NOT NULL DEFAULT 0,
  sets_me       INTEGER NOT NULL DEFAULT 0,
  sets_opp      INTEGER NOT NULL DEFAULT 0,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  config        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE chat_announce (
  channel    TEXT PRIMARY KEY,
  last_text  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
