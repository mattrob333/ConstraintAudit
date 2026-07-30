import { killConditionSpecFrom } from "./openai-transcript-schema";
import {
  CONSTRAINT_TYPES,
  KILL_COMPARATORS,
  canonicalCanvasBlock,
  isOneOf,
  parseMeasure,
  type AdvisorEdit,
  type BaselineMetric,
  type ConstraintFinding,
  type ConstraintType,
  type EngagementData,
  type KillConditionSpec,
} from "./workflow";

/**
 * The findings editor: everything the advisor is allowed to change about a diagnosis, and
 * every rule that decides whether a change may be accepted.
 *
 * Pure and dependency-free on purpose — no store, no network, no env — because these are the
 * rules that decide whether a number the advisor typed is allowed to be called a client-stated
 * baseline (audit F6) and whether a hand-edited finding can still be approved (audit C1/C17).
 *
 * Three invariants hold throughout and are the reason this file exists separately:
 *  1. Editing is never approval. The finding's status is derived from the evidence, exactly as
 *     it was before an advisor could touch any field.
 *  2. Every advisor override is recorded beside the MODEL's original, so a document can always
 *     say which words are the machine's reading and which are the advisor's judgment.
 *  3. Nothing the advisor types can become a client quote. Evidence is a SELECTION over lines
 *     the client actually said; there is no path here from prose to a citation.
 */

export type FindingEvidence = ConstraintFinding["evidence"][number];

/** How an advisor-attested source is stamped, so no document can read it as the client's. */
export const ATTESTED_PREFIX = "Advisor-attested";

/** A match shorter than this is a coincidence, not a citation ("yes", "nine"). */
const MIN_SOURCE_MATCH = 12;

/** The most citations one finding carries, and the most appendix lines it prints. */
const MAX_EVIDENCE = 8;
const MAX_APPENDIX = 12;

/** Comparison space for every quote match here: case-folded, whitespace-collapsed. */
export function quoteSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Timestamp plus words, so the same sentence said twice stays two distinct citations. */
export function evidenceKey(item: { quote: string; timestamp: string }): string {
  return `${item.timestamp.trim()}|${quoteSpace(item.quote)}`;
}

/**
 * Every client-stated line this engagement actually has on record: the finding's own
 * citations plus everything the grounding layer kept from each processed transcript.
 *
 * This is the whole universe the advisor may select evidence from.
 */
export function groundedEvidencePool(
  data: EngagementData,
  finding: ConstraintFinding,
): FindingEvidence[] {
  const pool: FindingEvidence[] = [];
  const seen = new Set<string>();
  const push = (item: FindingEvidence) => {
    if (!item.quote?.trim() || !item.speaker?.trim() || !item.timestamp?.trim()) return;
    const key = evidenceKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(item);
  };
  for (const item of finding.evidence ?? []) push(item);
  for (const synthesis of data.transcriptSynthesis ?? []) {
    for (const quote of synthesis.quotes ?? []) {
      push({
        quote: quote.text,
        speaker: quote.speaker,
        timestamp: quote.timestamp,
        transcriptUrl: "",
        provenance: "client-stated",
      });
    }
    for (const metric of synthesis.metrics ?? []) {
      push({
        quote: metric.quote,
        speaker: metric.speaker,
        timestamp: metric.timestamp,
        transcriptUrl: "",
        provenance: "client-stated",
      });
    }
  }
  return pool;
}

/**
 * Does this baseline source point at a line this engagement actually holds?
 *
 * Audit F6: `{value: "nine-ish", source: "Dana said so"}` used to confirm a baseline. A source
 * resolves two ways, both checked against stored grounded lines: it quotes the words of one
 * (either direction of containment, so `"Speaker at 04:43: <line>"` and a bare fragment both
 * work), or it names the line — that speaker at that timestamp. Nothing else counts.
 */
export function baselineSourceResolves(
  data: EngagementData,
  finding: ConstraintFinding,
  source: string,
): boolean {
  const needle = quoteSpace(source);
  if (needle.length < MIN_SOURCE_MATCH) return false;
  for (const item of groundedEvidencePool(data, finding)) {
    const line = quoteSpace(item.quote);
    if (line.length >= MIN_SOURCE_MATCH && (needle.includes(line) || line.includes(needle))) {
      return true;
    }
    const speaker = quoteSpace(item.speaker);
    const timestamp = quoteSpace(item.timestamp);
    if (speaker && timestamp && needle.includes(speaker) && needle.includes(timestamp)) return true;
  }
  return false;
}

/** Everything the advisor may change about a finding. Every field is optional and additive. */
export interface FindingEditInput {
  humanOwner?: { name: string; role: string };
  baseline?: {
    name: string; value: string; unit: string; period: string; source: string;
    /**
     * `advisor-attested` is the advisor saying "this number is mine, not the transcript's".
     * It is accepted, stamped as such, and caps the finding at provisional.
     */
    attestation?: "client-stated" | "advisor-attested";
  };
  constraintType?: string;
  canvasBlock?: string;
  prescription?: string;
  whySmallestIntervention?: string;
  killCondition?: string;
  /** `null` clears the structured spec; the verbatim sentence is never cleared with it. */
  killConditionSpec?: { metric?: string; comparator?: string; threshold?: string; window?: string } | null;
  predictedNextConstraint?: string;
  appendixItems?: { add?: string[]; remove?: string[] };
  /** Selection over the grounded pool, by `timestamp|quote` key. Never a rewording. */
  evidence?: { include?: string[]; exclude?: string[] };
}

export interface FindingEditResult {
  finding: ConstraintFinding;
  baseline: BaselineMetric;
  /** True only for a client-stated, numerically comparable, fully-specified reading. */
  baselineConfirmed: boolean;
  /** True when the reading is the advisor's own word; the finding then cannot exceed provisional. */
  advisorAttested: boolean;
}

/**
 * Apply one round of advisor edits to a finding. Throws a plain, advisor-readable message on
 * anything it will not accept; returns the next finding and how its baseline now reads.
 */
export function applyFindingEdits(
  data: EngagementData,
  finding: ConstraintFinding,
  input: FindingEditInput,
  context: { editedAt: string; editedBy: string; intakeOwner?: { name: string; role: string } | null },
): FindingEditResult {
  const { editedAt, editedBy } = context;
  const edits = new Map((finding.advisorEdits ?? []).map((edit) => [edit.field, edit]));
  /**
   * Records one override. `original` is always the MODEL's value: an edit of an edit keeps the
   * first original, so the document can still show what the machine said before the advisor
   * touched it, however many passes it took.
   */
  const recordEdit = (field: string, before: string, after: string): void => {
    if (before === after) return;
    edits.set(field, {
      field,
      original: edits.get(field)?.original ?? before,
      edited: after,
      editedAt,
      editedBy,
    });
  };

  /* ---------------------------------------------------- baseline (F6) */
  let advisorAttested = false;
  let baseline: BaselineMetric = finding.baselineMetric;
  if (input.baseline) {
    const candidate: BaselineMetric = {
      name: input.baseline.name?.trim() ?? "",
      value: input.baseline.value?.trim() ?? "",
      unit: input.baseline.unit?.trim() ?? "",
      period: input.baseline.period?.trim() ?? "",
      source: input.baseline.source?.trim() ?? "",
    };
    if (!candidate.name || !candidate.value || !candidate.unit || !candidate.period || !candidate.source) {
      throw new Error("A baseline needs a name, value, unit, period, and source. Leave it unchanged rather than part-filling it.");
    }
    if (parseMeasure(candidate.value) === null) {
      throw new Error(`"${candidate.value}" is not a single comparable reading. Enter one number (a range like "3 to 5 days" cannot anchor a before/after).`);
    }
    advisorAttested = input.baseline.attestation === "advisor-attested";
    if (!advisorAttested && !baselineSourceResolves(data, finding, candidate.source)) {
      throw new Error("That baseline source does not match any client line on record for this engagement. Quote the line (or name the speaker and timestamp), or mark the reading as advisor-attested — which keeps the finding provisional.");
    }
    if (advisorAttested && !candidate.source.toLowerCase().startsWith(ATTESTED_PREFIX.toLowerCase())) {
      candidate.source = `${ATTESTED_PREFIX}: ${candidate.source}`;
    }
    recordEdit("baselineMetric", JSON.stringify(finding.baselineMetric), JSON.stringify(candidate));
    baseline = candidate;
  } else if ((finding.baselineMetric.source ?? "").toLowerCase().startsWith(ATTESTED_PREFIX.toLowerCase())) {
    // A previously attested reading keeps its cap on every later save.
    advisorAttested = true;
  }

  /* ------------------------------------------------ the finding itself */
  let constraintType: ConstraintType = finding.constraintType;
  if (input.constraintType !== undefined) {
    const proposed = input.constraintType.trim();
    if (!isOneOf(CONSTRAINT_TYPES, proposed)) {
      throw new Error(`"${input.constraintType}" is not a constraint type. Choose one of ${CONSTRAINT_TYPES.join(", ")}.`);
    }
    constraintType = proposed;
  }
  recordEdit("constraintType", finding.constraintType, constraintType);

  let canvasBlock = finding.canvasBlock;
  if (input.canvasBlock !== undefined) {
    const proposed = canonicalCanvasBlock(input.canvasBlock);
    if (!proposed) throw new Error(`"${input.canvasBlock}" is not a Business Model Canvas block.`);
    canvasBlock = proposed;
  }
  recordEdit("canvasBlock", finding.canvasBlock, canvasBlock);

  const prose = (next: string | undefined, current: string): string =>
    next === undefined ? current : next.trim();
  const description = prose(input.prescription, finding.prescription.description);
  recordEdit("prescription", finding.prescription.description, description);
  const whySmallest = prose(input.whySmallestIntervention, finding.prescription.whySmallestIntervention);
  recordEdit("whySmallestIntervention", finding.prescription.whySmallestIntervention, whySmallest);
  const killCondition = prose(input.killCondition, finding.killCondition);
  recordEdit("killCondition", finding.killCondition, killCondition);
  const predictedNextConstraint = prose(input.predictedNextConstraint, finding.predictedNextConstraint);
  recordEdit("predictedNextConstraint", finding.predictedNextConstraint, predictedNextConstraint);

  // All four parts or none: the same rule the grounding layer applies to the model.
  let killConditionSpec: KillConditionSpec | undefined = finding.killConditionSpec;
  if (input.killConditionSpec !== undefined) {
    const proposed = input.killConditionSpec === null
      ? null
      : killConditionSpecFrom(input.killConditionSpec);
    if (input.killConditionSpec !== null && !proposed) {
      throw new Error(`A structured kill condition needs a metric, a comparator (${KILL_COMPARATORS.join(", ")}), a threshold, and a window. Leave it out rather than part-filling it.`);
    }
    recordEdit(
      "killConditionSpec",
      finding.killConditionSpec ? JSON.stringify(finding.killConditionSpec) : "(none)",
      proposed ? JSON.stringify(proposed) : "(none)",
    );
    killConditionSpec = proposed ?? undefined;
  }

  let appendixItems = finding.appendixItems;
  if (input.appendixItems) {
    const removed = new Set((input.appendixItems.remove ?? []).map(quoteSpace));
    const added = (input.appendixItems.add ?? []).map((item) => item.trim()).filter(Boolean);
    const kept = appendixItems.filter((item) => !removed.has(quoteSpace(item)));
    const known = new Set(kept.map(quoteSpace));
    appendixItems = [...kept, ...added.filter((item) => !known.has(quoteSpace(item)))].slice(0, MAX_APPENDIX);
    recordEdit("appendixItems", finding.appendixItems.join("\n"), appendixItems.join("\n"));
  }

  /**
   * Evidence selection over the grounded pool. Excluding may take the finding below the
   * two-quote approval bar — that is allowed, and `requireDiagnosisApprovalEvidence` then
   * blocks approval and says so, rather than the editor silently refusing the edit.
   */
  let evidence = finding.evidence;
  if (input.evidence) {
    const pool = new Map(groundedEvidencePool(data, finding).map((item) => [evidenceKey(item), item]));
    const selected = new Set(finding.evidence.map(evidenceKey));
    for (const key of input.evidence.include ?? []) {
      if (!pool.has(key)) {
        throw new Error("That quote is not in this engagement's grounded evidence. Evidence can only be selected from lines the client actually said.");
      }
      selected.add(key);
    }
    for (const key of input.evidence.exclude ?? []) selected.delete(key);
    evidence = [...pool.entries()]
      .filter(([key]) => selected.has(key))
      .map(([, item]) => item)
      .slice(0, MAX_EVIDENCE);
    recordEdit(
      "evidence",
      `${finding.evidence.length} quote(s) selected by the model`,
      `${evidence.length} quote(s) selected by the advisor`,
    );
  }

  // A number that is not a single comparable reading was never a confirmed baseline, and an
  // advisor-attested one is the advisor's word rather than the client's — neither confirms.
  const baselineConfirmed = Boolean(
    !advisorAttested &&
    baseline.name?.trim() && baseline.value?.trim() && baseline.unit?.trim() &&
    baseline.period?.trim() && baseline.source?.trim() &&
    parseMeasure(baseline.value ?? "") !== null,
  );
  // The primary contact captured at intake is the obvious default owner. Falling back to it
  // means the advisor does not retype what they already told us, but an explicit humanOwner
  // on the request always wins.
  const humanOwner = input.humanOwner
    ?? (finding.humanOwner.name.trim() ? finding.humanOwner : context.intakeOwner ?? finding.humanOwner);
  const advisorEdits: AdvisorEdit[] = [...edits.values()];

  const next: ConstraintFinding = {
    ...finding,
    constraintType,
    canvasBlock,
    evidence,
    baselineMetric: baseline,
    prescription: { description, whySmallestIntervention: whySmallest },
    humanOwner,
    predictedNextConstraint,
    killCondition,
    appendixItems,
    // Editing is never approval: the status is still derived from the evidence, exactly as
    // it was before an advisor could touch any of these fields.
    findingStatus: baselineConfirmed ? "client-verified" : "provisional",
    baselineInstrumentation: {
      ...finding.baselineInstrumentation,
      required: !baselineConfirmed,
    },
    ...(killConditionSpec ? { killConditionSpec } : {}),
    ...(advisorEdits.length ? { advisorEdits } : {}),
  };
  // An advisor who cleared the spec meant to clear it; `...finding` would have carried it back.
  if (!killConditionSpec) delete next.killConditionSpec;

  return { finding: next, baseline, baselineConfirmed, advisorAttested };
}
