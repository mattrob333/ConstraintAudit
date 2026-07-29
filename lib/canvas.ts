import {
  CANVAS_BLOCKS,
  PROVENANCE,
  canonicalCanvasBlock,
  emptyCanvas,
  isOneOf,
  type CanvasBlock,
  type CanvasUpdate,
  type EvidenceClaim,
  type Provenance,
  type ResearchSynthesis,
} from "./workflow";

/** The single canonical Canvas shape: all nine blocks always present. */
export type Canvas = Record<CanvasBlock, EvidenceClaim[]>;

/**
 * A Canvas as it may arrive from storage or an older record: partial, possibly keyed
 * by legacy block names ("Key Partnerships"), possibly holding malformed claims.
 */
export type CanvasInput = Partial<Record<string, EvidenceClaim[] | undefined>> | null | undefined;

/** Strength order. A claim never moves up this ladder; only a stronger source replaces it. */
const PROVENANCE_RANK: Record<Provenance, number> = {
  "client-stated": 4,
  doc: 3,
  "public-research": 2,
  "advisor-note": 1,
  gap: 0,
};

/** Public research may never be recorded above this rank, whatever the payload claims. */
const RESEARCH_CEILING = PROVENANCE_RANK["public-research"];

const SUPERSEDED_MARKER = " (superseded by client evidence)";
const SUPERSEDED_CONFIDENCE = 0.2;
const CLIENT_STATED_CONFIDENCE = 0.95;

function rank(provenance: Provenance): number {
  return PROVENANCE_RANK[provenance] ?? 0;
}

/** Dedupe key: case, punctuation, and spacing differences are not different claims. */
function normalizeStatement(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Coerce anything into a well-formed claim, or null. Never throws; malformed input is dropped. */
function toClaim(value: unknown): EvidenceClaim | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<EvidenceClaim>;
  const statement = trimmed(raw.statement);
  if (!statement) return null;
  const claim: EvidenceClaim = {
    statement,
    provenance: isOneOf(PROVENANCE, raw.provenance) ? raw.provenance : "gap",
    confidence: clampConfidence(raw.confidence),
    sourceLabel: trimmed(raw.sourceLabel) || "Unlabelled source",
  };
  const sourceUrl = trimmed(raw.sourceUrl);
  if (sourceUrl) claim.sourceUrl = sourceUrl;
  const block = trimmed(raw.canvasBlock);
  if (block) claim.canvasBlock = block;
  return claim;
}

/**
 * Collapse duplicate statements inside one block, keeping the strongest provenance.
 * Ties keep the earlier claim so caller-imposed ordering (client evidence first) survives.
 */
function dedupeBlock(claims: EvidenceClaim[]): EvidenceClaim[] {
  const seen = new Map<string, number>();
  const out: EvidenceClaim[] = [];
  for (const claim of claims) {
    const key = normalizeStatement(claim.statement);
    if (!key) continue;
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push(claim);
      continue;
    }
    if (rank(claim.provenance) > rank(out[at].provenance)) out[at] = claim;
  }
  return out;
}

/** Read a loose Canvas into the canonical shape without deduping or mutating the input. */
function collect(input: CanvasInput): Canvas {
  const canvas = emptyCanvas();
  if (!input || typeof input !== "object") return canvas;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const keyBlock = canonicalCanvasBlock(key);
    for (const entry of value) {
      const claim = toClaim(entry);
      if (!claim) continue;
      // A legacy or unknown key can still be rescued by the claim's own block label.
      const block = keyBlock ?? canonicalCanvasBlock(claim.canvasBlock);
      if (!block) continue;
      canvas[block].push({ ...claim, canvasBlock: block });
    }
  }
  return canvas;
}

/**
 * A research fact with no resolvable Canvas block is only filed under Value Propositions
 * when it is the site's own description of what it offers. Anything else is left out:
 * losing a fact is safer than filing it under a block its source does not support.
 */
function isSiteDescriptionFact(claim: EvidenceClaim, description: string): boolean {
  if (/\bdescription\b/i.test(claim.sourceLabel)) return true;
  const normalizedDescription = normalizeStatement(description);
  if (!normalizedDescription) return false;
  const normalizedStatement = normalizeStatement(claim.statement);
  return normalizedStatement === normalizedDescription || normalizedDescription.startsWith(normalizedStatement);
}

/**
 * Build the canonical Canvas from public research only. Every claim stays at
 * `public-research`; nothing here is ever client-confirmed.
 */
export function buildCanvasFromResearch(research: ResearchSynthesis): Canvas {
  const canvas = emptyCanvas();
  const facts: unknown = research?.facts;
  if (!Array.isArray(facts)) return canvas;
  const description = trimmed(research?.description);
  for (const entry of facts) {
    const claim = toClaim(entry);
    if (!claim) continue;
    const block = canonicalCanvasBlock(claim.canvasBlock) ??
      (isSiteDescriptionFact(claim, description) ? "Value Propositions" : null);
    if (!block) continue;
    canvas[block].push({
      ...claim,
      // Research is never promoted above public-research, whatever the payload said.
      provenance: rank(claim.provenance) > RESEARCH_CEILING ? "public-research" : claim.provenance,
      canvasBlock: block,
    });
  }
  for (const block of CANVAS_BLOCKS) canvas[block] = dedupeBlock(canvas[block]);
  return canvas;
}

function supersede(claim: EvidenceClaim): EvidenceClaim {
  return {
    ...claim,
    confidence: Math.min(claim.confidence, SUPERSEDED_CONFIDENCE),
    sourceLabel: claim.sourceLabel.includes(SUPERSEDED_MARKER)
      ? claim.sourceLabel
      : `${claim.sourceLabel}${SUPERSEDED_MARKER}`,
  };
}

/** Longest client quote carried inline on a Canvas claim before it is cut. */
const MAX_QUOTE_CHARS = 240;

/**
 * Shorten a client quote for display without cutting a word in half.
 *
 * A hard `.slice(0, 240)` produced "…but the GC sti" in the audit report, in a document whose
 * central claim is that we quote the client exactly. The cut now lands on the last word boundary
 * that fits, trailing punctuation is dropped, and an ellipsis marks that there is more — so the
 * reader can always tell a shortened quote from a complete one.
 */
export function truncateQuote(value: unknown, limit = MAX_QUOTE_CHARS): string {
  const quote = trimmed(value);
  if (quote.length <= limit) return quote;
  // One character of headroom for the ellipsis that replaces the removed tail.
  const window = quote.slice(0, limit - 1);
  const boundary = window.search(/\s\S*$/);
  const kept = (boundary > 0 ? window.slice(0, boundary) : window).replace(/[\s,;:.!?—–-]+$/, "");
  return kept ? `${kept}…` : `${window.trimEnd()}…`;
}

function clientClaim(update: CanvasUpdate, block: CanvasBlock, statement: string): EvidenceClaim {
  const speaker = trimmed(update.speaker) || "unattributed speaker";
  const timestamp = trimmed(update.timestamp);
  const quote = truncateQuote(update.quote);
  const attribution = `Client call — ${speaker}${timestamp ? ` (${timestamp})` : ""}`;
  return {
    statement,
    provenance: "client-stated",
    confidence: CLIENT_STATED_CONFIDENCE,
    // The quote rides in the source label so the evidence stays attached to the claim.
    sourceLabel: quote ? `${attribution}: “${quote}”` : attribution,
    canvasBlock: block,
  };
}

/**
 * Apply client-stated Canvas corrections. Client claims go to the front of their block.
 * A superseded research claim is downgraded and labelled, never deleted.
 */
export function applyCanvasUpdates(canvas: CanvasInput, updates: CanvasUpdate[]): Canvas {
  const next = collect(canvas);
  if (!Array.isArray(updates)) {
    for (const block of CANVAS_BLOCKS) next[block] = dedupeBlock(next[block]);
    return next;
  }
  for (const update of updates) {
    if (!update || typeof update !== "object") continue;
    const block = canonicalCanvasBlock(update.canvasBlock);
    const statement = trimmed(update.statement);
    if (!block || !statement) continue;
    const replaces = normalizeStatement(trimmed(update.replacesResearchStatement));
    if (replaces) {
      next[block] = next[block].map((claim) =>
        claim.provenance === "public-research" && normalizeStatement(claim.statement) === replaces
          ? supersede(claim)
          : claim,
      );
    }
    next[block] = [clientClaim(update, block, statement), ...next[block]];
  }
  // Dedupe last so a client claim that restates research keeps the front slot and wins.
  for (const block of CANVAS_BLOCKS) next[block] = dedupeBlock(next[block]);
  return next;
}

/** Union two Canvases. Existing ordering is preserved; the strongest provenance wins a collision. */
export function mergeCanvas(existing: CanvasInput, incoming: CanvasInput): Canvas {
  const base = collect(existing);
  const added = collect(incoming);
  const merged = emptyCanvas();
  for (const block of CANVAS_BLOCKS) merged[block] = dedupeBlock([...base[block], ...added[block]]);
  return merged;
}

/** Per-block evidence coverage, in canonical block order. */
export function canvasCoverage(
  canvas: CanvasInput,
): Array<{ block: CanvasBlock; claimCount: number; strongestProvenance: Provenance | "gap" }> {
  const normalized = collect(canvas);
  return CANVAS_BLOCKS.map((block) => {
    const claims = dedupeBlock(normalized[block]);
    const strongest = claims.reduce<Provenance | "gap">(
      (best, claim) => (rank(claim.provenance) > rank(best) ? claim.provenance : best),
      "gap",
    );
    return { block, claimCount: claims.length, strongestProvenance: claims.length ? strongest : "gap" };
  });
}

/**
 * Fail-closed: the Canvas counts as client-confirmed only when every one of the nine
 * blocks carries at least one client-stated claim. Public research never satisfies this.
 */
export function canvasIsClientConfirmed(canvas: CanvasInput): boolean {
  const normalized = collect(canvas);
  return CANVAS_BLOCKS.every((block) => normalized[block].some((claim) => claim.provenance === "client-stated"));
}
