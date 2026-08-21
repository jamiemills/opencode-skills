format: csm-deep-research/1
# Repo Behavior-Continuity (Characterization) Testing — Techniques Research Finding

## TL;DR

Locking an existing repo's current behavior into tests is **characterization / golden-master testing** (Feathers): capture what the code actually does — run-to-failure then paste the observed output, or approve a first-run snapshot — and fail on any future change [R1][R3]. The proven workflow is: **select change- and risk-relevant surfaces → capture goldens at meaningful boundaries (with volatile fields scrubbed) → review every golden diff in PRs (never auto-accept on CI) → validate protectiveness with mutation spot-checks → layer properties/record-replay/contract tests where the surface warrants it**. LLM test generation can bootstrap this, but generated tests only protect behavior when executed, verified, and mutation-checked [R61][R73]. For **UI and workflow behavior**: discover journeys with codegen/record-replay and analytics/session-replay, harden them with role/test-id locators and auto-waiting, lock structure with aria/text snapshots and pixels only for high-value screens (same-environment baselines), and for workflow engines make production event-history replay the CI continuity gate [R39][R92][R44][R43][R112].

## Executive Summary

```text
Repo + goal (lock current behavior) -> DEEP/hybrid triage -> 5 parallel researcher tracks
  (characterization-core | property/differential | record-replay/contracts
   | selection/validation | agentic design)
-> Synthesis -> Challenge -> Judge -> Remediate -> Verified finding
```

The question behind a new "behavior-continuity testing" skill is: *which established techniques let a repo's current behavior become its own specification?* Five tracks retrieved ~115 evidence-claims from 84 sources. The evidence is unusually convergent: every track independently lands on the same family of techniques (characterization/golden-master/approval/snapshot testing), the same hard constraints (determinism first; human review of every golden change; CI must never auto-accept), and the same validation mechanism (mutation testing as the "does the suite actually protect" gate). The headline caveats: goldens capture observed behavior, not correctness — pre-existing bugs are preserved deliberately [R11]; characterization tests are change detectors, and un-reviewed change detectors provide negative value [R57]; and LLM-generated tests without execution-and-mutation feedback catch regressions poorly (best methods ~16-20% issue reproduction on SWT-Bench) [R73]. An extension run (STANDARD/hybrid, 3 tracks, 38 new sources) added UI and workflow test discovery/authoring: record-and-replay discovery hardened with resilient locators, aria/text snapshots before pixels, journey enumeration from routes/analytics/session-replay, workflow-engine event-history replay as the strongest continuity gate, and framework-native AI test agents (Playwright planner/generator/healer) that auto-repair suites [R39][R92][R44][R43][R112][R94].

## Key Findings

K1. **supported** — Characterization testing (Feathers; alias Golden Master testing) documents a system's *actual* current behavior rather than intended behavior; once in production, the system is its own specification. Tests are, essentially, change detectors [R1][R3][R5].

K2. **supported** — The canonical capture loop is: harness the code, write a deliberately-wrong assertion (or defer the expected value), run it, read the actual output, and promote the observed output to the expected value ("approve"). Snapshots/approval libraries (ApprovalTests, Jest, Verify, Roborazzi) automate the same loop [R2][R5][R8][R13][R16].

K3. **supported** — Determinism is the make-or-break constraint: volatile and non-deterministic values must be masked/scrubbed (prefer dependency injection over regex scrubbing; Jest property matchers; Playwright stylePath), or golden-master testing becomes impractical; if normalization exceeds the test, the approval target is too broad [R3][R4][R8][R12][R43].

K4. **supported** — Target selection is risk- and change-driven: characterize the area you will change first (Feathers), mine the code for branch-structure and boundary clues, lean on branch-coverage reports for untested destinations, and prefer coarse-grained text-producing surfaces (plain text diffs, versions and merges cleanly) [R2][R10][R47][R52].

K5. **supported** — Mutation testing (PIT, Stryker, mutmut) is the validation gate: seed faults, measure kill-rate; coverage alone cannot tell you tests can detect faults; two distinct survivor classes must be excluded from score pressure — *unproductive* mutants (Google: killing them would force fragile change-detector tests) and *equivalent* mutants (behaviorally identical; never killable); Google found ~70% of real bugs coupled to a mutant in the introducing change [R48][R49][R50][R54][R55].

K6. **supported** — Review discipline is non-negotiable: snapshots/goldens must be committed and reviewed like code; CI must never write new snapshots (Jest does not write snapshots on CI without explicitly passing `--updateSnapshot`); an un-reviewed approval degenerates into accepting whatever the program last printed; change-detector tests that break on any change without verifying behavior provide negative value [R8][R12][R57].

K7. **supported** — Property-based testing (Hypothesis, fast-check, jqwik) encodes behavioral invariants — crash-freedom first, round-trip/encode-decode invariants, model-vs-implementation state machines — with shrinking, seed reproducibility, and a documented on-ramp for legacy code [R17][R19][R20][R21][R22][R23][R24][R31].

K8. **supported** — Differential testing (run two implementations on the same inputs and diff) and metamorphic relations (multi-execution invariants such as round-trips) supply oracles where goldens are weak; industrial scale evidence: SQLite SLT cross-engine diffs (7.2M queries) and Csmith compiler differential testing [R28][R29][R30][R32].

K9. **supported** — Record-and-replay (VCR, VCR.py, Betamax, Polly.JS, nock back) captures live HTTP/I/O behavior into cassettes with match-and-replay semantics, explicit re-record cycles for drift, and built-in sensitive-data filtering guidance [R34][R35][R36][R37][R38].

K10. **supported** — API contract testing pins external behavior: Pact's consumer-driven "contract by example" locks only the behavior consumers actually use (unused provider behavior stays free to change); schema validation (Dredd) keeps docs and implementation in sync but is weaker without test-based assurance [R40][R41].

K11. **supported** — LLM-generated tests can bootstrap test suites without a spec oracle (TestPilot achieves 70.2% median statement coverage on npm packages [R61]), but quality collapses on real-world benchmarks (Codex: >80% coverage on HumanEval vs <2% on EvoSuite SF110 [R63]); execution-and-repair loops (SWE-Agent+ 18.5% vs SWE-Agent 15.9% on SWT-Bench-Lite [R73]) and mutation-guided prompts (MuTAP: 28% more faulty snippets caught, 17% missed by plain LLM/Pynguin [R70]) substantially improve validity — yet the best methods still reproduce only ~16-20% of real issues (S metric: share of issues whose generated tests reproduce the bug) [R73].

K12. **supported** — Several in-the-wild agent skills (characterization-test-generator [R76], clean-code [R77], claude-skill-refactor [R78]) independently encode a characterize-before-changing workflow: pin behavior with characterization tests, confirm they pass on unchanged code, then refactor behind them; guidance diverges afterwards — some sources recommend gradually replacing characterization tests with intent-based tests, while others retain them as legacy regression tests [R76][R77]; whether a standalone "generate + maintain a characterization suite" skill is an open gap is not established by the registry evidence alone (U9) [R79][R80].

K13. **supported** — Documented agent-skill design elements relevant to this domain: progressive disclosure (lean SKILL.md, depth in references/ [R81]); bundled deterministic scripts [R81]; Docker-guarded, user-controlled sandboxing of agent execution as practiced in agent frameworks such as AutoDev [R84]; and verification reports distinguishing passing / pre-existing-failure / new-failure / not-run [R77]. ("Explicit human-approval gates" and "sandboxed execution of generated tests" as *skill-authoring* guidance are synthesis beyond the cited quotes — see U13.)

K14. **supported** — UI test discovery starts with record-and-replay: Playwright codegen (role/text/test-id locator priority, assertions recordable during recording, auth-state save/load), Cypress Studio (data-cy-first selector priority, AI assertion suggestions from DOM diffs), and Selenium IDE (multi-locator fallback); the recorded artifact is a draft to be inspected and hardened, not a finished test [R39][R95][R101][R96].

K15. **supported** — UI authoring resilience rests on auto-waiting/auto-retrying (Playwright actionability checks + retrying assertions; Cypress retry-ability replaces arbitrary `wait()` calls) and resilient locators: user-facing role locators first, test-ids as the most change-resilient (but not user-facing) contract, long CSS/XPath chains as the documented anti-pattern, strict locators that throw on ambiguity, plus fresh-context isolation, `storageState` auth reuse, and state reset *before* each test — Cypress's documented rule (after/afterEach cleanup is listed as an anti-pattern there) [R87][R88][R90][R91][R97][R98].

K16. **supported** — Three snapshot forms exist for UI behavior: aria snapshots (accessible-structure YAML — stable across rendering), text/binary `toMatchSnapshot` (committed and reviewed), and pixel goldens (`toHaveScreenshot` first-run baseline + `--update-snapshots`) — with documented caveats: markup snapshots over-flag non-visual changes (Storybook recommends pixels over markup), pixel baselines are environment- and browser-specific (same-environment generation required), and blind snapshot acceptance hides bugs [R44][R43][R102].

K17. **supported** — Workflow/journey discovery is evidence-driven: enumerate journeys as actor+scenario+phase sequences from research, analytics triggers and session replay (real event sequences — vendor-documented mechanism [R108]); verify routing/verb/param surfaces via framework controller-integration tests (MockMVC-type) rather than plain method invocation [R109]; and mine tickets via BDD concrete-example workshops [R110]; authoring keeps E2E tests few, journey-length (many assertions, not micro-tests), independent, and data-seeded programmatically rather than driven through the UI [R109][R98][R92].

K18. **supported** — Workflow engines are state machines, and their strongest vendor-documented continuity gate is **production event-history replay**: Temporal's CI checklist downloads a representative set of recent open/closed workflow event histories per task queue and replays them against new definitions — "Replay succeeds only if the Workflow Definition is compatible with the provided history from a deterministic point of view" (a determinism/compatibility gate, not a functional-correctness test, and it requires access to production histories); integration-first testing with time-skipping handles long-running waits; Step Functions Local is unsupported, with TestState API for per-state unit tests [R111][R112][R113].

K19. **supported** — Higher-level tests flake more because they depend on more uncontrolled state (pytest's mechanism [R114]); Google's corpus-wide prevalence: ~1.5% of runs flaky, ~16% of tests have some flakiness, ~84% of pass→fail transitions involve a flaky test (corpus-wide, not E2E-specific — the author notes only "some skew toward UI testing" unquantified [R115]); auto-wait mitigates, retries classify (passed/flaky/failed [R93]), quarantine risks masking real bugs [R115], and mistrust is the real cost [R116]; scale is therefore deliberately small — Google's 70/20/10 "as a good first guess" (exact mix varies per team [R116]) with the "imagine only 10 E2E tests" heuristic (from the post's comments [R116]), and the Testing Trophy's integration-heavy inversion [R124].

K20. **supported** — AI-assisted UI authoring is now framework-native: Playwright ships Test Agents (planner → generator → healer that replays failures, suggests locator/wait patches, and re-runs until pass or guardrails stop [R94]), Cypress ships `cy.prompt` and Studio AI with self-healing selectors [R96][R95]; autonomous GUI-agent reliability, as separate datapoints on separate benchmarks: GPT-4 on WebArena reached 14.41% vs 78.24% human (2023 [R120]), while UI-TARS-2 reports 88.2 on Online-Mind2Web and 47.5 on OSWorld (2025, author-reported, no human baseline in the source [R123]) — absolute success rates remain far below human where baselines exist, and healer/self-healing efficacy claims are design promises, not measurements (U21) [R94][R118].

## Detail Sections

### D1. The characterization core: capture, approve, and the change-detector contract (K1-K3)

```text
Harness code (break dependencies)
  -> run with dummy/deferred expectation (write assert you know will fail)
  -> read ACTUAL output
  -> promote actual to expected (approve / paste / accept snapshot)
  -> commit golden + test as code
  -> future runs: diff -> green (behavior unchanged) | red (behavior changed -> decide: bug or re-approve)
```

Feathers defines the purpose: "document your system's actual behavior, not check for the behavior you wish your system had" — and the justification: "when a system goes into production, in a way, it becomes its own specification" [R1]. Savoia codified the algorithm (use in a harness; assert-wrong; run to reveal; expect observed; repeat) [R2]. Wikipedia's characterization-test article confirms terminology (coined by Feathers; also known as Golden Master Testing) and the "whitelist vs blacklist" inversion: traditional tests whitelist individual property values; characterization tests blacklist any change to observed output — corresponding to the "historical oracle" [R3].

Approval libraries operationalize this: `verify(a)` instead of `assert(a==b)`, first run creates an approved file that must be explicitly approved by copying received→approved [R5][R6]. Jest snapshots are the JS-ecosystem form: first run writes the artifact, later runs diff, `--updateSnapshot`/interactive watch mode re-baselines — with Jest's explicit guidance that new snapshots must not pass on CI and all snapshots should be committed and reviewed [R8]; snapshot support was motivated by the cost of hand-maintaining expected-output files and flaky browser tests — engineers "wanted... to make sure their components don't change unexpectedly" [R9]. A Python Gilded-Rose walkthrough demonstrates the approve-first flow and argues approval tests are temporary scaffolding to be replaced by real unit tests once seams are extracted [R7]. .NET Verify + seeded Bogus input generation reached ~91% coverage on a 102-line legacy method with a single snapshot test [R13]. A Java case study characterizes a legacy adapter by logging actual output and pasting it as the assertion, optionally extending with random inputs for branch coverage — with a companion example repo [R14][R15]. Kotlin/Android Roborazzi does the same for screenshots with a web side-by-side compare review [R16].

Determinism dominates the failure modes: Wikipedia: "Volatile and non-deterministic values need to be masked / removed, both from the Golden Master as well as from the result of the process. If too many elements need to be removed... it can render Golden Master testing impractical" [R3]. Rainsberger: filter noisy output, but "if you find yourself spending a significant amount of time filtering your golden master output... consider... extracting a huge function and then writing assertEquals() checks" [R4]. QASkills guide: prefer dependency injection (fixed clock, deterministic IDs) over regex scrubbing; "if normalization becomes larger than the test, the approval target is probably too broad" [R12]. Jest property matchers (`expect.any(Date)`) are the snapshot-native mechanism for volatile fields [R8]. Rainsberger's sampling guidance for scale: seed the RNG, generate a stream of inputs, and the collection of outputs is the golden master — "you only need to control the random number generator by seeding it" [R4].

### D2. Selection, validation, and the review gate (K4-K6)

Selection. Feathers: write tests for the area where changes will be made; then for the specific things being changed; when extracting functionality, verify the existence and connection of behaviors [R2]. When writing characterization tests, reading the code for branch clues is encouraged (not black-box): "We look at the code for clues and suggestions on what to test" — e.g. commission tiers at boundary constants [R10]. Coverage.py's branch coverage flags lines that didn't visit all destinations — the untested-branch signal [R47]. Emily Bache: approval testing "works best on larger pieces of code where you want to test for multiple things and interpreting failures is challenging" — coarse-grained boundaries keep batches reviewable [R60]. Text output is the most tractable target because "plain text is wonderfully simple to diff, version control, merge, store, manipulate" [R52]. Wikipedia notes characterization tests can be auto-generated: exercise code with a wide range of relevant/random inputs, record outputs, emit tests [R3].

Validation. Coverage measures execution, not fault detection: PIT — "it does not check that your tests are actually able to detect faults in the executed code"; mutation testing is "the gold standard against which all other types of coverage are measured" [R48]. Stryker: "The higher the percentage of mutants killed, the more effective your tests are" [R49]. Mutmut's workflow is exactly coverage-gap-driven iteration: run → browse survivors → write a test to kill one → re-run [R54]. The RIP model explains survivors: a mutant must be Reached, Infect program state, and Propagate to an observed assertion [R55]. Equivalent mutants can never be killed and inflate the gap ("one of the biggest obstacles to practical usage") [R55]; Google excludes "unproductive" mutants — "writing tests for those mutants would make the test suite worse, not better" [R50]. Google's coupling finding: ~70% of historical bugs were coupled to a mutant in the introducing change; and in >90% of lines either all mutants are killed or none is — so one mutant per line suffices for triage [R50]; the production system's diff-based mutant filtering (uncovered and "arid" lines) is detailed in the accompanying research paper [R51]. Adopting the runner into an existing repo is low-friction (editable install so tests run against live source; tox for isolation) [R59].

```text
Choose surface (change-area + coverage-gap + text-output) 
  -> capture goldens -> approve -> run suite (must be green)
  -> mutation spot-check on the characterized module
  -> survivors? Equivalent/unproductive? -> ignore (documented)
     else real gap -> add input/case -> re-capture -> approve
  -> CI gate: goldens committed, reviewed; CI never auto-writes
```

Review gate. Jest: "The snapshot artifact should be committed alongside code changes, and reviewed as part of your code review process"; since Jest 20 snapshots are not auto-written on CI without `--updateSnapshot` [R8]. QASkills: "The approval file is not a magic truth. It is a reviewed example of expected behavior... If nobody reviews the diff, approval testing degenerates into accepting whatever the program printed most recently"; CI should run without update flags [R12]. Google's ToT: change-detector tests "break in response to any change to the production code, without verifying correct behavior... Change detectors provide negative value" [R57]. Flaky-suite rot: unreliable signals make developers mistrust the gate and overlook genuine failures — retry plugins mitigate, `xfail(strict=False)` quarantine is "rather dangerous to use permanently" [R58]. For scale: Google caps findings (one mutant per line, seven per file) "because having more makes the review noisy" — and integrates mutation findings into code review, where "integrating into the existing developer process has the highest chance that the developers will take action" [R50].

### D3. Properties, differential testing, metamorphic relations (K7-K8)

Property-based testing is "a fuzzer plus a library of helpers" — the property (the reasoning about behavior) is the human contribution [R19]; the lineage runs QuickCheck (Haskell) → Hypothesis, fast-check, jqwik, propEr, ScalaCheck [R18], and PBT's stated value proposition is better ROI: "for the same amount of work we get tests that are much better at finding bugs" [R33]. On-ramp for existing code: the crash-free invariant first ("The software shouldn't crash" — remarkably powerful with random inputs) [R20], then round-trip invariants: "Encoding and then decoding should be exactly the same as doing nothing" — a complete spec for encode/decode pairs, demonstrated finding real bugs with shrunk readable counterexamples [R21]. Stateful model testing compares a real implementation against an in-memory model and looks for discrepancies — the documented form of new-vs-reference differential [R31]. Reproducibility is built in: seeds reported per run; Hypothesis stores failures in an example database and replays them; `@reproduce_failure` blobs; CI profiles; for correctness-critical inputs use `@example` (never rely on the replay database) [R24]. Adoption evidence: Hypothesis is used by pytorch, jax, PyPy, numpy, pandas, xarray, mercurial and more; a 2026 corpus dataset covers 28,928 tests across 1,529 repos [R25][R26].

Differential testing: "run two programs with the same inputs, compare outputs" [R27]. SQLite's sqllogictest runs identical queries across PostgreSQL, MySQL, SQL Server, Oracle 10g — 7.2M queries, 1.12GB of test data — and labels logically-equivalent queries to require identical output (a production metamorphic relation) [R28][R29]. Csmith generates random C and uses the other compiler (gcc vs clang) as the oracle [R30]. Metamorphic testing (Chen, 1998) formalizes multi-execution invariants as oracles when no reference output exists (e.g. sin(π−x)=sin x); 750+ papers; Google acquired GraphicsFuzz to apply MT to Android graphics drivers [R32]. The refactoring-safety reading — old implementation as oracle for the new — is a synthesis across difftest's description, Csmith's oracle pattern, and Hypothesis's model comparison [R27][R30][R31] (see Unverified Claims U2).

```text
Surface type -> technique
  invariant exists (round-trip, ordering, crash-freedom) -> property tests
  reference implementation / old version exists          -> differential tests
  no oracle, deterministic but complex output             -> golden master + properties layered
  reorder/transform equivalence                           -> metamorphic relations
```

### D4. Record-and-replay and contracts for I/O boundaries (K9-K10)

The VCR pattern: run once against the real server → cassette written; later runs replay — "fast (no real HTTP), deterministic (passes offline), accurate (same headers and body)" [R34]. Betamax states the two-branch interception model: match-and-replay, else record-and-return [R36]. Polly.JS extends to browser fetch/XHR with HAR persistence; motivation: "keeping fixtures and factories in parity with your APIs can be a time consuming process" [R37]. Nock explicitly targets existing codebases: "Guessing what the HTTP calls are is a mess, especially if you are introducing nock on your already-coded tests" — with `back` modes (wild/dryrun/record/update/lockdown) [R38]. Drift is handled by deliberate re-record cycles: "if the server you are testing against ever changes its API, all you need to do is delete your existing cassette files, and run your tests again" (VCR.py) [R35]. Redaction is first-class: VCR's "Filter Sensitive Data" [R34]; nock deliberately does not record request headers (timestamp-dependent) and never records user-agent [R38]; Playwright's codegen auth-state warning: gitignore it [R39]. Browser-level capture: Playwright codegen generates tests from real actions with resilient locators and recordable assertions [R39]; `toMatchSnapshot` handles text/binary goldens beyond screenshots [R43]; aria snapshots give structure-level (less pixel-fragile) goldens [R44]; Percy formalizes the approve-baseline-and-block-merge pipeline for visual regression [R45]. Cross-environment rendering variability is a documented risk for pixel goldens (same environment for baselines, stylePath to hide volatile elements) [R43].

Contracts: Pact's consumer-driven "contract by example" — "only parts of the communication that are actually used by the consumer(s) get tested... any provider behaviour not used by current consumers is free to change" [R40]. Schema validation differs: Dredd validates a running backend against an API description step-by-step [R41]; Schemathesis adds property-based generation from OpenAPI/GraphQL schemas — "exercises the edge cases that break your API" [R42]. Pact's own docs: static schemas "do not provide any test based assurance... not as effective in preventing integration bugs" [R40]. CLI boundary: bats is the standard TAP-compliant framework for UNIX-program behavior; snapshot-style CLI testing is a community pattern, not a built-in (U7) [R46].

### D5. What LLM/agentic test generation actually delivers (K11)

```text
LLM generates tests (captures current behavior when no oracle exists: TestPilot)
  -> MUST execute them (SWE-Agent+ on SWT-Bench-Lite: 15.9% -> 18.5% issue reproduction)
  -> MUST mutation-check them (MuTAP: 28% more faulty snippets caught, 17% missed by plain LLM/Pynguin)
  -> post-processing/multi-agent review reduces invalid tests (agentic loop: up to -60% invalid, +30% coverage [R75])
  -> human approval gate (Meta TestGen-LLM: 75% built, 57% passed reliably, 25% increased coverage [R62])
```

TestPilot: "providing the LLM with the signature and implementation of the function under test, along with usage examples extracted from documentation. We also attempt to repair failed generated tests by re-prompting the model with the failing test and error message" — median 70.2% statement coverage over 1,684 npm API functions [R61]. Because TestPilot has no spec oracle, its assertions encode current behavior — de-facto characterization [R61]. But context sensitivity is brutal: Codex exceeded 80% coverage on HumanEval yet no model exceeded 2% coverage on EvoSuite SF110, with smells like Duplicated Asserts and Empty Tests [R63]; a large empirical study of ChatGPT-generated tests found frequent compilation and execution errors, though passing tests resembled hand-written ones in coverage and readability, and an iterative refine loop (ChatTESTER) improved compilable tests by 34.3% and correct-assertion tests by 18.7% [R64]. A replicated human-subject experiment found LLM support significantly increases the number of tests generated, defect-detection rates, and overall testing efficiency [R65]. Meta's production TestGen-LLM applies a filter pipeline against hallucination: 75% built correctly, 57% passed reliably, 25% increased coverage [R62]. SWT-Bench measures issue reproduction: a test "reproduces" an issue when it fails pre-patch and passes post-patch; on SWT-Bench-Lite (276 issues; the full benchmark has 1,983), plain prompting reproduces 3.6-9.4% of issues, best agentic methods 15.9-18.5%, and instructing the agent to execute its tests raised success from 15.9%→18.5% — and generated tests double fix-selection precision as a filter [R73]. Mutation-guided generation (MuTAP): prompts augmented with surviving mutants detect up to 28% more faulty snippets, 17% missed by Pynguin and zero/few-shot LLMs, 93.57% mutation score [R70]. LLM-generated mutants are more realistic than rule-based ones (111.29% higher fault detection, 87.98% vs 41.64%) [R69], and can model bugs rule-based tools cannot express (LLMorpheus vs StrykerJS) [R71]. Multi-agent systems report strong but preprint-level numbers: TestAgent 83.69% mutation score across six Java projects [R67]; CANDOR frames the oracle distinction — search-based generation yields "regression oracles... derived from the program's current behavior rather than its intended functionality" [R68]; AnyPoC's 46 PoCs adopted as official regression tests [R74].

### D6. Design synthesis for the new skill (K12-K13)

Existing in-the-wild characterization skills all implement the PROTECT→CHANGE→EVOLVE lifecycle:
- `bkitduy/characterization-test-generator`: the Feathers method scripted — write test with expected=null → run → paste actual → rename; per-language golden conventions (Go golden files, Python approvaltests, TS/JS `toMatchSnapshot`, JVM ApprovalTests); plus a mutation step to prove tests catch changes; recommends committing characterization tests before AI refactors, replacing them with intent-based tests in EVOLVE [R76].
- `cskwork/clean-code`: inspect repo and record baseline → add retained characterization tests that pass on unchanged code → refactor in small verified batches → report evidence, with verification results distinguishing passing checks, pre-existing failures, new failures, and not-run commands [R77].
- `poolsar/claude-skill-refactor`: Safe Refactoring Mode = scope → characterization tests pinning current behavior → green on original → refactor → still green [R78].

The registry landscape suggests a gap but does not establish it: ComposioHQ's awesome-claude-skills (≈72.9k stars) lists TDD/test-fixing/webapp-testing skills but no dedicated characterization/golden-master skill; `obra/superpowers` (≈275k stars) is intent-first TDD with no characterization skill — yet registries are curated subsets, and absence is weak evidence [R79][R80]. The found characterization artifacts are refactor-adjacent or plugin-level one-shots; none is documented as a standalone "build and maintain a characterization suite" tool (the requested skill's niche) — but this must be re-checked against current registries before being asserted (U9) [R76][R77][R78].

Agent-skill format guidance (Anthropic's open skill standard, adopted by opencode): progressive disclosure — name+description pre-loaded, full SKILL.md on demand, references/ for deeper per-step detail; skills define workflow and guardrails; deterministic bundled scripts run as tools; audit bundled code for security because skills can execute code — doubly relevant for a skill that runs the repo's test suite and can approve goldens [R81][R82]. opencode specifics: `name` lowercase-hyphenated, `description` 1-1024 chars, search paths incl. `~/.config/opencode/skills/`, `permission.skill` allow/deny/ask [R82]. Sandboxing generated-test execution is an established pattern (AutoDev: Docker-confined build/test/execute with allowed/denied command lists) [R84]. Orchestration guidance: orchestrator-worker with explicit delegation, end-state evaluation instead of step-by-step validation [R83].

```text
Proposed skill pipeline (synthesis of K1-K13):
SCAN    inventory entry points; coverage report; branch gaps; change-risk surfaces
CAPTURE pick boundaries (pure/text-output first); generate inputs (seeded RNG + real examples)
        run capture loop; scrub volatile fields; write framework tests + goldens
APPROVE every golden diff must be human-approved (never auto-accept); report artifact
VERIFY  suite green on unchanged code; mutation spot-check characterized modules
        survivors triaged: equivalent/unproductive (documented) vs real gaps (iterate)
LAYER   properties (invariants/round-trips) | record-replay (I/O) | contracts (API) per surface
OUTPUT  test files + goldens + report (passing / pre-existing-failure / new-failure / not-run)
```

### D7. UI test discovery and authoring (K14-K16)

```text
Discover        Playwright codegen / Cypress Studio / Selenium IDE
                (record actions + auth state; assert visibility/text/value during recording)
  -> Harden     role/test-id locators; auto-wait instead of sleeps; strict locators
  -> Lock       aria snapshot (structure) -> text snapshot -> pixels (high-value screens only)
  -> Review     every snapshot diff approved by a human; same-environment pixel baselines
```

Discovery. Playwright's test generator "will look at your page and figure out the best locator, prioritizing role, text and test id locators. If the generator finds multiple elements matching the locator, it will improve the locator to make it resilient that uniquely identify the target element" [R39]. Assertions can be generated during recording (visibility / text / value) [R39], and auth state can be recorded once and reused: "This is useful to separately record an authentication step and reuse it later when recording more tests" (`--save-storage` / `--load-storage`) [R39]. The output is a draft: "You can then inspect your `test-1.spec.ts` file and manually improve it if needed" [R39] — and record-and-replay output is brittle by nature, so hardening is mandatory, not optional: a JSS 2023 study found snapshots "may swiftly become fragile if used improperly" [R125], LLMShot reports traditional snapshot tests flagging up to 8.2% of commits as false positives [R126], and the record/playback critique is long-standing [R127]. Cypress Studio records real interactions and Studio AI "watches what changes in the UI and recommends assertions automatically. You review them, keep what fits, and save" — with a documented selector priority ladder (data-cy first, nth-child last) [R95]. `cy.prompt` compiles natural-language steps into Cypress commands with a "generate once, commit" workflow [R96]. Selenium IDE "records multiple locators for each element it interacts with. If one locator fails during playback, the others will be tried" [R101].

Authoring resilience. Playwright "performs a range of actionability checks on the elements before making actions... It auto-waits for all the relevant checks to pass" and ships "auto-retrying assertions that remove flakiness by waiting until the condition is met" [R87]. Cypress's model: "Whenever commands have an assertion they will not resolve until their associated assertions pass. This enables you to describe the state of your application without having to worry about when it gets there" — and arbitrary `cy.wait(number)` is an anti-pattern [R97]. Locator doctrine: "we recommend prioritizing user-facing attributes and explicit contracts such as `page.getByRole()`... it is the closest way to how users and assistive technology perceive the page" [R88]; test-ids are "the most resilient way of testing as even if your text or role of the attribute changes, the test will still pass... However testing by test ids is not user facing" [R88]; "Long CSS or XPath chains... are an example of a **bad practice** that leads to unstable tests" [R88]; "Locators are strict. This means that all operations on locators... will throw an exception if more than one element matches" and `first()/nth()` are "**not recommended** because when your page changes, Playwright may click on an element you did not intend" [R88]. Cypress's best-practice counterpart: `data-*` attributes "isolate them from CSS or JS changes" [R97]. Structure: Playwright's POM guide — page objects "simplify authoring... and simplify maintenance by capturing element selectors in one place" [R89] — while Cypress flags "Sharing page objects" as an anti-pattern [R98]; isolation and state are the shared core: fresh browser contexts per test ("prevents cascading test failures") [R90], `storageState` to skip per-test login (state file is sensitive: "strongly discourage checking them into... repositories") [R90], parallel workers demand unique state ("A test that leaks state... works when tests run in order, but breaks the moment they run in parallel") [R91], and "Clean up state **before** tests run" — reset in `beforeEach`, never `afterEach` [R97].

Snapshot forms. Aria snapshots give "a YAML representation of the accessibility tree of a page... stored and compared later to verify if the page structure remains consistent" — with the documented pitfalls "**Over-Reliance**: It can be tempting to accept changes to snapshots without fully understanding them, potentially hiding bugs" and "**Granularity**: Large snapshots may be hard to interpret" [R44]. Text/binary goldens: "you can use `expect(value).toMatchSnapshot(snapshotName)` to compare text or arbitrary binary data... You should commit this directory to your version control... and review any changes to it" [R43]. Pixels: "On first execution, Playwright test will generate reference screenshots. Subsequent runs will compare against the reference... Do this with the `--update-snapshots` flag" [R43] — but "Browser rendering can vary based on the host OS, version, settings, hardware, power source... run tests in the same environment where the baseline screenshots were generated", with per-browser/platform snapshots and a `stylePath` hook "filtering out dynamic or volatile elements" [R43]. Storybook's comparison: markup snapshots "compare the rendered markup of every story against known baselines... can lead to an increase in false positives as code changes don't always yield visual changes in the component. Visual tests compare the rendered pixels... the same thing your users actually experience" — with an explicit accept-as-baseline review ("If the changes are intentional, ✅ accept them as baselines") [R102]. Component-level tests (Storybook interaction tests in a real browser, Testing Library) follow the principle "The more your tests resemble the way your software is used, the more confidence they can give you", demoting `data-testid` to last resort [R104][R103]; they are "expensive to maintain when applied wholesale to every component. We recommend combining them with other methods like visual testing" [R103].

### D8. Workflow and journey test discovery and authoring (K17-K18)

```text
Discover    routes/controllers (paths, verbs, params) | analytics + session replay
            (real journey event sequences) | tickets via BDD concrete examples
  -> Model  one journey = actor + scenario + phase sequence (journey map)
  -> Author happy path first; journey-length tests (many assertions); independent;
            seed data programmatically; reset state in before/beforeEach
  -> Engine Temporal/Step Functions: integration-first, time-skip waits,
            production event-history replay as the CI continuity gate
```

Discovery. NN/g's journey-mapping framework is directly transferable: a journey is defined by "Actor, Scenario + Expectations, Journey Phases, Actions..." and "Journey maps are best for scenarios that involve a sequence of events... or might involve multiple channels" [R106]. It must be evidence-driven: "Base it on truth. Journey maps should result in truthful narratives, not fairy tales. Start with gathering any existing research" [R107]; quantitative analytics trigger discovery ("if you are aware through analytics... that something specific is happening... journey mapping can help you find out why") [R107]; session replay reconstructs "a reproduction of what the user actually did on the site or app" from logged events — the raw material for journey steps [R108]. Routes/controllers are a code-level enumeration source: Spring's "controllers make heavy use of annotations to declare which paths they're listening on, which HTTP verbs to use, which parameters they parse. Simply invoking a controller's method within your unit tests won't test all of these crucial things" — hence MockMVC-style helpers [R109]. Ticket/acceptance-criteria mining is BDD discovery: "take a small upcoming change to the system -- a User Story -- and talk about concrete examples of the new functionality" where "Good BDD examples are concrete rather than abstract. They mention names of people and places, exact dates and amounts" [R110].

Authoring. The pyramid constrains quantity: "Write lots of small and fast unit tests. Write some more coarse-grained tests and very few high-level tests that test your application from end to end. Watch out that you don't end up with a test ice-cream cone that will be a nightmare to maintain" [R109]. E2E tests are journey-length and user-visible: "Automated tests should verify that the application code works for the end users, and avoid relying on implementation details" [R92]; "It is common for tests in Cypress to issue 30+ commands" — splitting a journey into single-assertion tests is an anti-pattern [R98]. Independence: "Tests should always be able to be run independently from one another and still pass" [R98]. Data: "programmatically log into your application, and take control of your application's state" (Cypress) [R98]; "If working with a database then make sure you control the data. Test against a staging environment and make sure it doesn't change" (Playwright) [R92]. Async/eventual consistency: web-first assertions wait — "if the alert message takes half a second to appear, assertions such as `toBeVisible()` will wait and retry if needed" [R92]. State reset: "Code put in a before or beforeEach hook will always run prior to the test - even if you refreshed Cypress in the middle of an existing one!" [R98].

Workflow engines. "In Step Functions, state machines are called workflows, which are a series of event-driven steps. Each step in a workflow is called a state" — with first-class human-in-the-loop states (task tokens) [R111]. Temporal's documented test hierarchy: unit (function-level, mocked) → integration (mocked activities/Workers) → E2E (real server + worker + client), with the recommendation "to write the majority of your tests as integration tests" [R112]; long-running workflows are handled by a time-skipping test server — "Implementing the test framework allows your Workflow code to skip time and complete your tests in seconds" [R112]. The continuity gate for workflow engines is history replay, quoted in full as the docs' own CI checklist: "Download the Event Histories of a representative set of recent open and closed Workflows from each Task Queue... Run the Event Histories through replay. Fail CI if any error is encountered during replay" — "Replay succeeds only if the Workflow Definition is compatible with the provided history from a deterministic point of view" [R112]. AWS's alternative tooling is weaker: "Step Functions Local does not provide feature parity and is unsupported", with the TestState API recommended to "unit test your state machine logic before deploying" [R113].

### D9. Validating UI/workflow suites and AI-assisted authoring (K19-K20)

```text
E2E layer is small and flaky by nature (Google: 84% of pass->fail transitions flaky)
  -> auto-wait + retries (classify: passed/flaky/failed) + quarantine-with-bug-report
  -> validate: mutation at component level (StrykerJS) — not feasible per-commit at E2E
     coverage via instrumentation (istanbul) — but "executed != asserted"
  -> AI: Playwright planner/generator/healer; Cypress cy.prompt — self-healing suites,
     yet GUI-agent autonomy still below human on hard benchmarks (WebArena 14.41% -> UI-TARS-2)
```

Flakiness and scale. "A flaky test indicates that the test relies on some system state that is not being appropriately controlled... Higher level tests are more likely to be flaky as they rely on more state" [R114]; common triggers: "Animations, API calls, Test server / database availability, Resource dependencies availability, Network issues" [R99]. Google's corpus: "about 1.5% of all test runs reporting a 'flaky' result", "Almost 16% of our tests have some level of flakiness", "about 84% of the transitions we observe from pass to fail involve a flaky test!" [R115]. Mitigations: auto-waiting [R87]; retry policies with first-class classification — "passed" (first run), "flaky" (failed first, passed on retry), "failed" (all retries) [R93]; quarantine: "removes the test from the critical path and files a bug... could easily mask a real race condition" [R115]. The real cost is mistrust: "Flaky tests reduce the developer's trust in the test, and as a result flaky tests are often ignored, even when they find real product issues" [R116]; at the 1.5% rate "15 tests will likely fail" per 1000-test project run [R115]. pytest's guidance for un-fixable flakes: remove or rewrite lower — "rewritten at a lower level which will remove the flakiness or make its source more apparent" [R114]. Quantity doctrine: "As a good first guess, Google often suggests a 70/20/10 split: 70% unit tests, 20% integration tests, and 10% end-to-end tests... it should retain that pyramid shape" with inverted-pyramid/hourglass named as anti-patterns, and the operational heuristic "pretend that you could only write 10 E2E tests, and ask yourself where those tests would go" [R116]. The Testing Trophy inverts emphasis toward integration tests with E2E as a thin layer of critical flows [R124].

Review discipline for snapshots. "Snapshots are stored next to the test file, in a separate directory... You should commit this directory to your version control (e.g. git), and review any changes to it" [R43]; re-baselining is a deliberate flag (`--update-snapshots`), never a silent CI action [R43]; pixel comparisons support thresholds (`maxDiffPixels` via pixelmatch) and volatile-element filtering (`stylePath`) [R43]; Percy productizes the human gate — "reviewers can review changes, request changes, and approve them before merging" with "previously approved snapshots are carried forward to subsequent builds" [R45].

Validation. Mutation testing transfers to frontends at the component level: StrykerJS "supports most JavaScript projects, including TypeScript, React, Angular, VueJS, Svelte" and its framing — "Code coverage would tell you the bread is 80% covered with paste. Mutation testing, on the other hand, would tell you it is actually *chocolate* paste" [R117][R118]. At the E2E tier it is impractical per-commit: Cypress's own comparison table labels mutation testing "Slow to run; typically too expensive for CI on every commit" [R100]; no mainstream tool applies mutation at the browser layer (U19). Coverage measurement works via Istanbul instrumentation merged by `@cypress/code-coverage`, with the documented limitation that "a line being executed doesn't guarantee the assertion is meaningful" — the argument for pairing coverage with mutation and review; newer "UI Coverage" products answer "which parts of the UI did the tests touch?" rather than code lines [R100].

AI-assisted authoring and maintenance. Playwright Test Agents are framework-native: "Playwright comes with three Playwright Test Agents out of the box: planner, generator and healer" — the generator verifies selectors live, and "healer executes the test suite and automatically repairs failing tests... Replays the failing steps... Suggests a patch (e.g., locator update, wait adjustment, data fix)... Re-runs the test until it passes or until guardrails stop the loop" [R94]. Cypress: `cy.prompt` compiles natural language to commands, and "Leave cy.prompt in your tests and it adapts automatically when your UI changes, so a renamed class or a restructured DOM doesn't break the run" [R96]; Studio AI recommends assertions during recording [R95]. Commercial self-healing (mabl) claims "eliminating up to 95% of test maintenance" — vendor marketing, not independent evidence (U21) [R118][R119]. The autonomy record: WebArena (2023) "our best GPT-4-based agent only achieves an end-to-end task success rate of 14.41%, significantly lower than the human performance of 78.24%" [R120]; Mind2Web provides the 2,000+ task/137-site evaluation paradigm [R121]; UI-TARS achieved SOTA on 10+ benchmarks in early 2025 [R122]; UI-TARS-2 (Sept 2025) "reaches 88.2 on Online-Mind2Web, 47.5 on OSWorld... 73.3 on AndroidWorld" [R123]. Healer/self-healing reliability is designed behavior, not measured (U21).

## Recommendation

Build the new csm skill as a **characterization-first behavior-continuity suite generator** with this shape (high confidence on the core, medium on the exact pipeline):

1. **SCAN** — inventory public/entry-point functions, CLI commands, and I/O boundaries; read branch coverage for untested destinations; rank by change-risk and text-output tractability [R2][R10][R47][R52]. For UI/workflow surfaces additionally: enumerate routes/controllers and business journeys from analytics and session replay, and workflow-engine task queues [R106][R107][R108][R109][R112].
2. **CAPTURE** — for each target: build inputs (seed-controlled RNG + real recorded examples + boundary values mined from the code), run the code, capture output as a golden; scrub volatile fields (prefer dependency injection; else minimal regex); emit ordinary framework tests wrapping the goldens [R2][R3][R4][R5][R13]. For UI: record actions with codegen (auth state included), then harden locators to role/test-id and auto-waiting before asserting [R39][R88][R87].
3. **APPROVE** — never auto-accept: every golden diff is presented for explicit human approval; CI must never write or update goldens [R8][R12][R57]. Same rule for aria/text/pixel snapshots — `--update-snapshots` is a human-gated, deliberate flag, never a silent CI action [R43][R45].
4. **VERIFY** — the suite must be green on unchanged code; run mutation spot-checks (mutmut/PIT/Stryker) on characterized modules; triage survivors into equivalent/unproductive (documented, ignored) vs real gaps (iterate) [R48][R50][R54][R55]. For UI, mutation is practical at the component level (StrykerJS), not per-commit at E2E [R117][R100]; classify retry outcomes (passed/flaky/failed) and quarantine with a bug report rather than silently deleting [R93][R115].
5. **LAYER** — per surface type: invariants/round-trips → properties (Hypothesis, fast-check, jqwik); HTTP/I/O → record-and-replay cassettes (VCR/nock/Polly); APIs → contracts (Pact if consumers matter, Schemathesis for schema-driven PBT); UI → codegen-recorded journeys hardened to role/test-id, aria/text snapshots before pixels, pixel goldens only for high-value screens with same-environment baselines [R17][R21][R22][R23][R28][R34][R40][R42][R43][R44][R39][R92]; workflow engines → integration-first with time-skipping plus **production event-history replay as the continuity gate** [R112].
6. **OUTPUT** — test files + goldens + a verification report distinguishing passing / pre-existing-failure / new-failure / not-run; the report is the durable deliverable [R77].

This directly serves the user's goal: a skill that takes a repo and develops tests ensuring continuity of current behavior under change. The evidence says: keep the skill's surface boundaries coarse (whole-output characterization, not micro-assertions [R52][R60]); assume determinism is the main risk and engineer it before capture [R3]; gate everything on human review of diffs [R8][R12]; use mutation checks rather than coverage percentage as the "is it protected" signal [R48][R49]; keep E2E/UI suites deliberately small (pyramid ~70/20/10, "imagine only 10 E2E tests") because flakiness grows superlinearly with E2E share [R116]; and prefer structure-level snapshots (aria/text) over pixels except for high-value screens with same-environment baselines [R43][R44][R102]. Confidence: **high** on the technique stack and workflow constraints (convergent across all eight tracks and decades of primary sources); **medium** on the exact pipeline ordering, on agentic-boost details (preprint numbers, tool-version drift), and on AI self-healing claims (design promises, not measured) [R94][R118]. What would change the answer: evidence that a large characterization suite degrades CI value faster than its protection grows (the known change-detector failure mode [R57]); evidence on LLM test-generation catch-rates beyond SWT-Bench. Cost of being wrong: over-broad goldens + blind auto-approval = a suite that is noise and negative value [R57]; determinism shortcuts = flaky suite, mistrusted gate [R58].

## Unverified Claims

- **U1.** Martin Fowler's characterization-test bliki entry exists at martinfowler.com/bliki/CharacterizationTest.html — UNVERIFIED: three fetch attempts returned 404 (2026-08-20); no alternative URL confirmed. Verify by locating the current Fowler page before citing it.
- **U2.** Differential testing "originated with McKeeman 1998" (Digital Technical Journal 10(1)) — UNVERIFIED: the commonly cited PDF and Wayback snapshots were unreachable (404 / no archive). The technique itself is verified via sqlite.org/sqllogictest and docs.rs/difftest [R27][R28]. Verify by fetching the primary DTJ article.
- **U3.** "CoverAgent paper" for LLM test generation — UNVERIFIED: no arXiv/Scholar artifact found; the retrievable entity is Qodo Cover (ex-CodiumAI), unmaintained as of 2025-06-15 [R66].
- **U4.** "TestGPT" paper/tool — UNVERIFIED: not on arXiv; a Cohere URL 404'd.
- **U5.** A distinct "MUTEST" paper — UNVERIFIED: closest retrieved artifact is MUTester (arXiv 2307.00404) for deep-learning frameworks [R72].
- **U6.** Bats has built-in snapshot/golden-file support — UNVERIFIED (likely false): bats-core docs show a TAP framework without first-class snapshots; CLI snapshotting is a community pattern [R46].
- **U7.** A built-in `pytest --diff` flag — UNVERIFIED (false): diff-driven selection in pytest is via plugins (pytest-testmon [R53]) or `--lf/--ff/--nf` [R56].
- **U8.** Exact CI wall-clock cost of property-based testing — UNVERIFIED: only configurable knobs cited (jqwik default 1000 tries/property [R22]); no run-time benchmarks retrieved.
- **U9.** "No existing standalone characterization-suite-maintenance skill" — NOT ESTABLISHED (challenger downgraded K12 partly on this): the major registries retrieved (awesome-claude-skills, superpowers) list none [R79][R80], but registries are curated subsets and absence is weak negative evidence; verify by searching current skill registries before claiming the gap.
- **U10.** Polly.JS maintenance status and docs site — UNVERIFIED: docs page empty (JS-rendered); quotes from GitHub README only [R37].
- **U11.** Hypothesis default example counts and per-test settings details — UNVERIFIED: the explaining article exists in the hypothesis.works index but was not fetched [R26].
- **U12.** Google's internal figures (~70% mutant-bug coupling; >90% all-or-none lines; 15% not-useful rate) — retrieved but self-reported internal findings; the source itself notes "Mutants do not resemble real bugs... they are simpler than bugs found in the wild," so the coupling figure tests a hypothesis rather than proving a universal [R50].
- **U13.** "Explicit human-approval gates" and "sandboxed execution of generated tests" as *skill-authoring* guidance — NOT directly supported by cited quotes (challenger downgraded K13): approval gates are industry practice (R8/R12/R45) but not quoted skill-design guidance; AutoDev's Docker sandbox is a framework pattern, not skill guidance [R84].
- **U14.** jqwik's current user guide contains an "Anti-AI Usage Clause" warning AI coding agents away from the library, printing a notice at runtime — VERIFIED-AT-CHALLENGE but not author-verified: relevant to agent-driven test tooling choices, yet its exact wording and scope need direct re-retrieval before acting on it [R22].
- **U15.** Percy and Applitools official docs — UNVERIFIED (extension run): percy.io/docs and applitools URLs unreachable (client-rendered shell / 404); Percy content cited via the BrowserStack redirect [R45]. Verify against current docs before relying on feature specifics.
- **U16.** Testim's self-healing test capability — UNVERIFIED: testim.io self-healing post returned 404 on 2026-08-20; widely reported but not verified here.
- **U17.** A canonical "critical user journey (CUJ)" source — NOT RETRIEVED: NN/g's journey-mapping framework [R106][R107] is the verified analogue; the CUJ-specific literature remains unverified.
- **U18.** Playwright's Page Object Models page content — UNVERIFIED: cited via nav reference and Cypress-divergence evidence [R89][R98]; the page itself was not fetched by the extension researchers.
- **U19.** Mutation testing at the browser/E2E layer — NOT FOUND (negative evidence): no mainstream tool applies mutation at E2E; Cypress documents mutation as too slow per-commit [R100], StrykerJS covers component/unit level [R117]. Verify by searching current tooling before claiming impossibility.
- **U20.** Mutating test code itself ("strangler tests"/test torture) — NOT FOUND in any retrieved source; likely conflation of rewriting flaky E2E tests lower (pytest guidance [R114]) and mutating production code. Unverified.
- **U21.** Playwright Test Agent healer efficacy and mabl's "95% maintenance elimination" — UNVERIFIED as measurements: docs describe intended behavior; mabl figure is vendor marketing [R94][R118][R119].
- **U22.** "Restrict snapshots to meaningful screens" as explicit documented guidance — UNVERIFIED as verbatim guidance: inferred from the documented levers (stylePath, maxDiffPixels, commit-and-review) [R43]; no single instruction found.
- **U23.** Cypress "UI Coverage" product behavior — MEDIUM: referenced in Cypress docs as a premium solution; vendor product description [R100].

## References

All URLs retrieved 2026-08-20.

- [R1] https://michaelfeathers.silvrback.com/characterization-testing — Feathers, characterization testing
- [R2] https://www.artima.com/weblogs/viewpost.jsp?thread=198296 — Savoia, characterization tests algorithm
- [R3] https://en.wikipedia.org/wiki/Characterization_test — characterization test / golden master (incl. Wikipedia citation of Feathers, Working Effectively with Legacy Code)
- [R4] https://blog.thecodewhisperer.com/permalink/surviving-legacy-code-with-golden-master-and-sampling — Rainsberger, golden master + sampling
- [R5] https://github.com/approvals/ApprovalTests.Documentation/blob/main/explanations/what_are_approvals.md — ApprovalTests, what are approvals
- [R6] https://approvaltests.com/ — ApprovalTests site
- [R7] http://octopusinvitro.gitlab.io/blog/code-and-tech/approval-testing — approval testing + mutation walkthrough (Gilded Rose)
- [R8] https://jestjs.io/docs/snapshot-testing — Jest snapshot testing docs
- [R9] https://jestjs.io/blog/2016/07/27/jest-14 — Jest 14 snapshot motivation
- [R10] https://www.artima.com/weblogs/viewpost.jsp?thread=198674 — Savoia, writing characterization tests by reading code
- [R11] https://www.asserthired.com/glossary/golden-master-testing — golden master glossary
- [R12] https://qaskills.sh/blog/approval-testing-golden-master-guide — approval testing / golden master guide
- [R13] https://blog.nimblepros.com/blogs/characterization-tests-with-snapshot-testing/ — .NET Verify + Bogus seeded snapshot case study
- [R14] https://www.fabrizioduroni.it/2018/03/20/golden-master-test-characterization-test-legacy-code/ — Java golden master case study
- [R15] https://github.com/chicio/Golden-Master-Testing-Characterization-Test — companion example repo
- [R16] https://thomaskioko.me/posts/android_screenshot_testing/ — Roborazzi Android screenshot goldens
- [R17] https://hypothesis.readthedocs.io/en/latest/ — Hypothesis docs
- [R18] https://hypothesis.works/articles/quickcheck-in-every-language/ — QuickCheck lineage
- [R19] https://hypothesis.works/articles/what-is-property-based-testing/ — PBT = fuzzer + helpers
- [R20] https://hypothesis.works/articles/getting-started-with-hypothesis/ — crash-free invariant on-ramp
- [R21] https://hypothesis.works/articles/encode-decode-invariant/ — round-trip invariants
- [R22] https://jqwik.net/docs/current/user-guide.html — jqwik user guide (1000 tries, seeds)
- [R23] https://github.com/dubzzz/fast-check — fast-check
- [R24] https://hypothesis.readthedocs.io/en/latest/tutorial/replaying-failures.html — Hypothesis replaying failures, @example, database
- [R25] https://hypothesis.readthedocs.io/en/latest/usage.html — Hypothesis notable users
- [R26] https://hypothesis.works/articles/ — Hypothesis articles index (corpus dataset)
- [R27] https://docs.rs/difftest/latest/difftest/ — difftest crate (differential testing definition)
- [R28] https://sqlite.org/sqllogictest — SQLite sqllogictest (cross-engine differential)
- [R29] https://www.sqlite.org/testing.html — SQLite testing page (7.2M queries; bug-encoded regression policy)
- [R30] https://github.com/csmith-project/csmith — Csmith compiler differential testing
- [R31] https://hypothesis.readthedocs.io/en/latest/stateful.html — stateful model testing
- [R32] https://en.wikipedia.org/wiki/Metamorphic_testing — metamorphic testing
- [R33] http://www.propertybasedtesting.com/ — PBT ROI claim
- [R34] https://github.com/vcr/vcr — VCR Ruby
- [R35] https://github.com/kevin1024/vcrpy — VCR.py
- [R36] https://pypi.org/project/betamax/ — Betamax
- [R37] https://github.com/Netflix/pollyjs — Polly.JS
- [R38] https://github.com/nock/nock — nock (back modes, header recording caveats)
- [R39] https://playwright.dev/docs/codegen — Playwright codegen (auth.json warning)
- [R40] https://docs.pact.io/ — Pact contract testing
- [R41] https://dredd.org/ — Dredd API validation
- [R42] https://schemathesis.readthedocs.io/en/stable/ — Schemathesis
- [R43] https://playwright.dev/docs/test-snapshots — Playwright snapshots (pixel goldens, stylePath, toMatchSnapshot)
- [R44] https://playwright.dev/docs/aria-snapshots — Playwright aria snapshots
- [R45] https://www.browserstack.com/docs/percy/overview/visual-testing-basics — Percy visual regression
- [R46] https://github.com/bats-core/bats-core — bats-core
- [R47] https://coverage.readthedocs.io/en/7.15.4/branch.html — coverage.py branch coverage
- [R48] https://pitest.org/ — PIT mutation testing
- [R49] https://stryker-mutator.io/docs/ — Stryker mutation testing
- [R50] https://testing.googleblog.com/2021/04/mutation-testing.html — Google mutation testing post (coupling, arid nodes, review caps)
- [R51] https://research.google/pubs/state-of-mutation-testing-at-google/ — Google mutation testing paper
- [R52] https://coding-is-like-cooking.info/2013/09/approval-testing/ — Emily Bache, approval testing
- [R53] https://testmon.org/ — pytest-testmon
- [R54] https://mutmut.readthedocs.io/en/latest/ — mutmut docs
- [R55] https://en.wikipedia.org/wiki/Mutation_testing — mutation testing (RIP model, equivalent mutants)
- [R56] https://docs.pytest.org/en/stable/how-to/cache.html — pytest --lf/--ff/--nf
- [R57] https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html — ToT change-detector tests
- [R58] https://docs.pytest.org/en/stable/explanation/flaky.html — pytest flaky guidance
- [R59] https://docs.pytest.org/en/stable/how-to/existingtestsuite.html — adopting pytest in existing suites
- [R60] https://automation.eurostarsoftwaretesting.com/event/2025/get-in-control-of-legacy-code-with-approval-testing/ — Emily Bache EuroSTAR 2025 talk abstract
- [R61] https://arxiv.org/abs/2302.06527 — TestPilot
- [R62] https://arxiv.org/abs/2402.09171 — TestGen-LLM
- [R63] https://arxiv.org/abs/2305.00418 — Codex JUnit tests (HumanEval vs SF110)
- [R64] https://arxiv.org/abs/2305.04207 — ChatGPT unit tests / ChatTESTER
- [R65] https://arxiv.org/abs/2502.09801 — LLM support improves manual unit testing
- [R66] https://github.com/qodo-ai/qodo-cover — Qodo Cover (ex-CoverAgent)
- [R67] https://arxiv.org/abs/2607.09101 — TestAgent (preprint)
- [R68] https://arxiv.org/abs/2506.02943 — CANDOR
- [R69] https://arxiv.org/abs/2406.09843 — LLM mutants (BugFarm/LLMorpheus study)
- [R70] https://arxiv.org/abs/2308.16557 — MuTAP
- [R71] https://arxiv.org/abs/2404.09952 — LLMorpheus
- [R72] https://arxiv.org/abs/2307.00404 — MUTester
- [R73] https://arxiv.org/html/2406.12952v3 — SWT-Bench
- [R74] https://arxiv.org/abs/2604.11950 — AnyPoC (preprint)
- [R75] https://arxiv.org/abs/2601.02454 — agentic generate-execute-analyze-refine (preprint)
- [R76] https://github.com/bkitduy/characterization-test-generator — characterization-test-generator plugin
- [R77] https://github.com/cskwork/clean-code — clean-code skill
- [R78] https://github.com/poolsar/claude-skill-refactor — claude-skill-refactor
- [R79] https://github.com/ComposioHQ/awesome-claude-skills — skill registry
- [R80] https://github.com/obra/superpowers — superpowers skills framework
- [R81] https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills — Anthropic skill engineering
- [R82] https://opencode.ai/docs/skills/ — opencode skills docs
- [R83] https://www.anthropic.com/engineering/built-multi-agent-research-system — multi-agent research patterns
- [R84] https://arxiv.org/abs/2403.08299 — AutoDev sandboxing
- [R85] https://kentcdodds.com/blog/effective-snapshot-testing — Kent C. Dodds, effective snapshot testing (dissenting source, retrieved by challenger)
- [R86] https://understandlegacycode.com/blog/characterization-tests-or-approval-tests/ — Nicolas Carlo, regression vs characterization vs approval tests (dissenting source, retrieved by challenger)
- [R87] https://playwright.dev/docs/actionability — Playwright actionability/auto-wait
- [R88] https://playwright.dev/docs/locators — Playwright locator guidance (role-first, test-id, strictness, CSS/XPath anti-pattern)
- [R89] https://playwright.dev/docs/pom — Playwright page object models
- [R90] https://playwright.dev/docs/auth — Playwright auth/storageState (sensitivity warning)
- [R91] https://playwright.dev/docs/test-parallel — Playwright parallelism/isolation
- [R92] https://playwright.dev/docs/best-practices — Playwright best practices (user-visible behavior, web-first assertions, control data)
- [R93] https://playwright.dev/docs/test-retries — Playwright retries (passed/flaky/failed classification)
- [R94] https://playwright.dev/docs/test-agents — Playwright Test Agents (planner/generator/healer)
- [R95] https://docs.cypress.io/app/guides/cypress-studio — Cypress Studio (selector priority, Studio AI)
- [R96] https://docs.cypress.io/app/guides/ai-test-generation — Cypress cy.prompt AI test generation
- [R97] https://docs.cypress.io/app/core-concepts/best-practices — Cypress best practices (data-* selectors, retry-ability, state cleanup)
- [R98] https://docs.cypress.io/guides/references/best-practices — Cypress references best practices (independence, programmatic login, page-object anti-pattern)
- [R99] https://docs.cypress.io/app/guides/test-retries — Cypress test retries (flakiness causes)
- [R100] https://docs.cypress.io/guides/tooling/code-coverage — Cypress code coverage (istanbul, mutation cost, UI coverage)
- [R101] https://www.selenium.dev/selenium-ide/ — Selenium IDE (multi-locator fallback)
- [R102] https://storybook.js.org/docs/writing-tests/visual-testing — Storybook visual testing (pixels vs markup, baselines)
- [R103] https://storybook.js.org/docs/writing-tests/interaction-testing — Storybook interaction tests
- [R104] https://testing-library.com/docs/guiding-principles — Testing Library guiding principles
- [R105] https://kentcdodds.com/blog/static-vs-unit-vs-integration-vs-e2e-tests — Kent C. Dodds, test types comparison
- [R106] https://www.nngroup.com/articles/journey-mapping-101/ — NN/g journey mapping 101 (actor/scenario/phases)
- [R107] https://www.nngroup.com/articles/customer-journey-mapping/ — NN/g customer journey mapping (evidence-driven, analytics)
- [R108] https://www.fullstory.com/session-replay/ — Fullstory session replay (mechanism; vendor source)
- [R109] https://martinfowler.com/articles/practical-test-pyramid.html — Fowler, practical test pyramid (routes/MockMVC, pyramid shape)
- [R110] https://cucumber.io/docs/bdd/ — Cucumber BDD (discovery, concrete examples, living documentation)
- [R111] https://docs.aws.amazon.com/step-functions/latest/dg/ — AWS Step Functions developer guide (state machines = workflows, human-in-the-loop)
- [R112] https://docs.temporal.io/dev-guide/typescript/testing — Temporal testing guide (integration-first, time-skipping, event-history replay)
- [R113] https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html — Step Functions Local (unsupported, TestState API)
- [R114] https://docs.pytest.org/en/stable/flaky.html — pytest flaky tests guidance
- [R115] https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html — Google flaky-tests analysis (1.5%/16%/84%)
- [R116] https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html — Google, just say no to more E2E tests (pyramid 70/20/10, 10-E2E heuristic)
- [R117] https://stryker-mutator.io/docs/stryker-js/introduction/ — StrykerJS intro (frontend support)
- [R118] https://www.mabl.com/auto-healing-tests — mabl auto-healing tests (vendor marketing)
- [R119] https://www.mabl.com/ — mabl agentic testing platform (vendor positioning)
- [R120] https://arxiv.org/abs/2307.13854 — WebArena (GPT-4 14.41% vs human 78.24%)
- [R121] https://arxiv.org/abs/2306.06070 — Mind2Web (2,000+ tasks, 137 sites)
- [R122] https://arxiv.org/abs/2501.12326 — UI-TARS (SOTA GUI agent)
- [R123] https://arxiv.org/abs/2509.02544 — UI-TARS-2 (Online-Mind2Web 88.2)
- [R124] https://kentcdodds.com/blog/unit-vs-integration-vs-e2e-tests — Kent C. Dodds, testing trophy
- [R125] https://www.sciencedirect.com/science/article/pii/S0164121223001929 — Rocha et al., "Snapshot testing in practice" (JSS 2023; retrieved by run-2 challenger)
- [R126] https://arxiv.org/abs/2507.10062 — LLMShot (snapshot false positives up to 8.2% of commits; retrieved by run-2 challenger)
- [R127] https://zhiminzhan.medium.com/record-playback-in-test-automation-is-bad-mostly-7f2799db71a — "Record/Playback in Test Automation is Bad, mostly" (retrieved by run-2 challenger)

## Process Appendix

### Triage

- Tier: DEEP (explicit deep-research request; output shapes a new skill's design)
- Source mode: hybrid (web-dominant; local context = existing csm skill-suite conventions)
- Tracks and outcomes:
  1. characterization-core (golden master/approval/snapshot) — 27 claims, 16 sources
  2. prop-diff-testing (properties, differential, metamorphic) — 27 claims, 15 sources
  3. record-replay-contracts (VCR/cassettes/contracts/browser capture) — 20 claims, 15 sources
  4. selection-validation (targets, mutation, CI review) — 21 claims, 14 sources
  5. agentic-design (LLM test-gen, in-the-wild skills, skill format) — 19 claims, 24 sources
- Empty tracks: none. Unverified gaps carried to Unverified Claims (U1-U12).

### Extension-run triage (run 2)

- Tier: STANDARD (additive extension; user asked to add UI and workflow test discovery/authoring)
- Source mode: hybrid (web-dominant)
- Tracks and outcomes:
  1. ui-test-discovery (codegen/record-replay, authoring resilience, snapshot forms, component tests) — 38 findings, 12 sources
  2. workflow-test-discovery (journey discovery, authoring patterns, workflow engines, maintainability) — 27 findings, 10 usable sources (2 404s noted)
  3. ui-continuity-validation (flakiness, review discipline, mutation at UI level, E2E coverage, AI authoring) — 25 claims, ~16 sources
- Gaps carried to Unverified Claims (U15-U23). One challenger dispatched on the new K14-K20 (see run-2 challenger verdicts).

### Expert reports

Summarized in Detail Sections D1-D6 (per-track evidence integrated, not concatenated). Full per-claim evidence packs held in temp dir during run; deleted at SAVED.

### Challenger verdicts

Independent challenger (anti-anchored; never saw author reasoning). All 13 citations re-located via fetch on 2026-08-20; all URLs resolved, quoted text matched verbatim.- K1: **uphold** — quotes verbatim; "coined by Feathers" corroborated by Savoia's Artima post independently.
- K2: **uphold** — all five quotes verbatim; "canonical" fair (Feathers' algorithm via Savoia).
- K3: **uphold** — all quotes verbatim; DI-over-regex rests on a low-authority blog but independently corroborated by Jest/CodeWhisperer/Playwright guidance.
- K4: **uphold** — all quotes verbatim; "prefer text surfaces" matches Bache's stated practice (she converts non-text output to text before diffing).
- K5: **uphold (caveats)** — figure used faithfully as "Google found"; caveat: self-reported, single-org, tests a coupling hypothesis; claim conflates "equivalent" vs "unproductive" mutants (distinct problems).
- K6: **uphold (note)** — Jest docs say snapshots are "not automatically written on CI without --updateSnapshot" rather than "fails" — compressed but faithful; "non-negotiable" corroborated by high-authority sources.
- K7: **uphold (note)** — "documented on-ramp for legacy code" is interpretive gloss; not contradicted.
- K8: **uphold** — MT source confirms MRs "must involve multiple executions"; "such as round-trips" consistent.
- K9: **uphold (note)** — Polly.JS named but uncited in claim (fixed: R37 in section D4).
- K10: **uphold** — Pact/Dredd verbatim; "weaker" framing is fair synthesis.
- K11: **downgrade** — "without such loops" inaccurate (SWE-Agent+ includes an execution loop; Pass@5 uses oracle selection); SWT-Bench figures are for SWT-Bench-Lite (276 issues, full = 1,983); "multi-agent verification" uncited; TestPilot claim is about coverage, not "bootstrap characterization". Corrected claim applied.
- K12: **downgrade** — "established pattern" overstated (three low-adoption repos); claim fused two conflicting post-refactor framings (replace vs retain); "open gap" inference from curated registry does not follow. Corrected claim applied.
- K13: **downgrade** — "sandboxed execution of generated tests (Docker guardrails)" and "explicit human-approval gates" not supported by cited quotes (AutoDev is a framework, not skill guidance; no quote supports approval gates). Corrected claim applied.

### Dissents recorded verbatim (from challenger)

- Kent C. Dodds, "Effective Snapshot Testing" [R85]: "They are tests you don't understand, so when they fail, you don't usually understand why or how to fix it"; "developers tend to be undisciplined about scrutinizing generated files"; high false-negatives "quickly erode the team's trust" — counter-evidence to naive snapshot enthusiasm; supports K6 (review discipline) and K3 (approval target too broad: "see if you can actually change it from a snapshot to a more explicit assertion").
- Google ToT, "Change-Detector Tests Considered Harmful" [R57]: characterization-as-pure-change-detection tension — Google calls change detectors negative value; resolved in this finding by requiring review + verification of every golden change.
- Nicolas Carlo, "Regression vs Characterization vs Approval Tests" [R86]: "no recognized standard," "most people seem to be using 'Regression Tests'" — weakens "established pattern" framing (K12); corroborates K1 (all names, same technique) and K3 (snapshots "generally misused").
- Challenger extra observations: SWT-Bench-Lite fidelity (added); jqwik user guide has an "Anti-AI Usage Clause" (U14); uncited elements inside claims (Polly.JS K9, mutmut K5, multi-agent verification K11, human-approval gates K13) — all resolved in remediation.

### Resolution log

| Claim | Verdict | Resolution | Applied by |
|---|---|---|---|
| K11 | downgrade | Replaced with challenger's corrected claim; SWT-Bench-Lite stated; execution-loop framing fixed; "multi-agent verification" now cited to [R75] in D5; TestPilot phrased as coverage finding | primary |
| K12 | downgrade | Replaced with corrected claim: characterize-before-change workflow stated, replace-vs-retain divergence made explicit, open-gap claim weakened and deferred to U9; D6 and U9 updated | primary |
| K13 | downgrade | Replaced with corrected claim: unsupported elements demoted to U13; D6 pipeline diagram retains approval-gate step as industry practice (cited to R8/R12/R45), not as skill-design quote | primary |
| K5 | caveat | Equivalent-vs-unproductive distinction now explicit in K5 and D2; mutmut cited [R54] in D2 | primary |
| K9 | note | Polly.JS citation [R37] present in D4 text | primary |
| All upheld | — | No edits required | — |

Re-verification note: K5 text already carries [R54] via D2 ("Mutmut's workflow... [R54]"); K5 claim itself now reads "equivalent and 'unproductive' mutants" (fixed in remediation edit).

### Extension-run challenger verdicts (run 2)

Independent challenger on K14-K20 (anti-anchored; quotes/URLs only). All citations re-located via live fetch on 2026-08-20; no 404s.

- K14: **uphold** — all six quotes verified; "draft to be hardened" is a faithful reading of "inspect and manually improve"; dissent noted: record-and-replay output is brittle by nature [R125][R126][R127].
- K15: **uphold (scope caveat)** — "clean up before, not after" is Cypress-design-specific (Playwright uses fixture teardown); claim corrected to attribute the rule to Cypress.
- K16: **uphold** — "stable across rendering" is a well-supported gloss of "page structure remains consistent"; claims' caveats already correct.
- K17: **downgrade** — "read routes/controllers to enumerate journeys" repurposed the Fowler quote (whose point is writing MockMVC-style tests); "analytics triggers" lacked a supporting quote; Fullstory is a vendor page (now disclosed). Corrected claim applied.
- K18: **uphold** — all quotes verbatim; caveat carried: replay is a determinism/compatibility gate, not functional-correctness, and needs production history access.
- K19: **downgrade** — Google's 1.5%/16%/84% are corpus-wide, not E2E-tier (author: "some skew toward UI testing... not quantified"); Testing Trophy lacked citation ([R124] attached); "10 E2E tests" heuristic is from the post's comments; 70/20/10 is "as a good first guess". Corrected claim applied.
- K20: **downgrade** — 14.41% (WebArena) and 88.2 (Online-Mind2Web) are incomparable benchmarks; "still below human on hard benchmarks" unsupported by cited sources. Corrected claim applied (separate datapoints; below-human only where baselines exist).

### Run-2 dissents recorded (from run-2 challenger)

- Rocha et al., JSS 2023: snapshots "may swiftly become fragile if used improperly" [R125].
- LLMShot (arXiv 2507.10062): traditional snapshot tests "suffer from false positives or intentional UI modifications flagged as failures, accounting for up to 8.2% of commits" [R126].
- Zhimin Zhan, "Record/Playback in Test Automation is Bad, mostly": record-and-playback output is brittle/flaky [R127].
- Google flaky-tests author (comment thread): "some skew toward UI testing... although I have not quantified this" [R115].
- Cypress lists "Sharing page objects" as an anti-pattern — any downstream Page Object Model guidance must note the tool divergence [R97][R98].

### Run-2 resolution log

| Claim | Verdict | Resolution | Applied by |
|---|---|---|---|
| K14 | uphold | No edit; brittleness dissent absorbed into D7 discovery paragraph [R125][R126][R127] | primary |
| K15 | uphold+caveat | "before (never after)" re-attributed as Cypress's documented rule | primary |
| K16 | uphold | No edit | primary |
| K17 | downgrade | Routes claim replaced with controller-integration-test framing; analytics now supported by [R107]; Fullstory disclosed as vendor source | primary |
| K18 | uphold | Caveat (compatibility gate, production-history access) added to claim | primary |
| K19 | downgrade | Corpus-wide attribution; [R124] attached; comment-thread provenance noted; "first guess" framing retained | primary |
| K20 | downgrade | Incomparable-benchmark framing removed; below-human qualified to "where baselines exist"; author-reported labels kept | primary |

### Judge scores

Independent judge subagent (whole-document level; reasoning-before-verdict; never saw author rationale). Verdict: PASS.

- factual-accuracy: 0.95 — 12+ spot-checks against sources all verbatim/faithful; no overstatement found
- citation-accuracy: 0.85 — skeleton exact (format marker + H1 + 8 H2s in order); no dangling [Rn]; flagged 12 uncited references and K6 "fails on CI" compression → all fixed at VERIFY
- completeness: 0.95 — all sections present and non-empty; verdicts use required vocabulary; Unverified Claims substantive (14 items with verify actions)
- clarity: 0.90 — legible standalone; five ASCII diagrams earn their place; Recommendation actionable and decisive

Judge-flagged issues: (1) 12 uncited reference entries — resolved by adding inline citations R7/R9/R14/R15/R18/R23/R33/R51/R59/R64/R65/R71 and attaching [R22][R23] to K7; (2) fast-check named without [R23] — fixed; (3) K6 "fails on CI" wording — aligned to docs phrasing; (4) resolution-log editorial fragment — cleaned; (5) Judge scores placeholder — filled here.

### Control Journal

[2026-08-20T00:00Z] INTAKE -> TRIAGE :: cycle 1 :: trigger: fresh run; temp dir /tmp/csm-deep-research-REvibQ; baseline: clean git tree at /home/jamiemills/.config/opencode/skills
[2026-08-20T00:05Z] TRIAGE -> RESEARCH :: cycle 1 :: trigger: DEEP/hybrid classified; 5 tracks defined
[2026-08-20T00:35Z] RESEARCH complete :: cycle 1 :: 5/5 researcher packs returned (characterization-core 27 claims; prop-diff-testing 27; record-replay-contracts 20; selection-validation 21; agentic-design 19)
[2026-08-20T00:36Z] RESEARCH -> SYNTHESIZE :: cycle 1 :: trigger: evidence packs assembled
[2026-08-20T00:55Z] SYNTHESIZE complete :: cycle 1 :: draft with 13 key findings, 6 detail sections, 84 references, 12 unverified claims
[2026-08-20T00:56Z] SYNTHESIZE -> CHALLENGE :: cycle 1 :: trigger: draft complete; challenger view built at /tmp/csm-deep-research-REvibQ/challenger-view.md
[2026-08-20T01:20Z] CHALLENGE complete :: cycle 1 :: 10 uphold, 3 downgrade (K11, K12, K13); dissents: Kent C. Dodds effective-snapshot-testing, Google change-detector ToT (already R57), understandlegacycode regression-vs-characterization
[2026-08-20T01:21Z] CHALLENGE -> REMEDIATE :: cycle 1 :: trigger: downgrade verdicts on K11/K12/K13; primary applies challenger-corrected claims; adds R85/R86, SWT-Bench-Lite fidelity, jqwik anti-AI caveat
[2026-08-20T01:40Z] REMEDIATE complete :: cycle 1 :: K11/K12/K13 corrected; K5 equivalent-vs-unproductive clarified; U9/U13/U14 added; R85/R86 added; resolution log filled
[2026-08-20T01:41Z] REMEDIATE -> JUDGE :: cycle 1 :: trigger: all downgrades resolved; judge dispatched on full draft
[2026-08-20T02:05Z] JUDGE complete :: cycle 1 :: PASS (0.95/0.85/0.95/0.90); 5 flagged items (uncited refs, K6 wording, log fragment, placeholder)
[2026-08-20T02:06Z] JUDGE -> VERIFY :: cycle 1 :: trigger: pass; primary applies judge-flagged citation fixes during verification
[2026-08-20T02:15Z] VERIFY complete :: cycle 1 :: skeleton exact (marker + H1 + 8 H2s); 86/86 citations resolve (no dangling, none uncited); protected-state re-run clean (only research doc present); redaction scan clean; zero distinct gate failures
[2026-08-20T02:16Z] VERIFY -> SAVED :: cycle 1 :: trigger: all gates pass
[2026-08-20T02:20Z] EXTENSION RUN (run 2, STANDARD/hybrid, 3 tracks: ui-test-discovery, workflow-test-discovery, ui-continuity-validation) :: temp dir /tmp/csm-deep-research-l3rhz8; baseline: prior run's research doc untracked, nothing else; user request: "add to this: how to discover and author UI and workflow tests"
[2026-08-20T02:21Z] run2 TRIAGE -> RESEARCH :: cycle 1 :: trigger: STANDARD classified; 3 tracks dispatched
[2026-08-20T02:50Z] run2 RESEARCH complete :: cycle 1 :: 3/3 packs returned (ui-test-discovery 38 findings; workflow-test-discovery ~27 findings; ui-continuity-validation ~25 claims)
[2026-08-20T02:51Z] run2 RESEARCH -> SYNTHESIZE :: cycle 1 :: trigger: extension evidence assembled; primary integrates into existing finding
[2026-08-20T03:05Z] run2 SYNTHESIZE complete :: cycle 1 :: K14-K20 added; D7-D9 added; R87-R124 added; U15-U23 added; TL;DR/ExecSum/Recommendation extended
[2026-08-20T03:06Z] run2 SYNTHESIZE -> CHALLENGE :: cycle 1 :: trigger: extension draft complete; challenger view at /tmp/csm-deep-research-l3rhz8/challenger-view-run2.md
[2026-08-20T03:30Z] run2 CHALLENGE complete :: cycle 1 :: 4 uphold (K14/K15/K16/K18), 3 downgrade (K17/K19/K20); dissents: JSS-2023 snapshots, LLMShot, record/playback critique, Google UI-skew disclaimer
[2026-08-20T03:31Z] run2 CHALLENGE -> REMEDIATE :: cycle 1 :: trigger: downgrades; primary applies corrected claims; R125-R127 added; appendix updated
[2026-08-20T03:40Z] run2 REMEDIATE complete :: cycle 1 :: K17/K19/K20 corrected; K15 rule re-attributed; run-2 verdicts/dissents/resolution log recorded
[2026-08-20T03:41Z] run2 REMEDIATE -> VERIFY :: cycle 1 :: trigger: all run-2 downgrades resolved; primary-personal verification (STANDARD-scaled: challenger-flagged + conclusion claims re-checked)
[2026-08-20T03:45Z] run2 VERIFY complete :: cycle 1 :: 127/127 citations resolve (none dangling, none uncited); skeleton intact (marker + H1 + 8 H2s); redaction clean; zero gate failures. NOTE: .agents/research/2026-08-20-llm-wiki-research.md appeared during run 2 — concurrent session artifact, not this run's write; surfaced, not touched
[2026-08-20T03:46Z] run2 VERIFY -> SAVED :: cycle 1 :: trigger: all gates pass
