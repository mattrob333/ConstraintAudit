-- The client roster: the front of the pipeline, before any engagement exists. A row here is a
-- company the advisor might work with, never evidence about one. The store adds this table and
-- the intents.client_id column through its PRAGMA-guarded reconcile path, so this file is a
-- no-op against a database the application has already booted.
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  headcount_band TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'none',
  engagement_id TEXT NOT NULL DEFAULT '',
  invited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients (owner_id, updated_at DESC);
--> statement-breakpoint
-- An audit invitation is scoped to a roster client, not to an engagement. Exactly one of
-- engagement_id and client_id is set on any intent row.
ALTER TABLE intents ADD COLUMN client_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_intents_client ON intents (client_id, created_at DESC);
