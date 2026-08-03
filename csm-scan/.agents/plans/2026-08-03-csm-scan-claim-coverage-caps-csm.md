# csm-scan Claim-Coverage Remediation CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 1 high-risk task (contract-test fixture update), 3 standard-risk tasks, 1 verification task. T003 requires independent review before merge because it edits a T228 acceptance test.

## Control
- Plan ID: csm-scan-claim-coverage-caps
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: none
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none

## Goal
Fix the causes of the 17 incomplete expected claims that csm-scan reports on realistic repositories (observed on the pxcli repo, 527 files): (1) the data-dimension scanner crashes on capped reader outcomes, degrading all 5 data claims to `SCANNER_FAILURE`/unverified; (2) the api (6 claims) and maintainability (6 claims) dimensions bind on a 10k-*line* record budget that is exhausted after ~23 files, and the api source sample (96 files) is exhausted by any repo with more than 96 source files — both far below the designed byte caps, so claims stay unverified on ordinary repos.

Deliverables:
- Data scanner emits schema-valid, typed diagnostics (`line: null`, distinct reasons) for capped/malformed/unreadable/unsupported outcomes; never crashes.
- Record budgets recalibrated to be byte-consistent (bind at the same magnitude as the byte caps), so the *byte/file* caps — not a line count — bound realistic scans.
- API and data source samples raised so ordinary repos complete; sampling disclosure kept (and added to data for parity) so completeness is never overclaimed on repos larger than the sample.
- T228 AC16 contract ("capped search is unverified, never not_detected") preserved; fixture sizes updated to exceed the new sample limit.

Constraints:
- Zero npm dependencies; Node built-ins only. Read-only scanners. Deterministic output.
- No changes to claim-status semantics, the ten legacy dimensions, shared `recordCount` semantics, plugins, privacy/determinism gates, or SKILL.md (it documents no numeric caps).
- All modifications confined to `lib/scan/deep/{api,data,maintainability}/` and `test/expansion-{api,data,fixtures,final-acceptance}.test.mjs`.

Exclusions:
- Do not alter `enrich.mjs` claim statusing or `contracts/dimension.mjs`.
- Do not change `shared/artifacts.mjs` (records-for-text stays line-count based).
- Do not touch `test-integrity.json` / `test/baselines/expansion/*` (they lock files outside this plan's scope; verify with a full-suite run).
- Do not change the AC16 assertions — only the fixture file count.

## Acceptance Criteria
1. `node --test --test-concurrency=1` (authoritative) passes with 0 failures, including all existing gates (determinism, privacy, voice, constraints, baselines).
2. The data scanner no longer crashes on non-`read` outcomes: new unit + scanner-level regression tests pass proving typed diagnostics (`CAP`/`MALFORMED`/`UNREADABLE`/`UNSUPPORTED`, `line: null`) and no `SCANNER_FAILURE` fallback.
3. Scanning a repository with >10k lines of source in >96 candidate files (pxcli) yields `observed` status for api (6), data (5), and maintainability (6) claims: expected-claim coverage 83/83 eligible complete (79 observed + 4 not_detected), search spaces `complete: true`, `omittedCount: 0`.
4. T228 AC16 still proves "capped search is unverified, never not_detected" using a fixture with more than `API_SOURCE_FILE_LIMIT` source files.
5. Data sampling disclosure mirrors api: a fixture with more than `DATA_SOURCE_FILE_LIMIT` data-source files yields `complete: false`, `capped: true`, `omittedCount > 0`.

## Current-State Evidence
- Data crash root cause: `lib/scan/deep/data/scanner.mjs:88-95` — `extractionFor` returns `{ path, status: 'unverified', reason: 'UNREADABLE' }` (no `line` key, single hardcoded reason) for every non-`read` outcome; `model.mjs:110` requires `DIAGNOSTIC_KEYS = ['line','path','reason','status']` and `model.mjs:389` `exactKeys` throws `DataModelError` ("diagnostic fields do not match the schema"). Reproduction: `scan()` on pxcli throws; pipeline degrades via `pipeline/run.mjs:333` to the `SCANNER_FAILURE` fallback.
- API scanner already has the correct pattern: `api/scanner.mjs:32-45` `diagnosticForOutcome` (typed reasons, `line: null`), unit-tested at `test/expansion-api.test.mjs:1236-1243`.
- Record caps: `api/model.mjs:60-63`, `data/model.mjs:95-98`, `maintainability/model.mjs:79-81` all `maxRecords: 10_000`; `shared/artifacts.mjs:226-230` counts text *lines* as records. pxcli: 23 files/353 KB exhausted 10k records; 845 lines omitted; 402 of 527 files are `.py`.
- Sampling caps: `api/scanner.mjs:22` `API_SOURCE_FILE_LIMIT = 96` with `discloseSourceSampling` (lines 150-180); `data/scanner.mjs:23` `DATA_SOURCE_FILE_LIMIT = 96` with **no** disclosure. `API_LIMITS.maxFiles`/`DATA_LIMITS.maxFiles` = 256.
- Contract: `test/expansion-final-acceptance.test.mjs:904-914` AC16 — a 110-file fixture trips the 96-file sample → api `unverified`. Same pattern in `test/expansion-api.test.mjs:1260-1276` (`omittedCount === 110 - API_SOURCE_FILE_LIMIT`) and `test/expansion-fixtures.test.mjs:433-442`.
- Baselines: `test/baselines/expansion/test-integrity.json` locks only 8 files (fixtures + pipeline/parity/command tests) — none in scope; `semantic.json`/`renderer.md` cover the ten legacy dimensions only.

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| AD-1 | Records-for-text = lines stays as-is; only the budget values change | decision | `recordCount` in shared/artifacts.mjs:226-230; changing semantics would break maintainability `lines` (scanner.mjs:163) and cross-dimension tests | accepted |
| AD-2 | New record budgets: 500_000 (api/data, 16 MB) and 130_000 (maintainability, 4 MB), derived from byte-cap / 32-byte-min-line heuristic | decision | R&D probe: pxcli uses 77,892 records/2.78 MB (api,data) and 34,039 records/1.14 MB (maintainability); margins ≈ 6.4x/3.8x | accepted |
| AD-3 | Raise source samples to 512: `API_SOURCE_FILE_LIMIT`, `DATA_SOURCE_FILE_LIMIT`, `API_LIMITS.maxFiles`, `DATA_LIMITS.maxFiles` | decision | pxcli has 402 source/data candidates; limits must exceed that for claims to complete; AC16 stays satisfiable with fixtures >512 files | accepted |
| AD-4 | Data scanner gains api-parity sampling disclosure (`discloseSourceSampling`); completeness is never claimed when eligible sources are skipped | decision | api precedent `api/scanner.mjs:169-180`; prevents the overclaim the data scanner currently makes on repos >512 sources | accepted |
| AD-5 | AC16 semantics unchanged: capped search ⇒ unverified | constraint | T228 contract, `expansion-final-acceptance.test.mjs:904`; user-visible contract of the skill | accepted |
| AD-6 | `maxRecords` raising also raises derived validation bounds (`data/model.mjs:349` maxArray, `providers/api.mjs:58-60` maxArray/maxNodes) | observed side effect | single constant reused for extraction bounds; bounds stay bounded by byte caps and per-file caps; R&D suite passed | accepted |
| AD-7 | Plan file and fixes target the csm-scan skill repo (its own git repo), not pxcli | decision | the defect lives in the skill; pxcli used only as regression evidence | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| RD-1 | Does the data scanner crash on pxcli? | Direct `scan()` invocation, `/tmp/opencode/probe-data-error.mjs` | Read-only scan; all writes in /tmp/opencode; skill repo + pxcli git status clean after | `DataModelError: diagnostic fields do not match the schema` at model.mjs:389 via extractionFor | Fix 1 confirmed; root cause exact |
| RD-2 | Which claim statuses fail and why? | Pipeline probe printing per-dimension claim status + search spaces, `/tmp/opencode/probe-coverage.mjs` | Read-only; /tmp writes only; repos clean after | api 6 / data 5 / maintainability 6 unverified; data = SCANNER_FAILURE; api/maintainability = record cap (23 files, 845/516 omitted) | Scope = 3 dimensions, 17 claims |
| RD-3 | Are the caps the binding constraint, and do recalibrated caps fix pxcli? | Patched copy of lib in `/tmp/opencode/rd-scanfix` (limits 500k/130k, samples 512, data diagnostics + disclosure) probed against pxcli | Sandbox copy only; TMPDIR/XDG_* redirected to /tmp/opencode/rd-*; repos clean after | api/data: 402 files, 77,892 records, 2.78 MB, complete:true, observed; maintainability: 256 files, 34,039 records, complete:true, observed; coverage 83/83 | Design validated end-to-end |
| RD-4 | Do the patches break the test suite? | Full `node --test --test-concurrency=1` in sandbox with TMPDIR isolation | Sandbox only; fixture temp dirs under /tmp/opencode/rd-tmp; repos clean after | 1007/1007 pass, 0 fail, 0 skip | Fix set is suite-safe |
| RD-5 | Which tests hardcode the 96-file trigger? | `rg` over test/ for API_SOURCE_FILE_LIMIT / 110-file fixtures | Read-only | `expansion-final-acceptance.test.mjs:906`, `expansion-api.test.mjs:1262-1272`, `expansion-fixtures.test.mjs:435` | Three fixtures must grow past 512 |

## Discovered Requirements
- T228 AC16 inventory binds acceptance-test file lists and test names only (`test/baselines/expansion/inventory.json`), never fixture internals — updating fixture sizes inside `expansion-final-acceptance.test.mjs` is allowed; `test/expansion-final-acceptance.test.mjs:878-881` forbids `skip`/`todo` markers in acceptance files — keep that.
- `test/baselines/expansion/test-integrity.json` SHA-locks 8 files: `test/expansion-command-deep.test.mjs`, `test/fixtures-pipeline.test.mjs`, `test/fixtures/{javascript,python,rust,shell,typescript}.mjs`, `test/regression-parity.test.mjs`. None are in scope; the full suite run in RD-4 confirms no lock breaks.
- All six new-dimension scanners are wrapped in `safeScanDimension` (`pipeline/run.mjs:388-398`); scanner crashes degrade to `SCANNER_FAILURE` — the regression test must assert the *scanner* itself does not throw, not merely that the pipeline survives.
- `MAINTAINABILITY_LIMITS.maxRecords` is consumed by tests via the constant (`test/expansion-maintainability.test.mjs:72`), so value changes adapt automatically.
- Docstring/comment style: 2-space indent, JSDoc comments, Google style — match `api/scanner.mjs` when adding data-side code.

## Design
Target behavior after this plan, for any repository smaller than the (byte-consistent) caps:
- `api`, `data`, `maintainability` searches complete with `complete: true`, `omittedCount: 0`, claims `observed`; only genuinely huge repos (byte cap, file cap, or sample cap) are disclosed as capped → `unverified` per AC16.
- The data scanner never throws on reader outcomes; every non-`read` outcome becomes a typed, schema-valid diagnostic via a shared-pattern `diagnosticForOutcome` (mirror of `api/scanner.mjs:32-45`).
- The data scanner discloses source sampling exactly like api (`discloseSourceSampling`), preventing completeness overclaiming on repos with more data-source files than `DATA_SOURCE_FILE_LIMIT`.

Boundaries:
- Caps become: api/data `maxRecords: 500_000`, `maxFiles: 512`; maintainability `maxRecords: 130_000` (files stay 256); samples `API_SOURCE_FILE_LIMIT`/`DATA_SOURCE_FILE_LIMIT` = 512.
- Fixtures that prove "capped ⇒ unverified" grow from 110 to 560 source files (>512) so the sample cap still binds.

Key decisions (from Assumptions): keep line-count records (AD-1); recalibrate values not semantics (AD-2, AD-5); raise samples to 512 with disclosure parity (AD-3, AD-4).

Data flow after fix:
`enumerate -> dataRequests/requestList -> readArtifacts (512 files / 16 MB / 500k records) -> typed diagnostics on non-read -> sampling disclosure -> build model -> claims observed`.

## Execution Graph
- Critical path: T001 -> T004 -> T005 (with T002/T003 parallel to T001).
- Parallel groups:
  - G1 (independent, non-overlapping files):
    - T001 — `lib/scan/deep/data/scanner.mjs`, `test/expansion-data.test.mjs`
    - T002 — `lib/scan/deep/api/model.mjs`, `lib/scan/deep/data/model.mjs`, `lib/scan/deep/maintainability/model.mjs`
    - T003 — `lib/scan/deep/api/scanner.mjs`, `test/expansion-api.test.mjs`, `test/expansion-fixtures.test.mjs`, `test/expansion-final-acceptance.test.mjs`
  - G2 (after T001; same file as T001, so strictly sequential): T004 — `data/scanner.mjs`, `test/expansion-data.test.mjs`
  - G3 (after G1+G2): T005 — verification only, no writes beyond evidence notes.
- Write ownership: within each parallel group every file is owned by exactly one task. T004 shares `data/scanner.mjs` and `test/expansion-data.test.mjs` with T001 but depends on T001, so no concurrent write can conflict.

## Numbered Plan
1. [pending] Data scanner: typed, schema-valid outcome diagnostics (crash fix)
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `lib/scan/deep/data/scanner.mjs`, `test/expansion-data.test.mjs`
   - Not in scope: `data/model.mjs`, caps, sampling disclosure (T002/T004 concerns), api scanner
   - Spike candidate: none (root cause reproduced in RD-1)
   - Actions:
     - Replace `extractionFor`'s non-read branch (currently `scanner.mjs:88-95`) to use a new exported `diagnosticForOutcome(result)` mirroring `api/scanner.mjs:32-45`: `{ path, status: 'unverified', reason: CAP|MALFORMED|UNREADABLE|UNSUPPORTED, line: null }` keyed off `result.status`.
     - Add JSDoc matching the api counterpart; keep zero-dep imports.
     - In `test/expansion-data.test.mjs`, add unit tests for `diagnosticForOutcome` covering all four statuses + unknown-status fallback (parity with `expansion-api.test.mjs:1236-1243`).
     - Add a scanner-level regression test: a fixture with a malformed data artifact (e.g., `db/malformed.sql` containing a statement the extractor marks MALFORMED) plus a normal peer file, asserting the scanner resolves without throwing, diagnostics carry `line: null`, and valid peer records survive.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-data.test.mjs` passes, including the new `diagnosticForOutcome` parity tests and the no-crash regression test.
   - Validation: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs` (data fixture pipelines still green); direct invocation `await scan(dir, {})` on a capped fixture returns a model, never throws.
   - Acceptance evidence: recorded pass output of the two test files; the regression test name and its assertion lines.
   - Repair attempts: 0
   - Recovery note: if `expansion-data.test.mjs` fails, diff against the api parity tests; the fix is localized to `scanner.mjs` — check `git diff lib/scan/deep/data/scanner.mjs` to confirm only the diagnostic branch changed.

2. [pending] Recalibrate record budgets to byte-consistent values
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: standard
   - Owned scope: `lib/scan/deep/api/model.mjs`, `lib/scan/deep/data/model.mjs`, `lib/scan/deep/maintainability/model.mjs` (limit constants only)
   - Not in scope: `api/scanner.mjs` / `data/scanner.mjs` sample constants (T003/T004), any test file, `shared/artifacts.mjs`, provider bounds
   - Spike candidate: none (values validated in RD-3)
   - Actions:
     - In `api/model.mjs` and `data/model.mjs`: `maxRecords: 10_000` -> `500_000`; `maxFiles: 256` -> `512`.
     - In `maintainability/model.mjs`: `maxRecords: 10_000` -> `130_000` (maxBytes stays 4 MB, files stay 256).
     - Note derived bounds that shift with the constants (no code change): `data/model.mjs:349` `maxArray: DATA_LIMITS.maxRecords`; `providers/api.mjs:58-60` `maxArray`/`maxNodes` — confirm the full suite passes with the new bounds (RD-4).
   - Acceptance signal: `rg -n "maxRecords|maxFiles" lib/scan/deep/api/model.mjs lib/scan/deep/data/model.mjs lib/scan/deep/maintainability/model.mjs` shows api `maxRecords: 500_000` + `maxFiles: 512`, data `maxRecords: 500_000` + `maxFiles: 512`, maintainability `maxRecords: 130_000` (and no remaining `10_000` record budgets), and `node --test --test-concurrency=1 test/expansion-maintainability.test.mjs test/expansion-api.test.mjs test/expansion-data.test.mjs` passes.
   - Validation: `node --test --test-concurrency=1 test/expansion-determinism.test.mjs` (determinism gates unaffected by limits); spot-check `test/expansion-provider-api-catalog`-style provider tests still pass in the full run.
   - Acceptance evidence: recorded `rg` output and the three test-file pass output.
   - Repair attempts: 0
   - Recovery note: constants are centralized; a failed test means a fixture exercises a bound — read the failure before re-editing; do not lower any value below the pxcli R&D numbers without re-running RD-3.

3. [pending] Raise API source sample and update the capped-search contract fixtures
   - Task ID: T003
   - Depends on: none
   - Parallel group: G1
   - Risk: high (edits a T228 acceptance test; requires independent review before merge)
   - Owned scope: `lib/scan/deep/api/scanner.mjs`, `test/expansion-api.test.mjs`, `test/expansion-fixtures.test.mjs`, `test/expansion-final-acceptance.test.mjs`
   - Not in scope: `api/model.mjs` limits (T002), data scanner (T001/T004), AC16 assertions, inventory/test-integrity baselines
   - Spike candidate: none (fixture arithmetic verified by reading the three tests)
   - Actions:
     - `api/scanner.mjs:22`: `API_SOURCE_FILE_LIMIT = 96` -> `512`.
     - Update the sampling-cap fixtures to exceed the limit: `test/expansion-final-acceptance.test.mjs:905-906` (AC16), `test/expansion-api.test.mjs:1261-1265` (cap fixture) and its assertion at line 1272, `test/expansion-fixtures.test.mjs:434-435` (t226) — 110 files -> 560 files.
     - Prefer limit-derived arithmetic: assert `omittedCount === 560 - API_SOURCE_FILE_LIMIT` (keeps the pattern already used at `expansion-api.test.mjs:1272`); keep the AC16 assertions (`complete: false`, `capped: true`, `omittedCount > 0`, status `unverified`) byte-for-byte.
     - Update the stale comment at `test/expansion-fixtures.test.mjs:433` (">96 source files…") to the new limit.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-final-acceptance.test.mjs test/expansion-api.test.mjs test/expansion-fixtures.test.mjs` passes; the AC16 test name "T228 AC16: a capped search is unverified, never not_detected" still passes unchanged.
   - Validation: `node --test --test-concurrency=1 test/expansion-determinism.test.mjs`; confirm no `skip`/`todo` markers introduced in acceptance files (final-acceptance test at line 878-881 enforces this).
   - Acceptance evidence: recorded pass output; `git diff test/expansion-final-acceptance.test.mjs` showing only fixture-size lines changed in AC16.
   - Repair attempts: 0
   - Recovery note: if AC16 fails, the fixture count is still below 512 or an assertion was altered — revert the assertion, not the fixture. Independent review required because this touches a contract test.

4. [pending] Raise data source sample and add api-parity sampling disclosure
   - Task ID: T004
   - Depends on: T001 (shares `data/scanner.mjs` and `test/expansion-data.test.mjs`; strictly sequential to avoid write conflicts)
   - Parallel group: G2
   - Risk: standard
   - Owned scope: `lib/scan/deep/data/scanner.mjs`, `test/expansion-data.test.mjs`
   - Not in scope: `data/model.mjs` limits (T002), api scanner (T003), the diagnostic fix (T001 — already merged before this task starts)
   - Spike candidate: none (pattern copied from `api/scanner.mjs:150-180`; validated in RD-3)
   - Actions:
     - `data/scanner.mjs:23`: `DATA_SOURCE_FILE_LIMIT = 96` -> `512`.
     - Add `sourceEligibleCount(files)` and `discloseSourceSampling(files, searchSpace)` mirroring `api/scanner.mjs:150-180`: eligible = candidates that are not `other`, not migrations (`migrationKindOf`), not sql/prisma (`classifyDataPath`); skipped = eligible - min(eligible, limit); when skipped > 0 return `{ ...searchSpace, complete: false, capped: true, omittedCount: searchSpace.omittedCount + skipped }`.
     - Call the disclosure in `scan()` after `readArtifacts` (same position as api).
     - In `test/expansion-data.test.mjs`, add a scanner-level test: a fixture with >512 data-source files (e.g., 560 `models/modelN.py` files) plus one peer, asserting `complete: false`, `capped: true`, `omittedCount === 560 - DATA_SOURCE_FILE_LIMIT`, and that the skipped file's content never appears in the model.
   - Acceptance signal: `node --test --test-concurrency=1 test/expansion-data.test.mjs` passes, including the new sampling-disclosure test.
   - Validation: `node --test --test-concurrency=1 test/expansion-fixtures.test.mjs`; JSON round-trip of the data findings stays privacy-safe (`test/expansion-privacy-gate.test.mjs`).
   - Acceptance evidence: recorded pass output; the disclosure test name and its assertion lines.
   - Repair attempts: 0
   - Recovery note: T001's diagnostic edit must be merged first; if `expansion-data.test.mjs` fails, diff against the api parity tests — the fix is localized to `scanner.mjs`.

5. [pending] Full-suite and real-repo verification gate
   - Task ID: T005
   - Depends on: T001, T002, T003, T004
   - Parallel group: G3
   - Risk: standard
   - Owned scope: no source writes; evidence files under the plan's `evidence/` notes only
   - Not in scope: any further code changes; if the gate fails, return to the failing task
   - Spike candidate: none
   - Actions:
     - Run the authoritative suite: `node --test --test-concurrency=1` (full suite; not just changed files).
     - Run the regression probe against a real repo >10k lines / >96 candidates: point the pipeline at pxcli (or a repo with >=402 source files) and record `expectedClaimCoverage` — expect 83 eligible, 83 complete (79 observed + 4 not_detected), api/data/maintainability `observed`, search spaces `complete: true`, `omittedCount: 0`, and no `SCANNER_FAILURE` diagnostics.
     - Record the suite tail (pass count) and the probe output in the plan's evidence notes.
   - Acceptance signal: full suite 0 failures AND the pxcli probe shows 83/83 claim coverage with api/data/maintainability observed.
   - Validation: re-run `test/expansion-determinism.test.mjs` alone if the full suite is noisy; confirm the skill repo `git status --short` shows only the intended modified files.
   - Acceptance evidence: recorded full-suite pass line and probe coverage JSON.
   - Repair attempts: 0
   - Recovery note: if the probe shows unverified claims, check which cap binds (searchSpace `capped`/`omittedCount`/`recordLimit`) and return to T002/T003/T004 — do not lower contract semantics.

## Verification Strategy
- Per-task fast gates (cheapest first): targeted test files (`node --test --test-concurrency=1 test/expansion-*.test.mjs` for the touched suite) after each task; `rg` checks for constant values.
- Batch gates (full suite, one run, authoritative): `node --test --test-concurrency=1` — run in T005 after all tasks; covers determinism, privacy, voice, constraints, baselines, and the acceptance inventory.
- Final integration gate: real-repo probe (pxcli) — expected 83/83 coverage.
- Parallelism: T001-T003 run concurrently in G1; T004 sequential after T001; T005 serial after all.
- Environment-sensitive: none known; the suite is fixture-isolated. TMPDIR must be writable (default tmpdir is fine; the R&D sandbox used an isolated TMPDIR).

## Risks And Recovery
- R1 (high): T003 edits a T228 acceptance test — mitigated by limit-derived arithmetic and byte-for-byte preservation of AC16 assertions; requires independent review; rollback = revert the fixture-size lines only.
- R2 (medium): data scanner changes land from two tasks on one file — resolved by making T004 depend on T001 (G2 strictly sequential); disjoint functions and a recovery note remain for safety.
- R3 (medium): a future repo exceeds the new budgets (>500k lines, >512 sources, >256 maintainability files) — claims become `unverified` with full disclosure, which is the designed, AC16-compliant fallback; not a regression.
- R4 (low): derived validation bounds shift with `maxRecords` (providers/api.mjs maxNodes = ~12M) — bounded counting, no allocation; RD-4 suite pass confirms.
- R5 (low): golden/baseline drift — none of the locked files are touched; if `test-integrity.json` fails, an out-of-scope file changed; investigate before proceeding.

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| (self-critique) T003's fixture count 560 is a magic number | low | Keep the constant-derived assertion pattern (`560 - API_SOURCE_FILE_LIMIT`); document 560 = limit + 48 in the task | expansion-api.test.mjs:1272 existing pattern |
| (self-critique) Two tasks edit `data/scanner.mjs` | medium | T004 now depends on T001 (G2 strictly sequential); write ownership is exclusive within every parallel group | RD-3 sandbox applied both changes together and passed; Execution Graph |
| (self-critique) Could claims semantics instead be changed so caps don't force unverified? | medium | Rejected: violates T228 AC16 and the skill's documented contract; recalibration addresses the cause while preserving the contract | expansion-final-acceptance.test.mjs:904; AD-5 |
| (self-critique) Is raising maxFiles to 512 a cost risk? | low | Reads stay bounded by 16 MB bytes / 500k records; pxcli = 2.78 MB / 77,892 records | RD-3 probe |
| (self-critique) Does raising `maxRecords` loosen adversarial bounds? | low | maxNodes bound grows to ~12M counting iterations with no allocation; payloads still byte-capped | providers/api.mjs:58-60; RD-4 |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-03 | 0 | INTAKE | — | Ask classified: small-medium, prescribed fixes (root causes diagnosed in prior scan session); goal restated | DISCOVER |
| 2026-08-03 | 0 | DISCOVER | — | Skill repo inspected: data crash path, api parity pattern, cap constants, AC16 contract, baseline locks | RESEARCH |
| 2026-08-03 | 0 | RESEARCH | — | RD-1..RD-5: crash reproduced, caps proven binding, patched sandbox yields 83/83 on pxcli, full suite 1007/1007 green, three 110-file fixtures located | DRAFT |
| 2026-08-03 | 0 | DRAFT | — | Plan drafted with 5 tasks, 3 parallel groups, per-task acceptance signals | CRITIQUE |
| 2026-08-03 | 0 | CRITIQUE | — | Primary-agent hostile review (small plan); 5 findings recorded and resolved | REMEDIATE |
| 2026-08-03 | 0 | REMEDIATE | — | No remediation agents needed; findings folded into Design/Notes/Risks | VERIFY |
| 2026-08-03 | 0 | VERIFY | — | Primary gate: criteria map to T001-T005; acceptance signals runnable; file ownership non-overlapping; AC16 preserved | SAVED |
| 2026-08-03 | 0 | SAVED | — | Plan saved and committed; implementation not started | STOP |

## Completion Review
(filled by csm-build when all criteria are verified)
