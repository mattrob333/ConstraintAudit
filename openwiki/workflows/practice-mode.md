---
type: Workflow Guide
title: Practice Mode
description: The deterministic fictional engagement an advisor can walk end to end before meeting a real client — how it is seeded, what guarantees it makes, and how it is kept from ever reaching a client.
tags: [practice, demo, onboarding, training, determinism]
---

# Practice mode

Practice mode is one complete, entirely fictional engagement — **Meridian Millwork** — that an advisor can walk from intake to catalog write-back before they ever run the audit live. It is also the demo shown to advisors who are nervous about running it live.

It lives in `lib/demo.ts`, is seeded through `POST /api/demo`, and is driven by a docked walkthrough in `AdvisorCockpit.tsx`.

## Guarantees the source keeps

`lib/demo.ts` is **pure and deterministic**. No I/O, no network, no database, no `crypto.randomUUID()`, no `Date.now()`, no `new Date()`. Every id is fixed (`eng_demo_practice`, `src_demo_*`, `con_demo_*`), and the story has its own fixed calendar so the arc reads identically for everybody. Two advisors opening Practice mode see byte-identical content, it costs nothing, and it works with **zero API keys configured**.

The evidence rules are kept, not bypassed — advisors learn the product's norms from the demo:

- Research facts are `public-research`. Client claims are `client-stated` and carry the speaker and timestamp of the line they came from.
- **The advisor's own lines are never evidence.** Every "Advisor" line in the two transcripts parses as `advisor-note`. That is the point: the demo visibly shows the tool refusing to treat the advisor's words as client evidence.
- Every number in the finding, the sprint, and the documents traces to a client line in one of the two transcripts.

`tests/practice-mode.test.mjs` locks all of this down: two builds are JSON-identical, every quote the diagnosis rests on is verified to appear verbatim in a real transcript line, and more than ten advisor lines are asserted to be `advisor-note` with none of their text reaching the finding's evidence.

## Seeding and isolation

Engagement ids are a primary key, so a shared `eng_demo_practice` row could only ever belong to one advisor. `demoEngagementIdFor(ownerId)` gives each advisor their own deterministic copy — same input, same id, forever, no randomness. `isDemoEngagement()` recognizes both the canonical id and any advisor's copy.

`POST /api/demo` takes `{ action }`, defaulting to `"seed"`:

| Action | Effect |
| --- | --- |
| `seed` | Idempotent. Returns the existing practice engagement if one exists, otherwise builds it |
| `reset` | Cascade-deletes and rebuilds from scratch |
| `remove` | Cascade-deletes it |

`GET /api/demo` returns the current practice engagement, or `null`. All three are owner-scoped like everything else.

Seeding writes a real engagement row plus real artifacts, activities, and both call transcripts, so the practice engagement moves through the same store, the same guards, and the same screens as a live one. `deleteEngagementCascade()` in `lib/store.ts` exists for this path — it is the only caller. There is no advisor-facing deletion of a *real* engagement.

## How it is kept out of client work

| Marker | Where |
| --- | --- |
| `DEMO_OWNER_MARKER` — "PRACTICE MODE — fictional training data, never send to a client" | The engagement notes and folder, and `data.practiceMode` |
| A sticky, non-dismissable practice bar | Rendered outside `<main>` and outside every screen, "so no screen can suppress it. No dismiss control exists." Present on **every** screen including client-facing ones, and unaffected by the Escape panic key |
| `PracticeMark` chips — "Practice data · not a client" | The header, the recent list, and a separate registry table body |
| Intake lockout | "Creating engagements is off in practice mode" |
| Fictional contact details | Every address is `@example.com`, every URL is under a reserved example domain |

The practice bar's text is explicit: *"Meridian Millwork is not a real company. Everything on screen — the quotes, the numbers, the documents — was written as training material. Never send, quote, paste or screen-share any of it as a client's."*

## The walkthrough

`PracticeTour` is a 15-stop docked panel: intake → research-canvas → research-flow → research-questions → prepare → call → transcript → synthesis → canvas-commit → findings → diagnosis → deliver → sprint → measure → catalog. Each stop carries "What you are looking at", "With a real client", and "Worth a look". Position persists in `localStorage`, and on completion the advisor can walk it again, reset the data, leave practice mode, or delete the practice engagement.

The tour is wrapped in `AdvisorOnly` and additionally hidden whenever the Findings Call presentation view is open or the advisor is presenting during Call 1 — a client watching a screen share never sees the training scaffolding, only the practice bar warning them that what they are looking at is fictional.

## What it does not do

- It does not exercise any adapter. Practice mode performs no external write, because it performs no I/O at all.
- It does not exercise the model passes. The practice synthesis is fixed data, not a live call to OpenAI.
- It is not a fixture for the automated suite beyond `tests/practice-mode.test.mjs`, which tests the demo data's own honesty rather than the workflow's behavior.
