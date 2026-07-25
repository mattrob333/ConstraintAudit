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

The deployed prototype can create engagements, conduct source-backed OpenAI web research, display a dynamic Business Model Canvas, approve a readiness-brief send intent, run consent-gated calls, parse pasted transcripts with deterministic rules, enforce provisional-baseline and diagnosis gates, persist records in D1, and generate internal Markdown artifacts. The Value Flow and guided Call 1 script are still fixed frontend scaffolds; file upload, full transcript reconciliation, formal document renderers, CRM execution, most connectors, app tenancy, Sprint measurement, and catalog write-back remain incomplete.

## Reading order

1. [Developer handoff](../DEVELOPER_HANDOFF.md)
2. [Target audit workflow](../public/docs/workflow.md)
3. [System architecture](architecture/system-overview.md)
4. [Research and evidence model](domain/research-and-evidence.md)
5. [Current integration status](integrations/status-and-authorization.md)
6. [Production-readiness roadmap](roadmap/production-readiness.md)
7. [Verification guide](testing/verification.md)

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

## Key source files

- `app/components/AdvisorCockpit.tsx` — all advisor-facing screens and current UI state.
- `app/api/` — engagement, research, transcript, approval, artifact, CRM-intent, activity, and integration endpoints.
- `lib/workflow.ts` — domain types and explicit workflow-state model.
- `lib/actions.ts` — orchestration of research, readiness artifacts, transcripts, findings, deliverables, and intents.
- `lib/research.ts` — URL safety and deterministic website research.
- `lib/openai-research.ts` — OpenAI Responses API web research.
- `lib/openai-research-schema.ts` — strict response schema and source-backed mapping.
- `lib/transcript.ts` — current deterministic transcript parser and constraint rules.
- `lib/fireflies.ts` — direct Fireflies transcript import.
- `lib/deliverables.ts` — Markdown artifact templates.
- `lib/store.ts`, `db/schema.ts` — D1 persistence.
- `tests/` — rendered and backend workflow tests.

## Canonical documentation

- `public/docs/workflow.md` — approved target workflow.
- `README.md` — setup, architecture, and capability truth.
- `DEVELOPER_HANDOFF.md` — current gaps and next implementation slices.
- `INTEGRATIONS.md` — integration contracts and authorization boundaries.
- `DEVELOPMENT_LOG.md` — dated implementation evidence.

## Critical warning for future agents

Do not infer that the Flow of Work, live-call questions, document destinations, or connector buttons are fully implemented merely because the UI displays them. Inspect the data contract, event handler, API route, persistence action, and test before calling a capability shipped.
