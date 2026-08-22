# Capture Patterns

Per-stack characterization capture: assertion call, what gets snapshotted, first-run
semantics, human-gated approve/re-baseline command, volatile-field scrubbing. Universal
rule: every update flag runs only after explicit human approval; CI never updates goldens.

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Quick Table

```text
stack   tool/library     capture call                        snapshotted            first run
Python  pytest+syrupy    assert out == snapshot              serialized return      fails (missing)
Python  approvaltests    verify_as_json(scrub(result))       .received.txt file     received written
JS/TS   Jest             expect(scrub(x)).toMatchSnapshot()  __snapshots__/*.snap   artifact written
JS/TS   Vitest           expect(x).toMatchSnapshot()         default snapshot dir   fails in CI
Rust    cargo-insta      assert_json_snapshot!(x)            .snap (pending .snap.new)  pending created
Go      golden + -update compare vs testdata/golden/<name>   golden-file bytes      fails (missing)
JVM     ApprovalTests    Approvals.verifyAsJson(scrub(x))    .received.txt file     received written
.NET    Verify           Verify(scrubbed)                    .received.<ext> file   received written
```

## Python — pytest + syrupy

```python
from syrupy.matchers import path_type

def test_order_shape(snapshot_json, client):
    resp = client.get("/orders/42")
    # Soundness: a MISSING snapshot fails the suite — forces first capture [K4]
    assert snapshot_json(matcher=path_type({"id": (int,), "ts": (datetime,)})) == resp.json()
```

- Snapshotted: the serialized return value (use `JSONSnapshotExtension` for APIs).
- First run fails on the missing snapshot; observed output becomes the pending golden.
- Approve after human review: `pytest --snapshot-update`; new-only mode
  `--snapshot-update-new-only` writes only missing snapshots — the first-capture default.- Scrubbing is serialization-time, no regex over rendered output [K7]:

```python
path_type({"id": (int,), "registeredAt": (datetime,)})  # replace by value type at path
path_value({...})                                       # literal replacement
```

## JavaScript/TypeScript — Jest

```js
test("order serialization", () => {
  expect(scrub(order)).toMatchSnapshot(); // snapshotted: rendered snapshot artifact
});
```

- First local run writes `__snapshots__/<file>.snap`; commit it; re-baseline only
  post-approval via `npx jest -u` — CI never writes snapshots without that flag [K10].
- Seeded combination capture (Gilded Rose pattern): `jest-extended-snapshot`
  `toVerifyAllCombinations` enumerates input matrices into one snapshot [K4].

## Vitest

- Re-baseline with `-u` / `--update` (v4 type `boolean | 'new' | 'all' | 'none'`) [K24].
- CI truthy -> update none: mismatch + missing + obsolete all fail [K10][K24];
  `toMatchFileSnapshot('./explicit/path')` names goldens outside the default dir [D6].

## Rust — cargo-insta

The strongest machine-readable approve loop found anywhere [D2]:

```text
cargo insta test                          # collection -> pending .snap.new artifacts
cargo insta review                        # interactive per-snapshot accept/reject (human)
cargo insta accept                        # bulk accept AFTER batch approval only
cargo insta pending-snapshots --as-json   # machine-readable pending-golden queue
cargo insta test --accept-unseen          # first capture: accepts ONLY unseen snapshots
cargo insta test --unreferenced=reject    # CI gate: fail on stale/unreferenced [K10]
```

Snapshotted: serde-serialized values (`.snap`). Redactions scrub at serialization time:

```rust
let mut settings = insta::Settings::new();
settings.add_redaction(".id", "[uuid]");
settings.bind(|| insta::assert_json_snapshot!(response));
// variants: dynamic_redaction(callback), sorted_redaction(), rounded_redaction(digits)
```

Inherently string-format snapshots cannot use redactions — regex filters instead:
`Settings::add_filter(pattern, replacement)` [D6].

## Go — golden files

```go
var update = flag.Bool("update", false, "rewrite golden files")

func TestOrderRender(t *testing.T) {
	got := render(scrub(order)) // snapshotted: rendered bytes
	golden := filepath.Join("testdata", "golden", "order.json")
	if *update { // gated behind -update, post-approval
		os.WriteFile(golden, got, 0o644)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err) // missing golden fails: forced first capture
	}
	if !bytes.Equal(want, got) {
		t.Errorf("diff:\n%s", cmp.Diff(string(want), string(got)))
	}
}
```

Approve: `go test ./... -update`, invoked manually after human sign-off [K4].
Alternative: `go-approval-tests` `approvals.VerifyJSONBytes(t, scrubbed)` file-pair
model [K4].

## JVM — ApprovalTests

```java
Approvals.verifyAsJson(scrub(result)); // snapshotted: .received.txt artifact
```

The failing test emits a `.received.` artifact next to the expected `.approved.` one;
inspect the received file, and on approval copy it over the approved file and commit
[K4]. Same model as Python `approvaltests.verify_as_json` [K4].

## .NET — Verify

- Fail-by-construction: a missing `.verified.` file fails the test [K10].
- Snapshotted: `<name>.received.<ext>` artifacts; acceptance is mechanical — rename
  `.received.` to `.verified.` (bulk renames work for batch approval after review) [D6].
- Convention: `*.received.*` gitignored, `*.verified.*` committed.
- DiffEngine suppresses diff-tool launches on build servers AND inside AI CLIs —
  agent-driven runs never hang on a GUI prompt [K22].
- Hygiene gate: `VerifyChecks.Run()` once at assembly level catches config drift.

## Approve-Loop Semantics

A human reviews every diff — old vs observed, with scrubbing context — before any
approve mechanism runs; never bulk auto-approval, however trivial diffs look ([D2]).

Batch mechanics per stack:

- Rust: `cargo insta test --review` walks all pending snapshots in one interactive pass;
  `with_settings!` description/info fields give per-snapshot reviewer context [K26]. `pending-snapshots --as-json` builds review queues programmatically.
- Python/syrupy: `--snapshot-update-new-only` restricts writes to new goldens so
  already-approved ones stay locked during a partial batch [K4].
- Jest/Vitest: one reviewed batch, then a single `-u` application [K4][K24].
- .NET: scripted bulk rename of reviewed `.received.` files only [D6].
- Go: the `-update` flag invocation itself is the per-batch approval act [K4].

Cap batch size so reviews stay honest; record approver, commit/timestamp, and triage
classification per row in the ledger (APPROVE steps 2–3). Rejected batches return to
CAPTURE with the reviewer's reason attached.

## CI Integration Semantics

CI is read-only against goldens: it verifies, never writes or updates [K10].

```text
pytest/syrupy   missing snapshot FAILS the suite ("Soundness")            [K10]
Jest            no snapshot writes on CI without --updateSnapshot         [K10]
Vitest          CI truthy -> update=none; mismatch+missing+obsolete fail  [K10][K24]
cargo-insta     --unreferenced auto => reject in CI                       [K10]
Go              plain `go test ./...` (never -update) -> divergence fails [K4][K10]
ApprovalTests   received != approved fails; .received. gitignored         [K4]
.NET Verify     missing .verified. fails; BuildServerDetector suppresses
                diff-tool launches on CI                                  [K10][K22]
```

Update flags (`--snapshot-update`, `-u`, `cargo insta accept`, `-update`, received→
verified renames) are local-only human acts, run solely after presented-diff approval.

## Volatile Scrubbing Techniques

Preference order — dependency injection beats matchers beats regex [K7]:

1. Dependency injection: inject clock/id-generator/randomness source so captured
   output is deterministic by construction (determinism discipline).
2. Library-native masking: syrupy `path_type`/`path_value`; insta redactions,
   `sorted_redaction()`, `rounded_redaction(n)`, `add_filter` for string formats.
3. Centralized `scrub()` helper for stacks without matchers (Jest/Vitest/Go/JVM),
   never inline regexes [K7]:

```js
const UNSTABLE_KEYS = new Set([
  "id", "uuid", "ts", "createdAt", "duration_ms", "host",
  "port", "requestId", "token", "secret",
]);

function scrub(node) {
  if (Array.isArray(node)) return node.map(scrub);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) =>
        [k, UNSTABLE_KEYS.has(k) ? `<${k}>` : scrub(v)]));
  }
  return node;
}
```

UNSTABLE_KEYS masks timestamps, IDs/UUIDs, durations, hostnames, and secrets;
randomness is handled upstream by seeding/injecting the generator, not by diffing it
away. Jest/Vitest fallback for opaque values: `expect.any()` matchers.
