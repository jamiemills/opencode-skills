import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_DIAGNOSTIC_BYTES = 200_000;

export function hasSkippedTests(output) {
  const summary = output.match(/^\s*#\s*skipped\s+(\d+)\b/im);
  return Number(summary?.[1] ?? 0) > 0 || /(?:^|\n)\s*#\s*SKIP\b/im.test(output);
}

export function parseTapSummary(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findLastIndex((line) => /^\s*#\s+tests\s+\d+\s*$/i.test(line));
  if (start < 0) return null;
  const summary = {};
  for (const line of lines.slice(start)) {
    const match = line.match(/^\s*#\s+(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)\s*$/i);
    if (match) summary[match[1].toLowerCase()] = Number(match[2]);
  }
  if (
    !["tests", "pass", "fail", "skipped", "cancelled", "todo"].every((name) =>
      Object.hasOwn(summary, name),
    )
  )
    return null;
  return {
    tests: summary.tests,
    passed: summary.pass,
    failed: summary.fail,
    skipped: summary.skipped,
    cancelled: summary.cancelled,
    todo: summary.todo,
  };
}

export function hasCompletePassingSummary(output) {
  const summary = parseTapSummary(output);
  return Boolean(
    summary &&
    summary.tests > 0 &&
    summary.passed === summary.tests &&
    summary.failed === 0 &&
    summary.skipped === 0 &&
    summary.cancelled === 0 &&
    summary.todo === 0,
  );
}

export function parseBrowserE2ESummary(output) {
  if (!output || typeof output !== "object") return null;
  const { pass, fail, total, skipped = 0 } = output;
  if (![pass, fail, total, skipped].every((value) => Number.isInteger(value))) return null;
  return { pass, fail, total, skipped };
}

export function hasCompleteBrowserE2ESummary(output) {
  const summary = parseBrowserE2ESummary(output);
  return Boolean(
    summary &&
    summary.total > 0 &&
    summary.pass === summary.total &&
    summary.fail === 0 &&
    summary.skipped === 0,
  );
}

export function redactDiagnosticText(text) {
  const key = "(?:token|access_token|api_key|password|vnc_password|secret|authorization|cookie)";
  const redacted = text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(new RegExp(`(["']?${key}["']?\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), '$1"[REDACTED]"')
    .replace(
      new RegExp(`(["']?${key}["']?\\s*[:=]\\s*)'(?:\\\\.|[^'\\\\])*'`, "gi"),
      "$1'[REDACTED]'",
    )
    .replace(
      new RegExp(`(["']?${key}["']?\\s*[:=]\\s*)(?:Bearer\\s+)?[^\\s,;&}\\x22']+`, "gi"),
      "$1[REDACTED]",
    );
  return redacted.slice(0, MAX_DIAGNOSTIC_BYTES);
}

async function redactStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(redactDiagnosticText(input));
}

function runChild(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [command, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal, output }));
  });
}

function reportRequiredFailure(message, output = "") {
  console.error(message);
  if (output) console.error(`Required adapter diagnostics:\n${redactDiagnosticText(output)}`);
}

async function runRequiredBrowserE2E() {
  const dir = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "adapter-browser-e2e-"));
  const summaryPath = join(dir, "summary.json");
  try {
    const result = await runChild("csm-browse/tests/e2e.mjs", [], {
      CSM_BROWSE_E2E_REQUIRE: "1",
      CSM_BROWSE_E2E_SUMMARY: summaryPath,
    });
    let summary = null;
    try {
      summary = JSON.parse(await readFile(summaryPath, "utf8"));
    } catch {}
    if (result.code !== 0) {
      reportRequiredFailure(
        `Required browser E2E failed with status ${result.code}`,
        result.output,
      );
      process.exitCode = result.code;
    } else if (!hasCompleteBrowserE2ESummary(summary)) {
      reportRequiredFailure(
        "Required browser E2E did not report a complete passing summary",
        result.output,
      );
      process.exitCode = 1;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRequiredGeneratedSandbox() {
  const probe = await runChild("csm-autoresearch/scripts/probe-sandbox.mjs", ["--required"]);
  let probeResult = null;
  try {
    probeResult = JSON.parse(probe.output.trim().split(/\r?\n/).at(-1));
  } catch {}
  if (
    probe.code !== 0 ||
    probeResult?.status !== "available" ||
    probeResult?.verified !== true ||
    probeResult?.execution?.status !== "ok"
  ) {
    reportRequiredFailure(
      "Required generated sandbox did not complete verified execution",
      probe.output,
    );
    process.exitCode = probe.code || 1;
    return;
  }
  const tests = await runChild("--test", [
    "--test-concurrency=1",
    "csm-autoresearch/test/generated-sandbox.test.mjs",
  ]);
  if (tests.code !== 0) {
    reportRequiredFailure(
      `Required generated sandbox tests failed with status ${tests.code}`,
      tests.output,
    );
    process.exitCode = tests.code;
  } else if (hasSkippedTests(tests.output) || !hasCompletePassingSummary(tests.output)) {
    reportRequiredFailure(
      "Required generated sandbox tests did not report a complete passing, zero-skip TAP summary",
      tests.output,
    );
    process.exitCode = 1;
  }
}

async function main() {
  if (process.argv[2] === "--browser-e2e-required") return runRequiredBrowserE2E();
  if (process.argv[2] === "--generated-sandbox-required") return runRequiredGeneratedSandbox();
  const files = process.env.ADAPTER_REQUIRED_TEST_FILES?.split("\n").filter(Boolean) ?? [
    "tests/orchestrate-browse-live-integration.test.mjs",
    "tests/orchestrate-autoresearch-live-integration.test.mjs",
  ];
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CSM_ADAPTER_INTEGRATIONS_REQUIRED: "1" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) {
    process.exitCode = code ?? 1;
    if (hasSkippedTests(output))
      console.error("Required adapter tests reported an unexpected skip");
  } else if (hasSkippedTests(output)) {
    console.error("Required adapter tests reported an unexpected skip");
    process.exitCode = 1;
  } else if (!hasCompletePassingSummary(output)) {
    console.error("Required adapter tests did not report a complete passing TAP summary");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--redact") await redactStdin();
  else await main();
}
