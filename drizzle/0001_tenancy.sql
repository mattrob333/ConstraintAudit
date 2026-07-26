-- Row-level advisor tenancy. Every table carries the owner so an unscoped list query cannot
-- leak across advisors. SQLite has no `ADD COLUMN IF NOT EXISTS`; `ensureDatabase()` in
-- lib/store.ts performs the same reconciliation guarded by `PRAGMA table_info`, so on a database
-- the application has already booted against these ALTER statements are expected to be a no-op.

ALTER TABLE engagements ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE artifacts ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE transcripts ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE intents ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE intents ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE intents ADD COLUMN updated_at TEXT;
ALTER TABLE intents ADD COLUMN executed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_engagements_owner ON engagements (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_owner ON transcripts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intents_owner ON intents (owner_id, created_at DESC);
