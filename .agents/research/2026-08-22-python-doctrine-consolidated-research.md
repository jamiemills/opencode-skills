format: csm-deep-research/1


> **SUPERSEDED / REDUNDANT (2026-08-22):** Superseded by the complete consolidation `2026-08-22-pep20-idiomatic-python-consolidated-research.md`, which carries all detail sections inline. Retained for provenance only.
# Python Doctrine Consolidated Research Finding (PEP 20 Architecture + Idiomatic-Python Review)

## TL;DR

Build Python services on PEP 20 doctrine operationalized as a concrete stack — uv + pyproject.toml + src layout, ruff, pyright "standard" with per-file strict, pydantic only at I/O edges, protocols as the dependency-inversion seam, sync-first, pytest+Hypothesis — and enforce it with a layered reviewer: mechanical tier consumed from ruff's catalog verbatim, type tier from mypy/pyright, judgment tier (design, gotchas, complexity, test validity) reserved for humans, triaged with pylint C/R/W/E/F + Google Nit tokens. Both source runs passed their own challenge/judge/verify pipelines; this doc supersedes both.

## Executive Summary

```text
PEP 20 doctrine (what good Python is)  +  idiomatic-reviewer rules (how it is enforced)
        |                                             |
  target-state playbook                         three enforcement tiers
  (uv/pyproject/src, boundary validation,       (ruff mechanical | pyright types |
   protocols, EAFP, sync-first)                  human judgment <=400 LOC chunks)
        └──────────────> codebase standard <──────────────┘
```

This document consolidates two same-workstream findings into one canonical doc:
1. `2026-08-22-pep20-python-2026-research.md` — PEP 20 as the basis for modern Python architecture (15 confirmed findings, 60 refs).
2. `2026-08-22-python-idiomatic-reviewer-research.md` — idiomatic-Python rules for a specialized code reviewer (12 findings, 92 refs, machine-readable rules artifact).

Both sources are banner-marked SUPERSEDED and retained for provenance; their full detail sections live there. Reference prefixes: [Pn] = doctrine sources, [Vn] = reviewer sources.

## Key Findings

### Part A — PEP 20 architecture doctrine (findings verbatim from source run)

K1. CONFIRMED supported — PEP 20 is still the living design doctrine: Active informational PEP authored by Tim Peters (19-Aug-2004); glossary defines it; PEP 8 anchors itself in it ("As PEP 20 says, 'Readability counts'"); current Design FAQ still justifies syntax in Zen terms [P1,R4,R5,R6]

K2. CONFIRMED supported — The Zen functions as a trade-off rubric, not a rulebook: aphorisms deliberately tension each other ("Although practicality beats purity." vs "Special cases aren't special enough to break the rules."); Real Python (updated Feb 2026): "The aphorisms are guidelines, not strict rules" [P1,R3,R60]

K3. CONFIRMED partially-supported — Packaging metadata has consolidated onto pyproject.toml ("[build-system] table is strongly recommended"), but the wider tooling story is adoption + vendor positioning, not official PyPA endorsement: uv's "single tool to replace pip, pip-tools, pipx, poetry, pyenv, twine, virtualenv" pitch and ruff's flake8/black/isort/pyupgrade replacement claims come from Astral's own docs; formatter parity "> 99.9% of lines are formatted identically" vs Black on Django/Zulip likewise. Deprecation is narrowly scoped: only `python setup.py` CLI invocations are deprecated — setup.py/Setuptools as configuration files are NOT deprecated [P13,R14,R16,R18,R19]. Downgraded from supported: consolidation real, deprecation rescoped

K4. CONFIRMED supported — src layout is the mainstream project shape: PyPA's discussion page enumerates benefits and trade-offs ("The src layout helps prevent accidental usage of the in-development copy") without issuing a normative recommendation; the normative language is pytest's: "it is strongly suggested to use a src layout" (prepend import mode) [P21,R38]

K5. CONFIRMED supported — Dependency discipline splits libraries vs apps: libraries publish ranged abstract deps, never pinned ("It is not considered best practice to use install_requires to pin dependencies to specific versions"); apps pin exhaustive locks committed to VCS; PEP 751 pylock.toml Final (31-Mar-2025); uv.lock universal + committed but proprietary internally [P22,R23,R17]

K6. CONFIRMED supported — Typing is gradual, machine-checked, runtime-unenforced: "The Python runtime does not enforce function and variable type annotations"; Any is the sanctioned escape hatch; mypy lenient-by-default ("This is a feature!"), --strict too aggressive for large legacy codebases; pyright defaults to typeCheckingMode "standard", per-file `# pyright: strict` progression [P25,R28,R29,R30,R31]

K7. CONFIRMED supported — Validation lives at boundaries only: untrusted data parsed once through pydantic models guaranteeing OUTPUT types ("Pydantic guarantees the types and constraints of the output, not the input data"); stdlib dataclasses do no runtime type checking ("nothing in @dataclass examines the type specified") — "Use a data structure that makes illegal states unrepresentable" [P32,R33,R34,R53]

K8. CONFIRMED supported — Protocols (static duck typing) are the dependency-inversion seam: PEP 544 structural subtyping matches runtime duck typing; explicit ABC marking called "unpythonic"; typing team: "For arguments, prefer protocols and abstract types (Mapping, Sequence, Iterable, etc.)"; even plain modules can satisfy protocols — wiring stays framework-free [P26,R27,R36]

K9. CONFIRMED supported — Data modeling makes illegal states unrepresentable: official tutorial: idiomatic record-like bundling "is to use dataclasses"; NamedTuple assigns meaning to positions; Enum models closed state sets [P50,R33,R51,R52]

K10. CONFIRMED supported — Errors follow EAFP with flat hierarchies: glossary canonizes EAFP ("assumes the existence of valid keys or attributes and catches exceptions if the assumption proves false"); tutorial: derive user exceptions from Exception, "usually kept simple"; Zen: "Errors should never pass silently. Unless explicitly silenced." [P5,R57,R1]

K11. CONFIRMED partially-supported — Concurrency is pragmatic/sync-first: asyncio scoped to "IO-bound and high-level structured network code"; dedicated traps page warns async differs from sequential programming and CPU-bound code must never block the loop; free-threading officially supported non-experimental since 3.14, not yet default build. Marked partially-supported because no official source states "don't make everything async by default" in those words — the norm is inferred from official scoping [P55,R56,R8,R9,R10]

K12. CONFIRMED supported — Verification practice: plain asserts with introspection replace xUnit assert methods; fixtures are explicit/modular arrange-phase dependency injection; Hypothesis property tests complement unit tests ("a powerful addition... not always a replacement", round-trip properties first, 100 inputs default, shrinking, >4M weekly downloads); doctests = "literate testing"/"executable documentation" (pytest --doctest-modules); coverage gauges effectiveness not quality (maintainer: "100% test coverage doesn't really mean much", coverage should "enhance thought, not replace it"); Google ~70/20/10 unit/integration/E2E pyramid; SWE-at-Google documents over-mocking danger, pendulum swinging to realistic tests; GitHub's canonical Python CI = setup-python + ruff check + pytest --cov [P37,R38,R39,R40,R41,R42,R43,R44,R45,R46,R47]

K13. CONFIRMED supported — Language evolution itself models Zen balance: PEP 695 infers variance eliminating boilerplate ("eliminates the need for the redundant name and cumbersome variable names"); PEP 703 accepted with rollout "gradual and break as little as possible... roll back any changes that turn out to be too disruptive"; PEP 779 moved free-threading to phase II in 3.14; 3.12 added "Did you mean..." error hints; match/case introduced as soft keywords [P7,R8,R9,R11,R12]

K14. CONFIRMED supported — Governance caveat: Astral agreed March 2026 to join OpenAI's Codex team; keep the pylock.toml export path open to hedge monoculture risk — the same hedge governs adopting Astral's newer tools (e.g., the `ty` type checker): keep checker and metadata portability open [P20,R17]

K15. CONFIRMED supported — Tooling pluralism is by design, not accident: PEP 751's own motivation names "at least five well-known solutions" (PDM, pip freeze, pip-tools, Poetry, uv) [P22]; Poetry, PDM, and Hatch remain mainstream alternatives, making uv the fastest-growing consensus rather than the only path

### Part B — Idiomatic-Python reviewer (findings verbatim from source run)

K1. PROVISIONAL supported — The idiomatic-rules corpus already exists as codified linter catalogs: ruff alone ships 900+ rules at retrieval time (pin the ruff version when building — see Unverified Claims) across ~55 plugin-derived families (prefix = source plugin, code = PREFIX+3–4 digits), with a verified default set of ~400 rules; a reviewer should consume, not redefine, that layer [V59,R60,R6]

K2. PROVISIONAL supported — Rules split cleanly into three enforcement tiers — mechanical (lint codes), semantic-static (type checkers), judgment (human/expert) — and the boundary is official policy, not tooling immaturity: ruff's FAQ states "Ruff is a linter, not a type checker... a type checker will catch certain errors that Ruff would miss", while Google's SWE-book assigns formatting/lint/type-check to presubmits so humans review design and comprehension [V91,R89,R88]

K3. PROVISIONAL supported — A correctness-tier flag set every reviewer must surface exists and is lint-coded: F401/F811/F821/F841 (unused/redefined/undefined/unused-var), F632 is-literal, E711/E712/E722/W605, plus the bugbear class B006/B008/B023/B904/B905/B012/B019/B011 etc., which is the highest-value family because each code encodes a documented failure mode [V1,R2,R3,R4,R5,R9,R10,R11,R14,R22,R23,R24,R25,R26,R27,R61]

K4. PROVISIONAL supported — Non-lintable gotcha classes require judgment review because default linters miss them: mutable class attributes shared across instances (the tutorial's own Dog example calls it "mistaken use of a class variable"), `*` replication aliasing, tuple-element augmented assignment that mutates then raises, assignment-localization UnboundLocalError beyond F821's reach, bool-subclasses-int, mutators-return-None conventions [V64,R62]

K5. PROVISIONAL supported — Modernization is a safe-suggestion tier gated by target-version: UP-family + pyupgrade rewrites (PEP 585 generics, PEP 604 unions, PEP 695 type aliases, f-strings, yield from, removeprefix, functools.cache, subprocess text=True, datetime.UTC); fixes are unsafe when runtime annotation consumers exist (Pydantic pre-3.9/3.10), which is why UP006/UP007 ship escape hatches (`keep-runtime-typing`) [V17,R16,R21,R74,R83]

K6. PROVISIONAL supported — Complexity gates approximate reader-relative comprehension but do not replace it: mccabe C901 ("anything that goes beyond 10 is too complex"), pylint PLR0912/0913/0915 branch/arg/statement thresholds, radon CC weights — while Google defines "too complex" as "can't be understood quickly by code readers"; gates are proxies the reviewer's judgment completes [V75,R49,R46,R48,R78,R88]

K7. PROVISIONAL partially-supported — Authority hierarchy has real conflicts reviewers must parameterize via project config rather than dogma: line length (PEP 8 says 79 with ≤99 opt-in / pyguide+black ecosystem 88 / ruff default 88), import style (PEP 8 three-group ordering vs pyguide packages-and-modules-only + no-relative-imports), dunder privacy (PEP 8 documents name mangling as a feature vs pyguide discouraging it for readability/testability). Marked partially-supported because shipped pylint threshold defaults were unconfirmed against docs examples [V65,R63,R8]

K8. PROVISIONAL supported — Docstring discipline is fully codified and mechanically checkable: PEP 257 principles + D-rules (D100–D107 presence incl. `__init__`, D200/D205/D209 shape, D300/D400/D401/D415 form); caveat: www.pydocstyle.org now serves hijacked gambling content, so implementations should target ruff's pydocstyle reimplementation or the PyCQA source directly [V84,R85]

K9. PROVISIONAL supported — Test-quality rules are a distinct reviewer deliverable spanning both tiers: PT011/PT012 and bugbear B017 ("assertRaises(Exception)... should be considered evil") are lint-coded, but assertion usefulness and false-positive risk are human judgment — Google: "Tests do not test themselves... a human must ensure that tests are valid" [V51,R52,R61,R88]

K10. PROVISIONAL supported — Severity vocabulary should be borrowed, not invented: pylint's five message classes encode ready-made semantics ((C) convention < (R) refactor < (W) warning < (E) error/probable-bug < (F) fatal) and Google reviews already route urgency via Nit:/suggestion/must-fix tokens; mapping reviewer findings onto these lets teams reuse existing triage [V92,R87]

K11. PROVISIONAL partially-supported — Human review physics justify the tool: 70–90% defect yield achieved only within 200–400 LOC over 60–90 minutes, defect density drops above ~500 LOC/hour, sessions degrade after ~60 minutes (Cisco study via SmartBear, vendor-reported = medium confidence); Google independently converges on ~200-line CLs reviewed within about a day [V90,R89]

K12. PROVISIONAL supported — Reviewer positioning: consume linter+typechecker output as context, then judge exactly the categories Google says need humans — Design, Functionality, Complexity, Comments-semantics, test-validity, concurrency — framed as code-health deltas under approval-on-improvement ("favor approving a CL once it definitely improves overall code health"), never as pass/fail gates [V88,R89,R87]

## Detail Sections

Full per-claim detail sections (D1-D15 across both sources) are retained in the superseded source docs; the load-bearing synthesis is:

- **Doctrine → stack mapping**: the Zen rubric lands as the 12-step playbook in Part A's Recommendation — packaging (pyproject/uv/src/lock discipline), typing posture (gradual, strict-escalation), boundary-only validation (parse-don't-validate; dataclasses/enums make illegal states unrepresentable), protocols for dependency inversion, EAFP errors, sync-first concurrency, pytest/Hypothesis/doctest verification pyramid. [P13][P16][P21][P29][P32][P53][P26][P5][P55][P37][P40]
- **Reviewer → enforcement mapping**: the doctrine is checkable in three tiers — ruff's 900+ rule catalog (~400 default; pin the version) consumes style/idiom/modernization mechanically; mypy/pyright own types (ruff officially cedes them); humans judge exactly the non-lintable classes (mutable-attribute gotchas, complexity interpretation, docstring semantics, test validity, concurrency) in ≤400-LOC chunks. [V59][V60][V91][V88][V62][V64][V90]
- **Integration artifact**: `2026-08-22-python-idiomatic-reviewer-rules.json` (138+4 entries, three tiers + pylint-class severity map D8a) is the machine-readable bridge from this doctrine into CI/eval config. [V59][V92]
- **Known authority conflicts to parameterize, never hardcode**: line length (79/88/99), import grouping (PEP 8 three-group vs Google modules-only), dunder privacy (mangling-as-feature vs discouragement). [V65][V63][V7]

## Recommendation

### Target-state playbook (doctrine)

Playbook (apply in order):

1. Start every project with `uv init --lib` or `uv init --app`; default to src layout [P16,R17,R21].
2. One pyproject.toml declares metadata, deps, and tool config: prefer pyproject.toml-only metadata and keep setup.py only when programmatic build configuration is genuinely needed (`python setup.py` CLI use is deprecated; setup.py/Setuptools as config files are not) [P13,R14,R15].
3. ruff format + ruff check everywhere, wired through pre-commit; CI mirrors hook commands exactly [P18,R24].
4. Apps commit uv.lock; expose a pylock.toml export for interoperability [P16,R17,R22].
5. Libraries publish ranged abstract deps and test across a support matrix; never pin [P23,R22].
6. Annotate all new code; pyright "standard" org-wide; escalate new/hot modules to per-file strict [P30,R31,R29].
7. Validate only at I/O edges with pydantic; interior code trusts types via dataclasses/enums [P32,R33,R52,R53].
8. Accept protocols/abstract types (Mapping, Sequence, Iterable), return concrete types; wire modules/functions explicitly — no DI framework [P26,R27,R36].
9. Handle errors EAFP; raise flat custom exceptions derived from Exception; never bare except-pass [P5,R57,R1,R58].
10. Stay sync-first; introduce asyncio only for I/O-bound network-shaped workloads [P55,R56].
11. pytest with strict flags on; fixtures over setUp; Hypothesis on round-trips/parsers; doctests for API examples; set a coverage floor but never worship it [P37,R38,R39,R40,R42,R43,R44].
12. When designs compete, re-read the Zen in order and use it as tie-breaker rubric [P1,R3].

Confidence: MEDIUM-HIGH for doctrine/tooling/testing claims (multiple independent authoritative sources agree); MEDIUM-HIGH overall. Marketing-style figures carried through from vendor pages (ruff formatter parity %, Hypothesis weekly download counts) were not independently re-fetched during verification.

What would change this: Astral/OpenAI governance fallout fragmenting tooling trust [P20]; packaging-standard reversals undermining PEP 621/751 assumptions [P15,R22]; free-threading becoming the default build and shifting concurrency norms [P9,R10].

### Reviewer wiring (enforcement)

1. **Pre-filter every diff** through ruff + mypy/pyright before the reviewer runs; ingest their output as CONTEXT only — never re-report what a code already covers (ruff officially cedes types to mypy/pyright, and sits alongside pylint's deeper inference) [V91].
2. **Enforce mechanically where coded**: D1 correctness codes, D3 idiom rewrites, D4 target-version-gated modernization, D5 Tables A/B, D6 lint rows, D7 gates are consumed verbatim from tool catalogs, not redefined. **Route judgment-marked rows** (D2 gotchas, comment semantics, test validity, concurrency, complexity interpretation) to reviewer prompts.
3. **Adopt pylint's C/R/W/E/F classes plus Google's `Nit:` token** as the severity vocabulary, mapped per D8(a), so teams reuse existing triage instead of learning a new scale [V92,R87].
4. **Chunk reviews ≤400 LOC**, prioritizing the correctness tier (D1) first, matching human discovery physics and Google's small-CL norm [V90,R89].
5. **Parameterize authority conflicts via project config**, never hardcoded dogma: line-length (79 PEP 8 default / 99 opt-in / 88 black-ruff ecosystem), import style (PEP 8 three-group vs pyguide modules-only-no-relative), dunder privacy (PEP 8 mangling-as-feature vs pyguide discouragement) [V65,R63].
6. **Frame findings as code-health deltas** under approval-on-improvement — better/worse than the incoming state, never pass/fail gates; facts-and-data overrule preferences only where approaches are demonstrably unequal [V87].

Confidence: MEDIUM-HIGH — it would drop if ruff's default set drifts materially across releases (pin the ruff version when building the mechanical tier) or if pylint's shipped threshold defaults prove different from the cited values (docs embed example configs, not guaranteed defaults).

Confidence: MEDIUM-HIGH overall (both source runs' verdicts; vendor-reported figures carried through and flagged). What would change this: Astral/OpenAI governance fallout [P20]; packaging-standard reversals [P15][P22]; ruff default-set drift across releases (pin versions) [V6 of source Unverified Claims]; pylint shipped-default corrections [V2 of source Unverified Claims].

## Unverified Claims

### From the PEP 20 finding

- **U1** Claim: Jane Street original "make illegal states unrepresentable" post unreachable (both slugs 404, Wayback timed out); phrase cited via Alexis King [R53]. Why unverifiable: primary source offline during retrieval window. Verification step: retry Wayback Machine snapshot of the original slugs.
- **U2** Claim: native pip support for installing directly from `pylock.toml`. Why unverifiable: absent from fetched pip docs/changelog pages. Verification step: check pip changelog and docs for pylock support notes.
- **U3** Claim: QuickCheck heritage of Hypothesis. Why unverifiable: lineage not stated on currently-fetched Hypothesis pages [R40]. Verification step: consult the JOSS paper (2019).
- **U4** Claim: Pyright typeCheckingMode default history (basic → standard). Why unverifiable: release notes not fetched. Verification step: read pyright release notes/changelog.
- **U5** Claim: 2026 quantitative pytest adoption statistic. Why unverifiable: no survey data in corpus. Verification step: JetBrains Dev Ecosystem or PSF survey latest edition.
- **U6** Claim: Google 70/20/10 figure — dates to 2015 blog post; no newer restatement located [R45]. Why unverifiable: only the 2015 source in corpus. Verification step: search recent Google testing blog / testing-engineering docs.
- **U7** Claim: post-acquisition licensing/roadmap of uv/ruff under OpenAI unknown beyond announcement [R20]. Why unverifiable: only the announcement exists so far. Verification step: monitor astral.sh blog and repo license changes.
- **U8** Claim: Ruff rule-count conflicts across Astral pages ("over 500" marketing vs "over 900" FAQ) [R18]. Why unverifiable: inconsistent figures between official pages. Verification step: count implemented rules in the ruff repo.
- **U9** Claim: "sync-by-default" norm inferred from scoping docs; no explicit official wording found [R55,R56]. Why unverifiable: norm is inferred, not stated. Verification step: watch asyncio docs/free-threading guides for explicit guidance.
- **U10** Claim: exact textual diff between the 1999 mailing-list Zen and the PEP 20 rendering not diffed line-by-line [R60,R1]. Why unverifiable: diff not performed during retrieval. Verification step: programmatic diff of the two texts.

### From the idiomatic-reviewer finding

1. **pydocstyle.org hijacked/archival status.** www.pydocstyle.org serves gambling content and the GitHub repo is believed archived/maintenance-mode, with ruff reimplementing D-codes. Why unverifiable: domain compromise and archival status change outside fetched snapshots; no status page was retrieved. Verify: fetch www.pydocstyle.org, check PyPI release dates, and confirm PyCQA/pydocstyle repo archived flag + ruff pydocstyle rule index today.
2. **Pylint shipped threshold defaults (max-args=5, max-branches=12, max-statements=50) unconfirmed** — fetched docs pages embed example configs (max-branches=10, max-statements=7), which are not defaults. Why unverifiable: too-many-arguments/too-many-locals pages and the options reference were not fetched. Verify: fetch pylint readthedocs technical_reference/options or run `pylint --help-msg`/a live `pylint` invocation and read effective config output.
3. **SmartBear/Cisco review-physics figures are vendor-reported and single-source** (70–90%, 200–400 LOC, 500 LOC/hr, 60-min sessions). Why unverifiable: original Cisco study raw data and defect-density curves not publicly retrievable; only SmartBear summaries exist. Verify: locate the primary Cisco Collaborator publication or independent replications in peer-reviewed SE literature.
4. **OrderedDict → dict rewrite absent from pyupgrade README.** Claim that such a rewrite exists could not be grounded. Why unverifiable: README fetch contains defaultdict/comprehension rewrites but no OrderedDict category. Verify: grep current pyupgrade README + ruff UP-family index for OrderedDict handling.
5. **UP045 Optional-split recency unverified.** That UP007 covers Union while sibling UP045 covers Optional is confirmed, but when the split happened is not. Why unverifiable: changelog/release notes not fetched. Verify: search ruff changelog for UP045 introduction commit/version.
6. **Ruff default set drifts per release.** ~400-rule default set is a point-in-time verification. Why unverifiable: defaults are release-scoped and evolve continuously. Verify: pin a ruff version and diff `ruff check --show-settings` / the rules index default column against the pinned docs build.
7. **flake8-builtins A001–A004 code names unverified.** Shadowing-builtins detection attributed to the plugin by convention. Why unverifiable: plugin README/docs not fetched. Verify: fetch flake8-builtins README and confirm code-to-check mapping.
8. **Effective Python items are title-only, low confidence.** Two heuristics derived from TOC titles; item bodies/numbers not publicly excerpted. Why unverifiable: full text is behind purchase. Verify: obtain the book or author-published sample chapter and confirm item numbers and prescriptions.
9. **Real Python anti-patterns page 404 — QuantifiedCode archive substituted.** realpython.com/python-anti-patterns/ is dead; QuantifiedCode book used, last updated Jan 2018. Why unverifiable: whether Real Python relocated the content unknown; archive staleness limits currency. Verify: site-search realpython.com for relocation, and date-check any QuantifiedCode successor mirror.
10. **mypy about-pages 404 — boundary quote stands in via ruff FAQ.** mypy /en/stable/about.html and introduction.html returned 404, so the "linter vs type checker" boundary rests on ruff's own FAQ phrasing. Why unverifiable: no fetched mypy-authored equivalent statement. Verify: fetch current mypy docs landing/index and locate official scope language.
11. **DTZ family enumeration partial.** DTZ001–DTZ005 variants inferred from family navigation, not individually fetched (two guessed slugs 404'd before DTZ003 resolved). Why unverifiable: rules-index anchor page not directly retrieved. Verify: fetch the ruff flake8-datetimez family index and enumerate members.
12. **E721/F405/W3101 code attributions are ecosystem-convention, not fetched.** Type-compare (E721), star-import names (F405), and file-open (W3101/R1732) mappings came from general knowledge, not retrieved pages. Why unverifiable: pycodestyle/pylint/ruff pages for these codes absent from fetch budget. Verify: fetch each code's canonical rule page (pycodestyle source, ruff rules index, pylint message list) and confirm semantics.

## References

### Doctrine references [Pn]

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

### Reviewer references [Vn]

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

## Process Appendix

### Consolidation Provenance (2026-08-22)

- User-directed consolidation of two Python-doctrine workstream findings into one canonical doc; sources retained, banner-marked SUPERSEDED, do not extend.
- Key Findings, Recommendations, Unverified Claims, and References were carried verbatim from the source runs (only the [R→[P/[V citation prefixes were remapped); Detail Sections are condensed here with pointers to the full versions in the sources.
- Both source runs independently passed challenge/judge/verify; no re-retrieval was performed during consolidation.
- Declared artifact from the reviewer run remains canonical: `.agents/research/artifacts/2026-08-22-python-idiomatic-reviewer-rules.json`.
- Unrelated corpus docs (characterization ×2, csm-deep-research skill, LLM wiki, Disney+ ×2, Clojure→Python migration) are separate workstreams and untouched.

### Control Journal

```
[2026-08-22T00:00Z] CONSOLIDATION :: user-directed merge of pep20 + idiomatic-reviewer findings into this doc; sources banner-marked superseded
```

[2026-08-22T16:40Z] CONSOLIDATION -> SUPERSEDED :: cycle 1 :: trigger: complete consolidation landed in 2026-08-22-pep20-idiomatic-python-consolidated-research.md; this summary doc retained provenance-only.
