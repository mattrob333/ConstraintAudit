---
type: Testing Guide
title: Verification and Quality Gates
description: Automated tests, manual browser verification, evidence-safety expectations, and missing end-to-end coverage for the Tier 4 Advisor Cockpit.
tags: [testing, verification, e2e, governance]
---

# Verification and quality gates

## Current automated suite

At the 2026-07-25 handoff:

- lint passes;
- TypeScript passes;
- vinext production build passes;
- two rendered-frontend tests pass;
- fifteen backend workflow tests pass.

Backend coverage includes research fallback, source-backed Canvas facts, public-URL safety, transcript provenance, metric extraction, provisional findings, readiness-artifact binding, diagnosis evidence, consent, command boundaries, DNS/redirect safety, and response-size limits.

## Important missing coverage

The suite does not prove:

- different companies produce different value flows;
- different companies produce different live-call questions;
- the UI-visible Canvas and generated Audit Report use the same data;
- actual transcript files are ingested;
- OpenAI transcript synthesis reconciles research and both calls;
- any Google, email, PandaDoc, Exa, Firecrawl, or Apollo adapter works;
- multi-tenant records cannot cross authorization boundaries;
- Sprint measurement and catalog write-back complete.

## Required browser story

For research-to-call changes, test a cold engagement:

1. enter company and URL;
2. run research;
3. inspect retained sources and all nine Canvas blocks;
4. inspect proposed value flow and private questions;
5. approve the readiness brief;
6. confirm recording consent;
7. verify the live questions match the current engagement;
8. enter or import a real transcript;
9. verify client quotes and contradictions;
10. approve the Canvas commit;
11. complete Call 2 reconciliation;
12. verify the provisional/confirmed baseline rule;
13. generate deliverables and confirm canonical Canvas consistency.

Run the story for at least two contrasting companies and compare outputs.

## Failure paths

Every relevant slice must test:

- OpenAI unavailable;
- insufficient or unsupported public sources;
- unsafe URL or redirect;
- missing consent;
- unknown/advisor speaker lines;
- missing baseline;
- missing human owner;
- stale approval/artifact version;
- duplicate external-action retry;
- unauthorized engagement access once tenancy exists.

## Reporting completion

A passing unit test does not prove a client workflow is usable. Report automated gates and live browser evidence separately, and record remaining boundaries in `DEVELOPMENT_LOG.md`.
