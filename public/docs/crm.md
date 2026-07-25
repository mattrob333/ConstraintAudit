# Tier 4 Lightweight CRM

## Decision

Use Google Sheets as the v1 engagement registry.

It is fast to operate, transparent to the advisor, easy to correct manually, and sufficient for the expected early engagement volume. Supabase remains a later migration path if concurrency, permissions, event volume, or automated reporting outgrow Sheets.

The guided audit interface remains the working experience. The Sheet is the durable registry behind it, not the primary call interface.

## Workbook

[Tier 4 Engagement CRM](https://docs.google.com/spreadsheets/d/1ANLc7vhkhkJBtkvoeLDeuXJw4yIlCJcyz3j6B_69GX8)

### Engagements

One row per Tier 4 engagement:

- Engagement ID
- Client
- Website
- Primary Contact
- Email
- Advisor
- Stage
- Status
- Next Action
- Due Date
- Last Contact
- Call 1
- Call 2
- Readiness Brief status
- Baseline status
- Engagement Folder
- Notes

Controlled dropdowns:

- Stage: `Client`, `Research`, `Prepare`, `Call`, `Synthesize`, `Deliver`, `Sprint & Catalog`
- Status: `Not started`, `In progress`, `Waiting on client`, `Needs review`, `Approved`, `Closed`
- Readiness Brief: `Not drafted`, `Drafted`, `Approved`, `Sent`
- Baseline: `Missing`, `Partial`, `Confirmed`

### Activity Log

One row per meaningful engagement event:

- Date
- Engagement ID
- Client
- Activity Type
- Summary
- Outcome
- Next Action
- Owner
- Source Link

Activity types cover intake, research, brief, calls, transcript, synthesis, deliverables, proposal, sprint, and follow-up.

### Lists

The allowed values and plain-language stage definitions used by the workbook and interface.

## Interface Contract

### Fresh engagement

1. Create the engagement ID.
2. Add an Engagements row.
3. Record an Intake activity.
4. Set stage to `Client`.
5. Set next action to `Research this business`.

### External migration

1. Create or match an engagement.
2. Attach source links.
3. Record a migration activity.
4. Determine the furthest supported stage from imported evidence.
5. Mark unsupported information as missing rather than assuming completion.

### Update an engagement

1. Select by engagement ID.
2. Load the current stage and next action.
3. Resume the guided flow at that stage.
4. Write back stage changes and meaningful activities.

### Connector actions

The interface should produce reviewed action intents for Codex. It should not place Google credentials in the browser or call Sheets directly from untrusted client-side code.

## Migration Threshold

Move the registry to Supabase when one or more of these becomes material:

- Multiple advisors edit the same engagement concurrently.
- Row-level permissions are required.
- The activity log becomes too large for comfortable Sheet use.
- Automated analytics require relational joins.
- External client access must be separated from advisor access.
- Reliable event-driven integrations require webhooks or database triggers.

The engagement ID and field names should remain stable so this migration does not change the guided interface.
