# Current Build State and Developer Handoff

**Snapshot:** 2026-07-27  
**Status:** The workflow runs end to end. Records are scoped per advisor. Off OpenAI Sites, configure Cloudflare Access (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `REQUIRE_ADVISOR_AUTH=1`) before anyone but you can reach the URL.

## Start with Practice mode

Practice mode is a complete fictional engagement — Meridian Millwork — seeded into your own account with no API key and no configuration. It covers research through catalog write-back, including both transcripts and all 14 generated documents, and a 15-stop walkthrough docks beside the real screens rather than rebuilding fake ones. It is labelled by a sticky bar that cannot be dismissed and by a footer on every document, and it can be reset or removed at any time. Open it from the Home screen.

Because the practice bar deliberately stays visible on the client-facing screens, practice mode is for rehearsal, not for a screen share with a live audience.

## What is real

- Engagement state and artifacts persist in Cloudflare D1, scoped to the owning advisor in SQL across all five tables.
- Every API route resolves the advisor asynchronously, so a signature-verified Cloudflare Access assertion is a usable identity source. Where Access is configured it is the only accepted one.
- Public research uses safe deterministic website extraction and optional OpenAI Responses API web search.
- Research produces a company-specific value flow and discovery-question set, with or without an API key.
- One canonical Business Model Canvas is written by research and corrected by client evidence. The final Audit Report reads that same Canvas.
- The Flow of Work screen, the research questions, and the live call script are all generated from that engagement's research.
- Intake can ingest a source document, and transcripts can be pasted or uploaded. TXT, VTT, SRT, JSON and DOCX decode into real speaker- and timestamp-attributed lines; PDF is deliberately refused.
- Transcript synthesis is model-assisted when a key is configured: the model reasons over the call with full business context, and a grounding parser then verifies every quote, metric and Canvas correction against a real, client-attributed transcript line, discarding and recording anything it cannot tie back. Deterministic synthesis is the fallback, and the screen states which reading is shown.
- Metric direction is inferred from the unit, then the metric name, then a narrow model question — with the advisor's own declaration always winning, the basis shown, and no interpretation at all where the metric is genuinely ambiguous.
- Live-call coaching runs in an advisor-only layer whose hidden content is absent from the DOM, not merely CSS-hidden. Escape hides it. The Findings Call screen has no advisor half at all.
- Pre-Call Readiness approval, recording consent, evidence provenance, missing-baseline handling, and diagnosis approval guards work.
- Six deliverables are generated at the diagnosis checkpoint (diagnosis package, audit report, proposal, roadmap, developer specification, roles map), and a full engagement accumulates fourteen artifact kinds in total. The proposal carries a fixed $2,500 sprint fee with no ROI or payback figure beside it.
- Sprint activation, outcome measurement, and catalog write-back complete the workflow.
- Resend, Google Sheets, and Google Docs perform real external writes, reachable only from an explicitly approved intent.

## What is still missing or partial

- **No in-call value-flow editor.** Transcript evidence produces `flowConfirmations` and those reach the generated documents, but the advisor cannot correct a flow step live and the cockpit never renders the confirmations.
- **No native DOCX or PDF generator.** Deliverables are Markdown plus a self-contained printable HTML rendering; print-to-PDF or Google Docs conversion is the route to a formal document.
- **Gmail has no adapter.** Resend is the implemented sender. Apollo and PandaDoc remain connector-first contracts with no adapter here.
- **Exa and Firecrawl are not implemented.**
- **No outreach or prospecting funnel.** The product starts at an engagement that already exists.
- **Screen-share protection is advisor-asserted.** Escape hides coaching one-way in the same browser window; the app cannot detect a share, so it only helps if pressed before sharing.
- **Google access is single-identity.** One refresh token serves every advisor's approved writes.
- **Fireflies is unverified against a live workspace.**

## Rules that keep a number honest

- A baseline is `Confirmed` only with a value, unit, period, source, speaker, and timestamp from a client-stated line.
- A before/after delta requires two client-confirmed readings in the same unit and period. Otherwise the app records why it is blocked and claims no number.
- Which direction counts as an improvement is decided by the advisor first, then by the metric itself, and never by a guess: a shorter turnaround is a win, a smaller throughput is not, and where nothing settles it the app asks.
- A model-produced quote is printed only if it matches a real transcript line attributed to a client speaker.

## Next required milestone

An in-call editor for value-flow steps, so the advisor can correct a step live and have the correction recorded as client-stated evidence — and a real Cloudflare Workers deployment behind verified Access.

## Integration order

1. Fireflies (adapter exists; needs a key and one live verification)
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
4. `docs/DEPLOYMENT.md`
5. `openwiki/quickstart.md`
6. `DEVELOPMENT_LOG.md`

The app is moving off OpenAI Sites onto Cloudflare Workers. It already uses vinext, Cloudflare bindings, and D1, so this is a configuration change rather than a port; `wrangler.jsonc` and `docs/DEPLOYMENT.md` are in the repository, and no completed Cloudflare deployment is recorded yet. Other hosts require a persistence and runtime-binding migration.
