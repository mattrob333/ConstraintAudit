# Current Build State and Developer Handoff

**Snapshot:** 2026-07-26  
**Status:** The workflow runs end to end. Records are scoped per advisor; set `REQUIRE_ADVISOR_AUTH=1` before exposing the app to more than one person.

## What is real

- Engagement state and artifacts persist in Cloudflare D1, scoped to the owning advisor in SQL.
- Public research uses safe deterministic website extraction and optional OpenAI Responses API web search.
- Research produces a company-specific value flow and discovery-question set, with or without an API key.
- One canonical Business Model Canvas is written by research and corrected by client evidence. The final Audit Report reads that same Canvas.
- The Flow of Work screen, the research questions, and the live call script are all generated from that engagement's research.
- Transcript upload decodes TXT, VTT, SRT, JSON, and DOCX into real speaker- and timestamp-attributed lines.
- Transcript synthesis reconciles against research and extracts contradictions, Canvas corrections, flow confirmations, decisions, tasks, roles, and metrics.
- Pre-Call Readiness approval, recording consent, evidence provenance, missing-baseline handling, and diagnosis approval guards work.
- Sprint activation, outcome measurement, and catalog write-back complete the workflow.
- Resend, Google Sheets, and Google Docs perform real external writes, reachable only from an explicitly approved intent.

## What is still scaffolded

- Transcript synthesis is deterministic pattern analysis, not model-assisted reasoning.
- Deliverables are Markdown plus printable HTML. There is no native DOCX or PDF generator; Google Docs conversion is the route to a formal document.
- Gmail has no adapter. Apollo and PandaDoc remain connector-first contracts.
- Exa and Firecrawl are not implemented.
- The value flow can be confirmed or contradicted by transcript evidence, but the advisor cannot yet edit a flow step directly during the call.

## Rules that keep a number honest

- A baseline is `Confirmed` only with a value, unit, period, source, speaker, and timestamp from a client-stated line.
- A before/after delta requires two client-confirmed readings in the same unit and period. Otherwise the app records why it is blocked and claims no number.
- Whether a change is an improvement is declared by the advisor, never inferred. A shorter turnaround is a win; a smaller throughput is not.

## Next required milestone

An in-call editor for value-flow steps, so the advisor can correct a step live and have the correction recorded as client-stated evidence.

## Integration order

1. Fireflies (adapter exists; needs a key)
2. Google Sheets (done)
3. Google Drive/Docs (done)
4. Resend (done; Gmail still has no adapter)
5. PandaDoc (next)
6. Exa research fallback
7. Firecrawl targeted extraction fallback
8. Approval-gated Apollo enrichment

Keep OpenAI web search as the primary research path until a fixed evaluation corpus demonstrates that another provider improves authoritative-source recall and downstream discovery quality at an acceptable cost.

## Repository handoff

Another developer or AI agent should read these files in order:

1. `README.md`
2. `DEVELOPER_HANDOFF.md`
3. `public/docs/workflow.md`
4. `openwiki/quickstart.md`
5. `DEVELOPMENT_LOG.md`

The source can be hosted outside OpenAI Sites. Cloudflare Workers is the lowest-friction alternative because the app already uses vinext, Cloudflare bindings, and D1. Other hosts require a persistence and runtime-binding migration.
