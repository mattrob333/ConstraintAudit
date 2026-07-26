import type { Principal } from "./auth";
import { applyCanvasUpdates, buildCanvasFromResearch, mergeCanvas } from "./canvas";
import { fetchFirefliesTranscript } from "./fireflies";
import {
  generateAuditReport,
  generateCatalogEntry,
  generateDeveloperSpec,
  generateDiagnosisPackage,
  generateOutcomeReport,
  generateProposal,
  generateReadinessBrief,
  generateRoadmap,
  generateSprintPlan,
  renderMarkdownToHtml,
} from "./deliverables";
import { HttpError } from "./http";
import { resolveMetricDirection } from "./metric-direction";
import { createDocument, appendOrUpdateRow, sendEmail, type CellValue } from "./integrations";
import { researchPublicWebsite } from "./research";
import { enrichResearchWithOpenAI } from "./openai-research";
import {
  requireApprovedReadinessArtifact,
  requireConsentAttestation,
  requireDiagnosisApprovalEvidence,
} from "./guards";
import {
  addActivity,
  createArtifact,
  createIntent,
  createTranscript,
  getArtifact,
  getEngagement,
  getIntent,
  updateEngagement,
  updateIntentStatus,
} from "./store";
import { parseTranscriptText, synthesizeTranscript } from "./transcript";
import { synthesizeTranscriptWithOpenAI } from "./openai-transcript";
import { decodeTranscriptFile, type TranscriptFileInput } from "./transcript-files";
import {
  computeMetricDelta,
  makeId,
  WORKFLOW_STATES,
  type BaselineMetric,
  type CanvasBlock,
  type CatalogEntry,
  type ConsentAttestation,
  type Engagement,
  type EvidenceClaim,
  type OutcomeMeasurement,
  type SprintRecord,
  type WorkflowState,
} from "./workflow";

async function requireEngagement(id: string, ownerId: string): Promise<Engagement> {
  const engagement = await getEngagement(id, ownerId);
  if (!engagement) throw new Error("Engagement not found");
  return engagement;
}

async function advanceWithinEvidence(
  engagement: Engagement,
  target: WorkflowState,
  ownerId: string,
  patch: Parameters<typeof updateEngagement>[1] = {},
): Promise<Engagement> {
  let current = engagement;
  const targetIndex = WORKFLOW_STATES.indexOf(target);
  while (WORKFLOW_STATES.indexOf(current.workflowState) < targetIndex) {
    const next = WORKFLOW_STATES[WORKFLOW_STATES.indexOf(current.workflowState) + 1];
    current = await updateEngagement(current.id, {
      ...patch,
      workflowState: next,
      expectedVersion: current.version,
    }, ownerId);
  }
  return current;
}

export async function runResearch(id: string, principal: Principal, sourceUrl?: string) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const url = sourceUrl?.trim() || engagement.website;
  if (!url) throw new Error("website or sourceUrl is required");
  const websiteResearch = await researchPublicWebsite(url, engagement.client);
  const synthesis = await enrichResearchWithOpenAI(websiteResearch, engagement.client);
  const canonicalUrl = synthesis.sourceUrl;
  const sourceCandidates = [
    {
      label: "Public website research",
      url: synthesis.sourceUrl,
    },
    ...synthesis.facts.map((fact) => ({
      label: fact.sourceLabel,
      url: fact.sourceUrl,
    })),
  ].filter((source): source is { label: string; url: string } => Boolean(source.url));
  const knownSources = new Set((engagement.data.sourceRegister ?? []).map((source) => source.url));
  const addedSources = sourceCandidates
    .filter((source, index, all) =>
      !knownSources.has(source.url) &&
      all.findIndex((candidate) => candidate.url === source.url) === index
    )
    .map((source) => ({
      id: makeId("src"),
      label: source.label,
      url: source.url,
      provenance: "public-research" as const,
      capturedAt: synthesis.fetchedAt,
    }));
  // The canonical Canvas is written here so every downstream document reads one Canvas.
  // Existing client-stated claims survive the merge; research never overwrites them.
  const canvas = mergeCanvas(
    engagement.data.canvas as Record<CanvasBlock, EvidenceClaim[]> | undefined,
    buildCanvasFromResearch(synthesis),
  );
  const updated = await updateEngagement(id, {
    stage: "Research",
    status: "In progress",
    website: canonicalUrl,
    nextAction: "Review research gaps and draft the pre-call readiness brief",
    data: {
      research: synthesis,
      canvas,
      valueFlow: synthesis.valueFlow ?? engagement.data.valueFlow,
      sourceRegister: [...(engagement.data.sourceRegister ?? []), ...addedSources],
    },
    expectedVersion: engagement.version,
  }, principal.ownerId);
  const artifact = await createArtifact(updated, {
    kind: "company_brief",
    title: `${updated.client} — Public Research Brief`,
    status: "draft",
    provenance: "public-research",
    sourceUrl: canonicalUrl,
    content: `# ${synthesis.title}\n\n${synthesis.description}\n\n## Research mode\n\n${synthesis.researchMode === "openai-web-search" ? `OpenAI web search (${synthesis.providerModel}) with ${synthesis.sourceCount ?? 0} public source(s).` : "Deterministic website extraction."}\n\n## Known public facts\n\n${synthesis.facts.map((fact) => `- ${fact.statement}${fact.sourceUrl ? ` — ${fact.sourceUrl}` : ""}`).join("\n") || "- No public facts extracted."}\n\n## Proposed value flow (unconfirmed)\n\n${(synthesis.valueFlow ?? []).map((step) => `${step.order}. ${step.name} — ${step.actor || "actor unknown"} _(${step.evidenceStatus})_`).join("\n") || "- No flow proposed."}\n\n## Missing\n\n${synthesis.gaps.map((gap) => `- ${gap}`).join("\n")}`,
    data: synthesis,
  });
  await addActivity(updated, {
    activityType: "Research",
    summary: `Researched ${url}`,
    outcome: synthesis.researchMode === "openai-web-search"
      ? `OpenAI web search used; ${synthesis.sourceCount ?? 0} public sources retained`
      : synthesis.providerStatus === "failed"
        ? "OpenAI web search unavailable; deterministic website research retained"
        : synthesis.fetchStatus === "fetched"
          ? "Public page extracted; claims labeled public-research"
          : "Fetch unavailable; deterministic gap brief created",
    nextAction: updated.nextAction,
    sourceLink: canonicalUrl,
  });
  return { engagement: updated, research: synthesis, document: artifact };
}

export async function readinessBriefAction(
  id: string,
  principal: Principal,
  input: { action?: "generate" | "approve" | "send_intent"; videoLink?: string; duration?: string },
) {
  let engagement = await requireEngagement(id, principal.ownerId);
  if (input.action === "send_intent" && engagement.readinessBriefStatus !== "Approved") {
    throw new Error("Readiness brief must be Approved before creating a send intent.");
  }
  if (input.action === "send_intent") {
    const binding = engagement.data.approvedReadinessBrief;
    const bound = binding?.documentId ? await getArtifact(binding.documentId, principal.ownerId) : null;
    const artifact = requireApprovedReadinessArtifact(
      engagement,
      bound as Parameters<typeof requireApprovedReadinessArtifact>[1],
    );
    const intent = await createIntent(engagement, "readiness_brief_send", {
      documentId: artifact.id,
      approvedAt: binding?.approvedAt,
      approvedBy: binding?.approvedBy,
      to: engagement.email,
      subject: `${engagement.client} - Pre-Call Readiness`,
      body: artifact.content,
      requiresExplicitApproval: true,
    });
    await addActivity(engagement, {
      activityType: "Brief",
      summary: "Created reviewed send intent from immutable approved brief",
      outcome: "No email was sent; intent is pending explicit approval",
    });
    return { engagement, document: artifact, intent };
  }
  const content = generateReadinessBrief(engagement, input);
  const artifact = await createArtifact(engagement, {
    kind: "readiness_brief",
    title: `${engagement.client} - Pre-Call Readiness Brief`,
    status: input.action === "approve" ? "approved" : "draft",
    provenance: "advisor-note",
    content,
    data: { videoLink: input.videoLink ?? "", duration: input.duration ?? "60 minutes" },
  });
  engagement = await updateEngagement(id, {
    stage: "Prepare",
    status: input.action === "approve" ? "Approved" : "Needs review",
    readinessBriefStatus: input.action === "approve" ? "Approved" : "Drafted",
    nextAction: input.action === "approve" ? "Create a reviewed send intent" : "Review and approve the readiness brief",
    data: input.action === "approve" ? {
      approvedReadinessBrief: {
        documentId: String(artifact.id),
        approvedAt: String(artifact.created_at),
        approvedBy: engagement.advisor,
      },
    } : {},
    expectedVersion: engagement.version,
  }, principal.ownerId);
  await addActivity(engagement, {
    activityType: "Brief",
    summary: input.action === "approve" ? "Approved readiness brief" : "Generated readiness brief draft",
    outcome: "Brief remains internal until a separate send intent is approved",
  });
  return { engagement, document: artifact };
}

export async function processTranscript(
  id: string,
  principal: Principal,
  input: {
    callNumber: 1 | 2;
    rawText?: string;
    file?: TranscriptFileInput;
    source?: "paste" | "fireflies" | "upload";
    sourceId?: string;
    sourceUrl?: string;
    title?: string;
    humanOwner?: { name: string; role: string };
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
    consentAttestation?: ConsentAttestation;
    sourceData?: unknown;
  },
) {
  let engagement = await requireEngagement(id, principal.ownerId);
  if (input.callNumber !== 1 && input.callNumber !== 2) throw new Error("callNumber must be 1 or 2");
  // An uploaded file is decoded to real transcript text here. The old build submitted
  // only the filename, which silently produced a transcript with no client evidence.
  let rawText = input.rawText ?? "";
  let fileWarnings: string[] = [];
  let fileFormat = "";
  if (input.file) {
    if (rawText.trim()) throw new Error("Provide either rawText or file, not both.");
    const decoded = await decodeTranscriptFile(input.file);
    rawText = decoded.text;
    fileWarnings = decoded.warnings;
    fileFormat = decoded.format;
  }
  if (!rawText.trim()) throw new Error("rawText is required");
  const consentKey = input.callNumber === 1 ? "call1" : "call2";
  const consent = requireConsentAttestation(
    input.consentAttestation ?? engagement.data.recordingConsent?.[consentKey],
  );
  if (input.consentAttestation) {
    engagement = await updateEngagement(id, {
      data: {
        recordingConsent: {
          ...(engagement.data.recordingConsent ?? {}),
          [consentKey]: consent,
        },
      },
      expectedVersion: engagement.version,
    }, principal.ownerId);
  }
  const valueFlow = engagement.data.valueFlow ?? engagement.data.research?.valueFlow;
  const deterministic = synthesizeTranscript(rawText, {
    client: engagement.client,
    callNumber: input.callNumber,
    transcriptUrl: input.sourceUrl,
    humanOwner: input.humanOwner,
    speakerRoles: input.speakerRoles,
    research: engagement.data.research,
    canvas: engagement.data.canvas,
    valueFlow,
    questions: engagement.data.research?.discoveryQuestions,
    priorSynthesis: engagement.data.transcriptSynthesis,
  });
  // The model reads the call with the full business context, then every claim it makes is
  // checked back against the real transcript lines. Anything it cannot ground is discarded
  // and recorded. With no key, or on any failure, the deterministic reading stands.
  const synthesis = await synthesizeTranscriptWithOpenAI(deterministic, {
    lines: parseTranscriptText(rawText, input.speakerRoles),
    client: engagement.client,
    callNumber: input.callNumber,
    transcriptUrl: input.sourceUrl,
    research: engagement.data.research,
    canvas: engagement.data.canvas,
    valueFlow,
    questions: engagement.data.research?.discoveryQuestions,
    priorSynthesis: engagement.data.transcriptSynthesis,
  });
  // Client words correct the canonical Canvas; research claims are superseded, never deleted.
  const canvas = applyCanvasUpdates(
    engagement.data.canvas as Record<CanvasBlock, EvidenceClaim[]> | undefined,
    synthesis.canvasUpdates ?? [],
  );
  const transcript = await createTranscript(engagement, {
    callNumber: input.callNumber,
    source: input.source ?? (input.file ? "upload" : "paste"),
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    title: input.title || `Call ${input.callNumber} transcript`,
    rawText,
    data: { synthesis, source: input.sourceData ?? null, consent, fileFormat, fileWarnings },
  });
  const target =
    input.callNumber === 1
      ? "TRANSCRIPT_1_SYNTHESIZED"
      : WORKFLOW_STATES.indexOf(engagement.workflowState) >= WORKFLOW_STATES.indexOf("CANVAS_COMMIT_APPROVED")
        ? "TRANSCRIPT_2_RECONCILED"
        : engagement.workflowState;
  const sharedData = {
    transcriptSynthesis: [...(engagement.data.transcriptSynthesis ?? []), synthesis],
    baseline: synthesis.constraintCandidate?.baselineMetric,
    finding: synthesis.constraintCandidate ?? undefined,
    recordingConsent: engagement.data.recordingConsent,
    canvas,
    roles: synthesis.roles?.length ? synthesis.roles : engagement.data.roles,
  };
  if (WORKFLOW_STATES.indexOf(target) > WORKFLOW_STATES.indexOf(engagement.workflowState)) {
    engagement = await advanceWithinEvidence(engagement, target, principal.ownerId, {
      baselineStatus: synthesis.baselineStatus,
      findingStatus: synthesis.constraintCandidate?.findingStatus ?? "none",
      nextAction:
        input.callNumber === 1
          ? "Review synthesis and explicitly approve the Canvas commit"
          : "Review reconciliation and explicitly approve the diagnosis",
      status: "Needs review",
      data: sharedData,
    });
  } else {
    engagement = await updateEngagement(id, {
      baselineStatus: synthesis.baselineStatus,
      findingStatus: synthesis.constraintCandidate?.findingStatus ?? "none",
      nextAction: "Review imported evidence; required approval checkpoints were not advanced automatically",
      status: "Needs review",
      data: sharedData,
      expectedVersion: engagement.version,
    }, principal.ownerId);
  }
  const artifact = await createArtifact(engagement, {
    kind: input.callNumber === 1 ? "synthesis_diff" : "transcript_reconciliation",
    title: `${engagement.client} — Call ${input.callNumber} Synthesis`,
    status: "needs_review",
    provenance: "advisor-note",
    sourceUrl: input.sourceUrl,
    content: `# Call ${input.callNumber} Synthesis\n\n## Evidence quotes\n\n${synthesis.quotes.map((quote) => `- [${quote.timestamp}] ${quote.speaker}: "${quote.text}"`).join("\n") || "- No client-stated constraint evidence detected."}\n\n## Contradictions with public research\n\n${(synthesis.contradictions ?? []).map((item) => `- ${item.resolution}: research said "${item.researchStatement}"; client said "${item.clientQuote}" (${item.speaker}, ${item.timestamp})`).join("\n") || "- None detected."}\n\n## Decisions\n\n${(synthesis.decisions ?? []).map((item) => `- ${item.decision} — ${item.owner || item.speaker}`).join("\n") || "- None recorded."}\n\n## Baseline\n\n${synthesis.baselineStatus}\n\n## Gaps\n\n${synthesis.gaps.map((gap) => `- ${gap}`).join("\n") || "- None detected."}`,
    data: synthesis,
  });
  await addActivity(engagement, {
    activityType: "Transcript",
    summary: `Processed Call ${input.callNumber} ${input.source ?? (input.file ? "upload" : "paste")} transcript`,
    outcome: `${synthesis.lineCount} lines; baseline ${synthesis.baselineStatus}; finding ${synthesis.constraintCandidate?.findingStatus ?? "none"}`,
    sourceLink: input.sourceUrl,
  });
  return { engagement, transcript, synthesis, document: artifact, fileWarnings };
}

export async function importFireflies(
  id: string,
  principal: Principal,
  input: {
    transcriptId: string;
    callNumber: 1 | 2;
    consentAttestation?: ConsentAttestation;
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
  },
) {
  const fetched = await fetchFirefliesTranscript(input.transcriptId);
  return processTranscript(id, principal, {
    callNumber: input.callNumber,
    rawText: fetched.rawText,
    source: "fireflies",
    sourceId: fetched.id,
    sourceUrl: fetched.transcriptUrl,
    title: fetched.title,
    consentAttestation: input.consentAttestation,
    speakerRoles: input.speakerRoles,
    sourceData: {
      auditRawText: fetched.auditRawText,
      retrievedAt: fetched.retrievedAt,
      speakerConfidence: "unknown",
    },
  });
}

export async function updateFinding(
  id: string,
  principal: Principal,
  input: {
    humanOwner?: { name: string; role: string };
    baseline?: { name: string; value: string; unit: string; period: string; source: string };
    action?: "save" | "approve_diagnosis";
  },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const finding = engagement.data.finding;
  if (!finding) throw new Error("Synthesize a transcript before updating the finding.");
  if (
    input.action === "approve_diagnosis" &&
    WORKFLOW_STATES.indexOf(engagement.workflowState) !== WORKFLOW_STATES.indexOf("TRANSCRIPT_2_RECONCILED")
  ) {
    throw new Error("Diagnosis approval requires Transcript 2 reconciliation.");
  }
  const baseline = input.baseline ?? finding.baselineMetric;
  const baselineConfirmed = Boolean(
    baseline.name?.trim() && baseline.value?.trim() && baseline.unit?.trim() &&
    baseline.period?.trim() && baseline.source?.trim(),
  );
  const nextFinding = {
    ...finding,
    baselineMetric: baseline,
    humanOwner: input.humanOwner ?? finding.humanOwner,
    findingStatus: baselineConfirmed ? "client-verified" as const : "provisional" as const,
    baselineInstrumentation: {
      ...finding.baselineInstrumentation,
      required: !baselineConfirmed,
    },
  };
  if (input.action === "approve_diagnosis") {
    requireDiagnosisApprovalEvidence(nextFinding);
  }
  let updated = await updateEngagement(id, {
    baselineStatus: baselineConfirmed ? "Confirmed" : baseline.value ? "Partial" : "Missing",
    findingStatus: nextFinding.findingStatus,
    data: { baseline, finding: nextFinding },
    status: "Needs review",
    nextAction: input.action === "approve_diagnosis" ? "Approve diagnosis release" : "Review finding",
    expectedVersion: engagement.version,
  }, principal.ownerId);
  if (input.action === "approve_diagnosis") {
    updated = await updateEngagement(id, {
      workflowState: "DIAGNOSIS_APPROVED",
      findingStatus: baselineConfirmed ? "approved" : "provisional",
      status: "Approved",
      nextAction: baselineConfirmed
        ? "Generate the approved deliverable suite"
        : "Begin Sprint 1 with baseline instrumentation; numeric claims remain blocked",
      expectedVersion: updated.version,
    }, principal.ownerId);
  }
  await addActivity(updated, {
    activityType: "Synthesis",
    summary: input.action === "approve_diagnosis" ? "Approved diagnosis checkpoint" : "Updated constraint finding",
    outcome: `Finding remains ${updated.findingStatus}; baseline ${updated.baselineStatus}`,
  });
  return { engagement: updated, finding: nextFinding };
}

export async function generateDeliverables(id: string, principal: Principal) {
  const engagement = await requireEngagement(id, principal.ownerId);
  if (WORKFLOW_STATES.indexOf(engagement.workflowState) < WORKFLOW_STATES.indexOf("DIAGNOSIS_APPROVED")) {
    throw new Error("Deliverables are blocked until the diagnosis approval checkpoint.");
  }
  const finding = engagement.data.finding;
  if (!finding) throw new Error("Constraint finding is required");
  const definitions = [
    ["diagnosis_package", "Diagnosis Package", generateDiagnosisPackage(engagement, finding)],
    ["audit_report", "Audit Report", generateAuditReport(engagement, finding)],
    ["proposal", "Fixed-Sprint Proposal", generateProposal(engagement, finding)],
    ["implementation_roadmap", "Implementation Roadmap", generateRoadmap(engagement, finding)],
    ["developer_spec", "Third-Party Developer Specification", generateDeveloperSpec(engagement, finding)],
  ] as const;
  const documents = [];
  for (const [kind, label, content] of definitions) {
    documents.push(await createArtifact(engagement, {
      kind,
      title: `${engagement.client} — ${label}`,
      status: engagement.findingStatus === "approved" ? "approved" : "provisional",
      provenance: "advisor-note",
      content,
      data: { findingStatus: engagement.findingStatus },
    }));
  }
  await addActivity(engagement, {
    activityType: "Deliverables",
    summary: "Generated deliverable suite",
    outcome: `${documents.length} internal documents generated; no external write performed`,
  });
  return { engagement, documents };
}

export async function createCrmWriteBackIntent(id: string, principal: Principal) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const intent = await createIntent(engagement, "crm_write_back", {
    workbook: "Tier 4 Engagement CRM",
    sheet: "Engagements",
    matchKey: "Engagement ID",
    row: {
      "Engagement ID": engagement.id,
      Client: engagement.client,
      Website: engagement.website,
      "Primary Contact": engagement.primaryContact,
      Email: engagement.email,
      Advisor: engagement.advisor,
      Stage: engagement.stage,
      Status: engagement.status,
      "Next Action": engagement.nextAction,
      "Due Date": engagement.dueDate,
      "Last Contact": engagement.lastContact,
      "Call 1": engagement.call1At,
      "Call 2": engagement.call2At,
      "Readiness Brief status": engagement.readinessBriefStatus,
      "Baseline status": engagement.baselineStatus,
      "Engagement Folder": engagement.engagementFolder,
      Notes: engagement.notes,
    },
    requiresExplicitApproval: true,
  });
  await addActivity(engagement, {
    activityType: "CRM",
    summary: "Created Google Sheets CRM write-back intent",
    outcome: "No external write performed; intent is pending explicit approval",
  });
  return { engagement, intent };
}

export async function createDocumentPublishIntent(
  id: string,
  principal: Principal,
  input: { documentId: string },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const artifact = await getArtifact(input.documentId, principal.ownerId);
  if (!artifact || String(artifact.engagement_id) !== engagement.id) {
    throw new Error("Document not found");
  }
  if (!["approved", "provisional"].includes(String(artifact.status))) {
    throw new Error("Only an approved or provisional artifact may be proposed for publication.");
  }
  const intent = await createIntent(engagement, "document_publish", {
    documentId: String(artifact.id),
    title: String(artifact.title),
    status: String(artifact.status),
    markdown: String(artifact.content),
    folderId: engagement.engagementFolder || undefined,
    requiresExplicitApproval: true,
  });
  await addActivity(engagement, {
    activityType: "Deliverables",
    summary: `Created publication intent for ${artifact.title}`,
    outcome: "No document was published; intent is pending explicit approval",
  });
  return { engagement, intent };
}

/**
 * Approve, reject, or execute a reviewed external action. Execution is the only place in
 * the app that writes outside this system, and it is reachable only from an already
 * approved intent — approval and execution are deliberately two separate decisions.
 */
export async function reviewIntent(
  intentId: string,
  principal: Principal,
  action: "approve" | "reject" | "execute",
) {
  const intent = await getIntent(intentId, principal.ownerId);
  if (!intent) throw new Error("Intent not found");
  const status = String(intent.status);
  const type = String(intent.type);
  const payload = (intent.payload ?? {}) as Record<string, unknown>;
  const engagement = await requireEngagement(String(intent.engagement_id), principal.ownerId);

  if (action === "approve") {
    if (status !== "pending_review") throw new Error(`Only a pending intent may be approved (current: ${status}).`);
    const updated = await updateIntentStatus(intentId, principal.ownerId, "approved", {
      approvedBy: principal.email,
    });
    await addActivity(engagement, {
      activityType: "Approval",
      summary: `Approved ${type} intent`,
      outcome: "Approved for execution; no external write has happened yet",
    });
    return { intent: updated };
  }

  if (action === "reject") {
    if (!["pending_review", "approved"].includes(status)) {
      throw new Error(`Only a pending or approved intent may be rejected (current: ${status}).`);
    }
    const updated = await updateIntentStatus(intentId, principal.ownerId, "rejected", {
      rejectedBy: principal.email,
    });
    await addActivity(engagement, {
      activityType: "Approval",
      summary: `Rejected ${type} intent`,
      outcome: "No external write performed",
    });
    return { intent: updated };
  }

  if (status !== "approved") {
    throw new Error(`Execution requires an approved intent (current: ${status}).`);
  }

  const result = await executeIntent(type, intentId, payload);
  // "not-configured" means nothing was attempted, so the approval survives and the same
  // intent can be executed again once the credential exists. A genuine failure stays
  // failed and needs a fresh approval, because we cannot know whether the write landed.
  const nextStatus = result.ok
    ? "executed"
    : result.status === "not-configured" ? "approved" : "failed";
  const updated = await updateIntentStatus(intentId, principal.ownerId, nextStatus, result);
  await addActivity(engagement, {
    activityType: "Integration",
    summary: result.status === "not-configured"
      ? `Could not execute ${type} intent`
      : `Executed ${type} intent`,
    outcome: `${result.provider}: ${result.status} — ${result.detail}`,
    sourceLink: result.externalUrl ?? null,
  });
  return { intent: updated, result };
}

async function executeIntent(
  type: string,
  intentId: string,
  payload: Record<string, unknown>,
) {
  const str = (key: string): string => typeof payload[key] === "string" ? payload[key] as string : "";
  if (type === "readiness_brief_send") {
    return sendEmail({
      to: str("to"),
      subject: str("subject"),
      markdownBody: str("body"),
      idempotencyKey: intentId,
    });
  }
  if (type === "crm_write_back") {
    return appendOrUpdateRow({
      sheet: str("sheet") || "Engagements",
      matchKey: str("matchKey") || "Engagement ID",
      row: (payload.row ?? {}) as Record<string, CellValue>,
      idempotencyKey: intentId,
    });
  }
  if (type === "document_publish") {
    const title = str("title");
    const markdown = str("markdown");
    // Hand Drive real HTML so headings, lists, and tables survive the conversion.
    return createDocument({
      title,
      markdown,
      html: renderMarkdownToHtml(markdown, title),
      folderId: str("folderId") || undefined,
    });
  }
  throw new HttpError(400, `Unsupported intent type: ${type}`);
}

/**
 * Activate the fixed sprint that follows an approved diagnosis. A missing baseline does
 * not block the sprint — instrumenting it becomes the first task, which is the documented
 * behavior for a provisional finding.
 */
export async function activateSprint(
  id: string,
  principal: Principal,
  input: { action?: "activate" | "update_task"; taskId?: string; status?: "todo" | "in_progress" | "done" },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const finding = engagement.data.finding;
  if (!finding) throw new Error("An approved constraint finding is required before sprint activation.");

  if (input.action === "update_task") {
    const sprint = engagement.data.sprint;
    if (!sprint) throw new Error("No sprint is active for this engagement.");
    if (!input.taskId || !input.status) throw new Error("taskId and status are required.");
    const tasks = sprint.tasks.map((task) =>
      task.id === input.taskId ? { ...task, status: input.status ?? task.status } : task,
    );
    if (!tasks.some((task) => task.id === input.taskId)) throw new Error("Sprint task not found");
    const updated = await updateEngagement(id, {
      data: { sprint: { ...sprint, tasks } },
      expectedVersion: engagement.version,
    }, principal.ownerId);
    return { engagement: updated, sprint: updated.data.sprint };
  }

  if (WORKFLOW_STATES.indexOf(engagement.workflowState) < WORKFLOW_STATES.indexOf("DIAGNOSIS_APPROVED")) {
    throw new Error("Sprint activation is blocked until the diagnosis approval checkpoint.");
  }
  if (engagement.data.sprint) throw new Error("A sprint is already active for this engagement.");
  if (!finding.humanOwner.name.trim()) {
    throw new Error("Sprint activation requires a named human owner.");
  }
  const now = new Date().toISOString();
  const baselineConfirmed = engagement.baselineStatus === "Confirmed";
  const sprint: SprintRecord = {
    sprintId: makeId("spr"),
    constraintId: finding.constraintId,
    constraintType: finding.constraintType,
    activatedAt: now,
    activatedBy: principal.email,
    prescription: finding.prescription.description,
    humanOwner: finding.humanOwner,
    startingMetric: finding.baselineMetric,
    measurementClockStartedAt: baselineConfirmed ? now : "",
    tasks: [
      ...(baselineConfirmed ? [] : [{
        id: makeId("tsk"),
        task: finding.baselineInstrumentation.firstSprintTask ||
          "Capture the starting metric in the live workflow before intervention.",
        owner: finding.humanOwner.name,
        status: "todo" as const,
      }]),
      {
        id: makeId("tsk"),
        task: finding.prescription.description,
        owner: finding.humanOwner.name,
        status: "todo" as const,
      },
      {
        id: makeId("tsk"),
        task: `Record where the bottleneck moves after the intervention. Kill condition: ${finding.killCondition}`,
        owner: finding.humanOwner.name,
        status: "todo" as const,
      },
    ],
  };
  const updated = await advanceWithinEvidence(engagement, "SPRINT_ACTIVE", principal.ownerId, {
    status: "In progress",
    nextAction: baselineConfirmed
      ? "Run the sprint, then measure the ending metric"
      : "Instrument the baseline first; numeric claims stay blocked until it is confirmed",
    data: { sprint },
  });
  const document = await createArtifact(updated, {
    kind: "sprint_plan",
    title: `${updated.client} — Sprint 1 Plan`,
    status: "approved",
    provenance: "advisor-note",
    content: generateSprintPlan(updated, finding, sprint),
    data: sprint,
  });
  await addActivity(updated, {
    activityType: "Sprint",
    summary: "Activated Sprint 1",
    outcome: baselineConfirmed
      ? "Measurement clock started against the confirmed baseline"
      : "Baseline instrumentation is the first task; measurement clock not started",
  });
  return { engagement: updated, sprint, document };
}

/**
 * Record the before/after result. A delta is computed only from two client-confirmed
 * readings in the same unit; anything else records an explicit blocked reason instead
 * of an invented number.
 */
export async function measureOutcome(
  id: string,
  principal: Principal,
  input: {
    endingMetric: BaselineMetric;
    /** Which way is better for this metric. Without it no improvement is claimed. */
    improvedWhen?: "higher" | "lower";
    constraintMoved?: boolean;
    nextConstraintObserved?: string;
    evidence?: Array<{ quote: string; source: string }>;
  },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const sprint = engagement.data.sprint;
  if (!sprint) throw new Error("Activate a sprint before measuring an outcome.");
  const finding = engagement.data.finding;
  if (!finding) throw new Error("A constraint finding is required.");
  const ending = input.endingMetric;
  if (!ending?.name?.trim() || !ending.value?.trim() || !ending.unit?.trim() ||
      !ending.period?.trim() || !ending.source?.trim()) {
    throw new Error("The ending metric requires name, value, unit, period, and source.");
  }
  const starting = engagement.data.baseline ?? sprint.startingMetric;
  // Which way is better is inferred from the metric itself, but the advisor's own
  // declaration always wins and the basis is recorded so the reasoning is visible.
  const directionInference = await resolveMetricDirection(ending, {
    constraintType: finding.constraintType,
    advisorDeclared: input.improvedWhen,
  });
  const { delta, blockedReason: deltaBlockedReason } = computeMetricDelta(starting, ending, {
    baselineConfirmed: engagement.baselineStatus === "Confirmed",
    improvedWhen: directionInference.improvedWhen ?? undefined,
  });

  const outcome: OutcomeMeasurement = {
    measuredAt: new Date().toISOString(),
    measuredBy: principal.email,
    startingMetric: starting ?? { name: "", value: "", unit: "", period: "", source: "Missing" },
    endingMetric: ending,
    delta,
    deltaBlockedReason,
    improvedWhen: directionInference.improvedWhen ?? undefined,
    directionInference,
    constraintMoved: input.constraintMoved ?? false,
    nextConstraintObserved: input.nextConstraintObserved?.trim() ?? "",
    evidence: (input.evidence ?? []).filter((item) => item.quote?.trim() && item.source?.trim()),
  };
  const updated = await advanceWithinEvidence(engagement, "OUTCOME_MEASURED", principal.ownerId, {
    status: "Needs review",
    nextAction: outcome.constraintMoved
      ? "Write the reusable pattern to the catalog, then diagnose the next constraint"
      : "Write the reusable pattern to the catalog",
    data: { outcome },
  });
  const document = await createArtifact(updated, {
    kind: "outcome_report",
    title: `${updated.client} — Measured Outcome`,
    status: "approved",
    provenance: "advisor-note",
    content: generateOutcomeReport(updated, finding, outcome),
    data: outcome,
  });
  await addActivity(updated, {
    activityType: "Measurement",
    summary: "Recorded the measured outcome",
    outcome: delta
      ? `Delta ${delta.absolute} (${delta.direction}${delta.interpretation === "not-interpreted" ? "; not interpreted" : `; ${delta.interpretation}`})`
      : `No delta claimed: ${deltaBlockedReason}`,
  });
  return { engagement: updated, outcome, document };
}

/**
 * Correct which direction counts as an improvement after the outcome was recorded.
 * The measured numbers are immutable; only the reading of them changes, and the
 * corrected reading is marked as the advisor's own so no inference can be mistaken
 * for a human decision.
 */
export async function correctOutcomeDirection(
  id: string,
  principal: Principal,
  input: { improvedWhen: "higher" | "lower" },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const outcome = engagement.data.outcome;
  const finding = engagement.data.finding;
  if (!outcome) throw new Error("No measured outcome exists for this engagement.");
  if (!finding) throw new Error("A constraint finding is required.");
  if (input.improvedWhen !== "higher" && input.improvedWhen !== "lower") {
    throw new Error("improvedWhen must be higher or lower.");
  }
  const { delta, blockedReason } = computeMetricDelta(outcome.startingMetric, outcome.endingMetric, {
    baselineConfirmed: engagement.baselineStatus === "Confirmed",
    improvedWhen: input.improvedWhen,
  });
  const corrected: OutcomeMeasurement = {
    ...outcome,
    delta,
    deltaBlockedReason: blockedReason,
    improvedWhen: input.improvedWhen,
    directionInference: {
      improvedWhen: input.improvedWhen,
      source: "advisor",
      basis: `${principal.email} declared that a ${input.improvedWhen} number is the improvement for ${outcome.endingMetric.name || "this metric"}.`,
      confidence: 1,
    },
  };
  const updated = await updateEngagement(id, {
    data: { outcome: corrected },
    expectedVersion: engagement.version,
  }, principal.ownerId);
  const document = await createArtifact(updated, {
    kind: "outcome_report",
    title: `${updated.client} — Measured Outcome`,
    status: "approved",
    provenance: "advisor-note",
    content: generateOutcomeReport(updated, finding, corrected),
    data: corrected,
  });
  await addActivity(updated, {
    activityType: "Measurement",
    summary: "Corrected the improvement direction",
    outcome: delta
      ? `Advisor set ${input.improvedWhen}-is-better; reading is now ${delta.interpretation}`
      : `Advisor set ${input.improvedWhen}-is-better; no delta claimed: ${blockedReason}`,
  });
  return { engagement: updated, outcome: corrected, document };
}

/** Write the measured pattern back to the reusable catalog. Requires a real measurement. */
export async function writeCatalogEntry(
  id: string,
  principal: Principal,
  input: { industryContext?: string; reusableFor?: string },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const finding = engagement.data.finding;
  const outcome = engagement.data.outcome;
  if (!finding) throw new Error("A constraint finding is required.");
  if (!outcome) throw new Error("Catalog write-back requires a measured outcome.");
  const entry: CatalogEntry = {
    entryId: makeId("cat"),
    constraintType: finding.constraintType,
    canvasBlock: finding.canvasBlock,
    pattern: `${finding.constraintType} constraint in ${finding.canvasBlock}`,
    prescription: finding.prescription.description,
    measuredResult: outcome.delta
      ? `${outcome.delta.absolute} (${outcome.delta.direction}${outcome.delta.interpretation === "not-interpreted" ? "" : `, ${outcome.delta.interpretation}`}) on ${outcome.endingMetric.name}`
      : `Not claimed — ${outcome.deltaBlockedReason ?? "no comparable measurement"}`,
    industryContext: input.industryContext?.trim() ?? "",
    reusableFor: input.reusableFor?.trim() ?? "",
    writtenAt: new Date().toISOString(),
  };
  const updated = await advanceWithinEvidence(engagement, "CATALOG_WRITTEN", principal.ownerId, {
    status: "Closed",
    nextAction: "Diagnose the next constraint when the client is ready",
    data: { catalogEntry: entry },
  });
  const document = await createArtifact(updated, {
    kind: "catalog_entry",
    title: `${updated.client} — Catalog Entry`,
    status: "approved",
    provenance: "advisor-note",
    content: generateCatalogEntry(updated, finding, entry),
    data: entry,
  });
  await addActivity(updated, {
    activityType: "Catalog",
    summary: "Wrote the reusable pattern to the catalog",
    outcome: entry.measuredResult,
  });
  return { engagement: updated, catalogEntry: entry, document };
}
