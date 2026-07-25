# Tier 4 Advisor Cockpit

A guided, evidence-grounded workspace for running a Tier 4 Throughput Audit from client intake through approved deliverables.

## What works without credentials

The local app is fully usable with its deterministic audit engine and D1 persistence:

- create or resume an engagement;
- research a public client website and draft a nine-block business canvas;
- prepare, approve, and record a send intent for the client readiness brief;
- run Call 1 with a large-type guided interview;
- paste a transcript and review evidence, open questions, and proposed canvas changes;
- run Call 2, preserve a provisional diagnosis when the baseline is missing, and approve findings only with evidence and a named human owner;
- generate findings, report, proposal, roadmap, and technical brief records;
- view workflow and integration documentation from the Documents menu;
- queue an idempotent CRM write-back intent.

The app never sends email, publishes a document, or silently upgrades an uncertain statement into client evidence. External writes remain approval-gated intents until the matching integration is configured.

## Run locally

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open `http://localhost:5173` unless vinext reports a different port.

Validation:

```powershell
npm run lint
npx tsc --noEmit
npm test
```

## Configuration

Copy `.env.example` to `.env.local`. The app does not require secrets for its core workflow. Add only the integrations you intend to activate:

- `FIREFLIES_API_KEY` — imports completed transcripts by transcript ID.
- `APOLLO_API_KEY` — optional paid company-data enrichment.
- `PANDADOC_API_KEY` and `PANDADOC_TEMPLATE_UUID` — optional formal proposal/SOW generation.
- `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_REPLY_TO` — optional transactional delivery.
- `GOOGLE_*` — separate Google OAuth credentials for direct Sheets, Drive, Docs, or Gmail access from the deployed app.

The current lightweight CRM is:
[Tier 4 Throughput Audit CRM](https://docs.google.com/spreadsheets/d/1ANLc7vhkhkJBtkvoeLDeuXJw4yIlCJcyz3j6B_69GX8)

OpenAI is intentionally optional and not part of the working runtime. The current engine is deterministic so the application runs without an API key. If a future AI-assisted adapter is added, its server-side key should be provisioned through the secure OpenAI Platform flow and never committed or exposed to the browser.

See [INTEGRATIONS.md](./INTEGRATIONS.md) for account setup, permission scopes, pricing boundaries, and production recommendations. The same guide is available inside the app under Documents.

## Architecture

- `app/components/AdvisorCockpit.tsx` — the advisor-facing guided workflow.
- `app/api/` — engagement, research, transcript, approval, document, CRM, and integration endpoints.
- `lib/` — workflow rules, provenance-aware extraction, research safety, deliverable generation, and D1 persistence.
- `db/schema.ts` and `drizzle/` — D1 schema and migration.
- `public/docs/` — in-app operating documentation.
- `tests/` — workflow, contract, and rendered-product checks.

The Sites project and database bindings are declared in `.openai/hosting.json`. The current production deployment is owner-only. Before sharing it with additional advisors, add app-layer tenant ownership to engagement records and enforce that ownership in every API route.

## Operating boundaries

- Recording and transcription consent are separate from “continue without recording.”
- A readiness send intent is bound to the exact approved artifact version.
- Advisor and unknown-speaker transcript lines are not treated as client-stated evidence.
- Missing baseline numbers never block the findings call: the diagnosis remains provisional and the projected delta stays a named-input formula.
- Full task decomposition is limited to roles inside the traced workflow.
- Client-facing documents are drafts until an advisor explicitly approves the exact version.
