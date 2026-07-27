---
type: Quickstart Guide
title: Tier 4 Advisor Cockpit Quickstart
description: Repository orientation for agents and developers, including product purpose, current implementation truth, canonical documents, commands, and source map.
tags: [tier4, throughput-audit, quickstart, handoff]
---

# Tier 4 Advisor Cockpit quickstart

## Product purpose

The Tier 4 Advisor Cockpit guides an advisor through an evidence-grounded, two-call Throughput Audit. The intended result is one current constraint, one smallest prescription, one measurable metric, and one named human owner.

The application is not a generic AI-opportunity assessment. AI may be part of a prescription, but the diagnosis follows the client's actual flow of value and throughput constraint.

## Current truth in one paragraph

The prototype runs the whole workflow. It creates engagements; ingests advisor-supplied source documents as `doc` evidence (PDF is refused outright); conducts deterministic and OpenAI-backed public research that also produces a company-specific value flow and discovery-question set; writes one canonical Business Model Canvas to `engagement.data.canvas`; decodes uploaded TXT, VTT, SRT, JSON, and DOCX transcripts into real speaker-attributed lines; synthesizes those lines **both deterministically and with a reasoning model whose every citation is re-grounded against a real client-stated transcript line**; enforces consent, provisional-baseline, and diagnosis gates; scopes every D1 row to an owning advisor behind signature-verified Cloudflare Access; carries the advisor through the live call with a coaching rail that is absent from the DOM whenever the client can see the screen; generates six Markdown deliverables plus a printable self-contained HTML rendering; builds a Findings Call agenda; infers which direction of a metric counts as an improvement and lets the advisor overrule it afterwards; and completes SPRINT_ACTIVE, OUTCOME_MEASURED, and CATALOG_WRITTEN. A fully worked fictional engagement (Practice mode) lets an advisor rehearse the entire arc offline. External actions execute for real through Resend, Google Sheets, and Google Drive/Docs, but only from an intent that was created `pending_review` and then explicitly approved. Still absent: any outreach or prospecting funnel, per-advisor Google OAuth, Gmail, Apollo, and PandaDoc adapters, native DOCX or PDF output, and Exa and Firecrawl.

## Status at a glance

| Capability | Status |
| --- | --- |
| One canonical Canvas, written by research and corrected by client evidence | Shipped |
| Research-produced value flow and anchored discovery questions | Shipped |
| Transcript file decoding (TXT, VTT, SRT, JSON, DOCX) | Shipped |
| Model-assisted transcript synthesis with quote grounding | Shipped; deterministic synthesis is the fallback and the floor |
| Advisor-supplied source-document ingest (`POST /api/engagements/:id/sources`) | Shipped; PDF is refused, not silently mishandled |
| Metric-direction inference plus advisor correction | Shipped |
| Practice mode — one deterministic fictional engagement, end to end | Shipped |
| Cloudflare Access as identity provider, with real JWT signature verification | Shipped in code; requires deployment configuration |
| Row-level advisor tenancy enforced in SQL | Shipped |
| Advisor-only live-call coaching with an Escape panic key | Shipped |
| Findings Call agenda and client-facing presentation view | Shipped |
| Resend email, Google Sheets append/update, Google Docs creation | Shipped; approval-gated and credential-gated |
| Sprint activation, outcome measurement, catalog write-back | Shipped |
| Six Markdown deliverables including the Roles & Responsibility Map | Shipped |
| Printable self-contained HTML deliverable rendering | Shipped |
| Cloudflare Workers deployment | Configured and documented; the deploy has not been proven in this repository |
| Outreach / prospecting funnel | Not built |
| Per-advisor Google OAuth for actions | Not implemented; a single service refresh token is the only Google identity |
| Apollo, PandaDoc | Connector-first; no direct adapter |
| Gmail | Specified but not implemented; Resend is the implemented sender |
| Native DOCX / PDF | Not implemented; Google Docs conversion is the route to a formal document |
| Exa, Firecrawl | Not implemented |
| Proof that two companies produce different flows and questions | Covered by `tests/gap-closure.test.mjs` |

## Reading order

1. [Developer handoff](../DEVELOPER_HANDOFF.md)
2. [Target audit workflow](../public/docs/workflow.md)
3. [System architecture](architecture/system-overview.md)
4. [Identity and access](architecture/identity-and-access.md)
5. [Research and evidence model](domain/research-and-evidence.md)
6. [Model-assisted synthesis and metric direction](domain/model-assisted-synthesis.md)
7. [Throughput Audit lifecycle](workflows/throughput-audit-lifecycle.md)
8. [Practice mode](workflows/practice-mode.md)
9. [Current integration status](integrations/status-and-authorization.md)
10. [Production-readiness roadmap](roadmap/production-readiness.md)
11. [Verification guide](testing/verification.md)

## Run and verify

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev -- --port 5173 --strictPort
```

```powershell
npm run lint
npx tsc --noEmit
npm test
```

`npm test` builds the application, runs `tests/rendered-html.test.mjs` under `node --test` (2 tests), then runs `tests/backend-workflow.test.mjs`, `tests/gap-closure.test.mjs`, `tests/reasoning.test.mjs`, and `tests/practice-mode.test.mjs` under `tsx --test` (15 + 11 + 7 + 7 = 40 tests). **43 tests in total.**

The application runs with no credentials at all. Without `OPENAI_API_KEY` research stays deterministic and still produces a flow and questions, transcript synthesis stays deterministic and says so on screen, and metric direction falls back to its three deterministic tiers. Without a provider credential an approved intent returns `not-configured`, performs no network call, and remains approved so it can be retried later.

## Key source files

- `app/components/AdvisorCockpit.tsx` — every advisor-facing screen, in one client component. Flow, call script, coaching, and integration statuses come from server data; the stepper has seven stages ending in "Operate".
- `app/api/` — 25 route files covering engagement, research, transcript, finding, findings-agenda, source-document, deliverable, intent, sprint, outcome, catalog, publish, document, demo, metric-direction, identity, activity, and integration endpoints. **Every one of them resolves identity through `requirePrincipalAsync`.**
- `lib/auth.ts` — `Principal`, `advisorAuthMode()`, `resolvePrincipalAsync`, `requirePrincipalAsync`, `ownerIdForEmail`, the local dev fallback, and `REQUIRE_ADVISOR_AUTH`.
- `lib/access-jwt.ts` — RS256 verification of the `Cf-Access-Jwt-Assertion` header against the Access JWKS, with key caching and full claim checks.
- `lib/workflow.ts` — domain types, workflow-state order, `canonicalCanvasBlock()`, `computeMetricDelta()`, `DirectionInference`.
- `lib/canvas.ts` — the one canonical Canvas: `buildCanvasFromResearch`, `applyCanvasUpdates`, `mergeCanvas`, `canvasCoverage`, `canvasIsClientConfirmed`.
- `lib/actions.ts` — research, readiness artifacts, source ingest, transcripts, findings, findings agenda, deliverables, intent review and execution, demo seeding, sprint, outcome, direction correction, and catalog orchestration.
- `lib/research.ts` — URL safety, deterministic website research, deterministic value flow and discovery questions.
- `lib/openai-research.ts` / `lib/openai-research-schema.ts` — OpenAI Responses API web research and strict source-backed filtering.
- `lib/openai-transcript.ts` — the model transcript pass and the union merge with the deterministic reading.
- `lib/openai-transcript-schema.ts` — `groundModelSynthesis()`, the single gate every model citation passes through.
- `lib/metric-direction.ts` — tiered inference of which way a metric has to move to count as an improvement.
- `lib/demo.ts` — Practice mode: one deterministic, entirely fictional worked engagement.
- `lib/transcript-files.ts` — TXT, VTT, SRT, JSON, and DOCX decoding into `[MM:SS] Speaker: text` lines.
- `lib/transcript.ts` — deterministic transcript synthesis, reconciliation, role mapping, and constraint selection.
- `lib/integrations/` — Resend, Google Sheets, and Google Drive/Docs adapters plus OAuth and configuration reporting.
- `lib/fireflies.ts` — direct Fireflies transcript import.
- `lib/deliverables.ts` — Markdown artifact templates, `FIXED_SPRINT_PRICE_USD`, `generateRolesMap()`, `generateFindingsAgenda()`, and `renderMarkdownToHtml()`.
- `lib/store.ts`, `db/schema.ts`, `drizzle/` — owner-scoped D1 persistence and three migrations.
- `wrangler.jsonc`, `docs/DEPLOYMENT.md` — the Cloudflare Workers deployment configuration and walkthrough.
- `tests/` — rendered-frontend, backend-workflow, gap-closure, reasoning, and practice-mode suites.

## Canonical documentation

- `public/docs/workflow.md` — approved target workflow.
- `public/docs/current-state.md` — dated snapshot of what is real versus scaffolded.
- `README.md` — setup, architecture, and capability truth.
- `DEVELOPER_HANDOFF.md` — gaps and next implementation slices.
- `INTEGRATIONS.md` — integration contracts and authorization boundaries.
- `docs/DEPLOYMENT.md` — the Cloudflare Workers and Cloudflare Access deployment guide.
- `DEVELOPMENT_LOG.md` — dated implementation evidence.

## Critical warning for future agents

A rendered screen is still not proof of a shipped capability. Inspect the data contract, event handler, API route, persistence action, and test before calling anything shipped. Four traps remain in this codebase:

- A connector card reading `configured` means credentials are present, not that the app may act. Execution still requires a separately approved intent.
- Model-assisted synthesis being available does **not** mean the model's output is trusted. Every model claim is re-grounded against a real `client-stated` transcript line and dropped if it cannot be tied to one. With no `OPENAI_API_KEY`, or on any failure, the deterministic reading stands and the UI says so.
- `computeMetricDelta()` still refuses to interpret a change without an `improvedWhen`, but `measureOutcome()` now supplies one from `resolveMetricDirection()`. So an outcome can read "improved" **without the advisor having declared anything**. The inference is recorded in `directionInference` with its source, basis, and confidence, and `PATCH /api/engagements/:id/outcome` lets the advisor overrule it. Do not describe the app as never interpreting a delta on its own — describe it as always showing how the interpretation was reached.
- Cloudflare Access verification exists in code and is wired into every route, but this repository contains no evidence it has been exercised against a live Access deployment. Treat the identity boundary as implemented-but-unproven.
