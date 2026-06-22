CREATE TABLE IF NOT EXISTS match_directory (
  match_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'ended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_directory_waiting
  ON match_directory (status, created_at DESC);
