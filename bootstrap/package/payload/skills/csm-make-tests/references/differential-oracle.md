# Differential Oracle

During a refactor window the old implementation is the strongest oracle available: run
old and new side by side over real inputs and diff the results. This reference covers
the mechanics, the hard safety caveat, calibration, and the division of labor with
goldens.

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Decision Mini-Tree

```text
Is the old path still callable alongside the new one?
  yes -> DIFFERENTIAL leads inside the window (this reference)
  no  -> wholesale replacement -> goldens only (capture-patterns.md)
```

## Scientist Pattern

GitHub Scientist is the canonical formulation: wrap the original behavior in a `use`
block (control) and the new behavior in a `try` block (candidate) [K25]:

```ruby
experiment = Scientist::Experiment.new("new-path")
experiment.use { old_impl(input) }   # control — its result is ALWAYS served
experiment.try { new_impl(input) }   # candidate — executed, compared, discarded
experiment.run
```

Semantics [K25]:

- the control result is always returned to callers — candidates cannot corrupt output;
- execution order is randomized to cancel ordering effects;
- wall-clock and CPU time are measured for both blocks;
- mismatches publish to a CAPPED collection, so a broken candidate cannot flood
  storage.

Maintained ports verified: Scientist.net (.NET), laboratory (Python), Scientist4J
(Java) [K25]. In any stack the pattern is small enough to hand-roll: invoke both,
compare, serve control, log mismatch — a library is optional.

## Hard Caveat: Read Paths Only

Quoted constraint: Scientist is "only safe for wrapping methods that aren't changing
data" [K25]. Both implementations really execute, so a faulty candidate must never
complete a write the control did not. Wrap read/query paths only — SKILL.md
DIFFERENTIAL step 3 forbids differentially wrapping data-mutating methods.

## Calibrate Before Trusting Mismatches

Start with an experiment in which BOTH blocks invoke the control method [K25]:

1. wire the try block to the control temporarily;
2. run over representative traffic;
3. the observed mismatch rate IS the comparison noise floor (ordering effects,
   nondeterminism, representation drift);
4. once the real candidate is wired, only mismatches above that floor are signal.

## Migration-Pattern Context

Differential checking sits inside the gradual-displacement playbook [K25]: Strangler
Fig incremental replacement, with coexistence strategies catalogued as parallel run,
event interception, and dark launching. Pick the coexistence mechanism per surface;
the oracle requirement is constant — old behavior stays observable while the new
behavior is compared against it.

## Traffic-Level Options

When the seam is a service boundary rather than a function call [K25]:

| Mechanism               | Shape                                                              | Caveat                                                      |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Istio traffic mirroring | out-of-band copy of live traffic to the mirrored service           | responses are DISCARDED — capture and diff outputs yourself |
| GoReplay                | record live HTTP, replay against both implementations, A/B compare | supports soak-style comparisons                             |

## Human Adjudication

Google's testing guidance calls A/B diff tests possibly the most common form of larger
testing during migrations — and warns the diffs need human adjudication: intended
behavior is not explicitly defined, so a person walks the differences [K25]. Route
surfaced diffs into TRIAGE like every other captured observation; never auto-classify
them.

## Division Of Labor With Goldens

- DIFFERENTIAL leads inside the refactor window while the old path stays callable —
  the old implementation IS the oracle, and no static golden matches its fidelity over
  live input.
- Goldens remain the durable net BEFORE the window opens and AFTER it closes.
- The differential harness retires when the old path dies — it is scaffolding, not a
  permanent fixture; goldens and retained intent tests persist.

## Report Wiring

DIFFERENTIAL outputs recorded in the verification report: surfaces wrapped, harness
location and its enabling flag, calibration noise-floor figure, mismatch counts with
triage outcomes, and the retirement condition (the commit or milestone where the old
path disappears).
