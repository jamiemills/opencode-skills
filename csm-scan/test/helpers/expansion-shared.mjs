// Shared expanded-pipeline test helpers (T010 / F-039).
//
// The canonicalize/fixedInput/semanticProjection trio was duplicated across
// fixtures-pipeline.test.mjs, helpers/legacy-pipeline-mirror.mjs,
// expansion-production-pipeline.test.mjs, expansion-baseline.test.mjs, and
// expansion-activation.test.mjs — and only one copy carried the <SCAN_ID>
// normalization (drift already present). This helper is the single source.
//
// `canonicalize` optionally normalizes the path-derived cross-repo scan
// identities (scan:<scanId>) that the EXPANDED pipeline renders; the legacy
// ten-dimension mirror output never contains them, so callers pass
// `{ normalizeScanIds: true }` only where the expanded surface is hashed.
// The normalization list is asserted against fixture-behavior.json's
// `normalizations` record in fixtures-pipeline.test.mjs.

export function canonicalize(value, repoPath, options = {}) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, repoPath, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, canonicalize(entry, repoPath, options)]),
    );
  }
  if (typeof value !== "string") return value;
  const normalizedRoot = repoPath.replaceAll("\\", "/");
  const fixtureName = normalizedRoot.split("/").pop();
  let result = value
    .replaceAll("\\", "/")
    .replaceAll(normalizedRoot, "<FIXTURE_ROOT>")
    .replaceAll(fixtureName, "<FIXTURE_NAME>")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
    .replace(
      /\b(Python|Node(?:\.js)?|rustc|Deno|Bun)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?/g,
      "$1 <HOST_VERSION>",
    );
  if (options.normalizeScanIds) {
    result = result.replace(/\bscan-[0-9a-f]{24}\b/g, "<SCAN_ID>");
  }
  return result;
}

// The authoritative ten-dimension fixed input shared by the T201/T204/T224
// semantic baselines.
export function fixedInput() {
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

export function semanticProjection(enriched, validated) {
  return {
    dimensionOrder: validated.findings.map(({ dimension }) => dimension),
    findingKeys: Object.fromEntries(
      validated.findings.map(({ dimension, findings }) => [
        dimension,
        Object.keys(findings).toSorted(),
      ]),
    ),
    coverage: validated.coverage,
    confidence: Object.fromEntries(
      validated.findings.map(({ dimension, confidence }) => [dimension, confidence]),
    ),
    contradictions: enriched.contradictions,
    gaps: enriched.gaps,
    inferredPatterns: enriched.inferredPatterns,
  };
}
