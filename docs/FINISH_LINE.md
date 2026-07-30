# Finish Line — prioritized roadmap from the three-perspective audit

**Date:** 2026-07-29
**Inputs:** a client/advisor product audit and a skeptical-analyst pipeline audit (full reports
in `docs/audits/`), plus a pipeline review of the research → questions → synthesis → output chain.
Findings referenced as (C#) = client/advisor audit, (F#) = analyst audit.

**The one-sentence verdict:** the evidence layer is the product's spine and it is genuinely good,
but today it verifies *that words were said*, not *what they mean* — and the advisor cannot put
their own judgment into the finding. Fix those two things first; everything else is leverage.

---

## Phase 1 — Trust the diagnosis (the non-negotiable)

The constraint identification must survive a skeptical CFO. These items change whether the
diagnosis is defensible. Demonstrated exploits exist for 1, 2, and 4.

| # | Change | Source | Size |
|---|--------|--------|------|
| 1.1 | Ground the metric's **unit, period, and denominator** as spans of the cited line, not just the digits. A metric whose unit/period was never said lands as `Partial` and cannot confirm a baseline | F1 | M |
| 1.2 | **Bind the baseline to the constraint**: the model nominates one `baseline_metric_id` and justifies it; the deterministic path matches metric dimension to constraint type (latency→time, capacity→count/period, quality→rate) or returns `Missing` — never "first number with a period" | F4 | S |
| 1.3 | **Constraint relevance + rivals**: drop the empty-quote auto-ground; require ≥2 grounded client spans, one tagged `mechanism`; require the two strongest rejected hypotheses each with the line that kills them (this also populates the empty appendix, C3) | F3 | M |
| 1.4 | **Disagreement and provider failure become blocking**: retry once on 5xx/timeout; model-vs-deterministic disagreement forces `provisional` (the code comment already promises this); a failed model call is an advisor decision, not a silent downgrade | F5 | M |
| 1.5 | **Structured kill condition** `{metric, comparator, threshold, window}` on the finding; `killConditionResult: held/fired/not-tested` + a required business metric (before/after) on the outcome; catalog write blocked while `not-tested` | F2, F10 | S+M |
| 1.6 | **Validate the advisor baseline override**: numeric `value` via `parseMeasure`, `source` resolving to a stored transcript line | F6 | S |
| 1.7 | **Make the finding editable** — constraint, prescription, kill condition, evidence selection, baseline, appendix — with every edit recorded as `advisor-note` provenance beside the model's original. The advisor's judgment is part of accuracy, not a threat to it | C1, C17 | M |

## Phase 2 — Get the inputs right (research + questions)

| # | Change | Source | Size |
|---|--------|--------|------|
| 2.1 | Research call runs at high reasoning effort (it runs once per engagement; the cost is pennies), retries once, and surfaces a visible "research ran degraded — re-run" state. Add a **Re-run research** button + corrected-website field (the endpoints exist; the orphaned-engagement dead end is C16) | C16 | S |
| 2.2 | Per-fact `source_quote` (verbatim ≤200-char snippet) verified against fetched page text; stop auto-trusting the client's own URL as a source; tighten what counts as a citation | F7 | M |
| 2.3 | Fetch beyond one page (`/`, `/about`, `/services`, `/contact`, sitemap top pages); record content staleness; drop the marketing-keyword→constraint-type prior (it reads the marketing team's vocabulary as a diagnosis) | F9 | M |
| 2.4 | Reproducible, non-destructive research: run-stamped canvas claims that supersede rather than accumulate; content-derived value-flow step ids so re-running research cannot re-bind call confirmations to the wrong steps | F8 | M |
| 2.5 | Questions carry a structured expectation: `expected {metricName, unit, period, denominator, sourceOfTruth}` for number questions; baseline gaps derived from the constraint hypotheses instead of a fixed six-item list; every baseline question asks **where the number is written down** | F10 | M |
| 2.6 | Answered/unanswered detection via grounded per-question `answered_by_line` citations instead of word-overlap (which currently produces ~8 false gaps per call) | F10 | S |

## Phase 3 — Outputs that sell (client/advisor experience)

| # | Change | Source | Size |
|---|--------|--------|------|
| 3.1 | **Proposal becomes signable**: constraint-relevant numbers only (the filter already exists), fix the broken measurement-clock sentence, replace the static "Likelihood" line with the kill condition + evidence chain, add terms/date/signature block; wire `renderDeliverableDocument` into the documents route so printed copies carry client, advisor, date, confidentiality (it has zero callers today) | C7, C8 | S |
| 3.2 | **Close the demo-to-reality gap**: interpretive `symptoms` instead of quote echoes, populated appendix (falls out of 1.3), and a one-line banner in practice mode naming what a real run reproduces. Advisors sell what practice mode shows them | C2, C3 | M |
| 3.3 | **Make the call survivable**: persist guided-call answers/notes/values (an hour of typing currently evaporates on refresh and reaches nothing); an advisor-attested no-recording path that produces `advisor-note` evidence and a finding stamped as such | C4, C5 | M |
| 3.4 | **"Send to client" sends to the client**: a `deliverable_send` intent on the existing Resend adapter, same approval gate as the readiness brief | C6 | M |
| 3.5 | Report quality pass: one-page executive summary; plain-English labels for constraint type and canvas blocks; word-boundary quote truncation; value flow rendered as a diagram with the constrained step marked; outcome report states the measured change in business terms from client-confirmed figures only; personalized readiness brief; "repeatable/judgment-led" instead of "grind" in the client-facing roles map; developer spec generated only when the prescription implicates a system | C9, C11–C15, C18, C22 | S–M each |
| 3.6 | **Next-constraint fork**: "Start the next constraint" carries Canvas, flow, roles, and prior finding into a new engagement entering at Prepare. The easiest sale in the business is currently the one the software obstructs | C10 | M–L |

## Phase 4 — Benchmarks + catalog matching (the compounding business)

| # | Change | Source | Size |
|---|--------|--------|------|
| 4.1 | **Canonical metric identity** on `BaselineMetric`: `metricKey` slug, canonical unit/period enums, `sampleSize`, `windowStart/End`, `distribution {p50,p90}`, `sourceSystem`. Fixes the silent delta-block on unit-string mismatch and makes aggregation possible | F-Stage4a | M |
| 4.2 | **Findings/outcomes projection**: one row per engagement in real columns (constraint type, canvas block, metric key, baseline/ending numeric, direction, kill-condition result, industry code, headcount band, dates), written at diagnosis approval and outcome measurement. Mirror the same columns to the **Google Sheet** write-back — separate columns, never concatenated strings, so "median quote turnaround across 50 audits" is a formula, not a data-cleaning project | F-Stage4b | M |
| 4.3 | Capture **firmographics at research time** (industry code, headcount band, business-model type) as structured fields — cheap now, impossible to backfill | pipeline review | S |
| 4.4 | **Structured catalog entry**: `mechanism` enum (~12 values: single-point-dependency, approval-gate, rework-loop, undocumented-tacit-knowledge, handoff-latency, …), `preconditions[]`, `antiPatterns[]`, industry codes, size band, numeric measured delta. `predictedNextConstraint` becomes a `{constraintType, canvasBlock}` pair | F-Stage4c | M |
| 4.5 | **Solutions catalog + matching**: a Solutions tab in the Sheet (fill it gradually by hand) with the same taxonomy fields; matching = SQL filter on `(constraintType, canvasBlock, mechanism)` + preconditions ⊆ / antiPatterns ∩ = ∅, then embedding-rank the survivors, top 5 with attribute provenance shown. **Filter first, rank second, no graph database** at this scale; revisit at ~5,000 entries. The advisor is the final matcher | F-Stage4, pipeline review | M |
| 4.6 | Catalog read side (`GET /api/catalog` + browse screen) and a registry that shows call dates and days-since-update — the pipeline view for a book of business | C19, C20 | S–M |

---

## Sequencing recommendation

1. **Phase 1 first, whole.** Items 1.1–1.4 change whether the diagnosis is defensible; 1.5–1.6 stop
   a bad diagnosis being declared a success; 1.7 lets the advisor's judgment in. Nothing else
   matters while a fabricated metric label can confirm a baseline.
2. **Phase 3.1–3.3 next** — the proposal, the demo gap, and call survivability are what block a
   real engagement this month.
3. **Phase 2 and the rest of Phase 3 in parallel** rounds.
4. **Phase 4 last but designed now** — the schema fields (4.1, 4.3, structured kill condition) get
   added during Phases 1–2 so the data accumulates from the first real engagement even though the
   matching UI comes later.

## What is genuinely good and must not be weakened

The provenance discipline (client-stated / public-research / advisor-note / missing), line-grounded
quote verification, the refusal to invent projections or baselines, server-computed deltas with
direction inference the advisor can override, the findings-call agenda structure, and the roles
map's single-point-of-dependency analysis. Every change above adds structure or judgment *beside*
these rules — none loosens them.
