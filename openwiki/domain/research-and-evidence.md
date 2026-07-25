---
type: Domain Model
title: Research and Evidence Model
description: Tier 4 provenance rules, Business Model Canvas research, constraint hypotheses, transcript evidence, baseline handling, and required canonical data contracts.
tags: [evidence, provenance, research, canvas, constraints]
---

# Research and evidence model

## Evidence vocabulary

| Display status | Stored provenance | Meaning |
| --- | --- | --- |
| Known | `client-stated` or `doc` | Direct client statement or authoritative supplied document |
| Inferred | `public-research` | Public source not yet confirmed by the client |
| Assumed | `advisor-note` | Working hypothesis that must be confirmed or killed |
| Missing | `gap` | Required information not yet established |

The required traceability chain is:

```text
claim -> customer statement -> transcript -> confirmation status -> recommendation -> implementation
```

## Research model today

`ResearchSynthesis` currently contains:

- source URL and fetch metadata;
- title and description;
- source-backed `facts` mapped to Canvas blocks;
- `gaps`;
- `constraintHypotheses`;
- research provider metadata.

It does not contain a proposed value flow, structured discovery questions, roster, or canonical Canvas revision.

## Required next research model

Add:

- `canvasRevision` — one versioned nine-block representation;
- `valueFlow` — ordered source-grounded steps with inputs, outputs, actors, systems, confidence, sources, and confirmation questions;
- `discoveryQuestions` — editable client-specific prompts tied to facts, gaps, steps, hypotheses, baselines, and roles;
- `researchQuality` — coverage and source-authority signals used to decide whether a fallback provider is needed.

Every generated interpretation must be separable from retained evidence.

## Constraint types

The domain supports:

- `capacity`;
- `latency`;
- `quality`;
- `knowledge`;
- `policy`.

The current transcript analyzer uses keyword lists to choose one type and maps it to a Canvas block. That behavior is deterministic and testable but insufficient for a real operating-flow diagnosis.

## Baseline rule

A confirmed baseline requires a metric name, value, unit, period, source, and accountable owner. If any required element is unavailable, the finding remains provisional.

No benchmark may substitute for client evidence. The projected delta remains a formula with named inputs until measurements exist.

## Speaker provenance

Client-attributed lines may support evidence. Advisor lines remain notes. Unknown-speaker lines remain gaps unless a human maps the speaker role. A model may not promote an unknown or advisor line into client evidence.

## Provider policy

OpenAI is the active research provider. Exa is a proposed retrieval fallback, Firecrawl a targeted extraction fallback, and Apollo a paid enrichment option. Provider identity never changes the evidence status: the underlying source determines provenance.
