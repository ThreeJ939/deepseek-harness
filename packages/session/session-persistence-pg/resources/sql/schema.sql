CREATE TABLE IF NOT EXISTS persistence_state (
  singleton INTEGER PRIMARY KEY,
  store_id  TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT,
  version          INTEGER NOT NULL,
  created_at       BIGINT NOT NULL,
  cwd              TEXT,
  parent_session   TEXT,
  seed_length      INTEGER,
  origin           TEXT,
  delegation_depth INTEGER,
  agent_preset     TEXT,
  incarnation      TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  is_owned         BOOLEAN NOT NULL DEFAULT FALSE,
  owner_pid        INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS events (
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  type              TEXT NOT NULL,
  time              BIGINT NOT NULL,
  data              JSONB NOT NULL,
  source_event_seqs JSONB,
  surface_op        TEXT,
  ignorable         BOOLEAN,
  PRIMARY KEY (session_id, seq)
);
