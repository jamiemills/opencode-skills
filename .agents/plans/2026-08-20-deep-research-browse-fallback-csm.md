format: csm-plan/1
# csm-deep-research csm-browse Fallback CSM Plan

## How To Execute
- Start work only through a separate, explicit csm-build invocation naming this plan; the planning session must not begin execution.
- Commit policy and live state are maintained in Control by csm-build.
- Risk summary: 5 tasks — 2 low, 2 standard, 1 low-final. No high-risk tasks. Task T001 (SKILL.md prose + new section) and T002 (contracts matrix) are the only behavior-defining edits; both are revertible single-file changes.

## Control
- Plan ID: deep-research-browse-fallback
- Status: ready
- Current CSM state: NOT_STARTED
- Cycle: 0
- Commits: allowed
- Last checkpoint: 2026-08-20 planning complete; plan saved
- Last model/run: deepseek-v4-flash / csm-plan run
- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER
- Active tasks: none
- Blockers: none
- Resume: re-read Last checkpoint, latest journal row, Recovery notes of all non-COMPLETE tasks, Discovered Requirements, and the working-tree diff

## Goal
Modify the `csm-deep-research` skill so that when a research source page cannot be retrieved as rendered content by the ordinary retrieval tools (webfetch / docs-search MCPs) — i.e. the site is JavaScript-only — the run may fall back to the `csm-browse` skill (isolated headful Chromium in the `chromium-vnc` Docker container via CDP) to open the URL and extract the rendered text/DOM as retrieval evidence. Constraints: the fallback must be primary-orchestrated, restricted to read-only retrieval verbs, gated to web/hybrid source modes, never touch credentials or submit forms, never write into the researched repository or the run's temp dir beyond captured evidence, close its browser session before SAVED, and keep every gate in the repo green (conformance suite, lint, payload drift, README matrix drift, gate baseline). Exclusions: no changes to csm-browse's own skill or code; no changes to the research document format, the state machine, or the researcher subagent model; no new skills.

## Acceptance Criteria
1. `csm-deep-research/SKILL.md` documents the browser-retrieval fallback: a top-level `## Browser Retrieval Fallback` section that states the trigger condition (JS-only / unfetchable pages), the primary-orchestrated retrieval procedure (csm-browse read-only verbs), the evidence shape (URL + retrieval date + "retrieved via headful browser (csm-browse)" method note), and the cleanup rule (session closed before SAVED). Evidence: the section exists; grep confirms the required phrases.
2. The never-invoke contract is updated coherently: `NEVER_INVOKE['csm-deep-research']['csm-browse']` is `false` in `scripts/lib/contracts.mjs`, and the skill's Interface "Never invokes:" line lists exactly `csm-bdd-tdd, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload` (7 names, no csm-browse). Evidence: `node scripts/check-suite.mjs` passes the never-invokes check for csm-deep-research.
3. Fallback guardrails are explicit in the skill: read-only verbs only (`open, wait, wait-selector, text, html, eval` (read-only expressions), `screenshot`, `status`, `close`); no `click`/`type`/`press`/login/credentials; never target port 9222; allowed only in `web`/`hybrid` source modes, never `local`; browser session id follows `^[a-z0-9][a-z0-9_-]{0,40}$`; if Docker/chromium-vnc is unavailable, the source is recorded unverified (never auto-pulls images). Evidence: grep of the new section for each guardrail phrase.
4. Frontmatter description is reworded to reflect the fallback and stays within policy: total across all 9 skill descriptions <= 220 tokens using the gate's tokenization (`desc.trim().split(/\s+/).filter(Boolean)`), no volatile tokens per `VOLATILE_DESC_RE`, `NEVER_CLAUSE_RE` still matches, `desc.length <= 1024`. Evidence: a read-only node one-liner reproducing the gate's checks reports PASS.
5. All repo gates pass: `pnpm exec oxlint --deny-warnings` clean; `node scripts/check-suite.mjs` reports `OK — 9 skills, <N> checks` with `payload drift: {compared:119, issues:[]}` and no README/boilerplate drift; `node scripts/gen-readme-matrix.mjs` (check form) exits 0; targeted tests (`node --test tests/check-suite.test.mjs tests/package-audit.test.mjs tests/protocol/protocol.test.mjs tests/integration/bootstrap-flow.test.mjs`) pass; gate baseline verified (check count is expected to stay 654 — no new `check()` calls are added by this work; if it deviates, re-record). Evidence: recorded command outputs.
6. Bootstrap payload is byte-identical to repo-root sources after regeneration (pack-bootstrap mapping covers `payload/skills/csm-deep-research/SKILL.md`). Evidence: `node scripts/check-suite.mjs` payload drift reports `issues:[]` (compared count 119 — content edits add no files, so the count does not increase).

## Current-State Evidence
- `csm-deep-research/SKILL.md` L25: `- Never invokes: csm-bdd-tdd, csm-browse, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload` — csm-browse must drop; gate validates exact set-equality against `NEVER_INVOKE[skill]` (check-suite.mjs ~L703-716).
- `scripts/lib/contracts.mjs` L182: `'csm-deep-research': { 'csm-bdd-tdd': true, 'csm-browse': true, ... }` — the row to flip.
- SKILL.md standalone claims to reconcile: L12 ("hands off to no other skill"), L24 ("this skill never invokes them"), L62 ("never invoke other skills"), L337 ("Standalone boundary is held"), L71 ("Nothing else may be written ... on the host"), L53 (facts-from-tools list), L101 (per-mode retrieval constraint), L156 (researcher tool-use line).
- Gate constraints verified: new top-level H2 allowed anywhere after the `Research State Machine` section's chain (machine verifier: no orphan H3s outside chain tokens; `entryExit:false`); unnumbered H3s are invisible to `STATE_HEADING_RE`; MANIFEST is required-includes only; Interface must keep exactly 4 labeled bullets and the artifact path `.agents/research/<yyyy-mm-dd>-<slug>-research.md`; payload drift, README-matrix drift, and boilerplate drift are hard gate failures (part of the 654 checks today).
- `scripts/lib/boilerplate.mjs` owns `Tmux Session Bootstrap` + `Subagent Resilience` sections (byte-match enforced) — do NOT edit them.
- csm-browse mechanics verified (read-only): `open` prints JSON `{"url","title"}`, waits only for `readyState==='complete'` (no network-idle — must follow with `wait-selector` for SPAs); `text`/`html` print raw content to stdout; `screenshot` writes only inside the session's `artifacts/` (absolute paths rejected); sid regex `^[a-z0-9][a-z0-9_-]{0,40}$`; `ensure-browser` auto-creates the container (docker pull) if absent — the fallback must pre-check and refuse; sessions are swept after 10 min idle; `close` is idempotent.
- `.agents/token-efficiency.json` = `{"enabled": false}` — volatile/budget gate checks are skipped locally but the AGENTS.md policy budget (220 tokens) still applies and must be honored.
- `chromium-vnc` container is currently running on this host; `csm-browse/scripts/check-skill.mjs` passes.
- `node scripts/check-suite.mjs` today: `check-suite: OK — 9 skills, 654 checks`; payload drift `{compared:119, issues:[]}`; gate baseline recorded in `.agents/docs/gate-baselines.json` (pre-commit `record-gate-baseline.mjs --check` compares counts).

## Assumptions And Decisions
| ID | Statement | Type | Evidence or rationale | Status |
|---|---|---|---|---|
| A1 | Fallback is primary-orchestrated only; researchers/challenger never run browser verbs directly (they mark a URL as needing browser retrieval). | decision | SKILL.md L52/L70 keep subagents read-only file-writers; browse evidence folds into the evidence pack by the primary | accepted |
| A2 | Fallback allowed only in `web` and `hybrid` source modes; never in `local`. | decision | mirrors the existing "local-only runs never call webfetch" rule (L101) | accepted |
| A3 | Read-only verbs only; `click/type/press/screencast/cookies --values` excluded; `eval` restricted to read-only expressions (prefer `text`/`html`). | decision | track-B audit of verb mutability and credential exposure | accepted |
| A4 | If Docker or the chromium-vnc container is unavailable, do NOT run `ensure-browser` (it would pull images / mutate host); record the source unverified with a note. | decision | ensure-browser auto-creates container (mutating); research runs must not mutate the host beyond the declared allowlist | accepted |
| A5 | Description reword must hold the 220-token policy budget (net-zero or negative word delta) and stay volatile-free. | constraint | AGENTS.md frontmatter budget; gate enforces <=220 only when efficiency enabled, but repo policy commits `{"enabled": false}` and the budget still applies | accepted |
| A6 | Add the fallback to `INTERFACES['csm-deep-research'].consumes` (README matrix regenerated) and update the README edge-semantics prose sentence about sanctioned dispatch edges. | decision | accuracy of the generated composition matrix; README prose L~115 mentions "only sanctioned cross-skill dispatch edge" | accepted |
| A7 | No changes to csm-browse/SKILL.md, csm-browse code, other skills, or the research document format / state machine. | constraint | user scope + gate (no reverse-edge validation; browse imposes no caller restriction) | accepted |
| A8 | New `## Browser Retrieval Fallback` H2 placed after `## Subagent Resilience` (file end); unnumbered H3s only; no numbered H3s and no edits inside synced boilerplate sections. | decision | machine-verifier chain extraction (first backticked chain inside machine section) and ordinal validator; boilerplate drift gate | accepted |

## R&D Record
| ID | Question | Method/tool | Isolation and no-change evidence | Observation | Plan implication |
|---|---|---|---|---|---|
| R1 | What gate constraints apply to a new H2/H3 structure in csm-deep-research/SKILL.md? | read-only audit of check-suite.mjs verifyMachine, ordinal validator, interface-patterns validator; contracts.mjs | no writes; no repo change (654 checks still pass) | New H2 allowed after the machine section; unnumbered H3s invisible; MANIFEST is required-includes; Interface must keep 4 bullets + artifact path | A8; T001 placement/content rules |
| R2 | What happens on payload/README/boilerplate drift? | read-only audit of check-suite.mjs drift checks + pack-bootstrap.mjs main() + gen-readme-matrix.mjs argv | no writes | Hard gate failures; regen commands: `node scripts/pack-bootstrap.mjs` (no argv) and `node scripts/gen-readme-matrix.mjs --write`; boilerplate sections must not be edited | T003, T004; T001 must not touch synced sections |
| R3 | What is the exact read-only retrieval recipe and its failure modes? | read-only audit of csm-browse verb modules (nav/dom/capture/log), ensure-browser.mjs, e2e.mjs, constants.mjs | no session created; no container touched | open=JSON+readyState-only; text/html raw stdout; wait-selector for SPA; screenshot contained in session dir; sid regex; ensure-browser auto-creates container if absent; sweep 10 min idle; close idempotent | A3, A4; the "Minimal read-only retrieval recipe" in T001 section text |
| R4 | Does flipping the never-invoke row break any test? | read-only grep of tests/ for NEVER_INVOKE / never-invokes references | no writes | No test asserts the matrix content or README matrix text; only skill-name lists | T002 safe; T005 targeted tests confirm |

## Discovered Requirements
- `csm-deep-research/SKILL.md` "Never invokes:" line must be set-equality to `Object.keys(NEVER_INVOKE['csm-deep-research']).filter(nm => NEVER_INVOKE['csm-deep-research'][nm])` → exactly `csm-bdd-tdd, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload` (7 names, order-independent).
- Interface section must keep exactly 4 labeled bullets (Consumes/Produces/Hands off/Never invokes) and the exact artifact pattern `.agents/research/<yyyy-mm-dd>-<slug>-research.md`.
- Do not edit `## Tmux Session Bootstrap` or `## Subagent Resilience` bodies (synced from `scripts/lib/boilerplate.mjs`; drift is a hard gate failure).
- Do not add numbered (`### N. ...`) H3 headings in the new section (ordinal validator + machine orphan rules); unnumbered H3s are safe.
- The backticked chain `` `INTAKE -> TRIAGE -> ... -> STOP` `` must remain the FIRST backticked ALL-CAPS chain inside `## Research State Machine` — do not add chains before it.
- Payload drift: `bootstrap/package/payload/skills/csm-deep-research/SKILL.md` must be byte-identical to the repo-root file after regeneration.
- README matrix region (`<!-- csm-matrix:start -->`..`<!-- csm-matrix:end -->`) must match `renderMatrix()` from contracts.mjs after any INTERFACES change.
- Frontmatter description: keep a Never-X clause matching `NEVER_CLAUSE_RE`, `length <= 1024`, no volatile tokens, and hold the 220-token policy budget across all 9 descriptions.
- `ensure-browser.mjs` creates the container when absent (docker pull, network create) — never invoke it during a research fallback unless the container is already present; pre-check with `docker ps` / a read-only container inspect.
- Session id must match `^[a-z0-9][a-z0-9_-]{0,40}$` (e.g. `research-<goal-slug>` sanitized).
- Gate baseline: `.agents/docs/gate-baselines.json` — pre-commit `--check` compares check counts; re-record after the change if the count deviates.

## Design

Target behavior: `csm-deep-research` gains a single, narrow, primary-orchestrated retrieval fallback.

1. **Trigger**: a researcher (or the challenger re-locating a citation, per the T001 CHALLENGE-section edit) reports a source URL as JS-only / unrenderable / empty-shell via the ordinary retrieval tools (webfetch, docs-search MCPs). The researcher/challenger returns the URL flagged with the pinned convention `needs-browser-retrieval: <url>` appended to the claim instead of dropping it.
2. **Retrieval**: the primary loads the csm-browse skill and, per its SKILL.md, runs the read-only recipe:
   ```bash
   SKILL=$HOME/.config/opencode/skills/csm-browse
   SID=research-<slug>   # ^[a-z0-9][a-z0-9_-]{0,40}$
   node $SKILL/scripts/ensure-browser.mjs --session "$SID"      # only after a read-only container check passes
   node $SKILL/scripts/browse.mjs open --session "$SID" --url "<URL>"
   node $SKILL/scripts/browse.mjs wait-selector --session "$SID" "<content-selector>" 15000   # SPA render gate
   node $SKILL/scripts/browse.mjs text --session "$SID"         # raw rendered text to stdout
   # optional: html, screenshot --viewport (contained in session artifacts/), status
   node $SKILL/scripts/browse.mjs close --session "$SID"        # idempotent; also swept after 10 min idle
   ```
3. **Guardrails** (all written into the new section): read-only verbs only (`open, wait, wait-selector, text, html, eval` (read-only expressions), `screenshot`, `status`, `close`); never `click/type/press/screencast/cookies --values`; no credentials, logins, or form submission; never target port 9222; `web`/`hybrid` modes only; container absent -> record unverified, never auto-pull; browse session id recorded in the run's Control journal; session closed before SAVED; screenshots/console evidence copied into the run's temp dir before close, never into the repo.
4. **Evidence**: browsed content becomes standard evidence — claim carries the source URL, the retrieval date, and the method note "retrieved via headful browser (csm-browse)"; the browse session (sid, URL, closed-at) is journaled in the Control journal; if Docker/browser is unavailable, the claim is recorded in Unverified Claims with the exact verification step.
5. **Write discipline reconciliation**: the "Nothing else may be written ... on the host" rule gains the single declared exception: transient csm-browse session state under `$XDG_RUNTIME_DIR/csm-browse/<sid>` (or `~/.local/state/csm-browse/<sid>`), self-swept after 10 min idle and explicitly closed before SAVED; the protected-state baseline at VERIFY remains repo-scoped (browse writes are outside the repo).
6. **Contract/description updates**: never-invoke matrix row flips `csm-browse` to `false`; Interface line drops `csm-browse`; the description is reworded to hold the 220-token budget while stating the fallback; `INTERFACES['csm-deep-research'].consumes` gains the browser-retrieval item; README matrix regenerated; README edge-semantics prose updated; bootstrap payload regenerated.

## Execution Graph

```
T001 (SKILL.md)  --\                       (G1: independent file owners)
T002 (contracts) ---> T003 (README matrix) ---> T005 (gates + baseline)
T001 ---------------> T004 (payload regen) ---> T005
```
- Critical path: T001/T002 -> T003 -> T005 (and T001 -> T004 -> T005).
- Parallel group G1: {T001, T002} — different files, no overlapping writes; the never-invokes set-equality invariant is enforced at T005.
- T003 depends on T002 (matrix renders INTERFACES); T004 depends on T001 (payload copies SKILL.md).

## Numbered Plan

1. [pending] Rewrite csm-deep-research/SKILL.md boundary prose and add the Browser Retrieval Fallback section
   - Task ID: T001
   - Depends on: none
   - Parallel group: G1
   - Risk: standard (single-file prose change to a gate-validated skill; revertible)
   - Owned scope: `csm-deep-research/SKILL.md` only
   - Not in scope: `scripts/lib/boilerplate.mjs` synced sections (`## Tmux Session Bootstrap`, `## Subagent Resilience`); `## Research State Machine` body; the machine chain line; any other file
   - Spike candidate: none
   - Actions:
     1. Frontmatter description: reword so it states the fallback while keeping a Never-X clause, <= 1024 chars, no volatile tokens, and holding the 220-token total across all 9 descriptions. Use exactly this 59-token candidate (verified to total 220): "Deep research, R&D and validation queries answered with one exhaustively cited research finding. Use when asked to research how to build something, which algorithm or technique to use, the original spec or standard, or a way forward. Never writes outside the research document; invokes csm-browse when pages need a browser. Biases towards retrieval from current documentation over pre-trained knowledge." (Do not add or remove words without re-verifying the <= 220 token total with the gate tokenization.)
     2. L12: reword "it hands off to no other skill" to state the single sanctioned csm-browse retrieval exception (keep the strict write allowlist sentence).
     3. Interface L24: replace "this skill never invokes them" with the browser-retrieval exception; L25: remove `csm-browse` from the Never-invokes list (exact 7 names); keep all 4 labeled bullets and the artifact path unchanged.
     4. L53 (facts-from-tools): add the csm-browse browser-retrieval path to the retrieval-tool list.
     5. L62 (standalone terminal at SAVED): add the exception — "never invoke other skills except the csm-browse retrieval fallback".
     6. L71 / Write Discipline: add the single declared host-state exception for transient csm-browse session dirs (self-swept; explicitly closed before SAVED; evidence captured into the run's temp dir before close).
     7. L101 / Triage: state that the browser fallback is a web-fetch mechanism allowed in `web` and `hybrid` modes only — never in `local`.
     8. L156 / RESEARCH: state that researchers flag JS-only/unfetchable URLs as `browser-retrieval-needed` in their findings (pinned convention: append the flag to the claim's return shape as `needs-browser-retrieval: <url>`) and the primary performs the fallback retrieval; subagents never run browser verbs.
     9. CHALLENGE section (the challenger's re-locate mandate, ~L170-178): add that when re-locating a citation hits a JS-only/unrenderable page, the challenger flags it the same way (`needs-browser-retrieval: <url>`) and the primary performs the fallback; the challenger never runs browser verbs.
     10. L337 / Done Criteria: add the fallback criterion (allowlisted, primary-orchestrated, read-only verbs, session closed before SAVED).
     11. Add `## Browser Retrieval Fallback` H2 AFTER `## Subagent Resilience` (file end) with unnumbered H3s only, containing: trigger conditions; the read-only retrieval recipe (exact commands from R3); guardrails (verbs list, no credentials/logins, port 9222 prohibition, mode gating, sid regex, container-unavailable -> unverified with no auto-pull, note that `ensure-browser` sweeps idle sibling sessions while ensuring — expected, session state stays inside the declared exception); evidence shape (URL + retrieval date + "retrieved via headful browser (csm-browse)"; journaling of the session in the Control journal); cleanup rule (close before SAVED).
     12. Add a corresponding anti-pattern entry ("leaving a csm-browse session open past SAVED").
     13. Keep the existing never-claims at L42 ("never hands off to csm-plan") and L212 ("never invoke csm-plan or csm-build") untouched — they remain true.
     14. Keep the file under the gate's `< 500` line budget (currently 354; the new section must stay well under ~145 lines).
   - Acceptance signal: partial checks only (the full suite runs at T005): (a) read-only node one-liner asserts description <= 1024 chars, `NEVER_CLAUSE_RE` matches, all-9 total <= 220 tokens, no `VOLATILE_DESC_RE` hit; (b) grep asserts the Interface "Never invokes:" line contains exactly the 7 names `csm-bdd-tdd, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload` and no `csm-browse`; (c) grep asserts `## Browser Retrieval Fallback` appears after `## Subagent Resilience`; (d) grep asserts no new numbered H3 headings were added (diff against HEAD); (e) Interface still has exactly 4 labeled bullets and the research-document artifact path pattern (grep for the `-research.md` suffix).
   - Validation: `git diff --stat csm-deep-research/SKILL.md` shows only the intended ranges; file line count < 500; read the file around each edited line to confirm synced sections (`## Tmux Session Bootstrap`, `## Subagent Resilience`) are byte-identical to HEAD.
   - Acceptance evidence: recorded output of the node one-liner, the grep results, and the diff stat.
   - Repair attempts: 0
   - Recovery note: revertible single file; if the gate later fails on this task's ranges, re-diff against HEAD and re-apply only the boundary lines; the new H2 is appended at file end so partial work is detectable by its absence.

2. [pending] Update the never-invoke contract and interface entry in contracts.mjs
   - Task ID: T002
   - Depends on: none
   - Parallel group: G1
   - Risk: low (data-only change in a single module; syntax-gated)
   - Owned scope: `scripts/lib/contracts.mjs`
   - Not in scope: any SKILL.md; `scripts/lib/boilerplate.mjs`; other rows of NEVER_INVOKE
   - Spike candidate: none
   - Actions:
     1. `NEVER_INVOKE['csm-deep-research']`: flip `'csm-browse': true` -> `false` (row then has exactly 7 `true` entries: csm-bdd-tdd, csm-build, csm-grill, csm-plan, csm-review, csm-scan, csm-upload).
     2. Update the matrix comment (L165-172) to note the new asymmetry: csm-deep-research may invoke csm-browse for browser retrieval only.
     3. `INTERFACES['csm-deep-research'].consumes`: append `'browser-rendered retrieval via csm-browse fallback (JS-only pages)'`; keep `entryConditions`, `produces`, `handoff`, `midPipeline` unchanged.
   - Acceptance signal: `node --check scripts/lib/contracts.mjs` passes AND `pnpm exec oxlint --deny-warnings scripts/lib/contracts.mjs` clean AND a node one-liner asserting `NEVER_INVOKE['csm-deep-research']['csm-browse'] === false` and exactly 7 true entries in the row.
   - Validation: `node -e "import('./scripts/lib/contracts.mjs').then(m => console.log(m.NEVER_INVOKE['csm-deep-research']))"` prints the flipped row; `git diff --stat scripts/lib/contracts.mjs` shows only the three intended regions.
   - Acceptance evidence: recorded command outputs.
   - Repair attempts: 0
   - Recovery note: revertible single module; partial edits detectable by the acceptance one-liner.
   - Spike candidate: none

3. [pending] Regenerate the README composition matrix and update edge-semantics prose
   - Task ID: T003
   - Depends on: T002
   - Parallel group: G2
   - Risk: low (generated region + one prose sentence)
   - Owned scope: `README.md` (matrix region + the sanctioned-edges sentence)
   - Not in scope: other README sections; any skill file
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/gen-readme-matrix.mjs --write` from the repo root to regenerate the `<!-- csm-matrix:start -->`..`<!-- csm-matrix:end -->` region.
     2. Update the prose sentence that claims csm-grill/csm-plan -> csm-deep-research is "the only sanctioned cross-skill dispatch edge" to also mention the csm-deep-research -> csm-browse retrieval edge (conditional fallback, human-visible wording matching the new contract comment).
   - Acceptance signal: `node scripts/gen-readme-matrix.mjs` (check form) exits 0 AND grep finds the updated edge sentence.
   - Validation: `git diff --stat README.md` limited to the matrix region + one sentence; README renders (no broken markdown introduced).
   - Acceptance evidence: recorded outputs.
   - Repair attempts: 0
   - Recovery note: re-run the generator to restore the matrix; the prose sentence is revertible.
   - Spike candidate: none

4. [pending] Regenerate the bootstrap payload
   - Task ID: T004
   - Depends on: T001
   - Parallel group: G2
   - Risk: standard (regenerates `bootstrap/**` including payload-index.json and a tarball; deterministic)
   - Owned scope: `bootstrap/package/**` (regenerated), `bootstrap/payload-index.json`
   - Not in scope: anything outside `bootstrap/`; manual edits inside `bootstrap/` (generated)
   - Spike candidate: none
   - Actions:
     1. Run `node scripts/pack-bootstrap.mjs` from the repo root (no argv; regenerates payload/skills copies, payload-index.json, and tarball).
     2. Confirm the generated payload/skills/csm-deep-research/SKILL.md is byte-identical to the repo-root file.
   - Acceptance signal: `node scripts/check-suite.mjs` payload-drift section reports `issues:[]` (compared count stays 119 — content edits add no files) — or standalone: `cmp bootstrap/package/payload/skills/csm-deep-research/SKILL.md csm-deep-research/SKILL.md` exits 0.
   - Validation: `git diff --stat bootstrap/` shows only expected regenerated files; `node scripts/pack-bootstrap.mjs` exits 0.
   - Acceptance evidence: recorded outputs; the cmp result.
   - Repair attempts: 0
   - Recovery note: `git checkout -- bootstrap/` restores the prior payload if regeneration misbehaves (content is generated; nothing hand-written there).
   - Spike candidate: none

5. [pending] Run the full gates, targeted tests, and verify the gate baseline
   - Task ID: T005
   - Depends on: T001, T002, T003, T004
   - Parallel group: G3 (final)
   - Risk: low (verification only)
   - Owned scope: no source edits; may update `.agents/docs/gate-baselines.json` via the recorder script only if the check count deviates (expected to stay 654 — this work adds no `check()` calls)
   - Not in scope: any skill or contract file
   - Spike candidate: none
   - Actions:
     1. `pnpm exec oxlint --deny-warnings` — expect clean.
     2. `node scripts/check-suite.mjs` — expect `OK — 9 skills, 654 checks`, payload drift `{compared:119, issues:[]}`, no README/boilerplate drift, never-invokes for csm-deep-research passing (set-equality against the flipped contracts row).
     3. `node scripts/gen-readme-matrix.mjs` (check form) — expect exit 0.
     4. Targeted tests: `node --test tests/check-suite.test.mjs tests/package-audit.test.mjs tests/protocol/protocol.test.mjs tests/integration/bootstrap-flow.test.mjs` — expect all pass.
     5. `node scripts/record-gate-baseline.mjs --check` — expect PASS (count unchanged at 654); only if the count deviates, re-record with `node scripts/record-gate-baseline.mjs --record check-suite <N> <wall-ms>` (values from the step-2 run) and re-verify.
   - Acceptance signal: every command exits 0 with the expected outputs recorded; baseline file consistent with the new count.
   - Validation: `git status --short` shows only the intended files (SKILL.md, contracts.mjs, README.md, bootstrap/**, gate-baselines.json if re-recorded) plus the untracked plan file(s) under `.agents/plans/`.
   - Acceptance evidence: recorded command outputs; final `git status --short`.
   - Repair attempts: 0
   - Recovery note: any gate failure here is addressed by re-running the responsible task's acceptance signal; do not silence failures.
   - Spike candidate: none

## Verification Strategy
- Fast per-task gates (each task's acceptance signal, cheapest first): node --check/oxlint for contracts (T002); generator check forms for matrix (T003) and cmp for payload (T004); grep + node one-liners for T001.
- Batch final gate (T005, repo-wide, single run): `make analyze` equivalent — oxlint + check-suite — plus `gen-readme-matrix.mjs` check form and the four targeted test files. All run from the repo root.
- Known environment sensitivity: none for this change (csm-browse e2e tests are NOT run — they need Docker and are unaffected; `make test-browse` sanity is optional).
- Order: T001/T002 acceptance signals -> T003/T004 -> T005 full gate. Do not run T005 before T001-T004 land (drift checks would fail by design).

## Risks And Recovery
- Description budget drift (A5): mitigated by the T001 acceptance one-liner reproducing the gate tokenization; if wording exceeds 220, trim words elsewhere in the description; the check runs before any commit.
- Never-invokes mismatch: exact 7-name set specified in T001 and enforced by check-suite at T005; mismatch produces the gate's explicit expected-list error, fixable in seconds.
- Payload/README/boilerplate drift: hard gate failures with explicit diffs; regen commands documented (T003, T004); boilerplate sections are untouched by design (A8).
- Machine-verifier breakage (orphan H3s / chain extraction): prevented by A8 (new section after the machine section, unnumbered H3s only, no edits to the chain); check-suite verifyMachine runs in T005.
- Gate baseline count deviation: recorded at T005 step 5; deviation is a warning-and-exit-code policy, but the plan re-records to keep pre-commit clean.
- Fallback runtime failures are out of scope of this change (skill is instructions-only): the skill text must tell the runtime to degrade to Unverified Claims when the browser is unavailable — no code change needed.
- Rollback: all five tasks touch revertible files; `git checkout --` on the affected paths restores pre-change state (payload is generated).

## Critique Resolution
| Finding | Severity | Resolution | Evidence |
|---|---|---|---|
| F1 T001 acceptance ran full check-suite before contracts/payload landed (unsatisfiable) | major | T001 acceptance now partial checks only (one-liners + greps + diff vs HEAD); full never-invokes set-equality deferred to T005 step 2 | check-suite.mjs never-invokes check is set-equality against contracts row; T004 payload drift is a hard failure until regen |
| F2 payload compared-count bound ">= 120" unachievable (stays 119) | major | Bound removed; AC6/T004 accept `issues:[]` with count 119 documented as invariant | checkPayloadDrift counts walked files; content edits add no files |
| F3 challenger re-location designed but not edited | major | T001 gains action 9 editing the CHALLENGE section: challenger flags `needs-browser-retrieval: <url>`, primary performs fallback, challenger never runs verbs | SKILL.md CHALLENGE state (L170-178) defines re-location mandate |
| F7 description candidate = 60 tokens -> 221 total | major | Candidate replaced with the verified 59-token reword (total 220); T001 action 1 pins exact wording and re-verification rule | critique counted with gate tokenization; 59 tokens verified |
| F4 <500 line budget not budgeted | minor | T001 action 14 records the line budget (354 now; new section < ~145 lines) | check-suite L652 |
| F5 inventory overstatement; L42/L212 never-claims | minor | T001 action 13 instructs keeping L42/L212 untouched; plan text notes they remain true | SKILL.md L42, L212 |
| F6 eval soft guardrail | minor | Accepted as-is: `eval` restricted to read-only expressions, `text`/`html` preferred; wording already in A3 and T001 action 11 | browse.mjs eval semantics (R3) |
| F8 browser-retrieval-needed flag slot unpinned | minor | Pinned convention `needs-browser-retrieval: <url>` in T001 action 8/9 and Design item 1 | researcher return shape (SKILL.md L154) has no slot; convention defined |
| F9 ensure-browser sweeps sibling sessions | minor | T001 action 11 adds a note that the sweep is expected and session state stays inside the declared exception | sweep.mjs behavior (R3) |
| F10 T005 git status vs untracked plan file | minor | T005 validation now allows untracked `.agents/plans/` files | plan-file lifecycle |

## Progress Journal
| Timestamp | Cycle | Transition | Tasks | Evidence/result | Next state |
|---|---|---|---|---|---|
| 2026-08-20 | 0 | INTAKE -> DISCOVER | — | Brief classified: focused single-skill change, prescriptive approach (user-dictated: use csm-browse for JS-only pages); tmux present, bootstrap skipped | DISCOVER |
| 2026-08-20 | 0 | DISCOVER complete | — | Repo layout, Makefile gates, check-suite 654 checks, contracts.mjs NEVER_INVOKE row, csm-browse SKILL.md + mechanics, gate baseline, token-efficiency disabled, chromium-vnc running, payload/README/boilerplate drift mechanics | RESEARCH |
| 2026-08-20 | 0 | RESEARCH complete | — | 2 parallel read-only tracks: (A) full edit-point inventory + gate constraint audit; (B) csm-browse verb mechanics + minimal read-only retrieval recipe. All findings recorded in R&D Record R1-R4 and Discovered Requirements | DRAFT |
| 2026-08-20 | 0 | DRAFT complete | — | 5-task plan (T001-T005), G1/T002->T003->T005 and T001->T004->T005 graph, design with guardrails and evidence shape | CRITIQUE |
| 2026-08-20 | 0 | CRITIQUE complete | — | Verdict REVISE: 4 major (T001 acceptance ordering; payload >=120 bound; challenger edit missing; description +1 token), 6 minor | REMEDIATE |
| 2026-08-20 | 0 | REMEDIATE complete | — | All findings resolved: T001 partial acceptance, AC6/T004 bound removed, CHALLENGE edit added, 59-token description pinned, flag convention pinned, line-budget/never-claims/notes added; Critique Resolution table filled | VERIFY |

## Completion Review
<filled by csm-build when all criteria are verified>
