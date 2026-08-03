# T228 — SKILL Documentation and Final Acceptance — Evidence Record

**Date:** 2026-08-03
**Plan:** `2026-08-02-csm-scan-comprehensive-evidence-expansion-csm.md` (T228, cycle 16, G16)
**Owned scope delivered:** `SKILL.md`, `test/expansion-final-acceptance.test.mjs`, and this evidence record.
**Not touched:** plan file, baselines, production modules, and all other tests remain byte-identical.

## Deliverables

| Deliverable | Change | T224 reviewer flag |
|---|---|---|
| `SKILL.md` | Rewritten documentation to reflect the delivered 16-dimension, canonical-pipeline state (see "SKILL.md stale-line disposition" below). | LOW (lines ~40 and ~121 flagged stale) |
| `test/expansion-final-acceptance.test.mjs` | New 21-test acceptance matrix asserting all 20 acceptance criteria with concrete evidence, plus an optional real-repo smoke. | — |
| `.agents/docs/csm-scan-t228-final-acceptance-evidence.md` | This record. | — |

### SKILL.md stale-line disposition

- **Old line ~40** ("survey → 10 deep scanners (parallel) → enrich → validate → writeNORMS") replaced with the canonical exported pipeline: `survey -> registry-driven deep scans (16) -> provider/plugin/generic evidence merge -> enrich/validate with expected-claim coverage -> global cross-repo synthesis -> deterministic render -> one write` (`lib/scan/pipeline/run.mjs`).
- **Old line ~121** ("the suite covers shared primitives, all 10 deep scanners, ...") replaced with the authoritative `node --test --test-concurrency=1` guidance listing the key gates (baseline, constraints, fixtures, determinism, privacy, voice, golden, acceptance).

The rewrite additionally documents the 16 dimensions + global Cross-repository Architecture section, the static command boundary, the six evidence statuses and coverage semantics, privacy guarantees, the declarative plugin contract (trusted skill-local `plugin.json` data, 14 provider dimensions, generic fallback), standards metadata-only dispositions, parser caps/unsupported disclosure, deterministic output, and one-write/zero-dependency/read-only constraints.

## Test counts

| Gate | Command | Result |
|---|---|---|
| Focused T228 gate | `node --test --test-concurrency=1 test/expansion-final-acceptance.test.mjs` | **21/21 pass**, 0 fail (~5.5s) |
| Focused T228 gate with real-repo smoke | `CSM_REAL_REPO_SMOKE=/home/jamiemills/code/projects/perplexity-cli node --test --test-concurrency=1 test/expansion-final-acceptance.test.mjs` | **21/21 pass**, 0 fail, smoke executed (~7s) |
| Authoritative full suite | `node --test --test-concurrency=1` | **1007/1007 pass**, 0 fail (~64s) |

Baseline before T228: 986/986 (recorded 2026-08-03). Delta: +21 (the new acceptance file). No test was removed, skipped, or weakened; the plan's acceptance signal (full suite exits 0 with all prior tests retained) is met.

## Requirement matrix (plan Acceptance Criteria 1–20)

Each row maps an AC to the concrete evidence produced by the new gate and the owning T-verification it re-checks.

| AC | Claim | Evidence (test / assertion) | Verdict |
|---|---|---|---|
| 1 | Sole broker with exact rg/Git argv forms; no target execution | `AC1 command boundary` — recording broker over python + git fixture: every call is a registered `rg`/`git` shape, `shell:false`, zero target executables; production tree has exactly one `node:child_process` owner (`lib/scan/shared/command.mjs`) | PASS |
| 2 | Runtime/build/test/deploy findings are static declarations with source evidence, no actual-runtime claim | `AC2-AC9/AC15` — `stack.runtime` marked `declared`; `runtimeDeclarations` carry `manifest#field`/`Dockerfile#FROM` sources; no "actual runtime" wording | PASS |
| 3 | API Surface: declared contracts/routes/RPC/events/CLI; dynamic/unsupported disclosed, never invented | `AC2-AC9/AC15` (route/CLI ops) + `AC3/AC16` (unsupported openapi anchor → `PARSE_UNSUPPORTED`, zero operations) | PASS |
| 4 | Data Architecture: entities/keys/relations/migrations with declaration-backed edges; name-only never an edge | `AC2-AC9/AC15` — FK edge `users->teams`, `NAME_ONLY` diagnostic, all edges `foreign_key` | PASS |
| 5 | Deployment Topology: bounded static declarations; unsupported constructs are diagnostics, never evaluated | `AC2-AC9/AC15` (images/services) + `AC5` (k8s anchor/block-scalar docs → `malformed`/`unsupported` diagnostics, only the valid `deployment@api` peer survives) | PASS |
| 6 | Architecture reports dynamic indicators, raw fan-in/out, Tarjan SCC without verdicts | `AC6` — `analyzeGraphFacts`: `fanIn`/`fanOut`/`selfLoops`/`edgeKindCounts`/`stronglyConnectedComponents`/`dynamicIndicators` present; `importlib.import_module` surfaces as `dynamic-import`; extension renderer prose is neutral | PASS* |
| 7 | Maintainability: disclosed universe, exact duplicate spans, lexical branch counts, no scores | `AC2-AC9/AC15` — `measurementUniverse` discloses files/bytes/records inspected, limits, omitted count, eligible files, dialects; no `score` field | PASS |
| 8 | Governance: declarations with opaque identities, no inferred ownership | `AC2-AC9/AC15` — by-category inventory; `Owner-001` opaque labels; raw handles/emails absent | PASS |
| 9 | Assurance: manifests/locks/pins/licenses/SBOM/VEX/SARIF/standards inventoried without verdicts | `AC2-AC9/AC15` — manifest inventory with paths/status; `AC17` — `projectSarif`/`projectSbom` identifier-only projections, zero leaks | PASS |
| 10 | Standards metadata versioned/source-linked, metadata-only, no copied control text | `AC10` — all registry entries `metadata_only` with exact edition keys + HTTPS source links, no prose field; `authored_mapping` rejected, floating editions rejected, credentials in URIs rejected, duplicates rejected | PASS |
| 11 | Cross-repo edges require exact unambiguous evidence; ambiguity retained, never edges | `AC11` — shared `OrderService` → `ambiguous:2`, `crossRepositoryEdges:0`, no edges; disjoint services → `edges:2`, `selfEdges:2` | PASS |
| 12 | Declarative plugin contributes bounded evidence to all 14 provider dimensions; no code evaluated | `AC12` — 14-rule plugin validated by schema, loaded from a trusted skill-local root, renders `RUL-accept-<dim>-v1` for all 14 provider dimensions + `PRV-fxlang-v1` provenance; executable hooks rejected; registry is data-only | PASS |
| 13 | Removing the plugin routes the same unknown fixture to generic artifact-only findings with no core knowledge | `AC13` — Go fixture: `PRV-generic-artifacts-v1` file_metric/measurement_universe observations; api/data/deployment/maintainability/governance `not_detected`, assurance observed; `fixturelang`/`fxlang` absent from `lib/`+`scripts/` | PASS |
| 14 | Original five ecosystems preserve facts; 21-case P0 matrix and five fixture pipelines retained | `AC14` — five fixtures keep language/ecosystem/stack facts, 16 dimensions, no generic fallback, neutral voice; inventory asserts 21 P0 names and 5 fixture cases, no skipped tests | PASS |
| 15 | Claims carry stable ID, status, coverage, limitations, admissible evidence IDs | `AC2-AC9/AC15` — coverage expected 83, per-dimension statuses in `CLAIM_STATUSES`, git N/A excluded; deterministic `EVD-v1-…` evidence identity, `INVALID_PATH` rejected | PASS |
| 16 | `not_detected` only after complete supported uncapped readable search; capped→`unverified`, unsupported→`unsupported`, N/A excluded | `AC16` — empty repo: six new dims `not_detected` with complete searches; capped API fixture → `unverified` with `omittedCount>0`; unsupported status proven at the contract level with a clean unsupported search space | PASS |
| 17 | All output surfaces carry no sensitive values, paths, identities, subjects, excerpts, or credentials | `AC17` — canary files (emails, names, tokens, PAT, absolute POSIX/Windows/UNC paths, CODEOWNERS identity, SARIF message/snippet, SBOM serial/hash/contact/download/VCS URLs, URL credentials, commit subject): zero leaks across findings/global/Markdown/reporter; CLI stdout/stderr/Markdown over a git canary repo are clean; primitives reject/redact | PASS |
| 18 | Byte-identical output for fixed inputs/clock/plugin set/order | `AC18` — repeated runs byte-identical (LF, one terminal newline); insertion-order permutation identical; repository reversal keeps global section and per-repo blocks identical | PASS |
| 19 | Unknown/missing renderers and invalid evidence/plugin/standards/privacy states fail before the sole write | `AC19` — missing repo and empty repos reject before sink; `MISSING_RENDERER`/`UNKNOWN_DIMENSION` typed; malformed plugin rule aborts with `sinkCalls:0`; `PRIVACY_LEAK`; source-order proof privacy gate precedes sink | PASS |
| 20 | Authoritative sequential suite and all named gates pass with zero failures | `AC20` — acceptance command is `node --test --test-concurrency=1`; all 18 named gates exist, register tests, and do not skip/todo; external full-suite run 1007/1007 | PASS |

\* AC6 note: the graph-facts analysis is a production-exported API (`analyzeGraphFacts`) with its own extension renderer, proven byte-deterministic and neutral; it is not wired into the default pipeline renderer's architecture section (see Residual risks).

## Reviewer verdicts

Recorded independent-review verdicts from the plan progress journal through T226, plus the T224 dispositions relevant to this task:

| Gate | Verdict |
|---|---|
| T200 (standards policy) | PASS after R1/R2; fresh standards review "no material findings" |
| T201 (baseline/constraints) | PASS after R1–R5 (capability allowlists + reviewed hashes); full suite green through every repair |
| T202 (contracts) | PASS (correctness + safety) after R1/R2 |
| T203 / T205 / T206 (loader / renderer / privacy primitives) | PASS after R1s; both repair reviewers PASS |
| T204 / T207 / T208 (pipeline facade / declarations / broker) | PASS; T207R1 repair accepted |
| T209 (deep command migration) | PASS with one informational cap-disclosure note |
| T210 (provider foundation) | PASS after R1 (regex policy, generic cap) |
| T211–T217 (six new dims + architecture extension) | PASS after R1–R3 repairs; accepted |
| T218 / T219 / T220 (provider catalogs) | PASS after R1s |
| T221 (cross-repo) | PASS after R1 (privacy gate, sort key) |
| T222 (registry snapshots) | PASS after R1 (expected-claim coverage) |
| T223 (renderer registry) | PASS with two LOW injection-path items, fixed by primary |
| **T224 (atomic activation)** | **PASS** with two LOWs: (a) SKILL.md stale documentation — **resolved by this task**; (b) retry-enrich parity note — **resolved at T225R1** ("retry preserves provider observations", verified in `run.mjs` retry merge). Three INFO observations recorded. |
| T225 (synthetic plugin) | PASS after R1; three P3s applied by primary (retry preserves provider observations, privacy node bound for observation lists, plugin cap disclosure) — all verified in `run.mjs` |
| T226 (expansion fixtures) | Accepted (standard risk, primary self-review) |
| T227 (determinism/privacy/voice/negative/constraints) | Gates all green in the authoritative suite; final independent review pending in the plan's completion review |

The plan's T228 completion gate additionally calls for two fresh independent reviews (correctness, safety/voice); that review is performed by `csm-build` during the plan's Completion Review and is not part of this task's owned scope. All evidence required for those reviews is captured above and in the gate files.

## Constraint evidence (one write / zero dependency / read-only)

| Constraint | Evidence |
|---|---|
| **One write** | `writeNORMS` contains the sole `writeFile` call; `capabilities.json` writer lock requires it; T227 `exactly one production write per run` (sink called once, output dir contains exactly `NORMS.md`); AC19 asserts `sinkCalls:0` on every fail-before-write path and 1 on success; smoke asserts one output file |
| **Zero dependency** | No `package.json`/lockfiles/`node_modules` at the skill root; T227 `zero-dependency and closed import audits` (all production imports are `node:`/relative, no forbidden `node:process`/`node:vm`/`node:module`, no `require`, no `getBuiltinModule`); AC1 asserts exactly one `node:child_process` owner |
| **Read-only** | Broker registry contains only `rg --files`/`rg --json` and fixed read-only Git forms (`rev-parse`, `log --oneline -50`, `branch -a`, `symbolic-ref`, `config --get remote.origin.url`, `shortlog -s -n HEAD`); `shell:false`, reduced env, `GIT_OPTIONAL_LOCKS=0`; T227 `recorded git and rg argv forms are strictly read-only`; AC1 + real-repo smoke assert zero target executables and only registered argv shapes |

## Residual risks and notes

1. **Architecture graph facts are not in the default render.** `analyzeGraphFacts` (fan-in/out, SCC, dynamic indicators) and its extension renderer are production-exported and proven (AC6, T217) but are not wired into the architecture section of the default pipeline render. The plan's AC6 is satisfied at the reporting-API level; wiring the extension into the canonical render would strengthen NORMS.md coverage.
2. **Survey's git top-level check uses the singleton broker.** `survey.mjs` calls the same closed `commandBroker` singleton for `git rev-parse --show-toplevel`, so an injected recording broker does not capture that single call. All other commands flow through the injected broker; the singleton is the identical closed broker, so no target-command risk exists.
3. **Gate inventory must be maintained.** Adding future gate files requires updating the T201 `inventory.json` acceptance list and the AC20 `namedGates` list; both are structural and fail loudly if a listed gate disappears or skips tests.
4. **Default-suite runtime grew to ~64s.** The acceptance gate adds ~5–7s; the real-repo smoke is env-gated (`CSM_REAL_REPO_SMOKE`) so the default suite stays deterministic and self-contained, mirroring the `golden.test.mjs` real-repo pattern.
5. **Full-suite green is the AC20 evidence.** The acceptance gate asserts the gate inventory and the acceptance command; the "zero failures" requirement is evidenced by the authoritative external run recorded above (1007/1007).
6. **T228 completion review pending.** The plan's Completion Review (two independent reviewers) and the progress-journal/state transitions are owned by `csm-build` and are outside this task's deliverables.
