# csm-ddd Validation Notes (2026-08-23)

Run evidence for plan task T008 (plan ID: csm-ddd-skill-build).

## Runs

| Target | Artifacts | Result |
| ------ | --------- | ------ |
| this repository | `.agents/ddd/2026-08-23-opencode-skills-ddd-report.md` + `-graph.json` | exit 0; graph schema-valid via `validate.mjs graph`; report references the same runId |
| synthetic modular fixture (`src/orders` + `src/billing`, cross-import) | `.agents/ddd/2026-08-23-modular-fixture-ddd-report.md` + `-graph.json` | exit 0; two capabilities, one upstream-downstream edge, seam on `placeOrder`, 2 gaps disclosed |
| synthetic tangled fixture (duplicate `shared`/`handleB` across root files) | `.agents/ddd/2026-08-23-tangled-fixture-ddd-report.md` + `-graph.json` | exit 0; duplicate-name terms inventoried; no fabricated structure |

## Observations

- This repository yields no code-directory capability clusters because its units are
  markdown skill contracts, not code modules — the analyzer reports that honestly
  instead of inventing contexts. Co-change coupling from bounded git history is the
  strongest signal here (skill SKILL.md pairs changing together 13-15 times).
- Modular fixture: `billing -> orders` import produces one relationship edge and one
  seam (exported `placeOrder` with an observable consumer); ordering ranks it first.
- Tangled fixture: same-named exports in different files are inventoried as terms;
  without directory clusters the analyzer emits no context hypotheses rather than
  asserting false boundaries.

## Adjacency comparison (evidence-backed, no responsibility merging)

- vs `csm-scan`: scan owns broad static inventory and NORMS.md production (17
  dimensions); csm-ddd consumes only a *visible* NORMS.md as untrusted input and owns
  capability/language/context/seam synthesis. No detector reuse; basis vocabulary was
  copied per plan A4, never imported.
- vs `csm-review` / `csm-review-python`: those assess defects/risks/doctrine against
  quality dimensions; csm-ddd reconstructs domain structure and refactoring seams and
  produces hypotheses, not findings or fix guides.
- vs `csm-bdd-tdd` / `csm-make-tests`: those consume a saved plan / target repo to
  produce specs or executable tests; csm-ddd stops at candidate slices + recommended
  ordering and generates no tasks, tests, or code changes.
- Handoff stays human-mediated: nothing auto-invokes csm-grill/csm-plan/csm-build.

## Protected-state verification

Before/after comparison of the working tree shows new writes limited to
`.agents/ddd/**` (owned artifact paths) plus this build's own source tree
(`csm-ddd/**`, registry/payload files). Target fixtures under `/tmp/opencode/**`
received no analyzer writes beyond their requested output paths inside `.agents/ddd/`
of THIS repo. Fixture redaction bait (a fake `sk-` token, a `/home/...` absolute path, and a
plaintext email) does not appear in any artifact (asserted by tests; re-checked by
grep for those three literal patterns below).

## Privacy spot-check

`grep -rE` over `.agents/ddd/` for the three planted bait literals → no matches outside
this notes file's description of them.
