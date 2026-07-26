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

The prototype now runs the whole workflow. It creates engagements; conducts deterministic and OpenAI-backed public research that also produces a company-specific value flow and discovery-question set; writes one canonical Business Model Canvas to `engagement.data.canvas`; decodes uploaded TXT, VTT, SRT, JSON, and DOCX transcripts into real speaker-attributed lines; reconciles those lines against research for contradictions, Canvas updates, flow confirmations, decisions, tasks, roles, and metrics; enforces consent, provisional-baseline, and diagnosis gates; scopes every D1 row to an owning advisor; generates Markdown deliverables plus a printable self-contained HTML rendering; and completes SPRINT_ACTIVE, OUTCOME_MEASURED, and CATALOG_WRITTEN. External actions execute for real through Resend, Google Sheets, and Google Drive/Docs, but only from an intent that was created `pending_review` and then explicitly approved. Still absent: Apollo and PandaDoc adapters, a Gmail sender, native DOCX or PDF output, model-assisted transcript synthesis, and Exa and Firecrawl.

## Status at a glance

| Capability | Status |
| --- | --- |
| One canonical Canvas, written by research and corrected by client evidence | Shipped |
| Research-produced value flow and anchored discovery questions | Shipped |
| Transcript file decoding (TXT, VTT, SRT, JSON, DOCX) | Shipped |
| Row-level advisor tenancy enforced in SQL | Shipped |
| Resend email, Google Sheets append/update, Google Docs creation | Shipped; approval-gated and credential-gated |
| Sprint activation, outcome measurement, catalog write-back | Shipped |
| Printable self-contained HTML deliverable rendering | Shipped |
| Transcript synthesis | Shipped as deterministic analysis; model-assisted synthesis is specified but not implemented |
| Apollo, PandaDoc | Connector-first; no direct adapter |
| Gmail | Specified but not implemented; Resend is the implemented sender |
| Native DOCX / PDF | Not implemented; Google Docs conversion is the route to a formal document |
| Exa, Firecrawl | Not implemented |
| Proof that two companies produce different flows and questions | Covered by `tests/gap-closure.test.mjs` |

## Reading order

1. [Developer handoff](../DEVELOPER_HANDOFF.md)
2. [Target audit workflow](../public/docs/workflow.md)
3. [System architecture](architecture/system-overview.md)
4. [Research and evidence model](domain/research-and-evidence.md)
5. [Throughput Audit lifecycle](workflows/throughput-audit-lifecycle.md)
6. [Current integration status](integrations/status-and-authorization.md)
7. [Production-readiness roadmap](roadmap/production-readiness.md)
8. [Verification guide](testing/verification.md)

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

`npm test` builds the application, runs two rendered-frontend tests, then runs `tests/backend-workflow.test.mjs` and `tests/gap-closure.test.mjs` — 26 backend tests together.

The application runs with no credentials at all. Without `OPENAI_API_KEY` research stays deterministic and still produces a flow and questions. Without a provider credential an approved intent returns `not-configured`, performs no network call, and remains approved so it can be retried later.

## Key source files

- `app/components/AdvisorCockpit.tsx` — every advisor-facing screen. Flow, call script, questions, and integration statuses come from server data; the stepper has seven stages ending in "Operate".
- `app/api/` — engagement, research, transcript, finding, deliverable, intent, sprint, outcome, catalog, publish, document, identity, activity, and integration endpoints.
- `lib/auth.ts` — `Principal`, `resolvePrincipal`, `requirePrincipal`, `ownerIdForEmail`, the local dev fallback, and `REQUIRE_ADVISOR_AUTH`.
- `lib/workflow.ts` — domain types, workflow-state order, `canonicalCanvasBlock()`, `computeMetricDelta()`.
- `lib/canvas.ts` — the one canonical Canvas: `buildCanvasFromResearch`, `applyCanvasUpdates`, `mergeCanvas`, `canvasCoverage`, `canvasIsClientConfirmed`.
- `lib/actions.ts` — research, readiness artifacts, transcripts, findings, deliverables, intent review and execution, sprint, outcome, and catalog orchestration.
- `lib/research.ts` — URL safety, deterministic website research, deterministic value flow and discovery questions.
- `lib/openai-research.ts` — OpenAI Responses API web research using the `web_search` tool.
- `lib/openai-research-schema.ts` — strict payload parsing and source-backed filtering of facts, flow steps, and questions.
- `lib/transcript-files.ts` — TXT, VTT, SRT, JSON, and DOCX decoding into `[MM:SS] Speaker: text` lines.
- `lib/transcript.ts` — deterministic transcript synthesis, reconciliation, role mapping, and constraint selection.
- `lib/integrations/` — Resend, Google Sheets, and Google Drive/Docs adapters plus OAuth and configuration reporting.
- `lib/fireflies.ts` — direct Fireflies transcript import.
- `lib/deliverables.ts` — Markdown artifact templates and `renderMarkdownToHtml()`.
- `lib/store.ts`, `db/schema.ts`, `drizzle/0001_tenancy.sql` — owner-scoped D1 persistence and the tenancy migration.
- `tests/` — rendered-frontend, backend-workflow, and gap-closure suites.

## Canonical documentation

- `public/docs/workflow.md` — approved target workflow.
- `public/docs/current-state.md` — dated snapshot of what is real versus scaffolded.
- `README.md` — setup, architecture, and capability truth.
- `DEVELOPER_HANDOFF.md` — gaps and next implementation slices.
- `INTEGRATIONS.md` — integration contracts and authorization boundaries.
- `DEVELOPMENT_LOG.md` — dated implementation evidence.

## Critical warning for future agents

A rendered screen is still not proof of a shipped capability. Inspect the data contract, event handler, API route, persistence action, and test before calling anything shipped. Two traps remain in this codebase:

- A connector card reading `configured` means credentials are present, not that the app may act. Execution still requires a separately approved intent.
- Transcript synthesis is deterministic keyword, overlap, and regex analysis. It is testable and honest, but it is not model-assisted reasoning and it will miss evidence a human would catch.

`DEVELOPER_HANDOFF.md`, `README.md`, and `public/docs/current-state.md` were all refreshed on 2026-07-26 and agree with the source. Where any document disagrees with the source in future, the source wins.
