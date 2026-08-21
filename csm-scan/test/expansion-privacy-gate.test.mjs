// T227 — privacy canary gate across every output sink.
//
// Owned by T227. Proves the expanded production pipeline emits zero sensitive
// values on every sink the plan names (AC17 / R5):
//   - CLI stdout, stderr, and error surfaces (scripts/scan.mjs with the T224
//     sanitized stdio guard),
//   - the rendered Markdown (NORMS.md),
//   - the structured `findings`/`global` envelopes returned by
//     `runExpandedPipeline`,
//   - the T224 reporter diagnostics, and
//   - the T206/T224 privacy primitives themselves (`assertPrivacySafe`,
//     `sanitizeText`, `formatError`).
//
// Canary classes: personal names, emails, absolute POSIX/Windows/UNC paths,
// credentials and tokens, raw commit subjects, CODEOWNERS identities, SARIF
// messages/snippets, and SBOM contacts/serials/download-VCS URLs/hashes.
//
// Since T005 the Markdown report renders the repository root path relatively
// (`- **Path**: `.` ` at the repo root, never the host absolute path), drops
// package.json script bodies, and routes the overview description and
// cross-observation free text through the T224 sanitizer. The fixture's own
// root path and the scripts/description canaries are therefore asserted absent
// from the rendered Markdown. The structured `findings` envelope intentionally
// retains raw scan inputs (deep scanners keep script bodies internally), so the
// scripts/description canaries are Markdown-level assertions, not members of
// the shared CANARIES list.
//
// Scope (own-only): this test file. No production, baseline, or other test is
// edited.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import { makeFixture, cleanupFixture } from "./harness.mjs";
import { runExpandedPipeline } from "../lib/scan/pipeline/run.mjs";
import { createReporter, formatError, sanitizeText } from "../lib/scan/report/reporter.mjs";
import { assertPrivacySafe, PrivacyError, redactText } from "../lib/scan/shared/privacy.mjs";
import { makeGitRepo, cleanupGitRepo } from "./helpers/git-fixture.mjs";

const execFileAsync = promisify(execFile);
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, "..");
const SCAN_SCRIPT = join(ROOT, "scripts", "scan.mjs");

const FIXED_CLOCK = () => "2026-08-03";

// Every canary must stay absent from every sink. Add deliberate review before
// weakening any entry.
const CANARIES = Object.freeze([
  "Alice Smith", // personal name
  "alice.smith@example.test", // email
  "/etc/privacy/path.conf", // POSIX absolute path
  "C:\\Users\\priv\\secret.conf", // Windows absolute path
  "\\\\server\\share\\secret.conf", // UNC path
  "privacy-super-secret-token-77", // secret token value
  "PrivacyPassw0rd-99", // credential value
  "ghp_\x70rivacy_fixture_token_88", // GitHub PAT shape
  "@alice-dev", // CODEOWNERS identity
  "privacy-canary-commit-subject", // raw commit subject
  "privacy-sarif-message", // SARIF message text
  "privacy-snippet", // SARIF snippet text
  "urn:uuid:privacy-serial-1111", // SBOM serial
  "privacy-sbom-hash-2222", // SBOM content hash
  "privacy-sbom-contact", // SBOM contact identity
  "https://downloads.example.test/privacy-lib-1.0.0.tgz", // SBOM download URL
  "https://github.com/acme/privacy-lib.git", // SBOM VCS URL
  "https://user:pass@db.example.test/primary", // URL with embedded credentials
  "alice:secret@github.com", // raw git remote with credentials
]);

const SARIF = {
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "privacy-scan",
          rules: [{ id: "R1", shortDescription: { text: "privacy-sarif-message" } }],
        },
      },
      results: [
        {
          ruleId: "R1",
          message: { text: "privacy-sarif-message leak" },
          codeFlows: [
            {
              threadFlows: [
                {
                  locations: [
                    {
                      location: {
                        physicalLocation: {
                          artifactLocation: { uri: "src/a.js" },
                          region: { snippet: { text: "privacy-snippet" } },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const SBOM = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:privacy-serial-1111",
  components: [
    {
      type: "library",
      name: "privacy-lib",
      version: "1.0.0",
      purl: "pkg:npm/privacy-lib@1.0.0",
      hashes: [{ alg: "SHA-256", content: "privacy-sbom-hash-2222" }],
      licenses: [{ license: { id: "MIT" } }],
      externalReferences: [
        { type: "distribution", url: "https://downloads.example.test/privacy-lib-1.0.0.tgz" },
        { type: "vcs", url: "https://github.com/acme/privacy-lib.git" },
      ],
      supplier: {
        name: "privacy-sbom-contact",
        contact: [{ name: "Alice Smith", email: "alice.smith@example.test" }],
      },
    },
  ],
};

// T005 canaries planted in the repository manifest itself: a ghp_-shaped PAT
// inside a package.json scripts value and inside the description. The script
// body must never render (bodies are dropped); the description token must be
// redacted by the sanitizer. Alphanumeric-only after the prefix so the token
// matches the ghp_[A-Za-z0-9]{20,} redaction shape.
const SCRIPTS_DESCRIPTION_CANARIES = Object.freeze([
  "ghp_\x31privacyscripttoken99",
  "echo deploy using ghp_\x31privacyscripttoken99",
]);

function canaryFiles() {
  return {
    "package.json": JSON.stringify({
      name: "privacy-canary",
      type: "module",
      description:
        "Canary package description carrying ghp_\x31privacyscripttoken99 for the report redaction gate",
      scripts: {
        deploy: "echo deploy using ghp_\x31privacyscripttoken99",
      },
    }),
    "README.md": "Contact Alice Smith <alice.smith@example.test>\n",
    "src/config.js": [
      "export const cfg = {",
      "  api_token: 'privacy-super-secret-token-77',",
      "  password: 'PrivacyPassw0rd-99',",
      "  github: 'ghp_\x70rivacy_fixture_token_88',",
      "};",
      "",
    ].join("\n"),
    "src/paths.js": [
      "export const p = [",
      "  '/etc/privacy/path.conf',",
      "  'C:\\\\Users\\\\priv\\\\secret.conf',",
      "  '\\\\\\\\server\\\\share\\\\secret.conf',",
      "];",
      "",
    ].join("\n"),
    ".github/CODEOWNERS": "* @alice-dev privacy-team\n",
    "sbom.json": JSON.stringify(SBOM, null, 2),
    "sarif.json": JSON.stringify(SARIF, null, 2),
    "src/db.js": "export const url = 'https://user:pass@db.example.test/primary';\n",
  };
}

function assertZeroLeaks(label, blob) {
  for (const canary of CANARIES) {
    assert.equal(blob.includes(canary), false, `${label} leaked canary ${JSON.stringify(canary)}`);
  }
}

test("T227 privacy: structured findings, global snapshot, and rendered Markdown carry zero canaries", async () => {
  const repo = makeFixture("t227-privacy-sinks", canaryFiles());
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-privacy-sinks-"));
  try {
    const result = await runExpandedPipeline({
      repos: [repo],
      out: join(outDir, "NORMS.md"),
      clock: FIXED_CLOCK,
    });
    const markdown = await readFile(join(outDir, "NORMS.md"), "utf8");
    assert.equal(
      markdown,
      result.markdown,
      "the written Markdown must equal the returned markdown",
    );

    const findingsBlob = `${JSON.stringify(result.findings)}\n${JSON.stringify(result.global)}`;
    const markdownBlob = markdown;
    assertZeroLeaks("structured findings/global", findingsBlob);
    assertZeroLeaks("rendered Markdown", markdownBlob);
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227/T005 privacy: script bodies, description secrets, and the fixture root never reach the rendered Markdown", async () => {
  const repo = makeFixture("t005-privacy-manifest", canaryFiles());
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t005-privacy-manifest-"));
  try {
    await runExpandedPipeline({
      repos: [repo],
      out: join(outDir, "NORMS.md"),
      clock: FIXED_CLOCK,
    });
    const markdown = await readFile(join(outDir, "NORMS.md"), "utf8");
    for (const canary of SCRIPTS_DESCRIPTION_CANARIES) {
      assert.equal(
        markdown.includes(canary),
        false,
        `rendered Markdown leaked manifest canary ${JSON.stringify(canary)}`,
      );
    }
    assert.equal(
      markdown.includes(repo),
      false,
      "rendered Markdown must not leak the fixture root absolute path",
    );
    assert.match(
      markdown,
      /- \*\*Path\*\*: `\.`/,
      "the repository root must render as the relative path `.`",
    );
    assert.ok(markdown.includes("### Scripts"), "script names must still render");
    assert.match(
      markdown,
      /\| deploy \| 1 command\(s\) \|/,
      "script rows render name + count, never the body",
    );
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227 privacy: reporter diagnostics carry zero canaries", async () => {
  const repo = makeFixture("t227-privacy-reporter", canaryFiles());
  try {
    const captured = [];
    const capture = {
      write: (chunk) => {
        captured.push(String(chunk));
        return true;
      },
    };
    const reporter = createReporter({ out: capture, err: capture });
    await runExpandedPipeline({
      repos: [repo],
      clock: FIXED_CLOCK,
      reporter,
      sink: () => "",
    });
    const reporterBlob = captured.join("\n");
    assert.ok(reporterBlob.length > 0, "the reporter must emit diagnostics");
    assertZeroLeaks("reporter diagnostics", reporterBlob);
  } finally {
    cleanupFixture(repo);
  }
});

test("T227 privacy: CLI stdout, stderr, and Markdown carry zero canaries over a git canary repository", async () => {
  const gitRepo = makeGitRepo({
    files: canaryFiles(),
    commits: [
      "fix: remove privacy-canary-commit-subject from config",
      {
        message: "feat: drop alice.smith@example.test references",
        user: "Alice Smith",
        email: "alice.smith@example.test",
      },
    ],
    remote: "https://alice:secret@github.com/acme/privacy-canary.git",
  });
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-privacy-cli-"));
  const outputPath = join(outDir, "NORMS.md");
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, "--repos", gitRepo, "--out", outputPath],
      { cwd: ROOT },
    );
    assert.equal(stderr, "", "a successful CLI run must produce no stderr");
    const markdown = await readFile(outputPath, "utf8");
    assertZeroLeaks("CLI stdout", stdout);
    assertZeroLeaks("CLI stderr", stderr);
    assertZeroLeaks("CLI Markdown", markdown);
    // The sanitized stdio guard must redact the scanned root and the output path.
    assert.equal(
      stdout.includes(gitRepo),
      false,
      "CLI stdout must not leak the scanned repository root",
    );
    assert.equal(stdout.includes(outputPath), false, "CLI stdout must not leak the output path");
    assert.equal(stdout.includes("/tmp/"), false, "CLI stdout must not leak an absolute /tmp path");
    assert.equal(
      stdout.includes("alice:secret@"),
      false,
      "CLI stdout must not leak git remote credentials",
    );
  } finally {
    cleanupGitRepo(gitRepo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test("T227 privacy: CLI error output echoes user-typed paths but leaks no canaries", async () => {
  // Policy (plan csm-suite-improvements T003 + review R-A1): user-typed CLI args are
  // exempt from redaction — they are what the user typed, so the missing --repos path
  // IS echoed. Redaction still applies to scan-internal output (T224) and no canary
  // may appear anywhere in the error surface unless the user literally typed it.
  const missing = join(tmpdir(), `csm-scan-missing-path-${process.pid}-${Date.now()}`);
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-privacy-err-"));
  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [SCAN_SCRIPT, "--repos", missing, "--out", join(outDir, "NORMS.md")],
        { cwd: ROOT },
      ),
      (error) => {
        const blob = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        assert.equal(
          blob.includes(missing),
          true,
          "the error surface must echo the user-typed missing repository path (CLI-arg exemption)",
        );
        assertZeroLeaks("CLI error surface", blob);
        return true;
      },
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

// Context strings that exercise each privacy canary class through the T206/T224
// primitives. Bare token values are only sensitive inside an assignment form;
// SARIF/SBOM content canaries are excluded here because their absence is
// guaranteed by the projection in the sink tests above, not by a regex.
const PRIMITIVE_TRIGGERS = Object.freeze([
  "Alice Smith",
  "contact alice.smith@example.test",
  "read /etc/privacy/path.conf",
  "load C:\\Users\\priv\\secret.conf",
  "mount \\\\server\\share\\secret.conf",
  "api_token=privacy-super-secret-token-77",
  "password=PrivacyPassw0rd-99",
  "ghp_\x61bcdefghijklmnopqrstuvwx",
  "assign @alice-dev",
  "commit subject: privacy-canary-commit-subject",
  "https://user:pass@db.example.test/primary",
]);

test("T227 privacy: the T206/T224 primitives reject and redact every canary class", () => {
  for (const trigger of PRIMITIVE_TRIGGERS) {
    assert.throws(
      () => assertPrivacySafe({ value: trigger }),
      (error) => error instanceof PrivacyError && error.code === "SENSITIVE_VALUE",
      `${trigger} must trip the structured privacy gate`,
    );
  }
  for (const trigger of PRIMITIVE_TRIGGERS) {
    const sanitized = sanitizeText(trigger);
    assert.notEqual(sanitized, trigger, `sanitizeText must redact ${trigger}`);
    assert.ok(
      !CANARIES.some(
        (canary) => canary.length > 2 && trigger.includes(canary) && sanitized.includes(canary),
      ),
      `sanitizeText must remove the canary embedded in ${trigger}`,
    );
    const redacted = redactText(trigger);
    assert.ok(
      !CANARIES.some(
        (canary) => canary.length > 2 && trigger.includes(canary) && redacted.includes(canary),
      ),
      `redactText must remove the canary embedded in ${trigger}`,
    );
  }
  const rawError = new Error(`scan failed at ${CANARIES[2]} for ${CANARIES[1]}`);
  const formatted = formatError(rawError);
  assertZeroLeaks("formatError output", formatted);
  assert.ok(!formatted.includes(CANARIES[2]), "formatError must redact the embedded absolute path");
  assert.ok(!formatted.includes(CANARIES[1]), "formatError must redact the embedded email");
  assert.ok(!formatted.includes("stack"), "formatError must not render a stack trace");
});

test("T227 privacy: zero leaks across every sink in one combined run", async () => {
  const gitRepo = makeGitRepo({
    files: canaryFiles(),
    commits: ["feat: add privacy-canary-commit-subject handling"],
    remote: "https://alice:secret@github.com/acme/privacy-canary.git",
  });
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t227-privacy-total-"));
  try {
    const captured = [];
    const reporter = createReporter({
      out: {
        write: (chunk) => {
          captured.push(String(chunk));
          return true;
        },
      },
      err: {
        write: (chunk) => {
          captured.push(String(chunk));
          return true;
        },
      },
    });
    const result = await runExpandedPipeline({
      repos: [gitRepo],
      out: join(outDir, "NORMS.md"),
      clock: FIXED_CLOCK,
      reporter,
    });
    const markdown = await readFile(join(outDir, "NORMS.md"), "utf8");
    const everySink = [
      JSON.stringify(result.findings),
      JSON.stringify(result.global),
      markdown,
      captured.join("\n"),
    ].join("\n");
    assertZeroLeaks("combined every-sink blob", everySink);
  } finally {
    cleanupGitRepo(gitRepo);
    await rm(outDir, { recursive: true, force: true });
  }
});
