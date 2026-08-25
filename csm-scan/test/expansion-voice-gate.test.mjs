// T227 — neutral-voice gate for every authored prose surface.
//
// Owned by T227. Applies the shared voice matcher (test/helpers/voice-gate.mjs,
// imported — never copied) to every authored surface of the EXPANDED
// production pipeline:
//   - the rendered Markdown of all six T226 topic fixtures (five built-in
//     ecosystems plus the unknown-language fixture) and a multi-repository
//     cross-repo run — every per-repository dimension renderer and the
//     Cross-repository Architecture global section,
//   - the registered renderer prose snapshots (DIMENSION_RENDERER_ENTRIES plus
//     the Cross-repo global renderer entry) so static authored prose is checked
//     even for sections a fixture does not fill with data,
//   - the T224 reporter diagnostics produced by the pipeline, and
//   - CLI stdout/stderr diagnostics from scripts/scan.mjs.
//
// Scope (own-only): this test file. No production, baseline, or other test is
// edited.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import { findVoiceHits } from "./helpers/voice-gate.mjs";
import { makeFixture, cleanupFixture } from "./harness.mjs";
import { runExpandedPipeline } from "../lib/scan/pipeline/run.mjs";
import { renderNORMS } from "../lib/scan/write.mjs";
import { createReporter } from "../lib/scan/report/reporter.mjs";
import {
  DIMENSION_RENDERER_ENTRIES,
  CROSS_REPO_RENDERER_ENTRY,
} from "../lib/scan/render/registry.mjs";

import { files as pythonFiles } from "./fixtures-expansion/python.mjs";
import { files as javascriptFiles } from "./fixtures-expansion/javascript.mjs";
import { files as typescriptFiles } from "./fixtures-expansion/typescript.mjs";
import { files as shellFiles } from "./fixtures-expansion/shell.mjs";
import { files as rustFiles } from "./fixtures-expansion/rust.mjs";
import { files as unknownFiles } from "./fixtures-expansion/unknown.mjs";
import { repoA, repoB } from "./fixtures-expansion/cross-repo.mjs";

const execFileAsync = promisify(execFile);
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, "..");
const SCAN_SCRIPT = join(ROOT, "scripts", "scan.mjs");

const FIXED_CLOCK = () => "2026-08-03";

function assertNeutral(label, value) {
  const hits = findVoiceHits(value);
  assert.deepEqual(
    hits,
    [],
    `${label}: judgmental authored prose:\n${JSON.stringify(hits, null, 2)}`,
  );
}

const FIXTURES = [
  ["python", pythonFiles],
  ["javascript", javascriptFiles],
  ["typescript", typescriptFiles],
  ["shell", shellFiles],
  ["rust", rustFiles],
  ["unknown", unknownFiles],
];

test("T227 voice: every expanded-pipeline Markdown surface uses neutral factual prose", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-voice-md-"));
  try {
    for (const [name, files] of FIXTURES) {
      const repo = makeFixture(`t227-voice-${name}`, files);
      try {
        const result = await runExpandedPipeline({
          repos: [repo],
          out: join(outDir, `${name}.md`),
          clock: FIXED_CLOCK,
          sink: (findings, _out, renderer) => renderNORMS(findings, renderer),
        });
        assertNeutral(`${name} rendered Markdown`, result.markdown);
      } finally {
        cleanupFixture(repo);
      }
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227 voice: the Cross-repository Architecture global section is neutral for positive and negative edge sets", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-voice-global-"));
  try {
    const a = makeFixture("t227-voice-ca", repoA);
    const b = makeFixture("t227-voice-cb", repoB);
    try {
      const result = await runExpandedPipeline({
        repos: [a, b],
        out: join(outDir, "global.md"),
        clock: FIXED_CLOCK,
        sink: (findings, _out, renderer) => renderNORMS(findings, renderer),
      });
      const globalSection = result.markdown.split("## Cross-repository Architecture")[1];
      assert.ok(globalSection, "the global section must render");
      assertNeutral("Cross-repository Architecture global section", globalSection);
    } finally {
      cleanupFixture(a);
      cleanupFixture(b);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227 voice: every registered renderer prose snapshot is neutral", () => {
  const lines = [];
  for (const entry of DIMENSION_RENDERER_ENTRIES) {
    lines.push(entry.label);
    lines.push(...entry.prose);
  }
  lines.push(CROSS_REPO_RENDERER_ENTRY.label);
  lines.push(...CROSS_REPO_RENDERER_ENTRY.prose);
  assertNeutral("registered renderer prose", lines.join("\n"));
});

test("T227 voice: T224 reporter diagnostics are neutral across a full multi-fixture run", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-voice-reporter-"));
  const captured = [];
  const capture = {
    write: (chunk) => {
      captured.push(String(chunk));
      return true;
    },
  };
  const reporter = createReporter({ out: capture, err: capture });
  try {
    const a = makeFixture("t227-voice-ra", repoA);
    const b = makeFixture("t227-voice-rb", repoB);
    try {
      await runExpandedPipeline({
        repos: [a, b],
        out: join(outDir, "NORMS.md"),
        clock: FIXED_CLOCK,
        reporter,
      });
    } finally {
      cleanupFixture(a);
      cleanupFixture(b);
    }
    const reporterBlob = captured.join("\n");
    assert.ok(reporterBlob.length > 0, "the reporter must emit diagnostics");
    assertNeutral("T224 reporter diagnostics", reporterBlob);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227 voice: CLI stdout and stderr diagnostics are neutral", async () => {
  const repo = makeFixture("t227-voice-cli", pythonFiles);
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-voice-cli-"));
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, "--repos", repo, "--out", join(outDir, "NORMS.json")],
      { cwd: ROOT },
    );
    assert.equal(stderr, "", "a successful CLI run must produce no stderr");
    assertNeutral("CLI stdout", stdout);
    assertNeutral("CLI stderr", stderr);
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});
