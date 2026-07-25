# Tier 4 Advisor Cockpit
## Research, Document, and Interface Architecture Decisions

**Status:** Implemented single-advisor prototype; production-hardening and adaptive-workflow work remain  
**Last reconciled with code:** 2026-07-25  
**Governing workflow:** `public/docs/workflow.md`

---

## Decision 1 — Use a Free-First Recon Stack

Do not replace Apollo with one supposedly equivalent free database. No free source provides Apollo's combined company search, standardized firmographics, people search, contact data, enrichment, and workflow convenience at the same breadth.

The Tier 4 audit does not need that full bundle for every engagement. Recon needs enough grounded information to draft Canvas v0, a roster sketch, one to three constraint hypotheses, and gap-driven questions. That can usually be produced from public evidence.

### Default source hierarchy

1. **Client-provided material**
   - Existing emails
   - Website or company links supplied by the client
   - Prior proposals, notes, operating documents, and organization charts

2. **Company-controlled public sources**
   - Company website
   - About and leadership pages
   - Product and service pages
   - Newsroom and press releases
   - Careers and job postings
   - Public case studies
   - Public documentation and policies

3. **Official public registries**
   - U.S. public companies: [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), which expose submissions and XBRL company facts without an API key
   - UK companies: [Companies House API](https://developer.company-information.service.gov.uk/), which exposes live public company information and requires a registered API credential
   - Global legal entities with LEIs: [GLEIF data and API](https://www.gleif.org/en/lei-data/access-and-use-lei-data), whose complete LEI data pool is available free of charge
   - Relevant state, provincial, licensing, procurement, or regulatory registries

4. **Open-web research through Codex**
   - Current company news
   - Leadership announcements
   - Public interviews
   - Job-posting signals
   - Public technology documentation
   - Public partner and customer evidence

5. **Free or freemium contact discovery when needed**
   - Company team pages and public professional profiles
   - [Hunter Free](https://help.hunter.io/en/articles/11060999-what-s-included-in-hunter-s-free-plan), currently offering 50 monthly credits and basic Discover access

6. **Paid enrichment only for a material gap**
   - Apollo company details
   - Apollo people or contact enrichment
   - Other paid data providers

### Source policy

Every Recon source receives:

```yaml
source_name: ""
source_type: "client-provided | company-controlled | official-registry | public-web | freemium-enrichment | paid-enrichment"
url: ""
retrieved_at: ""
cost_class: "free | freemium | paid"
authority: "primary | secondary | directory"
supports:
  - "canvas block, roster entry, or hypothesis"
limitations: ""
```

### User experience

The cockpit should expose two separate actions:

- **Run Free Recon** — default
- **Enrich a Gap with Apollo** — optional and credit-gated

Apollo is invoked only when:

1. A named evidence gap materially affects the Guided Canvas Session.
2. Public sources cannot resolve it.
3. The expected Apollo credit cost is shown.
4. The advisor explicitly approves the enrichment.

### Conclusion

For Tier 4, the free-first stack is usually as good or better for diagnosis because it preserves source authority and makes uncertainty visible. Apollo is better for speed, normalization, direct-contact discovery, and scale—not for proving the operating constraint.

### Active and planned provider routing

The shipped application currently uses deterministic website extraction and optional OpenAI Responses API web search. The returned facts are parsed through a strict schema, facts without retained sources are discarded, and provider failure falls back to deterministic gaps.

The planned routing is:

```text
OpenAI web research
    -> Exa fallback when authoritative company/source coverage misses a defined threshold
    -> Firecrawl for a known page or site that requires deeper or JavaScript-rendered extraction
    -> Apollo only for a named, paid enrichment gap with explicit approval
```

Exa and Firecrawl are not yet implemented. No provider should become the default based on vendor claims alone. Evaluate a fixed company corpus for authoritative-source recall, unsupported claims, Canvas coverage, Value Flow usefulness, question specificity, latency, and cost.

---

## Decision 2 — Separate the Engagement Model from Document Rendering

The source of truth is not a Google Doc, PandaDoc, or DOCX. It is the structured engagement model maintained by the cockpit.

Documents are approved renderings of that model.

```text
Engagement model
    ├── Google Docs renderer
    ├── PandaDoc renderer
    ├── DOCX/PDF renderer
    └── Catalog write-back renderer
```

This prevents facts, transcript evidence, or approval status from drifting between formats.

### Document routing matrix

| Artifact | Primary destination | Reason |
| --- | --- | --- |
| Pre-Call Readiness Brief | Google Doc or reviewed Gmail draft | Collaborative, lightweight, nonsignable |
| Company Brief | Google Doc | Living research record |
| Canvas v0 / v1 | Cockpit plus Google Doc snapshot | Cockpit for live work; Doc for review and record |
| Roster Sketch | Cockpit plus Google Doc | Corrected live during Call 1 |
| Synthesis Diff | Google Doc | Evidence review, comments, and source links |
| Roles & Responsibility Map | Cockpit plus Google Doc | Collaboration now; Pedigree onboarding later |
| Findings Call pre-read | Google Doc | Client review before presentation |
| Diagnosis Package | Polished DOCX/PDF plus Google Doc | Formal presentation plus collaborative record |
| Audit Report | Polished DOCX/PDF plus Google Doc | Formal report with editable client version |
| Proposal / SOW | PandaDoc | Variables, recipients, approvals, signatures, and audit trail |
| Implementation Roadmap | Google Doc; included in PandaDoc when contractual | Collaborative planning unless it becomes committed scope |
| Third-Party Developer Specification | Google Doc and optional DOCX/PDF | Technical collaboration and formal handoff |
| Catalog Write-Back | Structured record, not a document-first workflow | Must remain queryable and comparable across engagements |

### Google Docs role

Use Google Docs for:

- Living evidence
- Collaborative correction
- Comments
- Source links
- Meeting pre-reads
- Working reports and technical specifications

For polished net-new formal documents, author and visually verify a DOCX first, then import it as a native Google Doc when needed. For a supplied Google Doc template, preserve and adapt the native Google Doc instead of reconstructing it.

### PandaDoc role

Use PandaDoc only when the artifact has a commercial or acceptance event:

- Proposal
- Statement of work
- Fixed-sprint authorization
- Pricing and payment terms
- Acceptance criteria requiring acknowledgment
- Signature

The connected PandaDoc workspace currently exposes no saved templates. The immediate path is:

1. Generate an approved PandaDoc draft from Markdown.
2. Use variables for advisor-controlled values.
3. Use fields for recipient-controlled values and signatures.
4. Keep the document in draft until advisor approval.
5. Send only after explicit confirmation.

Once a native Tier 4 PandaDoc template exists:

1. Retrieve its schema.
2. Map roles, variables, fields, pricing tables, and placeholders.
3. Create documents from that template.

### Artifact-template role

Codex's Template Creator is useful after one gold-standard DOCX has been approved. It can package that reference as a reusable personal artifact template for future Documents work.

It does not create a PandaDoc template or replace Google Docs collaboration. Its job is visual and structural repeatability for artifacts such as:

- Tier 4 Diagnosis Report
- Tier 4 Audit Report
- Third-Party Developer Specification

Recommended order:

1. Produce and approve one real engagement's final document.
2. Treat that DOCX as the reference.
3. Create a personal Codex artifact template from it.
4. Separately create a native PandaDoc proposal/SOW template inside PandaDoc.

---

## Decision 3 — Build the Advisor Cockpit as the Control Surface

The cockpit is not the source of external facts and does not bypass connector approval gates. It presents the workflow, captures advisor/client corrections, and emits reviewed action intents for Codex.

### Screen 1 — Engagement Home

- Client and meeting identity
- Current workflow state
- Next required action
- Evidence completeness
- Missing-baseline warning
- Artifact status
- Approval status

### Screen 2 — Recon Workspace

- Source register
- Free-source search plan
- Company Brief
- Canvas v0
- Roster Sketch
- Constraint hypotheses
- Evidence gaps
- **Run Free Recon**
- **Enrich a Gap with Apollo**, with cost and approval preview
- Pre-Call Readiness Brief preview and approval

### Screen 3 — Guided Canvas Session

Screen-share mode should:

- Remove internal-only hypotheses from client view
- Show large, readable Canvas blocks
- Support click-to-confirm, correct, or mark missing
- Trace the main workflow step by step
- Capture queues, waits, approvals, and rework
- Capture baseline numbers
- Decompose only roles inside the traced flow
- Keep the recording disclosure visible until confirmed

### Screen 4 — Transcript 1 Synthesis

- Fireflies transcript identity
- Verbatim quote and timestamp
- Canvas block
- Confirmation status
- Effect on diagnosis
- Missing inputs
- Updated roles map
- Canvas Commit approval

### Screen 5 — Findings Call

Client presentation mode:

```text
Canvas → constraint → prescription → projected metric delta → named human owner
```

If the baseline is missing:

- Label the finding provisional
- Show the formula and named inputs
- Show no numeric projected delta
- Show baseline instrumentation as Sprint 1's first task

### Screen 6 — Publish Center

Each artifact displays:

- Current evidence status
- Destination
- Template
- Draft status
- Approval status
- External-write consequence

Actions:

- Create reviewed Google Doc
- Create reviewed PandaDoc draft
- Create polished DOCX/PDF
- Draft Gmail message
- Send or share only behind a second explicit confirmation

### Screen 7 — Sprint and Catalog

- Starting metric
- Baseline timestamp
- Intervention
- Scope and guardrails
- Human owner
- Ending metric
- Actual delta
- Failure notes
- Predicted next constraint
- Actual next constraint
- Catalog write-back

---

## Interface Design Direction

The cockpit should feel like a calm operating instrument rather than a generic SaaS dashboard.

- High-contrast neutral canvas
- Ink or deep navy text
- Amber for the active constraint
- Green only for client-confirmed evidence
- Red only for blocked or contradicted evidence
- Large type and generous spacing in call modes
- Compact evidence density in internal review modes
- Persistent provenance badges
- No fabricated activity, metrics, or connector status
- Separate **Design & Diagnose** from **Operate & Measure**

During a client call, the advisor should be able to move through the workflow with one primary action per screen and no exposed internal notes.

---

## Decision 4 — Use Google Sheets as the V1 CRM

The guided interface is the advisor's working surface. A native Google Sheet is the lightweight engagement registry behind it.

The created workbook is:

- [Tier 4 Engagement CRM](https://docs.google.com/spreadsheets/d/1ANLc7vhkhkJBtkvoeLDeuXJw4yIlCJcyz3j6B_69GX8)

It contains:

- **Engagements:** one row per client audit, including stage, status, next action, dates, readiness-brief state, baseline state, and engagement links.
- **Activity Log:** calls, research, approvals, sends, transcript processing, deliverables, proposals, sprints, and follow-up.
- **Lists:** the controlled stage and status definitions used by the Sheet and the interface.

The entry screen supports:

1. Fresh engagement.
2. External migration.
3. Update an existing engagement.

The interface emits reviewed write-back intents through Codex. It does not embed Google credentials or write to Sheets directly from untrusted browser code.

Supabase is a later migration when concurrency, row-level permissions, event volume, relational reporting, or external client access make Sheets insufficient.

---

## Current Build Boundary

The advisor-cockpit UI has been implemented and deployed. The approved visual direction is now represented by the local application rather than the original design prototype.

### Shipped control surface

- Client intake, external migration, and engagement resume
- Research review with a correctly shaped nine-block Business Model Canvas
- Pre-Call Readiness Brief preview and approval
- Large-type Call 1 screen with recording-consent gate
- Transcript intake and synthesis review
- Findings Call with missing-baseline provisional handling
- Deliverable generation and CRM write-back intent
- Documents menu and Integration Center

### Current architectural limitations

- Value Flow and live-call topics are frontend scaffolds rather than engagement data.
- The research record and final-document Canvas are not yet one canonical versioned object.
- Transcript file upload does not ingest the selected file's contents.
- Transcript synthesis is deterministic keyword matching rather than full evidence reconciliation.
- Most connectors create intents or report setup state but do not execute external actions.
- The Integration Center does not render the complete backend integration-status response.
- No app-layer identity, tenant ownership, or route authorization exists.
- Sprint measurement and catalog write-back are not implemented.

### Next architecture milestone

1. Extend `ResearchSynthesis` with source-grounded `valueFlow` and `discoveryQuestions`.
2. Persist a versioned canonical Canvas and bind all UI and document renderers to it.
3. Bind Call 1 to the engagement's editable discovery plan.
4. Implement real transcript file ingestion and structured transcript reconciliation.
5. Add tenancy before widening production access.
6. Implement external adapters in the order Fireflies, Google Sheets, Google Docs, email, PandaDoc.
7. Add Exa only after an evaluation shows a measurable retrieval gap; use Firecrawl for targeted extraction failures.

Connector mutations remain behind explicit, reviewed, idempotent approval actions rather than untrusted browser state.
