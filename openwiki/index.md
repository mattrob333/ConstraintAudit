---
okf_version: "0.1"
---

# Tier 4 Advisor Cockpit Wiki

This repository wiki describes the shipped application, its governing workflow, evidence model, integrations, operating procedures, verification gates, and production-readiness roadmap.

Every page separates shipped behavior from target behavior. Verified against source on 2026-07-27, at `5f50feb`, after model-assisted synthesis, metric-direction inference, Cloudflare Access, Practice mode, and the Workers deployment path landed; see [log](log.md).

## Start here

- [Quickstart](quickstart.md) — product orientation, current truth, status table, reading order, and source map.

## Areas

- [Architecture](architecture/) — runtime, tenancy, canonical Canvas, intent execution, identity and access
- [Workflows](workflows/) — the two-call audit through sprint, outcome, and catalog, plus Practice mode
- [Domain and evidence](domain/) — provenance, research contract, Canvas rules, model grounding, metric direction
- [Integrations](integrations/) — what executes, what is intent-only, what does not exist
- [Operations](operations/) — setup, identity configuration, migrations, Cloudflare Workers deployment
- [Testing](testing/) — the 50-test suite and the coverage that is still missing
- [Roadmap](roadmap/) — what is done and what genuinely remains
