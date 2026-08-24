import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createRecordingRunner } from "./helpers/recording-runner.mjs";
import { createCommandBroker, splitGlobArgs } from "../lib/scan/shared/command.mjs";
import { rgIgnoreArgs } from "../lib/scan/shared/ignore.mjs";
import { withFixture } from "./harness.mjs";
import { scan as scanStack } from "../lib/scan/deep/stack.mjs";
import { scan as scanConventions } from "../lib/scan/deep/conventions.mjs";
import { scan as scanDocumentation } from "../lib/scan/deep/documentation.mjs";
import { scan as scanSecurity } from "../lib/scan/deep/security.mjs";
import { scan as scanOperations } from "../lib/scan/deep/operations.mjs";

// The six T209 production owners. No runtime probe, `find`, shell pipeline,
// shell mode, or direct child-process usage may remain in these files.
const SIX_OWNED_FILES = [
  "lib/scan/deep/stack.mjs",
  "lib/scan/deep/conventions.mjs",
  "lib/scan/deep/documentation.mjs",
  "lib/scan/deep/security.mjs",
  "lib/scan/deep/operations.mjs",
  "lib/scan/shared/ecosystem.mjs",
];

const FIVE_SCANNERS = [
  ["stack", scanStack],
  ["conventions", scanConventions],
  ["documentation", scanDocumentation],
  ["security", scanSecurity],
  ["operations", scanOperations],
];

function readSource(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function normalizeQuotes(source) {
  return source.replace(/["']/g, '"');
}

function expectedRgFilesArgv() {
  return [
    "--files",
    ...rgIgnoreArgs().flatMap((entry) => {
      const i = entry.indexOf(" ");
      return [entry.slice(0, i), entry.slice(i + 1)];
    }),
  ];
}

// T014/F-018: the security scanner additionally enumerates hidden/gitignored
// files through the registered rg:files-hidden broker command (secret-pattern
// pass only). Same fixed argv shape as rg:files plus the shared ignore globs,
// with --hidden --no-ignore prepended so dotfiles and gitignored files are
// listed while .git/node_modules stay excluded via the globs.
function expectedRgHiddenArgv() {
  return [
    "--files",
    "--hidden",
    "--no-ignore",
    ...rgIgnoreArgs().flatMap((entry) => {
      const i = entry.indexOf(" ");
      return [entry.slice(0, i), entry.slice(i + 1)];
    }),
  ];
}

test("F3-08 rejects malformed glob entries instead of corrupting argv", () => {
  for (const entry of ["--glob", "--glob !foo bar", " !foo", "--glob "]) {
    assert.throws(() => splitGlobArgs([entry]), /invalid glob argument/);
  }
});

function assertNoProhibitedSites(source, rel) {
  const prohibited = [
    /\bnode:child_process\b/,
    /\bexecFileSync\b/,
    /\bexecSync\b/,
    /\bexecFile\s*\(/,
    /\bspawn(?:Sync)?\s*\(/,
    /\bshell\s*:\s*true\b/,
    /\bruntimeProbe\b/,
    /\bchild_process\b/,
    /\bsh\s+-c\b/,
    /\bbash\s+-c\b/,
    /\bfind\s+[^;\n]*-(?:maxdepth|name|type)\b/,
    /\brg\b[^;\n]*\|\s*(?:rg|wc|head|sort)\b/,
  ];
  for (const re of prohibited) {
    assert.ok(!re.test(source), `${rel} still contains a prohibited execution construct: ${re}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Zero prohibited execution sites in the six owned files
// ---------------------------------------------------------------------------

test("T209 six owned files contain zero prohibited execution sites", () => {
  for (const rel of SIX_OWNED_FILES) {
    const source = readSource(rel);
    assertNoProhibitedSites(source, rel);
    assert.ok(
      !source.includes("from 'node:child_process'"),
      `${rel} must not import node:child_process`,
    );
  }
  // The broker remains the sole production child-process owner.
  const brokerSource = readSource("lib/scan/shared/command.mjs");
  assert.match(normalizeQuotes(brokerSource), /import \{ execFile \} from "node:child_process";/);
});

// ---------------------------------------------------------------------------
// 2. Target runtimes are never executed; commands go through the broker only
// ---------------------------------------------------------------------------

// T209 allowlist: per-scanner git command allowances beyond the fixed rg:files
// enumeration. Every allowed argv form must be a registered read-only broker
// command; an allowance referencing an unregistered argv fails the static
// registration check below (mirroring how git.mjs's git allowance is pinned in
// the command-core suite). The security allowance exists for the dependabot
// branch-evidence fact (T009); the new git:ls-files / git:log-oneline-200 argv
// forms are registered for enumerate and git.mjs consumers (T002/T011).
const REGISTERED_GIT_ARGV_FORMS = Object.freeze([
  ["ls-files"],
  ["log", "--oneline", "-50"],
  ["log", "--oneline", "-200"],
  ["branch", "-a"],
  ["symbolic-ref", "refs/remotes/origin/HEAD"],
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "--abbrev-ref", "HEAD"],
  ["config", "--get", "remote.origin.url"],
  ["shortlog", "-s", "-n", "HEAD"],
]);

const DEEP_SCANNER_GIT_ALLOWANCES = Object.freeze({
  stack: Object.freeze([]),
  conventions: Object.freeze([]),
  documentation: Object.freeze([]),
  security: Object.freeze([["branch", "-a"]]),
  operations: Object.freeze([]),
});

function sameArgv(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function assertRegisteredAllowances() {
  for (const [name, allowances] of Object.entries(DEEP_SCANNER_GIT_ALLOWANCES)) {
    assert.ok(Array.isArray(allowances), `${name} must declare a git allowance list`);
    for (const argv of allowances) {
      assert.ok(
        REGISTERED_GIT_ARGV_FORMS.some((form) => sameArgv(form, argv)),
        `${name} allowance references an unregistered git argv: ${argv.join(" ")}`,
      );
    }
  }
}

test("T209 each deep scanner issues only broker-registered command IDs", async () => {
  assertRegisteredAllowances();
  for (const [name, scan] of FIVE_SCANNERS) {
    const allowedGit = DEEP_SCANNER_GIT_ALLOWANCES[name];
    const allowedGitSet = new Set(allowedGit.map((argv) => argv.join("\u0000")));
    const { calls, run } = createRecordingRunner((call) => {
      assert.equal(call.shell, false, `${name} must never request shell mode`);
      if (call.executable === "rg") {
        const allowedArgv = [expectedRgFilesArgv()];
        if (name === "security") allowedArgv.push(expectedRgHiddenArgv());
        assert.ok(
          allowedArgv.some((argv) => sameArgv(call.argv, argv)),
          `${name} must use only its registered fixed rg argv forms: ${call.argv.join(" ")}`,
        );
      } else if (call.executable === "git") {
        assert.ok(
          allowedGitSet.has(call.argv.join("\u0000")),
          `${name} issued a git command outside its T209 allowance: ${call.argv.join(" ")}`,
        );
      } else {
        assert.fail(`${name} executed an unexpected binary: ${call.executable}`);
      }
      return { status: 0, stdout: "mod.py\nREADME.md\npyproject.toml\n", stderr: "" };
    });
    const broker = createCommandBroker({ runner: { run } });

    await withFixture(`t209-${name}`, { "mod.py": "x = 1\n" }, async (dir) => {
      const result = await scan(dir, {}, broker);
      assert.ok(result && typeof result.dimension === "string", `${name} returned a result`);
    });

    assert.ok(calls.length >= 1, `${name} must enumerate files through the broker`);
    assert.ok(
      calls.every((call) => call.executable === "rg" || call.executable === "git"),
      `${name} must only ever execute rg or git`,
    );
    assert.ok(
      calls.every((call) => call.shell === false),
      `${name} must never enable shell mode`,
    );
  }
});

test("T209 target runtime probes are never executed even when runtimes are detected", async () => {
  // A recording runner that FAILS loudly if any runtime probe binary is ever
  // invoked (python3, node, rustc, bash --version, deno, bun, ...). The deep
  // scanners must derive runtime facts from declarations alone.
  const probeBinaries = new Set([
    "python3",
    "python",
    "node",
    "rustc",
    "cargo",
    "bash",
    "deno",
    "bun",
  ]);
  const { run } = createRecordingRunner((call) => {
    assert.ok(
      !probeBinaries.has(call.executable),
      `target runtime probe executed: ${call.executable}`,
    );
    return { status: 0, stdout: "", stderr: "" };
  });
  const broker = createCommandBroker({ runner: { run } });

  const files = {
    "pyproject.toml": '[project]\nname = "d"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n',
    ".python-version": "3.12.2\n",
    "Cargo.toml": '[package]\nname = "r"\nversion = "0.1.0"\nrust-version = "1.75"\n',
    "package.json": JSON.stringify({ name: "j", version: "0.1.0", engines: { node: ">=20" } }),
    ".nvmrc": "20.10.0\n",
    "mod.py": "def f():\n    return 1\n",
    "src/main.rs": "fn main() {}\n",
    "src/index.js": "export const x = 1;\n",
  };

  await withFixture("t209-no-probe", files, async (dir) => {
    for (const [, scan] of FIVE_SCANNERS) {
      await scan(dir, {}, broker);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Conflicting declarations coexist with provenance (never a single verdict)
// ---------------------------------------------------------------------------

test("T209 conflicting runtime declarations coexist with per-artifact provenance", async () => {
  const files = {
    "pyproject.toml": '[project]\nname = "demo"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n',
    ".python-version": "3.12.2\n",
    Dockerfile: 'FROM python:3.11-slim\nCMD ["python", "app.py"]\n',
    ".github/workflows/ci.yml": [
      "name: ci",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    container: python:3.12",
      "    steps:",
      "      - run: python -m pytest",
      "",
    ].join("\n"),
  };
  const overviewFiles = [
    "pyproject.toml",
    ".python-version",
    "Dockerfile",
    ".github/workflows/ci.yml",
  ];

  await withFixture("t209-coexist", files, async (dir) => {
    const res = await scanStack(dir, { files: overviewFiles });
    const f = res.findings;

    assert.ok(f.runtime.startsWith("Python"), `runtime must be Python-based: ${f.runtime}`);
    assert.ok(
      f.runtime.includes("declared"),
      `runtime must state declarations, not a verdict: ${f.runtime}`,
    );
    assert.ok(!/\bactual\b/.test(f.runtime), "runtime must never claim an actual runtime");

    const sources = f.runtimeDeclarations.map((d) => d.source).toSorted();
    assert.ok(
      sources.includes("pyproject.toml#requires-python"),
      `requires-python provenance missing: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes(".python-version"),
      `.python-version provenance missing: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes("Dockerfile#FROM"),
      `Dockerfile FROM provenance missing: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes(".github/workflows/ci.yml#container"),
      `workflow container provenance missing: ${sources.join(", ")}`,
    );

    const versions = f.runtimeDeclarations.map((d) => d.version).toSorted();
    assert.deepEqual(
      versions,
      [">=3.10", "3.12.2", "python:3.11-slim", "python:3.12"].toSorted(),
      "every conflicting declared version must coexist",
    );

    // The scalar pin still prefers the manifest field, but the full evidence
    // set above retains every source.
    assert.equal(f.requiresPython, ">=3.10");
    assert.ok(f.containerImages.some((entry) => entry.image === "python:3.11-slim"));
    assert.ok(f.containerImages.some((entry) => entry.image === "python:3.12"));
    assert.ok(f.workflowRunners.some((entry) => entry.runner === "ubuntu-latest"));
  });
});

// ---------------------------------------------------------------------------
// 4. Static-runtime fixture matrix across the five ecosystems
// ---------------------------------------------------------------------------

test("T209 static-runtime fixture matrix covers all five ecosystems from declarations only", async () => {
  const nodePkg = JSON.stringify(
    { name: "demo", version: "0.1.0", engines: { node: ">=18.0.0" } },
    null,
    2,
  );

  const cases = [
    {
      name: "python",
      files: {
        "pyproject.toml": '[project]\nname = "d"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n',
        ".python-version": "3.11.9\n",
        "mod.py": "def f():\n    return 1\n",
      },
      filesList: ["pyproject.toml", ".python-version", "mod.py"],
      ecosystems: { primary: "python", all: ["python"] },
      assert: (f) => {
        assert.ok(f.runtime.startsWith("Python"), `python runtime: ${f.runtime}`);
        assert.equal(f.requiresPython, ">=3.10");
        assert.ok(
          f.runtimeDeclarations.some(
            (d) => d.version === "3.11.9" && d.source === ".python-version",
          ),
        );
        assert.ok(
          f.runtimeDeclarations.some(
            (d) => d.version === ">=3.10" && d.source === "pyproject.toml#requires-python",
          ),
        );
      },
    },
    {
      name: "javascript",
      files: {
        "package.json": nodePkg,
        ".nvmrc": "20.10.0\n",
        "src/index.js": "export const x = 1;\n",
      },
      filesList: ["package.json", ".nvmrc", "src/index.js"],
      ecosystems: { primary: "javascript", all: ["javascript"] },
      assert: (f) => {
        assert.ok(f.runtime.startsWith("Node.js"), `js runtime: ${f.runtime}`);
        assert.equal(f.nodeVersion, ">=18.0.0");
        assert.ok(
          f.runtimeDeclarations.some(
            (d) => d.source === "package.json#engines.node" && d.version === ">=18.0.0",
          ),
        );
        assert.ok(
          f.runtimeDeclarations.some((d) => d.source === ".nvmrc" && d.version === "20.10.0"),
        );
      },
    },
    {
      name: "typescript",
      files: {
        "package.json": nodePkg,
        ".nvmrc": "22.0.0\n",
        "src/index.ts": "export const x: number = 1;\n",
      },
      filesList: ["package.json", ".nvmrc", "src/index.ts"],
      ecosystems: { primary: "typescript", all: ["typescript"] },
      assert: (f) => {
        assert.ok(f.runtime.startsWith("Node.js"), `ts runtime: ${f.runtime}`);
        assert.equal(f.nodeVersion, ">=18.0.0");
        assert.ok(
          f.runtimeDeclarations.some((d) => d.source === ".nvmrc" && d.version === "22.0.0"),
        );
      },
    },
    {
      name: "rust",
      files: {
        "Cargo.toml": '[package]\nname = "r"\nversion = "0.1.0"\nrust-version = "1.75"\n',
        "rust-toolchain": "1.70.0\n",
        "src/main.rs": "fn main() {}\n",
      },
      filesList: ["Cargo.toml", "rust-toolchain", "src/main.rs"],
      ecosystems: { primary: "rust", all: ["rust"] },
      assert: (f) => {
        assert.ok(f.runtime.toLowerCase().startsWith("rust"), `rust runtime: ${f.runtime}`);
        assert.equal(f.rustVersion, "1.75");
        assert.ok(
          f.runtimeDeclarations.some(
            (d) => d.source === "Cargo.toml#rust-version" && d.version === "1.75",
          ),
        );
        assert.ok(
          f.runtimeDeclarations.some(
            (d) => d.source === "rust-toolchain" && d.version === "1.70.0",
          ),
        );
      },
    },
    {
      name: "shell",
      files: {
        Makefile: "build:\n\t./scripts/build.sh\n",
        "scripts/build.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n",
      },
      filesList: ["Makefile", "scripts/build.sh"],
      ecosystems: { primary: "shell", all: ["shell"] },
      assert: (f) => {
        assert.ok(f.runtime.toLowerCase().startsWith("shell"), `shell runtime: ${f.runtime}`);
        assert.match(f.runtime, /no declared runtime version/);
        assert.deepEqual(f.runtimeDeclarations, []);
      },
    },
  ];

  for (const c of cases) {
    await withFixture(`t209-matrix-${c.name}`, c.files, async (dir) => {
      const res = await scanStack(dir, {
        files: c.filesList,
        languages: [
          c.name === "typescript"
            ? "TypeScript"
            : c.name === "javascript"
              ? "JavaScript"
              : c.name === "python"
                ? "Python"
                : c.name === "rust"
                  ? "Rust"
                  : "Shell",
        ],
        ecosystems: c.ecosystems,
      });
      c.assert(res.findings);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Broker-only command usage is the single execution channel
// ---------------------------------------------------------------------------

test("T209 the six owned files acquire no process capability outside the broker", () => {
  for (const rel of SIX_OWNED_FILES) {
    const source = readSource(rel);
    assert.ok(
      !/import\s*\([^)]*node:child_process/.test(source),
      `${rel} must not dynamically import node:child_process`,
    );
    assert.ok(
      !/\bprocess\.\s*getBuiltinModule\b/.test(source),
      `${rel} must not acquire builtins through process`,
    );
  }
  const broker = readSource("lib/scan/shared/command.mjs");
  assert.ok(
    normalizeQuotes(broker).includes('import { execFile } from "node:child_process";'),
    "broker must remain the sole child-process owner",
  );
});
