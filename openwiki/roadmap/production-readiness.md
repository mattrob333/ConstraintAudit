---
type: Roadmap
title: Production Readiness Roadmap
description: Prioritized work required to make the research workflow adaptive, transcript analysis trustworthy, integrations operational, and the app safe for multiple advisors.
tags: [roadmap, production-readiness, integrations, tenancy]
---

# Production-readiness roadmap

## P0 — Make research drive the workflow

- Add a source-grounded Value Flow v0 to `ResearchSynthesis`.
- Add a structured, editable, company-specific discovery plan.
- Persist one canonical, versioned Business Model Canvas.
- Bind Flow of Work and Call 1 to engagement data rather than frontend constants.
- Prove two contrasting companies produce different flows and questions.
- Make the Integration Center render the complete backend status response.

**Exit:** research visibly changes the client session and the final report uses the same Canvas the advisor reviewed.

## P0 — Fix transcript evidence

- Ingest actual TXT, VTT, SRT, and DOCX content.
- Preserve immutable raw transcripts.
- Add structured transcript reconciliation against facts, flow, hypotheses, questions, roles, and baselines.
- Retain deterministic evidence and approval guards after model analysis.
- Preserve Call 1 and Call 2 history without silent overwrites.

**Exit:** a real transcript changes the canonical Canvas/flow through a reviewable evidence diff.

## P0 — Add identity and tenancy

- Require authenticated user identity.
- Add tenant and owner columns to engagement-owned records.
- Enforce ownership in every API query and mutation.
- Add retention, deletion, rate limiting, and audit logging.

**Exit:** two unrelated advisors cannot read or mutate one another's engagements, artifacts, transcripts, activities, or intents.

## P1 — Operational integrations

1. Fireflies import and health UX.
2. Google Sheets CRM execution.
3. Google Drive/Docs approved-artifact rendering.
4. Gmail or Resend approved delivery.
5. PandaDoc approved proposal/SOW draft and second send/signature approval.

Every adapter must be server-side, least-privilege, idempotent, observable, and separately approval-gated.

## P1 — Research resilience

- Build a fixed evaluation corpus.
- Score OpenAI source recall, unsupported-claim rate, Canvas coverage, value-flow usefulness, question specificity, latency, and cost.
- Add Exa only as a threshold-triggered fallback if it improves measured retrieval quality.
- Add Firecrawl for targeted known-site extraction failures.
- Keep Apollo optional and credit-gated.

## P2 — Formal documents and operational loop

- Render polished Diagnosis and Audit Report DOCX/PDF artifacts.
- Create collaborative Google Docs.
- Create proposal/SOW drafts from an approved PandaDoc template.
- Add a separate Roles and Responsibility Map artifact.
- Implement Sprint activation, baseline timestamp, ending measurement, actual delta, constraint migration, and catalog write-back.

## Product-owner decisions

- Advisor identity provider and invitation model
- Canonical CRM: D1 with Sheet export versus Google Sheet registry
- Google Workspace ownership and OAuth policy
- PandaDoc template and commercial approval policy
- Transcript retention and deletion period
- Per-engagement research budget and Exa fallback threshold
- Transcript-analysis model and cost ceiling
- OpenWiki CI schedule, secret policy, and telemetry preference
