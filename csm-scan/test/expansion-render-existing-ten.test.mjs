import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { enrich } from "../lib/scan/enrich.mjs";
import { createRenderContext, finalizeMarkdown, safeScalar } from "../lib/scan/render/base.mjs";
import {
  EXISTING_TEN_RENDERER_MAP,
  EXISTING_TEN_RENDERER_ORDER,
  ExistingTenRendererError,
  createExistingTenRenderer,
} from "../lib/scan/render/existing-ten.mjs";
import { validate } from "../lib/scan/validate.mjs";
import { writeNORMS } from "../lib/scan/write.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, "..");

function fixedInput() {
  const overview = {
    name: "synthetic-repository",
    path: ".",
    languages: ["JavaScript"],
    ecosystems: { primary: "javascript", all: ["javascript"] },
    packageManager: "npm",
    totalFiles: 2,
    isGit: false,
  };
  const deep = [
    {
      dimension: "structure",
      signal: "high",
      findings: {
        tree: ".\n├── package.json\n└── src/",
        fileCounts: { js: 1, json: 1 },
        totalFiles: 2,
      },
    },
    {
      dimension: "stack",
      signal: "high",
      findings: {
        runtime: "Node.js (declared)",
        language: "JavaScript",
        framework: "(none)",
        packageManager: "npm",
        name: "synthetic-package",
        version: "1.0.0",
      },
    },
    {
      dimension: "config",
      signal: "high",
      findings: {
        lint: { config: "eslint.config.mjs" },
        format: "prettier",
        markers: [".editorconfig"],
      },
    },
    {
      dimension: "testing",
      signal: "high",
      findings: {
        framework: ["node:test"],
        fileCount: 1,
        naming: ["*.test.mjs"],
        sampleFiles: ["test/example.test.mjs"],
        testDirs: ["test"],
      },
    },
    {
      dimension: "conventions",
      signal: "high",
      findings: {
        importStyle: {
          type: "ESM (import/export)",
          hasTypeImports: false,
          hasDynamicImports: false,
          samples: [],
        },
        fileNaming: { dominant: "kebab-case", total: 2, patterns: { "kebab-case": 2 } },
        errorHandling: { patterns: ["throw"] },
        moduleSystem: { inferred: "ESM" },
        commentDensity: "10.0% (1 comment / 10 code lines)",
      },
    },
    { dimension: "git", signal: "high", findings: { isGit: false } },
    {
      dimension: "architecture",
      signal: "high",
      findings: {
        layers: {
          totalFiles: 2,
          totalEdges: 1,
          entryPoints: ["src/index.js"],
          libModules: ["src/value.js"],
          shared: [],
          rest: [],
        },
        asciiGraph: "src/index.js -> src/value.js",
      },
    },
    {
      dimension: "documentation",
      signal: "high",
      findings: {
        readme: { present: true, path: "README.md", sections: 2, hasSetup: true },
        contributing: { present: false },
        license: { present: true, name: "MIT", path: "LICENSE" },
        commentRatio: { ratio: 10, commentLines: 1, codeLines: 10 },
        todoCount: 0,
      },
    },
    {
      dimension: "security",
      signal: "high",
      findings: {
        secrets: { count: 0, findings: [] },
        envExample: true,
        gitignoreEnvProtected: true,
        hasLockfile: true,
        dependabot: false,
      },
    },
    {
      dimension: "operations",
      signal: "high",
      findings: {
        dockerfiles: [],
        ci: [],
        healthChecks: { detected: false, references: [] },
        hasMakefile: true,
        hasJustfile: false,
      },
    },
  ];
  return { overview, deep };
}

async function validatedFixedInput() {
  const { overview, deep } = fixedInput();
  const enriched = await enrich(deep, overview);
  const validated = await validate(enriched);
  return { overview, deep: validated.findings };
}

test("T205 unchanged write facade matches the pre-existing deterministic bytes with one write result", async () => {
  const expected = await readFile(join(TEST_ROOT, "baselines", "expansion", "renderer.md"), "utf8");
  const { overview, deep } = await validatedFixedInput();
  const root = await mkdtemp(join(tmpdir(), "csm-scan-t205-"));
  const outPath = join(root, "NORMS.md");
  try {
    const content = await writeNORMS(
      { generated: "2026-01-15", repos: [{ overview, deep }] },
      outPath,
    );
    assert.equal(content, expected);
    assert.equal(await readFile(outPath, "utf8"), content);
    assert.deepEqual(await readdir(root), ["NORMS.md"]);
    assert.equal(content.includes("\r"), false);
    assert.match(content, /[^\n]\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const source = await readFile(join(ROOT, "lib", "scan", "write.mjs"), "utf8");
  // T010 (F-065-b reconciliation): the write facade is the atomic tmp+rename
  // writer — exactly one temp write and one rename.
  assert.equal(
    source
      .replace(/["']/g, '"')
      .split('import { rename, unlink, writeFile } from "node:fs/promises";').length - 1,
    1,
  );
  assert.equal(
    source.replace(/["']/g, '"').split('await writeFile(tmpPath, content, "utf-8");').length - 1,
    1,
  );
  assert.equal(source.split("await rename(tmpPath, outPath);").length - 1, 1);
});

test("T205 base centralizes safe scalars, Markdown escaping, privacy, and LF finalization", () => {
  const seen = [];
  const context = createRenderContext({
    privacyHook(value) {
      seen.push(value);
      return value === "private" ? "filtered" : value;
    },
  });
  assert.equal(safeScalar(null), "");
  assert.equal(safeScalar(42), "42");
  assert.equal(context.escapeField("private"), "filtered");
  assert.equal(context.escapeField("# a|b`c\\d"), "\\# a\\|b\\`c\\\\d");
  assert.equal(context.escapeField("# a|b", { inTable: true }), "# a\\|b");
  assert.deepEqual(seen, ["private", "# a|b`c\\d", "# a|b"]);
  assert.equal(finalizeMarkdown(["a\r\n", "b\r", ""]), "a\n\nb\n");
});

test("T205 existing-ten definitions are complete while partial findings preserve caller order", () => {
  assert.deepEqual(EXISTING_TEN_RENDERER_ORDER, [
    "structure",
    "stack",
    "config",
    "testing",
    "conventions",
    "git",
    "architecture",
    "documentation",
    "security",
    "operations",
  ]);
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP), EXISTING_TEN_RENDERER_ORDER);

  const renderer = createExistingTenRenderer();
  const sections = renderer.render([
    { dimension: "git", findings: { isGit: false } },
    {
      dimension: "stack",
      findings: { runtime: "Node", language: "JS", framework: "none", packageManager: "npm" },
    },
  ]);
  assert.equal(sections.length, 2);
  assert.match(sections[0], /^## Git Practices/);
  assert.match(sections[1], /^## Technology Stack/);
});

const assertRendererError = (fn, code, canary = "") => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ExistingTenRendererError);
    assert.equal(error.code, code);
    if (canary) assert.equal(error.message.includes(canary), false);
    return true;
  });
};

test("T205 injectable renderer definitions fail typed and sanitized", () => {
  assertRendererError(
    () => createExistingTenRenderer({ order: [...EXISTING_TEN_RENDERER_ORDER, "private-canary"] }),
    "UNKNOWN_RENDERER",
    "private-canary",
  );
  assertRendererError(
    () =>
      createExistingTenRenderer({
        order: [...EXISTING_TEN_RENDERER_ORDER.slice(0, -1), "structure"],
      }),
    "DUPLICATE_RENDERER",
  );
  assertRendererError(
    () =>
      createExistingTenRenderer({
        rendererMap: Object.entries(EXISTING_TEN_RENDERER_MAP).slice(0, -1),
      }),
    "MISSING_RENDERER",
  );
  assertRendererError(
    () =>
      createExistingTenRenderer({
        rendererMap: [...Object.entries(EXISTING_TEN_RENDERER_MAP), ["stack", () => ""]],
      }),
    "DUPLICATE_RENDERER",
  );
  const renderer = createExistingTenRenderer();
  assertRendererError(
    () => renderer.render([{ dimension: "private-canary", findings: {} }]),
    "UNKNOWN_DIMENSION",
    "private-canary",
  );
});
