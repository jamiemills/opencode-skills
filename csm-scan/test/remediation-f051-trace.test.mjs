// F-051 — the verbose trace file is per-run unique and gitignored.
//
// Before this fix --verbose wrote to a shared `.csm-scan-debug.log` next to
// --out: two concurrent scans clobbered the path and `git add .` could sweep
// an unredacted trace into a commit. After the fix the trace name is
// per-run unique (`.csm-scan-debug-<pid>-<time>.log`) and the prefix is
// covered by the repo .gitignore.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { openVerboseTrace, createVerboseReporter } from "../lib/scan/report/verbose-trace.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("F-051: openVerboseTrace returns a per-run-unique trace name", () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-trace-r4-"));
  try {
    const first = openVerboseTrace(join(dir, "NORMS.md"));
    const second = openVerboseTrace(join(dir, "NORMS.md"));
    try {
      assert.ok(first.path.startsWith(join(dir, ".csm-scan-debug-")), first.path);
      assert.ok(first.path.endsWith(".log"), first.path);
      assert.notEqual(first.path, second.path, "two opens must not clobber the same path");
    } finally {
      first.stream.destroy();
      second.stream.destroy();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-051: the .csm-scan-debug prefix is covered by the repo .gitignore", () => {
  const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /\.csm-scan-debug\*?\.log/, "the trace prefix must be gitignored");
});

test("F-051: createVerboseReporter still fans every reporter method through the trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-trace-r4b-"));
  try {
    const trace = openVerboseTrace(join(dir, "NORMS.md"));
    const lines = [];
    const base = {};
    for (const method of [
      "info",
      "progress",
      "observation",
      "note",
      "inferred",
      "coverage",
      "error",
      "warning",
    ]) {
      base[method] = (_line) => {};
    }
    base.phase = (_line) => {};
    const patched = {
      stream: {
        write: (chunk) => {
          lines.push(String(chunk));
          return true;
        },
      },
    };
    const reporter = createVerboseReporter(base, patched);
    reporter.info("one");
    reporter.phase("render");
    reporter.traceEnd();
    assert.ok(lines.some((line) => line.includes("info: one")));
    assert.ok(lines.some((line) => line.includes('stage-begin "render"')));
    trace.stream.destroy();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
