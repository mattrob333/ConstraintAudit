# Tier 4 Advisor Cockpit Agent Instructions

This repository contains a working but incomplete Tier 4 Throughput Audit application.

Before editing code:

1. Read `openwiki/quickstart.md`.
2. Read `DEVELOPER_HANDOFF.md`.
3. Read the relevant section of `public/docs/workflow.md`.
4. Inspect the actual implementation; do not infer shipped behavior from a target specification.

Preserve these invariants:

- Never turn Missing, Assumed, or public-research evidence into client-stated fact.
- Never invent a baseline, projected ROI, transcript quote, source, approval, or connector status.
- Keep recording consent and external writes behind explicit gates.
- Keep the single current constraint, prescription, metric, and named human owner as the primary outcome.
- Do not widen production access until tenant ownership and API authorization exist.
- Do not commit credentials or private client data.

Run `npm run lint`, `npx tsc --noEmit`, and `npm test` after implementation changes.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses a repo-local OpenWiki knowledge base. Start with `openwiki/quickstart.md`, then follow links to architecture, workflows, evidence rules, integrations, operations, testing, and roadmap pages.

`openwiki/INSTRUCTIONS.md` is the human-authored wiki brief. Do not rewrite it during a normal wiki update. Keep generated or maintained wiki pages grounded in source code and canonical docs, and label target behavior separately from shipped behavior.

<!-- OPENWIKI:END -->
