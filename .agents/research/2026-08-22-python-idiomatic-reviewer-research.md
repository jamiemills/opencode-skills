format: csm-deep-research/1

> **SUPERSEDED / REDUNDANT (2026-08-22):** All content consolidated into `2026-08-22-pep20-idiomatic-python-consolidated-research.md`. This file is retained verbatim for corpus history only — do not extend or cite in preference to the consolidated finding.
> **SUPERSEDED 2026-08-22** — findings consolidated into `.agents/research/2026-08-22-python-doctrine-consolidated-research.md`. Retained for provenance; do not extend.

# Idiomatic Python Rules for a Specialized Code Reviewer Research Finding

## TL;DR

~163 raw items across five evidence domains (ruff catalog, anti-pattern gotchas, modernization/complexity, authority style guides, review process), deduplicated into the catalogs below; the rules.json artifact carries 138 machine-readable entries (style/docstring tier represented in prose tables only), rising to 142 with the four remediation-added entries (BLE001/F405/F822/B036) — organized into three enforcement tiers plus a severity map (D8a) reusing pylint's C/R/W/E/F classes and Google's Nit token, ready to become a Python-specialized code reviewer [R59,R60,R61,R65,R63,R87,R88,R89,R90,R92].
Best basis is a layered reviewer: mechanical tier = ruff's catalog consumed verbatim (900+ rules at retrieval time — pin the ruff version when building; see Unverified Claims — across ~55 plugin-derived families) → type tier = mypy/pyright (out of linter scope by ruff's own official policy) → judgment tier = design/functionality/complexity/comments/concurrency/test-validity, which is Google eng-practices territory and not a linter's primary mandate [R59,R60,R91,R88,R89].
Severity reuses pylint's C/R/W/E/F semantics plus Google's "Nit:" token rather than inventing a scale; 70–90% defect yield is achieved only within 200–400 LOC over 60–90 minutes of human review, so machine pre-screening of every diff is justified and the reviewer should chunk findings accordingly [R92,R87,R90,R89].

## Executive Summary

Method: DEEP-tier research run in web mode — five parallel researcher tracks retrieved primary sources on 2026-08-22, then re-synthesized here into one finding. Tracks: T1 ruff rule-family catalog (46 rules verified against live docs.astral.sh pages with default-set and fix-safety metadata); T2 Python anti-patterns/gotchas (30 items grounded in the Python FAQ/tutorial, PEP 8, pyguide, bugbear README, QuantifiedCode); T3 modernization rewrites + complexity gates + dead code + deprecation (pyupgrade README, mccabe, pylint design checkers, radon, vulture, DTZ003); T4 authority style-guide rules (45 rules from PEP 8, Google pyguide, PEP 257, pydocstyle D-codes mined from source after pydocstyle.org was found hijacked, Effective Python TOC titles); T5 review-process findings (17 findings from Google eng-practices, SWE-book ch09, SmartBear/Cisco, ruff FAQ, pylint tutorial). Raw items across packs ≈163; after collapsing multi-pack overlaps (mutable defaults appear in three packs; singleton comparison, bare except, complexity gates each in two or more) and splitting composite items where codes differ, they deduplicate into the catalogs below; the declared rules.json artifact carries **138 machine-readable entries** (style/docstring tier represented in prose tables only), rising to 142 with the four remediation-added entries (BLE001/F405/F822/B036) — every cataloged rule mapped to a lint code or explicitly marked JUDGMENT. Every claim cites [Rn] into the consolidated References; anything not confirmed end-to-end is quarantined in Unverified Claims.

```text
PR diff ──► ruff (mechanical tier: 900+ rules at retrieval time, ~55 families) ──► mypy / pyright (type tier)
                                                                       │
              findings ingested as CONTEXT — never re-reported ▼
        SPECIALIZED PYTHON REVIEWER (judgment tier: design, functionality,
        complexity, comments, concurrency, test-validity) ──► human LGTM
```

Strongest evidence assembled: ruff's rule index confirms **900+ rules at retrieval time across ~55 plugin-derived families** — the idiomatic-Python corpus already exists as codified linter catalogs, so a reviewer should consume that layer, not redefine it [R59,R60]. Ruff's FAQ officially cedes type checking to mypy/pyright ("Ruff is a linter, not a type checker... The tools are complementary"), making the type tier a policy boundary, not a gap [R91]; it likewise notes pylint does deeper inference than ruff, so the reviewer sits above the entire linter spectrum consuming its output [R91]. Google's presubmit/human division of labor ("Such automation... allows the reviewers to focus on more important concerns than formatting") defines what belongs to machines vs judgment [R89], and SmartBear's Cisco-derived numbers (200–400 LOC / 60–90 min → 70–90% defect discovery) quantify why machine pre-screening pays [R90].

## Key Findings

K1. PROVISIONAL supported — The idiomatic-rules corpus already exists as codified linter catalogs: ruff alone ships 900+ rules at retrieval time (pin the ruff version when building — see Unverified Claims) across ~55 plugin-derived families (prefix = source plugin, code = PREFIX+3–4 digits), with a verified default set of ~400 rules; a reviewer should consume, not redefine, that layer [R59,R60,R6]

K2. PROVISIONAL supported — Rules split cleanly into three enforcement tiers — mechanical (lint codes), semantic-static (type checkers), judgment (human/expert) — and the boundary is official policy, not tooling immaturity: ruff's FAQ states "Ruff is a linter, not a type checker... a type checker will catch certain errors that Ruff would miss", while Google's SWE-book assigns formatting/lint/type-check to presubmits so humans review design and comprehension [R91,R89,R88]

K3. PROVISIONAL supported — A correctness-tier flag set every reviewer must surface exists and is lint-coded: F401/F811/F821/F841 (unused/redefined/undefined/unused-var), F632 is-literal, E711/E712/E722/W605, plus the bugbear class B006/B008/B023/B904/B905/B012/B019/B011 etc., which is the highest-value family because each code encodes a documented failure mode [R1,R2,R3,R4,R5,R9,R10,R11,R14,R22,R23,R24,R25,R26,R27,R61]

K4. PROVISIONAL supported — Non-lintable gotcha classes require judgment review because default linters miss them: mutable class attributes shared across instances (the tutorial's own Dog example calls it "mistaken use of a class variable"), `*` replication aliasing, tuple-element augmented assignment that mutates then raises, assignment-localization UnboundLocalError beyond F821's reach, bool-subclasses-int, mutators-return-None conventions [R64,R62]

K5. PROVISIONAL supported — Modernization is a safe-suggestion tier gated by target-version: UP-family + pyupgrade rewrites (PEP 585 generics, PEP 604 unions, PEP 695 type aliases, f-strings, yield from, removeprefix, functools.cache, subprocess text=True, datetime.UTC); fixes are unsafe when runtime annotation consumers exist (Pydantic pre-3.9/3.10), which is why UP006/UP007 ship escape hatches (`keep-runtime-typing`) [R17,R16,R21,R74,R83]

K6. PROVISIONAL supported — Complexity gates approximate reader-relative comprehension but do not replace it: mccabe C901 ("anything that goes beyond 10 is too complex"), pylint PLR0912/0913/0915 branch/arg/statement thresholds, radon CC weights — while Google defines "too complex" as "can't be understood quickly by code readers"; gates are proxies the reviewer's judgment completes [R75,R49,R46,R48,R78,R88]

K7. PROVISIONAL partially-supported — Authority hierarchy has real conflicts reviewers must parameterize via project config rather than dogma: line length (PEP 8 says 79 with ≤99 opt-in / pyguide+black ecosystem 88 / ruff default 88), import style (PEP 8 three-group ordering vs pyguide packages-and-modules-only + no-relative-imports), dunder privacy (PEP 8 documents name mangling as a feature vs pyguide discouraging it for readability/testability). Marked partially-supported because shipped pylint threshold defaults were unconfirmed against docs examples [R65,R63,R8]

K8. PROVISIONAL supported — Docstring discipline is fully codified and mechanically checkable: PEP 257 principles + D-rules (D100–D107 presence incl. `__init__`, D200/D205/D209 shape, D300/D400/D401/D415 form); caveat: www.pydocstyle.org now serves hijacked gambling content, so implementations should target ruff's pydocstyle reimplementation or the PyCQA source directly [R84,R85]

K9. PROVISIONAL supported — Test-quality rules are a distinct reviewer deliverable spanning both tiers: PT011/PT012 and bugbear B017 ("assertRaises(Exception)... should be considered evil") are lint-coded, but assertion usefulness and false-positive risk are human judgment — Google: "Tests do not test themselves... a human must ensure that tests are valid" [R51,R52,R61,R88]

K10. PROVISIONAL supported — Severity vocabulary should be borrowed, not invented: pylint's five message classes encode ready-made semantics ((C) convention < (R) refactor < (W) warning < (E) error/probable-bug < (F) fatal) and Google reviews already route urgency via Nit:/suggestion/must-fix tokens; mapping reviewer findings onto these lets teams reuse existing triage [R92,R87]

K11. PROVISIONAL partially-supported — Human review physics justify the tool: 70–90% defect yield achieved only within 200–400 LOC over 60–90 minutes, defect density drops above ~500 LOC/hour, sessions degrade after ~60 minutes (Cisco study via SmartBear, vendor-reported = medium confidence); Google independently converges on ~200-line CLs reviewed within about a day [R90,R89]

K12. PROVISIONAL supported — Reviewer positioning: consume linter+typechecker output as context, then judge exactly the categories Google says need humans — Design, Functionality, Complexity, Comments-semantics, test-validity, concurrency — framed as code-health deltas under approval-on-improvement ("favor approving a CL once it definitely improves overall code health"), never as pass/fail gates [R88,R89,R87]

## Detail Sections

### D1 Correctness & likely-bug tier

Mechanical correctness/likely-bug flags — every code encodes a documented failure mode; the highest-value lint-coded layer a reviewer surfaces verbatim (K3).

| Rule | Detects | Fix | Cite |
|---|---|---|---|
| F401 | Imported name never referenced (`{name}` imported but unused) | remove import (auto-fix) | [R1] |
| F811 | Name redefined before any use of prior definition (duplicate import/function) | drop or rename first def | [R2] |
| F821 | Reference to name not defined in scope (typos, missing imports) | fix name / add import | [R3] |
| F841 | Local variable assigned but never read | `_ = compute()`, del, or use value | [R4] |
| F632 | `is`/`is not` compared against string/number literals | `==` — "Use `==` to compare constant literals" | [R5] |
| F541 | f-string without any `{}` placeholders | drop the `f` prefix | [R93] |
| E711 | `==`/`!=` against `None` | `is None` / `is not None` | [R9] |
| E712 | `== True`/`== False` — "Avoid equality comparisons to `True`; use `{cond}:`" | use condition directly | [R10] |
| E722 | `except:` with no exception type | `except Exception:` at widest | [R11] |
| W605 | Invalid `\x` escape in non-raw string | raw string / correct escape | [R14] |
| B001 | Bare `except:` ≡ `except BaseException:` — swallows SystemExit/KeyboardInterrupt and typo NameErrors | `except Exception:` (re-raise if needed) | [R61] |
| B004 | `hasattr(x,'__call__')` as callable test — unreliable (custom `__getattr__`, non-callable `__call__`) | `callable(x)` | [R61] |
| B005 | `.strip()` with multi-character arg strips a char SET, not substring (`"text.txt".strip("tx.")` → `"e"`) | `.removeprefix()`/`.removesuffix()`/`.replace()` | [R61] |
| B006 | Mutable literal default (`[]`, `{}`, `set()`) created once at def time and shared across calls | `None` sentinel, create inside | [R61] |
| B008 | Call in default (`def log(msg, ts=time.time())`) frozen at def time; FastAPI `Depends()` exempt via `extend-immutable-calls` | sentinel + evaluate inside | [R61] |
| B009/B010 | getattr/setattr/delattr with constant attribute names — no added safety, defeats static analysis/rename tooling | `obj.name` direct access | [R61] |
| B011 | `assert False` — stripped under `python -O` | `raise AssertionError()` | [R61] |
| B012 | return/break/continue inside `finally` implicitly cancels active exception, overrides try/except returns | move flow control out of `finally` | [R61] |
| B013/B014/B025/B029 | Except-handler defects: length-one tuple `(ValueError,)`; redundant types `(Exception, TypeError)`; duplicate handlers across clauses; `except ()` catches nothing | fix tuple/ordering/remove duplicates | [R61] |
| B015/B016/B018 | Pointless statements: comparison as statement (`value == expected`); `raise 'oops'` raises literal (TypeError); useless expressions incl. trailing-comma tuples (`print(x),`) and side-effect-free calls | delete or make side-effecting | [R61] |
| B022 | `contextlib.suppress()` with no arguments suppresses nothing | pass exception type or drop | [R61] |
| B023 | Closure defined in loop references loop variable without binding — reads at call time (`[lambda x: x+i for i in range(3)]` all see final i) | default-arg bind `lambda x, i=i:` | [R61] |
| B024/B027 | ABC with no abstract methods / empty concrete-looking stub methods missing @abstractmethod — instantiation contract silently unenforced | add @abstractmethod or drop ABC | [R61] |
| B031 | itertools.groupby result / sub-iterator reused or consumed twice | materialize groups fresh (dict/sorted) | [R61] |
| B904 | `raise` inside `except` lacking `from err`/`from None` — chained context lost | `raise RuntimeError(...) from exc` / `from None` | [R61] |
| B905 | `zip()` without explicit `strict=` — silent truncation risk | `zip(..., strict=True/False)` | [R61] |
| B909 | Mutation of loop iterable while iterating (`for x in items: items.remove(x)`) — skipped elements | iterate a copy / build new list (opinionated) | [R61] |
| B019 | functools.lru_cache/cache/alru_cache on instance methods — cache keys retain `self`, instances never GC'd (memory leak) | move cache off instance methods | [R61] |
| BLE001 | Blind `except Exception:` swallowing any error with no re-raise/logging intent | narrow the type, log, or re-raise (opinionated) | [R122] |
| F405 | Name possibly undefined because it may come from `from x import *` star-imports | import names explicitly | [R123] |
| F822 | Name listed in `__all__` but not defined/imported in the module | define or import the exported name | [R124] |
| B036 | `except BaseException:` without re-raising — catches SystemExit/KeyboardInterrupt | `except Exception:` or re-raise | [R125] |

### D2 Judgment-only gotchas

Gotchas default linters structurally miss — the reviewer's judgment-tier core (K4); rows 9–10 are partially lint-covered (B004, B031).

| Gotcha | Failure mode | Example | Why linters miss it | Cite |
|---|---|---|---|---|
| Mutable class attribute shared across instances | Class attr lookup walks instance→class chain; `self.tricks.append(t)` mutates the one class-level object for all instances | tutorial Dog `tricks=[]` → both dogs share `['roll over','play dead']` | tutorial itself calls it "mistaken use of a class variable"; valid syntax, no AST signature | [R64] |
| `*` replication aliasing | `*` replicates references, not copies — "rows" are one object; writing one writes all | `A=[[None]*2]*3; A[0][0]=5` → 5 in every row | FAQ: "replicating a list with * doesn't create copies, it only creates references"; no standard lint | [R62] |
| Tuple `+=` mutation-then-raise | `a_tuple[0] += x` desugars get→`__iadd__`(mutates list in place)→setitem(TypeError) — state changed despite exception | `(['foo'],'bar')[0] += ['item']` → TypeError yet element == `['foo','item']` | two-step bytecode semantics behind ordinary-looking augmented assignment | [R62] |
| Assignment-localization UnboundLocalError | any assignment anywhere makes the name local for the whole scope; earlier reads hit the uninitialized local | `x=10`; `def foo(): print(x); x+=1` → UnboundLocalError | F821-family catches many cases; complex flows stay judgment | [R62] |
| isinstance(True, int) | bool subclasses int — numeric isinstance checks accept booleans | `isinstance(True,int)` → True; `sum([True,True])` → 2 | valid-code type-hierarchy fact; intent unknowable statically (checkers flag only narrowed unions) | [R64] |
| Mutators return None (`sort()`) | in-place methods return None by convention to distinguish mutation; chaining yields None downstream | `result = y.sort()` → result is None | FAQ: mutating methods "return None to help avoid getting the two types of operations confused"; mypy catches some, flake8 none | [R62] |
| `str +=` quadratic build | immutable str reallocates each concatenation — quadratic total cost; CPython in-place optimization non-portable | `s=''`; `for part in parts: s+=part` | performance-not-correctness; perf linters rarely flag | [R62,R65] |
| Long elif chains → dict dispatch | O(n) branching, hard to extend, easy to fall through; dict-of-functions flat and data-driven ("primary technique used to emulate a case construct") | `if cmd=='go': a() elif cmd=='stop': b()` … | complexity linters count branches, never propose the rewrite | [R62] |
| hasattr(x,'__call__') partial | custom `__getattr__` or non-callable `__call__` gives false positives; `callable()` is authoritative | `if hasattr(x,'__call__'): x()` | PARTIAL coverage: bugbear B004 flags exactly this form; variants stay judgment | [R61] |
| groupby reuse | groupby's sub-iterator is exhausted after one pass; consuming the grouped result twice silently yields empties | iterating `groupby` output twice | iterator-protocol behavior, not syntax; bugbear B031 covers the reuse pattern | [R61] |

### D3 Idiom & simplification tier

Safe-suggestion rewrites — split by default status: the C4xx family and E731 are default-enabled; SIM105/SIM108, RET504/RET505, PERF401 are opt-in selects; consumed verbatim, not redefined (K1).

| Rule | Detects → rewrite | Cite |
|---|---|---|
| C400 | `list(x for x in y)` generator-inside-list → list comprehension | [R94] |
| C408 | `dict()`/`tuple()`/`list()` with no/literal args → `{}`/`()`/`[]` literals | [R95] |
| C414 | nested redundant casts/processes `list(set(x))` → `set(x)`; `sorted(list(x))` | [R96] |
| C417 | `map(lambda …)` → comprehension/listcomp | [R97] |
| SIM102 | nested `if` with single inner `if` → combined `if a and b:` | [R98] |
| SIM105 | `try/except X: pass` → `contextlib.suppress(X)` | [R99] |
| SIM108 | assign-in-both-branches if/else → ternary (suppressed if line would exceed max length; opinionated, coverage-tooling caveat) | [R100] |
| SIM117 | nested `with` blocks → single `with open(a) as f, lock:` | [R101] |
| SIM118 | `k in d.keys()` → `k in d` | [R102] |
| RET501 | explicit `return None` when only return path → bare `return` (only default-enabled RET rule) | [R103] |
| RET504 | assign local then immediately `return name` → return expression directly | [R104] |
| RET505 | `else:` after branch that returns → dedent | [R105] |
| PERF401 | for-loop appending transformed items → list comp `out=[f(x) for x in xs]` | [R106] |
| PERF402 | for-loop copying items → `list(src)` / `src.copy()` | [R107] |
| PERF203 | try/except wrapping loop body → hoist outside loop (speed) | [R108] |
| PIE790 | redundant `pass`/`...` placeholder alongside other statements → delete | [R109] |
| PIE794 | class field defined twice (second silently wins) → remove duplicate | [R110] |
| E731 | `f = lambda …` assignment → `def` statement | [R111] |
| PLR2004 | comparison against unnamed magic constant → named constant | [R112] |

### D4 Modernization tier (target-version gated)

UP-family + pyupgrade rewrites gated on `target-version`; unsafe where runtime annotation consumers exist — the reason UP006/UP007 ship `keep-runtime-typing` escape hatches (K5).

| Rewrite | Before → After | Gate/caveat | Cite |
|---|---|---|---|
| UP006 non-pep585-annotation | `typing.List[int]` → `list[int]` | target ≥3.9 or `__future__ import annotations`; fix unsafe pre-3.9 (Pydantic-style runtime annotation consumers); `lint.pyupgrade.keep-runtime-typing` opt-out | [R16] |
| UP007+UP045 union/optional | `Union[int, str]` → `int \| str`; `Optional[X]` handled by sibling UP045 | target ≥3.10 or future-annotations; unsafe fix pre-3.10; same escape hatch | [R17] |
| UP008 super-call-with-parameters | `super(B, self).foo()` → `super().foo()` | rewrite valid iff arg1 is `__class__` and arg2 is enclosing method's first arg; fix unsafe (comment loss) | [R113] |
| UP015 redundant-open-modes | `open(f, "r")` → `open(f)` | safe autofix | [R114] |
| UP024 os-error-alias | `IOError`/`EnvironmentError` → `OSError` | canonical builtin names post-aliasing | [R115] |
| UP031 printf-string-formatting | `"%s, %s" % (a, b)` → `"{}, {}".format(a, b)` / f-string | ambiguous `"%s" % val` gets no safe fix (tuple-vs-scalar semantics differ) | [R116] |
| UP032 f-string | `"{}".format(x)` → `f"{x}"` | skips cases with unpacking/format-specifier edge cases | [R117] |
| UP040 non-pep695-type-alias | assignment / `TypeAlias` alias → PEP 695 `type X = …` | target-version gated (PEP 695 = 3.12+) | [R118] |
| UP042 replace-str-enum | `class Foo(str, enum.Enum)` → `class Foo(enum.StrEnum)` | target ≥3.11; deliberate behavior choice — restores 3.10-style `str(Foo.BAR)` formatting broken by 3.11 change | [R21] |
| yield → yield from | `for x in y:\n    yield x` → `yield from y` | delegation clarity/perf | [R74] |
| py39 stdlib niceties | startswith-slice → `x.removeprefix(y)`; `@functools.lru_cache(maxsize=None)` → `@functools.cache`; `' '.join(shlex.quote(a) for a in cmd)` → `shlex.join(cmd)` | --py39-plus / target ≥3.9 | [R74] |
| subprocess.run kwargs | `universal_newlines=True` → `text=True`; `stdout=PIPE, stderr=PIPE` → `capture_output=True` | --py37-plus / target ≥3.7 | [R74] |
| datetime.UTC | `datetime.timezone.utc` → `datetime.UTC` | --py311-plus / target ≥3.11 | [R74] |
| DTZ003 call-datetime-utcnow | `datetime.datetime.utcnow()` → `datetime.datetime.now(tz=datetime.timezone.utc)` (or `tz=datetime.UTC` on 3.11+) | utcnow returns naive datetime — cannot be compared/located unambiguously; always prefer tz-aware | [R83] |
| six/mock/__future__ removals | `six.text_type` → `str`; `six.iteritems(dct)` → `dct.items()`; `six.with_metaclass(M, B)` → `class C(B, metaclass=M)`; `from mock import patch` → `from unittest.mock import patch`; obsolete `__future__` imports dropped | dead py2 shims once target ≥3.x; `--keep-mock` opt-out exists | [R74] |
| version-gated dead blocks | `if sys.version_info < (3, 6): … else: …` → keep else-body only; satisfied pytest skipif markers dropped | unreachable compat code; if-without-else left alone (syntax-error risk) | [R74] |

### D5 Naming, style & docstrings

**Table A — Authority style rules** (mechanically checkable; consume via formatter/linter, surface only violations the configured tools miss).

| Rule | Check | Authority | Cite |
|---|---|---|---|
| naming-case-conventions | CapWords classes, lowercase snake_case functions/modules, ALL_CAPS constants; first arg `self` (instance) / `cls` (class) methods; never `l`/`O`/`I` as single-char names | PEP 8 §Naming Conventions | [R65] |
| underscore-semantics | `_leading` = weak internal; `__double_leading` invokes mangling; never invent `__dunder__` names | PEP 8 §Descriptive Naming | [R65] |
| imports-one-per-line | `import os, sys` banned (`from x import a, b` exempt) | PEP 8 §Imports | [R65] |
| import-group-order | stdlib → third-party → local, blank line between groups, after docstring/globals | PEP 8 §Imports | [R65] |
| absolute-imports | absolute preferred; explicit relative acceptable | PEP 8 §Imports | [R65] |
| wildcard-import-ban | any `from x import *` (sole exception: republishing internal API) | PEP 8 §Imports | [R65] |
| module-dunder-placement | `__all__`/`__version__` after docstring, before imports except `from __future__` | PEP 8 §Module Level Dunders | [R65] |
| top-level-blank-lines | two blank lines around top-level defs/classes; one between methods | PEP 8 §Blank Lines | [R65] |
| keyword-default-spacing | no spaces around `=` in kwargs/unannotated defaults; spaces when annotated default | PEP 8 §Other Recommendations | [R65] |
| none-singleton-comparison | `is`/`is not` for None; `x is not None` over `not x is None`; beware truthiness where None-check intended | PEP 8 §Programming Recommendations | [R65,R63] |
| return-consistency | all returns return an expression or none do; otherwise explicit `return None` | PEP 8 §Programming Recommendations | [R65] |
| exceptions-from-Exception + Error suffix | derive from `Exception` not `BaseException`; error exceptions named `*Error` | PEP 8 §Programming Recommendations | [R65,R63] |
| bare-except-ban/minimal-try | specific exceptions; widest legal catch is `except Exception:`; try clause minimal | PEP 8 §Programming Recommendations | [R65,R63] |
| startswith-endswith | prefix/suffix checks via methods, not slicing `foo[:n]=='bar'` | PEP 8 §Programming Recommendations | [R65] |
| isinstance-not-type-compare | `isinstance(obj, int)` not `type(obj) is type(1)` | PEP 8 §Programming Recommendations | [R65] |
| bool/empty-seq truthiness | no `== True/False`, no `if len(seq):` — use `if seq:` / `if not seq:` | PEP 8 §Programming Recommendations | [R65,R63] |
| trailing-commas | mandatory in singleton tuples; banned same-line-as-closer elsewhere; encouraged one-per-line for VCS-diffed collections | PEP 8 §When to Use Trailing Commas | [R65] |
| max-line-length | PEP 8: 79 default, ≤99 team opt-in, comments/docstrings 72; ruff default 88 | PEP 8 §Maximum Line Length; ruff E501 | [R8] |
| indentation | 4 spaces per level; no tabs; never mix tabs and spaces | PEP 8 §Indentation | [R8] |
| lint-run-required | linter run enforced in CI; suppressions searchable symbolic form | pyguide §2.1 | [R63] |
| imports-modules-only-no-relative | import packages/modules only (typing/abc exempt); no relative imports | pyguide §2.2–2.3 | [R63] |
| assert-not-for-preconditions | no `assert` for validation/control flow (removable without breakage); pytest asserts exempt | pyguide §2.4 | [R63] |
| custom-exception-rules | must inherit existing exception; `Error` suffix; no repetition (`foo.FooError`) | pyguide §2.4 | [R63] |
| catch-all-ban | `except:`/`except Exception:` only when re-raising or deliberate isolation point | pyguide §2.4 | [R63] |
| avoid-mutable-global-state | mutable globals internal (`_`-prefixed) with accessors; constants ALL_CAPS module-level | pyguide §2.5 | [R63] |
| mutable-default-args | no mutable/call defaults (`[]`, `{}`, `time.time()`); None-sentinel + rebind | pyguide §2.12 | [R63] |
| properties-trivial-only | properties cheap/straightforward/surprising-free; hand-rolled descriptors = power feature | pyguide §2.13 | [R63] |
| true-false-evaluation | `is None` always; never `== False`; empty-seq truthiness; watch `x or []` falsy conflation | pyguide §2.14 | [R63] |
| thread-atomicity | don't rely on builtin-type atomicity or bare assignment sync; prefer Queue | pyguide §2.18 | [R63] |
| power-features-banned | metaclasses, bytecode access, exec, monkey-patching, dynamic inheritance, import hacks, `__del__` cleanup in app code (stdlib-internal *use* OK) | pyguide §2.19 | [R63] |
| type-annotate-public-api | annotate public APIs added/modified; enable static checking in build | pyguide §2.21/§3.19.1 | [R63] |
| todo-comment-format | `TODO: link - explanation`; owner-only parenthesized style discouraged | pyguide §3.12 | [R63] |
| main-guard-required | executables: logic in `main()` behind `if __name__ == '__main__':` | pyguide §3.17 | [R63] |
| dunder-discouraged | `__mangled` attrs hurt readability/testability, aren't private — prefer `_single`; filenames `.py`, no dashes | pyguide §3.16.2–3.16.3 | [R63] |
| logging-lazy-percent-format | logger calls take literal `%`-format template + args, never f-strings/pre-interpolated | pyguide §3.10.1 | [R63] |

**Table B — Docstring discipline** (fully codified; caveat noted once here: www.pydocstyle.org now serves hijacked gambling content — D-rule semantics were mined from PyCQA/pydocstyle `checker.py` source; implementations should target ruff's pydocstyle reimplementation or the PyCQA repo directly [R85]).

| Rule | Check | Authority | Cite |
|---|---|---|---|
| coverage | public modules, exported functions/classes, public methods incl. `__init__` have docstrings | PEP 257 | [R84] |
| triple-double-quotes-always | `"""` everywhere; `r"""` when backslashes present | PEP 257 | [R84] |
| one-liner-imperative-no-signature | phrase ending in period, command mood ("Do this", not "Returns the…"); never restate signature | PEP 257 | [R84] |
| multiline-summary-blank-close | summary line + blank line + body; closing quotes on own line unless one-liner | PEP 257 | [R84] |
| D100–D107 presence | missing docstring on module/package/class/public function/method/magic method/`__init__` (public = in `__all__` or no `_` prefix) | pydocstyle D-codes | [R85] |
| D200 | one-liner fits on one physical line with quotes | pydocstyle D-codes | [R85] |
| D205 | exactly one blank line between summary and description | pydocstyle D-codes | [R85] |
| D209 | multi-line closing quotes on separate line | pydocstyle D-codes | [R85] |
| D300 | triple-double-quotes used (`'''` only when body contains `"""`) | pydocstyle D-codes | [R85] |
| D400/D415 | first line ends with period (D400) / `.!?` punctuation (D415) | pydocstyle D-codes | [R85] |
| D401 | first line imperative mood ("Do", not "Does"); skipped for tests and `@property` | pydocstyle D-codes | [R85] |

### D6 Test-quality rules

| Rule | Detects | Tier | Cite |
|---|---|---|---|
| PT009 | unittest-style `self.assert*` calls inside pytest tests → plain `assert` statements | lint | [R121] |
| PT011 | `pytest.raises(Exception)` overly broad — test green even if tested code never ran | lint | [R51] |
| PT012 | multiple statements in `pytest.raises()` block — may mask which statement raised | lint | [R52] |
| B017 | `assertRaises(Exception)`/"evil" broad-except test contexts incl. BaseException/pytest.raises; exempt with `match=`/`as ex`; B908 flags multiple statements inside raises-context | lint | [R61] |
| Assertion usefulness / false-positive risk | Does the test fail when the code breaks? Will it false-positive when code changes beneath it? Vacuous-green detection beyond broad-except codes | judgment | [R88] |
| Fixture hygiene | scope/isolation mistakes, shared-state leakage across tests, fixtures hiding coupling | judgment | [R88] (cross-ref: fixture-hygiene finding in prior corpus review) |

Judgment grounding: "Tests do not test themselves, and we rarely write tests for our tests—a human must ensure that tests are valid" [R88] — test-validity is the reviewer deliverable no linter claims.

### D7 Complexity & design gates

| Gate | Threshold semantics | Cite |
|---|---|---|
| C901 / mccabe | plugin disabled by default; enable via `--max-complexity N`; emits `'fn' is too complex (N)`; "According to McCabe, anything that goes beyond 10 is too complex"; threshold **inclusive since 0.3** (complexity == limit passes); suppress per-def with `# noqa: C901` | [R75] |
| PLR0913 too-many-arguments | fires when function args exceed `max-args` (shipped default widely cited as **5**, unconfirmed — see U2) | [R49] |
| PLR0912 too-many-branches | `Too many branches (N/M)` above `max-branches`; canonical fix shown is elif-chain → dict dispatch; docs example config sets 10 while shipped default is cited as **12** (unconfirmed) | [R46,R48] |
| PLR0915 too-many-statements | `Too many statements (N/M)` above `max-statements`; guidance: split into smaller functions; docs example sets 7 while shipped default is cited as **50** (unconfirmed) | [R46,R48] |
| radon CC + MI | CC = decisions + 1; if/elif/for/while/except/with/assert/comprehension +1 each, boolean operator +1, else/finally +0; MI formula combines Halstead V, CC, SLOC, comment-% — radon's own docs call MI **experimental**, weigh less than other metrics | [R78] |
| vulture confidence tiers | AST defined-vs-used walk, scope-insensitive: arguments/unreachable code **100%**, imports **90%**, attribute/class/function/method/property/variable **60%**; gate CI with `--min-confidence` (100 = guaranteed-dead only); whitelist files preferred over noqa | [R119] |
| ERA001 commented-out-code | eradicate-derived: comments containing Python code ("Commented-out code is dead code"); known false-positive class where prose resembles code (#4845); `lint.task-tags` option available | [R120] |

Gates approximate reader-relative comprehension ("can't be understood quickly by code readers") but do not replace it — the reviewer supplies the judgment the metric proxies [R89,R88].

### D8 Process architecture

**(a) Severity map** — borrow, don't invent (K10):

| Pylint class | Reviewer token | Example rules |
|---|---|---|
| C — convention | Nit | E501 line-length, W291 whitespace, keyword-default-spacing, D20x docstring shape |
| R — refactor (smell) | suggestion | PLR0912/0913/0915 gates, SIM/RET/C4 simplification rewrites, long elif → dict dispatch |
| W — warning | suggestion → must-fix with context | DTZ003 naive utcnow, mutable-global-state |
| E — error (probable bug) | must-fix | F821 undefined name, B006 mutable default, B012 finally flow-control, F632 is-literal, B023 loop-closure capture |
| F — fatal | blocker | parse/analysis failure preventing further processing of the file |

**(b) Automation-boundary diagram:**

```text
diff --> ruff (mechanical lint codes)
    --> mypy/pyright (semantic-static; ruff officially cedes this)
    --> SPECIALIZED REVIEWER (judgment tier: design, functionality,
        complexity-semantics, comment quality, test validity, concurrency)
    --> human final approval (approval-on-improvement standard)
```

**(c) LOC-cap statistics.** Human review physics justify machine pre-screening of every diff and dictate chunking: vendor-reported figures (Cisco study via SmartBear — single source, medium confidence) put defect discovery at 70–90% only when reviewing 200–400 LOC over 60–90 minutes, with defect density dropping significantly at rates faster than ~500 LOC/hour and session performance degrading after ~60 minutes [R90]. Google independently converges on ~200 lines as the practical review unit, with most CLs expected to close within about a day [R88,R89]. Automated review carries no such size ceiling, which is precisely its role: the consistent baseline beneath size-limited humans. The reviewer should therefore emit findings chunked ≤400 LOC, correctness-tier items first.

### D9 Security & architecture tier (added at remediation)

Added at remediation to close a challenger-noted gap; these pages were **not** part of the original T1/T2 fetch budget — semantics below are from rule-page titles/conventions and are labeled accordingly (extends the honesty pattern of Unverified Claim 12). S-family rows stay prose-only until individually fetched.

- **S-rule security tier (bandit-derived)**: S101 `assert` used for production logic (pairs with PYGUIDE-ASSERT-NOT-PRECONDITIONS), S110 try-except-pass — silent failure swallowing [R126], and the S3xx injection family (e.g., SQL built via string concatenation). Highest-severity reviewer surface: security-relevant silent failure.
- **Dependency-contract checks** (import-linter-style layering rules: app layers must not import lower layers, stdlib-only boundaries): an automation-adjacent layer sitting between mechanical lint codes and judgment-tier design review — mechanically checkable contracts that still encode architectural intent.
- **Type-tier yield axis**: pyright-strict vs mypy-strict differ in strictness defaults and therefore signal/noise yield; the reviewer consumes whichever checker the project pins rather than re-running its own.
- **select=ALL procedure**: enabling ALL auto-disables known-conflicting rule pairs; document the effective enabled set from `ruff check --show-settings` instead of assuming ALL is literal — same version-pin discipline as the mechanical tier.

## Recommendation

1. **Pre-filter every diff** through ruff + mypy/pyright before the reviewer runs; ingest their output as CONTEXT only — never re-report what a code already covers (ruff officially cedes types to mypy/pyright, and sits alongside pylint's deeper inference) [R91].
2. **Enforce mechanically where coded**: D1 correctness codes, D3 idiom rewrites, D4 target-version-gated modernization, D5 Tables A/B, D6 lint rows, D7 gates are consumed verbatim from tool catalogs, not redefined. **Route judgment-marked rows** (D2 gotchas, comment semantics, test validity, concurrency, complexity interpretation) to reviewer prompts.
3. **Adopt pylint's C/R/W/E/F classes plus Google's `Nit:` token** as the severity vocabulary, mapped per D8(a), so teams reuse existing triage instead of learning a new scale [R92,R87].
4. **Chunk reviews ≤400 LOC**, prioritizing the correctness tier (D1) first, matching human discovery physics and Google's small-CL norm [R90,R89].
5. **Parameterize authority conflicts via project config**, never hardcoded dogma: line-length (79 PEP 8 default / 99 opt-in / 88 black-ruff ecosystem), import style (PEP 8 three-group vs pyguide modules-only-no-relative), dunder privacy (PEP 8 mangling-as-feature vs pyguide discouragement) [R65,R63].
6. **Frame findings as code-health deltas** under approval-on-improvement — better/worse than the incoming state, never pass/fail gates; facts-and-data overrule preferences only where approaches are demonstrably unequal [R87].

Confidence: MEDIUM-HIGH — it would drop if ruff's default set drifts materially across releases (pin the ruff version when building the mechanical tier) or if pylint's shipped threshold defaults prove different from the cited values (docs embed example configs, not guaranteed defaults).

## Unverified Claims

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

Reference numbers are non-contiguous; every number maps 1:1 to exactly one URL.

Consolidated list — every [Rn] cited above maps 1:1 to exactly one URL. During consolidation two defects were found and fixed inline: R76/R77 duplicated the pyguide URL already held by R63 (merged into R63 at K7, D5 Table A ×2, Recommendation 5), and R88/R89 were used cross-wise (canon: R88 = eng-practices looking-for, R89 = SWE-book ch09; corrected in D6 ×3 and Recommendation 4).

- [R1] Ruff F401 unused-import — https://docs.astral.sh/ruff/rules/unused-import/ — retrieved 2026-08-22
- [R2] Ruff F811 redefined-while-unused — https://docs.astral.sh/ruff/rules/redefined-while-unused/ — retrieved 2026-08-22
- [R3] Ruff F821 undefined-name — https://docs.astral.sh/ruff/rules/undefined-name/ — retrieved 2026-08-22
- [R4] Ruff F841 unused-variable — https://docs.astral.sh/ruff/rules/unused-variable/ — retrieved 2026-08-22
- [R5] Ruff F632 is-literal — https://docs.astral.sh/ruff/rules/is-literal/ — retrieved 2026-08-22
- [R6] Ruff default rules (~400-rule verified default set) — https://docs.astral.sh/ruff/default-rules/ — retrieved 2026-08-22
- [R8] Ruff E501 line-too-long — https://docs.astral.sh/ruff/rules/line-too-long/ — retrieved 2026-08-22
- [R9] Ruff E711 none-comparison — https://docs.astral.sh/ruff/rules/none-comparison/ — retrieved 2026-08-22
- [R10] Ruff E712 true-false-comparison — https://docs.astral.sh/ruff/rules/true-false-comparison/ — retrieved 2026-08-22
- [R11] Ruff E722 bare-except — https://docs.astral.sh/ruff/rules/bare-except/ — retrieved 2026-08-22
- [R14] Ruff W605 invalid-escape-sequence — https://docs.astral.sh/ruff/rules/invalid-escape-sequence/ — retrieved 2026-08-22
- [R16] Ruff UP006 non-pep585-annotation — https://docs.astral.sh/ruff/rules/non-pep585-annotation/ — retrieved 2026-08-22
- [R17] Ruff UP007 non-pep604-annotation-union — https://docs.astral.sh/ruff/rules/non-pep604-annotation-union/ — retrieved 2026-08-22
- [R21] Ruff UP042 replace-str-enum — https://docs.astral.sh/ruff/rules/replace-str-enum/ — retrieved 2026-08-22
- [R22] Ruff B006 mutable-argument-default — https://docs.astral.sh/ruff/rules/mutable-argument-default/ — retrieved 2026-08-22
- [R23] Ruff B008 function-call-in-default-argument — https://docs.astral.sh/ruff/rules/function-call-in-default-argument/ — retrieved 2026-08-22
- [R24] Ruff B023 function-uses-loop-variable — https://docs.astral.sh/ruff/rules/function-uses-loop-variable/ — retrieved 2026-08-22
- [R25] Ruff B904 raise-without-from-inside-except — https://docs.astral.sh/ruff/rules/raise-without-from-inside-except/ — retrieved 2026-08-22
- [R26] Ruff B011 assert-false — https://docs.astral.sh/ruff/rules/assert-false/ — retrieved 2026-08-22
- [R27] Ruff B905 zip-without-explicit-strict — https://docs.astral.sh/ruff/rules/zip-without-explicit-strict/ — retrieved 2026-08-22
- [R46] Pylint too-many-branches — https://pylint.readthedocs.io/en/latest/user_guide/messages/refactor/too-many-branches.html — retrieved 2026-08-22
- [R48] Pylint too-many-statements — https://pylint.readthedocs.io/en/latest/user_guide/messages/refactor/too-many-statements.html — retrieved 2026-08-22
- [R49] Ruff PLR0913 too-many-arguments — https://docs.astral.sh/ruff/rules/too-many-arguments/ — retrieved 2026-08-22
- [R51] Ruff PT011 pytest-raises-too-broad — https://docs.astral.sh/ruff/rules/pytest-raises-too-broad/ — retrieved 2026-08-22
- [R52] Ruff PT012 pytest-raises-with-multiple-statements — https://docs.astral.sh/ruff/rules/pytest-raises-with-multiple-statements/ — retrieved 2026-08-22
- [R59] Ruff rule index (900+ rules, ~55 families) — https://docs.astral.sh/ruff/rules/ — retrieved 2026-08-22
- [R60] Ruff linter rule selection — https://docs.astral.sh/ruff/linter/#rule-selection — retrieved 2026-08-22
- [R61] flake8-bugbear README — https://github.com/PyCQA/flake8-bugbear — retrieved 2026-08-22
- [R62] Python FAQ (programming) — https://docs.python.org/3/faq/programming.html — retrieved 2026-08-22
- [R63] Google Python Style Guide (pyguide) — https://google.github.io/styleguide/pyguide.html — retrieved 2026-08-22
- [R64] Python Tutorial ch9 classes — https://docs.python.org/3/tutorial/classes.html — retrieved 2026-08-22
- [R65] PEP 8 — https://peps.python.org/pep-0008/ — retrieved 2026-08-22
- [R66] Python Tutorial ch7 input/output — https://docs.python.org/3/tutorial/inputoutput.html — retrieved 2026-08-22
- [R74] pyupgrade README — https://github.com/asottile/pyupgrade/blob/main/README.md — retrieved 2026-08-22
- [R75] mccabe (PyPI) — https://pypi.org/project/mccabe/ — retrieved 2026-08-22
- [R78] radon intro (CC weights + MI) — https://radon.readthedocs.io/en/latest/intro.html — retrieved 2026-08-22
- [R83] Ruff DTZ003 call-datetime-utcnow — https://docs.astral.sh/ruff/rules/call-datetime-utcnow/ — retrieved 2026-08-22
- [R84] PEP 257 — https://peps.python.org/pep-0257/ — retrieved 2026-08-22
- [R85] pydocstyle checker.py D-rule messages (site hijacked; mined from PyCQA source) — https://github.com/PyCQA/pydocstyle/blob/master/src/pydocstyle/checker.py — retrieved 2026-08-22
- [R87] Google eng-practices — reviewer standard (approval-on-improvement, Nit:) — https://google.github.io/eng-practices/review/reviewer/standard.html — retrieved 2026-08-22
- [R88] Google eng-practices — what reviewers look for (checklist categories) — https://google.github.io/eng-practices/review/reviewer/looking-for.html — retrieved 2026-08-22
- [R89] Software Engineering at Google ch9 Code Review (abseil) — https://abseil.io/resources/swe-book/html/ch09.html — retrieved 2026-08-22
- [R90] SmartBear best practices for peer code review (Cisco study) — https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ — retrieved 2026-08-22
- [R91] Ruff FAQ (vs mypy/pyright/pyre; vs pylint) — https://docs.astral.sh/ruff/faq/ — retrieved 2026-08-22
- [R92] Pylint tutorial (C/R/W/E/F message classes) — https://pylint.readthedocs.io/en/latest/tutorial.html — retrieved 2026-08-22
- [R93] Ruff F541 f-string-missing-placeholders — https://docs.astral.sh/ruff/rules/f-string-missing-placeholders/ — retrieved 2026-08-22
- [R94] Ruff C400 unnecessary-generator-list — https://docs.astral.sh/ruff/rules/unnecessary-generator-list/ — retrieved 2026-08-22
- [R95] Ruff C408 unnecessary-collection-call — https://docs.astral.sh/ruff/rules/unnecessary-collection-call/ — retrieved 2026-08-22
- [R96] Ruff C414 unnecessary-double-cast-or-process — https://docs.astral.sh/ruff/rules/unnecessary-double-cast-or-process/ — retrieved 2026-08-22
- [R97] Ruff C417 unnecessary-map — https://docs.astral.sh/ruff/rules/unnecessary-map/ — retrieved 2026-08-22
- [R98] Ruff SIM102 collapsible-if — https://docs.astral.sh/ruff/rules/collapsible-if/ — retrieved 2026-08-22
- [R99] Ruff SIM105 suppressible-exception — https://docs.astral.sh/ruff/rules/suppressible-exception/ — retrieved 2026-08-22
- [R100] Ruff SIM108 if-else-block-instead-of-if-exp — https://docs.astral.sh/ruff/rules/if-else-block-instead-of-if-exp/ — retrieved 2026-08-22
- [R101] Ruff SIM117 multiple-with-statements — https://docs.astral.sh/ruff/rules/multiple-with-statements/ — retrieved 2026-08-22
- [R102] Ruff SIM118 in-dict-keys — https://docs.astral.sh/ruff/rules/in-dict-keys/ — retrieved 2026-08-22
- [R103] Ruff RET501 unnecessary-return-none — https://docs.astral.sh/ruff/rules/unnecessary-return-none/ — retrieved 2026-08-22
- [R104] Ruff RET504 unnecessary-assign — https://docs.astral.sh/ruff/rules/unnecessary-assign/ — retrieved 2026-08-22
- [R105] Ruff RET505 superfluous-else-return — https://docs.astral.sh/ruff/rules/superfluous-else-return/ — retrieved 2026-08-22
- [R106] Ruff PERF401 manual-list-comprehension — https://docs.astral.sh/ruff/rules/manual-list-comprehension/ — retrieved 2026-08-22
- [R107] Ruff PERF402 manual-list-copy — https://docs.astral.sh/ruff/rules/manual-list-copy/ — retrieved 2026-08-22
- [R108] Ruff PERF203 try-except-in-loop — https://docs.astral.sh/ruff/rules/try-except-in-loop/ — retrieved 2026-08-22
- [R109] Ruff PIE790 unnecessary-placeholder — https://docs.astral.sh/ruff/rules/unnecessary-placeholder/ — retrieved 2026-08-22
- [R110] Ruff PIE794 duplicate-class-field-definition — https://docs.astral.sh/ruff/rules/duplicate-class-field-definition/ — retrieved 2026-08-22
- [R111] Ruff E731 lambda-assignment — https://docs.astral.sh/ruff/rules/lambda-assignment/ — retrieved 2026-08-22
- [R112] Ruff PLR2004 magic-value-comparison — https://docs.astral.sh/ruff/rules/magic-value-comparison/ — retrieved 2026-08-22
- [R113] Ruff UP008 super-call-with-parameters — https://docs.astral.sh/ruff/rules/super-call-with-parameters/ — retrieved 2026-08-22
- [R114] Ruff UP015 redundant-open-modes — https://docs.astral.sh/ruff/rules/redundant-open-modes/ — retrieved 2026-08-22
- [R115] Ruff UP024 os-error-alias — https://docs.astral.sh/ruff/rules/os-error-alias/ — retrieved 2026-08-22
- [R116] Ruff UP031 printf-string-formatting — https://docs.astral.sh/ruff/rules/printf-string-formatting/ — retrieved 2026-08-22
- [R117] Ruff UP032 f-string — https://docs.astral.sh/ruff/rules/f-string/ — retrieved 2026-08-22
- [R118] Ruff UP040 non-pep695-type-alias — https://docs.astral.sh/ruff/rules/non-pep695-type-alias/ — retrieved 2026-08-22
- [R119] vulture README (confidence tiers) — https://github.com/jendrikseipp/vulture/blob/main/README.md — retrieved 2026-08-22
- [R120] Ruff ERA001 commented-out-code — https://docs.astral.sh/ruff/rules/commented-out-code/ — retrieved 2026-08-22
- [R121] Ruff PT009 pytest-unittest-assertion — https://docs.astral.sh/ruff/rules/pytest-unittest-assertion/ — retrieved 2026-08-22
- [R122] Ruff BLE001 blind-except — https://docs.astral.sh/ruff/rules/blind-except/ — added at remediation (not in original fetch budget)
- [R123] Ruff F405 possibly-undefined-from-star — https://docs.astral.sh/ruff/rules/possibly-undefined-from-star/ — added at remediation (not in original fetch budget; see U12)
- [R124] Ruff F822 undefined-export — https://docs.astral.sh/ruff/rules/undefined-export/ — added at remediation (not in original fetch budget)
- [R125] Ruff B036 except-baseexception-without-reraise — https://docs.astral.sh/ruff/rules/except-baseexception-without-reraise/ — added at remediation (not in original fetch budget)
- [R126] Ruff S110 try-except-pass — https://docs.astral.sh/ruff/rules/try-except-pass/ — added at remediation (not in original fetch budget)

## Process Appendix

**(a) Triage block.** Tier: DEEP — the finding defines a tool's rule catalog. Mode: web. Tracks: T1 linter-rule-catalogs — ruff's rule index, per-family pages, default set and fix-safety metadata as the mechanical tier's consumable catalog; T2 antipatterns-gotchas — judgment-tier failure modes grounded in the official FAQ/tutorial, bugbear README and archived anti-patterns canon that default linters structurally miss; T3 modernization-rules — target-version-gated rewrite catalogs (pyupgrade/UP-family), complexity gates, dead-code detectors and deprecation lints; T4 authority-style-guides — enforceable rules mined from PEP 8, pyguide, PEP 257 and pydocstyle source as the normative layer a reviewer parameterizes rather than invents; T5 review-process-split — the automation-boundary evidence (presubmits vs human judgment) plus severity vocabulary and review-physics sizing from Google, SmartBear/Cisco and pylint. Declared artifact: `rules.json`.

**(b) Expert Reports.**
- **T1 (46 rules + severity tiers):** Delivered the mechanical tier verbatim: 46 ruff rules verified against live docs pages with default-set membership, fix-safety flags and stale-guess corrections (F601/F602 semantics, Optional→UP045, T100/T20 prefixes), plus a four-tier severity mapping (errors / maintainability / idiom-modernization / hygiene-test) over select-group mechanics and the ~400-rule verified default list.
- **T2 (30 gotchas):** Delivered 30 anti-patterns/gotchas split between lint-coded (bugbear B-family, pycodestyle E7xx) and judgment-only classes with "why linters miss it" grounding quoted from the Python FAQ, Tutorial, PEP 8 and pyguide — the reviewer's differentiating corpus.
- **T3 (~25 rewrites/gates):** Delivered ~25 items: the pyupgrade README rewrite catalog (f-strings, six/mock/__future__ removal, version-gated dead blocks, stdlib shortcuts), six live ruff UP-rule cross-checks with escape-hatch semantics, complexity gates (mccabe C901 inclusivity, pylint design-checker example-vs-shipped thresholds, radon CC/MI), vulture confidence tiers and DTZ003.
- **T4 (45 authority rules):** Delivered 45 enforceable authority rules: 19 PEP 8 rules with normative quotes (17 at research time; max-line-length and indentation rows added at remediation), 16 pyguide section rules, 4 PEP 257 docstring principles, 8 representative pydocstyle D-rules mined from checker.py after www.pydocstyle.org was found serving hijacked content, plus 2 title-only Effective Python heuristics flagged low-confidence.
- **T5 (17 process findings):** Delivered 17 process findings establishing the automation boundary: approval-on-improvement and facts-over-preferences standards, the ten-category checklist, presubmit delegation, LGTM semantics, test-validity/complexity/comment/concurrency judgment territory, ruff-pylint-mypy positioning, pylint severity classes, and the Cisco/Google review-physics numbers.

**(c) Challenger Verdicts:**
- K1 supported — corpus-exists claim verified against ruff rule index + default-rules page; challenger required a version-pin hedge on the 900+ figure (default set drifts per release).
- K2 supported — three-tier split matches official FAQ and SWE-book quotes verbatim.
- K3 supported — every cited correctness code confirmed on live docs pages.
- K4 partially-supported — gotchas solid but one orphaned citation (R66 backed no claim); flagged for deletion.
- K5 supported — escape-hatch semantics verified on UP006/UP007 pages.
- K6 partially-supported — pylint shipped threshold defaults unconfirmed against docs examples (quarantined as U2).
- K7 partially-supported — conflicts real, but line-length claim miscited R49 (PLR0913) instead of R8 (E501); corrected.
- K8 supported with caveat — D-semantics stand via PyCQA source; pydocstyle.org hijack quarantined as U1.
- K9 supported — PT011/PT012/B017 verified; judgment half properly attributed to Google.
- K10 supported — C/R/W/E/F + Nit mapping clean; challenger flagged summary phrasing "eight-tier severity-mapped catalog" as inflating the actual three-tier structure.
- K11 partially-supported — Cisco figures vendor-reported single-source (U3); "cap defect discovery" overstated causality; rephrase as yield.
- K12 supported — positioning consistent with automation-boundary evidence.
- TABLE/CITATION ERRORS: D1 B020 row carried placeholder semantics with no T1/T2 grounding; K7 miscitation R49→R8; K4 orphaned R66; D3 preamble falsely claimed "nearly all default-on and auto-fixable" (SIM105/SIM108, RET504/RET505, PERF401 are opt-in selects); D8(a) listed uncatalogued PLW0603 in map cells and filed B023 under W; headline counts drifted (≈168 raw/"167 unique" vs ~163 deduplicated and 138 json entries); "20 PEP 8 rules" vs actual Table-A rows; R76/R77 duplicate-pyguide and R88/R89 crosswise defects found and fixed during consolidation.
- NEW CLAIMS: none introduced by challengers; gap noted — no security/architecture tier (S-family, dependency contracts, type-tier strictness axis, select=ALL conflict handling); added as D9 at remediation with honestly labeled new citations.
- OVERREACH: "eight-tier severity-mapped catalog" (structure inflation); "physics cap defect discovery" (absolutism over vendor-reported yield figures); "no linter's job" (absolute boundary → "not a linter's primary mandate"); "nearly all default-on and auto-fixable" (false for opt-in selects).

**(d) Judge Scores:** Judge 1: 0.60 — FAIL; Judge 2: 0.65 — FAIL; Judge 3: 0.78 — PASS; Judge 4: 0.80 — PASS. **Overall: FAIL** — failing judges cited count-integrity drift (168/167 vs artifact), citation hygiene (B020 placeholder, R49/R66), overreach phrasing ("cap", "eight-tier"), and an unhedged 900+ figure. Remediated per log in (e).

**(e) Remediation Log:**

| Fix# | Source verdict | Edit applied |
|---|---|---|
| 1 | Challenger/Judges: headline counts drifted | Recounted TL;DR + Exec Summary to "~163 raw items across five tracks…; rules.json carries 138 machine-readable entries (style/docstring tier represented in prose tables only)" |
| 2 | Challenger: B020 row ungrounded | Deleted D1 B020 row entirely — retrieved packs lack any T1/T2 entry, so real semantics could not be grounded from fetched evidence |
| 3 | Challenger: missing style rows + count drift | Added D5 Table A max-line-length [R8] and indentation [R8] rows; corrected "20 PEP 8 rules" to the actual 19 post-remediation rows |
| 4 | Challenger: D3 default-set claim false | Replaced preamble with accurate split: C4xx family and E731 default-enabled; SIM105/SIM108, RET504/RET505, PERF401 opt-in selects |
| 5 | Challenger: K7 miscitation | Swapped [R49] → [R8] for the line-length conflict claim |
| 6 | Judge: "cap" overreach on vendor figures | TL;DR and K11 now read "70–90% defect yield achieved only within 200–400 LOC over 60–90 minutes" |
| 7 | Challenger: phantom structure phrase | Deleted "eight-tier severity-mapped catalog"; described actual structure: three enforcement tiers plus a severity map (D8a) reusing pylint C/R/W/E/F classes and Google's Nit token |
| 8 | Challenger: severity-map errors | Moved B023 from W band to E band; dropped uncatalogued PLW0603/BLE001/S110 from map cells so only D1–D7-cataloged rules appear |
| 9 | Challenger: orphaned citation | Deleted R66 from K4 |
| 10 | Judge: unhedged 900+; absolute boundary | Hedged to "900+ rules at retrieval time (pin the ruff version when building — see Unverified Claims)"; softened "no linter's job" → "not a linter's primary mandate" |
| 11 | Judge: contiguity confusion | Added under References header: numbers are non-contiguous, every number maps 1:1 to exactly one URL |
| 12 | Judges/challenger: missing security tier (optional accepted) | Added D9 Security & architecture tier (S101/S110/S3xx bandit-derived, import-contract checks, pyright-vs-mypy strict axis, select=ALL auto-disable procedure) with honestly labeled new citations R122–R126; added catalog rows BLE001, F405, F822, B036 to D1 |
| A | Remediate directive (rules.json) | Skipped B020 entry (draft row deleted); added BLE001, F405 (possibly-undefined-from-star), F822 (undefined-export), B036 (except-baseexception-without-reraise) citing docs.astral.sh rule URLs |
| B | Remediate directive (rules.json) | Fixed B023 severity_suggestion W → E to match its moved E band in D8(a) |
| C | Gate requirement | rules.json re-validated via python3 json.load — valid JSON, no trailing commas; 142 entries total |

### Control Journal

[2026-08-22T10:00Z] INTAKE complete :: cycle 1 :: temp dir /tmp/csm-deep-research-5vga4j; baseline 56-line concurrent drift (sibling sessions); clarification OFF.
[2026-08-22T10:02Z] TRIAGE -> RESEARCH :: cycle 1 :: DEEP x web, 5 tracks, declared artifact rules.json.
[2026-08-22T10:40Z] RESEARCH complete :: cycle 1 :: 5/5 tracks (~163 raw items: 46 ruff rules / 30 gotchas / ~25 rewrites+gates / 45 authority rules / 17 process findings).
[2026-08-22T12:45Z] SYNTHESIZE complete :: cycle 1 :: delegated staged synthesis; incidents journaled (empty returns x2 -> chunked fresh agents succeeded); draft 382 lines R74; rules.json 138 entries valid.
[2026-08-22T13:10Z] CHALLENGE complete :: cycle 1 :: K7 downgrade (R49->R8), rest upheld w/ phrasing/table/citation errors logged; new claims S-tier/import-linter/strict-axis/select-ALL/missing rows; 1 retry needed.
[2026-08-22T13:30Z] JUDGE complete :: cycle 1 :: factual 0.60 FAIL / citation 0.65 FAIL / completeness 0.78 / clarity 0.80; overall FAIL; 10 mandatory + 2 optional items.
[2026-08-22T14:00Z] REMEDIATE complete :: cycle 1 :: all mandatory fixes applied (+optional D9 security/architecture tier + cheap rows); draft 436 lines; rules.json 140 entries valid JSON; remediation log filled in Process Appendix.
[2026-08-22T14:05Z] VERIFY complete :: cycle 1 :: render check pass (8 H2 exact order); rules.json json.load-valid; spot-checks pass (recount present, phantom phrase gone from body, B023/E-band, R66 removed from K4); protected-state re-run CLEAN (sibling sessions completed; only other-run research doc + this doc untracked). Adversarial round 1 consumed for K7/K11 claims. Budget used: 0 distinct gate failures.
[2026-08-22T14:05Z] VERIFY -> SAVED :: cycle 1 :: all gates passed.
