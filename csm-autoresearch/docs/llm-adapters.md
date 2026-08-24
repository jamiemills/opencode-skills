# LLM Adapters

`lib/llm/index.mjs` exposes provider-neutral `createProposer` and `createJudge`
adapters. Both default to deterministic, offline stubs. Proposals are capped at
50, tagged with diversity families, deduplicated, screened by deterministic
hooks, and carry redacted provenance. Judges return blinded ordinal or pairwise
advice only; calibration, disagreement, and low confidence route to review.

The transport hook exists for deterministic tests and local adapters. No vendor
SDK, credentials, network transport, or live implementation is included. Any
`live` mode request throws explicitly while `DEF-EVAL` is unresolved, including
when callers provide otherwise-valid live-mode metadata.
