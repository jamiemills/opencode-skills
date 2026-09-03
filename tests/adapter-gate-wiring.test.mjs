import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  hasCompletePassingSummary,
  hasCompleteBrowserE2ESummary,
  hasSkippedTests,
  parseBrowserE2ESummary,
  parseTapSummary,
  redactDiagnosticText,
} from "../scripts/adapter-required-tests.mjs";
import { IMAGE as BROWSER_RUNTIME_IMAGE } from "../csm-browse/lib/constants.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function make(args, env = {}) {
  return execFileSync("make", args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("adapter integration gates are explicit, required, and separate from default tests", async () => {
  const makefile = await readFile(join(root, "Makefile"), "utf8");
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");

  assert.match(makefile, /test-e2e-required:/);
  assert.match(makefile, /CSM_BROWSE_E2E_REQUIRE=1/);
  assert.match(makefile, /--browser-e2e-required/);
  assert.match(makefile, /test-generated-sandbox-required:/);
  assert.match(makefile, /--generated-sandbox-required/);
  assert.match(makefile, /test-adapter-integrations:/);
  assert.match(makefile, /CSM_ADAPTER_INTEGRATIONS_APPROVED/);
  assert.match(makefile, /test-adapter-integrations-required/);
  assert.doesNotMatch(makefile.match(/^test:.*$/m)?.[0] ?? "", /test-adapter-integrations/);
  assert.match(workflow, /adapter-integrations:\s*\n\s+name: Adapter integrations/);
  assert.match(workflow, /Install browser media tooling/);
  assert.match(workflow, /apt-get install --no-install-recommends -y ffmpeg/);
  assert.match(workflow, /needs: gates/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /needs\.gates\.result.*success/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(
    workflow,
    /timeout --signal=TERM --kill-after=30s 12m make test-adapter-integrations-required/,
  );
  assert.match(workflow, /test "\$CSM_ADAPTER_INTEGRATIONS" = 1/);
  assert.match(workflow, /test "\$CSM_ADAPTER_INTEGRATIONS_APPROVED" = 1/);
  assert.match(workflow, /node scripts\/adapter-ci-preflight\.mjs/);
  assert.match(workflow, /Remove stale adapter browser resources/);
  assert.match(workflow, /docker rm -f chromium-vnc/);
  assert.match(workflow, /SANDBOX_IMAGE: node@sha256:[0-9a-f]{64}/);
  assert.match(workflow, /SANDBOX_IMAGE_TAG: node:22\.22\.0-bookworm-slim/);
  assert.match(workflow, /docker run --rm.*node --version/);
  assert.match(workflow, /= v22\.22\.0/);
  assert.match(workflow, /test "\$sandbox_digest" = "node@\$SANDBOX_IMAGE_DIGEST"/);
  assert.match(workflow, /docker pull "\$BROWSER_IMAGE"/);
  assert.match(workflow, /runtime_browser_image=.*csm-browse\/lib\/constants\.mjs/);
  assert.match(workflow, /test "\$BROWSER_IMAGE" = "\$runtime_browser_image"/);
  assert.match(workflow, /test "\$BROWSER_IMAGE_DIGEST" = "\$runtime_browser_digest"/);
  assert.match(workflow, new RegExp(`BROWSER_IMAGE: ${BROWSER_RUNTIME_IMAGE}`));
  assert.match(
    workflow,
    new RegExp(`BROWSER_IMAGE_DIGEST: ${BROWSER_RUNTIME_IMAGE.split("@")[1]}`),
  );
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /CHECKOUT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /test "\$CHECKOUT_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /test -n "\$PR_HEAD_SHA"/);
  assert.match(workflow, /source intent, not the commit checked out/);
  assert.match(workflow, /node scripts\/adapter-required-tests\.mjs --redact/);
  const gates = workflow.slice(
    workflow.indexOf("  gates:"),
    workflow.indexOf("  adapter-integrations:"),
  );
  assert.doesNotMatch(gates, /adapter-integrations|test-adapter-integrations/);
});

test("required adapter execution rejects skipped live TAP tests", async () => {
  const helper = await readFile(join(root, "scripts/adapter-required-tests.mjs"), "utf8");
  assert.match(helper, /CSM_ADAPTER_INTEGRATIONS_REQUIRED: "1"/);
  assert.match(helper, /SKIP/);
  assert.match(helper, /process\.exitCode = 1/);
});

test("required adapter execution rejects a summary-only Node skip", () => {
  assert.equal(hasSkippedTests("# tests 1\n# pass 1\n# fail 0\n# skipped 1\n"), true);
  assert.equal(hasSkippedTests("# tests 1\n# pass 1\n# fail 0\n# skipped 0\n"), false);
});

test("required adapter execution requires a complete passing TAP summary", () => {
  const passing = "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.deepEqual(parseTapSummary(passing), {
    tests: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  });
  assert.equal(hasCompletePassingSummary(passing), true);
  assert.equal(hasCompletePassingSummary("# tests 0\n# pass 0\n# fail 0\n# skipped 0\n"), false);
  assert.equal(hasCompletePassingSummary("# tests 2\n# pass 1\n# fail 1\n# skipped 0\n"), false);
  assert.equal(hasCompletePassingSummary("# tests 2\n# pass 2\n# fail 0\n"), false);
  assert.equal(
    hasCompletePassingSummary(
      "# tests 2\n# pass 2\n# fail 0\n# cancelled 1\n# skipped 0\n# todo 0\n",
    ),
    false,
  );
  assert.equal(
    hasCompletePassingSummary(
      "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 1\n",
    ),
    false,
  );
  assert.equal(parseTapSummary("# tests 2\n# pass 2\n# fail 0\n# skipped 0\n"), null);
  assert.equal(
    parseTapSummary(
      "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# tests 3\n# pass 3\n",
    ),
    null,
  );
});

test("required browser E2E execution requires its custom complete summary", () => {
  assert.deepEqual(parseBrowserE2ESummary({ pass: 3, fail: 0, total: 3 }), {
    pass: 3,
    fail: 0,
    total: 3,
    skipped: 0,
  });
  assert.equal(hasCompleteBrowserE2ESummary({ pass: 3, fail: 0, total: 3 }), true);
  assert.equal(hasCompleteBrowserE2ESummary({ pass: 3, fail: 0, total: 3, skipped: 1 }), false);
  assert.equal(hasCompleteBrowserE2ESummary({ pass: 0, fail: 0, total: 0 }), false);
  assert.equal(hasCompleteBrowserE2ESummary({ pass: 2, fail: 1, total: 3 }), false);
});

test("required wrappers retain child status and bounded diagnostics", async () => {
  const helper = await readFile(join(root, "scripts/adapter-required-tests.mjs"), "utf8");
  assert.match(helper, /--browser-e2e-required/);
  assert.match(helper, /--generated-sandbox-required/);
  assert.match(helper, /result\.code/);
  assert.match(helper, /MAX_DIAGNOSTIC_BYTES/);
  assert.match(helper, /finally/);
});

test("diagnostic redaction covers URL, escaped JSON, multiline, and credential variants", () => {
  const secrets = ["url-secret", "json-secret", "line-secret", "vnc-secret", "key-secret"];
  const input = `https://example.test/?access_token=${secrets[0]}&ok=1\n{"api_key":"${secrets[1]}\\"quoted"}\nVNC_PASSWORD: ${secrets[2]}\naccess_token=${secrets[3]}\napi_key='${secrets[4]}'`;
  const output = redactDiagnosticText(input);
  for (const secret of secrets) assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /access_token=\[REDACTED\]/);
  assert.match(output, /api_key":"\[REDACTED\]"/);
  assert.match(output, /VNC_PASSWORD: \[REDACTED\]/);
  assert.ok(redactDiagnosticText("x".repeat(300_000)).length <= 200_000);
});

test("adapter preflight supports local output and GitHub environment output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adapter-preflight-"));
  try {
    const localOutput = join(dir, "local.env");
    execFileSync(process.execPath, ["scripts/adapter-ci-preflight.mjs", "--output", localOutput], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: dir, GITHUB_ENV: "" },
      stdio: "ignore",
    });
    const ciOutput = join(dir, "github.env");
    const githubEnv = join(dir, "GITHUB_ENV");
    execFileSync(process.execPath, ["scripts/adapter-ci-preflight.mjs", "--output", ciOutput], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: dir, GITHUB_ENV: githubEnv },
      stdio: "ignore",
    });
    const [local, ci] = await Promise.all([
      readFile(localOutput, "utf8"),
      readFile(githubEnv, "utf8"),
    ]);
    assert.match(local, /HOME=.+\/csm-adapter-runtime\/home/);
    assert.equal(ci, local);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default adapter integration gate records a skip, not completion evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adapter-gate-"));
  try {
    const summary = join(dir, "github-summary.md");
    const output = make(["test-adapter-integrations"], {
      CSM_ADAPTER_INTEGRATIONS: "0",
      CSM_ADAPTER_INTEGRATIONS_APPROVED: "0",
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.match(output, /SKIP: adapter integration gates not opted in/);
    assert.doesNotMatch(output, /PASS:|VERIFIED|completed/i);
    const record = await readFile(summary, "utf8");
    assert.match(record, /Status:\*\* SKIPPED/);
    assert.match(record, /opt-in was not enabled/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
