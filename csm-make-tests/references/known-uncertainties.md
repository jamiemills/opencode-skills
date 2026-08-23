# Known Uncertainties

Residual uncertainties carried by the committed research finding, each with the runtime
guard this skill applies while the claim stays unverified. Source: the Unverified Claims
section of `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— labels U9, U15, U16, U13c, U18 below match that section.

Format per item: claim — why unverified — RUNTIME GUARD applied during runs — how to
re-verify and close it.

| #   | Residual                         | Label      | Runtime guard                               | Re-verify                   |
| --- | -------------------------------- | ---------- | ------------------------------------------- | --------------------------- |
| 1   | pitest `mutations.xml` filename  | U9         | glob `target/pit-reports/**/*.{xml,csv}`    | live run or pitest source   |
| 2   | Pact `can-i-deploy` broker flags | U15        | `pact-broker help` before scripting         | docs.pact.io                |
| 3   | Ghostwriter CC0 output license   | U15        | never assert license terms in reports       | hypothesis.readthedocs.io   |
| 4   | Randoop `--specifications` flag  | U15        | `randoop --help` check, regression fallback | randoop.github.io manual    |
| 5   | Diffblue / self-healing efficacy | U16 / U13c | vendor claims excluded from tool selection  | independent study appearing |

## 1. pitest report filename (`mutations.xml`) — U9

- Claim: pitest emits machine-readable XML (plus CSV) reports named `mutations.xml`
  under `target/pit-reports/`.
- Why unverified: corroborated only via gradle-pitest-plugin docs; never checked against
  pitest.org proper or pitest source — the verification attempt was dropped from its
  retry scope.
- RUNTIME GUARD: locate reports by glob — `target/pit-reports/**/*.{xml,csv}` — parse
  whichever files exist, and validate expected fields before trusting survivor lists.
  Never hardcode `mutations.xml`.
- Re-verify: a live pitest run inspected for emitted filenames, or read the pitest
  source; close this item once observed firsthand.

## 2. Pact `can-i-deploy` broker flag set — U15

- Claim: `pact-broker can-i-deploy` gates deploys on verified contracts using version,
  pacticipant, and environment flags.
- Why unverified: challenger-level verdict; docs.pact.io was not independently
  re-fetched for the exact flag surface.
- RUNTIME GUARD: run `pact-broker help` (or `pact-broker can-i-deploy --help`) before
  scripting any broker gate; construct commands only from flags the installed CLI
  actually reports.
- Re-verify: docs.pact.io broker documentation.

## 3. Hypothesis Ghostwriter CC0 output license — U15

- Claim: Ghostwriter-generated test code is dedicated under CC0, so drafted tests carry
  no licensing encumbrance into the target repository.
- Why unverified: single-source claim, not re-fetched.
- RUNTIME GUARD: never assert CC0 or any license terms for ghostwritten output in
  reports or decisions; route Ghostwriter drafts through the same human review and
  mutation spot-check as every other generated test, so licensing is moot either way.
- Re-verify: the ghostwriter section of the Hypothesis integrations page at
  hypothesis.readthedocs.io.

## 4. Randoop `--specifications` flag — U15

- Claim: Randoop accepts `--specifications=<file>` with JSON pre/postconditions,
  upgrading its regression output toward intent tests.
- Why unverified: manual-level verdict not re-fetched against the current release.
- RUNTIME GUARD: check `randoop --help` for the flag before use. If absent, fall back to
  plain regression capture (error-revealing plus regression tests) without the intent
  upgrade.
- Re-verify: the Randoop manual at randoop.github.io.

## 5. Vendor capability claims: Diffblue and self-healing — U16 / U13c

- Claim: Diffblue's published coverage/mutation figures and commercial self-healing
  efficacy claims describe real-world capability levels.
- Why unverified: no independent or academic evaluation exists anywhere — arXiv,
  OpenAlex, and Semantic Scholar sweeps return none for Diffblue; the nearest
  self-healing artifact is a single-author demo. General-engine sweeps were bot-blocked
  and paywalled ICSE/FSE venues unchecked, so "none found" is search-bounded.
- RUNTIME GUARD: never cite vendor numbers as capability guarantees; exclude vendor
  claims from tool selection criteria entirely. Selection is decided by audited gaps,
  captured evidence, and mutation scores.
- Re-verify: if an independent study appears (software-engineering venues are the likely
  home), fold it in and reopen tool selection.

## Registry Sweep Bound — U18

The maintainer-niche absence (no suite-maintenance skill found across four registry
sources) is search-surface-bounded, not proven: one registry was unreachable during the
sweep, and keyword search can miss differently-named competitors ("snapshot curator",
"golden steward"). No runtime guard — this affects positioning claims only. In reports,
phrase uniqueness as "none found in surveyed registries", never as "does not exist".
