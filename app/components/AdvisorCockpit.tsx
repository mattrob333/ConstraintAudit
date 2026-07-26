"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";

const stages = ["Client", "Research", "Prepare", "Call", "Synthesize", "Deliver", "Operate"] as const;
type Stage = (typeof stages)[number];
type Screen =
  | "home" | "intake" | "migration" | "engagements" | "research" | "prepare"
  | "call" | "transcript" | "synthesis" | "findings" | "deliver" | "sprint"
  | "measure" | "catalog" | "actions" | "integrations";
type Tone = "neutral" | "known" | "inferred" | "assumed" | "missing" | "success";
type Engagement = {
  id: string; companyName: string; website: string; stage: Stage; status: string;
  nextAction: string; updatedAt: string;
};
type DocumentItem = {
  id: string; name: string; kind: "workflow" | "generated";
  status: "approved" | "draft" | "provisional"; href?: string;
};
type BackendEngagement = {
  id: string; client: string; website: string; stage: string; status: string;
  nextAction: string; updatedAt: string; version: number;
  data?: {
    research?: ResearchPayload; transcriptSynthesis?: TranscriptSynthesis[]; canvas?: CanvasRecord;
    sprint?: SprintRecord; outcome?: OutcomeMeasurement; catalogEntry?: CatalogEntry;
  };
};

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
  payload: unknown; created_at: string; executed_at?: string | null;
};
type IntegrationItem = {
  id: string; name: string; status: string; mode: string; setup?: string;
  environmentVariables?: string[]; model?: string; resource?: { name: string; url: string };
};
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
  txt: "text/plain", vtt: "text/vtt", srt: "application/x-subrip", json: "application/json",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

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

const deliverables = [
  ["Diagnosis package", "Canvas v1, constraint card, evidence, baseline, prescription, owner, and predicted next constraint."],
  ["Audit report", "Canvas-block narrative that ends in the single constraint finding."],
  ["Proposal & business case", "One metric delta, a fixed two-week sprint, and formulas without invented ROI."],
  ["Implementation roadmap", "Remove and measure, record constraint migration, then diagnose the next constraint."],
  ["Developer specification", "Human owner, scope, guardrails, evidence, escalation, and acceptance criteria."],
  ["Roles & responsibility map", "Task-level ownership in the constrained flow, ready to carry into implementation."],
] as const;

function stageFor(screen: Screen): Stage | null {
  if (["intake", "migration", "engagements"].includes(screen)) return "Client";
  if (screen === "research") return "Research";
  if (screen === "prepare") return "Prepare";
  if (["call", "transcript"].includes(screen)) return "Call";
  if (["synthesis", "findings"].includes(screen)) return "Synthesize";
  if (screen === "deliver") return "Deliver";
  if (["sprint", "measure", "catalog", "actions"].includes(screen)) return "Operate";
  return null;
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

function uiStage(value: string): Stage {
  const stage = value.toUpperCase();
  if (stage.includes("RECON")) return "Research";
  if (stage.includes("GUIDED") || stage.includes("CALL")) return "Call";
  if (stage.includes("TRANSCRIPT") || stage.includes("CANVAS_COMMIT")) return "Synthesize";
  if (stage.includes("SPRINT") || stage.includes("OUTCOME") || stage.includes("CATALOG")) return "Operate";
  if (stage.includes("DIAGNOSIS") || stage.includes("DELIVER")) return "Deliver";
  return "Client";
}

function toEngagement(item: BackendEngagement): Engagement {
  return {
    id: item.id,
    companyName: item.client,
    website: item.website ?? "",
    stage: uiStage(item.stage),
    status: item.status,
    nextAction: item.nextAction,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Not yet updated",
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
    type ApiDocument = Partial<DocumentItem> & { id: string; title?: string; url?: string };
    api<ApiDocument[] | { documents: ApiDocument[] }>(`/api/documents${activeId ? `?engagementId=${activeId}` : ""}`)
      .then((data) => {
        const items = Array.isArray(data) ? data : data.documents;
        setDocs(items.map((doc) => ({
          name: doc.name ?? doc.title ?? "Untitled document",
          id: doc.id,
          href: doc.href ?? doc.url,
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
        <a href={doc.href ?? "#"} key={doc.id} onClick={(event) => { if (!doc.href) event.preventDefault(); }} role="menuitem">
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
  const [meetingDate, setMeetingDate] = useState("2026-07-23");
  const [fileName, setFileName] = useState("");
  const [transcriptFile, setTranscriptFile] = useState<TranscriptFile | null>(null);
  const [fileSummary, setFileSummary] = useState("");
  const [fileError, setFileError] = useState("");
  const [fileReading, setFileReading] = useState(false);
  const [transcriptCallNumber, setTranscriptCallNumber] = useState<1 | 2>(1);
  const [call2Processed, setCall2Processed] = useState(false);
  const [diagnosisApproved, setDiagnosisApproved] = useState(false);
  const [generated, setGenerated] = useState<string[]>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const currentStage = stageFor(screen);
  const displayCompany = company || "Untitled engagement";
  const script = callScriptFor(researchResult);
  const callQuestion = script.questions[Math.min(callIndex, script.questions.length - 1)];

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

  function go(next: Screen) {
    setScreen(next); setNotice(""); setMobileNav(false);
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

  async function createEngagement(event: FormEvent) {
    event.preventDefault();
    try {
      const normalizedWebsite = normalizeWebsiteInput(website);
      setWebsite(normalizedWebsite);
      const response = await save<{ engagement: BackendEngagement }>("/api/engagements", {
        client: company,
        website: normalizedWebsite,
        primaryContact: contact,
        notes: [role ? `Contact role: ${role}` : "", context].filter(Boolean).join("\n\n"),
      });
      const id = response.engagement.id;
      setActiveId(id);
      setEngagements((items) => [toEngagement(response.engagement), ...items.filter((item) => item.id !== id)]);
      const researchResponse = await save<{ engagement?: BackendEngagement; research: ResearchPayload }>(`/api/engagements/${id}/research`, { sourceUrl: normalizedWebsite });
      setResearchResult(researchResponse.research);
      setCanvas(researchResponse.engagement?.data?.canvas ?? null);
      setCallIndex(0);
      go("research");
    } catch {
      // save() leaves the advisor on intake with a visible error.
    }
  }

  async function loadEngagement(id: string): Promise<boolean> {
    try {
      const response = await api<{ engagement: BackendEngagement }>(`/api/engagements/${id}`);
      const data = response.engagement.data;
      setResearchResult(data?.research ?? null);
      setCanvas(data?.canvas ?? null);
      setSprint(data?.sprint ?? null);
      setOutcome(data?.outcome ?? null);
      setCatalogEntry(data?.catalogEntry ?? null);
      setSynthesisResult((data?.transcriptSynthesis ?? []).at(-1) ?? null);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unknown request failure";
      setNotice(`The engagement could not be read: ${message}`);
      return false;
    }
  }

  async function resume(item: Engagement) {
    setCompany(item.companyName); setWebsite(item.website); setActiveId(item.id); setCallIndex(0);
    if (!await loadEngagement(item.id)) return;
    go(item.stage === "Research" ? "research" : item.stage === "Synthesize" ? "synthesis" : item.stage === "Operate" ? "sprint" : "deliver");
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
    try {
      await save(`/api/engagements/${activeId}/readiness-brief`, { action: "approve" });
      await save(`/api/engagements/${activeId}/readiness-brief`, { action: "send_intent" });
      setBriefSent(true); setConfirmSend(false);
      setNotice("Brief approved and a reviewed send intent was recorded. No email was sent.");
    } catch {
      // Keep the confirmation open so the advisor can retry or cancel.
    }
  }

  async function analyze() {
    if (!activeId) {
      setNotice("Action not completed: select or create an engagement first.");
      return;
    }
    const callConsent = transcriptCallNumber === 1 ? consent : call2Consent;
    if (callConsent !== "recorded") {
      setNotice("Transcript capture is blocked until recording and transcription consent is confirmed for this call.");
      return;
    }
    const consentAttestation = {
      grantedBeforeCapture: true,
      attestedBy: "Tier 4 Advisor",
      attestedAt: new Date().toISOString(),
      note: `Client confirmed recording and transcription consent for Call ${transcriptCallNumber}.`,
    };
    const speakerRoles = {
      Advisor: "advisor" as const,
      ...(contact.trim() ? { [contact.trim()]: "client" as const } : {}),
    };
    const humanOwner = contact.trim() && role.trim() ? { name: contact.trim(), role: role.trim() } : undefined;
    let response: { synthesis: TranscriptSynthesis };
    if (transcriptMethod === "fireflies") {
      if (!transcript.trim()) {
        setNotice("Enter a Fireflies transcript ID, or choose paste/upload.");
        return;
      }
      try {
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/fireflies`, {
          transcriptId: transcript,
          callNumber: transcriptCallNumber,
          consentAttestation,
          speakerRoles,
        });
      } catch {
        return;
      }
    } else if (transcriptMethod === "upload") {
      if (!transcriptFile) {
        setNotice("Choose a transcript file and let it finish reading before analysis.");
        return;
      }
      try {
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/transcripts`, {
          callNumber: transcriptCallNumber,
          consentAttestation,
          file: transcriptFile,
          humanOwner,
          speakerRoles,
        });
      } catch {
        return;
      }
    } else {
      if (!transcript.trim()) {
        setNotice("Paste the transcript text before analysis.");
        return;
      }
      try {
        response = await save<{ synthesis: TranscriptSynthesis }>(`/api/engagements/${activeId}/transcripts`, {
          callNumber: transcriptCallNumber,
          consentAttestation,
          humanOwner,
          rawText: transcript,
          speakerRoles,
        });
      } catch {
        return;
      }
    }
    setSynthesisResult(response.synthesis);
    try {
      const refreshed = await api<{ engagement: BackendEngagement }>(`/api/engagements/${activeId}`);
      setCanvas(refreshed.engagement.data?.canvas ?? null);
    } catch {
      // The synthesis is already on screen; a canvas refresh failure must not hide it.
    }
    if (transcriptCallNumber === 2) {
      setCall2Processed(true);
      setNotice("Call 2 transcript reconciled. Review the finding once more before diagnosis approval.");
      go("findings");
    } else {
      go("synthesis");
    }
  }

  async function approve(checkpoint: "canvas" | "diagnosis") {
    if (!activeId) {
      setNotice("Action not completed: select or create an engagement first.");
      return;
    }
    if (checkpoint === "canvas") {
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
    try {
      if (!contact.trim() || !role.trim()) {
        setNotice("Diagnosis approval requires a named human owner and role. Add them to the engagement before approval.");
        return;
      }
      await save(`/api/engagements/${activeId}/finding`, {
        action: "approve_diagnosis",
        humanOwner: { name: contact.trim(), role: role.trim() },
      });
      setDiagnosisApproved(true);
      go("deliver");
    } catch {
      // Keep the advisor on the finding review after a failed approval.
    }
  }

  async function generateAllDeliverables() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    try {
      await save(`/api/engagements/${activeId}/deliverables`, {});
      setGenerated(deliverables.map(([title]) => title));
      setNotice("The full internal deliverable suite is ready in Documents.");
    } catch {
      // Do not mark deliverables generated after an API failure.
    }
  }

  async function prepareCrmWriteBack() {
    if (!activeId) return setNotice("Action not completed: select or create an engagement first.");
    try {
      await save(`/api/engagements/${activeId}/crm`, {});
      setNotice("CRM write-back intent prepared. No external Sheet was changed.");
    } catch {
      // Do not claim intent creation after an API failure.
    }
  }

  return <div className={`cockpit ${screen === "call" ? "client-call" : ""}`}>
    <a className="skip" href="#main">Skip to main content</a>
    <header className="app-header">
      <button className="brand" onClick={() => go("home")} type="button"><span><Icon name="shield" size={18} /></span>TIER 4 <em>AUDIT</em></button>
      {screen !== "home" ? <div className="header-context"><i />{displayCompany}<Pill tone={screen === "call" ? "known" : "neutral"}>{screen === "call" ? "Client call view" : "Advisor view"}</Pill></div> : null}
      <button aria-controls="primary-navigation" aria-expanded={mobileNav} aria-label={mobileNav ? "Close navigation" : "Open navigation"} className="mobile-nav" onClick={() => setMobileNav(!mobileNav)} type="button"><Icon name={mobileNav ? "close" : "menu"} /></button>
      <nav aria-label="Product navigation" className={mobileNav ? "open" : ""} id="primary-navigation">
        <Documents activeId={activeId} />
        <button className="header-link" onClick={() => go("engagements")} type="button"><Icon name="briefcase" size={16} />Engagements</button>
        <button className="header-link" onClick={() => go("integrations")} type="button"><Icon name="integration" size={16} />Integrations</button>
        {screen !== "home" ? <button className="exit" onClick={() => go("home")} type="button">Exit</button> : null}
      </nav>
    </header>
    {currentStage && screen !== "call" ? <Stepper current={currentStage} /> : null}
    <main id="main">
      {notice ? <div className="notice" role="status"><Icon name="info" size={16} />{notice}<button aria-label="Dismiss" onClick={() => setNotice("")} type="button"><Icon name="close" size={14} /></button></div> : null}
      {screen === "home" ? <Home engagements={engagements} loading={registryLoading} onFresh={() => go("intake")} onMigration={() => go("migration")} onResume={resume} onUpdate={() => go("engagements")} /> : null}
      {screen === "intake" ? <Intake apiState={apiState} company={company} contact={contact} context={context} onBack={() => go("home")} onCompany={setCompany} onContact={setContact} onContext={setContext} onRole={setRole} onSubmit={createEngagement} onWebsite={setWebsite} role={role} website={website} /> : null}
      {screen === "migration" ? <Migration onBack={() => go("home")} onContinue={() => { setNotice("Source material staged locally. Add the client anchor before research begins."); go("intake"); }} /> : null}
      {screen === "engagements" ? <Engagements engagements={engagements} loading={registryLoading} onBack={() => go("home")} onFresh={() => go("intake")} onResume={resume} /> : null}
      {screen === "research" ? <Research canvas={canvas} company={displayCompany} onBack={() => go("intake")} onPrepare={() => go("prepare")} research={researchResult} script={script} /> : null}
      {screen === "prepare" ? <Prepare briefSent={briefSent} contact={contact || "Primary contact"} onBack={() => go("research")} onCall={() => { setCallIndex(0); go("call"); }} onSend={() => { setConfirmed(false); setConfirmSend(true); }} /> : null}
      {screen === "call" && callQuestion ? <Call answer={answers[callQuestion.id] ?? ""} company={displayCompany} consent={consent} generic={script.generic} index={Math.min(callIndex, script.questions.length - 1)} notes={notes[callQuestion.id] ?? ""} onAnswer={(value) => setAnswers((all) => ({ ...all, [callQuestion.id]: value }))} onConsent={setConsent} onExit={() => go("prepare")} onNext={() => callIndex < script.questions.length - 1 ? setCallIndex(callIndex + 1) : go("transcript")} onNotes={(value) => setNotes((all) => ({ ...all, [callQuestion.id]: value }))} onPrevious={() => setCallIndex(Math.max(0, callIndex - 1))} onValue={(value) => setValues((all) => ({ ...all, [callQuestion.id]: value }))} question={callQuestion} total={script.questions.length} value={values[callQuestion.id] ?? ""} /> : null}
      {screen === "transcript" ? <Transcript callNumber={transcriptCallNumber} company={displayCompany} date={meetingDate} fileError={fileError} fileName={fileName} fileReading={fileReading} fileSummary={fileSummary} method={transcriptMethod} onAnalyze={analyze} onBack={() => transcriptCallNumber === 2 ? go("findings") : go("call")} onDate={setMeetingDate} onFile={selectTranscriptFile} onMethod={setTranscriptMethod} onText={setTranscript} ready={Boolean(transcriptFile)} text={transcript} /> : null}
      {screen === "synthesis" ? <Synthesis onApprove={() => approve("canvas")} onBack={() => go("transcript")} synthesis={synthesisResult} /> : null}
      {screen === "findings" ? <Findings consent={call2Consent} onApprove={() => approve("diagnosis")} onBack={() => go("synthesis")} onConsent={setCall2Consent} owner={contact && role ? `${contact}, ${role}` : ""} synthesis={synthesisResult} /> : null}
      {screen === "deliver" ? <Deliver approved={diagnosisApproved} generated={generated} onActions={() => openOperations("actions")} onBack={() => go("findings")} onGenerate={generateAllDeliverables} onOperate={openOperations} onSync={prepareCrmWriteBack} /> : null}
      {screen === "sprint" ? <SprintScreen busy={opsBusy} error={opsError} onActivate={activateSprint} onBack={() => go("deliver")} onNavigate={openOperations} onTask={updateSprintTask} sprint={sprint} /> : null}
      {screen === "measure" ? <Measure busy={opsBusy === "outcome"} correcting={opsBusy === "direction"} error={opsError} onBack={() => openOperations("sprint")} onCorrectDirection={correctOutcomeDirection} onNavigate={openOperations} onSubmit={recordOutcome} outcome={outcome} sprint={sprint} /> : null}
      {screen === "catalog" ? <Catalog busy={opsBusy === "catalog"} entry={catalogEntry} error={opsError} onBack={() => openOperations("measure")} onNavigate={openOperations} onSubmit={writeCatalog} outcome={outcome} /> : null}
      {screen === "actions" ? <ReviewedActions engagementId={activeId} onBack={() => openOperations("sprint")} onNavigate={openOperations} /> : null}
      {screen === "integrations" ? <IntegrationCenter onBack={() => go("home")} /> : null}
      {screen === "call" && !callQuestion ? <section className="guided narrow"><PageHead eyebrow="Call · guided script" title="No call question is available.">Run research for this engagement so the guided call can be driven by client-specific discovery questions.</PageHead><Button icon="back" onClick={() => go("research")}>Back to research</Button></section> : null}
    </main>
    {screen !== "home" && screen !== "call" ? <div aria-live="polite" className="save-state"><i className={apiState} />{apiState === "saving" ? "Saving…" : apiState === "saved" ? "Saved" : apiState === "error" ? "Action failed" : "Ready"}</div> : null}
    {confirmSend ? <div className="modal-layer"><div aria-describedby="send-description" aria-labelledby="send-title" aria-modal="true" className="modal" ref={modalRef} role="dialog">
      <button aria-label="Close" className="modal-close" onClick={() => setConfirmSend(false)} type="button"><Icon name="close" size={17} /></button>
      <span className="modal-icon"><Icon name="mail" size={21} /></span><p className="eyebrow">External intent</p><h2 id="send-title">Approve this send intent</h2>
      <p id="send-description">This records approval and prepares a reviewed send intent. It does not send an email. The brief excludes the Canvas, internal questions, and constraint hypotheses.</p>
      <dl><div><dt>Recipient</dt><dd>{contact || "Primary contact"}</dd></div><div><dt>Delivery intent</dt><dd>Email draft</dd></div><div><dt>Document</dt><dd>Pre-Call Readiness Brief</dd></div></dl>
      <label className="confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />I reviewed the recipient and client-facing content.</label>
      <div className="modal-actions"><Button onClick={() => setConfirmSend(false)} variant="secondary">Cancel</Button><Button disabled={!confirmed} icon="mail" onClick={sendBrief}>Approve send intent</Button></div>
      <small>No external provider is contacted by this action.</small>
    </div></div> : null}
  </div>;
}

function Home({ engagements, loading, onFresh, onMigration, onResume, onUpdate }: {
  engagements: Engagement[]; loading: boolean; onFresh: () => void; onMigration: () => void;
  onResume: (item: Engagement) => void; onUpdate: () => void;
}) {
  return <section className="home">
    <div className="ambient one" /><div className="ambient two" />
    <div className="home-copy"><Pill tone="known"><Icon name="spark" size={12} /> Guided throughput audit</Pill><h1>Find the constraint.<br />Measure what changes.</h1><p>Begin a new client conversation or continue an evidence-grounded audit. One constraint, one prescription, one metric, one named human owner.</p></div>
    <div className="entry-grid">
      <button className="entry primary" onClick={onFresh} type="button"><span className="entry-icon"><Icon name="plus" size={25} /></span><span><small>Start here</small><strong>Fresh engagement</strong><p>Give us a client starting point. We’ll research publicly, draft the operating model, and prepare the questions that matter.</p></span><b>Start a new audit <Icon name="arrow" size={17} /></b></button>
      <div className="secondary-entries">
        <button className="entry secondary" onClick={onMigration} type="button"><span className="entry-icon"><Icon name="upload" size={21} /></span><span><strong>External migration</strong><p>Bring an existing audit, transcript, notes, or workspace into the same guided structure.</p></span><Icon name="chevron" size={17} /></button>
        <button className="entry secondary" onClick={onUpdate} type="button"><span className="entry-icon"><Icon name="refresh" size={21} /></span><span><strong>Update an engagement</strong><p>Continue from the current stage in your inspectable engagement registry.</p></span><Icon name="chevron" size={17} /></button>
      </div>
    </div>
    <div className="recent-head"><div><p className="eyebrow">Continue the work</p><h2>Recent engagements</h2></div><button onClick={onUpdate} type="button">View all engagements <Icon name="arrow" size={14} /></button></div>
    <div className="recent-list">{loading ? <p className="registry-empty" role="status">Loading the engagement registry…</p> : null}{!loading && engagements.length === 0 ? <p className="registry-empty">No engagements yet. Start a fresh engagement to create the first record.</p> : null}{engagements.map((item) => <button className="recent" key={item.id} onClick={() => onResume(item)} type="button"><span className="initials">{item.companyName.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><span><strong>{item.companyName}</strong><small>{item.status}</small></span><Pill>{item.stage}</Pill><Icon name="chevron" size={16} /></button>)}</div>
    <div className="local-note"><Icon name="shield" size={18} /><span><strong>Deterministic local mode is ready.</strong> No OpenAI key or paid enrichment is required. External connectors run only after explicit setup and approval.</span></div>
  </section>;
}

function Intake(props: {
  apiState: string; company: string; website: string; contact: string; role: string; context: string;
  onBack: () => void; onCompany: (v: string) => void; onWebsite: (v: string) => void;
  onContact: (v: string) => void; onRole: (v: string) => void; onContext: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const [attachment, setAttachment] = useState("");
  return <section className="guided narrow"><Back onClick={props.onBack}>Entry options</Back><PageHead eyebrow="Client · Starting point" title="Who are we learning about?">Give us a starting point. We’ll research the business, draft a first-pass business model, and prepare the questions that matter for your call.</PageHead>
    <form className="intake-form" onSubmit={props.onSubmit}>
      <div className="field-row"><label><span>Company name <em>Required</em></span><input autoFocus onChange={(e) => props.onCompany(e.target.value)} placeholder="Acme Industrial" required value={props.company} /></label><label><span>Company website</span><input autoCapitalize="none" inputMode="url" onBlur={(e) => props.onWebsite(normalizeWebsiteInput(e.target.value))} onChange={(e) => props.onWebsite(e.target.value)} placeholder="tier4advisors.com" spellCheck={false} type="text" value={props.website} /></label></div>
      <div className="field-row"><label><span>Primary contact name</span><input onChange={(e) => props.onContact(e.target.value)} placeholder="Maya Chen" value={props.contact} /></label><label><span>Primary contact role</span><input onChange={(e) => props.onRole(e.target.value)} placeholder="Chief Operating Officer" value={props.role} /></label></div>
      <label><span>What prompted this conversation? <small>Optional</small></span><textarea onChange={(e) => props.onContext(e.target.value)} placeholder="What is changing, stuck, or important right now?" rows={5} value={props.context} /></label>
      <label className="upload"><input accept=".pdf,.doc,.docx,.txt,.md,.csv" onChange={(e) => setAttachment(e.target.files?.[0]?.name ?? "")} type="file" /><span><Icon name="upload" size={20} /></span><span><strong>{attachment || "Add an email, notes, proposal, or prior document"}</strong><small>{attachment ? "Source staged for the engagement register" : "Optional · PDF, DOCX, TXT, Markdown, or CSV"}</small></span></label>
      <div className="action-row"><p><Icon name="shield" size={18} /><span><strong>Public sources first.</strong> Nothing is sent to the client, and paid enrichment never runs automatically.</span></p><Button disabled={!props.company.trim() || props.apiState === "saving"} icon="arrow" type="submit">{props.apiState === "saving" ? "Preparing research…" : "Research this business"}</Button></div>
    </form>
  </section>;
}

function Migration({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const [file, setFile] = useState(""); const [text, setText] = useState("");
  return <section className="guided narrow"><Back onClick={onBack}>Entry options</Back><PageHead eyebrow="Client · External migration" title="Bring the existing work with you.">Import an audit, transcript, notes, or workspace export. We’ll preserve the source and map it into the same evidence-grounded journey.</PageHead>
    <div className="panel"><label className="upload large"><input accept=".pdf,.doc,.docx,.txt,.md,.csv,.json" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} type="file" /><span><Icon name="upload" size={23} /></span><span><strong>{file || "Choose a source file"}</strong><small>The original remains a source; it is not silently overwritten.</small></span></label>
      <div className="or"><span>or paste source material</span></div><label><span>Existing notes or transcript</span><textarea onChange={(e) => setText(e.target.value)} placeholder="Paste the material exactly as received…" rows={9} value={text} /></label>
      <div className="action-row"><p><Icon name="info" size={17} />Claims retain their source and confirmation status.</p><Button disabled={!file && !text.trim()} icon="arrow" onClick={onContinue}>Continue with client anchor</Button></div>
    </div>
  </section>;
}

function Engagements({ engagements, loading, onBack, onFresh, onResume }: { engagements: Engagement[]; loading: boolean; onBack: () => void; onFresh: () => void; onResume: (item: Engagement) => void }) {
  return <section className="guided wide"><Back onClick={onBack}>Entry options</Back><PageHead eyebrow="Client registry" side={<Button icon="plus" onClick={onFresh}>Fresh engagement</Button>} title="Engagements">Continue from the current stage. Stage, next action, dates, and document links remain directly inspectable.</PageHead>
    {loading ? <p className="registry-empty" role="status">Loading the engagement registry…</p> : null}
    {!loading && engagements.length === 0 ? <p className="registry-empty">No engagement records were returned.</p> : null}
    {engagements.length ? <div className="table-wrap"><table className="registry"><thead><tr><th>Client</th><th>Stage</th><th>Status & next action</th><th>Updated</th><th /></tr></thead><tbody>{engagements.map((item) => <tr key={item.id}><td><strong>{item.companyName}</strong><small>{item.website}</small></td><td><Pill>{item.stage}</Pill></td><td><strong>{item.status}</strong><small>{item.nextAction}</small></td><td>{item.updatedAt}</td><td><Button onClick={() => onResume(item)} variant="secondary">Resume <Icon name="arrow" size={14} /></Button></td></tr>)}</tbody></table></div> : null}
    <div className="source-note"><Icon name="file" size={17} /><strong>V1 registry:</strong> Google Sheets when connected, with deterministic local records as the no-credential default.</div>
  </section>;
}

/** The canonical Canvas wins when the server has written one; research facts are the fallback only. */
function claimsForBlock(canvas: CanvasRecord | null, facts: EvidenceClaim[], title: string): EvidenceClaim[] {
  const key = canvas ? Object.keys(canvas).find((name) => name.toLowerCase() === title.toLowerCase()) : undefined;
  const claims = key && canvas ? canvas[key] ?? [] : facts.filter((fact) => fact.canvasBlock?.toLowerCase() === title.toLowerCase());
  return [...claims].sort((a, b) => Number(b.provenance === "client-stated") - Number(a.provenance === "client-stated")).slice(0, 3);
}

function Research({ canvas, company, onBack, onPrepare, research, script }: {
  canvas: CanvasRecord | null; company: string; onBack: () => void; onPrepare: () => void;
  research: ResearchPayload | null; script: { questions: DiscoveryQuestion[]; generic: boolean };
}) {
  const [tab, setTab] = useState<"canvas" | "flow" | "questions">("canvas");
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
    <div className="page-actions"><div><Button variant="quiet">Correct research</Button><Button variant="quiet">Add a source</Button><Button variant="quiet">Research a gap</Button></div><Button icon="arrow" onClick={onPrepare}>Prepare the client</Button></div>
    <div className="apollo"><Icon name="spark" size={15} />Apollo remains off. Paid enrichment appears only beside a named gap, with credit cost shown before approval.</div>
  </section>;
}

function Prepare({ briefSent, contact, onBack, onCall, onSend }: { briefSent: boolean; contact: string; onBack: () => void; onCall: () => void; onSend: () => void }) {
  return <section className="guided document-page"><Back onClick={onBack}>Research review</Back><PageHead eyebrow="Prepare · Client-facing brief" side={<Pill tone={briefSent ? "success" : "assumed"}>{briefSent ? "Send intent recorded" : "Draft · no send intent"}</Pill>} title="Put the right facts within reach.">Review exactly what the client will see. Internal research, questions, and constraint hypotheses stay private.</PageHead>
    <div className="document-layout"><aside><div><span>Recipient</span><strong>{contact}</strong></div><div><span>Delivery</span><strong>Email</strong></div><div><span>Duration</span><strong>60 minutes</strong></div><div><span>Video link</span><strong>Calendar meeting</strong></div><p><Icon name="lock" size={17} />Canvas v0, internal questions, bottleneck hypotheses, and suspected findings are excluded.</p></aside>
      <article className="document-preview"><header><span><Icon name="shield" size={16} />Tier 4 Audit</span><small>Pre-Call Readiness Brief</small></header><p className="document-kicker">For {contact} and the operating team</p><h2>Let’s understand how the business actually works.</h2>
        <section><h3>What this session is</h3><p>We’ll walk through a map of your business drafted from public information. You correct it. Expect specific questions about how work actually flows.</p></section>
        <section><h3>Who should attend</h3><p>The owner or decision-maker, plus the person who can speak to the daily operation of the main workflow. If one person prices, estimates, schedules, or approves everything, we’d love them in the room or available.</p></section>
        <section><h3>Have these within reach</h3><ul><li>Monthly volumes such as bids, orders, invoices, or leads</li><li>Typical end-to-end turnaround time</li><li>What is currently waiting in queue</li><li>Anything declined, missed, or turned away last quarter</li><li>Rough cost or revenue figures you would stand behind</li></ul><blockquote>Approximate is fine. No reports, no spreadsheets—we just don’t want you hunting for numbers live.</blockquote></section>
        <section><h3>Recording disclosure</h3><p>With your permission, we’ll record and transcribe the session so we quote you accurately rather than paraphrasing you.</p></section>
      </article></div>
    <div className="page-actions"><p><Icon name="info" size={16} />This records an approved send intent. It does not send email.</p>{briefSent ? <Button icon="arrow" onClick={onCall}>Enter client call</Button> : <Button icon="mail" onClick={onSend}>Approve send intent</Button>}</div>
  </section>;
}

function Call(props: {
  company: string; consent: "pending" | "recorded" | "not-recorded"; generic: boolean; index: number; total: number;
  question: DiscoveryQuestion; answer: string; notes: string; value: string;
  onConsent: (v: "pending" | "recorded" | "not-recorded") => void; onAnswer: (v: string) => void; onNotes: (v: string) => void;
  onValue: (v: string) => void; onPrevious: () => void; onNext: () => void; onExit: () => void;
}) {
  const question = props.question;
  const needsValue = question.expectedAnswerType === "number" || question.expectedAnswerType === "person";
  return <section className="call-mode"><header><div><i />Client call view · {props.company}</div><button onClick={props.onExit} type="button">Exit call view</button></header>
    {props.consent === "pending" ? <div className="consent-gate"><span><Icon name="mic" size={29} /></span><p className="eyebrow">Before the conversation begins</p><h1>Confirm recording consent.</h1><blockquote>“With your permission, we’ll record and transcribe this session so we quote you accurately rather than paraphrasing you.”</blockquote><p>Do not begin transcript capture until the disclosure and applicable consent requirements are satisfied.</p><Button icon="check" onClick={() => props.onConsent("recorded")}>Consent confirmed</Button><button className="call-link" onClick={() => props.onConsent("not-recorded")} type="button">Continue without recording</button></div> :
      <div className="call-content"><div className="call-progress"><span>Conversation {props.index + 1} of {props.total}</span><div><i style={{ width: `${((props.index + 1) / props.total) * 100}%` }} /></div><span>{sectionLabels[question.section] ?? question.section}</span></div>
        <div className="question"><p className="call-opening">Let’s make sure we understand how your business actually works.</p>{props.generic ? <p className="call-generic"><Icon name="info" size={14} />Generic fallback question — research produced no client-specific script.</p> : null}<h1>{question.question}</h1><p className="why">{question.whyItMatters}</p><div className="call-tags"><Pill tone={evidenceTone[question.evidenceStatus] ?? "neutral"}>{evidenceLabel[question.evidenceStatus] ?? question.evidenceStatus}</Pill>{question.required ? <Pill tone="missing">Required answer</Pill> : null}{question.canvasBlock ? <Pill tone="inferred">{question.canvasBlock}</Pill> : null}</div><div className="assumption"><span>What we found publicly</span><p>{question.publicAssumption}</p></div>
          <div className="answer-buttons">{["That’s right", "Correct it", "We don’t know yet"].map((choice) => <button className={props.answer === choice ? "selected" : ""} key={choice} onClick={() => props.onAnswer(choice)} type="button">{props.answer === choice ? <Icon name="check" size={17} /> : null}{choice}</button>)}{needsValue ? <label className="answer-value"><span>{question.expectedAnswerType === "number" ? "Stated number" : "Named person"}</span><input onChange={(e) => props.onValue(e.target.value)} placeholder={question.expectedAnswerType === "number" ? "e.g. 42 bids per month" : "e.g. Maya Chen, COO"} value={props.value} /></label> : null}</div>
          {question.followUps.length ? <ul className="follow-ups">{question.followUps.map((follow) => <li key={follow}>{follow}</li>)}</ul> : null}
          <label className="call-notes"><span>Conversation notes</span><textarea onChange={(e) => props.onNotes(e.target.value)} placeholder="Capture the client’s words, numbers, corrections, and named owners…" rows={5} value={props.notes} /></label>
        </div><div className="call-actions"><Button disabled={props.index === 0} onClick={props.onPrevious} variant="secondary"><Icon name="back" size={16} />Back</Button><Button icon="arrow" onClick={props.onNext}>{props.index === props.total - 1 ? "Finish guided call" : "Next question"}</Button></div><div className={`consent-status ${props.consent}`}><Icon name={props.consent === "recorded" ? "mic" : "shield"} size={14} />{props.consent === "recorded" ? "Recording consent confirmed" : "Continuing without recording"}</div>
      </div>}
  </section>;
}

function Transcript(props: {
  callNumber: 1 | 2; company: string; date: string; method: "fireflies" | "paste" | "upload"; text: string; fileName: string;
  fileError: string; fileReading: boolean; fileSummary: string; ready: boolean;
  onBack: () => void; onDate: (v: string) => void; onMethod: (v: "fireflies" | "paste" | "upload") => void;
  onText: (v: string) => void; onFile: (file: File | null) => void; onAnalyze: () => void;
}) {
  return <section className="guided narrow"><Back onClick={props.onBack}>Guided call</Back><PageHead eyebrow="Call · Transcript evidence" title="Let’s turn the conversation into evidence.">Use the full transcript—not only a generated summary—so every correction and finding can point back to the client’s words.</PageHead>
    <div className="meeting-anchor"><div><span>Client</span><strong>{props.company}</strong></div><label><span>Meeting date</span><input onChange={(e) => props.onDate(e.target.value)} type="date" value={props.date} /></label></div>
    <div className="method-cards">{[["fireflies", "mic", "Import from Fireflies", "Choose a connected meeting"], ["paste", "document", "Paste transcript text", "Keep the original wording"], ["upload", "upload", "Upload a transcript", "TXT, VTT, SRT, or DOCX"]].map(([method, icon, title, sub]) => <button className={props.method === method ? "selected" : ""} key={method} onClick={() => props.onMethod(method as typeof props.method)} type="button"><span><Icon name={icon as IconName} size={19} /></span><strong>{title}</strong><small>{sub}</small></button>)}</div>
    <div className="method-panel">{props.method === "fireflies" ? <div className="connector-empty"><Icon name="mic" size={24} /><div><strong>Fireflies transcript ID</strong><p>Enter a processed meeting ID after connecting Fireflies, or paste/upload now.</p><input onChange={(event) => props.onText(event.target.value)} placeholder="Transcript ID" value={props.text} /></div><Button onClick={() => props.onMethod("paste")} variant="secondary">Paste instead</Button></div> : null}
      {props.method === "paste" ? <label><span>Full transcript</span><textarea onChange={(e) => props.onText(e.target.value)} placeholder="[00:00] Speaker: …" rows={12} value={props.text} /></label> : null}
      {props.method === "upload" ? <><label className="upload large"><input accept=".txt,.vtt,.srt,.json,.doc,.docx" onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} type="file" /><span><Icon name="upload" size={23} /></span><span><strong>{props.fileName || "Choose transcript file"}</strong><small>{props.fileReading ? "Reading the file…" : props.fileSummary || "TXT, VTT, SRT, or JSON is read as text; DOCX is uploaded for server-side extraction. 2 MB limit."}</small></span></label>
        {props.fileReading ? <p className="upload-state" role="status"><Icon name="refresh" size={15} />Reading {props.fileName}…</p> : null}
        {props.fileError ? <p className="upload-state error" role="alert"><Icon name="info" size={15} />{props.fileError}</p> : null}
        {props.ready && !props.fileReading && !props.fileError ? <p className="upload-state ready"><Icon name="check" size={15} />{props.fileName} is parsed and ready to upload. The file content itself is sent — not just its name.</p> : null}</> : null}
    </div><div className="action-row"><p><Icon name="spark" size={17} />We’ll compare this with original research, surface contradictions, and keep gaps explicit.</p><Button disabled={(props.method === "paste" && !props.text.trim()) || (props.method === "upload" && (!props.ready || props.fileReading))} icon="arrow" onClick={props.onAnalyze}>Analyze transcript</Button></div>
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

function Synthesis({ onApprove, onBack, synthesis }: { onApprove: () => void; onBack: () => void; synthesis: TranscriptSynthesis | null }) {
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
    <div className="page-actions"><p><Icon name="lock" size={16} />Approval commits the reviewed Canvas and evidence diff. It does not approve the diagnosis.</p><Button disabled={!synthesis} icon="check" onClick={onApprove}>Approve Canvas commit</Button></div>
  </section>;
}

function Findings({ consent, onApprove, onBack, onConsent, owner, synthesis }: {
  consent: "pending" | "recorded" | "not-recorded"; onApprove: () => void; onBack: () => void;
  onConsent: (value: "pending" | "recorded" | "not-recorded") => void; owner: string; synthesis: TranscriptSynthesis | null;
}) {
  const [step, setStep] = useState(0);
  const candidate = synthesis?.constraintCandidate;
  const baseline = synthesis?.baselineStatus ?? "Missing";
  const steps = [["Reconcile the Canvas", "Confirm corrections, role ownership, and the actual flow."], ["Resolve the baseline", `${baseline} baseline. Confirm its source or assign instrumentation to the named owner.`], ["Test the constraint", candidate ? `Confirm or kill the ${candidate.constraintType} candidate in ${candidate.canvasBlock}.` : "No constraint signal was detected; collect stronger evidence before approval."], ["Reveal the prescription", "Constraint → prescription → metric formula → named owner."]];
  if (consent === "pending") return <section className="guided narrow"><Back onClick={onBack}>Synthesis review</Back><div className="consent-gate"><span><Icon name="mic" size={29} /></span><p className="eyebrow">Findings Call · before the conversation</p><h1>Confirm recording consent again.</h1><blockquote>“With your permission, we’ll record and transcribe this session so we quote you accurately rather than paraphrasing you.”</blockquote><p>Consent is recorded separately for Call 2.</p><Button icon="check" onClick={() => onConsent("recorded")}>Consent confirmed</Button><button className="call-link" onClick={() => onConsent("not-recorded")} type="button">Continue without recording</button></div></section>;
  return <section className="guided findings"><Back onClick={onBack}>Synthesis review</Back><PageHead eyebrow="Synthesize · Findings Call" title="Reconcile first. Reveal second.">The diagnosis stays provisional while the required baseline is missing. The call can continue, but numeric claims cannot.</PageHead>
    <SynthesisMode synthesis={synthesis} />
    <div className="findings-flow"><ol>{steps.map(([title], index) => <li className={index === step ? "active" : index < step ? "done" : ""} key={title}><button onClick={() => setStep(index)} type="button"><span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span>{title}</button></li>)}</ol>
      <article><p className="eyebrow">Part {step < 2 ? "A · Reconciliation" : "B · Reveal"}</p><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p>
        {step === 1 ? <div className="baseline"><Pill tone={baseline === "Confirmed" ? "known" : "missing"}>{baseline} baseline</Pill><strong>{baseline === "Confirmed" ? "Verify the coherent metric and source." : "No benchmark will be substituted."}</strong><span>{synthesis?.gaps.join("; ") || "Assign baseline instrumentation as the first Sprint task."}</span></div> : null}
        {step === 3 ? <div className="reveal">{[["Constraint", candidate ? `${candidate.constraintType} in ${candidate.canvasBlock}` : "No supported candidate"], ["Prescription", candidate?.prescription.description || "Collect stronger evidence before prescribing"], ["Projected delta", "(ending metric − starting metric) ÷ measurement period"], ["Human owner", owner || "Named owner required"]].map(([label, text], index) => <div key={label}>{index ? <Icon name="arrow" /> : null}<section><span>{label}</span><strong>{text}</strong></section></div>)}</div> : null}
        <div className="findings-actions"><Button disabled={step === 0} onClick={() => setStep(step - 1)} variant="secondary">Back</Button>{step < 3 ? <Button icon="arrow" onClick={() => setStep(step + 1)}>Continue</Button> : null}</div>
      </article></div>
    {step === 3 ? <div className="diagnosis"><div><Pill tone="assumed">Provisional diagnosis</Pill><h2>{candidate ? `${candidate.constraintType} in ${candidate.canvasBlock}` : "No supported diagnosis yet."}</h2><p>{baseline === "Confirmed" ? "Approve only after checking the evidence and owner." : "It stays provisional until the baseline lands; Sprint 1 begins with instrumentation."}</p></div><dl><div><dt>Evidence</dt><dd>{candidate?.evidence.length ?? 0} client line(s)</dd></div><div><dt>Canvas block</dt><dd>{candidate?.canvasBlock ?? "Missing"}</dd></div><div><dt>Named owner</dt><dd>{owner || "Required"}</dd></div><div><dt>First Sprint task</dt><dd>{baseline === "Confirmed" ? "Run the intervention" : "Instrument baseline"}</dd></div></dl><Button disabled={!candidate || !owner || consent !== "recorded"} icon="check" onClick={onApprove}>Approve provisional diagnosis</Button></div> : null}
  </section>;
}

function Deliver({ approved, generated, onActions, onBack, onGenerate, onOperate, onSync }: {
  approved: boolean; generated: string[]; onActions: () => void; onBack: () => void;
  onGenerate: () => void; onOperate: (screen: Screen) => void; onSync: () => void;
}) {
  return <section className="guided wide deliver"><Back onClick={onBack}>Findings</Back><PageHead eyebrow="Deliver · Approved release" side={<Pill tone={approved ? "success" : "assumed"}>{approved ? "Release approved" : "Provisional release"}</Pill>} title="Turn the finding into usable work.">Every deliverable carries the evidence label, named owner, scope, guardrails, and measurement plan forward.</PageHead>
    <div className="deliver-banner"><div><span>Primary deliverable</span><strong>One constraint → one prescription → one metric → one named human owner</strong></div><div><span>Evidence label</span><strong>Provisional · baseline instrumentation required</strong></div></div>
    <div className="deliver-grid">{deliverables.map(([title, text]) => { const done = generated.includes(title); return <article key={title}><div className="deliver-card-meta"><span className="deliver-icon"><Icon name="document" size={20} /></span><Pill tone={done ? "success" : "neutral"}>{done ? "Generated" : "Ready to draft"}</Pill></div><h3>{title}</h3><p>{text}</p><button onClick={onGenerate} type="button">{done ? "Regenerate suite" : "Generate suite"}<Icon name={done ? "refresh" : "arrow"} size={14} /></button></article>; })}</div>
    <div className="page-actions"><p><Icon name="lock" size={16} />The CRM action creates a reviewed write-back intent. It does not change Google Sheets automatically.</p><div><Button onClick={onActions} variant="secondary">Reviewed actions <Icon name="lock" size={14} /></Button><Button icon="arrow" onClick={onSync} variant="secondary">Prepare CRM write-back</Button></div></div>
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
