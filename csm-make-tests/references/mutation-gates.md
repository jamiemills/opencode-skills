# Mutation Gates

Scoped mutation spot-checks prove a captured suite detects faults: coverage without
kill-evidence is not protection. Run the stack's tool scoped to characterized modules
only, parse the machine-readable survivor list, triage survivors, record per-module
scores in the ledger.

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Quick Table

```text
stack   tool           run command                                   gate
Go      go-mutesting / gremlins        (see Go section; runtime-guard)   guard-gated
Rust    cargo-mutants  cargo mutants -f src/foo.rs                   exit 2 on uncaught
Python  mutmut         mutmut run "pkg.module*"                      exported score JSON
Python  cosmic-ray     cosmic-ray run session.toml (alt; ungrounded) guard-gated
JVM     pitest         mvn org.pitest:pitest-maven:mutationCoverage  threshold fails build
JS/TS   StrykerJS      npx stryker run --incremental                 thresholds.break -> exit 1
.NET    Stryker.NET    dotnet stryker (runtime-guard)                guard-gated
```

## Python — mutmut

```bash
mutmut run                      # whole project
mutmut run "pkg.module*"        # wildcard scope to characterized modules
```

- Incremental cache in `mutants/` (gitignore it); reruns only affected mutants.
- `mutmut browse` TUI inspects survivors; `mutmut apply <mutant>` reproduces one in
  the working tree for study.
- Cost knobs: `mutate_only_covered_lines=true` (never mutate lines coverage never
  reaches), `only_mutate`/`do_not_mutate` globs, `# pragma: no mutate`.
- Gate + survivor output: `mutmut export-cicd-stats` then `mutmut badge --output
  mutation-score.json` — gate on the exported score, not a documented exit code [K5].
- CAUTION: the CLI surface is version-dependent — 3.x rewrote its commands. Pin the
  version before scripting any subcommand [K5]. Alternative: cosmic-ray (session-file
  driver); not covered by the committed finding — verify its CLI before use.

## JavaScript/TypeScript — StrykerJS v10

```bash
npx stryker run
```

- Gate: thresholds `{ high, low, break }` — score below `break` exits 1 [K5]; `break`
  is the CI floor, `high`/`low` color the report only.
- Survivor parsing: `jsonReporter` writes `reports/mutation/mutation.json` per the
  mutation-testing report schema; filter `MutantResult.status === "Survived"`
  directly [K14].
- Scoping: `mutate` globs including line ranges (`"src/app.js:1-11"`) restrict to
  characterized modules; `testFiles` limits which tests run per mutant.
- Cost: `--incremental` + `incrementalFile`, `coverageAnalysis: "perTest"` (default),
  `ignoreStatic`.
- Runners: cucumber/jasmine/jest/karma/mocha/tap/vitest — no Cypress/Playwright
  runner exists; E2E-layer mutation is impractical [K24].

## JVM — pitest

```bash
mvn org.pitest:pitest-maven:mutationCoverage
```

- Gate: `mutationThreshold` / `testStrengthThreshold` fail the build below their
  floors (non-zero Maven exit) [K5].
- Scope: `targetClasses` / `targetTests` globs in the pom configuration.
- Survivor parsing: `outputFormats` XML/CSV under the pit reports dir — locate reports
  by glob `target/pit-reports/**/*.{xml,csv}`; never hardcode `mutations.xml` (see
  `references/known-uncertainties.md`).
- Cost: `withHistory` incremental, `dryRun` setup check, `+CLASSLIMIT(limit[n])`.

## Rust — cargo-mutants

```bash
cargo mutants                       # full tree
cargo mutants -f src/foo.rs         # single-file include (-f/-e glob pairs)
cargo mutants --re order --exclude-re generated   # regex include/exclude
cargo mutants --in-diff pr.diff     # PR-scoped run over changed lines only
cargo mutants --jobs 2              # start -j2..-j3; --shard k/n splits across CI
```

- Exit codes are the documented gate surface [K14]: `0` all caught · `1` usage error
  · `2` uncovered (surviving) mutants · `3` timeouts · `4` baseline failing · `5`/`6`
  bad `--in-diff` input · `70` internal error.
- Survivor parsing: `mutants.out/` — `mutants.json`, `outcomes.json`, `caught.txt`,
  `missed.txt`, timeout/unviable lists, logs. Format officially subject to change —
  pin the crate version and re-read outputs each run [K14]. `--json` exists only with
  `--list`.
- Skip annotation: `#[mutants::skip]` where mutation is unproductive.
- CI recipe: baseline green first (exit 4 otherwise); exit 2 is the protection signal.

## Go — go-mutesting / gremlins

Not covered by the committed research finding — treat as a runtime-verified surface:
install, run `<tool> --help`, and script only against flags/exit codes the installed
binary actually reports (residual-uncertainty guard pattern).

```bash
go install github.com/go-gremlins/gremlins/cmd/gremlins@latest
gremlins run ./...                  # maintained option; confirm scope flags via --help
```

- go-mutesting (zimmski) is the older research tool; it drives `go test` per mutant
  and reports survivors on stdout — parse its output defensively, never by assumed
  format.
- Whatever the tool: gate on "zero untriaged survivors", parse the machine-readable
  report if one is emitted, and record tool + version + scope in the ledger. If no
  reliable machine-readable output exists, fall back to hand mutation spot-checks
  (2–3 deliberate mutations must be caught) and say so in the report [K6].

## .NET — Stryker.NET

Not detailed in the committed research finding — same runtime-guard rule applies:
confirm the installed CLI's flags, threshold names, and report paths before scripting.

```bash
dotnet tool install -g dotnet-stryker
dotnet stryker                      # scope via config/flags confirmed via --help
```

- Stryker.NET follows the Stryker family's threshold model (`high`/`low`/`break`);
  verify the exact option names on the installed version before wiring a gate.
- Prefer the JSON reporter and filter `status === "Survived"` entries, mirroring the
  StrykerJS schema parse [K14]; validate fields before trusting survivor lists.
- Record tool + version + scope + score per module in the ledger like any other stack.

## Scoped Spot-Check Recipe

VERIFY steps 1–4, concretely:

1. Confirm the new suite is green against unchanged code first — mutation results on
   a red baseline are meaningless (cargo-mutants exit 4 encodes exactly this).
2. Pick the characterized modules only (CAPTURE output), never the whole tree.
3. Express the scope in the stack's native form: mutmut wildcard, Stryker `mutate`
   globs/ranges, pitest `targetClasses`, cargo-mutants `-f`/`--re`/`--in-diff`.
4. Run the tool; apply the pitest glob guard from `references/known-uncertainties.md`.
5. Parse the machine-readable survivor list (per-stack section above).
6. Triage every survivor (protocol below); document equivalent/unproductive, cycle
   real gaps back to CAPTURE for targeted inputs on the affected modules only.
7. Re-run the gate after gap-filling until only documented survivors remain.
8. Record per-module scores in the ledger — the protection metric, not coverage %.

## Survivor Triage Workflow

Every survivor goes through exactly one of two doors (SKILL.md VERIFY step 3):

1. **Equivalent/unproductive** — behavior-preserving or meaningless mutant
   (refactor-equivalent rewrite, logging tweak, defensive branch). Document it in the
   ledger with a reason and exclude it from score pressure; never contort production
   code or add junk assertions just to kill it.
2. **Real gap** — the mutant survived because inputs or assertions are too weak.
   Return to CAPTURE with targeted inputs aimed at that mutant's behavior, re-capture,
   re-run the gate (cycle rules: only the artifact that triggered the back-edge is
   regenerated; approved goldens stay locked).

Ledger row per module: tool + version, scope expression, score, survivor count by
triage class, and follow-up items for real gaps.
