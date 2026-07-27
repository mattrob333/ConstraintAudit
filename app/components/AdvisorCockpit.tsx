"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";

const stages = ["Client", "Research", "Prepare", "Call", "Synthesize", "Deliver", "Operate"] as const;
type Stage = (typeof stages)[number];
type Screen =
  | "home" | "intake" | "migration" | "engagements" | "research" | "prepare"
  | "call" | "transcript" | "synthesis" | "findings" | "findings-call" | "deliver" | "sprint"
  | "measure" | "catalog" | "actions" | "integrations" | "settings";
type Tone = "neutral" | "known" | "inferred" | "assumed" | "missing" | "success";
/** Mirrors WORKFLOW_STATES in lib/workflow.ts, in canonical order. */
const workflowStates = [
  "RECON_DRAFT", "GUIDED_CANVAS_COMPLETE", "TRANSCRIPT_1_SYNTHESIZED", "CANVAS_COMMIT_APPROVED",
  "FINDINGS_CALL_COMPLETE", "TRANSCRIPT_2_RECONCILED", "DIAGNOSIS_APPROVED", "SPRINT_ACTIVE",
  "OUTCOME_MEASURED", "CATALOG_WRITTEN",
] as const;
type WorkflowState = (typeof workflowStates)[number];
type Engagement = {
  id: string; companyName: string; website: string; stage: Stage; workflowState: WorkflowState | null;
  status: string; nextAction: string; updatedAt: string; primaryContact: string;
  primaryContactRole: string; email: string; call1At: string | null; call2At: string | null;
};
type DocumentItem = {
  id: string; name: string; kind: "workflow" | "generated";
  status: "approved" | "draft" | "provisional"; href?: string;
};
type ConsentRecord = { grantedBeforeCapture: boolean; attestedBy: string; attestedAt: string; note?: string };
type BackendEngagement = {
  id: string; client: string; website: string; stage: string; status: string;
  nextAction: string; updatedAt: string; version: number;
  workflowState: string; primaryContact: string; primaryContactRole: string; email: string;
  call1At: string | null; call2At: string | null; notes: string; readinessBriefStatus: string;
  data?: {
    research?: ResearchPayload; transcriptSynthesis?: TranscriptSynthesis[]; canvas?: CanvasRecord;
    sprint?: SprintRecord; outcome?: OutcomeMeasurement; catalogEntry?: CatalogEntry;
    recordingConsent?: Partial<Record<"call1" | "call2", ConsentRecord>>;
  };
};
/** An artifact row as `GET /api/engagements/:id` and the deliverables endpoint return it. */
type ArtifactRecord = { id: string; kind: string; title: string; status: string; created_at: string };
/** What `executeIntent` stored on the last execution attempt. `not-configured` means nothing was attempted. */
type IntentResult = { ok?: boolean; status?: string; provider?: string; detail?: string; externalUrl?: string };
/** `document.data` of the findings agenda. Only `evidence` carries the client's own words. */
type FindingsAgendaSection = {
  heading: string; body: string;
  evidence: Array<{ quote: string; speaker: string; timestamp: string }>;
};
type FindingsAgendaDocument = { id: string; title: string; content: string; data?: { sections?: FindingsAgendaSection[] } };

type EvidenceStatus = "public-research" | "advisor-note" | "gap";
type DiscoverySection = "demand" | "promise" | "flow" | "constraint" | "baseline" | "roles" | "feasibility";
type EvidenceClaim = { statement: string; provenance: string; confidence?: number; sourceLabel?: string; sourceUrl?: string; canvasBlock?: string };
type CanvasRecord = Record<string, EvidenceClaim[]>;
type ValueFlowStep = {
  id: string; order: number; name: string; description: string; input: string; output: string;
  actor: string; system: string; evidenceStatus: EvidenceStatus; sourceUrls: string[];
  confidence: number; confirmationQuestion: string;
};
type DiscoveryQuestion = {
  id: string; section: DiscoverySection; question: string; whyItMatters: string; publicAssumption: string;
  sourceUrls: string[]; evidenceStatus: EvidenceStatus; canvasBlock?: string; flowStepId?: string;
  expectedAnswerType: "narrative" | "number" | "person" | "choice"; required: boolean; followUps: string[];
};
type SprintTask = { id: string; task: string; owner: string; status: "todo" | "in_progress" | "done" };
type Metric = { name: string; value: string; unit: string; period: string; source: string };
type SprintRecord = {
  sprintId: string; constraintId: string; constraintType?: "capacity" | "latency" | "quality" | "knowledge" | "policy"; activatedAt: string; activatedBy: string; prescription: string;
  humanOwner: { name: string; role: string }; startingMetric: Metric; measurementClockStartedAt: string; tasks: SprintTask[];
};
/** Which way a metric has to move to count as an improvement, and how that was decided. Server-owned. */
type DirectionSource = "advisor" | "unit-table" | "metric-semantics" | "model" | "none";
type DirectionInference = {
  improvedWhen: "higher" | "lower" | null;
  source: DirectionSource;
  basis: string;
  confidence: number;
  ambiguous?: boolean;
};
type OutcomeMeasurement = {
  measuredAt: string; measuredBy: string; startingMetric: Metric; endingMetric: Metric;
  delta: {
    absolute: string;
    percent: string;
    direction: "increased" | "decreased" | "unchanged";
    interpretation: "improved" | "worsened" | "unchanged" | "not-interpreted";
  } | null;
  deltaBlockedReason?: string; constraintMoved: boolean; nextConstraintObserved: string;
  improvedWhen?: "higher" | "lower";
  directionInference?: DirectionInference;
};
type CatalogEntry = {
  entryId: string; constraintType: string; canvasBlock: string; pattern: string; prescription: string;
  measuredResult: string; industryContext: string; reusableFor: string; writtenAt: string;
};
type IntentItem = {
  id: string; engagement_id: string; type: string; status: string;
  payload: unknown; created_at: string; executed_at?: string | null; result?: IntentResult | null;
};
type IntegrationItem = {
  id: string; name: string; status: string; mode: string; setup?: string;
  environmentVariables?: string[]; model?: string; resource?: { name: string; url: string };
};
/** Mirrors the advisor-scoped connection settings behind GET/PUT /api/settings. Non-secret only — never a key. */
type AdvisorSettings = { crmSpreadsheetId: string; crmSheetTab: string; driveFolderId: string; fromName: string };
/** The providers POST /api/settings/test accepts. Mirrors the server's testable set exactly. */
type SettingsTestProvider = "openai" | "resend" | "google_sheets" | "google_docs" | "fireflies";
/** The `result` POST /api/settings/test returns. `detail` is human-readable and never contains a secret. */
type SettingsTestResult = { ok?: boolean; status?: string; provider?: string; detail?: string };
type TranscriptFile = { name: string; mimeType: string; content: string; encoding: "utf8" | "base64" };

type ResearchPayload = {
  title: string; description: string; sourceUrl: string; fetchStatus: string;
  facts: EvidenceClaim[];
  gaps: string[];
  constraintHypotheses: Array<{ canvasBlock: string; type: string; evidenceHint: string; confirmationCondition: string; killCondition: string }>;
  valueFlow?: ValueFlowStep[];
  discoveryQuestions?: DiscoveryQuestion[];
  researchMode?: "deterministic" | "openai-web-search";
  providerStatus?: "used" | "not-configured" | "failed";
  providerModel?: string;
  sourceCount?: number;
};
type TranscriptSynthesis = {
  baselineStatus: "Missing" | "Partial" | "Confirmed";
  gaps: string[];
  quotes: Array<{ speaker: string; timestamp: string; text: string; reason?: string; provenance: string }>;
  constraintCandidate: null | {
    canvasBlock: string; constraintType: string; findingStatus: string;
    evidence: Array<{ quote: string; speaker: string; timestamp: string; provenance: string }>;
    prescription: { description: string; whySmallestIntervention: string };
    baselineMetric: { name: string; value: string; unit: string; period: string; source: string };
  };
  analysisMode?: "deterministic" | "model-assisted";
  modelStatus?: "used" | "not-configured" | "failed";
  providerModel?: string;
  /** The model's reading of the call. Advisor-note provenance always — never client evidence. */
  narrative?: string;
  /** Model output that failed the evidence check, kept visible so a silent drop is never mistaken for silence. */
  groundingRejections?: Array<{ kind: string; reason: string; text: string }>;
};

const canvasBlocks = [
  { title: "Key partners", area: "partners" },
  { title: "Key activities", area: "activities" },
  { title: "Key resources", area: "resources" },
  { title: "Value propositions", area: "value" },
  { title: "Customer relationships", area: "relationships" },
  { title: "Channels", area: "channels" },
  { title: "Customer segments", area: "segments" },
  { title: "Cost structure", area: "cost" },
  { title: "Revenue streams", area: "revenue" },
] as const;

const discoverySections = ["demand", "promise", "flow", "constraint", "baseline", "roles", "feasibility"] as const;

const sectionLabels: Record<DiscoverySection, string> = {
  demand: "How demand enters",
  promise: "What you promise and sell",
  flow: "How work moves",
  constraint: "Where work waits or loops",
  baseline: "Numbers that anchor the diagnosis",
  roles: "Who touches the constrained flow",
  feasibility: "What can actually change",
};

/* ===========================================================================
 * ADVISOR COACHING LAYER — copy and data
 * ---------------------------------------------------------------------------
 * Everything from here to the end of this block is guidance the ADVISOR reads
 * or says. It is not evidence. It is never client-stated, never enters quotes,
 * metrics, the Canvas, or a transcript, and it is never posted to an evidence
 * endpoint. The only place any of it can be persisted is the advisor's own gap
 * register (see `mergeGapNotes`), which writes to the engagement's free-text
 * notes under an explicit "advisor" heading.
 *
 * It is also never rendered while the call view is being shared with a client.
 * The single gate for that is <AdvisorOnly hidden={…} />, which returns null —
 * the coaching is absent from the DOM, not merely styled out of view.
 * =========================================================================== */

/** The three call answers, in the order they appear. Index 2 is the unknown. */
const answerChoices = ["That’s right", "Correct it", "We don’t know yet"] as const;
const UNKNOWN_ANSWER: string = answerChoices[2];

type CoachTab = "followups" | "unknown" | "steer" | "objections" | "glossary";

const coachTabs: Array<{ id: CoachTab; label: string; icon: IconName }> = [
  { id: "followups", label: "Go deeper", icon: "search" },
  { id: "unknown", label: "They don’t know", icon: "info" },
  { id: "steer", label: "Steer back", icon: "refresh" },
  { id: "objections", label: "Pushback", icon: "shield" },
  { id: "glossary", label: "Plain English", icon: "document" },
];

/** A spoken noun phrase for each section, dropped into the steer-back lines. */
const sectionTopic: Record<DiscoverySection, string> = {
  demand: "how work comes in the door",
  promise: "what you actually sell them",
  flow: "how a job moves through the business",
  constraint: "where the work waits",
  baseline: "the rough numbers",
  roles: "who does what",
  feasibility: "what could realistically change",
};

/** Derived probes for a thin or hedged answer, chosen by what the question asked for. */
const probesByAnswerType: Record<DiscoveryQuestion["expectedAnswerType"], string[]> = {
  narrative: [
    "Can you walk me through the last real one, start to finish?",
    "And then what happens — who picks it up next?",
    "Where does that usually go wrong?",
  ],
  number: [
    "Roughly — is that closer to five or fifty?",
    "Take a normal month, not your best one. What does that look like?",
    "You don’t have to be exact. What would you guess, and how far out could you be?",
  ],
  person: [
    "Who specifically, by name?",
    "Is that the person who does it, or the person who signs it off?",
    "And if they’re away that week, who does it instead?",
  ],
  choice: [
    "If you had to pick one, which is it most of the time?",
    "How often does it go the other way?",
    "What makes it go one way rather than the other?",
  ],
};

/** Always available, whatever the question is. These reopen an answer that closed too early. */
const universalProbes = [
  "Say more about that.",
  "When did you last see that happen?",
  "What does that cost you when it goes wrong?",
];

/** For “I don’t know”, “it depends”, “I’d have to check”. An unknown is information, not a dead end. */
const unknownProbes = [
  "That’s completely fine — who in the business would know?",
  "What would we have to look at to find out? A report, an inbox, a spreadsheet?",
  "Give me your gut number and we’ll write it down as a guess. A rough figure beats a blank.",
  "Is it that nobody knows, or that nobody has looked?",
];

/** Literal phrases for bringing a wandering client back without being rude. */
function steerLines(section: DiscoverySection): string[] {
  const topic = sectionTopic[section] ?? "the question we were on";
  return [
    `That’s really useful — can I bring you back to ${topic} for a second?`,
    `I want to come back to that, and I’m writing it down so we don’t lose it. First, ${topic}.`,
    `Hold that thought — it might be the more interesting problem. Can we finish ${topic} first?`,
    `Let me park that one. Back to ${topic} — where were we?`,
  ];
}

/** Predictable pushback and a one-line answer the advisor can say as written. */
const objectionScripts: Array<[string, string]> = [
  ["We already tried that.", "Then you know more about it than I do. What did you try, and what made it stop working? That usually tells us where the real limit is."],
  ["That’s just how it is in this industry.", "You might be right. I’d still like to know what it would take to change it — even if the honest answer turns out to be “nothing worth doing”."],
  ["I don’t have those numbers.", "That’s fine, and it’s useful on its own. Give me your best guess and we’ll mark it as a guess. If nobody has the number, that’s often the first thing worth fixing."],
  ["Is this going to turn into a big project?", "No. We’re looking for one step to change, not a transformation. If it does turn out to be big, we’ll tell you it’s big and you can say no."],
  ["Can’t you just tell us what’s wrong?", "I could guess now and I’d probably be wrong. Give me twenty more minutes of how the work actually moves and it’s usually obvious to both of us."],
  ["Everyone’s flat out — everything is a bottleneck.", "That’s how it feels, and it’s almost never true. Usually one step sets the pace and the rest is noise. That’s the one I’m hunting."],
  ["Why are you asking about that? It isn’t the problem.", "Fair. I’m not assuming it is. I’m ruling it out, so that when I do point at something you know I looked everywhere else first."],
  ["We don’t really have a process.", "Everybody has one, it’s just not written down. Tell me what happened with the last job and I’ll write it down for you."],
];

/** Plain-English vocabulary, written for an owner-operator. `say` is the line to use out loud. */
const glossaryTerms: Array<{ term: string; plain: string; say: string }> = [
  {
    term: "Constraint",
    plain: "The one step that limits how much work the whole business can finish. Speed up any other step and the total does not move.",
    say: "A constraint is the one step that sets the pace for everything else. If we fix the wrong step, you finish exactly as much work next month as you did this month.",
  },
  {
    term: "Throughput",
    plain: "How much finished work actually comes out of the far end in a period. Not how much started, and not how busy anyone is.",
    say: "Throughput is just how many jobs you actually finish in a month. Not how many you start — how many are done and paid for.",
  },
  {
    term: "Bottleneck",
    plain: "The everyday word for a constraint. Use it when “constraint” sounds academic.",
    say: "It’s the narrow bit of the bottle. Everything upstream of it piles up, and everything downstream sits around waiting.",
  },
  {
    term: "Cycle time",
    plain: "How long one job takes from arriving to the customer calling it done — including every hour it spent waiting.",
    say: "Cycle time is the clock your customer feels. From the moment they ask to the moment they’ve got it, including every day it sat on somebody’s desk.",
  },
  {
    term: "Baseline",
    plain: "Today's number, written down before anything changes, so afterwards we can prove whether it moved.",
    say: "The baseline is just today’s number, written down before we touch anything. Without it we can’t tell you honestly whether anything got better.",
  },
  {
    term: "Queue",
    plain: "Work that has arrived but has not been started. The cheapest place to spot a constraint is wherever the queue is biggest.",
    say: "A queue is work that’s turned up but nobody has picked up yet. Wherever the pile is biggest is usually where the limit is.",
  },
  {
    term: "Rework",
    plain: "Work done a second time because the first pass was wrong, incomplete, or came back.",
    say: "Rework is anything you have to do twice. It burns the same hours as new work, and the customer never pays you for it.",
  },
  {
    term: "Single point of dependency",
    plain: "One person, system, or approval that everything has to pass through. Often the constraint, always a risk.",
    say: "Sometimes there’s one person everything has to go through. It works fine right up until they’re on holiday — and quietly, it caps how much you can do.",
  },
  {
    term: "Value flow",
    plain: "The real path a job takes from first contact to done, with every handoff and every wait in it. Not the org chart, not the ideal process.",
    say: "We’re mapping the actual route a job takes through your business. Not how it’s meant to go — how it went last Tuesday.",
  },
  {
    term: "Business Model Canvas block",
    plain: "One of nine boxes describing how the business works: who you serve, what you promise, how you deliver, what it costs, what it earns. Every finding is tagged to a box.",
    say: "It’s a one-page map of the business — who you serve, what you promise, how you deliver it, what it costs and what it earns. We use it so we’re both pointing at the same part of the business.",
  },
  {
    term: "Prescription",
    plain: "The smallest change we think will move the constraint. One intervention, not a programme.",
    say: "The prescription is the smallest thing we think you could change that would actually move the number. If it needs six months, it isn’t the prescription.",
  },
  {
    term: "Constraint migration",
    plain: "When you relieve one constraint, the limit moves somewhere else. That is success, not failure — and it tells you where to look next.",
    say: "When we fix this one, something else becomes the slowest step. That’s not us being wrong — that’s how it’s meant to go, and it tells us where to look next.",
  },
];

/** The shape of the hour, so an advisor knows where they should be and when. */
const callArc: Array<[string, string, string]> = [
  ["0–2 min", "Consent and framing", "Ask to record. Say what the hour is for: understanding how the work actually moves. You are not selling anything today."],
  ["2–10 min", "How demand comes in, what you promise", "Easy ground on purpose. Let them talk. You are learning their words for things, not testing them."],
  ["10–30 min", "Trace one real job, end to end", "The heart of the call. One real job, last week if possible, from first contact to paid. Every handoff, every wait."],
  ["30–42 min", "Where it waits or loops", "Now hunt. Where does work pile up, come back, or wait on one person?"],
  ["42–50 min", "The numbers that anchor it", "Rough is fine. Volume in a normal month, typical turnaround, what is waiting right now, what got turned away."],
  ["50–58 min", "Who owns it, what could change", "Get a name. Find out what they are allowed to change without a board meeting."],
  ["58–60 min", "Close", "Say what happens next and when. Do not diagnose on the call — you have not looked at the transcript yet."],
];

/** The three things that make the call a success. Everything else is a bonus. */
const mustLeaveWith: Array<[string, string]> = [
  ["A traced flow", "One real job, start to finish, in their words — with the handoffs and the waits actually in it."],
  ["A candidate constraint", "One step you can point at and say “everything seems to wait here”. A candidate, not a verdict."],
  ["A named owner", "A real person, by name, who owns that step. Not a department."],
];

/** What to do when the call gets away from you. Read one of these out and carry on. */
const ifYouGetLost: string[] = [
  "“Can I just check I’ve got this right?” — then say their flow back to them, slightly wrong, on purpose. They will correct you, and the correction is the good bit.",
  "“Take me to the last real one.” A specific job from last week beats any general answer, every time.",
  "“What’s the bit about this that annoys you most?” That question gets you back to the constraint from anywhere in the conversation.",
  "If you have completely lost the thread: open the next question and say “let me come back to that in a minute”. Nobody has ever minded.",
];

/** The advisor's own open questions from the guided call. Advisor notes — never client evidence. */
type GapFlag = {
  questionId: string; question: string; section: DiscoverySection;
  owner: string; lookIn: string; flaggedAt: string;
};

const GAP_BLOCK_START = "<!-- tier4:call-gaps -->";
const GAP_BLOCK_END = "<!-- /tier4:call-gaps -->";

/**
 * Rewrites the advisor's gap register inside the engagement's free-text notes.
 * The managed block is replaced, never appended twice, and the rest of the notes
 * are preserved byte-for-byte. The heading says "advisor" so nothing in here can
 * later be mistaken for something the client said.
 */
function mergeGapNotes(existing: string, gaps: GapFlag[]): string {
  const start = existing.indexOf(GAP_BLOCK_START);
  const end = existing.indexOf(GAP_BLOCK_END);
  const base = (start >= 0 && end > start
    ? `${existing.slice(0, start)}\n${existing.slice(end + GAP_BLOCK_END.length)}`
    : existing).trim();
  if (!gaps.length) return base;
  const lines = gaps.map((gap) => `- [${gap.section}] ${gap.question}${gap.owner ? ` — who would know: ${gap.owner}` : ""}${gap.lookIn ? ` — where to look: ${gap.lookIn}` : ""}`);
  const block = [
    GAP_BLOCK_START,
    "## Gaps to chase — advisor, guided call",
    "",
    "Open questions the advisor flagged live. Advisor notes only: nothing here was stated by the client and nothing here is evidence.",
    "",
    ...lines,
    GAP_BLOCK_END,
  ].join("\n");
  return base ? `${base}\n\n${block}` : block;
}

/** Used only when research produced no client-specific questions. Labelled generic everywhere it appears. */
const genericScript: DiscoveryQuestion[] = [
  { id: "generic-flow", section: "flow", question: "Walk us through one request from the moment it arrives to the moment the customer calls it complete.", whyItMatters: "We are mapping the actual flow, including every handoff and approval.", publicAssumption: "No client-specific question set was produced, so nothing public is being asserted here.", sourceUrls: [], evidenceStatus: "gap", expectedAnswerType: "narrative", required: true, followUps: [] },
  { id: "generic-constraint", section: "constraint", question: "Where is work piling up right now, and what usually has to happen before it can move?", whyItMatters: "The constraint often appears as a queue, rework loop, or single approval.", publicAssumption: "No bottleneck is presumed. Look for a queue, delay, rework loop, or concentrated decision.", sourceUrls: [], evidenceStatus: "gap", expectedAnswerType: "narrative", required: true, followUps: [] },
  { id: "generic-baseline", section: "baseline", question: "In a normal month, how many requests enter, finish, wait, or get turned away?", whyItMatters: "A baseline keeps the finding measurable. Approximate is fine; missing stays missing.", publicAssumption: "No trustworthy public baseline exists for volume, cycle time, queue, rework, or missed demand.", sourceUrls: [], evidenceStatus: "gap", expectedAnswerType: "number", required: true, followUps: [] },
  { id: "generic-roles", section: "roles", question: "Who performs each step, who owns the outcome, and where does only one person hold the judgment?", whyItMatters: "The accountable person becomes the human owner of any intervention.", publicAssumption: "No named owner has been established for this engagement yet.", sourceUrls: [], evidenceStatus: "gap", expectedAnswerType: "person", required: true, followUps: [] },
];

function sectionRank(section: DiscoverySection): number {
  const index = discoverySections.indexOf(section);
  return index < 0 ? discoverySections.length : index;
}

function callScriptFor(research: ResearchPayload | null): { questions: DiscoveryQuestion[]; generic: boolean } {
  const questions = research?.discoveryQuestions ?? [];
  if (!questions.length) return { questions: genericScript, generic: true };
  return { questions: [...questions].sort((a, b) => sectionRank(a.section) - sectionRank(b.section)), generic: false };
}

const evidenceTone: Record<string, Tone> = {
  "client-stated": "known", doc: "inferred", "public-research": "inferred", "advisor-note": "assumed", gap: "missing",
};

const evidenceLabel: Record<string, string> = {
  "client-stated": "Client stated", doc: "Document", "public-research": "Public research", "advisor-note": "Advisor note", gap: "Gap",
};

const directionSourceLabel: Record<DirectionSource, string> = {
  advisor: "Advisor-declared", "unit-table": "Inferred from the unit", "metric-semantics": "Inferred from the metric name",
  model: "Inferred by model", none: "No direction established",
};

const directionSourceTone: Record<DirectionSource, Tone> = {
  advisor: "known", "unit-table": "inferred", "metric-semantics": "inferred", model: "assumed", none: "missing",
};

const directionChoiceCopy: Record<"lower" | "higher", [string, string]> = {
  lower: ["Lower is better", "A shorter time, smaller queue, or fewer errors is the win"],
  higher: ["Higher is better", "More throughput, volume, or revenue is the win"],
};

/** Plain language for how the server will read the number. Never used to compute an interpretation. */
function directionSentence(direction: "higher" | "lower", unit: string): string {
  const noun = unit.trim() || "the value";
  return direction === "higher"
    ? `A higher reading of ${noun} will be called improved; a lower one worsened.`
    : `A lower reading of ${noun} will be called improved; a higher one worsened.`;
}

/** The server sends confidence as a 0–1 ratio; anything above 1 is shown verbatim rather than mislabelled. */
function confidenceLabel(confidence: number): string {
  if (!Number.isFinite(confidence)) return "not reported";
  return confidence <= 1 ? `${Math.round(confidence * 100)}%` : String(confidence);
}

const statusTone: Record<string, Tone> = {
  connected: "success", ready: "success", configured: "success",
  configured_not_implemented: "assumed", intent_only: "assumed", connector_first: "assumed",
  not_configured: "neutral", unavailable: "missing",
};

const statusLegend: Array<[string, string]> = [
  ["connected", "Live and in use by the server right now."],
  ["ready", "Works with no credential; this is the deterministic default."],
  ["configured", "A server-side credential is present and the adapter runs."],
  ["configured_not_implemented", "A credential is present, but no direct adapter writes yet."],
  ["intent_only", "The app only records a reviewed intent; a human executes the write."],
  ["connector_first", "Use the reviewed external connector; no direct adapter exists."],
  ["not_configured", "No credential is present. The local default stays available."],
];

const transcriptMimeTypes: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", vtt: "text/vtt",
  srt: "application/x-subrip", json: "application/json",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** What `POST /api/engagements/:id/sources` accepts. PDF is deliberately absent: the server rejects it. */
const sourceExtensions = ["txt", "md", "csv", "docx", "vtt", "srt", "json"] as const;
const sourceAccept = sourceExtensions.map((extension) => `.${extension}`).join(",");

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(2)} MB`;
}

async function readTranscriptFile(file: File): Promise<TranscriptFile> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = transcriptMimeTypes[extension] ?? (file.type || "application/octet-stream");
  if (extension === "docx" || extension === "doc") {
    const buffer = await file.arrayBuffer();
    return { content: base64FromBytes(new Uint8Array(buffer)), encoding: "base64", mimeType, name: file.name };
  }
  return { content: await file.text(), encoding: "utf8", mimeType, name: file.name };
}

/** The same `[timestamp] Speaker:` line shape the server parses (see parseTranscriptText). Used to surface speakers for role tagging. */
const SPEAKER_LINE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)(?:[.,]\d{1,3})?\]?\s*(?:-\s*)?([^:]{1,80}):\s*(.+)$/;

/** Distinct speaker labels in a pasted transcript, in first-seen order. Empty when the text has no `Speaker:` lines. */
function distinctSpeakers(text: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const matched = raw.trim().match(SPEAKER_LINE);
    if (!matched) continue;
    const speaker = matched[2].trim();
    if (!speaker || seen.has(speaker.toLowerCase())) continue;
    seen.add(speaker.toLowerCase());
    order.push(speaker);
  }
  return order;
}

/**
 * The default role guess for a detected speaker. The primary contact is the client and an
 * advisor-labelled speaker is the advisor; everyone else defaults to `unknown` so an unrecognized
 * speaker (an advisor named normally, a second person in the room) never silently becomes evidence.
 */
function defaultSpeakerRole(speaker: string, contact: string): "client" | "advisor" | "unknown" {
  if (/^(advisor|consultant|tier\s*4|facilitator|interviewer|host)\b/i.test(speaker)) return "advisor";
  const c = contact.trim().toLowerCase();
  if (c) {
    const s = speaker.trim().toLowerCase();
    const contactTokens = c.split(/\s+/).filter((token) => token.length > 1);
    const speakerTokens = s.split(/\s+/).filter((token) => token.length > 1);
    if (s === c || contactTokens.some((token) => speakerTokens.includes(token))) return "client";
  }
  return "unknown";
}

/** Each card is bound to the artifact `kind` its generator writes, so no card can point at nothing. */
const deliverables = [
  ["Diagnosis package", "Canvas v1, constraint card, evidence, baseline, prescription, owner, and predicted next constraint.", "diagnosis_package"],
  ["Audit report", "Canvas-block narrative that ends in the single constraint finding.", "audit_report"],
  ["Proposal & business case", "One metric delta, a fixed two-week sprint, and formulas without invented ROI.", "proposal"],
  ["Implementation roadmap", "Remove and measure, record constraint migration, then diagnose the next constraint.", "implementation_roadmap"],
  ["Developer specification", "Human owner, scope, guardrails, evidence, escalation, and acceptance criteria.", "developer_spec"],
  ["Roles & responsibility map", "Task-level ownership in the constrained flow, ready to carry into implementation.", "roles_map"],
] as const;

function stageFor(screen: Screen): Stage | null {
  if (["intake", "migration", "engagements"].includes(screen)) return "Client";
  if (screen === "research") return "Research";
  if (screen === "prepare") return "Prepare";
  if (["call", "transcript"].includes(screen)) return "Call";
  if (["synthesis", "findings", "findings-call"].includes(screen)) return "Synthesize";
  if (screen === "deliver") return "Deliver";
  if (["sprint", "measure", "catalog", "actions"].includes(screen)) return "Operate";
  return null;
}

/** The two screens that are shared with the client. They drop the advisor chrome entirely. */
function isClientFacing(screen: Screen): boolean {
  return screen === "call" || screen === "findings-call";
}

function isWorkflowState(value: string): value is WorkflowState {
  return (workflowStates as readonly string[]).includes(value);
}

/**
 * Where the advisor's NEXT action lives for each canonical state. Resume routes on this,
 * never on the lossy CRM stage: `Call` alone cannot tell call 1 from call 2, and an
 * unmatched stage must never drop the advisor on the final Deliver screen.
 */
const resumeScreens: Record<WorkflowState, Screen> = {
  RECON_DRAFT: "research",
  GUIDED_CANVAS_COMPLETE: "transcript",
  TRANSCRIPT_1_SYNTHESIZED: "synthesis",
  CANVAS_COMMIT_APPROVED: "findings",
  FINDINGS_CALL_COMPLETE: "transcript",
  TRANSCRIPT_2_RECONCILED: "findings",
  DIAGNOSIS_APPROVED: "deliver",
  SPRINT_ACTIVE: "sprint",
  OUTCOME_MEASURED: "catalog",
  CATALOG_WRITTEN: "actions",
};

/** Plain language for the state the record is actually in, and what happens next on that screen. */
const workflowCopy: Record<WorkflowState, [string, string]> = {
  RECON_DRAFT: ["Researched, not yet on a call", "Review the research and prepare the client brief."],
  GUIDED_CANVAS_COMPLETE: ["Discovery call held", "Add the Call 1 transcript so the client's words become evidence."],
  TRANSCRIPT_1_SYNTHESIZED: ["Call 1 synthesized", "Review the evidence diff and approve the Canvas commit."],
  CANVAS_COMMIT_APPROVED: ["Canvas committed", "Run the Findings Call and present the diagnosis."],
  FINDINGS_CALL_COMPLETE: ["Findings Call held", "Add the Call 2 transcript so clarifications are reconciled."],
  TRANSCRIPT_2_RECONCILED: ["Call 2 reconciled", "Review the finding once more and approve the diagnosis."],
  DIAGNOSIS_APPROVED: ["Diagnosis approved", "Generate the deliverable suite and send documents to the client."],
  SPRINT_ACTIVE: ["Sprint running", "Work the sprint tasks, then record the ending metric."],
  OUTCOME_MEASURED: ["Outcome measured", "Write the reusable pattern back to the catalog."],
  CATALOG_WRITTEN: ["Engagement complete", "Review anything still queued for an external write."],
};

const screenLabels: Partial<Record<Screen, string>> = {
  research: "Research review", prepare: "Client preparation", call: "Guided call",
  transcript: "Transcript evidence", synthesis: "Synthesis review", findings: "Findings Call",
  "findings-call": "Findings Call presentation", deliver: "Deliverables", sprint: "Sprint",
  measure: "Outcome", catalog: "Catalog", actions: "Reviewed actions",
};

/* ===========================================================================
 * PRACTICE MODE — copy and data
 * ---------------------------------------------------------------------------
 * One completely fictional engagement, Meridian Millwork, worked end to end so
 * an advisor can walk the whole arc before they ever touch a real client.
 *
 * Two separate things live in here and they are gated differently:
 *
 * 1. The DEMO MARKER. Rendered by the root component, outside <main>, keyed only
 *    on the active engagement's id. No screen can suppress it, there is no
 *    dismiss control, and it is sticky so it cannot be scrolled past. It stays
 *    on the client-facing call view and the Findings presentation on purpose:
 *    the risk on those screens is the advisor forgetting that what they are
 *    sharing is invented.
 * 2. The WALKTHROUGH. Advisor-facing guidance. It obeys exactly the same rule
 *    as the coaching layer — every part of it is rendered inside <AdvisorOnly>
 *    and it is absent from the DOM on any client-facing screen.
 * =========================================================================== */

/** The server mints one practice record per advisor, all sharing this id prefix. */
// Must match isDemoEngagement() in lib/demo.ts. A looser prefix here would badge an
// unrelated engagement as practice data, or miss one the server considers practice.
const PRACTICE_ID_PREFIX = "eng_demo_practice";
const PRACTICE_CLIENT = "Meridian Millwork";
const PRACTICE_TOUR_KEY = "tier4:practice-walkthrough";

/** The single test. Every practice marker in this file is downstream of it. */
function isPracticeEngagement(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PRACTICE_ID_PREFIX);
}

type TourMode = "off" | "guiding" | "exploring" | "done";
type TourState = { step: number; mode: TourMode };
type ResearchTab = "canvas" | "flow" | "questions";

type TourStop = {
  id: string;
  screen: Screen;
  /** Forces the research screen onto one of its three tabs when the stop opens. */
  focusTab?: ResearchTab;
  /** Which call's transcript screen this stop is about. */
  callNumber?: 1 | 2;
  stage: string;
  title: string;
  /** Plain language for what is actually on the screen in front of them. */
  looking: string;
  /** What the advisor would be doing here with a real client. */
  real: string;
  /** Specific things to go and look at, in this record, right now. */
  watch: string[];
};

/**
 * The walkthrough, in workflow order. Every stop points at a real screen: none of
 * this rebuilds or fakes a view, it only explains the one the advisor is on.
 */
const practiceTour: TourStop[] = [
  {
    id: "intake",
    screen: "intake",
    stage: "Step one · Client",
    title: "Where every engagement starts",
    looking:
      "The intake form, holding what was captured for Meridian Millwork — a twenty-two person architectural millwork shop that builds custom casework and store fixtures for commercial contractors. A company, a website, one named person and an email address is genuinely all it takes to begin.",
    real:
      "With a real client you would fill this in during or just after the first phone call and press “Research this business”. Everything downstream — the questions, the brief, the diagnosis — hangs off that one press, so it is worth getting the contact's name and role right.",
    watch: [
      "The contact's name and role are their own fields, not a line in the notes. The audit reuses them later as the named human owner of whatever gets prescribed.",
      "The email is required because the readiness brief has nowhere to go without one.",
      "Nothing is sent anywhere by this screen. Intake is private, and research runs on public sources only.",
    ],
  },
  {
    id: "research-canvas",
    screen: "research",
    focusTab: "canvas",
    stage: "Step two · Research",
    title: "What we learned without asking",
    looking:
      "The Business Model Canvas — one page describing how the business works. It was drafted from Meridian's public website before anyone spoke to them, and then corrected by what Dana and Rosa actually said on the two calls. Green is the client's own words. Everything else is public research or an honest gap.",
    real:
      "You would read this the day before the call and hunt for the blocks that look thin. The first pass is not trying to be right — it is trying to be specific enough to be corrected, because a correction is the most valuable thing you can get out of an hour.",
    watch: [
      "Under Value Propositions, “quote turnaround is about nine days” is marked Client stated. It replaced the 48-hour promise on the website — corrected on the record, not quietly overwritten.",
      "Cost Structure had nothing public behind it at all until Dana said “payroll is the whole thing”. A block with no public source is normal and is not a failure.",
      "No block is ever filled in with a plausible guess. Where nothing is known it says Missing and stays Missing.",
    ],
  },
  {
    id: "research-flow",
    screen: "research",
    focusTab: "flow",
    stage: "Step two · Research",
    title: "How the work actually moves",
    looking:
      "The value flow: the route one job takes from a contractor's email to installed millwork. Six steps, each with the person who does it, the system it lives in, and a question written for this business that you can ask on the call to confirm it.",
    real:
      "You would walk this on the call one step at a time and invite the client to tell you where you have it wrong. Being slightly wrong out loud is a technique, not an accident — people correct a specific claim far more readily than they answer an open question.",
    watch: [
      "Step 2, Quote pricing, is marked as a gap. Nothing public said who prices a job — and that step turned out to be the entire engagement.",
      "Every step carries its own confirmation question, so you are never improvising the next thing to say.",
      "Nothing here is client-confirmed until a client traces a real job through it. The labels are honest about that.",
    ],
  },
  {
    id: "research-questions",
    screen: "research",
    focusTab: "questions",
    stage: "Step two · Research",
    title: "The questions the research produced",
    looking:
      "Ten discovery questions grouped by what they hunt for, each tied to a Canvas block or a flow step, each saying plainly what was found publicly so you never assert something you only assumed. Beneath them, three competing hypotheses about where the constraint is — with the condition that would kill each one.",
    real:
      "You would skim this the morning of the call. There is nothing to memorise: the guided call puts these on screen one at a time, in order, with the follow-ups beside them.",
    watch: [
      "Every question exists because of a specific gap in the research. There is no generic script here — a different company produces a different list.",
      "The hypotheses are internal and are never read to a client as fact. The job is to arrive with three and leave with one.",
      "Notice how many are marked Required. Those are the ones the diagnosis cannot be built without.",
    ],
  },
  {
    id: "prepare",
    screen: "prepare",
    stage: "Step three · Prepare",
    title: "The brief the client sees",
    looking:
      "On the right, the pre-call readiness brief exactly as the client receives it. Above it, the advisor briefing that never leaves this app: the arc of the hour, the three things you must leave with, and what to say if you lose the thread.",
    real:
      "You would send this a few days ahead so the client has rough numbers within reach and the right people in the room. Approving it records a reviewed send intent — the email itself is a second, deliberate step you take from Reviewed actions.",
    watch: [
      "The Canvas, your discovery questions and your constraint hypotheses are all excluded from the client's copy, on purpose.",
      "The advisor briefing sits in a dashed box flagged “Advisor only”. That is the same boundary the call view uses, and it is worth reading once before your first real call.",
      "The brief asks for approximate numbers. Sending a client hunting through spreadsheets before a call is the fastest way to lose the hour.",
    ],
  },
  {
    id: "call",
    screen: "call",
    stage: "Step four · The discovery call",
    title: "The call, one question at a time",
    looking:
      "The guided call. One question fills the screen so you can share it, and a coaching rail sits beside it that the client never sees: follow-ups written for this client, what to say when they do not know, how to steer back from a tangent, answers to predictable pushback, and plain English for every bit of jargon.",
    real:
      "You would open this at the top of the hour, confirm recording consent out loud, and work down the questions. Answers are captured as “That’s right”, “Correct it”, or “We don’t know yet” — and an “I don’t know” gets flagged as a gap to chase rather than quietly passing as an answer.",
    watch: [
      "Press Escape, or tap the bar at the top of this screen, and every word of the coaching vanishes from the page. Not hidden — gone. Try it now, before you ever need it live.",
      "The practice bar above does not vanish with it. That is deliberate: the one thing that must never disappear is the warning that this is invented data.",
      "You are not expected to diagnose anything on the call. Your job is the flow, the waiting, and a name. The diagnosis happens afterwards with the transcript in front of you.",
    ],
  },
  {
    id: "transcript",
    screen: "transcript",
    callNumber: 1,
    stage: "Step five · Evidence",
    title: "The call becomes evidence",
    looking:
      "Where a recording turns into quotable evidence. Paste the text, upload the file, or pull it from Fireflies — always the full transcript rather than a summary, so that every finding can point back at a line somebody actually said.",
    real:
      "You would do this the same afternoon, while you still remember the room. Consent has to be confirmed for this specific call before anything can be captured; the analyse button stays shut otherwise, and it is recorded separately for call one and call two.",
    watch: [
      "Meridian's two transcripts are already processed. The sentence the whole engagement rests on is Rosa's, at 04:43: “It is more like 9 days per quote.”",
      "Speaker roles matter more than they look. Your own lines are recorded as advisor notes and can never become client evidence, however quotable they sound.",
      "A summary would have lost the nine days. Dana said four or five; the log said nine. Only the full transcript carries the correction.",
    ],
  },
  {
    id: "synthesis",
    screen: "synthesis",
    stage: "Step six · Synthesis",
    title: "What the transcript actually supports",
    looking:
      "The evidence diff. Every client-attributed line that carries weight, with the speaker and the timestamp, plus the baseline status, the open gaps, and one provisional constraint candidate.",
    real:
      "You would read this line by line and argue with it where it is wrong. It is a proposal, not a verdict, and the tool would rather show you nothing than fill the screen with something the transcript does not support.",
    watch: [
      "Baseline reads Confirmed — because Rosa read it off her own log, not because anything here assumed a number.",
      "The candidate is one constraint. Not a ranked list of nine opportunities, and not a score.",
      "Anything the analysis could not tie to a real quote is discarded and shown as discarded. A silent drop would be worse than a visible rejection.",
    ],
  },
  {
    id: "canvas-commit",
    screen: "synthesis",
    stage: "Step six · Checkpoint",
    title: "The first thing you have to approve",
    looking:
      "The same screen, at its bottom edge. “Approve Canvas commit” is a human checkpoint: nothing the transcript proposed is written into the canonical Canvas until a person says so.",
    real:
      "You would press this only after reading the quotes above it. It approves the evidence and the Canvas — it does not approve the diagnosis. That is a separate decision, later, after a second call with the client.",
    watch: [
      "Two approvals, two calls, in that order. It is the main thing standing between a confident guess and a client-facing finding.",
      "If you approve this and later change your mind, the evidence is still all here with names and timestamps against it. Nothing becomes anonymous.",
    ],
  },
  {
    id: "findings",
    screen: "findings",
    stage: "Step seven · The findings call",
    title: "Reconcile first. Reveal second.",
    looking:
      "The second call, in two halves. First you read the business back to them and let them correct you. Only then — in part B — do you show the constraint, the prescription, the metric and the owner.",
    real:
      "You would share your screen and walk the client through the client-facing version of this. Press “Enter presentation view” and look at it: one section per screen, their own words quoted exactly, nothing internal on show.",
    watch: [
      "Go into the presentation view now. The walkthrough disappears exactly like the coaching does — and the practice bar stays. That is the guarantee: you cannot screen-share this believing it is real.",
      "Dana's correction about who draws shop drawings came out of this half of the call. Reconciliation is where a finding gets stress-tested, and it is the half people skip.",
      "Nothing numeric can be claimed while a baseline is missing. Here it is confirmed, so the numbers are allowed.",
    ],
  },
  {
    id: "diagnosis",
    screen: "findings",
    stage: "Step seven · Checkpoint",
    title: "Approving the diagnosis",
    looking:
      "The second and final checkpoint. The constraint, the prescription, the evidence count, the Canvas block and the named human owner, with the approval beneath them.",
    real:
      "You cannot approve without a named person and a supported candidate. For Meridian that person is Dana Whitfield, Owner — she said on the record that a bad number off her own price book is hers and not Rosa's, which is what ownership actually means.",
    watch: [
      "Nine days is a client number from a client log. No delta can ever be claimed against a baseline the tool invented, because it will not invent one.",
      "The prescription is deliberately small: write down the six or seven assemblies she already prices the same way every time. No hire, no software, no new system, and she can stop using it on any Monday.",
      "The predicted next constraint — shop drawings — is named here, before the sprint, so that when it shows up nobody thinks the sprint failed.",
    ],
  },
  {
    id: "deliver",
    screen: "deliver",
    stage: "Step eight · Deliver",
    title: "The documents",
    looking:
      "Six documents generated from the approved record: the diagnosis package, the audit report, a fixed-sprint proposal, an implementation roadmap, a developer specification, and a roles map. Every one carries the same evidence labels and the same named owner.",
    real:
      "You would generate the suite, read it, then queue the ones the client should see. Sending is two steps on purpose — “Send to client” queues a reviewed intent and nothing leaves this app until you approve it in Reviewed actions, so nothing can go out mid-call by accident.",
    watch: [
      "None of these documents contains a number nobody said. The proposal shows the formula rather than a projected return.",
      "Every practice document says so on its own face. Open one from the Documents menu and read the last line.",
      "The roles map is the one clients react to hardest. It is where “everything waits on one person” stops being a feeling.",
    ],
  },
  {
    id: "sprint",
    screen: "sprint",
    stage: "Step nine · Operate",
    title: "The sprint",
    looking:
      "The prescription turned into five tasks with owners, and a measurement clock started against the confirmed nine-day baseline.",
    real:
      "You would activate this in front of the client, agree the review date, and then largely get out of the way. Meridian's sprint cost Dana two evenings — one to write the price book, one to sit with Rosa while she used it.",
    watch: [
      "The last task is the kill condition in the client's own words: if quotes go out in three days and the win rate does not move, speed was never the constraint.",
      "Agreeing how you would be proved wrong, in writing, before you start, is the whole discipline. In four weeks one of you will be tempted to explain the number away.",
      "Nothing here is scheduled or emailed externally. The sprint lives in the record.",
    ],
  },
  {
    id: "measure",
    screen: "measure",
    stage: "Step ten · Operate",
    title: "What actually changed",
    looking:
      "The before and the after. Nine days to three days — a delta of minus six, read as an improvement because shorter elapsed time is better, with the reason for that judgement written out beside it.",
    real:
      "You would take the ending reading from the same log, kept the same way, and read it back to the client before recording it. If the log had changed, the comparison would be worthless and this screen would say so.",
    watch: [
      "The browser never calculates any of this. Every number came back from the server, including the judgement about which direction is better — and you can correct that direction if it reads wrong.",
      "The constraint moved to shop drawings, exactly where Dana predicted on the first call. That is what success looks like, not a fix that failed.",
      "If no direction can be established, the result is shown as “not interpreted” rather than being quietly called a win.",
    ],
  },
  {
    id: "catalog",
    screen: "catalog",
    stage: "Step eleven · Catalog",
    title: "What you keep",
    looking:
      "The reusable pattern: owner-held pricing knowledge behaving as a queue, the smallest change that moved it, and the measured result — attached to this engagement and no other.",
    real:
      "You would add where you think the pattern transfers and where it probably does not. The measured result is never detached from the engagement that produced it and never quoted to a prospect as a benchmark.",
    watch: [
      "One engagement, one pattern. This is how a practice compounds without anybody inventing a case study.",
      "The next Meridian is not another millwork shop. It is any business where one person's judgement is the queue.",
    ],
  },
];

function readTourState(): TourState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PRACTICE_TOUR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourState>;
    const step = typeof parsed.step === "number" && parsed.step >= 0 && parsed.step < practiceTour.length ? parsed.step : 0;
    const mode: TourMode = parsed.mode === "done" ? "done" : "guiding";
    return { step, mode };
  } catch {
    return null;
  }
}

function writeTourState(state: TourState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state) window.localStorage.setItem(PRACTICE_TOUR_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(PRACTICE_TOUR_KEY);
  } catch {
    // A blocked or full localStorage costs the advisor their place in the walkthrough,
    // and nothing else. It must never take the walkthrough itself down.
  }
}

/** Deliberately permissive: this only decides whether Submit is enabled, it is not an address check. */
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

function extensionOf(name: string): string {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

/** `datetime-local` speaks local wall-clock; the server stores ISO. These two convert, and only these two. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatMeeting(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/**
 * The presentation order the Findings Call is walked in. The server already returns the
 * sections in this order; ranking by heading keeps the client-facing sequence correct even
 * if it ever does not, and anything unrecognized keeps its position at the end.
 */
const agendaOrder: Array<[string, RegExp]> = [
  ["What we heard", /heard|told us|conversation/i],
  ["The constraint", /constraint|limiting|bottleneck/i],
  ["Your own words", /own words|evidence|quote/i],
  ["What we propose", /propose|prescription|recommend/i],
  ["What it would take", /take|effort|scope|resourc/i],
  ["What we'd measure", /measure|metric|baseline/i],
];

function orderedAgenda(input: FindingsAgendaSection[]): FindingsAgendaSection[] {
  const sections = input.map((section) => ({
    heading: section.heading || "This part of the finding",
    body: section.body ?? "",
    evidence: (section.evidence ?? []).filter((item) => item.quote?.trim()),
  }));
  const rank = (section: FindingsAgendaSection, index: number) => {
    const found = agendaOrder.findIndex(([, pattern]) => pattern.test(section.heading));
    return found < 0 ? agendaOrder.length + index : found;
  };
  return sections.map((section, index) => ({ section, index })).sort((a, b) =>
    rank(a.section, a.index) - rank(b.section, b.index) || a.index - b.index,
  ).map((item) => item.section);
}

/** How a publication intent reads on a deliverable card. Never claims a send that did not happen. */
function publishStatusCopy(intent: IntentItem | null): { tone: Tone; label: string; detail: string } {
  if (!intent) return { tone: "neutral", label: "Not queued", detail: "Nothing has been proposed for this document yet." };
  if (intent.status === "pending_review") return { tone: "assumed", label: "Queued for review", detail: "Waiting for approval in Reviewed actions. Nothing has left this app." };
  if (intent.status === "rejected") return { tone: "missing", label: "Rejected", detail: "This publication was rejected. Queue it again if that was a mistake." };
  if (intent.status === "failed") return { tone: "missing", label: "Send failed", detail: intent.result?.detail || "The external write failed. Re-approve before trying again." };
  if (intent.status === "executed") return { tone: "success", label: "Sent to client", detail: intent.result?.detail || "The document was published to the connected provider." };
  if (intent.result?.status === "not-configured") {
    return {
      tone: "assumed", label: "Approved · Google not connected",
      detail: `${intent.result.detail || "No Google credential is configured on the server."} Nothing failed and nothing was sent — the approval is still good. Connect Google in the Integration Center, then execute this action again.`,
    };
  }
  return { tone: "known", label: "Approved, not sent", detail: "Approved but not yet executed. Send it from the Reviewed actions panel." };
}

/** The last execution attempt on an intent, in words an advisor can read out loud. */
function intentResultCopy(intent: IntentItem): { tone: Tone; title: string; detail: string } | null {
  const result = intent.result;
  if (!result?.status) return null;
  if (result.status === "not-configured") return {
    tone: "assumed",
    title: `${result.provider || "The provider"} is not configured on the server`,
    detail: `${result.detail || "No credential is present."} Nothing was attempted and nothing failed, so this intent stays approved. Add the credential and execute again.`,
  };
  if (result.ok) return { tone: "success", title: "External write completed", detail: result.detail || `${result.provider || "The provider"} accepted the write.` };
  return { tone: "missing", title: "The external write did not complete", detail: result.detail || "The provider returned no detail." };
}

function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

/**
 * Explicit, not substring-matched. `TRANSCRIPT_2_RECONCILED` contains "RECON", so a
 * contains() chain silently labelled a reconciled call-2 engagement as Research.
 */
const STAGE_FOR_STATE: Record<WorkflowState, Stage> = {
  RECON_DRAFT: "Research",
  GUIDED_CANVAS_COMPLETE: "Call",
  TRANSCRIPT_1_SYNTHESIZED: "Synthesize",
  CANVAS_COMMIT_APPROVED: "Synthesize",
  FINDINGS_CALL_COMPLETE: "Call",
  TRANSCRIPT_2_RECONCILED: "Synthesize",
  DIAGNOSIS_APPROVED: "Deliver",
  SPRINT_ACTIVE: "Operate",
  OUTCOME_MEASURED: "Operate",
  CATALOG_WRITTEN: "Operate",
};

/** CRM stage names, used only when a record predates the workflow state being stored. */
const STAGE_FOR_CRM_STAGE: Record<string, Stage> = {
  Client: "Client",
  Research: "Research",
  Prepare: "Prepare",
  Call: "Call",
  Synthesize: "Synthesize",
  Deliver: "Deliver",
  "Sprint & Catalog": "Operate",
};

function uiStage(value: string): Stage {
  if (isWorkflowState(value)) return STAGE_FOR_STATE[value as WorkflowState];
  return STAGE_FOR_CRM_STAGE[value] ?? "Client";
}

function toEngagement(item: BackendEngagement): Engagement {
  return {
    id: item.id,
    companyName: item.client,
    website: item.website ?? "",
    stage: uiStage(item.workflowState || item.stage),
    workflowState: isWorkflowState(item.workflowState ?? "") ? item.workflowState as WorkflowState : null,
    status: item.status,
    nextAction: item.nextAction,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Not yet updated",
    primaryContact: item.primaryContact ?? "",
    primaryContactRole: item.primaryContactRole ?? "",
    email: item.email ?? "",
    call1At: item.call1At ?? null,
    call2At: item.call2At ?? null,
  };
}

function Button({ children, icon, onClick, disabled, type = "button", variant = "primary" }: {
  children: React.ReactNode; icon?: IconName; onClick?: () => void; disabled?: boolean;
  type?: "button" | "submit"; variant?: "primary" | "secondary" | "quiet";
}) {
  return <button className={`button ${variant}`} disabled={disabled} onClick={onClick} type={type}>{children}{icon ? <Icon name={icon} size={17} /> : null}</button>;
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Back({ children = "Back", onClick }: { children?: React.ReactNode; onClick: () => void }) {
  return <button className="back" onClick={onClick} type="button"><Icon name="back" size={15} />{children}</button>;
}

function Stepper({ current }: { current: Stage }) {
  const at = stages.indexOf(current);
  return <nav aria-label="Audit progress" className="stepper">{stages.map((stage, index) =>
    <div aria-current={index === at ? "step" : undefined} className={index < at ? "done" : index === at ? "active" : ""} key={stage}>
      <span>{index < at ? <Icon name="check" size={12} /> : index + 1}</span>{stage}
    </div>
  )}</nav>;
}

function PageHead({ eyebrow, title, children, side }: { eyebrow: string; title: string; children: React.ReactNode; side?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></div>{side}</div>;
}

function Documents({ activeId }: { activeId: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    type ApiDocument = Partial<DocumentItem> & { id: string; title?: string; url?: string; source?: "static" | "generated" };
    api<ApiDocument[] | { documents: ApiDocument[] }>(`/api/documents${activeId ? `?engagementId=${activeId}` : ""}`)
      .then((data) => {
        const items = Array.isArray(data) ? data : data.documents;
        setDocs(items.map((doc) => ({
          name: doc.name ?? doc.title ?? "Untitled document",
          id: doc.id,
          // Static reference docs carry their own url; generated artifacts have neither an href nor a
          // url, so they used to render href="#" and do nothing. Point those at the printable route.
          href: doc.href ?? doc.url ?? (doc.source === "generated" ? `/api/documents/${doc.id}?format=html` : undefined),
          kind: doc.kind === "workflow" ? "workflow" : "generated",
          status: doc.status ?? "draft",
        })));
      })
      .catch((reason: Error) => {
        setDocs([]);
        setError(`Documents could not be loaded: ${reason.message}`);
      })
      .finally(() => setLoading(false));
  }, [open, activeId]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);
  const toggle = () => {
    if (!open) {
      setError("");
      setLoading(true);
    }
    setOpen(!open);
  };
  return <div className="documents">
    <button aria-controls="documents-menu" aria-expanded={open} aria-haspopup="menu" className="header-link" onClick={toggle} ref={triggerRef} type="button"><Icon name="folder" size={16} />Documents<Icon className="down" name="chevron" size={13} /></button>
    {open ? <div aria-label="Engagement documents" className="documents-popover" id="documents-menu" ref={menuRef} role="menu">
      <header><strong>Engagement documents</strong><span>Approved workflow and generated artifacts</span></header>
      {loading ? <p className="loading" role="status">Reading documents…</p> : null}
      {error ? <p className="menu-error" role="alert">{error}</p> : null}
      {!loading && !error && docs.length === 0 ? <p className="menu-empty">No approved workflow documents or generated artifacts yet.</p> : null}
      {!loading && !error ? docs.map((doc) =>
        <a href={doc.href ?? "#"} key={doc.id} onClick={(event) => { if (!doc.href) event.preventDefault(); }} rel="noopener noreferrer" role="menuitem" target={doc.href ? "_blank" : undefined}>
          <span><Icon name="document" size={16} /></span><span><strong>{doc.name}</strong><small>{doc.kind === "workflow" ? "Approved workflow" : "Generated artifact"} · {doc.status}</small></span>{doc.href ? <Icon name="external" size={13} /> : null}
        </a>) : null}
      <button onClick={() => { setOpen(false); triggerRef.current?.focus(); }} role="menuitem" type="button">Close documents <Icon name="close" size={13} /></button>
    </div> : null}
  </div>;
}

export default function AdvisorCockpit() {
  const [screen, setScreen] = useState<Screen>("home");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [contact, setContact] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [context, setContext] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [apiState, setApiState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [briefSent, setBriefSent] = useState(false);
  const [callIndex, setCallIndex] = useState(0);
  /** Advisor-only coaching is rendered only while this is false. See <AdvisorOnly>. */
  const [presenting, setPresenting] = useState(false);
  const [gapFlags, setGapFlags] = useState<GapFlag[]>([]);
  const [gapSave, setGapSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [gapError, setGapError] = useState("");
  const [consent, setConsent] = useState<"pending" | "recorded" | "not-recorded">("pending");
  const [call2Consent, setCall2Consent] = useState<"pending" | "recorded" | "not-recorded">("pending");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [researchResult, setResearchResult] = useState<ResearchPayload | null>(null);
  const [canvas, setCanvas] = useState<CanvasRecord | null>(null);
  const [sprint, setSprint] = useState<SprintRecord | null>(null);
  const [outcome, setOutcome] = useState<OutcomeMeasurement | null>(null);
  const [catalogEntry, setCatalogEntry] = useState<CatalogEntry | null>(null);
  const [opsBusy, setOpsBusy] = useState("");
  const [opsError, setOpsError] = useState("");
  const [synthesisResult, setSynthesisResult] = useState<TranscriptSynthesis | null>(null);
  const [transcriptMethod, setTranscriptMethod] = useState<"fireflies" | "paste" | "upload">("fireflies");
  const [transcript, setTranscript] = useState("");
  const [fileName, setFileName] = useState("");
  const [transcriptFile, setTranscriptFile] = useState<TranscriptFile | null>(null);
  const [fileSummary, setFileSummary] = useState("");
  const [fileError, setFileError] = useState("");
  const [fileReading, setFileReading] = useState(false);
  const [transcriptCallNumber, setTranscriptCallNumber] = useState<1 | 2>(1);
  const [call2Processed, setCall2Processed] = useState(false);
  const [diagnosisApproved, setDiagnosisApproved] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [intents, setIntents] = useState<IntentItem[]>([]);
  const [deliverBusy, setDeliverBusy] = useState("");
  const [deliverError, setDeliverError] = useState("");
  const [call1At, setCall1At] = useState<string | null>(null);
  const [call2At, setCall2At] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleSavedAt, setScheduleSavedAt] = useState("");
  const [intakeFile, setIntakeFile] = useState<TranscriptFile | null>(null);
  const [intakeFileName, setIntakeFileName] = useState("");
  const [intakeFileState, setIntakeFileState] = useState<{ tone: "reading" | "ready" | "error" | "added"; message: string } | null>(null);
  const [resumed, setResumed] = useState<{ state: WorkflowState | null; stage: Stage; status: string; nextAction: string; screen: Screen } | null>(null);
  const [agenda, setAgenda] = useState<FindingsAgendaSection[]>([]);
  const [agendaStep, setAgendaStep] = useState(0);
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [agendaError, setAgendaError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  /** Practice mode. `practiceActive` is derived from the active id and nothing else. */
  const [practiceExists, setPracticeExists] = useState(false);
  const [practiceProbe, setPracticeProbe] = useState<"loading" | "ready" | "error">("loading");
  const [practiceBusy, setPracticeBusy] = useState<"" | "open" | "reset" | "remove">("");
  const [practiceError, setPracticeError] = useState("");
  const [tourStep, setTourStep] = useState(0);
  const [tourMode, setTourMode] = useState<TourMode>("off");
  const [researchTab, setResearchTab] = useState<ResearchTab | undefined>(undefined);
  /** Per-button in-flight guards so a double-click cannot fire a mutating request twice. */
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState<"" | "canvas" | "diagnosis">("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState("");
  /** Source-upload feedback for the Research screen's "Add a source" control. */
  const [researchSourceState, setResearchSourceState] = useState<{ tone: "reading" | "ready" | "error"; message: string } | null>(null);
  /** Migration source text carried from the Migration screen into the created engagement. */
  const [pendingSourceText, setPendingSourceText] = useState("");
  /** Speaker → role map the advisor confirms before a transcript is analyzed. Only "client" becomes evidence. */
  const [speakerRoles, setSpeakerRoles] = useState<Record<string, "client" | "advisor" | "unknown">>({});
  const [speakerReq, setSpeakerReq] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const currentStage = stageFor(screen);
  const practiceActive = isPracticeEngagement(activeId);
  /**
   * The walkthrough is advisor guidance, so it hides exactly where the coaching layer hides:
   * on the guided call the moment the advisor says they are sharing, and on the Findings
   * presentation always, because that screen has no advisor half at all. The DEMO marker is
   * NOT gated by this — it is the one thing that has to survive a screen share.
   */
  const guidanceHidden = screen === "findings-call" || (screen === "call" && presenting);
  const displayCompany = company || "Untitled engagement";
  const script = callScriptFor(researchResult);
  const callQuestion = script.questions[Math.min(callIndex, script.questions.length - 1)];
  /**
   * Speakers we can surface for role tagging: pasted text, or an uploaded transcript that was read
   * as UTF-8 text. A Fireflies id (pre-fetch) or a base64 DOCX cannot be parsed client-side.
   */
  const speakerSource = transcriptMethod === "paste"
    ? transcript
    : transcriptMethod === "upload" && transcriptFile?.encoding === "utf8"
      ? transcriptFile.content
      : "";
  const detectedSpeakers = speakerSource.trim() ? distinctSpeakers(speakerSource) : [];
  // Render-phase sync (the same pattern the research tab uses): when the detected speaker set changes,
  // seed defaults for new speakers while preserving any the advisor has already tagged.
  const speakerKey = detectedSpeakers.map((speaker) => speaker.toLowerCase()).join("\u0000");
  if (speakerKey !== speakerReq) {
    setSpeakerReq(speakerKey);
    setSpeakerRoles((prev) => {
      const next: Record<string, "client" | "advisor" | "unknown"> = {};
      for (const speaker of detectedSpeakers) next[speaker] = prev[speaker] ?? defaultSpeakerRole(speaker, contact);
      return next;
    });
  }
  // Shown on the transcript screen when speakers cannot be listed for the chosen method, so the
  // advisor knows the fail-closed default is in effect rather than assuming everyone became evidence.
  const speakerNote = detectedSpeakers.length ? ""
    : transcriptMethod === "fireflies"
      ? "Speaker roles can't be listed for a Fireflies id before it is fetched. Your primary contact is tagged Client and advisor-labelled speakers Advisor; any other speaker is treated as a gap, not evidence."
      : transcriptMethod === "upload" && transcriptFile && transcriptFile.encoding !== "utf8"
        ? "This file is extracted on the server, so its speakers can't be listed here. Your primary contact is tagged Client and advisor-labelled speakers Advisor; any other speaker is treated as a gap, not evidence."
        : (transcriptMethod === "paste" && transcript.trim()) || (transcriptMethod === "upload" && transcriptFile)
          ? "No “[timestamp] Speaker:” lines were detected, so individual speakers can't be listed. Your primary contact is tagged Client and advisor-labelled speakers Advisor; any other speaker is treated as a gap, not evidence."
          : "";

  useEffect(() => {
    api<{ engagements: BackendEngagement[] }>("/api/engagements")
      .then((result) => setEngagements(result.engagements.map(toEngagement)))
      .catch((reason: Error) => {
        setApiState("error");
        setNotice(`The engagement registry could not be loaded: ${reason.message}`);
      })
      .finally(() => setRegistryLoading(false));
  }, []);

  useEffect(() => {
    if (!confirmSend) return;
    modalRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmSend(false);
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href]"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmSend]);

  /** Whether a practice engagement already exists decides only how the entry card reads. */
  useEffect(() => {
    let active = true;
    api<{ engagement: BackendEngagement | null }>("/api/demo")
      .then((result) => {
        if (!active) return;
        setPracticeExists(Boolean(result.engagement));
        setPracticeProbe("ready");
      })
      .catch((reason: Error) => {
        if (!active) return;
        setPracticeProbe("error");
        setPracticeError(`Practice mode could not be checked: ${reason.message}. You can still open it — it will be created if it is not there.`);
      });
    return () => { active = false; };
  }, []);

  /** The advisor's place in the walkthrough survives a reload, a tab close, and a laptop restart. */
  useEffect(() => {
    if (!practiceActive || tourMode === "off") return;
    writeTourState({ mode: tourMode === "done" ? "done" : "guiding", step: tourStep });
  }, [practiceActive, tourMode, tourStep]);

  function go(next: Screen) {
    setScreen(next); setNotice(""); setMobileNav(false); setResumed(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save<T = unknown>(path: string, body: unknown, method = "POST") {
    setApiState("saving");
    try {
      const result = await api<T>(path, { method, body: JSON.stringify(body) });
      setApiState("saved");
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unknown request failure";
      setApiState("error");
      setNotice(`Action not completed: ${message}`);
      throw reason;
    }
  }

  /**
   * The single source of truth for "return every per-engagement field to its initial value".
   * `createEngagement`, `resume`, and `leavePractice` all call this so they cannot drift — the
   * bug that mattered was a new engagement inheriting the previous one's recording consent, call
   * number, brief-sent flag, synthesis, and artifacts. Identity fields (company/website/contact/
   * role/email/context) and the intake attachment are deliberately NOT reset here: the caller owns
   * them — the intake form has already set them for a new engagement, and `resume` sets them from
   * the record only after a successful load.
   */
  function resetEngagementState() {
    setConsent("pending"); setCall2Consent("pending");
    setAnswers({}); setNotes({}); setValues({});
    setResearchResult(null); setCanvas(null);
    setSprint(null); setOutcome(null); setCatalogEntry(null);
    setSynthesisResult(null);
    setArtifacts([]); setIntents([]);
    setTranscript(""); setTranscriptFile(null); setFileName(""); setFileSummary(""); setFileError(""); setFileReading(false);
    setTranscriptMethod("fireflies");
    setTranscriptCallNumber(1); setCall2Processed(false); setDiagnosisApproved(false);
    setBriefSent(false);
    setGapFlags([]); setGapSave("idle"); setGapError("");
    setPresenting(false);
    setCallIndex(0);
    setCall1At(null); setCall2At(null);
    setAgenda([]); setAgendaStep(0); setAgendaBusy(false); setAgendaError("");
    setScheduleBusy(false); setScheduleError(""); setScheduleSavedAt("");
    setDeliverBusy(""); setDeliverError("");
    setOpsBusy(""); setOpsError("");
    setAnalyzing(false); setSending(false); setApproving("");
    setContactBusy(false); setContactError("");
    setResearchSourceState(null);
    setSpeakerRoles({}); setSpeakerReq("");
    setConfirmSend(false); setConfirmed(false);
    setResumed(null);
  }

  /**
   * The intake attachment is chosen before the engagement exists, so it is parsed here and
   * uploaded to the source register the moment `createEngagement` returns an id.
   */
  async function selectIntakeFile(file: File | null) {
    setIntakeFile(null); setIntakeFileState(null);
    if (!file) return setIntakeFileName("");
    setIntakeFileName(file.name);
    const extension = extensionOf(file.name);
    if (extension === "pdf") {
      setIntakeFileState({ tone: "error", message: "PDF cannot be read by the source register. Export it to DOCX, TXT, Markdown, or CSV and choose it again." });
      return;
    }
    if (!(sourceExtensions as readonly string[]).includes(extension)) {
      setIntakeFileState({ tone: "error", message: `${file.name} is not a supported source format. Use TXT, MD, CSV, DOCX, VTT, SRT, or JSON.` });
      return;
    }
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      setIntakeFileState({ tone: "error", message: `${file.name} is ${formatBytes(file.size)}. The upload limit is ${formatBytes(MAX_TRANSCRIPT_BYTES)}.` });
      return;
    }
    setIntakeFileState({ tone: "reading", message: `Reading ${file.name}…` });
    try {
      const payload = await readTranscriptFile(file);
      if (!payload.content.length) {
        setIntakeFileState({ tone: "error", message: `${file.name} contained no readable content. Choose another file.` });
        return;
      }
      setIntakeFile(payload);
      setIntakeFileState({ tone: "ready", message: `${formatBytes(file.size)} read. It will be added to the engagement's source register once the engagement is created.` });
    } catch (reason) {
      setIntakeFileState({ tone: "error", message: `The file could not be read: ${reason instanceof Error ? reason.message : "unknown error"}` });
    }
  }

  async function createEngagement(event: FormEvent) {
    event.preventDefault();
    const normalizedWebsite = normalizeWebsiteInput(website);
    // Research runs on the public website and 400s without one. Creating the engagement first and
    // then dead-ending on that error stranded the advisor on the form and tempted a duplicate
    // submit, so the website is required up front and nothing is created without it.
    if (!normalizedWebsite) {
      setApiState("error");
      setNotice("Add a company website first — research runs on the public website, and creating the engagement without one would leave it with nothing to research.");
      return;
    }
    // A fresh engagement must not inherit the previously open one's recording consent, call number,
    // brief-sent flag, synthesis, or artifacts. Identity/context and the chosen intake file are
    // preserved because this POST and the source upload still need them.
    resetEngagementState();
    try {
      setWebsite(normalizedWebsite);
      const response = await save<{ engagement: BackendEngagement }>("/api/engagements", {
        client: company,
        website: normalizedWebsite,
        primaryContact: contact,
        primaryContactRole: role,
        email: email.trim(),
        notes: context,
      });
      const id = response.engagement.id;
      setActiveId(id);
      setCall1At(response.engagement.call1At ?? null);
      setCall2At(response.engagement.call2At ?? null);
      setEngagements((items) => [toEngagement(response.engagement), ...items.filter((item) => item.id !== id)]);
      const sourceOutcomes: string[] = [];
      if (intakeFile) {
        setIntakeFileState({ tone: "reading", message: `Adding ${intakeFile.name} to the source register…` });
        try {
          await api(`/api/engagements/${id}/sources`, { method: "POST", body: JSON.stringify({ file: intakeFile }) });
          setIntakeFileState({ tone: "added", message: `${intakeFile.name} was added to the engagement's source register.` });
          sourceOutcomes.push(`${intakeFile.name} was added to the engagement's source register.`);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "unknown request failure";
          setIntakeFileState({ tone: "error", message: `${intakeFile.name} was NOT added to the source register: ${message}` });
          sourceOutcomes.push(`${intakeFile.name} was not added to the source register: ${message}`);
        }
        // Cleared either way: a retry belongs to this engagement, not to the next one created.
        setIntakeFile(null);
      }
      if (pendingSourceText.trim()) {
        const migratedFile: TranscriptFile = { name: "migrated-notes.txt", mimeType: "text/plain", content: pendingSourceText, encoding: "utf8" };
        try {
          await api(`/api/engagements/${id}/sources`, { method: "POST", body: JSON.stringify({ file: migratedFile, label: "Migrated source material" }) });
          sourceOutcomes.push("The migrated notes were added to the engagement's source register.");
        } catch (reason) {
          sourceOutcomes.push(`The migrated notes were not added to the source register: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
        }
        setPendingSourceText("");
      }
      const researchResponse = await save<{ engagement?: BackendEngagement; research: ResearchPayload }>(`/api/engagements/${id}/research`, { sourceUrl: normalizedWebsite });
      setResearchResult(researchResponse.research);
      setCanvas(researchResponse.engagement?.data?.canvas ?? null);
      go("research");
      if (sourceOutcomes.length) setNotice(sourceOutcomes.join(" "));
    } catch {
      // save() leaves the advisor on intake with a visible error.
    }
  }

  async function loadEngagement(id: string): Promise<BackendEngagement | null> {
    try {
      const response = await api<{ engagement: BackendEngagement; documents?: ArtifactRecord[]; intents?: IntentItem[] }>(`/api/engagements/${id}`);
      const data = response.engagement.data;
      setResearchResult(data?.research ?? null);
      setCanvas(data?.canvas ?? null);
      setSprint(data?.sprint ?? null);
      setOutcome(data?.outcome ?? null);
      setCatalogEntry(data?.catalogEntry ?? null);
      setSynthesisResult((data?.transcriptSynthesis ?? []).at(-1) ?? null);
      setArtifacts(response.documents ?? []);
      setIntents(response.intents ?? []);
      setCall1At(response.engagement.call1At ?? null);
      setCall2At(response.engagement.call2At ?? null);
      return response.engagement;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unknown request failure";
      setNotice(`The engagement could not be read: ${message}`);
      return null;
    }
  }

  /**
   * Resume routes on `workflowState`, the precise checkpoint, rather than on the CRM stage —
   * `Call` cannot distinguish call 1 from call 2, and an unmatched value used to fall through
   * to the final Deliver screen. Anything unrecognized lands on research, never on Deliver.
   */
  async function resume(item: Engagement) {
    // Reset every per-engagement field BEFORE the fetch so no stale value survives the switch, and
    // clear the intake attachment so it cannot bleed into a later new engagement. Identity is not
    // committed yet — a failed GET must not leave the previous engagement's data under the new id.
    resetEngagementState();
    setIntakeFile(null); setIntakeFileName(""); setIntakeFileState(null); setPendingSourceText("");
    const record = await loadEngagement(item.id);
    if (!record) {
      // The GET failed. Stay off the new engagement and drop to a clean state; loadEngagement has
      // already surfaced the error. Nothing from the previous engagement is shown under a new id.
      setActiveId(null); setCompany(""); setWebsite(""); setContact(""); setRole(""); setEmail(""); setContext("");
      return;
    }
    // The load succeeded: only now commit the new identity.
    setActiveId(item.id);
    setCompany(item.companyName); setWebsite(item.website);
    setContact(item.primaryContact); setRole(item.primaryContactRole); setEmail(item.email);
    const state = isWorkflowState(record.workflowState ?? "") ? record.workflowState as WorkflowState : item.workflowState;
    const reached = (target: WorkflowState) => state !== null && workflowStates.indexOf(state) >= workflowStates.indexOf(target);
    const consent = record.data?.recordingConsent;
    setConsent(consent?.call1 ? "recorded" : "pending");
    setCall2Consent(consent?.call2 ? "recorded" : "pending");
    setTranscriptCallNumber(reached("CANVAS_COMMIT_APPROVED") ? 2 : 1);
    setCall2Processed(reached("TRANSCRIPT_2_RECONCILED"));
    setDiagnosisApproved(reached("DIAGNOSIS_APPROVED"));
    setBriefSent(record.readinessBriefStatus === "Approved" || record.readinessBriefStatus === "Sent");
    const target = state ? resumeScreens[state] : "research";
    go(target);
    setResumed({ state, stage: uiStage(record.workflowState || record.stage), status: record.status, nextAction: record.nextAction, screen: target });
  }

  /**
   * Walks to one stop of the practice walkthrough. It navigates to the REAL screen the
   * stop is about and puts that screen into the state the stop describes. It never
   * substitutes a rebuilt or simplified version of a screen.
   */
  function goToStop(index: number) {
    const bounded = Math.max(0, Math.min(practiceTour.length - 1, index));
    const stop = practiceTour[bounded];
    setTourStep(bounded);
    setTourMode("guiding");
    setResearchTab(stop.focusTab);
    if (stop.callNumber) setTranscriptCallNumber(stop.callNumber);
    // Plain navigation only. Every screen in the tour is already fed by the state
    // `resume()` loaded when practice mode was opened; nothing here refetches.
    go(stop.screen);
  }

  /** Loads a practice engagement record into the cockpit and picks up the walkthrough where it was left. */
  async function enterPractice(record: BackendEngagement, restart: boolean) {
    setPracticeExists(true);
    setEngagements((items) => [toEngagement(record), ...items.filter((item) => item.id !== record.id)]);
    await resume(toEngagement(record));
    const saved = restart ? null : readTourState();
    if (saved?.mode === "done") {
      setTourStep(practiceTour.length - 1);
      setTourMode("done");
      go("catalog");
      return;
    }
    goToStop(saved?.step ?? 0);
  }

  /**
   * Opens practice mode from the start screen. An existing practice record is opened as it
   * stands; only a missing one is seeded, so re-entering never silently wipes anything.
   */
  async function openPractice() {
    setPracticeBusy("open"); setPracticeError(""); setNotice("");
    try {
      let record: BackendEngagement | null = null;
      if (practiceExists) {
        record = (await api<{ engagement: BackendEngagement | null }>("/api/demo")).engagement;
      }
      if (!record) {
        record = (await api<{ engagement: BackendEngagement; seeded: boolean }>("/api/demo", { body: JSON.stringify({ action: "seed" }), method: "POST" })).engagement;
      }
      await enterPractice(record, false);
    } catch (reason) {
      setPracticeError(`Practice mode could not be opened: ${reason instanceof Error ? reason.message : "unknown request failure"}. Nothing was created, and no client record was touched.`);
    } finally {
      setPracticeBusy("");
    }
  }

  /** Wipes the practice record and rebuilds it byte-for-byte, then restarts the walkthrough. */
  async function resetPractice() {
    setPracticeBusy("reset"); setPracticeError(""); setNotice("");
    try {
      const response = await api<{ engagement: BackendEngagement; seeded: boolean }>("/api/demo", { body: JSON.stringify({ action: "reset" }), method: "POST" });
      writeTourState(null);
      await enterPractice(response.engagement, true);
      setNotice(`Practice data reset. ${PRACTICE_CLIENT} is back exactly as it started, at the beginning of the walkthrough.`);
    } catch (reason) {
      setPracticeError(`The practice data could not be reset: ${reason instanceof Error ? reason.message : "unknown request failure"}. What is on screen is unchanged.`);
    } finally {
      setPracticeBusy("");
    }
  }

  /** Clears practice mode out of the cockpit. Local only — the practice record is left alone. */
  function leavePractice(message?: string) {
    setTourMode("off"); setTourStep(0); setResearchTab(undefined);
    // One shared reset for the whole per-engagement set, plus the identity and intake fields the
    // shared reset deliberately leaves to the caller.
    resetEngagementState();
    setActiveId(null); setCompany(""); setWebsite(""); setContact(""); setRole(""); setEmail(""); setContext("");
    setIntakeFile(null); setIntakeFileName(""); setIntakeFileState(null); setPendingSourceText("");
    go("home");
    if (message) setNotice(message);
  }

  /** Deletes the practice engagement outright. It can always be created again from the start screen. */
  async function removePractice() {
    setPracticeBusy("remove"); setPracticeError(""); setNotice("");
    try {
      await api<{ removed: boolean }>("/api/demo", { body: JSON.stringify({ action: "remove" }), method: "POST" });
      writeTourState(null);
      setPracticeExists(false);
      setEngagements((items) => items.filter((item) => !isPracticeEngagement(item.id)));
      leavePractice("The practice engagement was deleted. You can create it again from the start screen whenever you want it.");
    } catch (reason) {
      setPracticeError(`The practice engagement could not be deleted: ${reason instanceof Error ? reason.message : "unknown request failure"}. It is still here and still marked as practice data.`);
    } finally {
      setPracticeBusy("");
    }
  }

  async function saveSchedule(fields: { call1At?: string | null; call2At?: string | null }) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setScheduleBusy(true); setScheduleError(""); setScheduleSavedAt("");
    try {
      const current = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
      const response = await save<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`, {
        command: "update_metadata",
        expectedVersion: current.engagement.version,
        fields,
      }, "PATCH");
      setCall1At(response.engagement.call1At ?? null);
      setCall2At(response.engagement.call2At ?? null);
      setScheduleSavedAt(new Date().toLocaleTimeString());
      setEngagements((items) => items.map((item) => item.id === activeId ? { ...item, call1At: response.engagement.call1At ?? null, call2At: response.engagement.call2At ?? null } : item));
    } catch (reason) {
      setScheduleError(`The meeting time was not saved: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setScheduleBusy(false);
    }
  }

  /** Builds the client-facing Findings Call agenda, then hands over to the presentation screen. */
  async function openFindingsPresentation() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setAgendaBusy(true); setAgendaError("");
    try {
      const response = await save<{ document: FindingsAgendaDocument }>(`/api/engagements/${activeId}/findings-agenda`, {});
      const sections = orderedAgenda(response.document.data?.sections ?? []);
      setAgenda(sections);
      if (!sections.length) {
        setAgendaError("The findings agenda came back with no sections. Reconcile the transcript evidence before presenting.");
        return;
      }
      setAgendaStep(0);
      go("findings-call");
    } catch (reason) {
      setAgendaError(`The findings agenda could not be built: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setAgendaBusy(false);
    }
  }

  async function publishDocument(documentId: string) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setDeliverBusy(documentId); setDeliverError("");
    try {
      const response = await save<{ intent: IntentItem }>(`/api/engagements/${activeId}/publish`, { documentId });
      setIntents((items) => [response.intent, ...items.filter((item) => item.id !== response.intent.id)]);
      setNotice("Queued for review. Nothing has been sent yet — open Reviewed actions to approve and send it.");
    } catch (reason) {
      setDeliverError(`This document could not be queued for the client: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setDeliverBusy("");
    }
  }

  async function openOperations(next: Screen) {
    setOpsError("");
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    go(next);
    await loadEngagement(activeId);
  }

  async function activateSprint() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setOpsBusy("sprint"); setOpsError("");
    try {
      const response = await save<{ sprint: SprintRecord }>(`/api/engagements/${activeId}/sprint`, { action: "activate" });
      setSprint(response.sprint);
      setNotice("Sprint activated. The measurement clock started at the recorded starting metric.");
    } catch (reason) {
      setOpsError(`The sprint could not be activated: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setOpsBusy("");
    }
  }

  async function updateSprintTask(taskId: string, status: SprintTask["status"]) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setOpsBusy(`task:${taskId}`); setOpsError("");
    try {
      const response = await save<{ sprint: SprintRecord }>(`/api/engagements/${activeId}/sprint`, { action: "update_task", status, taskId });
      setSprint(response.sprint);
    } catch (reason) {
      setOpsError(`The task could not be updated: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setOpsBusy("");
    }
  }

  /** `improvedWhen` is sent only when the advisor explicitly picked or confirmed it; omitting it accepts the server inference. */
  async function recordOutcome(body: { endingMetric: Metric; improvedWhen?: "higher" | "lower"; constraintMoved: boolean; nextConstraintObserved: string }) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setOpsBusy("outcome"); setOpsError("");
    try {
      const response = await save<{ outcome: OutcomeMeasurement }>(`/api/engagements/${activeId}/outcome`, body);
      setOutcome(response.outcome);
      setNotice(body.improvedWhen
        ? "Ending metric recorded with your declared direction. Only the server-returned delta is displayed."
        : "Ending metric recorded. The server's inferred direction was accepted; only the server-returned delta is displayed.");
    } catch (reason) {
      setOpsError(`The outcome could not be recorded: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setOpsBusy("");
    }
  }

  /** Corrects the direction after the fact. The server recomputes the interpretation and regenerates the outcome report. */
  async function correctOutcomeDirection(improvedWhen: "higher" | "lower") {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setOpsBusy("direction"); setOpsError("");
    try {
      const response = await save<{ outcome: OutcomeMeasurement }>(`/api/engagements/${activeId}/outcome`, { improvedWhen }, "PATCH");
      setOutcome(response.outcome);
      setNotice("Direction corrected. The server re-read the delta and regenerated the outcome report.");
    } catch (reason) {
      setOpsError(`The direction could not be corrected: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setOpsBusy("");
    }
  }

  async function writeCatalog(body: { industryContext: string; reusableFor: string }) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setOpsBusy("catalog"); setOpsError("");
    try {
      const response = await save<{ catalogEntry: CatalogEntry }>(`/api/engagements/${activeId}/catalog`, body);
      setCatalogEntry(response.catalogEntry);
      setNotice("The reusable pattern was written back to the catalog.");
    } catch (reason) {
      setOpsError(`The catalog entry could not be written: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setOpsBusy("");
    }
  }

  async function selectTranscriptFile(file: File | null) {
    setTranscriptFile(null); setFileSummary(""); setFileError("");
    if (!file) return setFileName("");
    setFileName(file.name);
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      setFileError(`${file.name} is ${formatBytes(file.size)}. The upload limit is ${formatBytes(MAX_TRANSCRIPT_BYTES)} — paste the transcript text instead.`);
      return;
    }
    setFileReading(true);
    try {
      const payload = await readTranscriptFile(file);
      if (!payload.content.length) {
        setFileError(`${file.name} contained no readable content. Choose another file or paste the transcript text.`);
        return;
      }
      setTranscriptFile(payload);
      setFileSummary(payload.encoding === "utf8"
        ? `${formatBytes(file.size)} read · ${payload.content.length.toLocaleString()} characters parsed as text`
        : `${formatBytes(file.size)} read · sent base64-encoded for server-side extraction`);
    } catch (reason) {
      setFileError(`The file could not be read: ${reason instanceof Error ? reason.message : "unknown error"}`);
    } finally {
      setFileReading(false);
    }
  }

  async function sendBrief() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    if (sending) return;
    setSending(true);
    try {
      await save(`/api/engagements/${activeId}/readiness-brief`, { action: "approve" });
      await save(`/api/engagements/${activeId}/readiness-brief`, { action: "send_intent" });
      setBriefSent(true); setConfirmSend(false);
      setNotice("Brief approved and a reviewed send intent was recorded. No email was sent.");
    } catch {
      // Keep the confirmation open so the advisor can retry or cancel.
    } finally {
      setSending(false);
    }
  }

  /**
   * Sets the engagement's primary contact and role after intake. Diagnosis approval needs a named
   * owner, and if the role was left blank at intake there was no other screen to add it — this
   * unblocks that. The version is re-read immediately before the write to avoid a stale-version reject.
   */
  async function saveContact(nextContact: string, nextRole: string) {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    if (contactBusy) return;
    setContactBusy(true); setContactError("");
    try {
      const current = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
      const response = await save<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`, {
        command: "update_metadata",
        expectedVersion: current.engagement.version,
        fields: { primaryContact: nextContact.trim(), primaryContactRole: nextRole.trim() },
      }, "PATCH");
      const savedContact = response.engagement.primaryContact ?? nextContact.trim();
      const savedRole = response.engagement.primaryContactRole ?? nextRole.trim();
      setContact(savedContact); setRole(savedRole);
      setEngagements((items) => items.map((item) => item.id === activeId ? { ...item, primaryContact: savedContact, primaryContactRole: savedRole } : item));
      setNotice("Primary contact updated on the engagement record.");
    } catch (reason) {
      setContactError(`The primary contact could not be saved: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setContactBusy(false);
    }
  }

  /** Reads a chosen file and adds it to the engagement's source register from the Research screen. */
  async function addResearchSource(file: File) {
    if (!activeId) return setResearchSourceState({ tone: "error", message: "Open or create an engagement before adding a source." });
    const extension = extensionOf(file.name);
    if (extension === "pdf") return setResearchSourceState({ tone: "error", message: "PDF cannot be read by the source register. Export it to DOCX, TXT, Markdown, or CSV first." });
    if (!(sourceExtensions as readonly string[]).includes(extension)) return setResearchSourceState({ tone: "error", message: `${file.name} is not a supported source format. Use TXT, MD, CSV, DOCX, VTT, SRT, or JSON.` });
    if (file.size > MAX_TRANSCRIPT_BYTES) return setResearchSourceState({ tone: "error", message: `${file.name} is ${formatBytes(file.size)}. The upload limit is ${formatBytes(MAX_TRANSCRIPT_BYTES)}.` });
    setResearchSourceState({ tone: "reading", message: `Adding ${file.name} to the source register…` });
    try {
      const payload = await readTranscriptFile(file);
      if (!payload.content.length) return setResearchSourceState({ tone: "error", message: `${file.name} contained no readable content. Choose another file.` });
      await api(`/api/engagements/${activeId}/sources`, { method: "POST", body: JSON.stringify({ file: payload }) });
      setResearchSourceState({ tone: "ready", message: `${file.name} was added to the engagement's source register.` });
    } catch (reason) {
      setResearchSourceState({ tone: "error", message: `${file.name} was not added: ${reason instanceof Error ? reason.message : "unknown request failure"}` });
    }
  }

  async function analyze() {
    if (analyzing) return;
    if (!activeId) {
      setNotice("Action not completed: select or create an engagement first.");
      return;
    }
    const callConsent = transcriptCallNumber === 1 ? consent : call2Consent;
    if (callConsent !== "recorded") {
      setNotice("Transcript capture is blocked until recording and transcription consent is confirmed for this call.");
      return;
    }
    // Validate presence before flipping the busy flag so an empty submit does not lock the button.
    if (transcriptMethod === "fireflies" && !transcript.trim()) {
      setNotice("Enter a Fireflies transcript ID, or choose paste/upload.");
      return;
    }
    if (transcriptMethod === "upload" && !transcriptFile) {
      setNotice("Choose a transcript file and let it finish reading before analysis.");
      return;
    }
    if (transcriptMethod === "paste" && !transcript.trim()) {
      setNotice("Paste the transcript text before analysis.");
      return;
    }
    const consentAttestation = {
      grantedBeforeCapture: true,
      attestedBy: "Tier 4 Advisor",
      attestedAt: new Date().toISOString(),
      note: `Client confirmed recording and transcription consent for Call ${transcriptCallNumber}.`,
    };
    // Start from the always-true defaults, then apply every speaker the advisor tagged. Only speakers
    // resolved to "client" become evidence; anything left "unknown" is treated as a gap by the server.
    const resolvedSpeakerRoles: Record<string, "client" | "advisor" | "unknown"> = { Advisor: "advisor" };
    if (contact.trim()) resolvedSpeakerRoles[contact.trim()] = "client";
    for (const [name, resolved] of Object.entries(speakerRoles)) resolvedSpeakerRoles[name] = resolved;
    const humanOwner = contact.trim() && role.trim() ? { name: contact.trim(), role: role.trim() } : undefined;
    setAnalyzing(true);
    let response: { synthesis: TranscriptSynthesis };
    try {
      if (transcriptMethod === "fireflies") {
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/fireflies`, {
          transcriptId: transcript,
          callNumber: transcriptCallNumber,
          consentAttestation,
          speakerRoles: resolvedSpeakerRoles,
        });
      } else if (transcriptMethod === "upload") {
        if (!transcriptFile) { setAnalyzing(false); return; }
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/transcripts`, {
          callNumber: transcriptCallNumber,
          consentAttestation,
          file: transcriptFile,
          humanOwner,
          speakerRoles: resolvedSpeakerRoles,
        });
      } else {
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/transcripts`, {
          callNumber: transcriptCallNumber,
          consentAttestation,
          humanOwner,
          rawText: transcript,
          speakerRoles: resolvedSpeakerRoles,
        });
      }
    } catch {
      setAnalyzing(false);
      return;
    }
    setSynthesisResult(response.synthesis);
    try {
      const refreshed = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
      setCanvas(refreshed.engagement.data?.canvas ?? null);
    } catch {
      // The synthesis is already on screen; a canvas refresh failure must not hide it.
    }
    setAnalyzing(false);
    if (transcriptCallNumber === 2) {
      setCall2Processed(true);
      setNotice("Call 2 transcript reconciled. Review the finding once more before diagnosis approval.");
      go("findings");
    } else {
      go("synthesis");
    }
  }

  async function approve(checkpoint: "canvas" | "diagnosis") {
    if (approving) return;
    if (!activeId) {
      setNotice("Action not completed: select or create an engagement first.");
      return;
    }
    if (checkpoint === "canvas") {
      setApproving("canvas");
      try {
        const current = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
        await save(`/api/engagements/${activeId}`, {
          command: "advance_workflow",
          expectedVersion: current.engagement.version,
          nextState: "CANVAS_COMMIT_APPROVED",
          nextAction: "Run the Findings Call",
        }, "PATCH");
        go("findings");
      } catch {
        // Keep the advisor at the checkpoint after a failed approval.
      } finally {
        setApproving("");
      }
      return;
    }
    if (!call2Processed) {
      setTranscriptCallNumber(2);
      setTranscript("");
      setFileName(""); setTranscriptFile(null); setFileSummary(""); setFileError("");
      setNotice("After the Findings Call, add the Call 2 transcript so clarifications can be reconciled.");
      go("transcript");
      return;
    }
    if (!contact.trim() || !role.trim()) {
      setNotice("Diagnosis approval requires a named human owner and role. Add them to the engagement before approval.");
      return;
    }
    setApproving("diagnosis");
    try {
      await save(`/api/engagements/${activeId}/finding`, {
        action: "approve_diagnosis",
        humanOwner: { name: contact.trim(), role: role.trim() },
      });
      setDiagnosisApproved(true);
      go("deliver");
      await loadEngagement(activeId);
    } catch {
      // Keep the advisor on the finding review after a failed approval.
    } finally {
      setApproving("");
    }
  }

  async function generateAllDeliverables() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    setDeliverBusy("suite"); setDeliverError("");
    try {
      const response = await save<{ documents: ArtifactRecord[] }>(`/api/engagements/${activeId}/deliverables`, {});
      setArtifacts((existing) => [...response.documents, ...existing.filter((item) => !response.documents.some((fresh) => fresh.kind === item.kind))]);
      setNotice("The deliverable suite was generated. Each card below now points at a real document.");
    } catch (reason) {
      setDeliverError(`The deliverable suite could not be generated: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setDeliverBusy("");
    }
  }

  /**
   * The advisor's live gap register. These are the advisor's own open questions,
   * flagged when the client says they do not know. They are advisor notes: they
   * never become quotes, metrics, Canvas claims, or anything client-stated.
   */
  function flagGap(input: { owner: string; lookIn: string }) {
    if (!callQuestion) return;
    setGapSave("idle"); setGapError("");
    setGapFlags((all) => [
      ...all.filter((gap) => gap.questionId !== callQuestion.id),
      {
        flaggedAt: new Date().toISOString(), lookIn: input.lookIn, owner: input.owner,
        question: callQuestion.question, questionId: callQuestion.id, section: callQuestion.section,
      },
    ]);
  }

  function unflagGap() {
    if (!callQuestion) return;
    setGapSave("idle"); setGapError("");
    setGapFlags((all) => all.filter((gap) => gap.questionId !== callQuestion.id));
  }

  /**
   * Writes the gap register into the engagement's free-text notes under an explicit
   * advisor heading, replacing the managed block rather than appending to it. Uses
   * `api` rather than `save` on purpose: a failure has to surface inside the coaching
   * rail, not as a banner across a screen a client may be looking at.
   */
  async function saveGaps() {
    if (!activeId) {
      setGapSave("error");
      setGapError("No engagement is open, so there is nowhere to write these. They are still listed here.");
      return;
    }
    setGapSave("saving"); setGapError("");
    try {
      const current = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
      await api(`/api/engagements/${activeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          command: "update_metadata",
          expectedVersion: current.engagement.version,
          fields: { notes: mergeGapNotes(current.engagement.notes ?? "", gapFlags) },
        }),
      });
      setGapSave("saved");
    } catch (reason) {
      setGapSave("error");
      setGapError(`Not saved: ${reason instanceof Error ? reason.message : "unknown request failure"}. The gaps are still listed here — try again before you leave the call view.`);
    }
  }

  async function prepareCrmWriteBack() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    if (deliverBusy) return;
    setDeliverBusy("crm"); setDeliverError("");
    try {
      await save(`/api/engagements/${activeId}/crm`, {});
      setNotice("CRM write-back intent prepared. No external Sheet was changed.");
    } catch {
      // Do not claim intent creation after an API failure.
    } finally {
      setDeliverBusy("");
    }
  }

  return <div className={`cockpit ${isClientFacing(screen) ? "client-call" : ""} ${practiceActive ? "practice" : ""}`}>
    <a className="skip" href="#main">Skip to main content</a>
    {/* Outside <main> and outside every screen, so no screen can suppress it. No dismiss control exists. */}
    {practiceActive ? <PracticeBar busy={practiceBusy} onLeave={() => leavePractice()} onReset={resetPractice} /> : null}
    <header className="app-header">
      <button className="brand" onClick={() => go("home")} type="button"><span><Icon name="shield" size={18} /></span>TIER 4 <em>AUDIT</em></button>
      {screen !== "home" ? <div className="header-context"><i />{displayCompany}{practiceActive ? <PracticeMark compact /> : null}<Pill tone={isClientFacing(screen) ? "known" : "neutral"}>{isClientFacing(screen) ? "Client call view" : "Advisor view"}</Pill></div> : null}
      <button aria-controls="primary-navigation" aria-expanded={mobileNav} aria-label={mobileNav ? "Close navigation" : "Open navigation"} className="mobile-nav" onClick={() => setMobileNav(!mobileNav)} type="button"><Icon name={mobileNav ? "close" : "menu"} /></button>
      <nav aria-label="Product navigation" className={mobileNav ? "open" : ""} id="primary-navigation">
        <Documents activeId={activeId} />
        <button className="header-link" onClick={() => go("engagements")} type="button"><Icon name="briefcase" size={16} />Engagements</button>
        <button className="header-link" onClick={() => go("integrations")} type="button"><Icon name="integration" size={16} />Integrations</button>
        <button className="header-link" onClick={() => go("settings")} type="button"><Icon name="lock" size={16} />Settings</button>
        {screen !== "home" ? <button className="exit" onClick={() => go("home")} type="button">Exit</button> : null}
      </nav>
    </header>
    {currentStage && !isClientFacing(screen) ? <Stepper current={currentStage} /> : null}
    <main id="main">
      {notice ? <div className="notice" role="status"><Icon name="info" size={16} />{notice}<button aria-label="Dismiss" onClick={() => setNotice("")} type="button"><Icon name="close" size={14} /></button></div> : null}
      {practiceError && !guidanceHidden ? <p className="ops-error practice-error" role="alert"><Icon name="info" size={15} />{practiceError}<button aria-label="Dismiss" onClick={() => setPracticeError("")} type="button"><Icon name="close" size={14} /></button></p> : null}
      {resumed && !isClientFacing(screen) ? <div className="resume-banner" role="status">
        <span className="resume-mark"><Icon name="refresh" size={19} /></span>
        <div><p className="eyebrow">Resumed · {displayCompany}</p><strong>{resumed.state ? workflowCopy[resumed.state][0] : "Stage not reported by the server"}</strong>
          <p>Next: {resumed.nextAction || (resumed.state ? workflowCopy[resumed.state][1] : "Review the record and pick the next step.")}</p></div>
        <dl><div><dt>Stage</dt><dd><Pill>{resumed.stage}</Pill></dd></div><div><dt>Checkpoint</dt><dd>{resumed.state ?? "unrecognized"}</dd></div><div><dt>Status</dt><dd>{resumed.status || "Not reported"}</dd></div><div><dt>Opened on</dt><dd>{screenLabels[resumed.screen] ?? resumed.screen}</dd></div></dl>
        <button aria-label="Dismiss" onClick={() => setResumed(null)} type="button"><Icon name="close" size={15} /></button>
      </div> : null}
      {screen === "home" ? <Home engagements={engagements} loading={registryLoading} onFresh={() => go("intake")} onMigration={() => go("migration")} onPractice={openPractice} onResume={resume} onUpdate={() => go("engagements")} practiceBusy={practiceBusy} practiceExists={practiceExists} practiceProbe={practiceProbe} /> : null}
      {screen === "intake" ? <Intake apiState={apiState} company={company} contact={contact} context={context} email={email} fileName={intakeFileName} fileState={intakeFileState} locked={practiceActive && tourMode !== "off"} onBack={() => go("home")} onCompany={setCompany} onContact={setContact} onContext={setContext} onEmail={setEmail} onFile={selectIntakeFile} onRole={setRole} onSubmit={createEngagement} onWebsite={setWebsite} role={role} website={website} /> : null}
      {screen === "migration" ? <Migration onBack={() => go("home")} onStage={(payload) => {
        if (payload.file) {
          setIntakeFile(payload.file);
          setIntakeFileName(payload.fileName);
          setIntakeFileState({ tone: "ready", message: `${payload.fileName} is ready and will be added to the engagement's source register once it is created below.` });
        }
        setPendingSourceText(payload.text);
        const parts: string[] = [];
        if (payload.file) parts.push(`${payload.fileName}`);
        if (payload.text.trim()) parts.push("your pasted notes");
        setNotice(parts.length
          ? `${parts.join(" and ")} will be added to the engagement's source register once you create it below.`
          : "Add the client anchor to begin the engagement.");
        go("intake");
      }} /> : null}
      {screen === "engagements" ? <Engagements engagements={engagements} loading={registryLoading} onBack={() => go("home")} onFresh={() => go("intake")} onResume={resume} /> : null}
      {screen === "research" ? <Research canvas={canvas} company={displayCompany} focusTab={researchTab} onAddSource={addResearchSource} onBack={() => go("intake")} onPrepare={() => go("prepare")} research={researchResult} script={script} sourceState={researchSourceState} /> : null}
      {screen === "prepare" ? <Prepare briefSent={briefSent} call1At={call1At} call2At={call2At} contact={contact || "Primary contact"} email={email} onBack={() => go("research")} onCall={() => { setCallIndex(0); go("call"); }} onSaveSchedule={saveSchedule} onSend={() => { setConfirmed(false); setConfirmSend(true); }} savedAt={scheduleSavedAt} scheduleBusy={scheduleBusy} scheduleError={scheduleError} /> : null}
      {screen === "call" && callQuestion ? <Call answer={answers[callQuestion.id] ?? ""} company={displayCompany} consent={consent} gapError={gapError} gaps={gapFlags} gapSave={gapSave} generic={script.generic} index={Math.min(callIndex, script.questions.length - 1)} notes={notes[callQuestion.id] ?? ""} onAnswer={(value) => setAnswers((all) => ({ ...all, [callQuestion.id]: value }))} onConsent={setConsent} onExit={() => go("prepare")} onFlagGap={flagGap} onNext={() => callIndex < script.questions.length - 1 ? setCallIndex(callIndex + 1) : go("transcript")} onNotes={(value) => setNotes((all) => ({ ...all, [callQuestion.id]: value }))} onPresenting={setPresenting} onPrevious={() => setCallIndex(Math.max(0, callIndex - 1))} onSaveGaps={saveGaps} onUnflagGap={unflagGap} onValue={(value) => setValues((all) => ({ ...all, [callQuestion.id]: value }))} practice={practiceActive} presenting={presenting} question={callQuestion} scheduledAt={call1At} total={script.questions.length} value={values[callQuestion.id] ?? ""} /> : null}
      {screen === "transcript" ? <Transcript busy={analyzing} callNumber={transcriptCallNumber} company={displayCompany} fileError={fileError} fileName={fileName} fileReading={fileReading} fileSummary={fileSummary} method={transcriptMethod} onAnalyze={analyze} onBack={() => transcriptCallNumber === 2 ? go("findings") : go("call")} onFile={selectTranscriptFile} onMethod={setTranscriptMethod} onSpeakerRole={(speaker, roleValue) => setSpeakerRoles((prev) => ({ ...prev, [speaker]: roleValue }))} onText={setTranscript} ready={Boolean(transcriptFile)} scheduledAt={transcriptCallNumber === 1 ? call1At : call2At} speakerNote={speakerNote} speakerRoles={speakerRoles} speakers={detectedSpeakers} text={transcript} /> : null}
      {screen === "synthesis" ? <Synthesis busy={approving === "canvas"} onApprove={() => approve("canvas")} onBack={() => go("transcript")} synthesis={synthesisResult} /> : null}
      {screen === "findings" ? <Findings agendaBusy={agendaBusy} agendaError={agendaError} busy={approving === "diagnosis"} consent={call2Consent} contact={contact} contactBusy={contactBusy} contactError={contactError} contactRole={role} onApprove={() => approve("diagnosis")} onBack={() => go("synthesis")} onConsent={setCall2Consent} onPresent={openFindingsPresentation} onSaveContact={saveContact} owner={contact && role ? `${contact}, ${role}` : ""} scheduledAt={call2At} synthesis={synthesisResult} /> : null}
      {screen === "findings-call" ? <FindingsPresentation company={displayCompany} consent={call2Consent} index={Math.min(agendaStep, Math.max(0, agenda.length - 1))} onConsent={setCall2Consent} onExit={() => go("findings")} onNext={() => setAgendaStep((step) => Math.min(agenda.length - 1, step + 1))} onPrevious={() => setAgendaStep((step) => Math.max(0, step - 1))} practice={practiceActive} scheduledAt={call2At} sections={agenda} /> : null}
      {screen === "deliver" ? <Deliver approved={diagnosisApproved} artifacts={artifacts} busy={deliverBusy} error={deliverError} intents={intents} onActions={() => openOperations("actions")} onBack={() => go("findings")} onGenerate={generateAllDeliverables} onOperate={openOperations} onPublish={publishDocument} onSync={prepareCrmWriteBack} /> : null}
      {screen === "sprint" ? <SprintScreen busy={opsBusy} error={opsError} onActivate={activateSprint} onBack={() => { go("deliver"); if (activeId) void loadEngagement(activeId); }} onNavigate={openOperations} onTask={updateSprintTask} sprint={sprint} /> : null}
      {screen === "measure" ? <Measure busy={opsBusy === "outcome"} correcting={opsBusy === "direction"} error={opsError} onBack={() => openOperations("sprint")} onCorrectDirection={correctOutcomeDirection} onNavigate={openOperations} onSubmit={recordOutcome} outcome={outcome} sprint={sprint} /> : null}
      {screen === "catalog" ? <Catalog busy={opsBusy === "catalog"} entry={catalogEntry} error={opsError} onBack={() => openOperations("measure")} onNavigate={openOperations} onSubmit={writeCatalog} outcome={outcome} /> : null}
      {screen === "actions" ? <ReviewedActions engagementId={activeId} onBack={() => openOperations("sprint")} onNavigate={openOperations} /> : null}
      {screen === "integrations" ? <IntegrationCenter onBack={() => go("home")} /> : null}
      {screen === "settings" ? <SettingsScreen onBack={() => go("home")} onIntegrations={() => go("integrations")} /> : null}
      {screen === "call" && !callQuestion ? <section className="guided narrow"><PageHead eyebrow="Call · guided script" title="No call question is available.">Run research for this engagement so the guided call can be driven by client-specific discovery questions.</PageHead><Button icon="back" onClick={() => go("research")}>Back to research</Button></section> : null}
    </main>
    {screen !== "home" && !isClientFacing(screen) ? <div aria-live="polite" className="save-state"><i className={apiState} />{apiState === "saving" ? "Saving…" : apiState === "saved" ? "Saved" : apiState === "error" ? "Action failed" : "Ready"}</div> : null}
    {practiceActive ? <PracticeTour busy={practiceBusy} hidden={guidanceHidden} index={tourStep} mode={tourMode} onExplore={() => setTourMode("exploring")} onFinish={() => setTourMode("done")} onJump={goToStop} onLeave={() => leavePractice()} onNext={() => goToStop(tourStep + 1)} onPrevious={() => goToStop(tourStep - 1)} onRemove={removePractice} onReset={resetPractice} onRestart={() => goToStop(0)} onResume={() => goToStop(tourStep)} onScreen={screen === practiceTour[Math.min(tourStep, practiceTour.length - 1)].screen} /> : null}
    {confirmSend ? <div className="modal-layer"><div aria-describedby="send-description" aria-labelledby="send-title" aria-modal="true" className="modal" ref={modalRef} role="dialog">
      <button aria-label="Close" className="modal-close" onClick={() => setConfirmSend(false)} type="button"><Icon name="close" size={17} /></button>
      <span className="modal-icon"><Icon name="mail" size={21} /></span><p className="eyebrow">External intent</p><h2 id="send-title">Approve this send intent</h2>
      <p id="send-description">This records approval and prepares a reviewed send intent. It does not send an email. The brief excludes the Canvas, internal questions, and constraint hypotheses.</p>
      <dl><div><dt>Recipient</dt><dd>{contact || "Primary contact"}</dd></div><div><dt>Email address</dt><dd>{email.trim() || "No address on the engagement — the send would have nowhere to go"}</dd></div><div><dt>Delivery intent</dt><dd>Email draft</dd></div><div><dt>Document</dt><dd>Pre-Call Readiness Brief</dd></div></dl>
      <label className="confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />I reviewed the recipient and client-facing content.</label>
      <div className="modal-actions"><Button onClick={() => setConfirmSend(false)} variant="secondary">Cancel</Button><Button disabled={!confirmed || sending} icon="mail" onClick={sendBrief}>{sending ? "Approving…" : "Approve send intent"}</Button></div>
      <small>No external provider is contacted by this action.</small>
    </div></div> : null}
  </div>;
}

/** One row of the recent list. Practice records get their own mark and never sit in the client group. */
function RecentRow({ item, onResume }: { item: Engagement; onResume: (item: Engagement) => void }) {
  const practice = isPracticeEngagement(item.id);
  return <button className={`recent${practice ? " practice" : ""}`} onClick={() => onResume(item)} type="button">
    <span className="initials">{practice ? <Icon name="shield" size={16} /> : item.companyName.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span>
    <span><strong>{item.companyName}</strong><small>{practice ? "Practice engagement · fictional training data" : item.status}</small></span>
    {practice ? <PracticeMark compact /> : <Pill>{item.stage}</Pill>}
    <Icon name="chevron" size={16} />
  </button>;
}

function Home({ engagements, loading, onFresh, onMigration, onPractice, onResume, onUpdate, practiceBusy, practiceExists, practiceProbe }: {
  engagements: Engagement[]; loading: boolean; onFresh: () => void; onMigration: () => void;
  onPractice: () => void; onResume: (item: Engagement) => void; onUpdate: () => void;
  practiceBusy: "" | "open" | "reset" | "remove"; practiceExists: boolean; practiceProbe: "loading" | "ready" | "error";
}) {
  // Practice records are separated out of the client list entirely, not merely labelled inside it.
  const practice = engagements.filter((item) => isPracticeEngagement(item.id));
  const clients = engagements.filter((item) => !isPracticeEngagement(item.id));
  const opening = practiceBusy === "open";
  return <section className="home">
    <div className="ambient one" /><div className="ambient two" />
    <div className="home-copy"><Pill tone="known"><Icon name="spark" size={12} /> Guided throughput audit</Pill><h1>Find the constraint.<br />Measure what changes.</h1><p>Begin a new client conversation or continue an evidence-grounded audit. One constraint, one prescription, one metric, one named human owner.</p></div>
    <div className="entry-grid">
      <button className="entry primary" onClick={onFresh} type="button"><span className="entry-icon"><Icon name="plus" size={25} /></span><span><small>Start here</small><strong>Fresh engagement</strong><p>Give us a client starting point. We’ll research publicly, draft the operating model, and prepare the questions that matter.</p></span><b>Start a new audit <Icon name="arrow" size={17} /></b></button>
      <div className="secondary-entries">
        <button className="entry secondary" onClick={onMigration} type="button"><span className="entry-icon"><Icon name="upload" size={21} /></span><span><strong>External migration</strong><p>Bring an existing audit, transcript, notes, or workspace into the same guided structure.</p></span><Icon name="chevron" size={17} /></button>
        <button className="entry secondary" onClick={onUpdate} type="button"><span className="entry-icon"><Icon name="refresh" size={21} /></span><span><strong>Update an engagement</strong><p>Continue from the current stage in your inspectable engagement registry.</p></span><Icon name="chevron" size={17} /></button>
        <button className="entry secondary practice-entry" disabled={opening} onClick={onPractice} type="button"><span className="entry-icon"><Icon name="people" size={21} /></span>
          <span><small>No client involved</small><strong>{practiceProbe === "ready" && practiceExists ? "Practice mode · pick up where you left off" : "Practice mode · walk a worked example"}</strong>
            <p>Walk one complete engagement end to end before you run a real one — the research, both calls, the diagnosis, the sprint and the measured result, with a short note at every screen explaining what you are looking at. The company is invented, nothing can reach a client, and you can reset it as often as you like.</p></span>
          {opening ? <span className="entry-busy" role="status">Opening…</span> : <Icon name="chevron" size={17} />}</button>
      </div>
    </div>
    {practice.length ? <div className="practice-recent">
      <div className="practice-recent-head"><PracticeMark /><span>Kept apart from your client work. Nothing in this record describes a real company.</span></div>
      <div className="recent-list">{practice.map((item) => <RecentRow item={item} key={item.id} onResume={onResume} />)}</div>
    </div> : null}
    <div className="recent-head"><div><p className="eyebrow">Continue the work</p><h2>Recent engagements</h2></div><button onClick={onUpdate} type="button">View all engagements <Icon name="arrow" size={14} /></button></div>
    <div className="recent-list">{loading ? <p className="registry-empty" role="status">Loading the engagement registry…</p> : null}{!loading && clients.length === 0 ? <p className="registry-empty">{practice.length ? "No client engagements yet — only the practice record above. Start a fresh engagement to create your first real one." : "No engagements yet. Start a fresh engagement to create the first record."}</p> : null}{clients.map((item) => <RecentRow item={item} key={item.id} onResume={onResume} />)}</div>
    <div className="local-note"><Icon name="shield" size={18} /><span><strong>Deterministic local mode is ready.</strong> No OpenAI key or paid enrichment is required. External connectors run only after explicit setup and approval.</span></div>
  </section>;
}

function Intake(props: {
  apiState: string; company: string; website: string; contact: string; role: string; email: string; context: string;
  fileName: string; fileState: { tone: "reading" | "ready" | "error" | "added"; message: string } | null;
  /** True while a practice walkthrough is open: the form is shown for reading, not for creating a record. */
  locked?: boolean;
  onBack: () => void; onCompany: (v: string) => void; onWebsite: (v: string) => void;
  onContact: (v: string) => void; onRole: (v: string) => void; onEmail: (v: string) => void;
  onContext: (v: string) => void; onFile: (file: File | null) => void; onSubmit: (e: FormEvent) => void;
}) {
  const emailValid = looksLikeEmail(props.email);
  const emailTouched = props.email.trim().length > 0;
  // Research runs on the public website, so it is required here — the same way email is — rather than
  // letting the create→research flow 400 after the record already exists and tempt a duplicate submit.
  const websiteValid = props.website.trim().length > 0;
  const busy = props.apiState === "saving" || props.fileState?.tone === "reading";
  return <section className="guided narrow"><Back onClick={props.onBack}>Entry options</Back><PageHead eyebrow="Client · Starting point" title="Who are we learning about?">Give us a starting point. We’ll research the business, draft a first-pass business model, and prepare the questions that matter for your call.</PageHead>
    <form className="intake-form" onSubmit={props.locked ? (event) => event.preventDefault() : props.onSubmit}>
      <div className="field-row"><label><span>Company name <em>Required</em></span><input autoFocus onChange={(e) => props.onCompany(e.target.value)} placeholder="Acme Industrial" required value={props.company} /></label><label className="field-note"><span>Company website <em>Required</em></span><input autoCapitalize="none" inputMode="url" onBlur={(e) => props.onWebsite(normalizeWebsiteInput(e.target.value))} onChange={(e) => props.onWebsite(e.target.value)} placeholder="tier4advisors.com" spellCheck={false} type="text" value={props.website} /><small>Research runs on the public website, so we need one before we can start. Without it the engagement has nothing to research.</small></label></div>
      <div className="field-row"><label><span>Primary contact name</span><input onChange={(e) => props.onContact(e.target.value)} placeholder="Maya Chen" value={props.contact} /></label><label className="field-note"><span>Primary contact role</span><input onChange={(e) => props.onRole(e.target.value)} placeholder="Chief Operating Officer" value={props.role} /><small>Stored as its own field, not buried in notes. Diagnosis approval reuses the name and role as the named human owner.</small></label></div>
      <label className="field-note"><span>Primary contact email <em>Required</em></span><input autoCapitalize="none" className={emailTouched && !emailValid ? "invalid" : ""} inputMode="email" onChange={(e) => props.onEmail(e.target.value)} placeholder="maya@acmeindustrial.com" spellCheck={false} type="email" value={props.email} />
        <small>{emailTouched && !emailValid ? "That does not look like an email address yet." : "We’ll send the pre-call readiness brief here. Without it the brief has nowhere to go and cannot be sent."}</small></label>
      <label><span>What prompted this conversation? <small>Optional</small></span><textarea onChange={(e) => props.onContext(e.target.value)} placeholder="What is changing, stuck, or important right now?" rows={5} value={props.context} /></label>
      <label className="upload"><input accept={sourceAccept} onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} type="file" /><span><Icon name="upload" size={20} /></span><span><strong>{props.fileName || "Add an email, notes, proposal, or prior document"}</strong><small>Optional · TXT, Markdown, CSV, DOCX, VTT, SRT, or JSON. PDF cannot be read — export it first.</small></span></label>
      {props.fileState ? <p className={`upload-state ${props.fileState.tone === "error" ? "error" : props.fileState.tone === "reading" ? "" : "ready"}`} role={props.fileState.tone === "error" ? "alert" : "status"}><Icon name={props.fileState.tone === "error" ? "info" : props.fileState.tone === "reading" ? "refresh" : "check"} size={15} />{props.fileState.message}</p> : null}
      {props.locked ? <p className="upload-state ready" role="status"><Icon name="shield" size={15} />You are walking the practice example, so this form is here to read rather than to submit. Creating a new engagement is switched off until you leave practice mode — nothing you do on this screen can create a record.</p> : null}
      <div className="action-row"><p><Icon name="shield" size={18} /><span><strong>Public sources first.</strong> Nothing is sent to the client, and paid enrichment never runs automatically.</span></p><Button disabled={props.locked || !props.company.trim() || !websiteValid || !emailValid || busy} icon="arrow" type="submit">{props.locked ? "Creating engagements is off in practice mode" : props.apiState === "saving" ? "Preparing research…" : "Research this business"}</Button></div>
    </form>
  </section>;
}

function Migration({ onBack, onStage }: {
  onBack: () => void;
  onStage: (payload: { file: TranscriptFile | null; fileName: string; text: string }) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<TranscriptFile | null>(null);
  const [text, setText] = useState("");
  const [fileState, setFileState] = useState<{ tone: "reading" | "ready" | "error"; message: string } | null>(null);
  async function choose(picked: File | null) {
    setFile(null); setFileState(null);
    if (!picked) return setFileName("");
    setFileName(picked.name);
    const extension = extensionOf(picked.name);
    if (extension === "pdf") return setFileState({ tone: "error", message: "PDF cannot be read by the source register. Export it to DOCX, TXT, Markdown, or CSV first." });
    if (!(sourceExtensions as readonly string[]).includes(extension)) return setFileState({ tone: "error", message: `${picked.name} is not a supported source format. Use TXT, MD, CSV, DOCX, VTT, SRT, or JSON.` });
    if (picked.size > MAX_TRANSCRIPT_BYTES) return setFileState({ tone: "error", message: `${picked.name} is ${formatBytes(picked.size)}. The upload limit is ${formatBytes(MAX_TRANSCRIPT_BYTES)}.` });
    setFileState({ tone: "reading", message: `Reading ${picked.name}…` });
    try {
      const payload = await readTranscriptFile(picked);
      if (!payload.content.length) return setFileState({ tone: "error", message: `${picked.name} contained no readable content. Choose another file.` });
      setFile(payload);
      setFileState({ tone: "ready", message: `${formatBytes(picked.size)} read. It is attached to the engagement's source register once you add the client anchor.` });
    } catch (reason) {
      setFileState({ tone: "error", message: `The file could not be read: ${reason instanceof Error ? reason.message : "unknown error"}` });
    }
  }
  const blocked = fileState?.tone === "reading" || fileState?.tone === "error";
  return <section className="guided narrow"><Back onClick={onBack}>Entry options</Back><PageHead eyebrow="Client · External migration" title="Bring the existing work with you.">Import an audit, transcript, notes, or workspace export. It is attached to the new engagement’s source register once you add the client anchor.</PageHead>
    <div className="panel"><label className="upload large"><input accept={sourceAccept} onChange={(e) => choose(e.target.files?.[0] ?? null)} type="file" /><span><Icon name="upload" size={23} /></span><span><strong>{fileName || "Choose a source file"}</strong><small>TXT, Markdown, CSV, DOCX, VTT, SRT, or JSON. PDF cannot be read — export it first.</small></span></label>
      {fileState ? <p className={`upload-state ${fileState.tone === "error" ? "error" : fileState.tone === "reading" ? "" : "ready"}`} role={fileState.tone === "error" ? "alert" : "status"}><Icon name={fileState.tone === "error" ? "info" : fileState.tone === "reading" ? "refresh" : "check"} size={15} />{fileState.message}</p> : null}
      <div className="or"><span>or paste source material</span></div><label><span>Existing notes or transcript</span><textarea onChange={(e) => setText(e.target.value)} placeholder="Paste the material exactly as received…" rows={9} value={text} /></label>
      <div className="action-row"><p><Icon name="info" size={17} />Nothing is captured on this screen. The file and pasted text are added to the engagement’s source register after you add the client anchor.</p><Button disabled={blocked || (!file && !text.trim())} icon="arrow" onClick={() => onStage({ file, fileName, text })}>Continue with client anchor</Button></div>
    </div>
  </section>;
}

function Engagements({ engagements, loading, onBack, onFresh, onResume }: { engagements: Engagement[]; loading: boolean; onBack: () => void; onFresh: () => void; onResume: (item: Engagement) => void }) {
  // Practice records are listed in their own group with their own marker, never interleaved
  // with client work where a tired advisor could mistake one for the other.
  const practice = engagements.filter((item) => isPracticeEngagement(item.id));
  const clients = engagements.filter((item) => !isPracticeEngagement(item.id));
  const row = (item: Engagement) => <tr className={isPracticeEngagement(item.id) ? "practice" : ""} key={item.id}>
    <td><strong>{item.companyName}</strong><small>{item.website}</small>{isPracticeEngagement(item.id) ? <PracticeMark compact /> : null}</td>
    <td><Pill>{item.stage}</Pill></td>
    <td><strong>{item.status}</strong><small>{item.nextAction}</small></td>
    <td>{item.updatedAt}</td>
    <td><Button onClick={() => onResume(item)} variant="secondary">Resume <Icon name="arrow" size={14} /></Button></td>
  </tr>;
  return <section className="guided wide"><Back onClick={onBack}>Entry options</Back><PageHead eyebrow="Client registry" side={<Button icon="plus" onClick={onFresh}>Fresh engagement</Button>} title="Engagements">Continue from the current stage. Stage, next action, dates, and document links remain directly inspectable.</PageHead>
    {loading ? <p className="registry-empty" role="status">Loading the engagement registry…</p> : null}
    {!loading && engagements.length === 0 ? <p className="registry-empty">No engagement records were returned.</p> : null}
    {engagements.length ? <div className="table-wrap"><table className="registry"><thead><tr><th>Client</th><th>Stage</th><th>Status & next action</th><th>Updated</th><th /></tr></thead>
      {practice.length ? <tbody className="registry-practice">
        <tr className="registry-group"><td colSpan={5}><PracticeMark /><span>Training records. Fictional companies, invented quotes, invented numbers — never client work and never quotable.</span></td></tr>
        {practice.map(row)}
      </tbody> : null}
      <tbody>
        {practice.length ? <tr className="registry-group"><td colSpan={5}><strong>Client engagements</strong><span>Real records for real companies.</span></td></tr> : null}
        {clients.length ? clients.map(row) : <tr><td colSpan={5}>No client engagements yet. Everything in the registry is practice data.</td></tr>}
      </tbody>
    </table></div> : null}
    <div className="source-note"><Icon name="file" size={17} /><strong>V1 registry:</strong> Google Sheets when connected, with deterministic local records as the no-credential default.</div>
  </section>;
}

/** The canonical Canvas wins when the server has written one; research facts are the fallback only. */
function claimsForBlock(canvas: CanvasRecord | null, facts: EvidenceClaim[], title: string): EvidenceClaim[] {
  const key = canvas ? Object.keys(canvas).find((name) => name.toLowerCase() === title.toLowerCase()) : undefined;
  const claims = key && canvas ? canvas[key] ?? [] : facts.filter((fact) => fact.canvasBlock?.toLowerCase() === title.toLowerCase());
  return [...claims].sort((a, b) => Number(b.provenance === "client-stated") - Number(a.provenance === "client-stated")).slice(0, 3);
}

function Research({ canvas, company, focusTab, onAddSource, onBack, onPrepare, research, script, sourceState }: {
  canvas: CanvasRecord | null; company: string;
  /** Lets the practice walkthrough open this screen on the tab its current stop is about. */
  focusTab?: ResearchTab;
  onAddSource: (file: File) => void; onBack: () => void; onPrepare: () => void;
  research: ResearchPayload | null; script: { questions: DiscoveryQuestion[]; generic: boolean };
  sourceState: { tone: "reading" | "ready" | "error"; message: string } | null;
}) {
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<ResearchTab>(focusTab ?? "canvas");
  // Same render-phase sync the coaching rail uses: a changed request moves the tab once,
  // and the advisor keeps control of it from then on.
  const [requested, setRequested] = useState(focusTab);
  if (focusTab !== requested) {
    setRequested(focusTab);
    if (focusTab) setTab(focusTab);
  }
  const publicSummary = research?.facts[0]?.statement || research?.description || "No public company fact was extracted. Treat every canvas block as a discovery gap.";
  const gaps = research?.gaps?.length ? research.gaps : ["Customer and demand profile", "End-to-end workflow", "Monthly volume", "Cycle time", "Queue size", "Rework", "Missed demand", "Cost of delay"];
  const flow = [...(research?.valueFlow ?? [])].sort((a, b) => a.order - b.order);
  const openAIUsed = research?.researchMode === "openai-web-search";
  return <section className="guided wide"><Back onClick={onBack}>Client intake</Back><PageHead eyebrow="Research · Canvas v0" side={<div className="research-progress"><span><Icon name="check" size={13} />Website read</span><span><Icon name={openAIUsed ? "check" : "info"} size={13} />{openAIUsed ? "Web search" : "Local research"}</span><span><Icon name="check" size={13} />Canvas drafted</span><span><Icon name="check" size={13} />Gaps found</span></div>} title="Here’s what we understand so far.">This first pass separates public evidence from interpretation. The gaps—not a generic script—guide the call with {company}.</PageHead>
    <div className="tabs">{(["canvas", "flow", "questions"] as const).map((item) => <button aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)} role="tab" type="button">{item === "canvas" ? "Business model" : item === "flow" ? "Flow of work" : "Call questions"}</button>)}</div>
    {tab === "canvas" ? <><div className="legend"><Pill tone="known">Client stated</Pill><span>the client’s own words</span><Pill tone="inferred">Public research</Pill><span>source-linked, not client-verified</span><Pill tone="assumed">Advisor note</Pill><span>hypothesis</span><Pill tone="missing">Missing</Pill><span>required gap</span></div>{openAIUsed ? <div className="research-source-note"><Icon name="spark" size={17} /><span><strong>OpenAI web search used</strong>{research?.providerModel} · {research?.sourceCount ?? 0} public source(s) retained</span></div> : research?.providerStatus === "failed" ? <div className="research-source-note warning"><Icon name="info" size={17} /><span><strong>Web search was unavailable</strong>Deterministic website research was retained; no claims were invented.</span></div> : null}<p className="canvas-origin"><Icon name={canvas ? "check" : "info"} size={15} />{canvas ? "Showing the canonical Canvas, including client-stated corrections captured on the call." : "No committed Canvas yet — showing first-pass public research facts only."}</p><div aria-label="Business Model Canvas" className="canvas">{canvasBlocks.map(({ title, area }) => { const blockClaims = claimsForBlock(canvas, research?.facts ?? [], title); return <article className={`canvas-block canvas-${area}`} key={area}><h3>{title}</h3><ul>{blockClaims.length ? blockClaims.map((claim) => <li className={claim.provenance === "client-stated" ? "client-stated" : ""} key={`${claim.statement}${claim.sourceUrl ?? ""}`}><span>{claim.statement}</span><Pill tone={evidenceTone[claim.provenance] ?? "neutral"}>{evidenceLabel[claim.provenance] ?? claim.provenance}</Pill></li>) : <li><span>Client confirmation needed for {title.toLowerCase()}.</span><Pill tone="missing">Missing</Pill></li>}</ul></article>; })}</div></> : null}
    {tab === "flow" ? <div className="flow-panel"><div className="legend"><p className="eyebrow">Flow to trace live</p><Pill tone="inferred">Public research</Pill><Pill tone="assumed">Advisor note</Pill><Pill tone="missing">Gap</Pill><span>no step is client-confirmed until the client traces a real case</span></div>
      {flow.length ? <ol className="value-flow">{flow.map((step) => <li key={step.id}><header><span>{step.order}</span><div><strong>{step.name}</strong><small>{step.description}</small></div><Pill tone={evidenceTone[step.evidenceStatus] ?? "neutral"}>{evidenceLabel[step.evidenceStatus] ?? step.evidenceStatus}</Pill></header>
        <dl><div><dt>Actor</dt><dd>{step.actor || "Not established"}</dd></div><div><dt>System</dt><dd>{step.system || "Not established"}</dd></div><div><dt>Input</dt><dd>{step.input || "Not established"}</dd></div><div><dt>Output</dt><dd>{step.output || "Not established"}</dd></div></dl>
        {step.confirmationQuestion ? <p className="flow-confirm"><Icon name="mic" size={15} /><span><b>Confirm live</b>{step.confirmationQuestion}</span></p> : null}
        {step.sourceUrls.length ? <p className="flow-sources">{step.sourceUrls.map((url) => <a href={url} key={url} rel="noopener noreferrer" target="_blank">{url}<Icon name="external" size={12} /></a>)}</p> : null}
      </li>)}</ol> : <p className="registry-empty">No flow has been proposed yet — run research for this engagement. No default six-step flow is substituted.</p>}
      <div className="two-columns"><article><h3>What the public source supports</h3><p>{publicSummary}</p></article><article><h3>What remains unknown</h3><p>{gaps.join(", ")}.</p></article></div></div> : null}
    {tab === "questions" ? <div className="discovery">{script.generic ? <div className="research-source-note warning"><Icon name="info" size={17} /><span><strong>Generic fallback script</strong>Research produced no client-specific discovery questions. These four prompts are generic and assert nothing about {company}.</span></div> : null}
      {discoverySections.map((section) => { const items = script.questions.filter((item) => item.section === section); return items.length ? <section className="discovery-section" key={section}><header><p className="eyebrow">{section}</p><h3>{sectionLabels[section]}</h3></header><div className="question-list">{items.map((item, index) => <article key={item.id}><b>{String(index + 1).padStart(2, "0")}</b><div><div className="question-meta"><Pill tone={evidenceTone[item.evidenceStatus] ?? "neutral"}>{evidenceLabel[item.evidenceStatus] ?? item.evidenceStatus}</Pill>{item.required ? <Pill tone="missing">Required</Pill> : null}<Pill>{item.expectedAnswerType}</Pill>{item.canvasBlock ? <Pill tone="inferred">{item.canvasBlock}</Pill> : null}</div><h3>{item.question}</h3><p>{item.whyItMatters}</p><div className="assumption"><span>What we found publicly</span><p>{item.publicAssumption}</p></div>{item.followUps.length ? <ul className="follow-ups">{item.followUps.map((follow) => <li key={follow}>{follow}</li>)}</ul> : null}</div></article>)}</div></section> : null; })}
      {research?.constraintHypotheses?.length ? <section className="discovery-section"><header><p className="eyebrow">internal only</p><h3>Constraint hypotheses to test — never read aloud as fact</h3></header><ul className="hypothesis-list">{research.constraintHypotheses.map((item) => <li key={`${item.canvasBlock}${item.type}`}><Pill tone="assumed">{item.type} · {item.canvasBlock}</Pill><strong>{item.confirmationCondition}</strong><small>Kill this hypothesis if: {item.killCondition}</small></li>)}</ul></section> : null}</div> : null}
    <div className="page-actions"><div className="research-source-add">
      <input accept={sourceAccept} hidden onChange={(event) => { const picked = event.target.files?.[0] ?? null; if (picked) onAddSource(picked); event.target.value = ""; }} ref={sourceInputRef} type="file" />
      <Button icon="upload" onClick={() => sourceInputRef.current?.click()} variant="quiet">Add a source</Button>
      {sourceState ? <p className={`upload-state ${sourceState.tone === "error" ? "error" : sourceState.tone === "reading" ? "" : "ready"}`} role={sourceState.tone === "error" ? "alert" : "status"}><Icon name={sourceState.tone === "error" ? "info" : sourceState.tone === "reading" ? "refresh" : "check"} size={15} />{sourceState.message}</p> : null}
    </div><Button icon="arrow" onClick={onPrepare}>Prepare the client</Button></div>
    <div className="apollo"><Icon name="spark" size={15} />Apollo remains off. Paid enrichment appears only beside a named gap, with credit cost shown before approval.</div>
  </section>;
}

/**
 * THE ADVISOR-ONLY BOUNDARY.
 *
 * Everything passed in as `children` is coaching for the advisor: lines to say,
 * probes, objection answers, the glossary, the gap register. None of it is
 * client-facing and none of it is evidence.
 *
 * When `hidden` is true this renders NOTHING. Not `display: none`, not
 * `visibility: hidden`, not off-screen, not `aria-hidden` — absent from the DOM.
 * A screen share, a screenshot, a scroll, and a screen reader all see the same
 * thing: no coaching. The guided call passes `hidden={presenting}`, so the
 * moment the advisor says they are sharing their screen the whole layer is gone.
 *
 * Every piece of coaching in this file is rendered inside an <AdvisorOnly>.
 * If you add more, put it inside one — never beside one.
 */
function AdvisorOnly({ children, hidden, label = "Advisor only · the client never sees this" }: {
  children: React.ReactNode; hidden: boolean; label?: string;
}) {
  if (hidden) return null;
  return <div className="advisor-only" data-advisor-only="true">
    <p className="advisor-only-flag"><Icon name="lock" size={13} />{label}</p>
    {children}
  </div>;
}

/**
 * The inline practice marker. Used wherever a practice record appears in a list,
 * a table, or a header alongside real client records, so the two can never be
 * read as the same kind of thing at a glance.
 */
function PracticeMark({ compact = false }: { compact?: boolean }) {
  return <span className="practice-mark" title="Practice data — fictional, never send it to a client">
    <Icon name="shield" size={12} />{compact ? "Practice" : "Practice data · not a client"}
  </span>;
}

/**
 * THE DEMO MARKER.
 *
 * Rendered by the root component, outside <main>, for as long as the active
 * engagement is the practice one. It is sticky, it has no dismiss control, and
 * no screen can opt out of it — including the two client-facing screens, where
 * the risk is not that the client sees it but that the ADVISOR forgets.
 *
 * The controls on it are safety controls, not coaching, which is why they stay
 * visible everywhere the bar does.
 */
function PracticeBar({ busy, onLeave, onReset }: {
  busy: "" | "open" | "reset" | "remove"; onLeave: () => void; onReset: () => void;
}) {
  return <div className="practice-bar">
    <strong><Icon name="shield" size={14} />Practice mode</strong>
    <p><b>{PRACTICE_CLIENT} is not a real company.</b> Everything on screen — the quotes, the numbers, the documents — was written as training material. Never send, quote, paste or screen-share any of it as a client’s.</p>
    <span className="practice-bar-actions">
      <button disabled={Boolean(busy)} onClick={onReset} type="button">{busy === "reset" ? "Resetting…" : "Reset practice data"}</button>
      <button disabled={Boolean(busy)} onClick={onLeave} type="button">Leave practice mode</button>
    </span>
  </div>;
}

/**
 * THE WALKTHROUGH.
 *
 * Advisor-facing guidance, and therefore gated exactly like the coaching layer:
 * it returns null on a client-facing screen — absent from the DOM, not styled
 * out of view — and everything it does render lives inside <AdvisorOnly>.
 *
 * It never rebuilds a screen. It docks beside the real one and explains it.
 */
function PracticeTour(props: {
  busy: "" | "open" | "reset" | "remove"; hidden: boolean; index: number; mode: TourMode; onScreen: boolean;
  onExplore: () => void; onFinish: () => void; onJump: (index: number) => void; onLeave: () => void;
  onNext: () => void; onPrevious: () => void; onRemove: () => void; onReset: () => void;
  onRestart: () => void; onResume: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  if (props.hidden || props.mode === "off") return null;
  const total = practiceTour.length;
  const index = Math.min(Math.max(props.index, 0), total - 1);
  const stop = practiceTour[index];
  const last = index === total - 1;

  if (props.mode === "exploring") return <div className="tour-dock collapsed">
    <AdvisorOnly hidden={false} label="Advisor only · practice walkthrough">
      <button className="tour-rejoin" onClick={props.onResume} type="button">
        <Icon name="refresh" size={16} />
        <span><strong>Back to the walkthrough</strong><small>Step {index + 1} of {total} · {stop.title}</small></span>
      </button>
    </AdvisorOnly>
  </div>;

  if (props.mode === "done") return <div className="tour-dock">
    <AdvisorOnly hidden={false} label="Advisor only · practice walkthrough, never shown to a client">
      <div className="tour-panel">
        <header><div><p className="eyebrow">Practice walkthrough · complete</p><h2>That is the whole arc.</h2></div></header>
        <p className="tour-lead">You have now seen every screen you will use with a real client: what you can learn before you speak to them, how the call is driven, where the two approvals sit, what gets written, and how the result is measured. None of it needed an API key, and nothing left this app without a second, deliberate press.</p>
        <p className="tour-lead">The thing worth carrying out of here is the shape, not the detail. One constraint. One smallest change. One number, taken from the client’s own record. One person’s name against it. If your first real call gets you a traced flow, a step everything waits at, and a name — the call worked.</p>
        <p className="tour-note"><Icon name="info" size={15} />{PRACTICE_CLIENT} stays here for as long as you want it. Reset it and walk it again, leave it and start a real engagement, or delete it entirely — it can always be rebuilt exactly as it was.</p>
        <div className="tour-actions">
          <Button icon="refresh" onClick={props.onRestart} variant="secondary">Walk it again</Button>
          <Button disabled={Boolean(props.busy)} onClick={props.onReset} variant="secondary">{props.busy === "reset" ? "Resetting…" : "Reset practice data"}</Button>
          <Button icon="arrow" onClick={props.onLeave}>Leave practice mode</Button>
        </div>
        <button className="tour-remove" disabled={Boolean(props.busy)} onClick={props.onRemove} type="button">{props.busy === "remove" ? "Deleting…" : "Delete the practice engagement"}</button>
      </div>
    </AdvisorOnly>
  </div>;

  return <div className="tour-dock">
    <AdvisorOnly hidden={false} label="Advisor only · practice walkthrough, never shown to a client">
      <div className="tour-panel">
        <header>
          <div><p className="eyebrow">{stop.stage}</p><h2>{stop.title}</h2></div>
          <button aria-expanded={listOpen} className="tour-count" onClick={() => setListOpen(!listOpen)} type="button">Step {index + 1} of {total}<Icon name="chevron" size={13} /></button>
        </header>
        <div className="tour-progress"><i style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        {listOpen ? <ol className="tour-list">{practiceTour.map((item, position) => <li key={item.id}>
          <button aria-current={position === index ? "step" : undefined} className={position === index ? "active" : position < index ? "done" : ""} onClick={() => { setListOpen(false); props.onJump(position); }} type="button">
            <b>{position + 1}</b><span><strong>{item.title}</strong><small>{item.stage}</small></span>
          </button>
        </li>)}</ol> : null}
        {!props.onScreen ? <p className="tour-note" role="status"><Icon name="info" size={15} />You have moved off this step. <button className="call-link" onClick={() => props.onJump(index)} type="button">Take me back to step {index + 1}</button>, or carry on looking around — the walkthrough will wait.</p> : null}
        <div className="tour-body">
          <section><p className="eyebrow">What you are looking at</p><p>{stop.looking}</p></section>
          <section><p className="eyebrow">With a real client</p><p>{stop.real}</p></section>
          <section><p className="eyebrow">Worth a look</p><ul>{stop.watch.map((line) => <li key={line}>{line}</li>)}</ul></section>
        </div>
        <div className="tour-actions">
          <Button disabled={index === 0} onClick={props.onPrevious} variant="secondary"><Icon name="back" size={16} />Previous</Button>
          <Button icon={last ? "check" : "arrow"} onClick={last ? props.onFinish : props.onNext}>{last ? "Finish the walkthrough" : "Next"}</Button>
        </div>
        <footer className="tour-foot">
          <button onClick={props.onExplore} type="button"><Icon name="search" size={13} />Explore on my own</button>
          <small>You can wander anywhere. This panel keeps your place and waits for you.</small>
        </footer>
      </div>
    </AdvisorOnly>
  </div>;
}

/** Speakable lines. Tapping one ticks it off so the advisor can see what they already used. */
function CoachLines({ lines, onUse, used }: { lines: string[]; used: Record<string, boolean>; onUse: (line: string) => void }) {
  return <ul className="coach-lines">{lines.map((line) =>
    <li key={line}><button aria-pressed={Boolean(used[line])} className={used[line] ? "used" : ""} onClick={() => onUse(line)} type="button">
      <Icon name={used[line] ? "check" : "arrow"} size={14} /><span>{line}</span>
    </button></li>)}
  </ul>;
}

/** Tap-to-reveal vocabulary. `rail` is the in-call version; `page` is the study-it-beforehand version. */
function GlossaryPanel({ variant }: { variant: "rail" | "page" }) {
  const [open, setOpen] = useState("");
  return <div className={`glossary ${variant}`}>
    <p className="coach-lead">{variant === "page"
      ? "Tap a word for the plain-English version and the exact line you can say if a client asks. Five minutes here before the call is worth it."
      : "One tap, no scrolling away. The second line is what to say out loud."}</p>
    <ul>{glossaryTerms.map((item) => {
      const isOpen = open === item.term;
      return <li key={item.term}>
        <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : item.term)} type="button"><span>{item.term}</span><Icon name="chevron" size={14} /></button>
        {isOpen ? <div className="glossary-body"><p>{item.plain}</p><p className="coach-say"><span>Say it like this</span>“{item.say}”</p></div> : null}
      </li>;
    })}</ul>
  </div>;
}

/** The pre-call briefing. Read once, feel ready. Advisor guidance — it is not in the client brief. */
function CallBriefing() {
  return <details className="briefing" open>
    <summary><span className="briefing-mark"><Icon name="people" size={19} /></span><span><strong>How this call goes</strong><small>The arc of the hour, the three things you must leave with, and what to do if you get lost.</small></span><Icon name="chevron" size={15} /></summary>
    <div className="briefing-body">
      <section><p className="eyebrow">The arc of the hour</p>
        <ol className="briefing-arc">{callArc.map(([when, title, detail]) => <li key={title}><b>{when}</b><div><strong>{title}</strong><span>{detail}</span></div></li>)}</ol>
      </section>
      <section><p className="eyebrow">Leave with these three things</p>
        <div className="briefing-musts">{mustLeaveWith.map(([title, detail], index) => <article key={title}><b>{index + 1}</b><strong>{title}</strong><p>{detail}</p></article>)}</div>
        <p className="briefing-note"><Icon name="check" size={15} />Get all three and the call worked. Everything else is a bonus, and the transcript will catch what you missed.</p>
      </section>
      <section><p className="eyebrow">If you get lost</p>
        <ul className="briefing-lost">{ifYouGetLost.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <p className="briefing-note"><Icon name="shield" size={15} />You are not expected to have the answer on the call. Your job is to get the flow, the waiting, and a name. The diagnosis happens afterwards with the transcript in front of you.</p>
    </div>
  </details>;
}

/**
 * The in-call coaching rail. Always mounted beside the question while the advisor
 * is not presenting, so switching panels swaps content inside a fixed column and
 * never reflows the question the client is reading.
 */
function CoachRail(props: {
  question: DiscoveryQuestion; answer: string; flagged: GapFlag | undefined; gaps: GapFlag[];
  gapSave: "idle" | "saving" | "saved" | "error"; gapError: string; onHide: () => void;
  onFlag: (input: { owner: string; lookIn: string }) => void; onUnflag: () => void; onSaveGaps: () => void;
}) {
  // Keyed on the question id by the caller, so ticked lines and half-typed gap leads
  // never survive into the next question. Only the unknown jump is adjusted in render.
  const unknown = props.answer === UNKNOWN_ANSWER;
  const [tab, setTab] = useState<CoachTab>(unknown ? "unknown" : "followups");
  const [sawUnknown, setSawUnknown] = useState(unknown);
  const [used, setUsed] = useState<Record<string, boolean>>({});
  const [owner, setOwner] = useState("");
  const [lookIn, setLookIn] = useState("");
  if (unknown !== sawUnknown) {
    setSawUnknown(unknown);
    if (unknown) setTab("unknown");
  }
  const use = (line: string) => setUsed((all) => ({ ...all, [line]: !all[line] }));
  const research = props.question.followUps.filter((line) => line.trim());
  const derived = probesByAnswerType[props.question.expectedAnswerType] ?? probesByAnswerType.narrative;
  const unflagged = unknown && !props.flagged;
  return <aside aria-label="Advisor coaching" className="coach-rail">
    <nav aria-label="Coaching topics" className="coach-tabs" role="tablist">{coachTabs.map((item) =>
      <button aria-selected={tab === item.id} className={`${tab === item.id ? "active" : ""}${item.id === "unknown" && unflagged ? " alert" : ""}`} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button"><Icon name={item.icon} size={14} />{item.label}</button>)}
    </nav>
    <div className="coach-body">
      {tab === "followups" ? <div className="coach-panel">
        <p className="coach-lead">They have answered. Do not move on yet — one of these turns a sentence into the actual story.</p>
        {research.length ? <><p className="coach-group">Written for this client</p><CoachLines lines={research} onUse={use} used={used} /></> : null}
        <p className="coach-group">{research.length ? "If the answer is still vague" : `No research follow-ups for this one · ${props.question.expectedAnswerType} answer expected`}</p>
        <CoachLines lines={derived} onUse={use} used={used} />
        <p className="coach-group">Works on any answer</p>
        <CoachLines lines={universalProbes} onUse={use} used={used} />
      </div> : null}
      {tab === "unknown" ? <div className="coach-panel">
        <p className="coach-lead">“I don’t know”, “it depends”, “I’d have to check” — that is information. Do not let it pass as an answer.</p>
        <CoachLines lines={unknownProbes} onUse={use} used={used} />
        <div className={`gap-flag${props.flagged ? " done" : ""}`}>
          {props.flagged ? <>
            <Pill tone="missing">Flagged as a gap to chase</Pill>
            <p>{props.flagged.owner ? `Who would know: ${props.flagged.owner}. ` : ""}{props.flagged.lookIn ? `Where to look: ${props.flagged.lookIn}.` : ""}{!props.flagged.owner && !props.flagged.lookIn ? "No lead recorded yet — worth going back for one before the call ends." : ""}</p>
            <button className="call-link" onClick={props.onUnflag} type="button">Remove this flag</button>
          </> : <>
            <p className="coach-group">Turn it into something you can chase</p>
            <label><span>Who would know?</span><input onChange={(event) => setOwner(event.target.value)} placeholder="Dave in the workshop" value={owner} /></label>
            <label><span>Where would we look?</span><input onChange={(event) => setLookIn(event.target.value)} placeholder="The job board, or March invoices" value={lookIn} /></label>
            <Button icon="plus" onClick={() => props.onFlag({ lookIn: lookIn.trim(), owner: owner.trim() })} variant="secondary">Flag this as a gap</Button>
          </>}
        </div>
        {unflagged ? <p className="coach-warn" role="status"><Icon name="info" size={15} />You marked this “we don’t know yet”. Flag it before you move on, or it goes nowhere.</p> : null}
        <div className="gap-register">
          <p className="coach-group">Gaps to chase · {props.gaps.length}</p>
          {props.gaps.length ? <ul>{props.gaps.map((gap) => <li key={gap.questionId}><b>{gap.section}</b><span>{gap.question}</span></li>)}</ul> : <p className="coach-empty">Nothing flagged yet.</p>}
          <Button disabled={!props.gaps.length || props.gapSave === "saving"} icon="upload" onClick={props.onSaveGaps} variant="secondary">{props.gapSave === "saving" ? "Saving…" : "Save to the engagement record"}</Button>
          {props.gapSave === "saved" ? <p className="coach-ok"><Icon name="check" size={14} />Written to the engagement notes as advisor gaps. They are not evidence and never become a client quote.</p> : null}
          {props.gapSave === "error" ? <p className="coach-warn" role="alert"><Icon name="info" size={14} />{props.gapError}</p> : null}
        </div>
      </div> : null}
      {tab === "steer" ? <div className="coach-panel">
        <p className="coach-lead">They have gone somewhere else. Let them finish the sentence, then use one of these.</p>
        <CoachLines lines={steerLines(props.question.section)} onUse={use} used={used} />
        <p className="coach-note"><Icon name="info" size={14} />A tangent is often the real problem wearing a disguise. Put it in your notes before you steer — do not just drop it.</p>
      </div> : null}
      {tab === "objections" ? <div className="coach-panel">
        <p className="coach-lead">Say these as written. They are short on purpose — a long answer sounds defensive.</p>
        <div className="objection-list">
          <article className="tied"><b>“Why does that matter?”</b><p>“Fair question. {props.question.whyItMatters}”</p><small>Built from this question’s own reason, so the answer is specific instead of a platitude.</small></article>
          {objectionScripts.map(([trigger, reply]) => <article key={trigger}><b>“{trigger}”</b><p>“{reply}”</p></article>)}
        </div>
      </div> : null}
      {tab === "glossary" ? <div className="coach-panel"><GlossaryPanel variant="rail" /></div> : null}
    </div>
    <footer className="coach-foot">
      <button onClick={props.onHide} type="button"><Icon name="lock" size={13} />Hide all of this (Esc)</button>
      <small>Coaching only. Nothing here is recorded as something the client said.</small>
    </footer>
  </aside>;
}

function Prepare({ briefSent, call1At, call2At, contact, email, onBack, onCall, onSaveSchedule, onSend, savedAt, scheduleBusy, scheduleError }: {
  briefSent: boolean; call1At: string | null; call2At: string | null; contact: string; email: string;
  onBack: () => void; onCall: () => void; onSend: () => void; savedAt: string; scheduleBusy: boolean; scheduleError: string;
  onSaveSchedule: (fields: { call1At?: string | null; call2At?: string | null }) => void;
}) {
  const [call1, setCall1] = useState(toLocalInput(call1At));
  const [call2, setCall2] = useState(toLocalInput(call2At));
  const dirty = call1 !== toLocalInput(call1At) || call2 !== toLocalInput(call2At);
  return <section className="guided document-page"><Back onClick={onBack}>Research review</Back><PageHead eyebrow="Prepare · Client-facing brief" side={<Pill tone={briefSent ? "success" : "assumed"}>{briefSent ? "Send intent recorded" : "Draft · no send intent"}</Pill>} title="Put the right facts within reach.">Review exactly what the client will see. Internal research, questions, and constraint hypotheses stay private.</PageHead>
    {/* Advisor preparation. Never part of the client brief and never sent — see AdvisorOnly. */}
    <AdvisorOnly hidden={false} label="Advisor only · not in the client brief, not sent to anyone">
      <CallBriefing />
      <details className="briefing glossary-study"><summary><span className="briefing-mark"><Icon name="document" size={19} /></span><span><strong>Plain English for the words we use</strong><small>Constraint, throughput, cycle time, baseline and the rest — with the line to say if a client asks.</small></span><Icon name="chevron" size={15} /></summary>
        <div className="briefing-body"><GlossaryPanel variant="page" /></div>
      </details>
    </AdvisorOnly>
    <div className="schedule-panel">
      <div><p className="eyebrow">Meeting times</p><strong>{formatMeeting(call1At)}</strong><small>Discovery call · {call2At ? `Findings Call ${formatMeeting(call2At)}` : "Findings Call not scheduled yet"}</small></div>
      <label><span>Discovery call (call 1)</span><input onChange={(event) => setCall1(event.target.value)} type="datetime-local" value={call1} /></label>
      <label><span>Findings Call (call 2)</span><input onChange={(event) => setCall2(event.target.value)} type="datetime-local" value={call2} /></label>
      <Button disabled={scheduleBusy || !dirty} icon="calendar" onClick={() => onSaveSchedule({ call1At: fromLocalInput(call1), call2At: fromLocalInput(call2) })} variant="secondary">{scheduleBusy ? "Saving…" : "Save meeting times"}</Button>
      {scheduleError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{scheduleError}</p> : null}
      {!scheduleError && savedAt && !dirty ? <p className="upload-state ready" role="status"><Icon name="check" size={15} />Saved to the engagement record at {savedAt}. It travels with the CRM write-back.</p> : null}
      {!scheduleError && !savedAt ? <p className="schedule-note"><Icon name="info" size={15} />Times are stored on the engagement, shown on the call screens, and carried into the CRM write-back. Nothing is added to a calendar.</p> : null}
    </div>
    <div className="document-layout"><aside><div><span>Recipient</span><strong>{contact}</strong></div><div><span>Email</span><strong>{email.trim() || "Not captured — the brief cannot be sent"}</strong></div><div><span>Scheduled</span><strong>{formatMeeting(call1At)}</strong></div><div><span>Delivery</span><strong>Email</strong></div><div><span>Duration</span><strong>60 minutes</strong></div><p><Icon name="lock" size={17} />Canvas v0, internal questions, bottleneck hypotheses, and suspected findings are excluded.</p></aside>
      <article className="document-preview"><header><span><Icon name="shield" size={16} />Tier 4 Audit</span><small>Pre-Call Readiness Brief</small></header><p className="document-kicker">For {contact} and the operating team{call1At ? ` · ${formatMeeting(call1At)}` : ""}</p><h2>Let’s understand how the business actually works.</h2>
        <section><h3>What this session is</h3><p>We’ll walk through a map of your business drafted from public information. You correct it. Expect specific questions about how work actually flows.</p></section>
        <section><h3>Who should attend</h3><p>The owner or decision-maker, plus the person who can speak to the daily operation of the main workflow. If one person prices, estimates, schedules, or approves everything, we’d love them in the room or available.</p></section>
        <section><h3>Have these within reach</h3><ul><li>Monthly volumes such as bids, orders, invoices, or leads</li><li>Typical end-to-end turnaround time</li><li>What is currently waiting in queue</li><li>Anything declined, missed, or turned away last quarter</li><li>Rough cost or revenue figures you would stand behind</li></ul><blockquote>Approximate is fine. No reports, no spreadsheets—we just don’t want you hunting for numbers live.</blockquote></section>
        <section><h3>Recording disclosure</h3><p>With your permission, we’ll record and transcribe the session so we quote you accurately rather than paraphrasing you.</p></section>
      </article></div>
    <div className="page-actions"><p><Icon name="info" size={16} />This records an approved send intent. It does not send email.</p>{briefSent ? <Button icon="arrow" onClick={onCall}>Enter client call</Button> : <Button icon="mail" onClick={onSend}>Approve send intent</Button>}</div>
  </section>;
}

/**
 * The guided call. Two modes, one switch.
 *
 * `presenting === false` — the advisor is looking at this alone. The coaching
 * rail is mounted beside the question.
 * `presenting === true` — the advisor has said they are sharing their screen.
 * Every <AdvisorOnly> in here returns null, the question takes the full width,
 * and the screen is exactly the client-facing view it has always been.
 *
 * Escape is the panic key: it turns presenting on immediately, from anywhere in
 * the call view, so an advisor who is suddenly asked to share has one keystroke.
 */
function Call(props: {
  company: string; consent: "pending" | "recorded" | "not-recorded"; generic: boolean; index: number; total: number;
  question: DiscoveryQuestion; answer: string; notes: string; value: string; scheduledAt: string | null;
  /** The DEMO marker stays on this client-facing screen even though all coaching is stripped from it. */
  practice: boolean;
  presenting: boolean; gaps: GapFlag[]; gapSave: "idle" | "saving" | "saved" | "error"; gapError: string;
  onConsent: (v: "pending" | "recorded" | "not-recorded") => void; onAnswer: (v: string) => void; onNotes: (v: string) => void;
  onValue: (v: string) => void; onPrevious: () => void; onNext: () => void; onExit: () => void;
  onPresenting: (v: boolean) => void; onFlagGap: (input: { owner: string; lookIn: string }) => void;
  onUnflagGap: () => void; onSaveGaps: () => void;
}) {
  const question = props.question;
  const { onPresenting } = props;
  const needsValue = question.expectedAnswerType === "number" || question.expectedAnswerType === "person";
  const unknownChosen = props.answer === UNKNOWN_ANSWER;
  const flagged = props.gaps.find((gap) => gap.questionId === question.id);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onPresenting(true); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onPresenting]);
  return <section className="call-mode"><header><div><i />{props.presenting ? "Client call view" : "Advisor working view"} · {props.company}{props.practice ? <PracticeMark /> : null}{props.scheduledAt ? <span className="call-scheduled"><Icon name="calendar" size={14} />{formatMeeting(props.scheduledAt)}</span> : null}</div>
    <div className="call-head-actions"><button aria-pressed={props.presenting} className={`share-toggle${props.presenting ? " on" : ""}`} onClick={() => props.onPresenting(!props.presenting)} type="button"><Icon name={props.presenting ? "people" : "lock"} size={14} />{props.presenting ? "Screen shared · coaching hidden" : "Coaching showing · tap before you share"}</button><button onClick={props.onExit} type="button">Exit call view</button></div></header>
    {props.consent === "pending" ? <div className="consent-gate"><span><Icon name="mic" size={29} /></span><p className="eyebrow">Before the conversation begins</p><h1>Confirm recording consent.</h1><blockquote>“With your permission, we’ll record and transcribe this session so we quote you accurately rather than paraphrasing you.”</blockquote><p>Do not begin transcript capture until the disclosure and applicable consent requirements are satisfied.</p><Button icon="check" onClick={() => props.onConsent("recorded")}>Consent confirmed</Button><button className="call-link" onClick={() => props.onConsent("not-recorded")} type="button">Continue without recording</button>
      <AdvisorOnly hidden={props.presenting} label="Advisor only"><p className="coach-note"><Icon name="info" size={15} />You get a coaching rail on the next screen: follow-up prompts, what to say when they don’t know, how to steer back, answers to pushback, and plain English for the jargon. Tap the bar at the top — or press Esc — before you share your screen and every word of it disappears.</p></AdvisorOnly>
    </div> :
      <div className="call-content"><div className="call-progress"><span>Conversation {props.index + 1} of {props.total}</span><div><i style={{ width: `${((props.index + 1) / props.total) * 100}%` }} /></div><span>{sectionLabels[question.section] ?? question.section}</span></div>
        <div className={`call-stage${props.presenting ? " solo" : ""}`}>
        <div className="question"><p className="call-opening">Let’s make sure we understand how your business actually works.</p>{props.generic ? <p className="call-generic"><Icon name="info" size={14} />Generic fallback question — research produced no client-specific script.</p> : null}<h1>{question.question}</h1><p className="why">{question.whyItMatters}</p><div className="call-tags"><Pill tone={evidenceTone[question.evidenceStatus] ?? "neutral"}>{evidenceLabel[question.evidenceStatus] ?? question.evidenceStatus}</Pill>{question.required ? <Pill tone="missing">Required answer</Pill> : null}{question.canvasBlock ? <Pill tone="inferred">{question.canvasBlock}</Pill> : null}</div><div className="assumption"><span>What we found publicly</span><p>{question.publicAssumption}</p></div>
          <div className="answer-buttons">{answerChoices.map((choice) => <button className={`${props.answer === choice ? "selected" : ""}${choice === UNKNOWN_ANSWER ? " unknown" : ""}`} key={choice} onClick={() => props.onAnswer(choice)} type="button">{props.answer === choice ? <Icon name={choice === UNKNOWN_ANSWER ? "info" : "check"} size={17} /> : null}{choice}</button>)}{needsValue ? <label className="answer-value"><span>{question.expectedAnswerType === "number" ? "Stated number" : "Named person"}</span><input onChange={(e) => props.onValue(e.target.value)} placeholder={question.expectedAnswerType === "number" ? "e.g. 42 bids per month" : "e.g. Maya Chen, COO"} value={props.value} /></label> : null}</div>
          {unknownChosen ? <p className="unknown-marker" role="status"><Icon name="info" size={15} />{flagged ? "Open question — we’ll chase this one down after the call. It is not recorded as an answer." : "Open question, not an answer. Nothing gets written down as known here."}</p> : null}
          <label className="call-notes"><span>Conversation notes</span><textarea onChange={(e) => props.onNotes(e.target.value)} placeholder="Capture the client’s words, numbers, corrections, and named owners…" rows={5} value={props.notes} /></label>
        </div>
        <AdvisorOnly hidden={props.presenting}>
          <CoachRail answer={props.answer} flagged={flagged} gapError={props.gapError} gaps={props.gaps} gapSave={props.gapSave} key={question.id} onFlag={props.onFlagGap} onHide={() => props.onPresenting(true)} onSaveGaps={props.onSaveGaps} onUnflag={props.onUnflagGap} question={question} />
        </AdvisorOnly>
        </div><div className="call-actions"><Button disabled={props.index === 0} onClick={props.onPrevious} variant="secondary"><Icon name="back" size={16} />Back</Button><Button icon="arrow" onClick={props.onNext}>{props.index === props.total - 1 ? "Finish guided call" : "Next question"}</Button></div><div className={`consent-status ${props.consent}`}><Icon name={props.consent === "recorded" ? "mic" : "shield"} size={14} />{props.consent === "recorded" ? "Recording consent confirmed" : "Continuing without recording"}</div>
      </div>}
  </section>;
}

function Transcript(props: {
  callNumber: 1 | 2; company: string; scheduledAt: string | null; method: "fireflies" | "paste" | "upload"; text: string; fileName: string;
  fileError: string; fileReading: boolean; fileSummary: string; ready: boolean; busy: boolean;
  speakers: string[]; speakerRoles: Record<string, "client" | "advisor" | "unknown">; speakerNote: string;
  onBack: () => void; onMethod: (v: "fireflies" | "paste" | "upload") => void;
  onText: (v: string) => void; onFile: (file: File | null) => void; onAnalyze: () => void;
  onSpeakerRole: (speaker: string, role: "client" | "advisor" | "unknown") => void;
}) {
  const speakerOptions: Array<["client" | "advisor" | "unknown", string]> = [["client", "Client"], ["advisor", "Advisor"], ["unknown", "Other / skip"]];
  return <section className="guided narrow"><Back onClick={props.onBack}>Guided call</Back><PageHead eyebrow="Call · Transcript evidence" title="Let’s turn the conversation into evidence.">Use the full transcript—not only a generated summary—so every correction and finding can point back to the client’s words.</PageHead>
    <div className="meeting-anchor"><div><span>Client</span><strong>{props.company}</strong></div><div><span>Call {props.callNumber} scheduled</span><strong>{formatMeeting(props.scheduledAt)}</strong></div></div>
    <div className="method-cards">{[["fireflies", "mic", "Import from Fireflies", "Choose a connected meeting"], ["paste", "document", "Paste transcript text", "Keep the original wording"], ["upload", "upload", "Upload a transcript", "TXT, VTT, SRT, or DOCX"]].map(([method, icon, title, sub]) => <button className={props.method === method ? "selected" : ""} key={method} onClick={() => props.onMethod(method as typeof props.method)} type="button"><span><Icon name={icon as IconName} size={19} /></span><strong>{title}</strong><small>{sub}</small></button>)}</div>
    <div className="method-panel">{props.method === "fireflies" ? <div className="connector-empty"><Icon name="mic" size={24} /><div><strong>Fireflies transcript ID</strong><p>Enter a processed meeting ID after connecting Fireflies, or paste/upload now.</p><input onChange={(event) => props.onText(event.target.value)} placeholder="Transcript ID" value={props.text} /></div><Button onClick={() => props.onMethod("paste")} variant="secondary">Paste instead</Button></div> : null}
      {props.method === "paste" ? <label><span>Full transcript</span><textarea onChange={(e) => props.onText(e.target.value)} placeholder="[00:00] Speaker: …" rows={12} value={props.text} /></label> : null}
      {props.method === "upload" ? <><label className="upload large"><input accept=".txt,.vtt,.srt,.json,.doc,.docx" onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} type="file" /><span><Icon name="upload" size={23} /></span><span><strong>{props.fileName || "Choose transcript file"}</strong><small>{props.fileReading ? "Reading the file…" : props.fileSummary || "TXT, VTT, SRT, or JSON is read as text; DOCX is uploaded for server-side extraction. 2 MB limit."}</small></span></label>
        {props.fileReading ? <p className="upload-state" role="status"><Icon name="refresh" size={15} />Reading {props.fileName}…</p> : null}
        {props.fileError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{props.fileError}</p> : null}
        {props.ready && !props.fileReading && !props.fileError ? <p className="upload-state ready"><Icon name="check" size={15} />{props.fileName} is parsed and ready to upload. The file content itself is sent — not just its name.</p> : null}</> : null}
    </div>
    {props.speakers.length || props.speakerNote ? <div className="speaker-roles">
      <div className="speaker-roles-head"><p className="eyebrow">Who is who?</p><small>Only speakers you tag <strong>Client</strong> become evidence. Your own lines never do, however quotable — and an untagged speaker is treated as a gap, not the client.</small></div>
      {props.speakers.length ? <ul>{props.speakers.map((speaker) => {
        const role = props.speakerRoles[speaker] ?? "unknown";
        return <li key={speaker}><strong>{speaker}</strong><div className="status-toggle">{speakerOptions.map(([value, label]) =>
          <button className={role === value ? "selected" : ""} key={value} onClick={() => props.onSpeakerRole(speaker, value)} type="button">{label}</button>)}</div></li>;
      })}</ul> : <p className="upload-state" role="status"><Icon name="info" size={15} />{props.speakerNote}</p>}
    </div> : null}
    <div className="action-row"><p><Icon name="spark" size={17} />We’ll compare this with original research, surface contradictions, and keep gaps explicit.</p><Button disabled={props.busy || (props.method === "paste" && !props.text.trim()) || (props.method === "upload" && (!props.ready || props.fileReading))} icon="arrow" onClick={props.onAnalyze}>{props.busy ? "Analyzing…" : "Analyze transcript"}</Button></div>
  </section>;
}

/** Says plainly which reading is on screen. An advisor must never think a deterministic pass was a model analysis. */
function SynthesisMode({ synthesis }: { synthesis: TranscriptSynthesis | null }) {
  if (!synthesis) return null;
  if (synthesis.analysisMode === "model-assisted" && synthesis.modelStatus === "used") return <div className="research-source-note"><Icon name="spark" size={17} /><span><strong>Model-assisted synthesis</strong>{synthesis.providerModel || "provider model not named"} · every claim still had to match a client quote to survive the evidence check.</span></div>;
  return <div className="research-source-note warning"><Icon name="info" size={17} /><span><strong>{synthesis.modelStatus === "failed" ? "The model call failed" : synthesis.modelStatus === "not-configured" ? "No model is configured" : "Deterministic synthesis"}</strong>What is on screen is the deterministic reading of the transcript. It is not a deeper analysis.</span></div>;
}

/** The model's reading of the call. Advisor-note provenance — it is never something the client said. */
function Narrative({ synthesis }: { synthesis: TranscriptSynthesis | null }) {
  if (!synthesis?.narrative) return null;
  return <div className="narrative-block"><header><Pill tone="assumed">Advisor note · model interpretation</Pill><span>Not client evidence</span></header>
    <p className="narrative-warning"><Icon name="info" size={15} />This is the model reading the call, not the client speaking. Nobody said it. It carries advisor-note provenance and must never be quoted back to the client as their own words.</p>
    <p>{synthesis.narrative}</p>
  </div>;
}

/** Model output that could not be tied to a client quote. Kept visible: a silent drop is worse than a shown rejection. */
function GroundingRejections({ synthesis }: { synthesis: TranscriptSynthesis | null }) {
  const rejections = synthesis?.groundingRejections ?? [];
  if (!rejections.length) return null;
  return <details className="rejections"><summary>Discarded by evidence check · {rejections.length} claim{rejections.length === 1 ? "" : "s"}</summary>
    <p>Each item below was proposed but could not be tied to a real client quote, so it was thrown away instead of shown as a finding. Nothing here is evidence.</p>
    <ul>{rejections.map((item) => <li key={`${item.kind}${item.reason}${item.text}`}><div><Pill tone="missing">{item.kind}</Pill><span>{item.reason}</span></div><blockquote>“{item.text}”</blockquote></li>)}</ul>
  </details>;
}

function Synthesis({ busy, onApprove, onBack, synthesis }: { busy: boolean; onApprove: () => void; onBack: () => void; synthesis: TranscriptSynthesis | null }) {
  const candidate = synthesis?.constraintCandidate;
  const quotes = synthesis?.quotes ?? [];
  const gaps = synthesis?.gaps ?? [];
  return <section className="guided wide"><Back onClick={onBack}>Transcript</Back><PageHead eyebrow="Synthesize · Checkpoint 1" side={<Pill tone="assumed">Advisor review required</Pill>} title="Here’s what the transcript supports.">Only client-attributed lines appear as evidence. Advisor and unknown-speaker lines remain notes or gaps.</PageHead>
    <SynthesisMode synthesis={synthesis} />
    <div className="synthesis-stats">{[["Client evidence", String(quotes.length), "Source-linked transcript lines", "known"], ["Baseline", synthesis?.baselineStatus ?? "Missing", "No benchmark is substituted", synthesis?.baselineStatus === "Confirmed" ? "known" : "missing"], ["Open gaps", String(gaps.length), "Named collection actions", gaps.length ? "missing" : "neutral"], ["Constraint", candidate ? "1" : "0", candidate ? "Provisional candidate" : "No signal detected", candidate ? "assumed" : "neutral"]].map(([label, count, text, tone]) => <article key={label}><Pill tone={tone as Tone}>{label}</Pill><strong>{count}</strong><span>{text}</span></article>)}</div>
    <div className="table-wrap"><table className="diff"><thead><tr><th>Speaker</th><th>Timestamp</th><th>Client evidence</th><th>Provenance</th><th>Why it matters</th></tr></thead><tbody>{quotes.length ? quotes.map((quote) => <tr key={`${quote.speaker}${quote.timestamp}${quote.text}`}><td><strong>{quote.speaker}</strong></td><td>{quote.timestamp}</td><td><blockquote>“{quote.text}”</blockquote></td><td><Pill tone="known">{quote.provenance}</Pill></td><td>{quote.reason || "Retained for advisor review."}</td></tr>) : <tr><td colSpan={5}>No client-attributed constraint evidence was detected. Review speaker roles or collect another source.</td></tr>}</tbody></table></div>
    <Narrative synthesis={synthesis} />
    <GroundingRejections synthesis={synthesis} />
    <div className="candidate"><div><p className="eyebrow">Leading constraint candidate · {candidate?.findingStatus ?? "none"}</p><h2>{candidate ? `${candidate.constraintType} in ${candidate.canvasBlock}` : "No constraint candidate yet."}</h2><p>{candidate ? candidate.prescription.description : "The system will not invent a finding from a zero-signal transcript."}</p></div><dl><div><dt>Evidence lines</dt><dd>{candidate?.evidence.length ?? 0}</dd></div><div><dt>Baseline</dt><dd>{synthesis?.baselineStatus ?? "Missing"}</dd></div><div><dt>Open gaps</dt><dd>{gaps.length ? gaps.join("; ") : "None detected"}</dd></div></dl></div>
    <div className="page-actions"><p><Icon name="lock" size={16} />Approval commits the reviewed Canvas and evidence diff. It does not approve the diagnosis.</p><Button disabled={!synthesis || busy} icon="check" onClick={onApprove}>{busy ? "Approving…" : "Approve Canvas commit"}</Button></div>
  </section>;
}

function Findings({ agendaBusy, agendaError, busy, consent, contact, contactBusy, contactError, contactRole, onApprove, onBack, onConsent, onPresent, onSaveContact, owner, scheduledAt, synthesis }: {
  agendaBusy: boolean; agendaError: string; busy: boolean; consent: "pending" | "recorded" | "not-recorded"; onApprove: () => void; onBack: () => void;
  onConsent: (value: "pending" | "recorded" | "not-recorded") => void; onPresent: () => void; owner: string;
  contact: string; contactRole: string; contactBusy: boolean; contactError: string; onSaveContact: (contact: string, role: string) => void;
  scheduledAt: string | null; synthesis: TranscriptSynthesis | null;
}) {
  const [step, setStep] = useState(0);
  const [ownerName, setOwnerName] = useState(contact);
  const [ownerRole, setOwnerRole] = useState(contactRole);
  // Keep the editor in step with the record after a successful save (the props change then).
  const [ownerReq, setOwnerReq] = useState(`${contact}\u0000${contactRole}`);
  if (`${contact}\u0000${contactRole}` !== ownerReq) {
    setOwnerReq(`${contact}\u0000${contactRole}`);
    setOwnerName(contact); setOwnerRole(contactRole);
  }
  const ownerUnchanged = ownerName.trim() === contact.trim() && ownerRole.trim() === contactRole.trim();
  const candidate = synthesis?.constraintCandidate;
  const baseline = synthesis?.baselineStatus ?? "Missing";
  const steps = [["Reconcile the Canvas", "Confirm corrections, role ownership, and the actual flow."], ["Resolve the baseline", `${baseline} baseline. Confirm its source or assign instrumentation to the named owner.`], ["Test the constraint", candidate ? `Confirm or kill the ${candidate.constraintType} candidate in ${candidate.canvasBlock}.` : "No constraint signal was detected; collect stronger evidence before approval."], ["Reveal the prescription", "Constraint → prescription → metric formula → named owner."]];
  if (consent === "pending") return <section className="guided narrow"><Back onClick={onBack}>Synthesis review</Back><div className="consent-gate"><span><Icon name="mic" size={29} /></span><p className="eyebrow">Findings Call · before the conversation{scheduledAt ? ` · ${formatMeeting(scheduledAt)}` : ""}</p><h1>Confirm recording consent again.</h1><blockquote>“With your permission, we’ll record and transcribe this session so we quote you accurately rather than paraphrasing you.”</blockquote><p>Consent is recorded separately for Call 2.</p><Button icon="check" onClick={() => onConsent("recorded")}>Consent confirmed</Button><button className="call-link" onClick={() => onConsent("not-recorded")} type="button">Continue without recording</button></div></section>;
  return <section className="guided findings"><Back onClick={onBack}>Synthesis review</Back><PageHead eyebrow={`Synthesize · Findings Call${scheduledAt ? ` · ${formatMeeting(scheduledAt)}` : ""}`} title="Reconcile first. Reveal second.">The diagnosis stays provisional while the required baseline is missing. The call can continue, but numeric claims cannot.</PageHead>
    <SynthesisMode synthesis={synthesis} />
    <div className="present-cta"><span className="present-mark"><Icon name="people" size={21} /></span>
      <div><strong>Share your screen and walk them through it.</strong><p>Opens the client-facing Findings Call view: what we heard, the constraint, their own words, what we propose, what it would take, what we’d measure. One section per screen, with nothing internal on show.</p></div>
      <Button disabled={agendaBusy || !candidate} icon="arrow" onClick={onPresent}>{agendaBusy ? "Building the agenda…" : "Enter presentation view"}</Button>
      {!candidate ? <small>No supported constraint candidate yet, so there is nothing to present. Collect stronger evidence first.</small> : null}
      {agendaError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{agendaError}</p> : null}
    </div>
    <div className={`owner-editor${!owner ? " missing" : ""}`}>
      <div className="owner-editor-head"><p className="eyebrow">Named human owner</p><small>Diagnosis approval needs a real person and their role. Set or correct them here — it updates the engagement record before you approve.</small></div>
      <div className="owner-editor-fields">
        <label><span>Contact name</span><input onChange={(event) => setOwnerName(event.target.value)} placeholder="Dana Whitfield" value={ownerName} /></label>
        <label><span>Contact role</span><input onChange={(event) => setOwnerRole(event.target.value)} placeholder="Owner" value={ownerRole} /></label>
        <Button disabled={contactBusy || !ownerName.trim() || !ownerRole.trim() || ownerUnchanged} icon="check" onClick={() => onSaveContact(ownerName, ownerRole)} variant="secondary">{contactBusy ? "Saving…" : "Save contact"}</Button>
      </div>
      {contactError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{contactError}</p> : null}
      {!owner ? <p className="upload-state" role="status"><Icon name="info" size={15} />No named owner is on the engagement yet, so diagnosis approval stays blocked. Add the name and role above.</p> : null}
    </div>
    <div className="findings-flow"><ol>{steps.map(([title], index) => <li className={index === step ? "active" : index < step ? "done" : ""} key={title}><button onClick={() => setStep(index)} type="button"><span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span>{title}</button></li>)}</ol>
      <article><p className="eyebrow">Part {step < 2 ? "A · Reconciliation" : "B · Reveal"}</p><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p>
        {step === 1 ? <div className="baseline"><Pill tone={baseline === "Confirmed" ? "known" : "missing"}>{baseline} baseline</Pill><strong>{baseline === "Confirmed" ? "Verify the coherent metric and source." : "No benchmark will be substituted."}</strong><span>{synthesis?.gaps.join("; ") || "Assign baseline instrumentation as the first Sprint task."}</span></div> : null}
        {step === 3 ? <div className="reveal">{[["Constraint", candidate ? `${candidate.constraintType} in ${candidate.canvasBlock}` : "No supported candidate"], ["Prescription", candidate?.prescription.description || "Collect stronger evidence before prescribing"], ["Projected delta", "(ending metric − starting metric) ÷ measurement period"], ["Human owner", owner || "Named owner required"]].map(([label, text], index) => <div key={label}>{index ? <Icon name="arrow" /> : null}<section><span>{label}</span><strong>{text}</strong></section></div>)}</div> : null}
        <div className="findings-actions"><Button disabled={step === 0} onClick={() => setStep(step - 1)} variant="secondary">Back</Button>{step < 3 ? <Button icon="arrow" onClick={() => setStep(step + 1)}>Continue</Button> : null}</div>
      </article></div>
    {step === 3 ? <div className="diagnosis"><div><Pill tone="assumed">Provisional diagnosis</Pill><h2>{candidate ? `${candidate.constraintType} in ${candidate.canvasBlock}` : "No supported diagnosis yet."}</h2><p>{baseline === "Confirmed" ? "Approve only after checking the evidence and owner." : "It stays provisional until the baseline lands; Sprint 1 begins with instrumentation."}</p></div><dl><div><dt>Evidence</dt><dd>{candidate?.evidence.length ?? 0} client line(s)</dd></div><div><dt>Canvas block</dt><dd>{candidate?.canvasBlock ?? "Missing"}</dd></div><div><dt>Named owner</dt><dd>{owner || "Required"}</dd></div><div><dt>First Sprint task</dt><dd>{baseline === "Confirmed" ? "Run the intervention" : "Instrument baseline"}</dd></div></dl><Button disabled={!candidate || !owner || consent !== "recorded" || busy} icon="check" onClick={onApprove}>{busy ? "Approving…" : "Approve provisional diagnosis"}</Button></div> : null}
  </section>;
}

/**
 * The client-facing Findings Call. One section per screen, screen-share quality, and the same
 * consent gate as the guided call. Only the `evidence` quotes are presented as the client's own
 * words; the section body is our reading of the call and is never attributed to them.
 */
function FindingsPresentation({ company, consent, index, onConsent, onExit, onNext, onPrevious, practice, scheduledAt, sections }: {
  company: string; consent: "pending" | "recorded" | "not-recorded"; index: number;
  onConsent: (value: "pending" | "recorded" | "not-recorded") => void; onExit: () => void;
  onNext: () => void; onPrevious: () => void;
  /** The DEMO marker stays on this client-facing screen. Advisor guidance does not. */
  practice: boolean;
  scheduledAt: string | null; sections: FindingsAgendaSection[];
}) {
  const total = sections.length;
  const section = sections[Math.min(index, Math.max(0, total - 1))];
  return <section className="call-mode findings-present">
    <header><div><i />Findings Call · {company}{practice ? <PracticeMark /> : null}{scheduledAt ? <span className="call-scheduled"><Icon name="calendar" size={14} />{formatMeeting(scheduledAt)}</span> : null}</div><button onClick={onExit} type="button">Exit to advisor view</button></header>
    {consent === "pending" ? <div className="consent-gate"><span><Icon name="mic" size={29} /></span><p className="eyebrow">Findings Call · before the conversation</p><h1>Confirm recording consent.</h1><blockquote>“With your permission, we’ll record and transcribe this session so we quote you accurately rather than paraphrasing you.”</blockquote><p>Consent is recorded separately for this call. Do not begin transcript capture until the disclosure and applicable consent requirements are satisfied.</p><Button icon="check" onClick={() => onConsent("recorded")}>Consent confirmed</Button><button className="call-link" onClick={() => onConsent("not-recorded")} type="button">Continue without recording</button></div>
      : !section ? <div className="call-content"><div className="question"><h1>The agenda came back empty.</h1><p className="why">Nothing is shown rather than filling the screen with something the transcript does not support.</p></div><div className="call-actions"><span /><Button icon="back" onClick={onExit}>Back to advisor view</Button></div></div>
      : <div className="call-content">
        <div className="call-progress"><span>Section {Math.min(index, total - 1) + 1} of {total}</span><div><i style={{ width: `${((Math.min(index, total - 1) + 1) / total) * 100}%` }} /></div><span>{section.heading}</span></div>
        <div className="present-body">
          <h1>{section.heading}</h1>
          {section.body ? <p className="present-narrative">{section.body}</p> : null}
          {section.evidence.length ? <div className="client-words"><header><Pill tone="known"><Icon name="check" size={12} /> In your own words</Pill><span>Recorded on the call, quoted exactly — not our paraphrase</span></header>
            <ul>{section.evidence.map((item) => <li key={`${item.speaker}${item.timestamp}${item.quote}`}><blockquote>“{item.quote}”</blockquote><cite>{item.speaker || "Client"}{item.timestamp ? ` · ${item.timestamp}` : ""}</cite></li>)}</ul>
          </div> : null}
        </div>
        <div className="call-actions"><Button disabled={index === 0} onClick={onPrevious} variant="secondary"><Icon name="back" size={16} />Back</Button>{index >= total - 1 ? <Button icon="check" onClick={onExit}>Finish and return to the advisor view</Button> : <Button icon="arrow" onClick={onNext}>Next</Button>}</div>
        <div className={`consent-status ${consent}`}><Icon name={consent === "recorded" ? "mic" : "shield"} size={14} />{consent === "recorded" ? "Recording consent confirmed" : "Continuing without recording"}</div>
      </div>}
  </section>;
}

function Deliver({ approved, artifacts, busy, error, intents, onActions, onBack, onGenerate, onOperate, onPublish, onSync }: {
  approved: boolean; artifacts: ArtifactRecord[]; busy: string; error: string; intents: IntentItem[];
  onActions: () => void; onBack: () => void; onGenerate: () => void; onOperate: (screen: Screen) => void;
  onPublish: (documentId: string) => void; onSync: () => void;
}) {
  const publishIntents = intents.filter((intent) => intent.type === "document_publish");
  const intentFor = (documentId: string) => publishIntents.find((intent) =>
    (intent.payload as { documentId?: string } | null)?.documentId === documentId) ?? null;
  const queued = publishIntents.filter((intent) => intent.status === "pending_review" || intent.status === "approved").length;
  return <section className="guided wide deliver"><Back onClick={onBack}>Findings</Back><PageHead eyebrow="Deliver · Approved release" side={<Pill tone={approved ? "success" : "assumed"}>{approved ? "Release approved" : "Provisional release"}</Pill>} title="Turn the finding into usable work.">Every deliverable carries the evidence label, named owner, scope, guardrails, and measurement plan forward.</PageHead>
    <div className="deliver-banner"><div><span>Primary deliverable</span><strong>One constraint → one prescription → one metric → one named human owner</strong></div><div><span>Evidence label</span><strong>Provisional · baseline instrumentation required</strong></div></div>
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    <div className="send-explainer"><Icon name="lock" size={18} /><div><strong>Sending a document to the client is two steps, on purpose.</strong><p>“Send to client” queues a reviewed publication intent — nothing leaves this app. You then approve and send it from the Reviewed actions panel, so nothing can go out mid-call by accident.</p></div>{queued ? <Pill tone="assumed">{queued} waiting in Reviewed actions</Pill> : null}<Button onClick={onActions} variant="secondary">Reviewed actions <Icon name="lock" size={14} /></Button></div>
    <div className="deliver-grid">{deliverables.map(([title, text, kind]) => {
      const artifact = artifacts.find((item) => item.kind === kind) ?? null;
      const intent = artifact ? intentFor(artifact.id) : null;
      const publish = publishStatusCopy(intent);
      return <article key={title}><div className="deliver-card-meta"><span className="deliver-icon"><Icon name="document" size={20} /></span><Pill tone={artifact ? "success" : "neutral"}>{artifact ? "Generated" : "Not generated yet"}</Pill></div><h3>{title}</h3><p>{text}</p>
        {artifact ? <div className="deliver-publish"><div className="deliver-publish-status"><Pill tone={publish.tone}>{publish.label}</Pill><small>{publish.detail}</small></div>
          <button disabled={busy === artifact.id} onClick={() => onPublish(artifact.id)} type="button">{busy === artifact.id ? "Queueing…" : !intent ? "Send to client" : intent.status === "pending_review" || intent.status === "approved" ? "Queue another copy" : "Send again"}<Icon name="mail" size={14} /></button>
        </div> : <button disabled={Boolean(busy)} onClick={onGenerate} type="button">{busy === "suite" ? "Generating…" : "Generate suite"}<Icon name="arrow" size={14} /></button>}
      </article>;
    })}</div>
    <div className="page-actions"><p><Icon name="lock" size={16} />The CRM action creates a reviewed write-back intent. It does not change Google Sheets automatically.</p><div><Button disabled={Boolean(busy)} icon="refresh" onClick={onGenerate} variant="secondary">{busy === "suite" ? "Generating…" : artifacts.length ? "Regenerate the suite" : "Generate the suite"}</Button><Button disabled={Boolean(busy)} icon="arrow" onClick={onSync} variant="secondary">{busy === "crm" ? "Preparing…" : "Prepare CRM write-back"}</Button></div></div>
    <div className="sprint-path"><div className="sprint-path-heading"><p className="eyebrow">Implementation roadmap</p><span>After diagnosis approval</span></div>{([["1", "Activate the sprint", "Fixed scope, named owner, measurement clock started.", "sprint"], ["2", "Remove & measure", "Capture the ending metric; the server decides whether a delta is claimable.", "measure"], ["3", "Catalog write-back", "Compound the reusable evidence pattern.", "catalog"]] as Array<[string, string, string, Screen]>).map(([number, title, text, target], index) => <button className="sprint-step" key={title} onClick={() => onOperate(target)} type="button">{index ? <Icon className="sprint-arrow" name="arrow" /> : null}<span className="sprint-number">{number}</span><section><strong>{title}</strong><small>{text}</small></section><Icon name="chevron" size={15} /></button>)}</div>
  </section>;
}

function OpsRail({ current, onNavigate }: { current: Screen; onNavigate: (screen: Screen) => void }) {
  const items: Array<[Screen, string, IconName]> = [["sprint", "Sprint", "briefcase"], ["measure", "Measure", "refresh"], ["catalog", "Catalog", "folder"], ["actions", "Reviewed actions", "lock"]];
  return <nav aria-label="Operations" className="ops-rail">{items.map(([target, label, icon]) => <button aria-current={target === current ? "page" : undefined} className={target === current ? "active" : ""} key={target} onClick={() => onNavigate(target)} type="button"><Icon name={icon} size={15} />{label}</button>)}</nav>;
}

function SprintScreen({ busy, error, onActivate, onBack, onNavigate, onTask, sprint }: {
  busy: string; error: string; onActivate: () => void; onBack: () => void;
  onNavigate: (screen: Screen) => void; onTask: (taskId: string, status: SprintTask["status"]) => void; sprint: SprintRecord | null;
}) {
  const taskStatuses: Array<[SprintTask["status"], string]> = [["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]];
  const tasks = sprint?.tasks ?? [];
  return <section className="guided wide"><Back onClick={onBack}>Deliverables</Back><PageHead eyebrow="Operate · Sprint" side={<Pill tone={sprint ? "success" : "assumed"}>{sprint ? "Sprint active" : "Not activated"}</Pill>} title="Run the fixed sprint.">Activation freezes the scope, records the named human owner, and starts the measurement clock against the starting metric the server already holds. Nothing is scheduled or sent externally.</PageHead>
    <OpsRail current="sprint" onNavigate={onNavigate} />
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    {!sprint ? <div className="panel ops-empty"><h3>No sprint has been activated for this engagement.</h3><p>Activation requires an approved diagnosis with a named human owner. The starting metric is taken from the approved finding — it is never invented here.</p><Button disabled={busy === "sprint"} icon="check" onClick={onActivate}>{busy === "sprint" ? "Activating…" : "Activate sprint"}</Button></div> : <>
      <div className="ops-summary">{[["Prescription", sprint.prescription || "Not recorded"], ["Human owner", sprint.humanOwner ? `${sprint.humanOwner.name}, ${sprint.humanOwner.role}` : "Not recorded"], ["Starting metric", sprint.startingMetric ? `${sprint.startingMetric.name}: ${sprint.startingMetric.value} ${sprint.startingMetric.unit} · ${sprint.startingMetric.period}` : "Missing"], ["Measurement clock", sprint.measurementClockStartedAt ? new Date(sprint.measurementClockStartedAt).toLocaleString() : "Not started"]].map(([label, text]) => <article key={label}><span>{label}</span><strong>{text}</strong></article>)}</div>
      <div className="table-wrap"><table><thead><tr><th>Sprint task</th><th>Owner</th><th>Status</th></tr></thead><tbody>{tasks.length ? tasks.map((task) => <tr key={task.id}><td><strong>{task.task}</strong></td><td>{task.owner || "Unassigned"}</td><td><div className="status-toggle">{taskStatuses.map(([status, label]) => <button className={task.status === status ? "selected" : ""} disabled={busy === `task:${task.id}`} key={status} onClick={() => onTask(task.id, status)} type="button">{label}</button>)}</div>{busy === `task:${task.id}` ? <small role="status">Saving…</small> : null}</td></tr>) : <tr><td colSpan={3}>The activated sprint returned no tasks.</td></tr>}</tbody></table></div>
      <div className="page-actions"><p><Icon name="info" size={16} />No delta is computed in the browser. The ending metric is captured separately.</p><Button icon="arrow" onClick={() => onNavigate("measure")}>Record the outcome</Button></div>
    </>}
  </section>;
}

function Measure({ busy, correcting, error, onBack, onCorrectDirection, onNavigate, onSubmit, outcome, sprint }: {
  busy: boolean; correcting: boolean; error: string; onBack: () => void;
  onCorrectDirection: (improvedWhen: "higher" | "lower") => void; onNavigate: (screen: Screen) => void;
  onSubmit: (body: { endingMetric: Metric; improvedWhen?: "higher" | "lower"; constraintMoved: boolean; nextConstraintObserved: string }) => void;
  outcome: OutcomeMeasurement | null; sprint: SprintRecord | null;
}) {
  const starting = sprint?.startingMetric;
  const [metric, setMetric] = useState<Metric>({ name: starting?.name ?? "", period: starting?.period ?? "", source: "", unit: starting?.unit ?? "", value: "" });
  const [moved, setMoved] = useState(false);
  const [next, setNext] = useState("");
  const [choice, setChoice] = useState<"higher" | "lower" | null>(null);
  // The preview is stored against the exact probe it answered, so a slow reply for an
  // older metric name can never be read as the inference for what is on screen now.
  const [preview, setPreview] = useState<{ probe: string; inference: DirectionInference | null; error: string } | null>(null);
  const fields: Array<[keyof Metric, string, string]> = [["name", "Metric name", "Bids returned per month"], ["value", "Ending value", "48"], ["unit", "Unit", "bids"], ["period", "Measurement period", "month"], ["source", "Source of this reading", "Client-stated in the closing call"]];
  // Only the fields the preview reads are in the key, so typing a value or source never re-requests an inference.
  const probe = `name=${encodeURIComponent(metric.name.trim())}&unit=${encodeURIComponent(metric.unit.trim())}&period=${encodeURIComponent(metric.period.trim())}${sprint?.constraintType ? `&constraintType=${encodeURIComponent(sprint.constraintType)}` : ""}`;
  const unnamed = probe.startsWith("name=&");
  useEffect(() => {
    if (probe.startsWith("name=&")) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ inference: DirectionInference }>(`/api/metric-direction?${probe}`, { signal: controller.signal })
        .then((result) => setPreview({ error: "", inference: result.inference, probe }))
        .catch((reason: Error) => {
          if (controller.signal.aborted || reason.name === "AbortError") return;
          setPreview({ error: `The direction could not be previewed: ${reason.message}`, inference: null, probe });
        });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [probe]);
  const current = preview?.probe === probe ? preview : null;
  const inference = current?.inference ?? null;
  const inferError = current?.error ?? "";
  const inferring = !unnamed && !current;
  const ambiguous = Boolean(inference?.ambiguous) && !choice;
  // What the panel highlights. An ambiguous inference is never pre-selected for the advisor.
  const shown = choice ?? (inference?.ambiguous ? null : inference?.improvedWhen ?? null);
  const recorded = outcome?.directionInference ?? null;
  const recordedDirection = recorded?.improvedWhen ?? outcome?.improvedWhen ?? null;
  return <section className="guided wide"><Back onClick={onBack}>Sprint</Back><PageHead eyebrow="Operate · Outcome" side={<Pill tone={outcome ? "success" : "assumed"}>{outcome ? "Measured" : "Not measured"}</Pill>} title="Measure what actually changed.">Record the ending reading exactly as the client states it. The before/after comparison is returned by the server; this screen never calculates or projects a number.</PageHead>
    <OpsRail current="measure" onNavigate={onNavigate} />
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    <div className="ops-columns">
      <form className="panel" onSubmit={(event) => { event.preventDefault(); onSubmit({ constraintMoved: moved, endingMetric: metric, nextConstraintObserved: next, ...(choice ? { improvedWhen: choice } : {}) }); }}>
        <p className="eyebrow">Ending metric</p>
        {starting ? <p className="ops-hint"><Icon name="info" size={15} />Starting metric on record: {starting.name} — {starting.value} {starting.unit} · {starting.period}</p> : <p className="ops-hint"><Icon name="info" size={15} />No starting metric is on record yet. Activate the sprint first so a before reading exists.</p>}
        {fields.map(([key, label, placeholder]) => <label key={key}><span>{label} <em>Required</em></span><input onChange={(event) => setMetric({ ...metric, [key]: event.target.value })} placeholder={placeholder} required value={metric[key]} /></label>)}
        <div className={`direction-panel ${ambiguous ? "ambiguous" : ""}`}>
          <p className="eyebrow">Which way is better</p>
          {inferring ? <p className="direction-state" role="status"><Icon name="refresh" size={15} />Reading how this metric should be interpreted…</p> : null}
          {!inferring && inferError ? <p className="direction-state error" role="alert"><Icon name="info" size={15} />{inferError} Pick the direction yourself below, or leave it unset and the result stays uninterpreted.</p> : null}
          {!inferring && !inferError && choice ? <p className="direction-basis"><Icon name="check" size={15} /><span><b>You set this direction.</b>{directionSentence(choice, metric.unit)} It is sent with the reading as your explicit declaration.</span></p> : null}
          {!inferring && !inferError && !choice && inference?.ambiguous ? <p className="direction-basis"><Icon name="info" size={15} /><span><b>This metric reads both ways — which is it?</b>{inference.basis}</span></p> : null}
          {!inferring && !inferError && !choice && inference && !inference.ambiguous && inference.improvedWhen ? <p className="direction-basis"><Icon name="spark" size={15} /><span><b>Proposed, not decided: {directionChoiceCopy[inference.improvedWhen][0].toLowerCase()}.</b>{inference.basis} {directionSentence(inference.improvedWhen, metric.unit)}</span></p> : null}
          {!inferring && !inferError && !choice && inference && !inference.ambiguous && !inference.improvedWhen ? <p className="direction-basis"><Icon name="info" size={15} /><span><b>No direction could be established.</b>{inference.basis || "Nothing in the metric name, unit, or period says which way is better."} Until you pick one the server reports the arithmetic change only and will not call it an improvement.</span></p> : null}
          {!inferring && !inferError && !choice && !inference ? <p className="direction-basis"><Icon name="info" size={15} /><span><b>Name the metric to see a proposal.</b>The direction is previewed from the metric name, unit, and period as you type. Nothing is saved by the preview.</span></p> : null}
          <div aria-label="Which way is better for this metric" className="direction-choices" role="group">{(["lower", "higher"] as const).map((option) => <button aria-pressed={shown === option} className={shown === option ? "selected" : ""} key={option} onClick={() => setChoice(option)} type="button"><strong>{directionChoiceCopy[option][0]}</strong><small>{directionChoiceCopy[option][1]}</small>{shown === option ? <Pill tone={choice ? "known" : "inferred"}>{choice ? "Your choice" : "Proposed"}</Pill> : null}</button>)}</div>
          {choice && inference && !inference.ambiguous && inference.improvedWhen ? <button className="direction-reset" onClick={() => setChoice(null)} type="button">Use the inferred direction instead ({directionChoiceCopy[inference.improvedWhen][0].toLowerCase()})</button> : null}
          <p className="direction-effect">{choice ? "Sent as your explicit declaration; the server will record you as the source of the direction." : shown ? "Nothing is sent for direction — the server applies this inference and records where it came from." : "No direction is sent. The result will show the arithmetic change only, marked not interpreted."}</p>
        </div>
        <label className="confirm"><input checked={moved} onChange={(event) => setMoved(event.target.checked)} type="checkbox" />The client confirmed the constraint moved.</label>
        <label><span>Next constraint observed <small>Optional</small></span><textarea onChange={(event) => setNext(event.target.value)} placeholder="Where the client says work now waits…" rows={3} value={next} /></label>
        <div className="action-row"><p><Icon name="lock" size={16} />Only client-confirmed readings are submitted.</p><Button disabled={busy || !metric.name.trim() || !metric.value.trim() || !metric.source.trim()} icon="check" type="submit">{busy ? "Recording…" : "Record ending metric"}</Button></div>
      </form>
      <div className="panel ops-result"><p className="eyebrow">Before and after</p>
        {!outcome ? <p className="registry-empty">No outcome has been recorded yet. Nothing is estimated in the meantime.</p> : <>
          <div className="ops-summary">{[["Starting metric", `${outcome.startingMetric?.value ?? "—"} ${outcome.startingMetric?.unit ?? ""}`, `${outcome.startingMetric?.name ?? "Missing"} · ${outcome.startingMetric?.source ?? "no source"}`], ["Ending metric", `${outcome.endingMetric?.value ?? "—"} ${outcome.endingMetric?.unit ?? ""}`, `${outcome.endingMetric?.name ?? "Missing"} · ${outcome.endingMetric?.source ?? "no source"}`]].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
          {outcome.delta ? <div className={`ops-delta ${outcome.delta.interpretation === "improved" ? "improved" : outcome.delta.interpretation === "worsened" ? "worsened" : "flat"}`}>
            <div className="delta-readings">
              <div><span>Arithmetic</span><strong>{outcome.delta.direction} {outcome.delta.absolute}</strong><small>{outcome.delta.percent}</small></div>
              <div><span>Interpretation</span><Pill tone={outcome.delta.interpretation === "improved" ? "success" : outcome.delta.interpretation === "worsened" ? "missing" : "neutral"}>{outcome.delta.interpretation === "not-interpreted" ? "not interpreted" : outcome.delta.interpretation}</Pill><small>{outcome.delta.interpretation === "not-interpreted" ? "No direction was established, so nothing here calls the change better or worse." : "Read against the direction recorded below."}</small></div>
            </div>
            <small>Both readings are exactly what the server returned. The browser never computes or flips an interpretation.</small>
          </div> : <div className="ops-delta blocked"><Pill tone="missing">No delta claimed</Pill><strong>{outcome.deltaBlockedReason || "The server returned no delta and no reason. No numeric change is claimed."}</strong><small>Nothing is computed client-side to fill this gap.</small></div>}
          <div className="direction-provenance">
            <header><Pill tone={directionSourceTone[recorded?.source ?? "none"]}>{recorded ? directionSourceLabel[recorded.source] : "Direction source not reported"}</Pill><span>{recordedDirection ? directionChoiceCopy[recordedDirection][0] : "No direction on record"}</span></header>
            <p>{recorded?.basis || "The server did not report where this direction came from. Treat the interpretation above as unexplained, and correct the direction if it reads wrong."}</p>
            {recorded ? <small>Confidence {confidenceLabel(recorded.confidence)}{recorded.ambiguous ? " · flagged as reading both ways" : ""}{recordedDirection ? ` · ${directionSentence(recordedDirection, outcome.endingMetric?.unit ?? "")}` : ""}</small> : null}
            <div className="direction-override"><span>Disagree with this direction? Correcting it makes the server re-read the delta and regenerate the outcome report.</span>
              <div className="status-toggle">{(["lower", "higher"] as const).map((option) => <button className={recordedDirection === option ? "selected" : ""} disabled={correcting} key={option} onClick={() => onCorrectDirection(option)} type="button">{directionChoiceCopy[option][0]}</button>)}</div>
              {correcting ? <small role="status">Correcting the direction and regenerating the outcome report…</small> : null}
            </div>
          </div>
          <dl className="ops-meta"><div><dt>Constraint moved</dt><dd>{outcome.constraintMoved ? "Yes, client-confirmed" : "Not confirmed"}</dd></div><div><dt>Next constraint</dt><dd>{outcome.nextConstraintObserved || "Not observed yet"}</dd></div><div><dt>Measured</dt><dd>{outcome.measuredAt ? new Date(outcome.measuredAt).toLocaleString() : "Unknown"}</dd></div></dl>
          <Button icon="arrow" onClick={() => onNavigate("catalog")}>Write the pattern back</Button>
        </>}
      </div>
    </div>
  </section>;
}

function Catalog({ busy, entry, error, onBack, onNavigate, onSubmit, outcome }: {
  busy: boolean; entry: CatalogEntry | null; error: string; onBack: () => void;
  onNavigate: (screen: Screen) => void; onSubmit: (body: { industryContext: string; reusableFor: string }) => void;
  outcome: OutcomeMeasurement | null;
}) {
  const [industryContext, setIndustryContext] = useState("");
  const [reusableFor, setReusableFor] = useState("");
  return <section className="guided wide"><Back onClick={onBack}>Outcome</Back><PageHead eyebrow="Operate · Catalog" side={<Pill tone={entry ? "success" : "assumed"}>{entry ? "Pattern written" : "Not written"}</Pill>} title="Compound the pattern.">The constraint, prescription, and measured result come from the approved record. You only add where this pattern is reusable.</PageHead>
    <OpsRail current="catalog" onNavigate={onNavigate} />
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    {!outcome ? <p className="ops-hint"><Icon name="info" size={15} />No measured outcome is on record. A catalog entry written now carries no measured result.</p> : null}
    <div className="ops-columns">
      <form className="panel" onSubmit={(event) => { event.preventDefault(); onSubmit({ industryContext, reusableFor }); }}>
        <p className="eyebrow">Reuse context</p>
        <label><span>Industry context</span><input onChange={(event) => setIndustryContext(event.target.value)} placeholder="Regional industrial fabrication, 20–80 staff" value={industryContext} /></label>
        <label><span>Reusable for</span><textarea onChange={(event) => setReusableFor(event.target.value)} placeholder="Which businesses this pattern should be tested against next…" rows={4} value={reusableFor} /></label>
        <div className="action-row"><p><Icon name="info" size={16} />Nothing is published externally by this action.</p><Button disabled={busy} icon="check" type="submit">{busy ? "Writing…" : "Write catalog entry"}</Button></div>
      </form>
      <div className="panel ops-result"><p className="eyebrow">Catalog entry</p>
        {!entry ? <p className="registry-empty">No catalog entry exists for this engagement yet.</p> : <dl className="ops-meta">{[["Constraint type", entry.constraintType], ["Canvas block", entry.canvasBlock], ["Pattern", entry.pattern], ["Prescription", entry.prescription], ["Measured result", entry.measuredResult || "None recorded"], ["Industry context", entry.industryContext || "Not stated"], ["Reusable for", entry.reusableFor || "Not stated"], ["Written", entry.writtenAt ? new Date(entry.writtenAt).toLocaleString() : "Unknown"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      </div>
    </div>
  </section>;
}

function ReviewedActions({ engagementId, onBack, onNavigate }: { engagementId: string | null; onBack: () => void; onNavigate: (screen: Screen) => void }) {
  const [intents, setIntents] = useState<IntentItem[]>([]);
  const [loading, setLoading] = useState(Boolean(engagementId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    if (!engagementId) return;
    let active = true;
    api<{ intents: IntentItem[] }>(`/api/intents?engagementId=${encodeURIComponent(engagementId)}`)
      .then((result) => { if (active) setIntents(result.intents ?? []); })
      .catch((reason: Error) => { if (active) { setIntents([]); setError(`Reviewed actions could not be loaded: ${reason.message}`); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [engagementId, reloadToken]);
  async function act(intent: IntentItem, action: "approve" | "reject" | "execute") {
    setBusy(`${intent.id}:${action}`); setError("");
    try {
      await api(`/api/intents/${intent.id}`, { body: JSON.stringify({ action }), method: "POST" });
      setConfirming("");
      setLoading(true);
      setReloadToken((token) => token + 1);
    } catch (reason) {
      setError(`The action could not be completed: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    } finally {
      setBusy("");
    }
  }
  return <section className="guided wide"><Back onClick={onBack}>Sprint</Back><PageHead eyebrow="Operate · External actions" title="Review before anything leaves this app.">Every externally-visible action is created as a reviewed intent. Approval and execution are separate, deliberate steps.</PageHead>
    <OpsRail current="actions" onNavigate={onNavigate} />
    <div className="security"><Icon name="lock" size={18} /><div><strong>Execute performs a real external write.</strong><p>Approve records your review only. Execute contacts the external provider and cannot be undone from this screen. An intent must be approved first.</p></div></div>
    {!engagementId ? <p className="registry-empty">Select or create an engagement before reviewing its external actions.</p> : null}
    {engagementId && loading ? <p className="registry-empty" role="status">Loading reviewed actions…</p> : null}
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    {engagementId && !loading && !error && intents.length === 0 ? <p className="registry-empty">No external actions have been proposed for this engagement.</p> : null}
    <div className="intent-list">{intents.map((intent) => <article key={intent.id}>
      <header><div><Pill tone={intent.status === "executed" ? "success" : intent.status === "approved" ? "known" : intent.status === "rejected" || intent.status === "failed" ? "missing" : "assumed"}>{intent.status.replace(/_/g, " ")}</Pill><strong>{intent.type.replace(/_/g, " ")}</strong></div><small>Created {intent.created_at ? new Date(intent.created_at).toLocaleString() : "unknown"}{intent.executed_at ? ` · executed ${new Date(intent.executed_at).toLocaleString()}` : ""}</small></header>
      {(() => { const outcome = intentResultCopy(intent); return outcome ? <p className={`intent-result ${outcome.tone}`} role={outcome.tone === "missing" ? "alert" : "status"}><Icon name={outcome.tone === "success" ? "check" : "info"} size={15} /><span><b>{outcome.title}</b>{outcome.detail}</span></p> : null; })()}
      <details><summary>Payload sent on execution</summary><pre>{JSON.stringify(intent.payload, null, 2)}</pre></details>
      {confirming === intent.id ? <div className="intent-confirm"><Icon name="lock" size={17} /><div><strong>This performs a real external write now.</strong><small>The payload above is sent to the external provider for {intent.type.replace(/_/g, " ")}.</small></div><Button onClick={() => setConfirming("")} variant="secondary">Cancel</Button><Button disabled={busy === `${intent.id}:execute`} icon="external" onClick={() => act(intent, "execute")}>{busy === `${intent.id}:execute` ? "Executing…" : "Yes, execute the external write"}</Button></div> : <div className="intent-actions">
        <Button disabled={intent.status !== "pending_review" || busy === `${intent.id}:approve`} icon="check" onClick={() => act(intent, "approve")} variant="secondary">{busy === `${intent.id}:approve` ? "Approving…" : "Approve"}</Button>
        <Button disabled={intent.status !== "pending_review" || busy === `${intent.id}:reject`} onClick={() => act(intent, "reject")} variant="secondary">{busy === `${intent.id}:reject` ? "Rejecting…" : "Reject"}</Button>
        <Button disabled={intent.status !== "approved"} icon="external" onClick={() => setConfirming(intent.id)}>Execute external write</Button>
        {intent.status !== "approved" ? <small>Execution stays locked until this intent is approved.</small> : null}
      </div>}
    </article>)}</div>
  </section>;
}

function modeIcon(mode: string): IconName {
  const value = (mode || "").toLowerCase();
  if (value.includes("transcript") || value.includes("meeting") || value.includes("import")) return "mic";
  if (value.includes("persistence") || value.includes("store") || value.includes("durable")) return "shield";
  if (value.includes("research") || value.includes("fetch") || value.includes("search")) return "search";
  if (value.includes("send") || value.includes("email") || value.includes("delivery")) return "mail";
  if (value.includes("draft") || value.includes("document") || value.includes("doc")) return "document";
  if (value.includes("write") || value.includes("intent")) return "folder";
  if (value.includes("credit") || value.includes("roster")) return "people";
  return "integration";
}

function IntegrationCenter({ onBack }: { onBack: () => void }) {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ integrations: IntegrationItem[] }>("/api/integrations")
      .then((result) => { if (active) setIntegrations(result.integrations ?? []); })
      .catch((reason: Error) => { if (active) { setIntegrations([]); setError(`Integration status could not be read: ${reason.message}`); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section className="guided wide integrations"><Back onClick={onBack}>Start</Back><PageHead eyebrow="Setup & data sources" title="Integration Center">Every status below is read live from the server. Nothing on this screen is asserted by the browser.</PageHead>
    <div className="local-default"><Icon name="shield" size={23} /><div><strong>Ready without credentials</strong><p>Intake, research, guided call, transcript paste/upload, synthesis, findings, and deliverables remain usable.</p></div><Pill tone="success">Working default</Pill></div>
    {loading ? <p className="registry-empty" role="status">Reading connector status…</p> : null}
    {error ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{error}</p> : null}
    {!loading && !error && integrations.length === 0 ? <p className="registry-empty">The server returned no integrations.</p> : null}
    <div className="integration-list">{integrations.map((item) => <article key={item.id}><span><Icon name={modeIcon(item.mode)} size={21} /></span>
      <div><header><h2>{item.name}</h2><Pill tone={statusTone[item.status] ?? "neutral"}>{item.status.replace(/_/g, " ")}</Pill>{item.model ? <Pill tone="inferred">{item.model}</Pill> : null}</header>
        <p>{item.setup || `No setup step is required beyond the ${(item.mode || "declared").replace(/_/g, " ")} mode.`}</p>
        <dl className="integration-meta"><div><dt>Mode</dt><dd>{(item.mode || "unspecified").replace(/_/g, " ")}</dd></div>{item.environmentVariables?.length ? <div><dt>Required env</dt><dd>{item.environmentVariables.map((name) => <code key={name}>{name}</code>)}</dd></div> : null}</dl></div>
      {item.resource ? <a className="button secondary" href={item.resource.url} rel="noopener noreferrer" target="_blank">{item.resource.name}<Icon name="external" size={14} /></a> : <span className="integration-none">No linked resource</span>}
    </article>)}</div>
    <div className="status-legend"><p className="eyebrow">What each status means</p><dl>{statusLegend.map(([status, text]) => <div key={status}><dt><Pill tone={statusTone[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Pill></dt><dd>{text}</dd></div>)}</dl></div>
    <div className="security"><Icon name="lock" size={18} /><div><strong>Authorization boundary</strong><p>Secrets are never entered into the audit. External writes, connector imports, paid enrichment, and customer sends require explicit review and approval.</p></div></div>
  </section>;
}

/** Which live integration ids can be verified, and the provider name POST /api/settings/test expects for each. */
const TESTABLE_PROVIDERS: Partial<Record<string, SettingsTestProvider>> = {
  openai: "openai",
  resend: "resend",
  google_sheets: "google_sheets",
  google_drive_docs: "google_docs",
  fireflies: "fireflies",
};

/** Reads a test result into a tone and label. ok → pass, not-configured → not set up, anything else → fail. */
function testResultView(result: SettingsTestResult | undefined): { tone: Tone; label: string } | null {
  if (!result) return null;
  if (result.ok) return { tone: "success", label: "Passed" };
  if (result.status === "not-configured") return { tone: "assumed", label: "Not set up" };
  return { tone: "missing", label: "Failed" };
}

type SettingsTestState = { running: boolean; result?: SettingsTestResult; error?: string };

/** One selectable, copyable shell command. The command is always visible, so a manual copy works even without clipboard access. */
function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="copy-line">
    <code>{text}</code>
    <button aria-label={`Copy command: ${text}`} className="copy-button" onClick={() => {
      if (typeof navigator.clipboard?.writeText !== "function") return;
      navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => setCopied(false));
    }} type="button">{copied ? <><Icon name="check" size={13} />Copied</> : <><Icon name="document" size={13} />Copy</>}</button>
  </div>;
}

/** The pass / not set up / fail line under a Test button. `detail` is shown verbatim — the server promises it never carries a secret. */
function TestOutcome({ test }: { test: SettingsTestState | undefined }) {
  if (!test) return null;
  const view = testResultView(test.result);
  return <>
    {test.error ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />The test could not run: {test.error}</p> : null}
    {view && test.result ? <p className={`settings-test-result ${view.tone}`} role="status"><Pill tone={view.tone}>{view.label}</Pill><span>{test.result.detail || "The server returned no detail."}</span></p> : null}
  </>;
}

/**
 * The advisor-only Settings screen. Two sections:
 *  1. API keys — live status, what each unlocks, the required env-var NAMES, the exact
 *     `wrangler secret put` command, and a Test button. No key is ever entered or displayed.
 *  2. My connections — the non-secret, per-advisor connection settings behind GET/PUT /api/settings.
 * Reachable only from the top nav, which is hidden on the client-facing call and presentation views.
 */
function SettingsScreen({ onBack, onIntegrations }: { onBack: () => void; onIntegrations: () => void }) {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState("");
  const [tests, setTests] = useState<Partial<Record<SettingsTestProvider, SettingsTestState>>>({});

  const [settings, setSettings] = useState<AdvisorSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [tab, setTab] = useState("Engagements");
  const [folder, setFolder] = useState("");
  const [fromName, setFromName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ integrations: IntegrationItem[] }>("/api/integrations")
      .then((result) => { if (active) setIntegrations(result.integrations ?? []); })
      .catch((reason: Error) => { if (active) { setIntegrations([]); setIntegrationsError(`Integration status could not be read: ${reason.message}`); } })
      .finally(() => { if (active) setIntegrationsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api<{ settings: AdvisorSettings }>("/api/settings")
      .then((result) => {
        if (!active) return;
        const s = result.settings;
        setSettings(s);
        setSheetId(s.crmSpreadsheetId ?? "");
        setTab(s.crmSheetTab?.trim() ? s.crmSheetTab : "Engagements");
        setFolder(s.driveFolderId ?? "");
        setFromName(s.fromName ?? "");
      })
      .catch((reason: Error) => { if (active) setSettingsError(`Your connection settings could not be loaded: ${reason.message}`); })
      .finally(() => { if (active) setSettingsLoading(false); });
    return () => { active = false; };
  }, []);

  /** Guarded against double-submit: a second click while a provider is in flight is ignored. */
  async function runTest(provider: SettingsTestProvider) {
    if (tests[provider]?.running) return;
    setTests((prev) => ({ ...prev, [provider]: { running: true, result: prev[provider]?.result } }));
    try {
      const response = await api<{ result: SettingsTestResult }>("/api/settings/test", { method: "POST", body: JSON.stringify({ provider }) });
      setTests((prev) => ({ ...prev, [provider]: { running: false, result: response.result } }));
    } catch (reason) {
      setTests((prev) => ({ ...prev, [provider]: { running: false, error: reason instanceof Error ? reason.message : "unknown request failure" } }));
    }
  }

  /** Saves every connection field through a single PUT. Guarded so a double-click cannot fire it twice. */
  async function saveConnections(event: FormEvent) {
    event.preventDefault();
    if (saveState === "saving" || settingsLoading) return;
    setSaveState("saving"); setSaveError("");
    try {
      const body: Partial<AdvisorSettings> = {
        crmSpreadsheetId: sheetId.trim(), crmSheetTab: tab.trim(), driveFolderId: folder.trim(), fromName: fromName.trim(),
      };
      const result = await api<{ settings: AdvisorSettings }>("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      const s = result.settings;
      setSettings(s);
      setSheetId(s.crmSpreadsheetId ?? "");
      setTab(s.crmSheetTab?.trim() ? s.crmSheetTab : "Engagements");
      setFolder(s.driveFolderId ?? "");
      setFromName(s.fromName ?? "");
      setSaveState("saved");
    } catch (reason) {
      setSaveState("error");
      setSaveError(`Your connections were not saved: ${reason instanceof Error ? reason.message : "unknown request failure"}`);
    }
  }

  const savedTab = settings ? (settings.crmSheetTab?.trim() ? settings.crmSheetTab : "Engagements") : "Engagements";
  const dirty = settings !== null && (
    sheetId.trim() !== (settings.crmSpreadsheetId ?? "").trim() ||
    tab.trim() !== savedTab.trim() ||
    folder.trim() !== (settings.driveFolderId ?? "").trim() ||
    fromName.trim() !== (settings.fromName ?? "").trim()
  );
  const saveLabel = saveState === "saving" ? "Saving…"
    : saveState === "error" ? "Not saved"
    : saveState === "saved" && !dirty ? "Saved"
    : dirty ? "Unsaved changes" : "Up to date";
  const sheetsTest = tests.google_sheets;

  return <section className="guided wide settings"><Back onClick={onBack}>Start</Back>
    <PageHead eyebrow="Advisor setup" side={<Button icon="integration" onClick={onIntegrations} variant="secondary">Integration Center</Button>} title="Settings">Two things live here: the API keys your server holds (status and a test, never the key itself), and the connections stored against your advisor account. This screen is advisor-only and is not reachable from a client call.</PageHead>

    <div className="settings-keys-banner"><Icon name="lock" size={20} /><div><strong>API keys are server secrets — you never type one here.</strong><p>Keys are set on the server with <code>wrangler secret put</code> and are never sent to the browser or written to the database. This screen shows only whether each key is present and lets you test it.</p></div></div>

    <div className="settings-section"><header className="settings-section-head"><p className="eyebrow">Section 1 · API keys</p><h2>Status &amp; test — no key entry</h2><p>Read live from the server. For each provider you can see what it unlocks, the exact command to set its secret, and — where supported — a test that reports pass, not set up, or fail.</p></header>
      {integrationsLoading ? <p className="registry-empty" role="status">Reading connector status…</p> : null}
      {integrationsError ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{integrationsError}</p> : null}
      {!integrationsLoading && !integrationsError && integrations.length === 0 ? <p className="registry-empty">The server returned no integrations.</p> : null}
      <div className="settings-providers">{integrations.map((item) => {
        const provider = TESTABLE_PROVIDERS[item.id];
        const test = provider ? tests[provider] : undefined;
        return <article className="settings-provider" key={item.id}>
          <span className="settings-provider-icon"><Icon name={modeIcon(item.mode)} size={21} /></span>
          <div className="settings-provider-body">
            <header><h3>{item.name}</h3><Pill tone={statusTone[item.status] ?? "neutral"}>{item.status.replace(/_/g, " ")}</Pill>{item.model ? <Pill tone="inferred">{item.model}</Pill> : null}</header>
            <p className="settings-provider-unlocks">{item.setup || `Unlocks the ${(item.mode || "declared").replace(/_/g, " ")} mode.`}</p>
            {item.environmentVariables?.length ? <div className="settings-secret">
              <p className="settings-secret-lead"><Icon name="lock" size={14} />Required env var names — set each as a server secret. This keeps the key out of the database and out of this browser.</p>
              <div className="copy-lines">{item.environmentVariables.map((name) => <CopyLine key={name} text={`wrangler secret put ${name}`} />)}</div>
            </div> : <p className="settings-nokeys"><Icon name="check" size={14} />No credential is required for this provider.</p>}
            {provider ? <div className="settings-test">
              <Button disabled={Boolean(test?.running)} icon="refresh" onClick={() => runTest(provider)} variant="secondary">{test?.running ? "Testing…" : "Test"}</Button>
              <TestOutcome test={test} />
            </div> : null}
          </div>
        </article>;
      })}</div>
    </div>

    <div className="settings-section"><header className="settings-section-head"><p className="eyebrow">Section 2 · My connections</p><h2>Stored against your advisor account</h2><p>Non-secret connection settings only. None of these fields is a key — they are saved to your account and can be changed at any time.</p></header>
      {settingsLoading ? <p className="registry-empty" role="status">Reading your connection settings…</p> : null}
      {settingsError ? <p className="ops-error" role="alert"><Icon name="info" size={15} />{settingsError}</p> : null}
      {!settingsLoading && !settingsError ? <form className="panel settings-connections" onSubmit={saveConnections}>
        <div className="settings-crm">
          <h3>Connect your CRM — bring your own Google Sheet</h3>
          <p className="settings-sub">The app writes engagement rows through the Google identity configured on the server. You share a sheet with it and paste the link here — you never paste a key.</p>
          <ol className="settings-guide">
            <li><span>1</span><div><strong>Download the CRM template</strong><p>Start from the exact columns the app writes back.</p><a className="button secondary settings-download" download href="/api/crm-template">Download CRM template<Icon name="download" size={15} /></a></div></li>
            <li><span>2</span><div><strong>Import it into Google Sheets</strong><p>In Sheets, File → Import → Upload, and keep it as a new spreadsheet.</p></div></li>
            <li><span>3</span><div><strong>Share it with the app&apos;s Google account</strong><p>Give edit access to the configured Google identity so the app can write the row. The app writes as that identity, not as you.</p></div></li>
            <li><span>4</span><div><strong>Paste the sheet URL or id</strong>
              <label><span>Google Sheet URL or ID</span><input autoCapitalize="none" onChange={(e) => setSheetId(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…  or the raw id" spellCheck={false} value={sheetId} /></label>
              <small>Paste the whole URL if it is easier — the server parses the id out of it.</small></div></li>
            <li><span>5</span><div><strong>Set the tab name</strong>
              <label><span>Sheet tab</span><input onChange={(e) => setTab(e.target.value)} placeholder="Engagements" value={tab} /></label>
              <small>Defaults to Engagements. This is the tab the row is written to.</small></div></li>
          </ol>
          <div className="settings-test settings-test-inline">
            <Button disabled={Boolean(sheetsTest?.running)} icon="refresh" onClick={() => runTest("google_sheets")} variant="secondary">{sheetsTest?.running ? "Testing…" : "Test connection"}</Button>
            <small>Reports whether the tab and expected columns were found. Save first so the test reads your latest values.</small>
            <TestOutcome test={sheetsTest} />
          </div>
        </div>
        <div className="field-row">
          <label className="field-note"><span>Drive folder id <small>Optional</small></span><input autoCapitalize="none" onChange={(e) => setFolder(e.target.value)} placeholder="Google Drive folder id" spellCheck={false} value={folder} /><small>Where generated Google Docs are filed.</small></label>
          <label className="field-note"><span>From name <small>Optional</small></span><input onChange={(e) => setFromName(e.target.value)} placeholder="Tier 4 Advisors" value={fromName} /><small>The display name on outgoing email.</small></label>
        </div>
        <p className="settings-nosecret"><Icon name="lock" size={15} />These are the only editable fields, and not one of them is a secret. Set API keys with the <code>wrangler secret put</code> commands in Section 1.</p>
        {saveError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{saveError}</p> : null}
        <div className="action-row"><p aria-live="polite" className={`settings-save-state ${saveState}`}>{saveLabel}</p><Button disabled={saveState === "saving" || settingsLoading} icon="check" type="submit">{saveState === "saving" ? "Saving…" : "Save connections"}</Button></div>
      </form> : null}
    </div>

    <div className="security"><Icon name="lock" size={18} /><div><strong>Authorization boundary</strong><p>No secret is ever entered or displayed here. External writes, connector imports, paid enrichment, and customer sends still require explicit review and approval.</p></div></div>
  </section>;
}
