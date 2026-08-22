# Mutation Gates

Scoped mutation spot-checks prove a captured suite detects faults: coverage without
kill-evidence is not protection. Run the stack's tool scoped to characterized modules
only, parse the machine-readable survivor list, triage survivors, record per-module
scores in the ledger.

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Quick Table

```text
tool            run command                                gate
mutmut          mutmut run "pkg.module*"                   score via exported badge JSON
StrykerJS       npx stryker run                            thresholds.break -> exit 1
pitest          mvn org.pitest:pitest-maven:mutationCoverage  mutationThreshold fails build
cargo-mutants   cargo mutants -f src/foo.rs                exit code 2 on uncaught
```

## Python — mutmut

```bash
mutmut run                      # whole project
mutmut run "pkg.module*"        # wildcard scope to characterized modules
```

- Incremental cache lives in `mutants/` (gitignore it); reruns only affected mutants.
- `mutmut browse` TUI inspects survivors; `mutmut apply <mutant>` reproduces one in
  the working tree for study.
- Config knobs: `source_paths`, `also_copy`, `mutate_only_covered_lines=true`
  (never mutate lines coverage never reaches), plus `only_mutate`/`do_not_mutate`
  globs.
- Pragmas: `# pragma: no mutate` excludes one line.
- Score export: `mutmut export-cicd-stats`, then `mutmut badge --output
  mutation-score.json`.
- CAUTION: the CLI surface is version-dependent — the 3.x line rewrote its commands.
  Pin the version before scripting against any subcommand [K5].

## JavaScript/TypeScript — StrykerJS v10

```bash
npx stryker run
```

- Thresholds `{ high, low, break }`: mutation score below `break` exits 1 — the CI
  gate [K5]. Set `break` as the floor; `high`/`low` color the report only.
- `jsonReporter` writes `reports/mutation/mutation.json` conforming to the
  mutation-testing report schema; the survivor list is
  `MutantResult.status === "Survived"` — parse directly [K14].
- `--incremental` with `incrementalFile`: reruns only mutants affected by changes.
- Scoping: `mutate` accepts globs including line ranges (`"src/app.js:1-11"`) —
  restrict to characterized modules.
- `testFiles` limits which tests execute per mutant; keep the spot-check fast.
- Cost controls: `coverageAnalysis: "perTest"` (default) and `ignoreStatic` for
  static-mutation noise.
- Runners: cucumber/jasmine/jest/karma/mocha/tap/vitest. No Cypress or Playwright
  runner exists — E2E-layer mutation is impractical; do not attempt it [K24].

## JVM — pitest

```bash
mvn org.pitest:pitest-maven:mutationCoverage
```

- Scope: `targetClasses` / `targetTests` globs in the pom configuration.
- Gates: `mutationThreshold` and `testStrengthThreshold` fail the build below their
  floors [K13].
- Output: `outputFormats` = XML/CSV (plus HTML default) under the pit reports dir;
  locate reports by glob — never hardcode `mutations.xml` (see
  `references/known-uncertainties.md`).
- Incremental: `withHistory`; setup validation: `dryRun`; cost cap:
  `+CLASSLIMIT(limit[n])` bounds classes mutated per invocation.

## Rust — cargo-mutants

```bash
cargo mutants                       # full tree
cargo mutants -f src/foo.rs         # single-file include (-f/-e glob pairs)
cargo mutants --re order --exclude-re generated   # regex include/exclude
cargo mutants --in-diff pr.diff     # PR-scoped run over changed lines only
cargo mutants --jobs 2              # start at -j2..-j3; --shard k/n splits across CI
```

- Skip annotation: `#[mutants::skip]` on functions where mutation is unproductive.
- Exit codes are documented and stable surface for gating [K14]:
  `0` all caught · `1` usage error · `2` uncovered mutants · `3` timeouts ·
  `4` baseline failing · `5`/`6` bad `--in-diff` input · `70` internal error.
- Artifacts land in `mutants.out/`: `mutants.json`, `outcomes.json`, `caught.txt`,
  `missed.txt`, timeout/unviable lists, logs. The format is officially subject to
  change — pin the crate version and re-read outputs each run instead of assuming a
  schema [K14].
- CI recipe: baseline must pass first (exit 4 otherwise), then treat exit 2 as the
  protection signal.

## Survivor Triage Protocol

Every survivor goes through exactly one of two doors (SKILL.md VERIFY step 2):

1. **Equivalent/unproductive** — the mutant is behavior-preserving or meaningless
   (refactor-equivalent rewrite, logging tweak, defensive branch). Document it in the
   ledger with a reason and EXCLUDE from score pressure; never contort production
   code or add junk assertions just to kill it.
2. **Real gap** — the mutant survived because inputs or assertions are too weak.
   Return to CAPTURE with targeted inputs aimed at that mutant's behavior,
   re-capture, re-run the gate.

Ledger output per module: tool + version, scope expression, score, survivor count by
triage class, and follow-up items for real gaps.
