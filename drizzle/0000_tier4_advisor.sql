CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  client TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  primary_contact TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  advisor TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  workflow_state TEXT NOT NULL,
  next_action TEXT NOT NULL,
  due_date TEXT,
  last_contact TEXT,
  call_1_at TEXT,
  call_2_at TEXT,
  readiness_brief_status TEXT NOT NULL,
  readiness_brief_sent_at TEXT,
  baseline_status TEXT NOT NULL,
  engagement_folder TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  finding_status TEXT NOT NULL DEFAULT 'none',
  data_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  provenance TEXT NOT NULL,
  source_url TEXT,
  content TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  call_number INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  title TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  client TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  outcome TEXT NOT NULL,
  next_action TEXT NOT NULL,
  owner TEXT NOT NULL,
  source_link TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_engagement ON artifacts (engagement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_engagement ON transcripts (engagement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_engagement ON activities (engagement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intents_engagement ON intents (engagement_id, created_at DESC);
