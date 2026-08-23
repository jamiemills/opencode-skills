---
format: csm-ddd-report/1
runId: run-be58e8e5-4ffc-4b32-937f-d64600583ce0
graphRunId: run-be58e8e5-4ffc-4b32-937f-d64600583ce0
generatedAt: 2026-08-23T08:18:09.654Z
---

# DDD repository analysis: modular

All context claims below are hypotheses with an explicit basis and confidence.
Machine-readable companion graph run: `run-be58e8e5-4ffc-4b32-937f-d64600583ce0`.

## Capabilities

- **src/billing** — classification `supporting` (inbound 0, outbound 1); status `observed`, basis static_analysis
- **src/orders** — classification `core` (inbound 1, outbound 0); status `observed`, basis static_analysis

## Context hypotheses

- `src/billing` is a bounded-context CANDIDATE — hypothesis only; requires domain and ownership validation.
- `src/orders` is a bounded-context CANDIDATE — hypothesis only; requires domain and ownership validation.
- Relationship hypothesis: node-src-billing -> node-src-orders (upstream-downstream).

## Terminology and conflicts

2 term(s) inventoried; none show conflicting meanings across directories.

## Seams and candidate slices

- **index.placeOrder** (rank 1):
  - enabling point: exported symbol placeOrder in src/orders/index.mjs
  - observable behavior: consumers import it from 1 site(s)
  - side effects: event emission observed in same module
  - redirectable slice: redirect the 1 importer(s) of placeOrder to an alternative implementation
  - rollback: restore original import paths (single-module revert; no data or schema change involved)

Unresolved questions recorded as unverified gaps:
  - [cl-gap-0001] OPEN QUESTION (unresolved in non-interactive mode): Which team owns src/billing, and is its business outcome core, supporting, or generic to the product?
  - [cl-gap-0002] OPEN QUESTION (unresolved in non-interactive mode): Which team owns src/orders, and is its business outcome core, supporting, or generic to the product?

## Coverage and open questions

Scan coverage: 2 files / 231 bytes under caps maxFiles=2000, maxBytes=2000000 — complete within bounds.
NORMS.md: not present.
User answers applied: ; unresolved gaps: 2.
