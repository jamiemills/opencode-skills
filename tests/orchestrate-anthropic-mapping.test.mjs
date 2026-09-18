"use strict";

// T008: wire the Anthropic id-mapping staleness guard into a scheduled/checked
// gate. The contract is: default invocation is WARN-ONLY (age staleness stays
// visible but never surprises the default gate), `--strict` is the checked gate
// that fails on stale age and on version-gate/structural drift, and the
// `make check-anthropic-mapping` target plus the default `make check` advisory
// hook are wired so the guard is reachable without a manual invocation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-anthropic-mapping.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));
const hasMake = spawnSync("make", ["--version"], { encoding: "utf8" }).status === 0;
const FRESH_DATE = new Date().toISOString().slice(0, 10);

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: "utf8",
    ...options,
  });
}

function mappingSection({ date = FRESH_DATE, gate = true, extra = "" } = {}) {
  const gateLine = gate
    ? "This mapping stays version-qualified and version-gated; the vendor field set\nis version-dependent."
    : "This mapping tracks the documented vendor field set.";
  return [
    "### Version-qualified identifiers",
    "",
    gateLine,
    "",
    extra,
    `**Re-verification status.** Re-verified read-only on ${date} against the`,
    "live vendor pages.",
    "",
    "**Re-verify on Claude Code updates.** Re-open the citations, update the",
    "retrieval date, and run `node scripts/check-anthropic-mapping.mjs`.",
    "",
  ].join("\n");
}

function withFixture(body, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-mapping-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "dynamic-worker-runtime.md"), body, "utf8");
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("T008: default invocation is warn-only and reports the current mapping", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-anthropic-mapping: (OK|WARN)/);
});

test("T008: --strict validates structural and version-gate integrity of the live mapping", () => {
  const result = run(["--strict", "--no-max-age"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-anthropic-mapping: OK/);
  assert.match(result.stdout, /re-verified/i);
  assert.match(result.stdout, /no pinned version/i);
});

test("T008: stale-by-age is visible by default and fails only under --strict", () => {
  const body = mappingSection({ date: "2000-01-01" });
  withFixture(body, (root) => {
    const warn = run(["--root", root]);
    assert.equal(warn.status, 0, warn.stdout + warn.stderr);
    assert.match(warn.stdout, /check-anthropic-mapping: WARN/);
    assert.match(warn.stdout, /\[stale-age\]/);
    assert.match(warn.stdout, /warn-only by default/);

    const strict = run(["--root", root, "--strict"]);
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.match(strict.stdout, /check-anthropic-mapping: FAIL/);
    assert.match(strict.stdout, /\[stale-age\]/);

    const suppressed = run(["--root", root, "--strict", "--no-max-age"]);
    assert.equal(suppressed.status, 0, suppressed.stdout + suppressed.stderr);
  });
});

test("T008: version-gate drift (weakened language and pinned literal) warns by default, fails strict", () => {
  withFixture(mappingSection({ gate: false }), (root) => {
    const warn = run(["--root", root]);
    assert.equal(warn.status, 0, warn.stdout + warn.stderr);
    assert.match(warn.stdout, /\[version-gate\]/);
    assert.match(warn.stdout, /version-gate language weakened/);

    const strict = run(["--root", root, "--strict"]);
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.match(strict.stdout, /\[version-gate\]/);
  });

  withFixture(mappingSection({ extra: "This mapping pins 2.1.154." }), (root) => {
    const strict = run(["--root", root, "--strict"]);
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.match(strict.stdout, /\[version-gate\]/);
    assert.match(strict.stdout, /pinned version literal/);
  });
});

test("T008: Makefile wires a strict checked target and a warn-only default-gate hook", () => {
  const makefile = fs.readFileSync(path.join(REPO, "Makefile"), "utf8");
  assert.match(
    makefile,
    /^check-anthropic-mapping:.*\n\tnode scripts\/check-anthropic-mapping\.mjs --strict$/m,
    "check-anthropic-mapping must invoke the guard with --strict",
  );
  assert.match(makefile, /^\.PHONY:.*\bcheck-anthropic-mapping\b/m);
  assert.match(
    makefile,
    /^check:.*\n\tnode scripts\/check-suite\.mjs\n\tnode scripts\/check-anthropic-mapping\.mjs$/m,
    "the default check gate must run the guard in warn-only mode (no --strict)",
  );
  assert.doesNotMatch(
    makefile,
    /^check:[^\n]*\bcheck-anthropic-mapping\b/m,
    "the strict target must not be a surprise dependency of the default gate",
  );
});

test("T008: make check-anthropic-mapping runs the checked gate green", (t) => {
  if (!hasMake) return t.skip("make is unavailable");
  const result = spawnSync("make", ["check-anthropic-mapping"], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, MAKEFLAGS: "" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-anthropic-mapping: OK/);
});
