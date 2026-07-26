---
type: Domain Model
title: Research and Evidence Model
description: Tier 4 provenance rules, the research contract including value flow and discovery questions, the canonical Business Model Canvas, constraint hypotheses, transcript evidence, baseline and delta handling, and remaining data-contract gaps.
tags: [evidence, provenance, research, canvas, constraints, value-flow, metrics]
---

# Research and evidence model

## Evidence vocabulary

| Display status | Stored provenance | Meaning |
| --- | --- | --- |
| Known | `client-stated` or `doc` | Direct client statement or authoritative supplied document |
| Inferred | `public-research` | Public source not yet confirmed by the client |
| Assumed | `advisor-note` | Working hypothesis that must be confirmed or killed |
| Missing | `gap` | Required information not yet established |

The required traceability chain is:

```text
claim -> customer statement -> transcript -> confirmation status -> recommendation -> implementation
```

## Research contract (shipped)

`ResearchSynthesis` in `lib/workflow.ts` contains:

- `sourceUrl`, `fetchedAt`, `fetchStatus`;
- `title` and `description`;
- source-backed `facts` mapped to Canvas blocks;
- `gaps`;
- `constraintHypotheses`;
- `valueFlow: ValueFlowStep[]`;
- `discoveryQuestions: DiscoveryQuestion[]`;
- provider metadata (`researchMode`, `providerStatus`, `providerModel`, `sourceCount`).

Both `valueFlow` and `discoveryQuestions` are produced deterministically by `synthesizeResearch()` in `lib/research.ts` with **no API key required**, then optionally replaced or extended by the strict OpenAI schema in `lib/openai-research.ts` and parsed in `lib/openai-research-schema.ts`. A flow is ordered as a whole, so the enrichment step takes the model's flow or keeps the deterministic one; it never splices two flows together. Questions merge per section: model sections win, deterministic sections the model did not cover are retained.

### The research ceiling

Research output can never be `client-stated` or `doc`. `RESEARCH_EVIDENCE_STATUSES` in `lib/openai-research-schema.ts` admits only `public-research`, `advisor-note`, and `gap`, and `buildCanvasFromResearch()` in `lib/canvas.ts` independently caps any research claim at `public-research`.

Source verification is enforced twice over:

- A **fact** whose `source_url` is not in the set of URLs the web-search tool actually retrieved is dropped entirely, as is a fact whose Canvas block is not a real block.
- A **value-flow step or discovery question** with an unverifiable source URL is not dropped: its `sourceUrls` are emptied and its `evidenceStatus` is downgraded to `gap`. A proposed step is a question to confirm, not a claim of fact, so it survives as an explicit unknown.

The deterministic path applies the same discipline. When the public page cannot be read, `buildValueFlow()` marks every step `gap` with an empty source list and a confirmation question, and the description says outright that no public source describes the step. It does not invent a flow it cannot see.

### Value flow steps

`ValueFlowStep` carries `id`, `order`, `name`, `description`, `input`, `output`, `actor`, `system`, `evidenceStatus`, `sourceUrls`, `confidence`, and `confirmationQuestion`. The type of `evidenceStatus` is narrowed at compile time to `"public-research" | "advisor-note" | "gap"`, so research alone cannot mark a step client-confirmed.

Unconfirmed actors and systems are recorded as `"Unconfirmed"` rather than guessed.

### Discovery questions

`DiscoveryQuestion` carries `id`, `section`, `question`, `whyItMatters`, `publicAssumption`, `sourceUrls`, `evidenceStatus`, an optional `canvasBlock` / `flowStepId` / `hypothesisId` anchor, `expectedAnswerType`, `required`, and `followUps`. The sections are `demand`, `promise`, `flow`, `constraint`, `baseline`, `roles`, `feasibility`.

Every question is anchored to a fact, gap, Canvas block, flow step, or hypothesis so the live call is specific to the company. When research produces no questions at all, `AdvisorCockpit.tsx` falls back to four explicitly generic prompts and labels them as such on screen — they assert nothing about the client.

## The canonical Canvas

There is one Canvas, stored at `engagement.data.canvas`, and `lib/canvas.ts` owns every operation on it.

| Function | Purpose |
| --- | --- |
| `buildCanvasFromResearch` | Nine-block Canvas from research facts, capped at `public-research` |
| `applyCanvasUpdates` | Apply client-stated transcript corrections |
| `mergeCanvas` | Union two Canvases; strongest provenance wins a collision |
| `canvasCoverage` | Per-block claim count and strongest provenance |
| `canvasIsClientConfirmed` | True only when all nine blocks hold a client-stated claim |

Rules that follow from the source:

- **Client evidence supersedes without deleting.** A research claim replaced by client testimony has its confidence lowered and its source label suffixed with `(superseded by client evidence)`; it stays in the block and stays auditable.
- **A claim never climbs the provenance ladder.** Merging is by rank — `client-stated` > `doc` > `public-research` > `advisor-note` > `gap` — so a merge cannot downgrade client evidence to research.
- **Block names are canonicalized.** `canonicalCanvasBlock()` in `lib/workflow.ts` maps `"Key Partnerships"` and singular or legacy spellings onto the nine canonical block names, so historic records and the research schema converge on one Canvas.
- **An unplaceable fact is dropped, not guessed.** Losing a fact is safer than filing it under a block its source does not support.

Not yet implemented: an explicit `canvasRevision` version number, and a `researchQuality` coverage/source-authority signal for deciding when to route to a fallback provider. Both remain specified-but-not-implemented on the roadmap.

## Constraint types

The domain supports `capacity`, `latency`, `quality`, `knowledge`, and `policy`.

`lib/transcript.ts` selects one type from client-stated lines and maps it to a Canvas block. The analyzer is now considerably deeper than a single keyword pass — it also derives contradictions, Canvas updates, flow confirmations, decisions, tasks, roles, and a broader set of metrics — but it remains **deterministic**, reporting `analysisMode: "deterministic"`. Model-assisted transcript synthesis is specified and not implemented.

## Transcript evidence

All of the following are derived only from lines whose provenance is `client-stated`:

- **Contradictions** — a research statement the client corrected, confirmed, or left unresolved, matched by content-word overlap and recorded with the client's quote, speaker, and timestamp.
- **Canvas updates** — a client statement that supersedes or adds to a Canvas block, carrying `replacesResearchStatement` when it displaces a research claim.
- **Flow confirmations** — a step marked `confirmed`, `corrected`, or `unconfirmed` against the researched flow.
- **Decisions and tasks** — with quote, speaker, timestamp, owner, and an optional `flowStepId`.
- **Roles** — a `RoleMapEntry` per person traced through the flow, recording who does the task, who is accountable, judgment versus grind, approval authority, and single-point dependency.
- **Metrics** — value, unit, period, quote, speaker, and timestamp.

Call 2 reconciles against Call 1: `synthesizeTranscript` receives `priorSynthesis` and raises an explicit gap when the new constraint candidate conflicts with the prior one, rather than silently overwriting it.

## Baseline rule

A confirmed baseline requires a metric name, value, unit, period, source, and accountable owner. If any required element is unavailable, the finding remains provisional.

No benchmark may substitute for client evidence. The projected delta remains a formula with named inputs until measurements exist.

## Measured delta rule

`computeMetricDelta()` in `lib/workflow.ts` governs the before/after number, and it refuses far more often than it computes. A delta requires **two client-confirmed readings in the same unit and the same period**. Otherwise it returns `null` plus an explicit `deltaBlockedReason` — an unconfirmed starting metric, a non-numeric reading, or incomparable units and periods each produce a stated reason instead of a number.

The distinction that matters most:

- `direction` is arithmetic only: `increased`, `decreased`, or `unchanged`.
- `interpretation` stays `not-interpreted` unless the advisor supplies `improvedWhen: "higher" | "lower"`.

The app must never guess whether a change is good. A shorter turnaround is a win; a smaller throughput is not. Only the advisor can say which way is better for a given metric.

## Speaker provenance

Client-attributed lines may support evidence. Advisor lines remain notes. Unknown-speaker lines remain gaps unless a human maps the speaker role. No analyzer may promote an unknown or advisor line into client evidence.

## Provider policy

OpenAI is the active research provider; deterministic website research is the no-key and provider-failure fallback and is never merely a stub. Exa (retrieval fallback), Firecrawl (targeted extraction), and Apollo (paid enrichment) are **not implemented**. Provider identity never changes evidence status: the underlying source determines provenance.
