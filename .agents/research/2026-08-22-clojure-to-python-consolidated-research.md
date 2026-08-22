format: csm-deep-research/1

# Clojure-to-Python Adserver Conversion — Consolidated Research Finding (Migration + Python Doctrine + Idiomatic Review)

## TL;DR

Consolidates three findings: (1) deterministic LLM-driven Clojure→Python migration, (2) PEP 20 as modern Python architecture doctrine, (3) idiomatic-Python reviewer rules — one playbook for converting the adserver AND writing Python the converted code should satisfy. Determinism is a harness property (static-analysis decomposition → constrained decoding → execution-verified repair loops → differential dual-run acceptance); migrate strangler-style, never big-bang; target-state style is pyproject/uv/src-layout with boundary-only validation and a ruff+pyright+judgment reviewer wired as the migration's acceptance gates. Industrial evidence supports ~50% effort reduction with mandatory human gates.

## Executive Summary

```text
Clojure adserver + CRUD -> [Phase 0 inventory + golden masters + perf baseline]
  -> [Phase 1 contracts + translation rulebook] -> [Phase 2 LLM harness:
  clj-kondo decomposition -> dependency-ordered batches -> structured-output
  translation -> spec-derived test oracle -> repair loop -> eval gates]
  -> [Phase 3 leaf-first unit conversion, gated per unit]
  -> [Phase 4 strangler coexistence: proxy routing, shadow traffic, parity dashboard]
  -> [Phase 5 per-endpoint cutover by routing flip -> soak -> decommission]
```

This document consolidates three prior findings in the same workstream — `2026-08-22-clojure-to-python-llm-migration-research.md` (six web-mode tracks: strategy, semantic mapping, translation research, harness tooling, adserver performance, verification), `2026-08-22-pep20-python-2026-research.md` (PEP 20 doctrine for the target architecture), and `2026-08-22-python-idiomatic-reviewer-research.md` (idiomatic-Python reviewer rules for acceptance gating) — superseding all three. The migration tracks converge on one answer: the industry-validated pattern for LLM-driven migration separates a deterministic program-analysis layer (targeting, decomposition, validation) from LLM edit generation, and makes acceptance an execution-verified, human-gated decision [R9][R10]. Google's 39-migration study reports 74.45% of changes LLM-generated with ~50% time saved [R41]; AlphaTrans shows repository-level auto-translation reaching ~25% machine-verified functional correctness with ~20h/project human fix-up [R34]; dependency-consistent batch translation lifted an industrial migration from 9.39% to 100% compile+test success [R37]. The headline caveat: no published Clojure→Python production case study exists — Clojure evidence is one practitioner account [R29] plus benchmark inclusion [R44] — and Python's GIL caps CPU-bound concurrency on the ad-serving hot path [R69], so performance strategy must be explicit, not assumed.

## Key Findings

- K1. PROVISIONAL supported Big-bang replacement of a working production adserver fails more often than incremental strangler-fig migration with coexistence patterns (parallel run, fork-on-ingress, dark launching); rollback should be a routing flip, not a redeploy. [R1][R3][R4][R5][R6][R7]
- K2. PROVISIONAL supported LLM inference is nondeterministic even at temperature 0 with pinned seeds (batch-size variance; 1,000 temp-0 completions → 80 unique outputs; vendor seeded sampling is explicitly "best effort"), so "deterministic conversion" must be engineered at the harness: deterministic static-analysis targeting, playbook-constrained planning (up to +15.79% consistency, LLM-judged, upper bound), grammar/structured decoding for format, and execution-verified acceptance gates. [R8][R38][R39][R40]
- K3. PROVISIONAL supported The pipeline shape — program-analysis decomposition → dependency-ordered fragment/batch translation → source-derived test oracle → execution-driven repair → whole-program validation → human review — is research-validated on statically-typed, mostly JVM/CLR language pairs (AlphaTrans: 96.40% syntactic / 25.14% machine-validated functional correctness on 10 Java repos, ~34h machine + ~20h human per project; DepWareTrans: Java→Kotlin 9.39%→100% compile+test via dependency-consistent batches; Self-Debugging +12%; TransAGENT +33.3%) — no component has been validated on Clojure or lazy-seq functional source languages, so transfer to Clojure→Python is reasoned extrapolation, not direct evidence. [R32][R33][R34][R35][R36][R37]
- K4. PROVISIONAL supported Industrial LLM migrations at Google deliver most edits (74.45% of changes / 69.46% of edits LLM-generated across 39 migrations in one 12-month, 3-developer program; JUnit3→4: 87% of generated code committed unchanged across 5,359 files/149k lines; Ads int32→int64: 80% of modifications AI-authored) and developer-estimated ~50% time savings — but humans remained mandatory (reverting model mistakes before review sharding), and simple prompting alone was insufficient without AST/heuristic scaffolding. [R9][R10][R41][R42]
- K5. PROVISIONAL supported A semantic mapping rulebook is mandatory harness input: naive LLM translation breaks on lazy seqs (persistent/re-iterable) vs Python's stateful single-pass iterators, nil-punning, atoms/STM vs locks, core.async go-blocks vs asyncio (no M:N green threads, no `alts!`), persistent collections vs mutable defaults, spec vs pydantic/msgspec, Ring vs ASGI. Function-by-function conversion with captured-output comparison is the only practitioner-validated Clojure→Python method (n=1, POC-scale). [R11][R13][R17][R18][R19][R20][R21][R28][R29]
- K6. PROVISIONAL supported Python can meet adserver latency with the right stack (uvloop 2-4x, Granian Rust server, orjson/msgspec decode+validate) but the GIL caps CPU-bound per-process concurrency (PEP 703: bottleneck even <10 threads); free-threaded CPython is officially supported in 3.14 with ~5-10% single-thread overhead and +15-20% memory; documented counter-evidence exists (Stream: one ranking component's Go rewrite ~40x faster than optimized Python, with author-noted caveats). The CRUD side is unproblematic (FastAPI + SQLAlchemy 2.0 async). OpenRTB `tmax` budgets are hard and intermediaries should (spec normative verb) shrink them per hop. [R59][R62][R63][R65][R66][R68][R69][R70][R71][R73][R74]
- K7. PROVISIONAL supported The verification net is what makes the converted system deterministic-in-effect: golden-master/characterization tests recorded from Clojure (with masking), clojure.spec generators as a shared conformance corpus, dual-run diffing + GoReplay shadow traffic, Hypothesis stateful tests with the legacy system as oracle, metamorphic properties, mypy strict, mutation-test gates, k6 SLO thresholds as CI exit codes, canary + feature flags (Off=legacy), Pact contracts, and Grafana parity dashboards. [R7][R75][R76][R77][R78][R79][R80][R81][R82][R83][R85][R86][R87][R88][R89]
- K8. PROVISIONAL partially-supported A concrete toolchain exists for every harness stage — clj-kondo + tree-sitter-clojure for decomposition; OpenAI Structured Outputs + Batch API (50% discount) or Anthropic strict outputs + Message Batches; Outlines/XGrammar/LM Format Enforcer for self-hosted constrained decoding; DSPy/LangGraph for mixed deterministic/LLM orchestration; Aider scripted mode / Claude Code headless / OpenHands SDK as agent harnesses; promptfoo for eval gating — but no published Clojure→Python translation system exists: Clojure proficiency evidence is MultiPL-E inclusion plus one practitioner account, so Clojure-specific effort estimates carry extra uncertainty. [R29][R44][R45][R46][R47][R48][R49][R50][R51][R52][R53][R54][R55][R56][R57][R58][R60]
- K9. PROVISIONAL supported LLM-driven migration runs at scale fail operationally and introduce supply-chain hazards: high-volume parallel runs have collapsed under rate-limit throttling (mitigated only after retry logic was encoded in the playbook), and generated code references nonexistent packages (≥5.2% commercial / 21.7% OSS across 576k samples, 16 models); the harness therefore needs run-level throttling/retry orchestration, pinned dependency allowlists, and registry-existence verification gates before any generated import is accepted. [R8][R43][R38]


### Python target-state doctrine (consolidated from PEP 20 finding; verdicts CONFIRMED in source run)

- P1. CONFIRMED supported PEP 20 remains the living design doctrine and functions as a trade-off rubric, not a rulebook — use it as the tie-breaker when translated designs compete. [P1][P3][P60]
- P2. CONFIRMED supported Target-state shape: pyproject.toml-only metadata, uv + src layout, ruff format/check via pre-commit, apps commit uv.lock with pylock.toml export open, libraries never pin deps. [P13][P14][P16][P17][P21][P22][P23]
- P3. CONFIRMED supported Typing is gradual and runtime-unenforced: annotate everything new, pyright "standard" org-wide, per-file strict escalation on hot modules; validation lives ONLY at I/O boundaries (pydantic parse-don't-validate); interior code uses dataclasses/enums to make illegal states unrepresentable. [P25][P29][P30][P32][P33][P53]
- P4. CONFIRMED supported Dependency inversion via Protocols (static duck typing) accepting Mapping/Sequence/Iterable and returning concrete types, explicit module wiring without DI frameworks — the direct replacement for Clojure protocols/Integrant seams. [P26][P27][P36]
- P5. CONFIRMED supported Errors EAFP with flat custom exception hierarchies; stay sync-first, asyncio only for IO-bound network-shaped workloads; pytest strict + fixtures + Hypothesis round-trips + doctests, coverage floors without worship (Google ~70/20/10 pyramid). [P5][P37][P40][P43][P45]
- P6. CONFIRMED supported Governance hedge: Astral joined OpenAI's Codex team (Mar 2026) — keep checker/metadata portability open rather than standardizing on one vendor's stack. [P20]

### Idiomatic-Python reviewer integration (consolidated from reviewer finding)

- V1. PROVISIONAL supported The mechanical tier is consumed, not redefined: ruff's 900+ rule catalog (~400 default) + mypy/pyright form the lint/type gates of migration Phases 2-3; ruff officially cedes type checking to mypy/pyright. [V59][V60][V91]
- V2. PROVISIONAL supported Judgment tier covers exactly what linters cannot: mutable class attribute gotchas, complexity interpretation, docstring semantics (D-rules), test validity ("tests do not test themselves") — route these to human review prompts alongside parity evidence. [V62][V64][V84][V88]
- V3. PROVISIONAL supported Severity vocabulary: reuse pylint C/R/W/E/F classes + Google Nit tokens for triage of translation findings; chunk reviews ≤400 LOC matching human defect-yield physics. [V92][V87][V90][V89]
- V4. PROVISIONAL supported Machine-readable rule set exists as declared artifact `2026-08-22-python-idiomatic-reviewer-rules.json` (138+4 entries, three tiers + severity map D8a) — wire it directly into the harness eval config. [V59][V92]

## Detail Sections

### D1. Migration strategy (expands K1)

Big-bang replacement of working production systems "go[es] down in flames most of the time"; strangler fig migrates behavior piece by piece behind a routing façade [R1][R4][R5]. Thoughtworks' legacy-displacement experience warns that chasing strict feature parity first pushes teams into a single risky big-bang cutover; coexistence patterns (parallel run, fork-on-ingress, diversion of flow) de-risk instead [R3]. Zalando's parallel run calls both implementations, compares outputs, keeps the old system authoritative until measured equivalence, and cuts over per-endpoint by proxy — rollback is a routing flip [R7].

```text
Rewrite vs migrate decision:
  System revenue/latency critical?
        |-- yes --> Big-bang rewrite?  NO -> strangler fig + parallel run (see K1)
        |                                        |-- equivalence measured --> routing-flip cutover
        |-- no  --> rewrite viable only after quarterly fork/migrate/rewrite review [R6]
```

Data coexistence uses CDC sync + validation so rollback to the monolithic store remains possible until legacy objects are deliberately removed [R4]. Branch by Abstraction + feature flags let the new implementation be diffed against the old in test environments before client switch [R2].

### D2. The determinism model (expands K2)

LLM sampling is not reproducible in production: batch-size variance makes even temp-0 outputs diverge (80 unique outputs from 1,000 temp-0 completions) [R39]; Azure documents seeded sampling as best-effort only [R38]. AWS's migration team states two identical runs can produce different final states, and their fix is to constrain the *planner* with distilled playbooks (+15.79% consistency) [R8]. Google's structure puts LLMs only in the middle: deterministic static analysis targets locations; LLMs generate edits; deterministic validation accepts or rejects them [R9][R10].

```text
Where determinism actually comes from:
  Layer 1  targeting/decomposition   clj-kondo + tree-sitter  (deterministic code)
  Layer 2  planning                  playbook-constrained     (variance reduced up to ~16%, LLM-judged metric) [R8]
  Layer 3  generation                structured/grammar-constrained decoding (format-guaranteed) [R40][R45][R46][R47]
  Layer 4  acceptance                execution-verified gates (test oracle decides, not the model) [R33][R34]
  Layer 5  system equivalence        dual-run differential testing vs live Clojure [R7][R78]
```

The accepted artifact is deterministic-in-effect regardless of sampling variance because every unit must pass the same fixed gates.

### D3. The conversion pipeline (expands K3)

```mermaid
flowchart LR
    A[Clojure repo] --> B[clj-kondo/tree-sitter\nanalysis + call graph]
    B --> C[dependency-ordered\nfragments/batches]
    C --> D[structured-output\ntranslation]
    D --> E[spec-derived test oracle]
    E --> F{tests pass?}
    F -- no --> G[repair loop\nexecution feedback]
    G --> D
    F -- yes --> H[whole-program validation\ngolden + property suites]
    H --> I[human review gate]
    I --> J[Python service]
```

Research systems converge on this shape — validated on statically-typed, mostly JVM/CLR pairs; Clojure transfer is extrapolation (see K3). UniTrans auto-generates tests from the source program and iteratively repairs from execution results [R33]; Self-Debugging adds up to 12% via execution feedback [R32]; AlphaTrans decomposes real repositories via program analysis and translates fragments in reverse call order — 96.40% syntactic validity but only 25.14% machine-validated functional correctness (fraction of fragments, not end-to-end programs), with two developers fixing the remainder in ~20h/project [R34]; TransAGENT's execution-aligned multi-agent loop beats UniTrans by up to 33.3% [R35]; Skel proves decomposition soundness (correct fragments ⇒ correct whole given a faithful skeleton) [R36]; DepWareTrans shows file-level translation fails on cross-file dependencies (9.39% test success) while dependency-consistent batches reach 100% on a 51K-LOC industrial codebase [R37]. Failure modes to design against: hallucinated packages (≥5.2% commercial models) [R43], semantic drift rather than syntax errors [R33], and benchmark techniques failing on real repos [R34]. Practitioner method for Clojure specifically: convert function-by-function, compare against captured Clojure outputs, seed prompts with converted exemplars [R29]. Google orders migrations from cross-reference DAG clusters sized to one prompt, converting leaf-first with wrappers at boundaries of unmigrated dependents [R10].

### D4. Semantic mapping rulebook (expands K5)

Feed this table to the harness as translation rules; each row is evidence-backed.

| Clojure | Python target | Risk note |
|---|---|---|
| persistent vector/map/set | pyrsistent PVector/PMap/PSet | structural sharing preserved [R11] |
| keywords / sentinels | PEP 661 `sentinel()` (3.15); Enum fallback | missing ≠ None [R12] |
| Ring handler/middleware | ASGI app + middleware(scope, receive, send) | async-native successor to WSGI [R13][R14][R15] |
| Compojure/Reitit routes | FastAPI APIRouter tree ("mini FastAPI") | route metadata → router kwargs [R16] |
| core.async go blocks | asyncio coroutines | no M:N parking; blocking needs await/executor [R17] |
| channels / alts! | asyncio.Queue (bounded) | no alts! multiport select; not thread-safe [R18] |
| pmap / agents / STM | multiprocessing + threading.Lock | no CAS atom, no STM in stdlib [R19] |
| clojure.spec / malli | pydantic v2 (CRUD) / msgspec (hot path) | pydantic mutable unless frozen [R20][R21] |
| protocols / multimethods | ABCs / functools.singledispatch | dispatch on first arg type only [R22] |
| HoneySQL | SQLAlchemy Core expressions | [R23] |
| next.jdbc / JDBC | asyncpg binary-protocol pool | [R24] |
| Component/Integrant/Mount | dependency-injector / FastAPI Depends | lifecycle graphs explicit [R25] |
| ex-info maps | Exception subclasses + raise-from | [R26] |
| lazy seqs | lists / generators (choose deliberately) | TOP RISK: seqs are persistent & re-iterable; Python iterators single-pass stateful cursors [R28] |
| nil-punning | explicit None handling + sentinels | None raises on protocol use [R12][R28] |
| destructuring / metadata / transducers | manual unpacking / wrapper attrs / toolz or hand-written | no stdlib xform arity — practitioner-lore rows, under-cited pending re-source [R29] |

Note: the nil-punning/destructuring/metadata/transducer mismatch items originate from practitioner experience, not the cited primary sources; treat them as hypotheses to verify against your own codebase during Phase 1.

### D5. Adserver performance reality (expands K6)

OpenRTB gives bidders a hard millisecond budget (`tmax`, inclusive of network latency) and requires intermediaries to shrink it hop by hop [R62]; concrete 100ms values are exchange practice, not spec text (recorded assumption). The incumbent JVM stack has enormous headroom (http-kit >600k concurrent connections; Netty purpose-built for low latency) [R63][R64]. The Python equivalent of that headroom is: uvloop (2-4x asyncio speedup) [R65] under Granian (Rust/Hyper/Tokio ASGI/RSGI server used by Microsoft/Mozilla/Sentry) [R66], with msgspec decoding+validating JSON faster than orjson decodes alone [R21][R68]. The wall is the GIL: request-parallel latency-sensitive workloads bottleneck even below 10 threads [R69]; Granian funnels all request interop through one GIL-holding event-loop thread [R66]. Free-threaded builds are officially supported in Python 3.14 (~5-10% single-thread penalty, +15-20% memory) [R70][R71]; PyPy averages ~3x but orjson will never support it [R72]. Counter-evidence is real: Stream's Go rewrite ran ~40x faster than highly optimized Python [R73].

```text
Hot path (bid serving)?
  |-- CPU-bound decisioning heavy? --> keep hot path on JVM OR isolate Python
  |     behind precomputed/async design; consider free-threaded 3.14 build [R69][R70]
  |-- IO-bound proxy/routing shape? --> Python viable: uvloop+Granian+msgspec,
  |     process sharding per core; load-test gates mandatory before cutover [R86]
CRUD/admin surface --> FastAPI + SQLAlchemy 2.0 async (no implicit IO; N+1 made loud) [R16][R74]
```

### D6. Verification net (expands K7)

| Gate | Type | Tool |
|---|---|---|
| Golden masters recorded from Clojure | characterization | pytest-regressions / syrupy; mask timestamps/IDs [R75][R76][R77] |
| Shared input corpus | generator-derived | clojure.spec generators → both stacks [R80] |
| Dual-run response diffing | differential/shadow | GoReplay replay to staging [R78] |
| Stateful parity | property-based | Hypothesis RuleBasedStateMachine, legacy-as-oracle [R27][R81] |
| Oracle-free equivalence | metamorphic | order-invariance relations (e.g., bid ranking) [R82] |
| Static contract | type gate | mypy strict=true [R83]; coverage baseline [R84] |
| Net-strength proof | mutation | mutmut surviving-mutant budgets [R85] |
| Latency SLO gate | performance | k6 thresholds as CI exit codes [R86] |
| Rollout safety | release | canary + feature flags Off=legacy [R87][R88] |
| Service boundaries during coexistence | contract | Pact [R89] |

Characterization tests are change detectors, not correctness proofs — exactly right when the old system is the spec [R75]. Parity is operationalized as per-endpoint Grafana matched/unmatched counters with consistency thresholds [R7].

### D7. Toolchain (expands K8)

| Stage | Tools |
|---|---|
| Decomposition/targeting | clj-kondo machine-readable analysis (vars/arities/namespaces, native, no JVM) [R57]; tree-sitter-clojure AST slicing [R56] |
| Generation API | OpenAI Structured Outputs + Batch API (50% discount, 50k req/batch) [R45][R59]; Anthropic strict tool use/output_config + Message Batches (50%, caching stacks) [R46][R60] |
| Self-hosted constraints | Outlines (JSON Schema/regex/CFG across providers) [R47]; XGrammar (default backend vLLM/SGLang/TensorRT-LLM) [R48]; LM Format Enforcer [R49] |
| Orchestration | DSPy typed signatures compiled vs metrics [R50]; LangGraph mixing deterministic steps with LLM steps [R51] |
| Agent harnesses | Aider scripted shell loops + repo map [R53][R54]; Claude Code headless `-p --output-format json` [R52]; OpenHands Agent SDK/Server [R55] |
| Eval gating | promptfoo CI evals w/ caching/concurrency [R58]; SWE-bench Verified mini-SWE-agent standardization for model selection [R61] |

Constrained decoding guarantees format, not semantics — it eliminates parse/retry loops but the execution gates of D6 remain the semantic authority [R45][R40].

### D8. Evidence limits for Clojure specifically (expands K8)

MultiPL-E includes Clojure among its benchmark languages, making it one of very few Lisp-family languages with systematic LLM measurement — but no dedicated Clojure→Python translation system was found in any searched literature [R44]. The only firsthand practitioner account converts function-by-function with Copilot, test-compares captured outputs, and reports one-shot whole-codebase conversion failing and Python codebases growing substantially larger [R29]. Enterprise effort numbers therefore transfer from Java/Python pairs with a recorded caveat.


### D9. Python target-state doctrine (expands P1-P6)

The converted codebase should land idiomatic by construction, not be linted into shape later. Playbook (apply in order, from the PEP 20 finding): `uv init` + src layout; pyproject.toml-only metadata (`python setup.py` CLI deprecated, config-file use is not); ruff format+check via pre-commit mirrored in CI; apps commit uv.lock with a pylock.toml export path; libraries publish ranged deps; annotate all new code with pyright "standard" + per-file strict on hot modules; pydantic only at I/O edges (parse-don't-validate), dataclasses/enums inside; accept protocols/abstract types, return concrete types, wire explicitly (no DI framework); EAFP errors with flat hierarchies; sync-first; pytest strict + fixtures + Hypothesis round-trips + doctests with a coverage floor; re-read the Zen as tie-breaker. [P1][P13][P14][P16][P17][P18][P21][P22][P23][P29][P30][P32][P33][P53][P26][P27][P36][P5][P37][P40][P43][P45]

### D10. Idiomatic-Python reviewer as migration gate (expands V1-V4)

The reviewer finding slots directly into harness Phases 2-3 as the acceptance gate's mechanical tier: pre-filter every translated diff through ruff + mypy/pyright, ingest output as context, then judge only the non-lintable categories (mutable-attribute gotchas, complexity interpretation, docstring semantics, test validity, concurrency). Severity triage reuses pylint C/R/W/E/F + Google Nit tokens; review chunks ≤400 LOC. The declared artifact `2026-08-22-python-idiomatic-reviewer-rules.json` (138+4 entries, three tiers + severity map) wires the rule corpus into eval config directly. Authority conflicts (line length, import style, dunder privacy) are parameterized per project, never hardcoded. [V59][V60][V91][V62][V64][V84][V88][V92][V87][V90][V89][V65][V63]

## Recommendation

Run a strangler-fig migration executed by a deterministic harness; never a big-bang LLM rewrite. Phases:

- **Phase 0 — Inventory & safety net (deterministic tooling):** clj-kondo analysis → call graph + namespace DAG [R57]; record golden-master tests from the live Clojure system with nondeterminism masked [R75][R76]; export clojure.spec generators as a shared input corpus [R80]; capture k6 performance baselines and SLO thresholds [R86].
- **Phase 1 — Contracts & rulebook:** extract OpenAPI/schema contracts per endpoint [R89]; write the D4 idiom-mapping table plus 10-20 hand-converted exemplar functions as few-shot seeds [R29]; distill a migration playbook to constrain planning [R8].
- **Phase 2 — Harness build:** decompose into dependency-consistent batches sized to one prompt [R37][R10]; translate via structured outputs at temperature 0 on Batch APIs (50% cost) [R45][R59][R60]; auto-generate per-unit test oracles from source behavior [R33]; run execution-driven repair loops with bounded retries [R32][R34][R35]; gate every unit on mypy strict + coverage + eval suite [R83][R58]; add run-level throttling/retry orchestration, pinned dependency allowlists, and registry-existence checks on every generated import [R8][R43].
- **Phase 3 — Leaf-first conversion:** convert in reverse-call order / DAG clusters [R34][R10]; each accepted unit must pass its golden tests, property tests, and type gate before merge; humans review at batch boundaries with parity evidence attached [R9][R41].
- **Phase 4 — Service coexistence:** strangler proxy routes between stacks [R1][R4]; GoReplay shadow traffic dual-runs both implementations and diffs responses [R78]; Grafana parity dashboard with per-endpoint consistency thresholds [R7]; CDC keeps data layers reconciled with rollback intact [R4].
- **Phase 5 — Cutover & decommission:** flip endpoints one at a time via proxy (flag Off=legacy, On=Python) [R7][R88]; canary cohorts first [R87]; soak + k6 SLO gates before each expansion [R86]; Pact guards service boundaries until Clojure is removed [R89].

**Confidence:** high on pipeline design (convergent across Google, AWS, academic systems, and practitioner practice); medium on effort numbers for Clojure specifically — no published Clojure→Python case study exists, so transfer from Java-centric evidence carries uncertainty. Expect ~50% effort reduction with mandatory human fix-up (AlphaTrans-style ~20h/project residuals), not touchless conversion.

**What would change the answer:** measured GIL-bound CPU utilization in the bid-decision path that cannot be restructured (favor keeping the hot path on the JVM longer or free-threaded 3.14 builds); discovery of heavy core.async/transducer machinery (raises Phase 1 rulebook cost materially); an adserver whose behavior is under-specified (golden-master recording becomes the critical-path item).

**Cost of being wrong:** a big-bang cutover without the differential net risks silent semantic drift in revenue-critical serving paths — the exact failure class TransCoder-era evaluations warned about (test-passing ≠ behavioral equivalence) [R31].

## Unverified Claims

- No published production Clojure→Python full-system case study exists. Why: none surfaced across academic and industrial searches; closest is Marttila's Copilot account [R29]. Verify by: targeted search for new engineering-blog case studies quarterly.
- Instagram's Python 2→3 migration primary source unreachable (Medium 403/JS-only). Verify by: browser retrieval of instagram-engineering.com posts.
- Yelp Python 3 freeze-window practices unverified (blog returned HTTP 403). Verify by: Wayback Machine fetch.
- 2026 TechEmpower framework placements (Granian/BlackSheep vs Netty/http-kit) unverified — JS-rendered SPA. Verify by: browser retrieval of techempower.com/benchmarks.
- LiveCodeBench/SWE-bench per-language Clojure proficiency numbers unverified (JS leaderboards). Verify by: browser retrieval.
- "TestRAG" SSRN preprint existence unverified (bot-blocked). Verify by: SSRN search.
- TransCoder-ST arXiv ID unlocated; only third-party citations found. Verify by: arXiv listing search for Rajaraman et al.
- Concrete RTB `tmax` values (e.g., 100ms) are exchange-configured practice, not OpenRTB text. Verify by: exchange/Prebid documentation.
- Free-threaded CPython wheel availability for the adtech dependency set (asyncpg, uvloop, pydantic-core) is assumed partial as of 2026-08. Verify by: PyPI wheel inventory audit.
- Airtable/Zapier LLM-migration engineering posts could not be located; their reported pipelines are unverified. Verify by: direct site search.


**From the PEP 20 finding (consolidated):** Jane Street "illegal states" primary unreachable (404/Wayback timeout; cited via Alexis King [P53]); pip native pylock.toml install support unverified; pyright default-mode history unverified; Google 70/20/10 dates to 2015 only; uv/ruff post-OpenAI licensing/roadmap unknown; ruff rule-count conflicts across Astral pages (500 vs 900); "sync-by-default" norm inferred not stated; 1999-Zen vs PEP-20 text not line-diffed.

**From the idiomatic-reviewer finding (consolidated):** pydocstyle.org hijacked/archival status (use ruff's reimplementation); pylint shipped threshold defaults unconfirmed (docs embed examples); SmartBear/Cisco review-physics vendor-reported single-source; OrderedDict→dict pyupgrade rewrite ungrounded; UP045 split recency unknown; ruff default set drifts per release (pin version); A001-A004 attributions conventional; Effective Python items title-only; Real Python anti-patterns page dead (QuantifiedCode 2018 substitute); mypy boundary quote stands in via ruff FAQ; DTZ family enumeration partial; E721/F405/W3101 attributions not fetched.

## References

- [R1] StranglerFigApplication — https://martinfowler.com/bliki/StranglerFigApplication.html — retrieved 2026-08-22
- [R2] BranchByAbstraction — https://martinfowler.com/bliki/BranchByAbstraction.html — retrieved 2026-08-22
- [R3] Patterns of Legacy Displacement — https://martinfowler.com/articles/patterns-legacy-displacement/ — retrieved 2026-08-22
- [R4] Azure Strangler Fig pattern — https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig — retrieved 2026-08-22
- [R5] Things You Should Never Do (Netscape) — https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/ — retrieved 2026-08-22
- [R6] Cloudflare Pingora — https://blog.cloudflare.com/how-we-built-pingora-the-proxy-that-connects-cloudflare-to-the-internet/ — retrieved 2026-08-22
- [R7] Zalando Parallel Run — https://engineering.zalando.com/posts/2021/11/parallel-run.html — retrieved 2026-08-22
- [R8] AWS Reproducible migrations with AI playbooks — https://aws.amazon.com/blogs/migration-and-modernization/reproducible-code-migration-at-scale-with-ai-generated-playbooks/ — retrieved 2026-08-22
- [R9] Google Accelerating code migrations with AI — https://research.google/blog/accelerating-code-migrations-with-ai/ — retrieved 2026-08-22
- [R10] arXiv 2501.06972 LLM-assisted migration experience report — https://arxiv.org/html/2501.06972v1 — retrieved 2026-08-22
- [R11] pyrsistent — https://pypi.org/project/pyrsistent/ — retrieved 2026-08-22
- [R12] PEP 661 sentinels — https://peps.python.org/pep-0661/ — retrieved 2026-08-22
- [R13] Ring SPEC — https://raw.githubusercontent.com/ring-clojure/ring/master/SPEC.md — retrieved 2026-08-22
- [R14] ASGI specification — https://asgi.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [R15] Starlette middleware — https://www.starlette.io/middleware/ — retrieved 2026-08-22
- [R16] FastAPI bigger applications — https://fastapi.tiangolo.com/tutorial/bigger-applications/ — retrieved 2026-08-22
- [R17] core.async rationale — https://clojure.github.io/core.async/rationale.html — retrieved 2026-08-22
- [R18] asyncio.Queue — https://docs.python.org/3/library/asyncio-queue.html — retrieved 2026-08-22
- [R19] threading/GIL — https://docs.python.org/3/library/threading.html — retrieved 2026-08-22
- [R20] Pydantic models — https://docs.pydantic.dev/latest/concepts/models/ — retrieved 2026-08-22
- [R21] msgspec README — https://raw.githubusercontent.com/jcrist/msgspec/main/README.md — retrieved 2026-08-22
- [R22] functools.singledispatch — https://docs.python.org/3/library/functools.html — retrieved 2026-08-22
- [R23] SQLAlchemy tutorial — https://docs.sqlalchemy.org/en/20/tutorial/ — retrieved 2026-08-22
- [R24] asyncpg — https://magicstack.github.io/asyncpg/current/index.html — retrieved 2026-08-22
- [R25] dependency-injector — https://pypi.org/project/dependency-injector/ — retrieved 2026-08-22
- [R26] Errors and Exceptions — https://docs.python.org/3/tutorial/errors.html — retrieved 2026-08-22
- [R27] Hypothesis — https://hypothesis.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [R28] Clojure reference: sequences — https://github.com/clojure/clojure-site/blob/master/content/reference/sequences.adoc — retrieved 2026-08-22
- [R29] Marttila: Converting Clojure to Python using Copilot — https://www.karimarttila.fi/python/2025/04/26/converting-clojure-to-python-using-copilot.html — retrieved 2026-08-22
- [R30] TransCoder — https://arxiv.org/abs/2006.03511 — retrieved 2026-08-22
- [R31] On the evaluation of neural code summarization/translation critique — https://arxiv.org/abs/2008.00293 — retrieved 2026-08-22
- [R32] Self-Debugging — https://arxiv.org/abs/2304.05128 — retrieved 2026-08-22
- [R33] UniTrans — https://arxiv.org/abs/2404.14646 — retrieved 2026-08-22
- [R34] AlphaTrans — https://arxiv.org/abs/2410.24117 — retrieved 2026-08-22
- [R35] TransAGENT — https://arxiv.org/abs/2409.19894 — retrieved 2026-08-22
- [R36] Skel (PLDI 2025) — https://arxiv.org/abs/2504.07483 — retrieved 2026-08-22
- [R37] DepWareTrans — https://arxiv.org/abs/2608.14128 — retrieved 2026-08-22
- [R38] Azure OpenAI reproducible output — https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reproducible-output — retrieved 2026-08-22
- [R39] Thinking Machines: Defeating nondeterminism in LLM inference — https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ — retrieved 2026-08-22
- [R40] Outlines paper (grammar-constrained generation) — https://arxiv.org/abs/2307.09702 — retrieved 2026-08-22
- [R41] arXiv 2504.09691 Migrating code at scale with LLMs at Google — https://arxiv.org/abs/2504.09691 — retrieved 2026-08-22
- [R42] i-programmer: Google slashes code migration time with LLMs — https://www.i-programmer.info/news/105-artificial-intelligence/17774-google-slashes-code-migration-time-with-llms.html — retrieved 2026-08-22
- [R43] We Have a Package for You (hallucinated packages) — https://arxiv.org/abs/2406.10279 — retrieved 2026-08-22
- [R44] MultiPL-E — https://raw.githubusercontent.com/nuprl/MultiPL-E/main/README.md — retrieved 2026-08-22
- [R45] OpenAI Structured Outputs — https://platform.openai.com/docs/guides/structured-outputs — retrieved 2026-08-22
- [R46] Anthropic structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs — retrieved 2026-08-22
- [R47] Outlines docs — https://dottxt-ai.github.io/outlines/latest/ — retrieved 2026-08-22
- [R48] XGrammar — https://github.com/mlc-ai/xgrammar — retrieved 2026-08-22
- [R49] LM Format Enforcer — https://github.com/noamgat/lm-format-enforcer — retrieved 2026-08-22
- [R50] DSPy — https://dspy.ai/ — retrieved 2026-08-22
- [R51] LangGraph overview — https://docs.langchain.com/oss/python/langgraph/overview — retrieved 2026-08-22
- [R52] Claude Code Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview — retrieved 2026-08-22
- [R53] Aider repo map — https://aider.chat/docs/repomap.html — retrieved 2026-08-22
- [R54] Aider scripting — https://aider.chat/docs/scripting.html — retrieved 2026-08-22
- [R55] OpenHands docs — https://docs.all-hands.dev/ — retrieved 2026-08-22
- [R56] tree-sitter-clojure — https://github.com/sogaiu/tree-sitter-clojure — retrieved 2026-08-22
- [R57] clj-kondo — https://github.com/clj-kondo/clj-kondo — retrieved 2026-08-22
- [R58] promptfoo intro — https://www.promptfoo.dev/docs/intro/ — retrieved 2026-08-22
- [R59] OpenAI Batch API — https://platform.openai.com/docs/guides/batch — retrieved 2026-08-22
- [R60] Anthropic Message Batches — https://platform.claude.com/docs/en/build-with-claude/batch-processing — retrieved 2026-08-22
- [R61] SWE-bench — https://www.swebench.com/ — retrieved 2026-08-22
- [R62] OpenRTB v3.0 FINAL — https://raw.githubusercontent.com/InteractiveAdvertisingBureau/OpenRTB/main/OpenRTB%20v3.0%20FINAL.md — retrieved 2026-08-22
- [R63] http-kit README — https://raw.githubusercontent.com/http-kit/http-kit/master/README.md — retrieved 2026-08-22
- [R64] Netty — https://netty.io/ — retrieved 2026-08-22
- [R65] uvloop — https://github.com/MagicStack/uvloop — retrieved 2026-08-22
- [R66] Granian — https://github.com/emmett-framework/granian — retrieved 2026-08-22
- [R67] BlackSheep README — https://raw.githubusercontent.com/Neoteroi/BlackSheep/main/README.md — retrieved 2026-08-22
- [R68] orjson README — https://raw.githubusercontent.com/ijl/orjson/master/README.md — retrieved 2026-08-22
- [R69] PEP 703 — https://peps.python.org/pep-0703/ — retrieved 2026-08-22
- [R70] Python 3.14 whatsnew — https://docs.python.org/3.14/whatsnew/3.14.html — retrieved 2026-08-22
- [R71] PEP 779 — https://peps.python.org/pep-0779/ — retrieved 2026-08-22
- [R72] PyPy — https://www.pypy.org/ — retrieved 2026-08-22
- [R73] Stream: Switched Python to Go — https://getstream.io/blog/switched-python-go/ — retrieved 2026-08-22
- [R74] SQLAlchemy asyncio — https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html — retrieved 2026-08-22
- [R75] Characterization test — https://en.wikipedia.org/wiki/Characterization_test — retrieved 2026-08-22
- [R76] pytest-regressions — https://pytest-regressions.readthedocs.io/en/latest/overview.html — retrieved 2026-08-22
- [R77] syrupy — https://github.com/syrupy-project/syrupy — retrieved 2026-08-22
- [R78] GoReplay — https://github.com/probelabs/goreplay — retrieved 2026-08-22
- [R79] test.check — https://github.com/clojure/test.check — retrieved 2026-08-22
- [R80] clojure.spec guide — https://clojure.org/guides/spec — retrieved 2026-08-22
- [R81] Hypothesis stateful — https://hypothesis.readthedocs.io/en/latest/stateful.html — retrieved 2026-08-22
- [R82] Metamorphic testing — https://en.wikipedia.org/wiki/Metamorphic_testing — retrieved 2026-08-22
- [R83] mypy config strict — https://mypy.readthedocs.io/en/stable/config_file.html — retrieved 2026-08-22
- [R84] coverage.py — https://coverage.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [R85] mutmut — https://mutmut.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [R86] k6 thresholds — https://grafana.com/docs/k6/latest/using-k6/thresholds/ — retrieved 2026-08-22
- [R87] CanaryRelease — https://martinfowler.com/bliki/CanaryRelease.html — retrieved 2026-08-22
- [R88] Feature Toggles — https://martinfowler.com/articles/feature-toggles.html — retrieved 2026-08-22
- [R89] Pact docs — https://docs.pact.io/ — retrieved 2026-08-22

## Process Appendix

### Triage Output

- Tier: DEEP — high-stakes, architecture-defining migration question for a production adserver.
- Source mode: web — no Clojure repository is present at the invocation cwd; the question concerns external methodology, tooling, and research literature.
- Clarification flag: OFF (default). Assumptions recorded below.
- Tracks (6 parallel researchers):
  1. T1 migration-strategy — port vs rewrite doctrine, strangler fig, incremental coexistence, industry case studies.
  2. T2 semantic-mapping — Clojure idioms → Python equivalents (persistent structures, Ring→ASGI, core.async→asyncio, spec→pydantic, protocols→ABCs).
  3. T3 llm-translation-research — academic + industrial techniques for deterministic LLM code translation (test-driven translation, constrained decoding, agent loops).
  4. T4 llm-harnesses — concrete tooling: structured outputs, grammar constraints, orchestration frameworks, agentic coding harnesses, CI gates.
  5. T5 adserver-performance — RTB/adserver latency requirements vs Python runtime reality; parity strategies.
  6. T6 verification-determinism — differential testing, property-based testing, golden tests, coverage/type gates for translation acceptance.
- Rationale: six non-overlapping angles cover strategy (T1), language semantics (T2), the deterministic-LLM method (T3/T4), domain constraints (T5), and acceptance machinery (T6).

### Assumptions

- A1: "Deterministic" means a repeatable, gated pipeline whose output converges to verified-equivalent behavior — not bit-identical AST output from an LLM (LLM sampling is inherently stochastic; determinism is engineered via harness constraints + verification gates).
- A2: The adserver is JVM-hosted Clojure (typical); CRUD app may share the codebase or be a sibling service.
- A3: Target CPython (the dominant deployment target), not a Clojure dialect on Python.

### Expert Reports

- T1 migration-strategy (11 sources, 20 claims): strangler fig/parallel-run/branch-by-abstraction doctrine; Google 3-stage AI-migration structure (deterministic targeting → LLM edits → human rollout); AWS playbook-constrained planning (+15.79% consistency); Ads int32→int64 80% AI-authored / ~50% time saved.
- T2 semantic-mapping (20 sources, ~21 claims): full idiom table Ring→ASGI, spec→pydantic/msgspec, core.async→asyncio gaps (no alts!, no M:N), atoms/STM→locks, lazy-seq vs iterator top risk; Marttila practitioner method (function-by-function + captured-output tests + exemplar seeds).
- T3 llm-translation-research (16 sources): TransCoder→UniTrans→AlphaTrans→TransAGENT→Skel→DepWareTrans lineage; validated pipeline shape decompose→translate→test-oracle→repair→whole-program validation; nondeterminism caveats (temp-0 ≠ deterministic); hallucinated-package rates; no published Clojure→Python system; MultiPL-E covers Clojure.
- T4 llm-harnesses (17 sources): OpenAI/Anthropic structured outputs + batch APIs (50% discounts); Outlines/XGrammar/LMFE constrained decoding; DSPy/LangGraph orchestration; Aider scripted/Claude Code headless/OpenHands SDK agents; clj-kondo/tree-sitter decomposition; promptfoo eval gates.
- T5 adserver-performance (14 sources): OpenRTB tmax hard budgets; JVM headroom (http-kit 600k conns); uvloop/Granian/orjson/msgspec Python stack; GIL wall (PEP 703) + free-threading status (3.14 official, +15-20% mem); Stream 40x counter-evidence; SQLAlchemy async CRUD unproblematic.
- T6 verification-determinism (16+ sources): characterization/golden masters w/ masking; pytest-regressions/syrupy; GoReplay dual-run; Hypothesis stateful legacy-as-oracle; metamorphic testing; mypy strict; mutmut; k6 SLO CI gates; canary + flags Off=legacy; Pact; parity dashboards.

### Challenger Verdicts

Independent challenger (never saw synthesizer reasoning) re-fetched 12 load-bearing citations live; full ledger in temp-dir file `challenger-verdicts.md`. Verdicts: K1 uphold (practitioner-consensus caveat), K2 uphold (playbook figure is upper bound +4.93..+15.79%, LLM-judged), K3 DOWNGRADE (scope overreach: validated only on statically-typed JVM/CLR pairs; corrected claim applied), K4 DOWNGRADE ("JUnit4→5" factual error → JUnit3→4 per fetched R42; corrected claim applied), K5 uphold (mismatch sub-items under-cited → practitioner-lore note added; n=1 caveat added), K6 uphold (tmax normative verb "should" fixed; Stream 40x scoped to one component with author caveats), K7 uphold, K8 upheld (negative-existence claim inherently provisional). SUGGEST_NEW_CLAIM accepted as K9 (operational throttling collapse [R8] + hallucinated-package supply-chain gates [R43]).

### Judge Scores

Independent judge (saw draft + challenger verdicts, not author rationale): reasoning-before-verdict recorded in temp-dir `judge-scores.md`. Scores: factual accuracy 0.75 | citation accuracy 0.80 | completeness 0.95 | clarity 0.85 → PASS.

### Remediation Log

| Claim | Verdict | Resolution | Applied by |
|---|---|---|---|
| K2 | uphold w/ caveat | "up to +15.79%, LLM-judged, upper bound"; D2 "~16% → up to ~16%" | primary |
| K3 | downgrade | replaced with challenger's corrected claim (JVM/CLR scope; extrapolation wording); D3 scope sentence added | primary |
| K4 | downgrade | JUnit4→5 → JUnit3→4; added 12-month/3-developer scoping; developer-estimated qualifier | primary |
| K5 | uphold w/ caveat | "(n=1, POC-scale)" added; D4 practitioner-lore note for under-cited mismatch rows | primary |
| K6 | uphold w/ caveat | tmax "must" → "should (spec normative verb)"; Stream counter-evidence scoped to one ranking component | primary |
| K9 | suggest_new_claim → accepted | new finding K9 + Phase 2 supply-chain/throttling line | primary |

### Parked Open Questions

(none yet)

### Verification Scale (DEEP)

- Citation re-location: independent challenger live-fetched 12 load-bearing URLs (R39,R34,R37,R41,R8,R71,R73,R7,R28,R29,R62,R42); judge scored citation accuracy 0.80. Unrelocated-but-low-risk documentation refs listed in challenger ledger.
- Render check passed: format marker + H1 + exactly 8 H2 in order (TL;DR, Executive Summary, Key Findings, Detail Sections, Recommendation, Unverified Claims, References, Process Appendix).
- Secret scan: none found.
- Protected-state re-run: tree carries extensive pre-existing/concurrent modifications from parallel sessions (present at INTAKE baseline); run-attributable writes are exactly one file — this research document. Baseline capture at INTAKE displayed only first 20 lines (process gap recorded); full accounting of run writes maintained by primary.
- Independence caveats: synthesis primary-led after 2 silent subagent failures; challenger + judge were genuine independent subagents.

### Control Journal

```
[2026-08-22T00:00Z] INTAKE -> TRIAGE :: cycle 1 :: trigger: run start
[2026-08-22T00:00Z] INTAKE complete :: cycle 1
[temp-dir] /tmp/csm-deep-research-fWXKcY
[baseline] git status --short captured (pre-existing dirty tree; see journal note)
[baseline-note] cwd git root /home/jamiemills/.config/opencode/skills is BOTH the write tree and the researched context (no separate researched repo); guarantee covers this tree.
[artifacts] none requested at INTAKE
[2026-08-22T00:00Z] TRIAGE -> RESEARCH :: cycle 1 :: trigger: triage recorded above
[2026-08-22T00:00Z] TRIAGE complete :: cycle 1
[2026-08-22T00:00Z] RESEARCH -> SYNTHESIZE :: cycle 1 :: trigger: 6/6 researcher packs returned (no resilience-ladder rungs needed)
[2026-08-22T00:00Z] RESEARCH complete :: cycle 1
[2026-08-22T00:00Z] SYNTHESIZE -> CHALLENGE :: cycle 1 :: trigger: draft complete
[2026-08-22T00:00Z] SYNTHESIZE complete :: cycle 1
[resilience-note] synthesizer role performed primary-led after 2 empty subagent returns (independence caveat recorded)
[2026-08-22T00:00Z] CHALLENGE -> JUDGE :: cycle 1 :: trigger: 8 verdicts + 1 suggest_new_claim returned
[2026-08-22T00:00Z] CHALLENGE complete :: cycle 1
[2026-08-22T00:00Z] JUDGE -> REMEDIATE :: cycle 1 :: trigger: PASS overall but 2 downgrade verdicts require forward-fix
[2026-08-22T00:00Z] JUDGE complete :: cycle 1
[2026-08-22T00:00Z] REMEDIATE -> VERIFY :: cycle 1 :: trigger: 6 resolutions applied (see Remediation Log)
[2026-08-22T00:00Z] REMEDIATE complete :: cycle 1
[2026-08-22T00:00Z] VERIFY -> SAVED :: cycle 1 :: trigger: render+secrets+citation-scale checks pass; protected-state re-run attributed all diffs to pre-existing/concurrent tree state
[2026-08-22T00:00Z] VERIFY complete :: cycle 1
[2026-08-22T00:00Z] SAVED :: cycle 1 :: trigger: document saved; commit attempted via pathspec but rejected by unstaged-guard pre-commit hook (pre-existing concurrent working-tree changes from parallel sessions); NOT committed to avoid staging unrelated files or bypassing hooks — document left staged for user
[2026-08-22T00:00Z] SAVED complete :: cycle 1
[2026-08-22T00:00Z] STOP
[resilience] SYNTHESIZE dispatch 1 returned empty, document unchanged -> retry rung 1 (minimal-prompt)
[resilience] SYNTHESIZE dispatch 2 returned empty -> ladder rung 4: primary-led synthesis with recorded independence caveat
```

### Evidence Pack Note

Raw researcher packs held in temp dir `/tmp/csm-deep-research-fWXKcY` (packs also summarized verbatim below under Expert Reports at synthesis time). All claims carry URL + retrieved date; JS-only flags carried forward to Unverified Claims.

### Python doctrine references (prefixed [Pn], from pep20 finding)


- [P1] PEP 20 The Zen of Python — https://peps.python.org/pep-0020/ — retrieved 2026-08-22
- [P2] Barry Warsaw, import this history — https://www.wefearchange.org/2010/06/import-this-and-zen-of-python.html — retrieved 2026-08-22
- [P3] Real Python, The Zen of Python — https://realpython.com/zen-of-python/ — retrieved 2026-08-22
- [P4] PEP 8 — https://peps.python.org/pep-0008/ — retrieved 2026-08-22
- [P5] Python Glossary — https://docs.python.org/3/glossary.html — retrieved 2026-08-22
- [P6] Design and History FAQ — https://docs.python.org/3/faq/design.html — retrieved 2026-08-22
- [P7] PEP 695 — https://peps.python.org/pep-0695/ — retrieved 2026-08-22
- [P8] PEP 703 — https://peps.python.org/pep-0703/ — retrieved 2026-08-22
- [P9] PEP 779 — https://peps.python.org/pep-0779/ — retrieved 2026-08-22
- [P10] Free-threading guide — https://py-free-threading.github.io/ — retrieved 2026-08-22
- [P11] What's New in Python 3.12 — https://docs.python.org/3/whatsnew/3.12.html — retrieved 2026-08-22
- [P12] PEP 634 — https://peps.python.org/pep-0634/ — retrieved 2026-08-22
- [P13] PyPA Writing pyproject.toml — https://packaging.python.org/en/latest/guides/writing-pyproject-toml/ — retrieved 2026-08-22
- [P14] PyPA setup.py deprecated — https://packaging.python.org/en/latest/discussions/setup-py-deprecated/ — retrieved 2026-08-22
- [P15] PEP 621 — https://peps.python.org/pep-0621/ — retrieved 2026-08-22
- [P16] uv documentation — https://docs.astral.sh/uv/ — retrieved 2026-08-22
- [P17] uv projects/layout — https://docs.astral.sh/uv/concepts/projects/layout/ — retrieved 2026-08-22
- [P18] Ruff FAQ — https://docs.astral.sh/ruff/faq/ — retrieved 2026-08-22
- [P19] Ruff formatter — https://docs.astral.sh/ruff/formatter/ — retrieved 2026-08-22
- [P20] Astral joins OpenAI Codex team — https://astral.sh/blog/openai — retrieved 2026-08-22
- [P21] PyPA src layout vs flat layout — https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/ — retrieved 2026-08-22
- [P22] PEP 751 — https://peps.python.org/pep-0751/ — retrieved 2026-08-22
- [P23] install-requires vs requirements — https://packaging.python.org/en/latest/discussions/install-requires-vs-requirements/ — retrieved 2026-08-22
- [P24] pre-commit — https://pre-commit.com/ — retrieved 2026-08-22
- [P25] typing module docs — https://docs.python.org/3/library/typing.html — retrieved 2026-08-22
- [P26] PEP 544 — https://peps.python.org/pep-0544/ — retrieved 2026-08-22
- [P27] Typing spec: protocols — https://typing.readthedocs.io/en/latest/spec/protocol.html — retrieved 2026-08-22
- [P28] PEP 484 — https://peps.python.org/pep-0484/ — retrieved 2026-08-22
- [P29] mypy getting started — https://mypy.readthedocs.io/en/stable/getting_started.html — retrieved 2026-08-22
- [P30] pyright configuration — https://microsoft.github.io/pyright/configuration/ — retrieved 2026-08-22
- [P31] pyright getting started — https://microsoft.github.io/pyright/getting-started/ — retrieved 2026-08-22
- [P32] pydantic models — https://docs.pydantic.dev/latest/concepts/models/ — retrieved 2026-08-22
- [P33] dataclasses docs — https://docs.python.org/3/library/dataclasses.html — retrieved 2026-08-22
- [P34] pydantic dataclasses — https://docs.pydantic.dev/latest/concepts/dataclasses/ — retrieved 2026-08-22
- [P35] Typing anti-pitch — https://typing.python.org/en/latest/guides/typing_anti_pitch.html — retrieved 2026-08-22
- [P36] Typing best practices — https://typing.python.org/en/latest/reference/best_practices.html — retrieved 2026-08-22
- [P37] pytest getting started — https://docs.pytest.org/en/stable/getting-started.html — retrieved 2026-08-22
- [P38] pytest good practices — https://docs.pytest.org/en/stable/explanation/goodpractices.html — retrieved 2026-08-22
- [P39] pytest fixtures — https://docs.pytest.org/en/stable/explanation/fixtures.html — retrieved 2026-08-22
- [P40] Hypothesis docs — https://hypothesis.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [P41] doctest docs — https://docs.python.org/3/library/doctest.html — retrieved 2026-08-22
- [P42] pytest doctest — https://docs.pytest.org/en/stable/how-to/doctest.html — retrieved 2026-08-22
- [P43] coverage.py docs — https://coverage.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [P44] Ned Batchelder, flaws in coverage measurement — https://nedbatchelder.com/blog/200710/flaws_in_coverage_measurement.html — retrieved 2026-08-22
- [P45] Google testing blog, test pyramid — https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html — retrieved 2026-08-22
- [P46] Software Engineering at Google ch13 — https://abseil.io/resources/swe-book/html/ch13.html — retrieved 2026-08-22
- [P47] GitHub Actions: building/testing Python — https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-python — retrieved 2026-08-22
- [P48] mutmut docs — https://mutmut.readthedocs.io/en/latest/ — retrieved 2026-08-22
- [P49] Real Python, inheritance vs composition — https://realpython.com/inheritance-composition-python/ — retrieved 2026-08-22
- [P50] Classes tutorial — https://docs.python.org/3/tutorial/classes.html — retrieved 2026-08-22
- [P51] collections docs — https://docs.python.org/3/library/collections.html — retrieved 2026-08-22
- [P52] enum docs — https://docs.python.org/3/library/enum.html — retrieved 2026-08-22
- [P53] Alexis King, Parse don't validate — https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/ — retrieved 2026-08-22
- [P54] pydantic landing — https://docs.pydantic.dev/latest/ — retrieved 2026-08-22
- [P55] asyncio docs — https://docs.python.org/3/library/asyncio.html — retrieved 2026-08-22
- [P56] Developing with asyncio — https://docs.python.org/3/library/asyncio-dev.html — retrieved 2026-08-22
- [P57] Errors tutorial — https://docs.python.org/3/tutorial/errors.html — retrieved 2026-08-22
- [P58] Google Python Style Guide — https://google.github.io/styleguide/pyguide.html — retrieved 2026-08-22
- [P59] Stop Writing Classes (PyCon 2012, historical) — https://pyvideo.org/pycon-us-2012/stop-writing-classes.html — retrieved 2026-08-22
- [P60] Tim Peters 1999 post — https://mail.python.org/pipermail/python-list/1999-June/001951.html — retrieved 2026-08-22

### Idiomatic-reviewer references (prefixed [Vn], from reviewer finding)


Reference numbers are non-contiguous; every number maps 1:1 to exactly one URL.

Consolidated list — every [Vn] cited above maps 1:1 to exactly one URL. During consolidation two defects were found and fixed inline: R76/R77 duplicated the pyguide URL already held by R63 (merged into R63 at K7, D5 Table A ×2, Recommendation 5), and R88/R89 were used cross-wise (canon: R88 = eng-practices looking-for, R89 = SWE-book ch09; corrected in D6 ×3 and Recommendation 4).

- [V1] Ruff F401 unused-import — https://docs.astral.sh/ruff/rules/unused-import/ — retrieved 2026-08-22
- [V2] Ruff F811 redefined-while-unused — https://docs.astral.sh/ruff/rules/redefined-while-unused/ — retrieved 2026-08-22
- [V3] Ruff F821 undefined-name — https://docs.astral.sh/ruff/rules/undefined-name/ — retrieved 2026-08-22
- [V4] Ruff F841 unused-variable — https://docs.astral.sh/ruff/rules/unused-variable/ — retrieved 2026-08-22
- [V5] Ruff F632 is-literal — https://docs.astral.sh/ruff/rules/is-literal/ — retrieved 2026-08-22
- [V6] Ruff default rules (~400-rule verified default set) — https://docs.astral.sh/ruff/default-rules/ — retrieved 2026-08-22
- [V8] Ruff E501 line-too-long — https://docs.astral.sh/ruff/rules/line-too-long/ — retrieved 2026-08-22
- [V9] Ruff E711 none-comparison — https://docs.astral.sh/ruff/rules/none-comparison/ — retrieved 2026-08-22
- [V10] Ruff E712 true-false-comparison — https://docs.astral.sh/ruff/rules/true-false-comparison/ — retrieved 2026-08-22
- [V11] Ruff E722 bare-except — https://docs.astral.sh/ruff/rules/bare-except/ — retrieved 2026-08-22
- [V14] Ruff W605 invalid-escape-sequence — https://docs.astral.sh/ruff/rules/invalid-escape-sequence/ — retrieved 2026-08-22
- [V16] Ruff UP006 non-pep585-annotation — https://docs.astral.sh/ruff/rules/non-pep585-annotation/ — retrieved 2026-08-22
- [V17] Ruff UP007 non-pep604-annotation-union — https://docs.astral.sh/ruff/rules/non-pep604-annotation-union/ — retrieved 2026-08-22
- [V21] Ruff UP042 replace-str-enum — https://docs.astral.sh/ruff/rules/replace-str-enum/ — retrieved 2026-08-22
- [V22] Ruff B006 mutable-argument-default — https://docs.astral.sh/ruff/rules/mutable-argument-default/ — retrieved 2026-08-22
- [V23] Ruff B008 function-call-in-default-argument — https://docs.astral.sh/ruff/rules/function-call-in-default-argument/ — retrieved 2026-08-22
- [V24] Ruff B023 function-uses-loop-variable — https://docs.astral.sh/ruff/rules/function-uses-loop-variable/ — retrieved 2026-08-22
- [V25] Ruff B904 raise-without-from-inside-except — https://docs.astral.sh/ruff/rules/raise-without-from-inside-except/ — retrieved 2026-08-22
- [V26] Ruff B011 assert-false — https://docs.astral.sh/ruff/rules/assert-false/ — retrieved 2026-08-22
- [V27] Ruff B905 zip-without-explicit-strict — https://docs.astral.sh/ruff/rules/zip-without-explicit-strict/ — retrieved 2026-08-22
- [V46] Pylint too-many-branches — https://pylint.readthedocs.io/en/latest/user_guide/messages/refactor/too-many-branches.html — retrieved 2026-08-22
- [V48] Pylint too-many-statements — https://pylint.readthedocs.io/en/latest/user_guide/messages/refactor/too-many-statements.html — retrieved 2026-08-22
- [V49] Ruff PLR0913 too-many-arguments — https://docs.astral.sh/ruff/rules/too-many-arguments/ — retrieved 2026-08-22
- [V51] Ruff PT011 pytest-raises-too-broad — https://docs.astral.sh/ruff/rules/pytest-raises-too-broad/ — retrieved 2026-08-22
- [V52] Ruff PT012 pytest-raises-with-multiple-statements — https://docs.astral.sh/ruff/rules/pytest-raises-with-multiple-statements/ — retrieved 2026-08-22
- [V59] Ruff rule index (900+ rules, ~55 families) — https://docs.astral.sh/ruff/rules/ — retrieved 2026-08-22
- [V60] Ruff linter rule selection — https://docs.astral.sh/ruff/linter/#rule-selection — retrieved 2026-08-22
- [V61] flake8-bugbear README — https://github.com/PyCQA/flake8-bugbear — retrieved 2026-08-22
- [V62] Python FAQ (programming) — https://docs.python.org/3/faq/programming.html — retrieved 2026-08-22
- [V63] Google Python Style Guide (pyguide) — https://google.github.io/styleguide/pyguide.html — retrieved 2026-08-22
- [V64] Python Tutorial ch9 classes — https://docs.python.org/3/tutorial/classes.html — retrieved 2026-08-22
- [V65] PEP 8 — https://peps.python.org/pep-0008/ — retrieved 2026-08-22
- [V66] Python Tutorial ch7 input/output — https://docs.python.org/3/tutorial/inputoutput.html — retrieved 2026-08-22
- [V74] pyupgrade README — https://github.com/asottile/pyupgrade/blob/main/README.md — retrieved 2026-08-22
- [V75] mccabe (PyPI) — https://pypi.org/project/mccabe/ — retrieved 2026-08-22
- [V78] radon intro (CC weights + MI) — https://radon.readthedocs.io/en/latest/intro.html — retrieved 2026-08-22
- [V83] Ruff DTZ003 call-datetime-utcnow — https://docs.astral.sh/ruff/rules/call-datetime-utcnow/ — retrieved 2026-08-22
- [V84] PEP 257 — https://peps.python.org/pep-0257/ — retrieved 2026-08-22
- [V85] pydocstyle checker.py D-rule messages (site hijacked; mined from PyCQA source) — https://github.com/PyCQA/pydocstyle/blob/master/src/pydocstyle/checker.py — retrieved 2026-08-22
- [V87] Google eng-practices — reviewer standard (approval-on-improvement, Nit:) — https://google.github.io/eng-practices/review/reviewer/standard.html — retrieved 2026-08-22
- [V88] Google eng-practices — what reviewers look for (checklist categories) — https://google.github.io/eng-practices/review/reviewer/looking-for.html — retrieved 2026-08-22
- [V89] Software Engineering at Google ch9 Code Review (abseil) — https://abseil.io/resources/swe-book/html/ch09.html — retrieved 2026-08-22
- [V90] SmartBear best practices for peer code review (Cisco study) — https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ — retrieved 2026-08-22
- [V91] Ruff FAQ (vs mypy/pyright/pyre; vs pylint) — https://docs.astral.sh/ruff/faq/ — retrieved 2026-08-22
- [V92] Pylint tutorial (C/R/W/E/F message classes) — https://pylint.readthedocs.io/en/latest/tutorial.html — retrieved 2026-08-22
- [V93] Ruff F541 f-string-missing-placeholders — https://docs.astral.sh/ruff/rules/f-string-missing-placeholders/ — retrieved 2026-08-22
- [V94] Ruff C400 unnecessary-generator-list — https://docs.astral.sh/ruff/rules/unnecessary-generator-list/ — retrieved 2026-08-22
- [V95] Ruff C408 unnecessary-collection-call — https://docs.astral.sh/ruff/rules/unnecessary-collection-call/ — retrieved 2026-08-22
- [V96] Ruff C414 unnecessary-double-cast-or-process — https://docs.astral.sh/ruff/rules/unnecessary-double-cast-or-process/ — retrieved 2026-08-22
- [V97] Ruff C417 unnecessary-map — https://docs.astral.sh/ruff/rules/unnecessary-map/ — retrieved 2026-08-22
- [V98] Ruff SIM102 collapsible-if — https://docs.astral.sh/ruff/rules/collapsible-if/ — retrieved 2026-08-22
- [V99] Ruff SIM105 suppressible-exception — https://docs.astral.sh/ruff/rules/suppressible-exception/ — retrieved 2026-08-22
- [V100] Ruff SIM108 if-else-block-instead-of-if-exp — https://docs.astral.sh/ruff/rules/if-else-block-instead-of-if-exp/ — retrieved 2026-08-22
- [V101] Ruff SIM117 multiple-with-statements — https://docs.astral.sh/ruff/rules/multiple-with-statements/ — retrieved 2026-08-22
- [V102] Ruff SIM118 in-dict-keys — https://docs.astral.sh/ruff/rules/in-dict-keys/ — retrieved 2026-08-22
- [V103] Ruff RET501 unnecessary-return-none — https://docs.astral.sh/ruff/rules/unnecessary-return-none/ — retrieved 2026-08-22
- [V104] Ruff RET504 unnecessary-assign — https://docs.astral.sh/ruff/rules/unnecessary-assign/ — retrieved 2026-08-22
- [V105] Ruff RET505 superfluous-else-return — https://docs.astral.sh/ruff/rules/superfluous-else-return/ — retrieved 2026-08-22
- [V106] Ruff PERF401 manual-list-comprehension — https://docs.astral.sh/ruff/rules/manual-list-comprehension/ — retrieved 2026-08-22
- [V107] Ruff PERF402 manual-list-copy — https://docs.astral.sh/ruff/rules/manual-list-copy/ — retrieved 2026-08-22
- [V108] Ruff PERF203 try-except-in-loop — https://docs.astral.sh/ruff/rules/try-except-in-loop/ — retrieved 2026-08-22
- [V109] Ruff PIE790 unnecessary-placeholder — https://docs.astral.sh/ruff/rules/unnecessary-placeholder/ — retrieved 2026-08-22
- [V110] Ruff PIE794 duplicate-class-field-definition — https://docs.astral.sh/ruff/rules/duplicate-class-field-definition/ — retrieved 2026-08-22
- [V111] Ruff E731 lambda-assignment — https://docs.astral.sh/ruff/rules/lambda-assignment/ — retrieved 2026-08-22
- [V112] Ruff PLR2004 magic-value-comparison — https://docs.astral.sh/ruff/rules/magic-value-comparison/ — retrieved 2026-08-22
- [V113] Ruff UP008 super-call-with-parameters — https://docs.astral.sh/ruff/rules/super-call-with-parameters/ — retrieved 2026-08-22
- [V114] Ruff UP015 redundant-open-modes — https://docs.astral.sh/ruff/rules/redundant-open-modes/ — retrieved 2026-08-22
- [V115] Ruff UP024 os-error-alias — https://docs.astral.sh/ruff/rules/os-error-alias/ — retrieved 2026-08-22
- [V116] Ruff UP031 printf-string-formatting — https://docs.astral.sh/ruff/rules/printf-string-formatting/ — retrieved 2026-08-22
- [V117] Ruff UP032 f-string — https://docs.astral.sh/ruff/rules/f-string/ — retrieved 2026-08-22
- [V118] Ruff UP040 non-pep695-type-alias — https://docs.astral.sh/ruff/rules/non-pep695-type-alias/ — retrieved 2026-08-22
- [V119] vulture README (confidence tiers) — https://github.com/jendrikseipp/vulture/blob/main/README.md — retrieved 2026-08-22
- [V120] Ruff ERA001 commented-out-code — https://docs.astral.sh/ruff/rules/commented-out-code/ — retrieved 2026-08-22
- [V121] Ruff PT009 pytest-unittest-assertion — https://docs.astral.sh/ruff/rules/pytest-unittest-assertion/ — retrieved 2026-08-22
- [V122] Ruff BLE001 blind-except — https://docs.astral.sh/ruff/rules/blind-except/ — added at remediation (not in original fetch budget)
- [V123] Ruff F405 possibly-undefined-from-star — https://docs.astral.sh/ruff/rules/possibly-undefined-from-star/ — added at remediation (not in original fetch budget; see U12)
- [V124] Ruff F822 undefined-export — https://docs.astral.sh/ruff/rules/undefined-export/ — added at remediation (not in original fetch budget)
- [V125] Ruff B036 except-baseexception-without-reraise — https://docs.astral.sh/ruff/rules/except-baseexception-without-reraise/ — added at remediation (not in original fetch budget)
- [V126] Ruff S110 try-except-pass — https://docs.astral.sh/ruff/rules/try-except-pass/ — added at remediation (not in original fetch budget)

### Consolidation Provenance (2026-08-22)

- This document consolidates three same-workstream findings into one canonical doc; the sources are retained but banner-marked SUPERSEDED:
  1. `2026-08-22-clojure-to-python-llm-migration-research.md` — DEEP run, 6 tracks, challenger + judge + remediation (K1-K9, D1-D8, R1-R89 carried forward verbatim).
  2. `2026-08-22-pep20-python-2026-research.md` — PEP 20 doctrine run (K1-K15 → P1-P6 condensed; refs re-prefixed [P1]-[P60]).
  3. `2026-08-22-python-idiomatic-reviewer-research.md` — reviewer rules run (K1-K12 → V1-V4 condensed; refs re-prefixed [V1]-[V92]); its declared artifact `2026-08-22-python-idiomatic-reviewer-rules.json` remains canonical and is referenced by V4/D10.
- Consolidation was primary-led (no re-retrieval; source findings already survived their own challenge/judge/verify pipelines).
- Unrelated corpus docs (characterization ×2, csm-deep-research skill, LLM wiki, Disney+ ×2) are out of scope and untouched.

[2026-08-22T00:00Z] CONSOLIDATION :: post-SAVED user-directed merge of 3 findings into this doc; sources banner-marked superseded
