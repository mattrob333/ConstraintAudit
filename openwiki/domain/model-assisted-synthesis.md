---
type: Domain Model
title: Model-Assisted Synthesis and Metric Direction
description: How the model transcript pass is grounded against real transcript lines, how its output merges with the deterministic reading, and the four-tier inference of which way a metric has to move to count as an improvement.
tags: [transcript, grounding, evidence, openai, metrics, direction, provenance]
---

# Model-assisted synthesis and metric direction

Two reasoning capabilities landed after the gap-closure change. Both share one design rule: **the model may reason, but it may not be the source of a fact.** Everything it says is checked back against something that already existed.

## Model-assisted transcript synthesis

### The two passes

`processTranscript()` in `lib/actions.ts` always runs `synthesizeTranscript()` — the deterministic keyword, overlap, and regex analyzer — first. It then hands the same parsed lines and the full business context to `synthesizeTranscriptWithOpenAI()` in `lib/openai-transcript.ts`.

The deterministic pass is the floor, not a stub. With no `OPENAI_API_KEY` the result is returned unchanged with `analysisMode: "deterministic"` and `modelStatus: "not-configured"`. On any failure at all — HTTP error, timeout (60 s), empty output, unparseable JSON — the same thing happens with `modelStatus: "failed"`. The `catch` is total; a model problem can never fail a transcript upload.

### What the model is asked for

The transcript is rendered as numbered lines, `<n> [timestamp] <speaker> (<provenance>): <text>`, and a strict JSON schema demands: a narrative, an optional constraint, quotes, metrics, contradictions, Canvas updates, flow confirmations, decisions, tasks, roles, unanswered required question ids, and gaps. Every citation is a line number plus the span of that line relied on.

The instructions state the rules the app enforces anyway, so the model is not fighting them: only `client-stated` lines may be cited; never invent a number, quote, name, date, baseline, system, or person; reason across turns and through paraphrase but cite the line that carries it; distinguish a symptom from the constraint; treat hedges as hedges and put the unconfirmed part in gaps; the narrative is at most 150 words of advisor interpretation and never client evidence.

### `groundModelSynthesis()` — the gate

`lib/openai-transcript-schema.ts` is synchronous, pure, and total: no network, no env, no throw. It re-checks every claim against the real `TranscriptLine[]`.

A citation grounds like this:

- **Primary form** is a 1-based line number into the exact numbered transcript the model was shown. The line must exist, must be `client-stated`, and the quoted span must be a contiguous substring of that line's text.
- **Fallback form**, when no line number is given, is a literal search across the transcript.
- Matching happens only in a normalized space: case-folded, whitespace-collapsed, with curly quotes, dashes, and ellipses unified so typography is never the reason a real quote fails. It is **exact-or-substring only — never fuzzy, never semantic**.
- Whole-line matches win over substring matches, so a fragment that also appears inside a longer line is never attributed to the wrong timestamp.
- On success the quote, speaker, and timestamp are **rewritten from the matched line**, not taken from what the model said. The model's transcription is never authoritative.

Additional checks beyond the citation:

| Claim type | Extra requirement |
| --- | --- |
| Metric | The number itself must appear in the matched client line, compared comma-free so `12,500` matches `12500` |
| Contradiction | `research_statement` must be a research fact that was actually supplied. With no research catalog there is nothing to check against, so the statement is kept as written and the client quote still has to ground |
| Canvas update | The block must resolve through `canonicalCanvasBlock()`; the stored statement is the client's own words, never the model's paraphrase |
| Flow confirmation | The `flow_step_id` must be one of the supplied steps. `unconfirmed` needs no citation; `confirmed` and `corrected` do |
| Decision / task owner | The person must be named somewhere in the transcript, a speaker label, or a traced flow actor. An unverifiable name is blanked, never invented |
| Role | The person must be named in the transcript **and** the entry must carry a grounded client line |
| Unanswered question | The id must exist in the supplied catalog and the question must actually be `required` |
| Constraint | The type must be a real `ConstraintType`, the block must resolve, and it must carry **at least one grounded evidence quote**. A constraint with nothing the client said behind it is exactly what must not ship |

Anything that fails is dropped **and recorded** in `rejections`, capped at 60. That distinction is the point of the module: a caller can always tell "the model found nothing" apart from "the model made something up and we caught it". A silent drop would be worse than a shown rejection.

The specific failure the module exists to catch is called out in the source: when a quote matches a line that is *not* `client-stated`, it is rejected with the offending provenance named rather than reported as "not found", because an advisor's words being cited as client evidence must never look like an absence of evidence.

### The merge

`merge()` in `lib/openai-transcript.ts` is a **union, never a replacement** — each pass catches things the other misses.

- Quotes, metrics, contradictions, decisions, tasks, Canvas updates, and roles are concatenated and deduped, with per-collection caps (12 quotes, 25 of most things, 12 roles).
- Roles with the same person are merged field by field: a claim from either pass is kept, and a `judgment` / `grind` disagreement collapses to `mixed` rather than picking a winner.
- A flow step's `unconfirmed` reading never overwrites a grounded one from either pass.
- A Canvas update whose statement is already a client-stated claim on the Canvas is dropped.
- `baselineStatus` is recomputed by `baselineStatusFor()` over the merged metrics. The governance rule is unchanged: the baseline is whatever the grounded metrics support and nothing else.
- Verification still requires call 2 **and** a confirmed baseline **and** no conflict with a prior call's constraint type. The model cannot grant `client-verified`.

The constraint candidate is the one single-winner decision, and there the **model wins**, because it reasons about symptom versus cause. When the two passes disagree on constraint type:

- the model's reading is shown;
- the deterministic pass's evidence is *not* carried into the model's finding, since it argues for a different constraint;
- the disagreement is written into `gaps` in plain language, and the finding stays provisional until the advisor resolves it.

The advisor decides. The model does not get to quietly overrule the deterministic reading.

### What the advisor sees

`TranscriptSynthesis` gained four fields, and `AdvisorCockpit.tsx` renders all four:

| Field | Rendered as |
| --- | --- |
| `analysisMode` | `"Model-assisted synthesis"` with the model name, or a warning note |
| `modelStatus` | Distinguishes "the model call failed", "no model is configured", and plain deterministic mode, each stating that what is on screen is the deterministic reading and "is not a deeper analysis" |
| `narrative` | Under an `Advisor note · model interpretation` pill, with the warning that nobody said it and it must never be quoted back to the client as their own words |
| `groundingRejections` | A collapsible "Discarded by evidence check · N claims" list, each with kind, reason, and the rejected text |

## Metric direction

`lib/metric-direction.ts` answers one question: which way does this metric have to move to count as an improvement? It exists because an earlier version guessed "up is good" and wrote "worsened" into a client report about a turnaround time that had halved.

### Four tiers

| Tier | Source value | Confidence | How |
| --- | --- | --- | --- |
| 1 | `advisor` | 1 | The advisor declared it. Always wins |
| 2 | `unit-table` | 0.75–0.9 | The unit's own dimension: elapsed time reads lower-is-better, problem nouns lower, per-period work counts higher, capture nouns higher |
| 3 | `metric-semantics` | 0.6–0.9 | The metric name, matched against the numerator only — the denominator of "cost per job" names what the metric is divided by, never which way is better |
| 4 | `model` | 0.6 | A cheap one-shot Responses API question, asked **only** where tiers 2 and 3 are silent or contradict each other |

Deliberate omissions in the unit table: currency (`$`, `£`, `€`) and `%` carry **no** direction, because neither says cost or revenue, rework or on-time. The name has to settle it.

Deliberate refusals in the name reader: matched words are consumed so "on-time delivery" never also scores as elapsed "time"; English compounds are head-final so the last word gets extra weight; a count noun only reads as throughput when it heads the name; and "days to quote" heads on a count noun but measures a duration, so the throughput reading is suppressed once any duration signal matched.

`context.constraintType` deliberately does **not** decide a direction. It is passed to the model as context only — a constraint type is too coarse to settle a specific metric.

### Refusing rather than guessing

When two readings of the name disagree and nothing settles them, the result is `improvedWhen: null`, `source: "none"`, `ambiguous: true`, and a basis that names both readings so the UI can ask a specific question: *"This metric reads two ways — it could count work stacked up waiting (lower is better) or count work or customers coming through (higher is better). The advisor has to say which one this metric is."*

`inferMetricDirection()` (tiers 1–3) is pure, synchronous, and total: garbage in returns `improvedWhen: null`, never a throw and never a guess. `resolveMetricDirection()` adds tier 4, and any model failure — no key, timeout, bad JSON, `"unclear"` — degrades to whatever tiers 2–3 concluded rather than throwing or blocking the advisor.

### Where it is used

- **`GET /api/metric-direction?name=&unit=&period=&constraintType=`** — a read-only preview. The outcome form calls it live, debounced 400 ms and abortable, while the advisor types, keying the response to the exact probe string so a stale reply is never shown for a different metric.
- **`measureOutcome()`** calls `resolveMetricDirection()` with `advisorDeclared: input.improvedWhen`, and records the result on `OutcomeMeasurement.directionInference` alongside `improvedWhen`.
- **`PATCH /api/engagements/:id/outcome`** with `{ improvedWhen }` corrects it afterwards. `correctOutcomeDirection()` recomputes the delta from the **unchanged** starting and ending metrics, stamps `directionInference` as `source: "advisor"`, `confidence: 1`, with a basis naming the advisor's email, and regenerates the outcome report. The measured numbers never change; only how they are read.

### The nuance the wiki previously got wrong

`computeMetricDelta()` still refuses to interpret a change without an `improvedWhen` — that rule is intact and tested. But `measureOutcome()` now supplies one from inference, so **an outcome can read "improved" without the advisor having declared anything.**

That is not a violation of the invariant so much as a change in what the invariant protects. The app still never silently guesses: `directionInference` records the source, the plain-language basis, and the confidence; the UI labels an inferred reading "Proposed, not decided" against an advisor choice's "You set this direction"; an ambiguous reading is never pre-selected; and one PATCH overrules it. Describe the app as always showing how an interpretation was reached — not as never reaching one.

## Coverage and gaps

| Element | Automated coverage |
| --- | --- |
| `groundModelSynthesis()` rejecting a fabricated quote | `tests/reasoning.test.mjs` |
| `groundModelSynthesis()` refusing to promote an advisor line | `tests/reasoning.test.mjs` |
| Grounded quotes rewritten from the transcript, not the model | `tests/reasoning.test.mjs` |
| `inferMetricDirection()` tiers 1–3, including the refusal case | `tests/reasoning.test.mjs` |
| `computeMetricDelta()` interpretation rules | `tests/gap-closure.test.mjs`, `tests/reasoning.test.mjs` |
| The `synthesizeTranscriptWithOpenAI()` HTTP path and its `merge()` | **None** |
| The tier-4 model call in `resolveMetricDirection()` | **None** |
| The model-vs-deterministic constraint disagreement gap | **None** |
