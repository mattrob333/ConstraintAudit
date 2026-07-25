import { fetchFirefliesTranscript } from "./fireflies";
import {
  generateAuditReport,
  generateDeveloperSpec,
  generateDiagnosisPackage,
  generateProposal,
  generateReadinessBrief,
  generateRoadmap,
} from "./deliverables";
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
  updateEngagement,
} from "./store";
import { synthesizeTranscript } from "./transcript";
import {
  makeId,
  WORKFLOW_STATES,
  type ConsentAttestation,
  type Engagement,
  type WorkflowState,
} from "./workflow";

async function requireEngagement(id: string): Promise<Engagement> {
  const engagement = await getEngagement(id);
  if (!engagement) throw new Error("Engagement not found");
  return engagement;
}

async function advanceWithinEvidence(
  engagement: Engagement,
  target: WorkflowState,
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
    });
  }
  return current;
}

export async function runResearch(id: string, sourceUrl?: string) {
  const engagement = await requireEngagement(id);
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
  const updated = await updateEngagement(id, {
    stage: "Research",
    status: "In progress",
    website: canonicalUrl,
    nextAction: "Review research gaps and draft the pre-call readiness brief",
    data: {
      research: synthesis,
      sourceRegister: [...(engagement.data.sourceRegister ?? []), ...addedSources],
    },
    expectedVersion: engagement.version,
  });
  const artifact = await createArtifact(updated, {
    kind: "company_brief",
    title: `${updated.client} — Public Research Brief`,
    status: "draft",
    provenance: "public-research",
    sourceUrl: canonicalUrl,
    content: `# ${synthesis.title}\n\n${synthesis.description}\n\n## Research mode\n\n${synthesis.researchMode === "openai-web-search" ? `OpenAI web search (${synthesis.providerModel}) with ${synthesis.sourceCount ?? 0} public source(s).` : "Deterministic website extraction."}\n\n## Known public facts\n\n${synthesis.facts.map((fact) => `- ${fact.statement}${fact.sourceUrl ? ` — ${fact.sourceUrl}` : ""}`).join("\n") || "- No public facts extracted."}\n\n## Missing\n\n${synthesis.gaps.map((gap) => `- ${gap}`).join("\n")}`,
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
  input: { action?: "generate" | "approve" | "send_intent"; videoLink?: string; duration?: string },
) {
  let engagement = await requireEngagement(id);
  if (input.action === "send_intent" && engagement.readinessBriefStatus !== "Approved") {
    throw new Error("Readiness brief must be Approved before creating a send intent.");
  }
  if (input.action === "send_intent") {
    const binding = engagement.data.approvedReadinessBrief;
    const bound = binding?.documentId ? await getArtifact(binding.documentId) : null;
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
  });
  await addActivity(engagement, {
    activityType: "Brief",
    summary: input.action === "approve" ? "Approved readiness brief" : "Generated readiness brief draft",
    outcome: "Brief remains internal until a separate send intent is approved",
  });
  return { engagement, document: artifact };
}

export async function processTranscript(
  id: string,
  input: {
    callNumber: 1 | 2;
    rawText: string;
    source?: "paste" | "fireflies";
    sourceId?: string;
    sourceUrl?: string;
    title?: string;
    humanOwner?: { name: string; role: string };
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
    consentAttestation?: ConsentAttestation;
    sourceData?: unknown;
  },
) {
  let engagement = await requireEngagement(id);
  if (input.callNumber !== 1 && input.callNumber !== 2) throw new Error("callNumber must be 1 or 2");
  if (!input.rawText?.trim()) throw new Error("rawText is required");
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
    });
  }
  const synthesis = synthesizeTranscript(input.rawText, {
    client: engagement.client,
    callNumber: input.callNumber,
    transcriptUrl: input.sourceUrl,
    humanOwner: input.humanOwner,
    speakerRoles: input.speakerRoles,
  });
  const transcript = await createTranscript(engagement, {
    callNumber: input.callNumber,
    source: input.source ?? "paste",
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    title: input.title || `Call ${input.callNumber} transcript`,
    rawText: input.rawText,
    data: { synthesis, source: input.sourceData ?? null, consent },
  });
  const target =
    input.callNumber === 1
      ? "TRANSCRIPT_1_SYNTHESIZED"
      : WORKFLOW_STATES.indexOf(engagement.workflowState) >= WORKFLOW_STATES.indexOf("CANVAS_COMMIT_APPROVED")
        ? "TRANSCRIPT_2_RECONCILED"
        : engagement.workflowState;
  if (WORKFLOW_STATES.indexOf(target) > WORKFLOW_STATES.indexOf(engagement.workflowState)) {
    engagement = await advanceWithinEvidence(engagement, target, {
      baselineStatus: synthesis.baselineStatus,
      findingStatus: synthesis.constraintCandidate?.findingStatus ?? "none",
      nextAction:
        input.callNumber === 1
          ? "Review synthesis and explicitly approve the Canvas commit"
          : "Review reconciliation and explicitly approve the diagnosis",
      status: "Needs review",
      data: {
        transcriptSynthesis: [...(engagement.data.transcriptSynthesis ?? []), synthesis],
        baseline: synthesis.constraintCandidate?.baselineMetric,
        finding: synthesis.constraintCandidate ?? undefined,
        recordingConsent: engagement.data.recordingConsent,
      },
    });
  } else {
    engagement = await updateEngagement(id, {
      baselineStatus: synthesis.baselineStatus,
      findingStatus: synthesis.constraintCandidate?.findingStatus ?? "none",
      nextAction: "Review imported evidence; required approval checkpoints were not advanced automatically",
      status: "Needs review",
      data: {
        transcriptSynthesis: [...(engagement.data.transcriptSynthesis ?? []), synthesis],
        baseline: synthesis.constraintCandidate?.baselineMetric,
        finding: synthesis.constraintCandidate ?? undefined,
        recordingConsent: engagement.data.recordingConsent,
      },
      expectedVersion: engagement.version,
    });
  }
  const artifact = await createArtifact(engagement, {
    kind: input.callNumber === 1 ? "synthesis_diff" : "transcript_reconciliation",
    title: `${engagement.client} — Call ${input.callNumber} Synthesis`,
    status: "needs_review",
    provenance: "advisor-note",
    sourceUrl: input.sourceUrl,
    content: `# Call ${input.callNumber} Synthesis\n\n## Evidence quotes\n\n${synthesis.quotes.map((quote) => `- [${quote.timestamp}] ${quote.speaker}: "${quote.text}"`).join("\n") || "- No client-stated constraint evidence detected."}\n\n## Baseline\n\n${synthesis.baselineStatus}\n\n## Gaps\n\n${synthesis.gaps.map((gap) => `- ${gap}`).join("\n") || "- None detected."}`,
    data: synthesis,
  });
  await addActivity(engagement, {
    activityType: "Transcript",
    summary: `Processed Call ${input.callNumber} ${input.source ?? "paste"} transcript`,
    outcome: `${synthesis.lineCount} lines; baseline ${synthesis.baselineStatus}; finding ${synthesis.constraintCandidate?.findingStatus ?? "none"}`,
    sourceLink: input.sourceUrl,
  });
  return { engagement, transcript, synthesis, document: artifact };
}

export async function importFireflies(
  id: string,
  input: {
    transcriptId: string;
    callNumber: 1 | 2;
    consentAttestation?: ConsentAttestation;
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
  },
) {
  const fetched = await fetchFirefliesTranscript(input.transcriptId);
  return processTranscript(id, {
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
  input: {
    humanOwner?: { name: string; role: string };
    baseline?: { name: string; value: string; unit: string; period: string; source: string };
    action?: "save" | "approve_diagnosis";
  },
) {
  const engagement = await requireEngagement(id);
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
  });
  if (input.action === "approve_diagnosis") {
    updated = await updateEngagement(id, {
      workflowState: "DIAGNOSIS_APPROVED",
      findingStatus: baselineConfirmed ? "approved" : "provisional",
      status: "Approved",
      nextAction: baselineConfirmed
        ? "Generate the approved deliverable suite"
        : "Begin Sprint 1 with baseline instrumentation; numeric claims remain blocked",
      expectedVersion: updated.version,
    });
  }
  await addActivity(updated, {
    activityType: "Synthesis",
    summary: input.action === "approve_diagnosis" ? "Approved diagnosis checkpoint" : "Updated constraint finding",
    outcome: `Finding remains ${updated.findingStatus}; baseline ${updated.baselineStatus}`,
  });
  return { engagement: updated, finding: nextFinding };
}

export async function generateDeliverables(id: string) {
  const engagement = await requireEngagement(id);
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

export async function createCrmWriteBackIntent(id: string) {
  const engagement = await requireEngagement(id);
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
