# Capture Patterns

Per-stack characterization capture: the assertion call, first-run semantics, the
human-gated approve/re-baseline command, and the volatile-field scrubbing primitive.
Universal rule: every update flag runs only after explicit human approval; CI never
writes or updates goldens.

Source: `.agents/research/2026-08-22-characterization-skill-implementation-research.md`
— inline markers cite its findings (K) and detail sections (D).

## Quick Table

```text
stack              capture call                        first run          approve (human-gated)
Python/syrupy      assert out == snapshot              fails (missing)    pytest --snapshot-update
JS/Jest            expect(scrub(x)).toMatchSnapshot()  writes artifact    npx jest -u
Vitest             expect(x).toMatchSnapshot()         fails in CI        vitest -u / --update
Rust/cargo-insta   assert_json_snapshot!(x)            pending .snap.new  cargo insta review | accept
Go/golden file     compare vs testdata/golden/<name>   fails (missing)    go test ./... -update
JVM/ApprovalTests  Approvals.verifyAsJson(scrub(x))    received file out  copy approved file
.NET/Verify        Verify checks                       .received. written rename -> .verified.
```

## Python — pytest + syrupy

```python
from syrupy.matchers import path_type

def test_order_shape(snapshot_json, client):
    resp = client.get("/orders/42")
    # Soundness: a MISSING snapshot fails the suite — forces explicit first capture [K4]
    assert snapshot_json(matcher=path_type({"id": (int,), "ts": (datetime,)})) == resp.json()
```

- First run fails on the missing snapshot; observed output becomes the pending golden.
- Approve after human review: `pytest --snapshot-update`.
- New-only mode (writes only missing snapshots, never modifies existing ones):
  `pytest --snapshot-update-new-only` — the default choice for first captures.
- Scrubbing is serialization-time, no regex over rendered output:

```python
path_type({"id": (int,), "registeredAt": (datetime,)})  # by value type at path
path_value({...})                                       # literal replacement
```

- API responses: use `JSONSnapshotExtension` for canonical JSON serialization.
- CI: missing snapshots fail the run by default — never-auto-accept holds [K10].

## JavaScript/TypeScript — Jest

```js
test("order serialization", () => {
  expect(scrub(order)).toMatchSnapshot();
});
```

- First local run writes `__snapshots__/<file>.snap`; commit it; review the diff [K4].
- Re-baseline only post-approval: `npx jest -u` (`--updateSnapshot`). CI never writes
  snapshots without that flag [K10].
- Seeded combination capture (Gilded Rose pattern): `jest-extended-snapshot`
  `toVerifyAllCombinations` enumerates input matrices into one snapshot [K4].
- No matcher-based scrubbing: manual `scrub()` helper (below) or `expect.any()`.

## Vitest

- Update flag `-u` / `--update`; v4 type is `boolean | 'new' | 'all' | 'none'` [K24].
- CI default (`process.env.CI` truthy): update mode resolves to none — mismatches,
  missing snapshots, AND obsolete snapshots all fail the run [K10][K24].
- `toMatchFileSnapshot('./explicit/path')` for named goldens outside the default dir [D6].

## Rust — cargo-insta

Strongest machine-readable approve loop found anywhere [D2]:

```text
cargo insta test                          # force-pass collection -> pending .snap.new
cargo insta review                        # interactive per-snapshot accept/reject (human)
cargo insta accept                        # bulk accept AFTER batch approval only
cargo insta pending-snapshots --as-json   # machine-readable pending-golden queue
cargo insta test --accept-unseen          # first-capture shortcut: accepts ONLY unseen
cargo insta test --unreferenced=reject    # CI gate: fail on stale/unreferenced [K10]
```

Redactions on serde snapshots — scrubbing at serialization time:

```rust
let mut settings = insta::Settings::new();
settings.add_redaction(".id", "[uuid]");
settings.bind(|| {
    insta::assert_json_snapshot!(response);
});
// variants: dynamic_redaction(callback), sorted_redaction(),
//           rounded_redaction(decimal_digits)
```

Inherently string-format snapshots cannot use redactions — use regex filters:
`Settings::add_filter(pattern, replacement)` [D6].

## Go — golden files

```go
var update = flag.Bool("update", false, "rewrite golden files")

func TestOrderRender(t *testing.T) {
	got := render(scrub(order))
	golden := filepath.Join("testdata", "golden", "order.json")
	if *update {
		os.MkdirAll(filepath.Dir(golden), 0o755)
		os.WriteFile(golden, got, 0o644) // gated behind -update, post-approval
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

// approve: go test ./... -update   (manual invocation after human sign-off)
```

Alternative: `go-approval-tests` — `approvals.VerifyJSONBytes(t, scrubbed)` with the
received/approved file-pair model [K4].

## JVM — ApprovalTests

```java
Approvals.verifyAsJson(scrub(result));
```

Approve-file workflow: the failing test emits a `.received.` artifact next to the
expected `.approved.` one; inspect the received file, and on approval copy it over the
approved file and commit [K4]. Same model as Python `approvaltests`.

## .NET — Verify

- Fail-by-construction: a missing `.verified.` file fails the test [K10].
- Acceptance is mechanical and scriptable: rename `<name>.received.<ext>` to
  `<name>.verified.<ext>` — bulk renames work for batch approval after review [D6].
- Convention: `*.received.*` gitignored, `*.verified.*` committed.
- DiffEngine suppresses diff-tool launches on build servers AND inside AI CLIs
  automatically — agent-driven runs will not hang on a GUI prompt [K22].
- Hygiene gate: call `VerifyChecks.Run()` once in an assembly-level test to catch
  configuration drift.

## Manual scrub() For Stacks Without Matchers

Jest/Vitest/Go/JVM lack serialization-time matchers; centralize one helper per suite [K7]:

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

- UNSTABLE_KEYS covers timestamps, uuids, durations, hostnames, secrets [K7].
- Preference order for volatility control [K7]:
  1. Dependency injection — inject clock/id-generator so output is deterministic;
  2. Library-native matchers/redactions/filters (per-stack sections above);
  3. Regex scrubbing — last resort, centralized in the helper, never inline.
