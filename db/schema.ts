import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const engagements = sqliteTable("engagements", {
  id: text("id").primaryKey(),
  client: text("client").notNull(),
  website: text("website").notNull().default(""),
  primaryContact: text("primary_contact").notNull().default(""),
  email: text("email").notNull().default(""),
  advisor: text("advisor").notNull().default(""),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  workflowState: text("workflow_state").notNull(),
  nextAction: text("next_action").notNull(),
  dueDate: text("due_date"),
  lastContact: text("last_contact"),
  call1At: text("call_1_at"),
  call2At: text("call_2_at"),
  readinessBriefStatus: text("readiness_brief_status").notNull(),
  readinessBriefSentAt: text("readiness_brief_sent_at"),
  baselineStatus: text("baseline_status").notNull(),
  engagementFolder: text("engagement_folder").notNull().default(""),
  notes: text("notes").notNull().default(""),
  findingStatus: text("finding_status").notNull().default("none"),
  dataJson: text("data_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  provenance: text("provenance").notNull(),
  sourceUrl: text("source_url"),
  content: text("content").notNull(),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const transcripts = sqliteTable("transcripts", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  callNumber: integer("call_number").notNull(),
  source: text("source").notNull(),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  title: text("title").notNull(),
  rawText: text("raw_text").notNull(),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  client: text("client").notNull(),
  activityType: text("activity_type").notNull(),
  summary: text("summary").notNull(),
  outcome: text("outcome").notNull(),
  nextAction: text("next_action").notNull(),
  owner: text("owner").notNull(),
  sourceLink: text("source_link"),
  createdAt: text("created_at").notNull(),
});

export const intents = sqliteTable("intents", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
});
