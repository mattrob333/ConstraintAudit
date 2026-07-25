# Current Build State and Developer Handoff

**Snapshot:** 2026-07-25  
**Status:** Working single-advisor prototype; not production-ready for multiple advisors

## What is real

- Engagement state and artifacts persist in Cloudflare D1.
- Public research uses safe deterministic website extraction and optional OpenAI Responses API web search.
- The Business Model Canvas interface displays real, source-backed research facts.
- Pre-Call Readiness approval, recording consent, evidence provenance, missing-baseline handling, and diagnosis approval guards work.
- Pasted transcripts can produce client-attributed evidence, metrics, gaps, and a provisional constraint candidate.
- Internal Markdown deliverables and reviewed external-action intents can be generated.

## What is still scaffolded

- The Flow of Work uses the same six steps for every company.
- The live Call 1 guide uses the same six demo topics for every company.
- Research-tab questions are only partly customized.
- Transcript synthesis is fixed keyword and metric-pattern analysis.
- File upload submits a filename rather than transcript contents.
- The final Audit Report does not consume the same Canvas displayed during research.
- Google Sheets, Google Docs, Gmail, PandaDoc, and Resend do not execute external actions.
- Sprint measurement and catalog write-back are not implemented.
- Application-level authentication, tenant ownership, and route authorization are absent.

## Next required milestone

The research response must add:

1. a source-grounded Value Flow v0;
2. a company-specific private discovery plan;
3. conditional call questions tied to facts, gaps, flow steps, hypotheses, baselines, and roles.

The Flow of Work and live-call screens must consume those engagement objects rather than frontend constants. Research must also populate one versioned canonical Canvas used by the UI, transcript reconciliation, and final documents.

## Integration order

1. Fireflies
2. Google Sheets
3. Google Drive/Docs
4. Gmail or Resend
5. PandaDoc
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

The local source repository is:

`C:\Users\mrobe\Documents\Codex\2026-07-24\sales-plugin-sales-openai-curated-remote\work\tier4-advisor-app`

The source can be hosted outside OpenAI Sites. Cloudflare Workers is the lowest-friction alternative because the app already uses vinext, Cloudflare bindings, and D1. Other hosts require a persistence and runtime-binding migration.
