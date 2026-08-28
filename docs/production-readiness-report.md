# Production Readiness Report — All-Skills Configuration and Production Assurance

Task reference: T010 of
`.agents/plans/2026-08-27-all-skills-config-production-assurance-csm.json`.
Date: 2026-08-28. Baseline commit: `389356a` (plus intentionally uncommitted
T002–T010 working-tree deliverables).

## Verdict

**NOT READY FOR AUTONOMY.** All local gates are green; every deliverable is
implemented, synchronized, and tested. Four gates remain unproven because
they require deployment-host evidence that cannot be produced in a local
repository (D6, DR5): G3 (blocked), G5, G6, and G7/G8 deployment evidence.
Per decision D6, autonomy stays disabled and shadow/replay remains the
maximum operating mode until every G0–G8 gate has observed deployment
evidence.

## Gate status (G0–G8)

Evidence classes: **local** = repository test/gate evidence;
**deployment** = evidence that can only be observed on the production host.

| Gate | Name                     | Status           | Evidence                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | Contract safety          | **PASS** (local) | `make check` OK — 14 skills, 1244 checks; schema registry 75/75 entries validated (`tests/schema-registry.test.mjs` 6/6); negative contract tests green across all suites (unknown keys/revisions, malformed inputs fail closed).                                                                                                             |
| G1   | Config assurance         | **PASS** (local) | Resolver contract/security/determinism suites green (`tests/config-envelope                                                                                                                                                                                                                                                                   | resolver | security.test.mjs` 33/33); all 14 per-skill adapters green (readonly 49/49, artifact 31/31 incl. legacy compatibility, high-risk 28/28); no-config parity preserved (baseline 7/7 + parity assertions in every adapter suite). |
| G2   | Authorization            | **PARTIAL**      | Structural authorization validation is implemented and tested (attestation forgery/replay/wrong-audience/wrong-digest rejection, authority-boundary and config-cannot-widen-authority tests — `tests/host-assurance/*.test.mjs`); production signatures and real trust anchors do not exist. Deployment signature infrastructure is required. |
| G3   | Host execution assurance | **BLOCKED**      | Requires an authenticated deployment host (real host identity, trust anchors, final-sink reauthorization on live sinks). Local tests prove protocol structure only, with generated test keys in disposable fixtures. No deployment host exists.                                                                                               |
| G4   | Durable execution        | **PASS** (local) | SQLite WAL store verified: CAS claims, fencing, leases, crash matrix, UNKNOWN-after-ambiguous-timeout, monotonic terminal state, receipt reconstruction, two-process claim races, migration replay (`tests/orchestration-store/*.test.mjs` + `tests/orchestrate-recovery-sqlite.test.mjs` 48/48 under Node 22).                               |
| G5   | Independent acceptance   | **PARTIAL**      | Independent signal-validator interface built and tested over immutable artifact snapshots (producer `pass` metadata non-authoritative; hostile-artifact tests green); real reviewer/validator isolation with deployment attestations is still required.                                                                                       |
| G6   | Telemetry completeness   | **PARTIAL**      | Correlated trace/metrics/audit emitter with terminal-run completeness, export-loss detection, and redaction built and tested (`tests/telemetry/*.test.mjs`); a production exporter and deployment-traffic verification are still required.                                                                                                    |
| G7   | Held-out evaluation      | **PARTIAL**      | Frozen 30-scenario three-split corpus with blinded double adjudication, 7 SLIs with Wilson 95% CIs, and two absolute safety gates built and green (26/26); deployment-like data, adjudicator independence at scale, and confirmed thresholds are still required (all thresholds provisional).                                                 |
| G8   | Shadow/canary/rollback   | **PARTIAL**      | Shadow runner, canary controller with frozen stop rules, verified rollback drill, version registry, and G0–G8 promotion-gate evaluator built and exercised (51/51); a production canary against a contemporaneous control with attributable deployment metrics has not run.                                                                   |

`checkPromotionGates` semantics (G5–G8 are deployment-only) are consistent
with this table: the review would return `not promotable` today with
`deployment-evidence-required` for G5–G8.

## Verification results (T010 full suite, cheapest first)

| Gate                                                                                            | Result                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/pack-bootstrap.mjs`                                                               | OK — 321 files, 843216 bytes, sha256 `34fc61b3d64e4fe8ac635786c6e526b03989ecf5b8c34d81b8a188337607b8d7`; regenerated payloads identical to in-tree state (no drift) |
| `make test-bootstrap`                                                                           | PASS — bootstrap trust, protocol, offline, resume-semantics, package-audit, import closure, schema sync, integration suites all green                               |
| `node --test tests/schema-registry.test.mjs`                                                    | 6/6 pass — registry complete (75 entries incl. all 18 new)                                                                                                          |
| `make fmt-check`                                                                                | PASS — 1077 files correctly formatted                                                                                                                               |
| `make lint`                                                                                     | PASS — oxlint, zero warnings                                                                                                                                        |
| `make check`                                                                                    | PASS — 14 skills, 1244 checks, payload drift `{compared:294, issues:[]}`                                                                                            |
| `tests/config-*.test.mjs`                                                                       | 33/33                                                                                                                                                               |
| `tests/config-readonly-adapters/*.test.mjs`                                                     | 49/49                                                                                                                                                               |
| `tests/config-artifact-adapters/*.test.mjs` + `tests/legacy-artifact-compatibility.test.mjs`    | 31/31                                                                                                                                                               |
| `tests/config-high-risk-adapters/*.test.mjs`                                                    | 28/28                                                                                                                                                               |
| `tests/orchestration-store/*.test.mjs` + `tests/orchestrate-recovery-sqlite.test.mjs` (Node 22) | 48/48                                                                                                                                                               |
| `tests/host-assurance/*.test.mjs` + `tests/telemetry/*.test.mjs`                                | 31/31                                                                                                                                                               |
| `tests/evals/orchestration/*.test.mjs`                                                          | 26/26                                                                                                                                                               |
| `tests/rollout/*.test.mjs`                                                                      | 51/51                                                                                                                                                               |
| `make test-package-index`                                                                       | PASS (7/7)                                                                                                                                                          |
| `make test-deterministic`                                                                       | PASS — two consecutive packs byte-identical; offline eval suites 17/17                                                                                              |
| `git diff --check`                                                                              | PASS — no whitespace errors                                                                                                                                         |
| `make test` (acceptance signal)                                                                 | PASS — full repository suite (hooks, bootstrap, orchestrate, suite tooling, deterministic, browse, upload, package index, ddd, autoresearch, scan)                  |
| CI                                                                                              | Not exercised in this environment (no CI runner available); `make test` is the maximal local equivalent                                                             |

## Schema and payload synchronization

- `schemas/registry.json` — 75 entries, including all 18 new:
  `csm-skills-config/1`, 14 per-skill config schemas
  (`csm-{grill,plan,deep-research,ddd,review,review-python,scan,bdd-tdd,make-tests,upload,browse,autoresearch,build,orchestrate}-config/1`),
  `csm-orchestrate-attestation/1`, `csm-orchestrate-validator/1`,
  `csm-orchestrate-telemetry-event/1`. Registry and
  `bootstrap/package/payload/schemas/registry.json` are in sync
  (`make test-bootstrap` schema-sync suite).
- `schemas/compatibility-matrix.json` — verified complete for its contract:
  the matrix governs cross-revision producer/consumer negotiation through
  `createCompatibilityRuntime` (`lib/compatibility-runtime/index.mjs`);
  every negotiated pair (envelope, orchestration revision pairs) has an
  entry and every entry's schema is registered. The new config schemas are
  revision-1, single-producer/single-consumer namespaces validated directly
  through the schema registry — no runtime negotiates them cross-revision,
  so no matrix entries are required; under `schemaDiffPolicy`, any future
  revision fork of a config schema requires a matrix entry (same/additive)
  or an explicit adapter (breaking).
- `bootstrap/package/**` and `bootstrap/payload-index.json` — regenerated
  with the canonical packer; deterministic double-pack verified; import
  closure and payload-index coverage verified by `make test-bootstrap` and
  `make check` (294 payload files compared, zero drift).

## Residual risks and deployment blockers

Deployment blockers (must be closed before autonomy):

1. **G3 — no deployment host.** Real host identity, production trust
   anchors, key epochs, and final-sink reauthorization require deployment
   infrastructure; local attestations use disposable test keys.
2. **G2 — no production signatures.** Authorization is structurally
   validated only; deployment signature issuance/verification is unbuilt.
3. **G5 — no reviewer/validator isolation.** Independent acceptance needs
   non-producer reviewers and validators with recorded attestations on the
   deployment.
4. **G6 — no production telemetry exporter.** Emitter, completeness
   detection, and redaction are local; export path and deployment-traffic
   verification are unbuilt.
5. **G7 — no deployment-like evaluation data.** Corpus, SLI machinery, and
   adjudication protocol are frozen and local; thresholds are provisional
   until confirmed on representative traffic; adjudicator independence at
   scale is unproven.
6. **G8 — no production canary.** Representative workload, isolated
   contemporaneous control, attributable metrics, accountable rollback
   authority, and an exercised production rollback drill are required.
7. **Raw environment-value persistence (D4/DR3).** `${VAR_NAME}` expansion
   may persist resolved values into provenance records by explicit user
   decision; retention/access/export controls require privacy review before
   production status.
8. **CI.** Not runnable in this environment; `make test` is the local
   maximum. The working tree is intentionally uncommitted (no commit
   authorization); committing and CI must follow before release.

Residual risks (accepted with mitigations, monitored):

- A suite-wide config file broadens malformed-input blast radius —
  mitigated by fail-closed parsing/validation of every layer before merge
  and by the no-config compatibility mode.
- SQLite coordinates local metadata only; it cannot atomically control
  arbitrary external effects — at-least-once plus reconciliation and sink
  idempotency remain the external-effect model (never claim exactly-once).
- Timeout/cancellation ambiguity can leave unknown side effects — UNKNOWN
  state plus reconciliation-required semantics prevent unsafe automatic
  retry and false cancellation.
- Synthetic reviewers/validators/canaries can create false production
  confidence — mitigated by deployment-only G5–G8 gates that ignore local
  evidence.
- Bootstrap and source registries can drift if generated artifacts are
  hand-edited — mitigated by canonical packer regeneration and parity
  gates (re-verified this task).

## Delivered artifacts

Configuration plane (T002):

- `schemas/csm-skills-config.schema.json` — closed suite envelope
- `lib/config/index.mjs` — layered resolver (precedence, recursive object
  merge, array replacement, explicit null, one-pass `${VAR}` expansion,
  strict unknown-key/revision rejection, bounded secure loads, provenance,
  effective digest)
- `tests/config-envelope.test.mjs`, `tests/config-resolver.test.mjs`,
  `tests/config-security.test.mjs`

Per-skill adapters (T003–T005), one `schemas/config.schema.json` +
`lib/config.mjs` pair per skill:

- `csm-grill/`, `csm-plan/`, `csm-deep-research/`, `csm-ddd/`,
  `csm-review/`, `csm-review-python/`, `csm-scan/` (read-only, T003)
- `csm-bdd-tdd/`, `csm-make-tests/`, `csm-upload/` (artifact-producing +
  legacy compatibility, T004; csm-upload preserves legacy
  `~/.agents/csm-upload.json` with legacy-wins additive merge)
- `csm-browse/`, `csm-autoresearch/`, `csm-build/`, `csm-orchestrate/`
  (high-risk, T005 — non-authority preference fields only)
- Adapter tests: `tests/config-readonly-adapters/`,
  `tests/config-artifact-adapters/`,
  `tests/legacy-artifact-compatibility.test.mjs`,
  `tests/config-high-risk-adapters/`
- Orchestration semantics (T005): executable activation predicates,
  remediation budget with BLOCKED exhaustion, physical insertion ordering —
  `tests/orchestrate-activation-predicates.test.mjs`,
  `tests/orchestrate-remediation-budget.test.mjs`,
  `tests/orchestrate-insertion-ordering.test.mjs`,
  `tests/helpers-final-review.mjs`

Durable execution (T006):

- `lib/orchestration-store/index.mjs` — SQLite WAL store (migrations, CAS,
  fencing, leases, approvals, idempotency, dispatch intents, append-only
  events, terminal receipts, late results, UNKNOWN semantics)
- `tests/orchestration-store/`, `tests/orchestrate-recovery-sqlite.test.mjs`

Host assurance and telemetry (T007):

- `csm-orchestrate/lib/attestation.mjs`,
  `csm-orchestrate/lib/validators.mjs`,
  `csm-orchestrate/lib/telemetry.mjs`
- `csm-orchestrate/schemas/attestation.schema.json`,
  `csm-orchestrate/schemas/validator.schema.json`,
  `csm-orchestrate/schemas/telemetry-event.schema.json`
- `tests/host-assurance/`, `tests/telemetry/`

Evaluation (T008):

- `lib/evals/orchestration/{index,sli,adjudication}.mjs`
- `tests/evals/orchestration/corpus/{development,validation,held-out}.json`
  (30 scenarios, splits 12/8/10, held-out labels frozen)
- `tests/evals/orchestration/` (5 suites)
- `docs/evaluation-corpus.md`, `docs/slo-definitions.md`

Rollout (T009):

- `lib/rollout/{shadow,canary,rollback,versions,promotion,internal}.mjs`
- `tests/rollout/`
- `docs/rollout-policy.md`

Inventory and baseline (T001, extended by T002–T010):

- `docs/config-inventory.md`
- `tests/config-baseline/{inventory,parity}.test.mjs`

Synchronization (T010):

- `bootstrap/package/**`, `bootstrap/payload-index.json` (regenerated)
- `schemas/registry.json` (18 new entries)
- `schemas/compatibility-matrix.json` (verified; see above)
- `.agents/README.md` (build-journal index entry)
- `docs/production-readiness-report.md` (this report)

## Autonomy promotion path

Autonomy may be considered only after: deployment host + trust anchors
(G3), production signatures (G2), isolated reviewers/validators (G5), a
production telemetry exporter (G6), deployment-confirmed thresholds on the
frozen held-out corpus (G7), and a representative canary with a verified
production rollback drill (G8) — each recorded as deployment evidence
through `checkPromotionGates`, with explicit accountable approval (T010
action 4). Until then: autonomy disabled; shadow/replay is the maximum
operating mode.
