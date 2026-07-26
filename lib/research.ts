import {
  DISCOVERY_SECTIONS,
  canonicalCanvasBlock,
  type ConstraintHypothesis,
  type ConstraintType,
  type DiscoveryQuestion,
  type DiscoverySection,
  type EvidenceClaim,
  type ResearchSynthesis,
  type ValueFlowStep,
} from "./workflow";

const TYPE_SIGNALS: Array<{ type: ConstraintType; words: string[]; block: string }> = [
  { type: "capacity", words: ["capacity", "volume", "backlog", "scale", "busy"], block: "Key Resources" },
  { type: "latency", words: ["fast", "delivery", "turnaround", "schedule", "response"], block: "Key Activities" },
  { type: "quality", words: ["quality", "rework", "defect", "accuracy", "guarantee"], block: "Value Propositions" },
  { type: "knowledge", words: ["expert", "specialist", "experience", "custom", "consult"], block: "Key Resources" },
  { type: "policy", words: ["approval", "compliance", "policy", "certified", "regulated"], block: "Key Activities" },
];

type FlowStage = "intake" | "qualify" | "commit" | "schedule" | "deliver" | "close";

/** The generic spine of a value flow. Every step starts as a `gap` until public text supports it. */
const FLOW_STAGES: Array<{
  stage: FlowStage;
  name: string;
  description: string;
  input: string;
  output: string;
  confirmationQuestion: string;
}> = [
  {
    stage: "intake",
    name: "Demand enters",
    description: "A prospective customer makes contact and the request is captured somewhere.",
    input: "Prospect need",
    output: "Captured request",
    confirmationQuestion: "How does new work actually reach you, and who sees it first?",
  },
  {
    stage: "qualify",
    name: "Request qualified",
    description: "The request is assessed, scoped, or priced before anyone commits to it.",
    input: "Captured request",
    output: "Scoped or priced request",
    confirmationQuestion: "What has to happen before you can say yes to a request, and who does it?",
  },
  {
    stage: "commit",
    name: "Work committed",
    description: "The customer accepts and the work becomes an obligation on the business.",
    input: "Scoped or priced request",
    output: "Committed order",
    confirmationQuestion: "At what exact moment does a request become committed work?",
  },
  {
    stage: "schedule",
    name: "Work scheduled",
    description: "Committed work is sequenced against available people, slots, or materials.",
    input: "Committed order",
    output: "Scheduled job",
    confirmationQuestion: "How is committed work sequenced, and what decides which job goes first?",
  },
  {
    stage: "deliver",
    name: "Work delivered",
    description: "The committed work is produced or performed for the customer.",
    input: "Scheduled job",
    output: "Delivered work",
    confirmationQuestion: "Walk me through a typical job from the moment it starts to the moment it is done.",
  },
  {
    stage: "close",
    name: "Work closed",
    description: "The job is handed over, invoiced, and any follow-up is resolved.",
    input: "Delivered work",
    output: "Closed job and settled invoice",
    confirmationQuestion: "What still has to happen after delivery before you count the job as finished?",
  },
];

/** Keyword -> step vocabulary. A match renames the stage in the company's own words. */
const FLOW_SIGNALS: Array<{ stage: FlowStage; label: string; words: string[] }> = [
  { stage: "intake", label: "Quote or demo request", words: ["request a quote", "get a quote", "free quote", "request a demo", "book a demo", "free estimate"] },
  { stage: "intake", label: "Enquiry intake", words: ["contact us", "enquiry", "inquiry", "get in touch", "request a callback"] },
  { stage: "qualify", label: "Site visit or assessment", words: ["site visit", "site survey", "assessment", "inspection", "measure up"] },
  { stage: "qualify", label: "Estimating and quoting", words: ["estimate", "estimating", "quotation", "quote", "pricing"] },
  { stage: "qualify", label: "Discovery or consultation", words: ["discovery call", "consultation", "needs analysis", "scoping"] },
  { stage: "commit", label: "Proposal and contract", words: ["proposal", "contract", "agreement", "deposit", "statement of work"] },
  { stage: "commit", label: "Order placement", words: ["place an order", "ordering", "checkout", "subscription", "sign up"] },
  { stage: "schedule", label: "Scheduling and dispatch", words: ["schedule", "scheduling", "booking", "appointment", "dispatch"] },
  { stage: "schedule", label: "Production planning", words: ["lead time", "production", "fabrication", "manufacturing", "workshop"] },
  { stage: "deliver", label: "Installation", words: ["installation", "install", "fit-out", "commissioning"] },
  { stage: "deliver", label: "Shipping and delivery", words: ["shipping", "delivery", "despatch", "courier", "freight"] },
  { stage: "deliver", label: "Onboarding and implementation", words: ["onboarding", "implementation", "deployment", "migration", "training"] },
  { stage: "deliver", label: "Service visit or repair", words: ["service call", "repair", "callout", "maintenance visit"] },
  { stage: "close", label: "Warranty and aftercare", words: ["warranty", "guarantee", "aftercare", "handover"] },
  { stage: "close", label: "Support and renewals", words: ["support", "helpdesk", "renewal", "retainer", "service plan"] },
  { stage: "close", label: "Invoicing and payment", words: ["invoice", "invoicing", "billing", "payment terms"] },
];

const CONSTRAINT_PROMPTS: Record<ConstraintType, string> = {
  capacity: "When more work arrives than usual, which step is the first to back up — and what happens to the work it cannot absorb?",
  latency: "Between a customer's first contact and the finished job, where does the calendar time actually go, and which wait is the longest?",
  quality: "Which step produces the rework you see most often, where is it caught, and what does catching it late cost you?",
  knowledge: "Which step can only be done by one or two specific people, and what happens to the queue when they are unavailable?",
  policy: "Which approval, certification, or internal rule has to clear before work can move, and how long does it typically hold that work?",
};

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function mentions(haystack: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(haystack);
}

function buildValueFlow(evidenceText: string, sourceUrl: string, hasPage: boolean): ValueFlowStep[] {
  return FLOW_STAGES.map((stage, index): ValueFlowStep => {
    const signal = hasPage && sourceUrl
      ? FLOW_SIGNALS.find((entry) =>
        entry.stage === stage.stage && entry.words.some((word) => mentions(evidenceText, word)))
      : undefined;
    const matched = signal
      ? signal.words.filter((word) => mentions(evidenceText, word)).slice(0, 3)
      : [];
    const supported = Boolean(signal && matched.length);
    return {
      id: `flow_${index + 1}`,
      order: index + 1,
      name: signal && supported ? signal.label : stage.name,
      description: supported
        ? `${stage.description} Public site language uses "${matched.join('", "')}".`
        : `${stage.description} No public source describes this step; it is a proposal to confirm.`,
      input: stage.input,
      output: stage.output,
      actor: "Unconfirmed",
      system: "Unconfirmed",
      evidenceStatus: supported ? "public-research" : "gap",
      sourceUrls: supported ? [sourceUrl] : [],
      confidence: supported ? Math.min(0.5, 0.3 + 0.05 * matched.length) : 0.2,
      confirmationQuestion: signal && supported
        ? `Your site mentions ${signal.label.toLowerCase()}. Is that a distinct step, who owns it, and what does it hand to the next step?`
        : stage.confirmationQuestion,
    };
  });
}

type QuestionDraft = Omit<DiscoveryQuestion, "id">;
type HypothesisAnchor = { hypothesis: ConstraintHypothesis; matched: string[] };

function buildDiscoveryQuestions(input: {
  client: string;
  sourceUrl: string;
  hasPage: boolean;
  promise: string;
  gaps: string[];
  anchors: HypothesisAnchor[];
  flow: ValueFlowStep[];
}): DiscoveryQuestion[] {
  const { client, sourceUrl, hasPage, promise, gaps, anchors, flow } = input;
  const cited = hasPage && sourceUrl && promise ? [sourceUrl] : [];
  const publicStatus: DiscoveryQuestion["evidenceStatus"] = cited.length ? "public-research" : "gap";
  const publicAssumption = promise
    ? `Public positioning: ${promise}`
    : "The public site gave no usable positioning, so nothing was assumed.";
  const drafts: QuestionDraft[] = [];

  drafts.push({
    section: "demand",
    question: promise
      ? `Your site positions ${client} around "${promise}". Which customers actually bring you that work today, and which channel produces most of it in a normal month?`
      : `Which customers bring ${client} most of its work today, and which channel produces most of it in a normal month?`,
    whyItMatters: "The shape of demand decides which step gets loaded first; public positioning is not evidence of where work comes from.",
    publicAssumption,
    sourceUrls: cited,
    evidenceStatus: publicStatus,
    canvasBlock: "Channels",
    expectedAnswerType: "narrative",
    required: false,
    followUps: ["Which of those channels do you want more of?", "Which demand do you currently turn away?"],
  });

  drafts.push({
    section: "promise",
    question: promise
      ? `To deliver "${promise}" on every job, what has to go right operationally — and which of those things fails most often?`
      : `What do you promise a customer when they hire ${client}, and what has to go right for that promise to hold every time?`,
    whyItMatters: "The promise sets the standard the flow must hold; the step that breaks it is a constraint candidate.",
    publicAssumption,
    sourceUrls: cited,
    evidenceStatus: publicStatus,
    canvasBlock: "Value Propositions",
    expectedAnswerType: "narrative",
    required: false,
    followUps: ["When you miss that promise, where does it usually break?"],
  });

  const flowNames = flow.map((step) => step.name).join(" → ");
  const flowSources = [...new Set(flow.flatMap((step) => step.sourceUrls))];
  const firstGapStep = flow.find((step) => step.evidenceStatus === "gap");
  if (flowNames) {
    drafts.push({
      section: "flow",
      question: `We have a provisional flow for ${client}: ${flowNames}. Where is that wrong, what step is missing, and where does work sit waiting the longest?`,
      whyItMatters: "Every later number is measured against this flow, so a wrong flow produces a wrong constraint.",
      publicAssumption: flowSources.length
        ? "Some steps were named from public site language; the rest are proposals only."
        : "No step in this flow is supported by a public source.",
      sourceUrls: flowSources,
      evidenceStatus: flowSources.length ? "public-research" : "gap",
      canvasBlock: "Key Activities",
      expectedAnswerType: "narrative",
      required: true,
      followUps: ["Which step do you personally hear complaints about?"],
    });
  }
  if (firstGapStep) {
    drafts.push({
      section: "flow",
      question: `Nothing public tells us how "${firstGapStep.name}" works at ${client}. ${firstGapStep.confirmationQuestion}`,
      whyItMatters: "This step is unverified, so it cannot carry a finding until the client describes it.",
      publicAssumption: "None. This step is a proposal with no public support.",
      sourceUrls: [],
      evidenceStatus: "gap",
      flowStepId: firstGapStep.id,
      expectedAnswerType: "narrative",
      required: true,
      followUps: ["What system records that step today?"],
    });
  }

  anchors.slice(0, 3).forEach(({ hypothesis, matched }) => {
    const block = canonicalCanvasBlock(hypothesis.canvasBlock);
    const supported = hasPage && Boolean(sourceUrl) && matched.length > 0;
    drafts.push({
      section: "constraint",
      question: CONSTRAINT_PROMPTS[hypothesis.type],
      whyItMatters: `${hypothesis.evidenceHint} Confirmed if: ${hypothesis.confirmationCondition}`,
      publicAssumption: supported
        ? `Public site language uses ${matched.join(", ")}, which only raises this as a question.`
        : "No public source points at this constraint; it is an advisor question only.",
      sourceUrls: supported ? [sourceUrl] : [],
      evidenceStatus: supported ? "public-research" : "gap",
      ...(block ? { canvasBlock: block } : {}),
      hypothesisId: `${hypothesis.canvasBlock}|${hypothesis.type}`,
      expectedAnswerType: "narrative",
      required: true,
      followUps: [hypothesis.killCondition ? `What would show the opposite: ${hypothesis.killCondition}` : "What would prove this is not the limit?"],
    });
  });

  gaps.slice(0, 8).forEach((gap) => {
    drafts.push({
      section: "baseline",
      question: `Baseline needed — ${gap}: what is the actual figure today, over what period, and which system or person would you get it from?`,
      whyItMatters: "No throughput claim survives without this number; it is currently Missing.",
      publicAssumption: "No public source states this number.",
      sourceUrls: [],
      evidenceStatus: "gap",
      expectedAnswerType: "number",
      required: true,
      followUps: ["Is that measured or estimated?"],
    });
  });

  const firstStep = flow[0];
  const lastStep = flow[flow.length - 1];
  if (firstStep && lastStep) {
    drafts.push({
      section: "roles",
      question: `Name the person who owns "${firstStep.name}" and the person who owns "${lastStep.name}" today. Where does ownership change hands in between?`,
      whyItMatters: "The prescription needs one named human owner, and handoffs between owners are where work waits.",
      publicAssumption: "No public source names who runs any step.",
      sourceUrls: [],
      evidenceStatus: "gap",
      canvasBlock: "Key Resources",
      expectedAnswerType: "person",
      required: true,
      followUps: ["Who covers that step when they are away?"],
    });
  }

  const targetBlock = anchors[0] ? canonicalCanvasBlock(anchors[0].hypothesis.canvasBlock) : null;
  drafts.push({
    section: "feasibility",
    question: `If we changed one step in the next 30 days${targetBlock ? `, most likely inside ${targetBlock}` : ""}, what would stop that change from sticking — an approval, a system change, a customer commitment, or people's time?`,
    whyItMatters: "A prescription that cannot be executed in the sprint window is not a prescription.",
    publicAssumption: "None. Feasibility cannot be read from public sources.",
    sourceUrls: [],
    evidenceStatus: "gap",
    ...(targetBlock ? { canvasBlock: targetBlock } : {}),
    expectedAnswerType: "choice",
    required: false,
    followUps: ["Who has to sign off on that change?"],
  });

  // Coverage invariant: the call plan must never leave a discovery section unasked.
  DISCOVERY_SECTIONS.forEach((section: DiscoverySection) => {
    if (drafts.some((draft) => draft.section === section)) return;
    drafts.push({
      section,
      question: `What still has to be confirmed about ${section} at ${client} before we can name a constraint?`,
      whyItMatters: "This section has no anchored question yet, so it would otherwise go unasked on the call.",
      publicAssumption: "None.",
      sourceUrls: [],
      evidenceStatus: "gap",
      expectedAnswerType: "narrative",
      required: false,
      followUps: [],
    });
  });

  const counters = new Map<DiscoverySection, number>();
  return drafts.slice(0, 24).map((draft) => {
    const next = (counters.get(draft.section) ?? 0) + 1;
    counters.set(draft.section, next);
    return { ...draft, id: `q_${draft.section}_${next}` };
  });
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function compactText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function firstMatch(html: string, pattern: RegExp): string {
  return compactText(html.match(pattern)?.[1] ?? "");
}

export function normalizePublicUrlInput(input: string): string {
  const value = input.trim();
  if (!value) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function validatePublicUrl(input: string): URL {
  const url = new URL(normalizePublicUrlInput(input));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Research URL must be a public HTTP(S) URL without embedded credentials.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedNames = ["localhost", "localhost.localdomain", "metadata.google.internal"];
  if (
    blockedNames.includes(host) ||
    host.endsWith(".local") ||
    host.includes(":") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Research URL must resolve to a public website.");
  }
  return url;
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPublicIpv6(value: string): boolean {
  const address = value.toLowerCase();
  return !(
    address === "::" ||
    address === "::1" ||
    address.startsWith("::ffff:") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/.test(address) ||
    address.startsWith("ff") ||
    address.startsWith("2001:db8:") ||
    address.startsWith("2001:10:")
  );
}

export async function assertPublicDns(
  url: URL,
  resolver: typeof fetch = fetch,
): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (!isPublicIpv4(hostname)) throw new Error("Research hostname resolves to a non-public address.");
    return;
  }
  if (hostname.includes(":")) throw new Error("Literal IPv6 research targets are not allowed.");
  const endpoint = "https://cloudflare-dns.com/dns-query";
  const resolve = async (type: "A" | "AAAA") => {
    const response = await resolver(
      `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) throw new Error("DNS resolution failed.");
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    return body.Answer ?? [];
  };
  const [ipv4, ipv6] = await Promise.all([resolve("A"), resolve("AAAA")]);
  const addresses = [...ipv4, ...ipv6]
    .filter((answer) => answer.type === 1 || answer.type === 28)
    .map((answer) => answer.data?.trim() ?? "")
    .filter(Boolean);
  if (addresses.length === 0) throw new Error("Research hostname has no public DNS address.");
  if (addresses.some((address) =>
    address.includes(":") ? !isPublicIpv6(address) : !isPublicIpv4(address)
  )) {
    throw new Error("Research hostname resolves to a non-public or unsupported address.");
  }
}

export async function readLimitedText(response: Response, maxBytes = 500_000): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Public website exceeds the research size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Public website exceeds the research size limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

export function extractPublicPage(html: string): { title: string; description: string; text: string } {
  const sanitized = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  const title = firstMatch(sanitized, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    firstMatch(sanitized, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(sanitized, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const paragraphs = [...sanitized.matchAll(/<(?:h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|p|li)>/gi)]
    .map((match) => compactText(match[1]))
    .filter((value) => value.length >= 20);
  return {
    title: title || "Untitled public website",
    description: description || paragraphs[0] || "",
    text: paragraphs.join(" ").slice(0, 24_000),
  };
}

export function synthesizeResearch(
  sourceUrl: string,
  page: { title: string; description: string; text: string } | null,
  client: string,
  now = new Date().toISOString(),
): ResearchSynthesis {
  const evidenceText = `${page?.title ?? ""} ${page?.description ?? ""} ${page?.text ?? ""}`.toLowerCase();
  const ranked = TYPE_SIGNALS.map((signal) => {
    const matched = signal.words.filter((word) => evidenceText.includes(word));
    return { ...signal, matched, score: matched.length };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const facts: EvidenceClaim[] = [];
  if (page?.title) {
    facts.push({
      statement: `${client} public site title: ${page.title}`,
      provenance: "public-research",
      confidence: 0.95,
      sourceLabel: "Public website",
      sourceUrl,
    });
  }
  if (page?.description) {
    facts.push({
      statement: page.description.slice(0, 500),
      provenance: "public-research",
      confidence: 0.8,
      sourceLabel: "Public website description",
      sourceUrl,
      canvasBlock: "Value Propositions",
    });
  }

  const constraintHypotheses: ConstraintHypothesis[] = ranked.map((signal) => ({
    canvasBlock: signal.block,
    type: signal.type,
    evidenceHint:
      signal.score > 0
        ? `Public language contains ${signal.matched.join(", ")}.`
        : "No direct public evidence; this remains an advisor question, not a finding.",
    confirmationCondition: `Client evidence identifies a measurable ${signal.type} limit in the operating flow.`,
    killCondition: `Flow evidence shows ${signal.type} is not limiting throughput.`,
  }));

  const gaps = [
    "Monthly demand volume",
    "End-to-end cycle time",
    "Current queue size",
    "Error or rework rate",
    "Work declined, missed, or delayed",
    "Cost of delay or failure",
  ];
  const valueFlow = buildValueFlow(evidenceText, sourceUrl, Boolean(page));
  const discoveryQuestions = buildDiscoveryQuestions({
    client,
    sourceUrl,
    hasPage: Boolean(page),
    promise: clip(page?.description ?? page?.title ?? "", 160),
    gaps,
    anchors: ranked.map((signal, index) => ({
      hypothesis: constraintHypotheses[index],
      matched: signal.matched,
    })),
    flow: valueFlow,
  });

  return {
    sourceUrl,
    fetchedAt: now,
    fetchStatus: page ? "fetched" : "fallback",
    title: page?.title || `${client} research brief`,
    description:
      page?.description ||
      "The website could not be read. No company fact was inferred; confirm the operating model with the client.",
    facts,
    gaps,
    constraintHypotheses,
    valueFlow,
    discoveryQuestions,
    researchMode: "deterministic",
    providerStatus: "not-configured",
    sourceCount: facts.length ? 1 : 0,
  };
}

export async function researchPublicWebsite(
  sourceUrl: string,
  client: string,
  fetcher: typeof fetch = fetch,
  resolver: typeof fetch = fetch,
): Promise<ResearchSynthesis> {
  const initialUrl = validatePublicUrl(sourceUrl);
  let page: ReturnType<typeof extractPublicPage> | null = null;
  let finalUrl = initialUrl;
  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicDns(finalUrl, resolver);
      response = await fetcher(finalUrl, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5) throw new Error("Public website exceeded the redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Public website returned a redirect without a location.");
      finalUrl = validatePublicUrl(new URL(location, finalUrl).toString());
    }
    if (!response) throw new Error("Public website fetch did not return a response.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      throw new Error(`Public website returned ${response.status} ${contentType}`.trim());
    }
    const html = await readLimitedText(response);
    page = extractPublicPage(html);
  } catch {
    page = null;
  }
  return synthesizeResearch(finalUrl.toString(), page, client);
}
