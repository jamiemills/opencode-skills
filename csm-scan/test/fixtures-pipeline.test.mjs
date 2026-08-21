import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withFixture } from "./harness.mjs";
import { canonicalize } from "./helpers/expansion-shared.mjs";
import { runMirrorPipelineDetailed } from "./helpers/pipeline-mirror.mjs";
import { files as pythonFiles } from "./fixtures/python.mjs";
import { files as javascriptFiles } from "./fixtures/javascript.mjs";
import { files as typescriptFiles } from "./fixtures/typescript.mjs";
import { files as rustFiles } from "./fixtures/rust.mjs";
import { files as shellFiles } from "./fixtures/shell.mjs";

// T010 (F-026) + T002: `runPipeline` — the suite's own fixture cases — now drives the
// exported production pipeline (`runExpandedPipeline`) through the shared
// mirror helper. The legacy ten-dimension sequence survives ONLY as
// `runLegacyTenMirror`, the parity oracle consumed by
// expansion-production-pipeline.test.mjs (T204) and expansion-activation.test.mjs
// (T224) to pin the ten-dimension baseline bytes after the legacy entry points
// were retired (T002); it no longer claims to mirror scripts/scan.mjs.
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const BEHAVIOR_BASELINE = JSON.parse(
  await readFile(join(TEST_ROOT, "baselines", "expansion", "fixture-behavior.json"), "utf8"),
);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

// The production pipeline, single repo, semantic payload exposed.
export async function runPipeline(repoPath) {
  const detailed = await runMirrorPipelineDetailed(repoPath);
  // The expanded pipeline renders scan:<scanId> identities (a one-way
  // derivation of the random fixture tmpdir) — normalized like the fixture
  // root itself to keep the bytes portable.
  const semantic = canonicalize(detailed.semantic, repoPath, { normalizeScanIds: true });
  return {
    markdown: detailed.markdown,
    semantic,
    semanticSha256: digest(`${JSON.stringify(semantic)}\n`),
    markdownSha256: digest(
      `${canonicalize(detailed.markdown, repoPath, { normalizeScanIds: true })}\n`,
    ),
  };
}

// T010 (F-039): the shared canonicalize helper (test/helpers/expansion-shared.mjs)
// applies exactly the normalization list recorded in fixture-behavior.json.
test("T020 canonicalization applies exactly the fixture-behavior normalizations", () => {
  const root = "/tmp/csm-scan-fixture-root-abc";
  const input = [
    `${root}/src/app.py`,
    "C:\\windows\\path\\app.py",
    "generated 2026-08-03",
    "Python 3.12.4",
    "scan-0123456789abcdef01234567",
  ].join("\n");
  const normalized = canonicalize(input, root, { normalizeScanIds: true });
  assert.ok(normalized.includes("<FIXTURE_ROOT>/src/app.py"), "fixture root normalizes");
  assert.ok(normalized.includes("C:/windows/path/app.py"), "path separators normalize");
  assert.ok(normalized.includes("generated <DATE>"), "dates normalize");
  assert.ok(normalized.includes("Python <HOST_VERSION>"), "host versions normalize");
  assert.ok(normalized.includes("<SCAN_ID>"), "scan identities normalize for the expanded surface");
  assert.deepEqual(BEHAVIOR_BASELINE.normalizations, [
    "fixture root to <FIXTURE_ROOT>",
    "path separators to slash",
    "YYYY-MM-DD dates to <DATE>",
    "host Python, Node, rustc, Deno, and Bun versions to <HOST_VERSION>",
    "path-derived pipeline scan identities (sha256 of the repo path) to <SCAN_ID>",
  ]);
  // Legacy surfaces never contain scan identities — the default must not strip them.
  assert.ok(
    canonicalize("scan-0123456789abcdef01234567", root).includes("scan-0123456789abcdef01234567"),
    "scan tokens stay intact without normalizeScanIds",
  );
});

function contains(markdown, needle) {
  return needle instanceof RegExp ? needle.test(markdown) : markdown.includes(needle);
}

// (name, fixtureFiles, ecosystemStrings, cacheNoise)
// Noise entries may be strings (substring) or RegExps. `dist` is pinned as a
// whole token because the expanded pipeline legitimately renders the words
// "distribution" and "distinct" (maintainability dimension); \bdist\b still
// fails on any leaked dist path segment (dist/..., ./dist, `dist`).
export const CASES = [
  { name: "python", files: pythonFiles, ecosystem: ["Python"], noise: [".hypothesis"] },
  {
    name: "javascript",
    files: javascriptFiles,
    ecosystem: [/JavaScript|TypeScript|Node/],
    noise: ["node_modules", /\bdist\b/],
  },
  {
    name: "typescript",
    files: typescriptFiles,
    ecosystem: [/JavaScript|TypeScript|Node/],
    noise: ["node_modules", /\bdist\b/],
  },
  { name: "rust", files: rustFiles, ecosystem: ["Rust"], noise: ["target"] },
  { name: "shell", files: shellFiles, ecosystem: ["Shell"], noise: [".cache"] },
];

for (const c of CASES) {
  test(`T020 ${c.name} fixture: full pipeline runs clean, reflects ecosystem, excludes cache noise`, async () => {
    const result = await withFixture(`pipe-${c.name}`, c.files, runPipeline);
    const { markdown } = result;

    for (const needle of c.ecosystem) {
      assert.ok(
        contains(markdown, needle),
        `${c.name}: NORMS.md must mention ecosystem ${needle.toString()}`,
      );
    }

    for (const noise of c.noise) {
      assert.ok(
        !contains(markdown, noise),
        `${c.name}: NORMS.md must not leak cache-dir noise "${noise}"`,
      );
    }

    // T010 (F-026) + T002: the fixture cases pin the EXPANDED production pipeline
    // (runExpandedPipeline through the shared mirror); the legacy
    // ten-dimension hashes remain recorded for the T204 parity oracle.
    const expected = BEHAVIOR_BASELINE.fixtures[c.name];
    assert.ok(expected, `${c.name}: fixture behavior baseline must exist`);
    assert.equal(
      result.semanticSha256,
      expected.expandedSemanticSha256,
      `${c.name}: expanded pipeline semantics changed`,
    );
    assert.equal(
      result.markdownSha256,
      expected.expandedMarkdownSha256,
      `${c.name}: expanded pipeline Markdown changed`,
    );
  });
}
