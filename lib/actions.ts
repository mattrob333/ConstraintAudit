import type { Principal } from "./auth";
import { applyCanvasUpdates, buildCanvasFromResearch, mergeCanvas } from "./canvas";
import {
  DEMO_TIMELINE,
  buildDemoEngagement,
  demoActivities,
  demoArtifacts,
  demoEngagementIdFor,
  demoSpeakerRoles,
  demoTranscript,
} from "./demo";
import { fetchFirefliesTranscript } from "./fireflies";
import {
  generateAuditReport,
  generateCatalogEntry,
  generateDeveloperSpec,
  generateDiagnosisPackage,
  generateFindingsAgenda,
  generateOutcomeReport,
  generateProposal,
  generateReadinessBrief,
  generateRolesMap,
  generateRoadmap,
  generateSprintPlan,
  renderGoogleDocHtml,
} from "./deliverables";
import { HttpError } from "./http";
import { resolveMetricDirection } from "./metric-direction";
import { createDocument, appendOrUpdateRow, sendEmail, type CellValue } from "./integrations";
import { researchPublicWebsite } from "./research";
import { resolveCredentials, type Credentials } from "./secrets";
import { CRM_COLUMNS, CRM_MATCH_KEY, DEFAULT_CRM_SHEET_TAB, getSettings } from "./settings";
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
  deleteEngagementCascade,
  getArtifact,
  getEngagement,
  getIntent,
  insertEngagement,
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
  const hasPatch = Object.keys(patch).some((key) => key !== "expectedVersion");
  // Already at or past the target — there is no checkpoint to cross, but the data patch still
  // has to land. Skipping it meant a re-measured outcome created an artifact with new numbers
  // while the engagement kept the old ones, so the record and the document disagreed.
  if (WORKFLOW_STATES.indexOf(current.workflowState) >= targetIndex) {
    return hasPatch
      ? updateEngagement(current.id, { ...patch, expectedVersion: current.version }, ownerId)
      : current;
  }
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
  const credentials = await resolveCredentials(principal.ownerId);
  const synthesis = await enrichResearchWithOpenAI(
    websiteResearch,
    engagement.client,
    fetch,
    credentials,
  );
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
  /** Supplied by callers that already resolved them (Fireflies import); resolved here otherwise. */
  credentials?: Credentials,
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
  const synthesis = await synthesizeTranscriptWithOpenAI(
    deterministic,
    {
      lines: parseTranscriptText(rawText, input.speakerRoles),
      client: engagement.client,
      callNumber: input.callNumber,
      transcriptUrl: input.sourceUrl,
      research: engagement.data.research,
      canvas: engagement.data.canvas,
      valueFlow,
      questions: engagement.data.research?.discoveryQuestions,
      priorSynthesis: engagement.data.transcriptSynthesis,
    },
    fetch,
    credentials ?? await resolveCredentials(principal.ownerId),
  );
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
  // Once the advisor has confirmed the finding, re-importing a transcript must not overwrite
  // or downgrade it. `client-verified` and `approved` are set only by updateFinding, never by
  // transcript processing, so they mark advisor-confirmed evidence a fresh import cannot touch.
  // Below that, a new candidate supersedes and a signal-free import keeps the prior one rather
  // than deleting it (an undefined value in the patch would drop the stored key entirely).
  const findingLocked =
    engagement.findingStatus === "approved" || engagement.findingStatus === "client-verified";
  const nextFinding = findingLocked
    ? engagement.data.finding
    : synthesis.constraintCandidate ?? engagement.data.finding;
  const nextBaseline = findingLocked
    ? engagement.data.baseline
    : synthesis.constraintCandidate?.baselineMetric ?? engagement.data.baseline;
  const nextBaselineStatus = findingLocked ? engagement.baselineStatus : synthesis.baselineStatus;
  const nextFindingStatus = findingLocked
    ? engagement.findingStatus
    : synthesis.constraintCandidate?.findingStatus ?? engagement.findingStatus;

  const sharedData: Parameters<typeof updateEngagement>[1]["data"] = {
    transcriptSynthesis: [...(engagement.data.transcriptSynthesis ?? []), synthesis],
    recordingConsent: engagement.data.recordingConsent,
    canvas,
    roles: synthesis.roles?.length ? synthesis.roles : engagement.data.roles,
  };
  // Only assign these keys when there is a value: writing `undefined` deletes the stored key.
  if (nextFinding !== undefined) sharedData.finding = nextFinding;
  if (nextBaseline !== undefined) sharedData.baseline = nextBaseline;

  if (WORKFLOW_STATES.indexOf(target) > WORKFLOW_STATES.indexOf(engagement.workflowState)) {
    engagement = await advanceWithinEvidence(engagement, target, principal.ownerId, {
      baselineStatus: nextBaselineStatus,
      findingStatus: nextFindingStatus,
      nextAction:
        input.callNumber === 1
          ? "Review synthesis and explicitly approve the Canvas commit"
          : "Review reconciliation and explicitly approve the diagnosis",
      status: "Needs review",
      data: sharedData,
    });
  } else {
    engagement = await updateEngagement(id, {
      baselineStatus: nextBaselineStatus,
      findingStatus: nextFindingStatus,
      nextAction: findingLocked
        ? "Imported evidence recorded; the confirmed finding was preserved"
        : "Review imported evidence; required approval checkpoints were not advanced automatically",
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
  // One lookup covers both the Fireflies read and the transcript synthesis that follows.
  const credentials = await resolveCredentials(principal.ownerId);
  const fetched = await fetchFirefliesTranscript(input.transcriptId, credentials);
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
  }, credentials);
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
  // The primary contact captured at intake is the obvious default owner. Falling back to
  // it means the advisor does not retype what they already told us, but an explicit
  // humanOwner on the request always wins.
  const intakeOwner = engagement.primaryContact.trim()
    ? { name: engagement.primaryContact.trim(), role: engagement.primaryContactRole.trim() }
    : null;
  const resolvedOwner = input.humanOwner
    ?? (finding.humanOwner.name.trim() ? finding.humanOwner : intakeOwner ?? finding.humanOwner);
  const nextFinding = {
    ...finding,
    baselineMetric: baseline,
    humanOwner: resolvedOwner,
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
    ["roles_map", "Roles & Responsibility Map", generateRolesMap(engagement, finding)],
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
  // BYO CRM: the write targets the advisor's own connected sheet, never a shared/global one.
  const settings = await getSettings(principal.ownerId);
  const connected = Boolean(settings.crmSpreadsheetId);
  // Values keyed by CRM column, then projected onto the canonical column order so the payload row,
  // the downloadable template, and the verify column-check all agree on exactly these columns.
  const rowValues: Record<string, CellValue> = {
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
  };
  const row = Object.fromEntries(
    CRM_COLUMNS.map((column) => [column, rowValues[column] ?? null]),
  ) as Record<string, CellValue>;
  const intent = await createIntent(engagement, "crm_write_back", {
    workbook: "Tier 4 Engagement CRM",
    // Empty when no sheet is connected; execution then returns not-configured cleanly (no fallback
    // to a deployment-wide sheet — a client's row must never land in another advisor's CRM).
    spreadsheetId: settings.crmSpreadsheetId,
    sheet: settings.crmSheetTab || DEFAULT_CRM_SHEET_TAB,
    matchKey: CRM_MATCH_KEY,
    row,
    requiresExplicitApproval: true,
    detail: connected
      ? `Targets your connected CRM sheet "${settings.crmSheetTab}".`
      : "No CRM sheet is connected. Connect one in Settings before executing this intent.",
  });
  await addActivity(engagement, {
    activityType: "CRM",
    summary: "Created Google Sheets CRM write-back intent",
    outcome: connected
      ? "No external write performed; intent is pending explicit approval"
      : "No external write performed; connect a CRM sheet in Settings before executing",
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
  // Carry the metadata the document shell needs so the published Doc is branded consistently,
  // and file it in the advisor's configured Drive folder when the engagement has none.
  const driveFolder = (await getSettings(principal.ownerId)).driveFolderId;
  const intent = await createIntent(engagement, "document_publish", {
    documentId: String(artifact.id),
    title: String(artifact.title),
    status: String(artifact.status),
    markdown: String(artifact.content),
    client: engagement.client,
    advisor: engagement.advisor,
    date: new Date().toISOString().slice(0, 10),
    kind: String(artifact.kind),
    folderId: engagement.engagementFolder || driveFolder || undefined,
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
 * Seed the Practice-mode engagement: one fully worked, entirely fictional client an advisor
 * can walk end to end before touching a real one. Deterministic and offline — it needs no
 * API key, costs nothing, and shows every advisor the identical worked example.
 */
export async function seedDemoEngagement(principal: Principal, reset = false) {
  const id = demoEngagementIdFor(principal.ownerId);
  const existing = await getEngagement(id, principal.ownerId);
  if (existing && !reset) return { engagement: existing, seeded: false };
  if (existing) await deleteEngagementCascade(id, principal.ownerId);

  const engagement = buildDemoEngagement(principal.ownerId, DEMO_TIMELINE.catalogWritten);
  await insertEngagement(engagement);
  for (const artifact of demoArtifacts(engagement)) await createArtifact(engagement, artifact);
  for (const activity of demoActivities()) await addActivity(engagement, activity);
  for (const callNumber of [1, 2] as const) {
    await createTranscript(engagement, {
      callNumber,
      source: "paste",
      title: `${engagement.client} — Call ${callNumber} transcript (practice)`,
      rawText: demoTranscript(callNumber),
      data: { practice: true, speakerRoles: demoSpeakerRoles() },
    });
  }
  return { engagement, seeded: true };
}

export async function removeDemoEngagement(principal: Principal) {
  const removed = await deleteEngagementCascade(
    demoEngagementIdFor(principal.ownerId),
    principal.ownerId,
  );
  return { removed };
}

export async function getDemoEngagement(principal: Principal) {
  return { engagement: await getEngagement(demoEngagementIdFor(principal.ownerId), principal.ownerId) };
}

/**
 * Attach a document the advisor already had — a prior proposal, an email thread, notes —
 * to the engagement's source register. The text is extracted and stored so it is real
 * evidence with `doc` provenance, not a filename the UI merely claims to have kept.
 */
export async function ingestSourceDocument(
  id: string,
  principal: Principal,
  input: { file: TranscriptFileInput; label?: string },
) {
  const engagement = await requireEngagement(id, principal.ownerId);
  if (!input.file?.name || !input.file.content) throw new Error("A file with content is required.");
  if (/\.pdf$/i.test(input.file.name) || input.file.mimeType === "application/pdf") {
    throw new HttpError(400, "PDF text extraction is not supported yet. Convert to DOCX, TXT, or Markdown first.");
  }
  const decoded = await decodeTranscriptFile(input.file);
  const label = input.label?.trim() || input.file.name;
  const artifact = await createArtifact(engagement, {
    kind: "source_document",
    title: `${engagement.client} — ${label}`,
    status: "captured",
    // Advisor-supplied material is `doc`, never `client-stated`. It is not something the
    // client said on a recorded call, and it must never be promoted as if it were.
    provenance: "doc",
    content: decoded.text,
    data: { fileName: input.file.name, format: decoded.format, warnings: decoded.warnings },
  });
  const updated = await updateEngagement(id, {
    data: {
      sourceRegister: [
        ...(engagement.data.sourceRegister ?? []),
        {
          id: makeId("src"),
          label,
          provenance: "doc" as const,
          capturedAt: new Date().toISOString(),
        },
      ],
    },
    expectedVersion: engagement.version,
  }, principal.ownerId);
  await addActivity(updated, {
    activityType: "Source",
    summary: `Captured ${label}`,
    outcome: `${decoded.format} decoded into the source register${decoded.warnings.length ? `; ${decoded.warnings.join("; ")}` : ""}`,
  });
  return { engagement: updated, document: artifact, warnings: decoded.warnings };
}

/**
 * Build the Findings Call agenda. Call 2 is where the advisor presents the diagnosis, so
 * this is the artifact that carries a non-expert through the most important conversation.
 */
export async function buildFindingsAgenda(id: string, principal: Principal) {
  const engagement = await requireEngagement(id, principal.ownerId);
  const finding = engagement.data.finding;
  if (!finding) throw new Error("Synthesize call 1 before building the findings agenda.");
  const agenda = generateFindingsAgenda(engagement, finding);
  const document = await createArtifact(engagement, {
    kind: "findings_agenda",
    title: `${engagement.client} — Findings Call Agenda`,
    status: "draft",
    provenance: "advisor-note",
    content: agenda.markdown,
    data: { sections: agenda.sections },
  });
  await addActivity(engagement, {
    activityType: "Findings",
    summary: "Built the findings call agenda",
    outcome: `${agenda.sections.length} sections; evidence is client-stated only`,
  });
  return { engagement, document };
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

  // Resolved before the claim: approve and reject never look a credential up, and a lookup
  // failure here leaves the intent approved rather than stranded in `executing`.
  const credentials = await resolveCredentials(principal.ownerId);

  // Claim the intent before doing the external write: an atomic approved -> executing swap.
  // Only one concurrent request wins, so a double-click or retry cannot send two emails or
  // create two Google Docs from a single approval.
  const claim = await updateIntentStatus(intentId, principal.ownerId, "executing", undefined, "approved");
  if (!claim.changed) {
    throw new Error(`This intent is already being processed or is no longer approved (current: ${String(claim.status)}).`);
  }

  const result = await executeIntent(type, intentId, payload, credentials);
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
  credentials: Credentials,
) {
  const str = (key: string): string => typeof payload[key] === "string" ? payload[key] as string : "";
  if (type === "readiness_brief_send") {
    return sendEmail({
      to: str("to"),
      subject: str("subject"),
      markdownBody: str("body"),
      idempotencyKey: intentId,
      credentials,
    });
  }
  if (type === "crm_write_back") {
    // Pass the advisor's own spreadsheet id through. When it is empty (no sheet connected),
    // appendOrUpdateRow returns not-configured rather than falling back to any global sheet.
    return appendOrUpdateRow({
      spreadsheetId: str("spreadsheetId"),
      sheet: str("sheet") || DEFAULT_CRM_SHEET_TAB,
      matchKey: str("matchKey") || CRM_MATCH_KEY,
      row: (payload.row ?? {}) as Record<string, CellValue>,
      idempotencyKey: intentId,
      credentials,
    });
  }
  if (type === "document_publish") {
    const title = str("title");
    const markdown = str("markdown");
    // Wrap in the standard deliverable shell (title block, advisor byline, confidentiality
    // footer) using structural HTML that survives Drive's HTML->Doc conversion, so every
    // published Doc comes out consistently formatted. The publish intent carries the meta.
    const html = renderGoogleDocHtml(markdown, {
      client: str("client") || "the client",
      title,
      advisor: str("advisor") || "Tier 4 Advisor",
      date: str("date"),
      confidential: true,
      kind: str("kind") || undefined,
    });
    return createDocument({
      title,
      markdown,
      html,
      folderId: str("folderId") || undefined,
      credentials,
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
  const directionInference = await resolveMetricDirection(
    ending,
    { constraintType: finding.constraintType, advisorDeclared: input.improvedWhen },
    fetch,
    await resolveCredentials(principal.ownerId),
  );
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
