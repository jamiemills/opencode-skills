// F-065-b — writeNORMS writes atomically via tmp+rename.
//
// Before this fix writeNORMS wrote the report in place with a single writeFile,
// so a crash or a concurrent run could leave a torn NORMS.md behind. After the
// fix content lands in a per-run-unique temp file that is renamed over the
// target only after the full write succeeded; on failure the temp file is
// removed and the error rethrown.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import { writeNORMS } from "../lib/scan/write.mjs";

function findings() {
  return {
    generated: "2026-01-01",
    repos: [
      {
        overview: { name: "atomic", path: ".", languages: [], totalFiles: 0 },
        deep: [],
      },
    ],
  };
}

const EMPTY_RENDERER = Object.freeze({ render: () => "", renderGlobal: () => "" });

test("F-065-b: writeNORMS writes the full content and leaves no temp file behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-atomic-"));
  const outPath = join(dir, "NORMS.md");
  try {
    const content = await writeNORMS(findings(), outPath, EMPTY_RENDERER);
    assert.equal(await readFile(outPath, "utf8"), content);
    assert.deepEqual(readdirSync(dir), ["NORMS.md"], "exactly one output file, no temp residue");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-065-b: a failing write removes the temp file and rethrows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-atomic-fail-"));
  const outPath = join(dir, "NORMS.md");
  // Create the target as a directory so rename() fails (EISDIR/ENOTEMPTY).
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(outPath));
    await assert.rejects(
      () => writeNORMS(findings(), outPath, EMPTY_RENDERER),
      "rename over a directory must fail",
    );
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes(".tmp-")),
      [],
      "no temp file may remain after a failed write",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
