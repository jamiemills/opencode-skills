import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cleanupFixture, makeFixture } from "./harness.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_SCRIPT = join(REPO_ROOT, "scripts", "scan.mjs");

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCAN_SCRIPT, ...args], {
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("CLI reports factual cross-observations and detection coverage", async () => {
  const fixture = makeFixture("cli-cross-observation", {
    "package.json": JSON.stringify({ name: "cli-fixture", type: "module" }),
    Dockerfile: "FROM node:22-alpine\n",
    "src/app.js": "export const value = 1;\n",
    "test/app.test.js": "export const recognizedTestFile = true;\n",
  });
  const outputDir = mkdtempSync(join(tmpdir(), "csm-scan-cli-output-"));
  const outputPath = join(outputDir, "NORMS.json");

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, "--repos", fixture, "--out", outputPath],
      { cwd: REPO_ROOT },
    );

    assert.equal(stderr, "");
    assert.ok(existsSync(outputPath), "CLI must create the requested output file");
    assert.match(
      stdout,
      /\[CROSS-OBSERVATION\] testing framework reported as "unknown"; test files present/,
    );
    assert.match(
      stdout,
      /\[SCAN-NOTE\] security: dockerfiles present; security docker analysis not performed/,
    );
    assert.match(stdout, /\[INFERRED\]/);
    assert.match(stdout, /Detection coverage:/);
    assert.match(
      stdout,
      /(?:structure|stack|config|testing|conventions|git|architecture|documentation|security|operations|api|data|deployment|maintainability|governance|assurance|practices): scanned/,
    );
    assert.doesNotMatch(stdout, /Commit convention:\s*(?:N\/A|unknown|not applicable)/i);
    assert.doesNotMatch(stdout, /\[INFERRED\]\s+git:.*(?:N\/A|unknown|not applicable)/i);

    for (const legacyLabel of [
      "[CONTRADICTION]",
      "Cohesiveness:",
      "(undefined)",
      "weak dimensions",
      "still weak",
      "severity",
      "signal=",
      "[GAP]",
      "confidence:",
      "quality",
    ]) {
      assert.ok(!stdout.includes(legacyLabel), `stdout must not contain ${legacyLabel}`);
    }
    assert.doesNotMatch(
      stdout,
      /\b(?:signal|gap|confidence|quality|weak|cohesiveness|contradiction|conflict)\b/i,
    );

    const artifact = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(artifact.schema, "csm-envelope/1");
    assert.equal(artifact.contentType, "application/json");
    assert.equal(artifact.payloadSchema.id, "csm-norms/1");
    assert.equal(artifact.lifecycleStatus, "completed");
    assert.equal(artifact.verificationStatus, "verified");

    const source = readFileSync(SCAN_SCRIPT, "utf8");
    for (const legacySourceLabel of [
      "[CONTRADICTION]",
      "Cohesiveness:",
      "weak dimensions",
      "still weak",
      ".severity",
    ]) {
      assert.ok(
        !source.includes(legacySourceLabel),
        `scan.mjs must not contain ${legacySourceLabel}`,
      );
    }
  } finally {
    cleanupFixture(fixture);
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("CLI --help prints usage to stdout and exits 0 without scanning", async () => {
  const { code, stdout, stderr } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /Usage: scan\.mjs \[--repos <path>\.\.\.\] \[--out <path>\]/);
  assert.match(stdout, /current working directory/);
  assert.match(stdout, /privacy/);
});

test("CLI --version prints the version and exits 0", async () => {
  const { code, stdout, stderr } = await runCli(["--version"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout.trim(), /^csm-scan(?: \S+)?$/);
});

test('CLI unknown option prints "unknown option" to stderr and exits 2', async () => {
  const { code, stdout, stderr } = await runCli(["--bogus"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /unknown option: --bogus/);
  assert.match(stderr, /scan\.mjs --help/);
});

test("CLI --out without a value prints an error and exits 2", async () => {
  const { code, stdout, stderr } = await runCli(["--out"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /--out requires a path argument/);
  assert.match(stderr, /scan\.mjs --help/);
});

test("CLI rejects a nonexistent --repos path with a friendly error and exits 2", async () => {
  const missing = `csm-scan-cli-missing-${process.pid}-${Date.now()}`;
  const { code, stdout, stderr } = await runCli(["--repos", missing]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, new RegExp(`no such directory: ${missing}`));
  assert.match(stderr, /scan\.mjs --help/);
});

test("CLI prints an absolute nonexistent --repos path verbatim (user-typed CLI args are exempt from redaction)", async () => {
  const missing = join(tmpdir(), `csm-scan-cli-missing-abs-${process.pid}-${Date.now()}`);
  const { code, stdout, stderr } = await runCli(["--repos", missing]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.ok(
    stderr.includes(`no such directory: ${missing}`),
    `stderr must name the user-typed path, got: ${stderr}`,
  );
  assert.ok(!stderr.includes("[redacted]"), "the user-typed CLI path must not be redacted");
  assert.match(stderr, /scan\.mjs --help/);
});
