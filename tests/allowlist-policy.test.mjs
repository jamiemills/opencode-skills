import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWLIST_ENTRY_FIELDS, validateAllowlistPolicy } from "../scripts/check-suite.mjs";

// T007 hermetic policy tests: exercise the pure validator with a fixture
// allowlist and fixture tracking/wiring predicates. `today` is injected, so the
// expiry legs never depend on the wall clock and never touch the live repo.

const TODAY = "2026-09-21";

function makePolicy({ tracked = [], wired = [] } = {}) {
  return {
    today: TODAY,
    isTracked: (entryPath) => tracked.includes(entryPath),
    isWired: (entryPath) => wired.includes(entryPath),
  };
}

function fixtureEntry(overrides = {}) {
  return {
    path: "tests/example.test.mjs",
    owner: "unassigned",
    reason: "pre-existing failure, out of scope for T007",
    expires: "2026-10-21",
    ...overrides,
  };
}

test("a fully-metadata'd unexpired entry is accepted", () => {
  const entry = fixtureEntry();
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.deepEqual(issues, []);
});

test("an entry expiring exactly today is still accepted (inclusive expiry)", () => {
  const entry = fixtureEntry({ expires: TODAY });
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.deepEqual(issues, []);
});

test("an entry missing any required metadata field fails", () => {
  for (const field of ALLOWLIST_ENTRY_FIELDS) {
    const entry = fixtureEntry({ [field]: "" });
    const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
    assert.ok(
      issues.some((issue) => issue.includes(`missing required metadata "${field}"`)),
      `missing "${field}" must fail; got: ${JSON.stringify(issues)}`,
    );
  }
});

test("an entry with an undefined metadata field fails", () => {
  const entry = fixtureEntry();
  delete entry.reason;
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.ok(
    issues.some((issue) => issue.includes('missing required metadata "reason"')),
    `undefined reason must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("an expired entry fails", () => {
  const entry = fixtureEntry({ expires: "2026-09-20" });
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.ok(
    issues.some((issue) => /expired 2026-09-20 \(today 2026-09-21\)/.test(issue)),
    `expired entry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("an entry with a non-ISO expiry fails", () => {
  const entry = fixtureEntry({ expires: "next quarter" });
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.ok(
    issues.some((issue) => /is not an ISO date \(YYYY-MM-DD\)/.test(issue)),
    `non-ISO expiry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("an unknown (no longer tracked) entry fails", () => {
  const entry = fixtureEntry();
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [] }));
  assert.ok(
    issues.some((issue) => /is no longer tracked/.test(issue)),
    `untracked entry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("a mis-homed (non-tests/) entry fails", () => {
  const entry = fixtureEntry({ path: "scripts/example.test.mjs" });
  const issues = validateAllowlistPolicy([entry], makePolicy({ tracked: [entry.path] }));
  assert.ok(
    issues.some((issue) => /mis-homed/.test(issue)),
    `mis-homed entry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("an entry that has become wired fails", () => {
  const entry = fixtureEntry();
  const issues = validateAllowlistPolicy(
    [entry],
    makePolicy({ tracked: [entry.path], wired: [entry.path] }),
  );
  assert.ok(
    issues.some((issue) => /is now wired/.test(issue)),
    `wired entry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("a duplicate path fails", () => {
  const entry = fixtureEntry();
  const issues = validateAllowlistPolicy(
    [entry, fixtureEntry()],
    makePolicy({ tracked: [entry.path] }),
  );
  assert.ok(
    issues.some((issue) => /duplicate path/.test(issue)),
    `duplicate must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("a non-object entry fails closed", () => {
  const issues = validateAllowlistPolicy(["tests/example.test.mjs"], makePolicy());
  assert.ok(
    issues.some((issue) => /must be an object/.test(issue)),
    `non-object entry must fail; got: ${JSON.stringify(issues)}`,
  );
});

test("a non-array allowlist fails closed", () => {
  const issues = validateAllowlistPolicy({ path: "tests/example.test.mjs" }, makePolicy());
  assert.deepEqual(issues, ["allowlist policy: entries is not an array"]);
});

test("a missing or malformed injected today fails closed", () => {
  for (const today of [undefined, "2026/09/21", "today"]) {
    const issues = validateAllowlistPolicy([fixtureEntry()], { today });
    assert.ok(
      issues.some((issue) => /today must be an ISO date/.test(issue)),
      `today ${JSON.stringify(today)} must fail; got: ${JSON.stringify(issues)}`,
    );
  }
});
