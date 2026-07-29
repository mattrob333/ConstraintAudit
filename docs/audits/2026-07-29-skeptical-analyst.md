# Adversarial pipeline audit — skeptical analyst perspective

**Date:** 2026-07-29 · **Method:** read-only; probe scripts run against the shipped Meridian
worked example. The top three findings were demonstrated, not theorized. Roadmap distilled from
this report lives in `docs/FINISH_LINE.md`.

## Executive judgement

The evidence layer is genuinely good — provenance ranks, fail-closed speaker mapping, line-level
quote grounding, refusal to guess metric direction. It is the best-built part of the product.

But the pipeline verifies **that words were said**, and almost never **what the words mean**. The
two things a defensible constraint diagnosis requires — that the baseline number measures the thing
named, and that the chosen constraint is the thing the evidence actually supports — are both
unguarded. The grounding layer certified two fabricated metrics and a wrong constraint, with zero
rejections, using nothing but real client lines.

## F1 — A fabricated metric label, unit and period passes grounding and confirms the baseline
**Stage 3 · Likelihood: high · Fix: M**

`valueAppearsInLine` (`lib/openai-transcript-schema.ts:261-271`) checks only that the **digits** in
the model's `value` appear in the cited line. The `label`, `unit` and `period` are copied straight
from the model with no verification (`lib/openai-transcript-schema.ts:388-397`). `baselineStatusFor`
(`lib/transcript.ts:264-281`) then returns `Confirmed` on any metric with a label, a digit, a unit,
a period, a quote, a speaker and a timestamp.

Demonstrated against the real Meridian call-1 transcript:

| model emits | cited line actually says | grounding result |
|---|---|---|
| `label:"Quotes won per month", value:"9", unit:"quotes", period:"month"` | "It is more like **9 days per quote**…" | accepted |
| `label:"Rework rate", value:"20", unit:"percent", period:"job"` | "We are **winning about 20 percent** of what we quote." | accepted |

A `Confirmed` baseline is the master key: it unlocks `DIAGNOSIS_APPROVED` and `OUTCOME_MEASURED`
(`lib/workflow.ts:609-617`), sets `findingStatus: "client-verified"`
(`lib/openai-transcript.ts:556`), and unblocks the delta language. It then feeds
`inferMetricDirection` with the fabricated **name** — so "Rework rate" reads as lower-is-better,
and a win rate that improved from 20% to 28% would be printed to the client as **"worsened."**

The prompt makes this more likely: `INSTRUCTIONS` says "Leave unit or period empty rather than
guessing them" (`lib/openai-transcript.ts:277`) while the strict schema marks `unit` and `period`
as **required** (`lib/openai-transcript.ts:152`). Required-field pressure plus a "leave it blank"
instruction is the classic setup for confident filling.

**Fix (M):** require a `unit_span` and `period_span` per metric, each grounded as a contiguous span
of the cited line, exactly as quotes are. Where the client did not say the unit or period out loud,
the metric lands as `Partial` and never confirms a baseline. Add a `denominator_span` on the same
rule for any percentage.

## F2 — The system cannot record whether the kill condition fired
**Stage 3/4 · Likelihood: certain (structural) · Fix: S**

`OutcomeMeasurement` (`lib/workflow.ts:178-202`) has `startingMetric`, `endingMetric`, `delta`,
`constraintMoved`, `nextConstraintObserved`. There is **no field for the kill-condition test and no
field for the business metric the constraint was supposed to move.**

The shipped worked example walks straight into it. Dana's stop condition: *"If quotes go out in
three days and we still do not win any more of them. Then it was never speed, it was my price."*
The outcome records 9 days → 3 days, `constraintMoved: true`, and three supporting quotes — not one
of which mentions the win rate. The catalog entry publishes `improved`. The exact scenario the kill
condition was written to catch, declared a success, because the schema has nowhere to put the
disconfirming test.

**Fix (S):** add `killConditionResult: "held" | "fired" | "not-tested"` plus a required
`businessMetric: BaselineMetric` (before/after) to `OutcomeMeasurement`; block `CATALOG_WRITTEN`
while the result is `not-tested`.

## F3 — The constraint is unconstrained by relevance; empty citations auto-ground
**Stage 3 · Likelihood: high · Fix: M**

`groundConstraint` (`lib/openai-transcript-schema.ts:580-611`) accepts any constraint whose
evidence array is non-empty (`:599`). Nothing checks that the cited lines relate to the constraint
type or Canvas block. Worse, `groundCitation` returns `ok` for a line number with **no quote text
at all** (`:206`). Demonstrated: a `capacity`/`Key Resources` constraint grounded onto a whiteboard
logging line and a question ("A lot. Rosa, what are we at?"). The `reason` string per quote is
model-authored and never checked (`:370`). "Every quote is technically real, the story is
invented" — and the tool has no defence.

**Fix (M):** drop the `!quote → ok` branch; require ≥2 distinct grounded client spans; require a
per-citation tag (symptom / mechanism / magnitude / single-point-dependency) and reject a
constraint with no `mechanism` citation. Require the two strongest rival hypotheses with the line
that argues against each.

## F4 — Baseline picked by "first number with a period", not by relation to the constraint
**Stage 3 · Likelihood: near-certain · Fix: S**

Both paths choose the baseline identically:
`metrics.find(item => item.period && /\d/.test(item.value)) ?? metrics[0]`
(`lib/openai-transcript.ts:670`, `lib/transcript.ts:726`). Running the deterministic pipeline on
the real Meridian call-1 transcript yields constraint `latency | Key Activities` with a Confirmed
baseline of **"30 requests / month"** — monthly enquiry volume as the baseline for a latency
constraint. Thirteen metrics were extracted, including "four years" (the website's age) and "seven
months" (an ex-employee's tenure); any can become the baseline by ordering. `metricLabel`
(`lib/transcript.ts:232-236`) produces names like "Client-stated day metric", which then feed
direction inference and the catalog.

**Fix (S):** model nominates exactly one `baseline_metric_id` and justifies it against the
constraint; deterministic path selects by dimension match (latency→time, capacity→count/period,
quality→rate) or returns `Missing`.

## F5 — Same transcript, two different constraints, depending on whether an HTTP call succeeded
**Stage 3 · Likelihood: high · Fix: M**

`synthesizeTranscriptWithOpenAI` has a bare `catch {}` that silently degrades to the deterministic
reading (`lib/openai-transcript.ts:407-414`). On the canonical example the two paths disagree:
model/demo says **knowledge** (price book); deterministic says **latency** (visible queue, owner,
service-time target). Two advisors uploading the identical transcript get different diagnoses with
nothing in the UI saying why.

Second-order bug: the comment at `lib/openai-transcript.ts:607-611` promises disagreement keeps the
finding provisional. It does not — `verified` is computed at `:556` from `baselineStatus`,
`callNumber` and `priorConflict` only; `disagrees` pushes a gap string and nothing else.

**Fix (M):** retry once on 5xx/timeout; surface provider failure as a blocking advisor decision;
make `disagrees` force `provisional` (one line at `:556`).

## F6 — The advisor's baseline override accepts any five non-empty strings
**Stage 3 · Likelihood: medium · Fix: S**

`updateFinding` (`lib/actions.ts:471-475`): `baselineConfirmed` is
`Boolean(name && value && unit && period && source)`. `{value:"nine-ish", source:"Dana said so"}`
confirms a baseline and passes `requireDiagnosisApprovalEvidence` (`lib/guards.ts:57-71`, which
requires one client-stated quote with no relation to the constraint or baseline).

**Fix (S):** require `parseMeasure(value) !== null` (exists at `lib/workflow.ts:521`) and a
`source` resolving to a stored transcript line id.

## F7 — Research: the company's own URL is a blank cheque
**Stage 1 · Likelihood: high · Fix: M**

`parseOpenAIResearchPayload` adds the client's website to `acceptedSources` unconditionally
(`lib/openai-research-schema.ts:227-229`) — any statement attributed to it is retained without the
page being checked. `collectOpenAIWebSources` accepts any object carrying a `url` and any `title`
key (`:117-122`). No per-claim snippet, retrieval date, or anchor is required.

**Fix (M):** required `source_quote` (≤200 chars) per fact/flow step, verified as a substring of
fetched page text for same-domain claims; primary URL must be cited via actual retrieval like any
other source.

## F8 — Research is not reproducible, and re-running it corrupts prior call data
**Stage 1 · Likelihood: high · Fix: M**

No seed/retry/cache (`lib/openai-research.ts:193-208`); `web_search` varies by hour. Consequences
in `runResearch`: `mergeCanvas` **unions** old and new research (`lib/actions.ts:142-145`) so
contradictory claims accumulate with no run identifier; `valueFlow` replaces wholesale
(`lib/actions.ts:154`) while flow ids are positional (`flow_${index+1}`), so stored
`flowConfirmations` and task `flowStepId`s silently re-bind to different steps.

**Fix (M):** run-stamped research stored as a list; content-derived flow ids; canvas claims tagged
with `runId` so a re-run supersedes.

## F9 — Real-website failure modes the deterministic path cannot survive
**Stage 1 · Likelihood: high for a meaningful share of SMBs · Fix: M**

One URL fetched, `text/html` only, 8s, 500KB, no JS (`lib/research.ts:597-599`). JS-rendered SPAs
extract almost nothing → generic questions. Thin sites → all six flow steps `gap` at 0.2. No
multi-line/multi-location/franchise handling. No staleness capture (the demo client says the
website is four years old; no field records it). `TYPE_SIGNALS` (`lib/research.ts:13-19`) maps
marketing words ("fast", "delivery", "turnaround") to a **latency** hypothesis — the constraint
prior is whatever the marketing team wrote.

**Fix (M):** fetch `/`, `/about`, `/services`, `/contact` + sitemap top pages; explicit
`fetchStatus: "unreadable"` surfaced in UI; staleness signal; drop the keyword→type mapping.

## F10 — Questions do not demand the structure the baseline needs; kill conditions are tautologies
**Stage 2 · Likelihood: certain · Fix: M**

Baseline gaps are hardcoded and identical for every company (`lib/research.ts:531-538`).
`DiscoveryQuestion` has no structured expectation — no `expectedMetricName/unit/period/
denominator/sourceOfTruth` (`lib/workflow.ts:304`), so nothing downstream can check "did we get the
number this question asked for, in the unit it asked for" — which is why F1 and F4 are unguarded.
Nothing asks for denominators, sample sizes, or windows. Deterministic kill conditions are circular
("Flow evidence shows ${type} is not limiting throughput", `lib/research.ts:528`). Unanswered-
question detection is word-overlap at 0.35 (`lib/transcript.ts:596-606`) and produced ~8 false
gaps per call — including flagging as unanswered a question Dana answered verbatim.

**Fix (M):** `expected {metricName, unit, period, denominator, sourceOfTruth}` on number questions;
gaps derived from hypotheses; kill conditions structured as `{metric, comparator, threshold,
window}`; grounded per-question `answered_by_line` citations.

## As the CFO's analyst: disproving the Meridian finding

The finding — knowledge constraint at quote pricing, baseline 9 days per quote — is not
established, and the tool does not capture what would establish it:

- **The baseline is one recollection of one unaudited spreadsheet.** No *n*, no window, no
  definition of "logged", and the same speaker states a 2-to-21-day spread on a stated mean of 9 —
  a right-skewed distribution where the median is plausibly 5. `BaselineMetric`
  (`lib/workflow.ts:423-429`) has nowhere to put any of it.
- **The causal claim is the client agreeing with the advisor's own hypothesis** ("We lose on speed.
  I know we do" → read back on call 2 → "That is it."). Zero lost-bid reason data exists.
- **The win rate has no denominator, no window, no comparison group** — and declined over exactly
  the period the company grew 57%, bought a CNC, and moved upmarket: a mix shift that lowers win
  rate at any turnaround.
- **Price — the owner's own named alternative — was never examined.** Capacity was dismissed on
  n=1 (one estimator, seven months, who quit because the owner overrode his numbers), while the
  transcript supports 30–60 hours/month of pricing loaded on the owner. The tool's own
  deterministic engine reads the same transcript as **latency** — a third answer.
- **Victory was declared on the proxy.** Turnaround 9→3; the client's kill condition required the
  win rate to move; the outcome record contains no win-rate reading and has no field for one.

> **The paragraph for the CFO:** "The audit's central claim — that a nine-day quote turnaround is
> this business's binding constraint — rests on a single unaudited average from one spreadsheet,
> with no sample size, no date range, and a self-reported spread of two to twenty-one days that
> makes the mean unreliable on its face. The causal step from 'quotes are slow' to 'slowness is
> why we lose work' is not evidenced at all; it is the owner's own prior, restated to him by the
> advisor on the second call and recorded as his confirmation. No lost bid was ever traced to a
> reason. The win rate cited as the cost of the constraint has no denominator, no period, and no
> comparison group, and it declined over exactly the period in which the company grew by 57%,
> bought a CNC, and moved upmarket into larger packages against different competitors — a mix
> shift that would depress win rate at any turnaround speed. Price, the alternative the owner
> himself named, was never examined. And the engagement declares success on a four-week turnaround
> improvement while the owner's own stated stop condition — that the win rate must move, or speed
> was never the constraint — was never measured; the tool has no field in which to record it."

Every sentence in that paragraph is permitted by the current system.

## Stage 4 — Output structure for benchmarks and catalog matching

Taxonomy is partial: `ConstraintType` (5) × `CanvasBlock` (9) are enums; everything else is free
text (`pattern` auto-generated at `lib/actions.ts:1138`; `measuredResult` a rendered sentence).
Metrics are not normalized (`BaselineMetric.name` free text; `computeMetricDelta` requires exact
string equality on unit and period, `lib/workflow.ts:562-568`, so mismatched strings silently block
the delta). "Median quote-turnaround across 50 audits" is impossible twice over: storage (all data
in `engagements.data_json`, no findings/metrics/catalog tables) and semantics (no metric identity,
no industry code, no size field). The CRM write-back carries no constraint type, metric, or
baseline value (`lib/actions.ts:565-583`).

**Minimal schema changes:** (a) canonical metric identity on `BaselineMetric` — `metricKey`,
canonical unit/period enums, `sampleSize`, `windowStart/End`, `distribution {p50,p90}`,
`sourceSystem`; (b) a findings/outcomes projection table in real columns written at
`DIAGNOSIS_APPROVED` / `OUTCOME_MEASURED`; (c) a structured catalog entry — `mechanism` enum
(single_point_dependency, queue_before_scarce_resource, approval_gate, rework_loop,
undocumented_tacit_knowledge, batch_size, handoff_latency), `preconditions[]`, `antiPatterns[]`,
industry codes, size band, numeric measured delta; `predictedNextConstraint` as a
`{constraintType, canvasBlock}` pair.

**Matching verdict: controlled taxonomy + attribute filters + embedding rank. Not a graph
database.** Dozens-to-hundreds of engagements is not graph territory; the relationships are
enumerable and fit in memory. Hard filters must be hard (preconditions/anti-patterns are booleans;
embeddings would happily rank a disqualified entry #1 on prose similarity). Filter first, rank
second, cap at 10, show matched attributes + similarity — the advisor is the final matcher.
Revisit at ~5,000 entries or when the `predictedNextConstraint` chain needs multi-hop queries.

## Minimal ordered set to make constraint identification defensibly accurate

1. Ground unit/period/denominator, not just digits (F1, M)
2. Bind the baseline to the constraint (F4, S)
3. Require relevance and rivals on the constraint (F3, M)
4. Make disagreement and provider failure blocking, not silent (F5, M)
5. Structure the kill condition and test it at outcome (F2+F10, S+M)
6. Validate the advisor baseline override (F6, S)
7. Give questions a structured expectation (F10, M)
8. Make research reproducible and non-destructive (F7+F8, M)
9. Normalize metrics and project findings into columns (Stage 4 a+b, M)
10. Structure the catalog entry and build filter-then-rank matching (Stage 4 c, M)

Items 1–4 change whether the diagnosis is defensible. Items 5–6 stop a bad diagnosis being
declared a success. Everything after is leverage.
