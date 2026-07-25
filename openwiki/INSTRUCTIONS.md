# Tier 4 Advisor Cockpit Wiki Instructions

This file is the shared, human-authored brief for repository wiki maintenance.

## Purpose

Maintain a concise, source-grounded knowledge base that lets another AI agent or developer understand:

- what the Tier 4 Throughput Audit is;
- what the application actually ships;
- what the approved workflow requires;
- where shipped behavior and target behavior differ;
- how evidence, consent, approvals, and missing baselines are governed;
- which integrations execute and which only create intents;
- what to implement next and how to verify it.

## Canonical sources

Use these in priority order:

1. Current source code and tests for shipped behavior.
2. `public/docs/workflow.md` for approved target behavior.
3. `DEVELOPER_HANDOFF.md` for the current implementation gap and sequencing.
4. `INTEGRATIONS.md` for provider authorization and mutation boundaries.
5. `DEVELOPMENT_LOG.md` for dated decisions and verification evidence.

When sources disagree, document the disagreement. Do not silently promote a target requirement to a shipped capability.

## Required distinctions

Every affected page should distinguish where relevant:

- shipped;
- partially implemented;
- scaffolded;
- specified but not implemented;
- externally configured;
- authorization or product-owner decision required.

Do not write that email, CRM, Google Docs, PandaDoc, Exa, Firecrawl, Apollo, or catalog execution works unless the source contains and tests a real adapter.

## Product invariants

- Primary result: one constraint, one prescription, one metric, one named human owner.
- Evidence statuses: Known, Inferred, Assumed, Missing.
- Provenance: client-stated/doc, public-research, advisor-note, gap.
- Missing data stays missing.
- Missing baselines allow a provisional Findings Call but block numeric projections.
- External consequential actions require explicit approval.
- Task-level role mapping is limited to the traced flow.
- AI is a possible intervention, not the diagnostic category.

## Wiki maintenance

- Keep `index.md` and directory indexes concise.
- Give every non-reserved concept page YAML front matter with a non-empty `type`.
- Do not add front matter to `log.md`, `INSTRUCTIONS.md`, or nested `index.md` files.
- Use Mermaid only when it clarifies real architecture, sequence, state, or data relationships.
- Update `openwiki/log.md` with the date, affected pages, source evidence, and unresolved gaps.
- Never include secrets, raw transcripts, private client information, or local `.env` contents.
