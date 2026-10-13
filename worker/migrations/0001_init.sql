-- Append-only event log. `seq` is the sync cursor; (user_id, id) dedupes retries.
CREATE TABLE events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  ts          INTEGER NOT NULL,
  device      TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  data        TEXT    NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE (user_id, id)
);
CREATE INDEX events_user_seq ON events (user_id, seq);

-- Last-write-wins settings (mode, block lists, per-mode settings).
CREATE TABLE settings (
  user_id    TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
