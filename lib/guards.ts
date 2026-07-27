import type {
  ConsentAttestation,
  ConstraintFinding,
  Engagement,
  WorkflowState,
} from "./workflow";

export interface ArtifactRecord {
  id: string;
  engagement_id: string;
  kind: string;
  status: string;
  content: string;
}

export function requireConsentAttestation(
  attestation: ConsentAttestation | undefined,
): ConsentAttestation {
  if (
    attestation?.grantedBeforeCapture !== true ||
    !attestation.attestedBy?.trim() ||
    !attestation.attestedAt?.trim() ||
    Number.isNaN(Date.parse(attestation.attestedAt))
  ) {
    throw new Error(
      "A recording/transcription consent attestation is required before transcript processing.",
    );
  }
  return {
    ...attestation,
    attestedBy: attestation.attestedBy.trim(),
    attestedAt: new Date(attestation.attestedAt).toISOString(),
  };
}

export function requireApprovedReadinessArtifact(
  engagement: Engagement,
  artifact: ArtifactRecord | null,
): ArtifactRecord {
  const binding = engagement.data.approvedReadinessBrief;
  if (!binding?.documentId) {
    throw new Error("No immutable approved readiness brief is bound to this engagement.");
  }
  if (
    !artifact ||
    artifact.id !== binding.documentId ||
    artifact.engagement_id !== engagement.id ||
    artifact.kind !== "readiness_brief" ||
    artifact.status !== "approved" ||
    !artifact.content
  ) {
    throw new Error("The bound readiness brief is missing, mismatched, or not approved.");
  }
  return artifact;
}

export function requireDiagnosisApprovalEvidence(finding: ConstraintFinding): void {
  if (!finding.humanOwner.name.trim() || !finding.humanOwner.role.trim()) {
    throw new Error("Diagnosis approval requires a named human owner and role.");
  }
  const evidence = finding.evidence.filter(
    (item) =>
      item.provenance === "client-stated" &&
      item.quote.trim() &&
      item.speaker.trim() &&
      item.timestamp.trim(),
  );
  if (evidence.length === 0) {
    throw new Error("Diagnosis approval requires at least one client-stated quote with speaker and timestamp.");
  }
}

export type EngagementPatchCommand =
  | {
      command: "update_metadata";
      expectedVersion: number;
      fields: Partial<{
        client: string;
        website: string;
        primaryContact: string;
        email: string;
        advisor: string;
        notes: string;
        dueDate: string | null;
        call1At: string | null;
        call2At: string | null;
        lastContact: string | null;
        engagementFolder: string;
      }>;
    }
  | {
      command: "advance_workflow";
      expectedVersion: number;
      nextState: WorkflowState;
      nextAction?: string;
    };

export function requirePatchCommand(value: unknown): EngagementPatchCommand {
  if (!value || typeof value !== "object") throw new Error("PATCH command is required.");
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) {
    throw new Error("expectedVersion is required.");
  }
  if (input.command === "update_metadata") {
    if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) {
      throw new Error("update_metadata requires a fields object.");
    }
    const allowed = new Set([
      "client", "website", "primaryContact", "primaryContactRole", "email", "advisor", "notes",
      "dueDate", "call1At", "call2At", "lastContact", "engagementFolder",
    ]);
    const keys = Object.keys(input.fields as object);
    if (keys.some((key) => !allowed.has(key))) {
      throw new Error("update_metadata contains a protected field.");
    }
    return input as unknown as EngagementPatchCommand;
  }
  if (input.command === "advance_workflow") {
    if (typeof input.nextState !== "string") throw new Error("nextState is required.");
    // Every other workflow state is entered as a side effect of real evidence: transcript
    // processing sets the synthesis states, and the diagnosis/sprint/outcome/catalog states
    // each have a dedicated action enforcing their own gate. The generic advance would bypass
    // all of that, so it is allowed to reach exactly one checkpoint — the Canvas commit, which
    // is a pure advisor decision with no evidence precondition — and nothing else.
    if (input.nextState !== "CANVAS_COMMIT_APPROVED") {
      throw new Error(`${input.nextState} cannot be reached by a direct workflow advance; use its own reviewed action.`);
    }
    return input as unknown as EngagementPatchCommand;
  }
  throw new Error("Unsupported PATCH command.");
}
