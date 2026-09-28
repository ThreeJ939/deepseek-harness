INSERT INTO sessions
  (id, owner_id, version, created_at, cwd, parent_session, seed_length, origin,
   delegation_depth, agent_preset, incarnation, revision)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET
  owner_id = excluded.owner_id,
  version = excluded.version,
  created_at = excluded.created_at,
  cwd = excluded.cwd,
  parent_session = excluded.parent_session,
  seed_length = excluded.seed_length,
  origin = excluded.origin,
  delegation_depth = excluded.delegation_depth,
  agent_preset = excluded.agent_preset;
