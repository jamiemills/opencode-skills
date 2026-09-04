import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  adjudicate,
  md5HexFromBase64,
  MAX_DB_AGE_MS,
  MAX_FUTURE_SKEW_MS,
  METADATA_URL,
  runAudit,
  validateMetadata,
} from "../scripts/osv-audit.mjs";

const NOW = Date.parse("2026-09-04T06:00:00.000Z");
const validMetadata = () => ({
  name: "npm/all.zip",
  contentType: "application/zip",
  size: "10",
  generation: "1756955519701000",
  md5Hash: Buffer.from("0123456789abcdef").toString("base64"),
  updated: "2026-09-04T03:00:00.000Z",
});

test("validateMetadata accepts fresh complete metadata", () => {
  const result = validateMetadata(validMetadata(), NOW);
  assert.equal(result.ok, true);
});

test("validateMetadata rejects malformed, oversized, stale, and future metadata", () => {
  const cases = [
    [null, "not an object"],
    [{ ...validMetadata(), name: "PyPI/all.zip" }, "unexpected database object name"],
    [{ ...validMetadata(), contentType: "application/json" }, "content type"],
    [{ ...validMetadata(), size: 0 }, "invalid database size"],
    [{ ...validMetadata(), size: "not-a-number" }, "invalid database size"],
    [{ ...validMetadata(), size: "999999999999" }, "exceeds cap"],
    [{ ...validMetadata(), generation: "abc" }, "invalid database generation"],
    [{ ...validMetadata(), md5Hash: "" }, "missing md5Hash"],
    [{ ...validMetadata(), updated: "not-a-date" }, "invalid updated"],
    [
      { ...validMetadata(), updated: new Date(NOW + MAX_FUTURE_SKEW_MS + 1).toISOString() },
      "future beyond skew",
    ],
    [
      { ...validMetadata(), updated: new Date(NOW - MAX_DB_AGE_MS - 1).toISOString() },
      "policy maximum",
    ],
  ];
  for (const [metadata, fragment] of cases) {
    const result = validateMetadata(metadata, NOW);
    assert.equal(result.ok, false, JSON.stringify(metadata));
    assert.match(result.reason, new RegExp(fragment, "i"));
  }
});

test("md5HexFromBase64 decodes GCS metadata hashes", () => {
  assert.equal(md5HexFromBase64(Buffer.from([1, 2, 3]).toString("base64")), "010203");
});

test("adjudicate accepts a clean zero-findings report", () => {
  const source = resolve("/ws/pnpm-lock.yaml");
  const verdict = adjudicate({
    status: 0,
    stderr: "",
    reportText: JSON.stringify({
      results: [
        { source: { path: source, type: "lockfile" }, packages: [{ package: { name: "ajv" } }] },
      ],
    }),
    expectedSources: [source],
  });
  assert.deepEqual(verdict, { ok: true, status: 0, vulnCount: 0, sources: { [source]: 1 } });
});

test("adjudicate accepts a finding report with status 1", () => {
  const source = resolve("/ws/pnpm-lock.yaml");
  const verdict = adjudicate({
    status: 1,
    stderr: "",
    reportText: JSON.stringify({
      results: [
        {
          source: { path: source, type: "lockfile" },
          packages: [{ package: { name: "x" }, vulnerabilities: [{ id: "GHSA-1" }] }],
        },
      ],
    }),
    expectedSources: [source],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.vulnCount, 1);
});

test("adjudicate rejects every failure class", () => {
  const source = resolve("/ws/pnpm-lock.yaml");
  const other = resolve("/ws/csm-browse/pnpm-lock.yaml");
  const clean = { results: [{ source: { path: source, type: "lockfile" }, packages: [{}] }] };
  const finding = {
    results: [
      {
        source: { path: source, type: "lockfile" },
        packages: [{ vulnerabilities: [{ id: "GHSA-1" }] }],
      },
    ],
  };
  const cases = [
    [
      "status",
      { status: 2, stderr: "", reportText: JSON.stringify(clean), expectedSources: [source] },
      "status 2",
    ],
    [
      "status",
      { status: null, stderr: "", reportText: JSON.stringify(clean), expectedSources: [source] },
      "status null",
    ],
    [
      "warning",
      {
        status: 0,
        stderr: "Warning: skipped bad.json\n",
        reportText: JSON.stringify(clean),
        expectedSources: [source],
      },
      "warnings",
    ],
    [
      "json",
      { status: 0, stderr: "", reportText: "{nope", expectedSources: [source] },
      "valid JSON",
    ],
    [
      "shape",
      { status: 0, stderr: "", reportText: "{}", expectedSources: [source] },
      "results array",
    ],
    [
      "source-type",
      {
        status: 0,
        stderr: "",
        reportText: JSON.stringify({
          results: [{ source: { path: source, type: "git" }, packages: [{}] }],
        }),
        expectedSources: [source],
      },
      "non-lockfile",
    ],
    [
      "duplicate",
      {
        status: 0,
        stderr: "",
        reportText: JSON.stringify({ results: [clean.results[0], clean.results[0]] }),
        expectedSources: [source],
      },
      "duplicate source",
    ],
    [
      "empty-inventory",
      {
        status: 0,
        stderr: "",
        reportText: JSON.stringify({
          results: [{ source: { path: source, type: "lockfile" }, packages: [] }],
        }),
        expectedSources: [source],
      },
      "no package inventory",
    ],
    [
      "missing-source",
      {
        status: 0,
        stderr: "",
        reportText: JSON.stringify(clean),
        expectedSources: [source, other],
      },
      "missing from report",
    ],
    [
      "unexpected-source",
      {
        status: 0,
        stderr: "",
        reportText: JSON.stringify({
          results: [
            ...clean.results,
            { source: { path: other, type: "lockfile" }, packages: [{}] },
          ],
        }),
        expectedSources: [source],
      },
      "unexpected sources",
    ],
    [
      "status0-findings",
      { status: 0, stderr: "", reportText: JSON.stringify(finding), expectedSources: [source] },
      "contains 1 vulnerabilities",
    ],
    [
      "status1-clean",
      { status: 1, stderr: "", reportText: JSON.stringify(clean), expectedSources: [source] },
      "no vulnerabilities",
    ],
  ];
  for (const [label, input, fragment] of cases) {
    const verdict = adjudicate(input);
    assert.equal(verdict.ok, false, label);
    assert.match(verdict.reason, new RegExp(fragment, "i"));
  }
});

function responseFrom(buffer, status = 200, contentType = "application/octet-stream") {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new Response(buffer).body,
    json: async () => JSON.parse(Buffer.from(buffer).toString("utf-8")),
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
  };
}

function fakeFetch({ scannerBytes, dbBytes, metadata, calls = [] }) {
  return async (url) => {
    calls.push(String(url));
    if (url.includes("osv-scanner_linux_amd64")) {
      return responseFrom(Buffer.alloc(scannerBytes, 7));
    }
    if (url.includes("alt=media")) {
      return responseFrom(Buffer.alloc(dbBytes, 9));
    }
    if (url === METADATA_URL) {
      return responseFrom(Buffer.from(JSON.stringify(metadata)), 200, "application/json");
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

async function setupWorkspace(t) {
  const workspace = await mkdtemp(join(tmpdir(), "osv-audit-ws-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const relative of ["pnpm-lock.yaml", "csm-browse/pnpm-lock.yaml"]) {
    const absolute = join(workspace, relative);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, "lockfileVersion: '9.0'\n", "utf-8");
  }
  return workspace;
}

function sha256Of(fill, size) {
  return createHash("sha256").update(Buffer.alloc(size, fill)).digest("hex");
}

function fakeRunProcess({ version = true, scanStatus = 0, report, scanArgs = null } = {}) {
  return async ({ cmd, args }) => {
    if (args.includes("--version")) {
      if (!version)
        return { status: 1, signal: null, stdout: "other", stderr: "", timedOut: false };
      return {
        status: 0,
        signal: null,
        stdout: "osv-scanner 2.3.8\n",
        stderr: "",
        timedOut: false,
      };
    }
    if (args[0] === "-t")
      return { status: 0, signal: null, stdout: "OK", stderr: "", timedOut: false };
    if (args[0] === "scan") {
      if (scanArgs) Object.assign(scanArgs, { list: args });
      const outputArg = args.find((arg) => arg.startsWith("--output-file="));
      if (report !== undefined) {
        const { writeFile: writeSync } = await import("node:fs/promises");
        await writeSync(
          outputArg.slice("--output-file=".length),
          typeof report === "string" ? report : JSON.stringify(report),
          "utf-8",
        );
      }
      return { status: scanStatus, signal: null, stdout: "", stderr: "", timedOut: false };
    }
    throw new Error(`unexpected process: ${cmd} ${args.join(" ")}`);
  };
}

test("runAudit passes a clean scan and records provenance", async (t) => {
  const workspace = await setupWorkspace(t);
  const metadata = { ...validMetadata(), size: "32" };
  const dbMd5 = createHash("md5").update(Buffer.alloc(32, 9)).digest("hex");
  metadata.md5Hash = Buffer.from(Buffer.from(dbMd5, "hex")).toString("base64");
  const scannerSha = sha256Of(7, 64);
  const calls = [];
  const scanArgs = { list: null };
  const outcome = await runAudit({
    fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, dbMd5Hex: dbMd5, metadata, calls }),
    now: () => NOW,
    runProcess: fakeRunProcess({
      scanStatus: 0,
      scanArgs,
      report: {
        results: [
          { source: { path: join(workspace, "pnpm-lock.yaml"), type: "lockfile" }, packages: [{}] },
          {
            source: { path: join(workspace, "csm-browse/pnpm-lock.yaml"), type: "lockfile" },
            packages: [{}, {}],
          },
        ],
      },
    }),
    workspaceRoot: workspace,
    scannerSha256: scannerSha,
    scannerBytes: 64,
    backoffMs: [1, 1],
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.verdict));
  assert.equal(outcome.summary.scannerVerified, true);
  assert.equal(outcome.summary.database.generation, metadata.generation);
  assert.equal(outcome.summary.vulnerabilities, 0);
  assert.ok(calls.some((url) => url.includes(`generation=${metadata.generation}`)));
  for (const flag of ["--offline", "--all-vulns", "--all-packages", "--format=json"]) {
    assert.ok(scanArgs.list.includes(flag), `scan args must include ${flag}`);
  }
  assert.ok(
    scanArgs.list.some((arg) => arg === "--lockfile" || arg.startsWith("--lockfile=")),
    "scan args must include explicit lockfiles",
  );
  assert.ok(
    scanArgs.list.some((arg) => arg.startsWith("--config=")),
    "scan args must override repository config",
  );
});

test("runAudit persists evidence artifacts for CI upload", async (t) => {
  const workspace = await setupWorkspace(t);
  const evidenceDir = await mkdtemp(join(tmpdir(), "osv-audit-ev-"));
  t.after(() => rm(evidenceDir, { recursive: true, force: true }));
  const metadata = { ...validMetadata(), size: "32" };
  const dbMd5 = createHash("md5").update(Buffer.alloc(32, 9)).digest("hex");
  metadata.md5Hash = Buffer.from(Buffer.from(dbMd5, "hex")).toString("base64");
  const outcome = await runAudit({
    fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, metadata }),
    now: () => NOW,
    runProcess: fakeRunProcess({
      scanStatus: 0,
      report: {
        results: [
          { source: { path: join(workspace, "pnpm-lock.yaml"), type: "lockfile" }, packages: [{}] },
          {
            source: { path: join(workspace, "csm-browse/pnpm-lock.yaml"), type: "lockfile" },
            packages: [{}],
          },
        ],
      },
    }),
    workspaceRoot: workspace,
    scannerSha256: sha256Of(7, 64),
    scannerBytes: 64,
    backoffMs: [1, 1],
    env: { OSV_AUDIT_EVIDENCE_DIR: evidenceDir },
  });
  assert.equal(outcome.ok, true);
  const { readdir, readFile: readEvidence } = await import("node:fs/promises");
  const names = (await readdir(evidenceDir)).toSorted();
  assert.deepEqual(names, ["osv-report.json", "stderr.txt", "summary.json"]);
  const persisted = JSON.parse(await readEvidence(join(evidenceDir, "summary.json"), "utf-8"));
  assert.equal(persisted.result, "clean");
  assert.equal(persisted.vulnerabilities, 0);

  const failureEvidence = await mkdtemp(join(tmpdir(), "osv-audit-ev2-"));
  t.after(() => rm(failureEvidence, { recursive: true, force: true }));
  const failed = await runAudit({
    fetch: async () => {
      throw new Error("registry unreachable");
    },
    now: () => NOW,
    runProcess: fakeRunProcess(),
    workspaceRoot: workspace,
    backoffMs: [1, 1],
    env: { OSV_AUDIT_EVIDENCE_DIR: failureEvidence },
  });
  assert.equal(failed.ok, false);
  const failedSummary = JSON.parse(
    await readEvidence(join(failureEvidence, "summary.json"), "utf-8"),
  );
  assert.equal(failedSummary.result, "failed");
  assert.match(failedSummary.reason, /registry unreachable/);
});

test("runAudit fails on scanner digest mismatch without executing the binary", async (t) => {
  const workspace = await setupWorkspace(t);
  const executed = [];
  const outcome = await runAudit({
    fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, metadata: validMetadata() }),
    now: () => NOW,
    runProcess: async (input) => {
      executed.push(input);
      return fakeRunProcess()({ ...input, args: ["--version"] });
    },
    workspaceRoot: workspace,
    scannerSha256: sha256Of(1, 64),
    scannerBytes: 64,
    backoffMs: [1, 1],
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.verdict.reason, /sha256 mismatch/);
  assert.deepEqual(executed, []);
});

test("runAudit fails stale and future-skewed metadata", async (t) => {
  for (const updated of ["2026-09-01T00:00:00.000Z", "2026-09-04T07:00:00.000Z"]) {
    const workspace = await setupWorkspace(t);
    const outcome = await runAudit({
      fetch: fakeFetch({
        scannerBytes: 64,
        dbBytes: 32,
        metadata: { ...validMetadata(), updated },
      }),
      now: () => NOW,
      runProcess: fakeRunProcess(),
      workspaceRoot: workspace,
      scannerSha256: sha256Of(7, 64),
      scannerBytes: 64,
      backoffMs: [1, 1],
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.verdict.reason, /future beyond skew|policy maximum/i);
  }
});

test("runAudit fails a database md5 mismatch", async (t) => {
  const workspace = await setupWorkspace(t);
  const metadata = validMetadata();
  metadata.size = 32;
  const outcome = await runAudit({
    fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, metadata }),
    now: () => NOW,
    runProcess: fakeRunProcess(),
    workspaceRoot: workspace,
    scannerSha256: sha256Of(7, 64),
    scannerBytes: 64,
    backoffMs: [1, 1],
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.verdict.reason, /md5 mismatch/);
});

test("runAudit fails findings, status/report mismatches, missing reports, and warnings", async (t) => {
  const cases = [
    ["finding", { scanStatus: 1, withFinding: true }, "failed"],
    ["status0-findings", { scanStatus: 0, withFinding: true }, "failed"],
    ["status1-clean", { scanStatus: 1, withFinding: false }, "failed"],
    [
      "missing-report",
      { scanStatus: 0, withFinding: false, noReport: true },
      "did not write a report",
    ],
  ];
  for (const [label, { scanStatus, withFinding, noReport }] of cases) {
    const workspace = await setupWorkspace(t);
    const metadata = validMetadata();
    metadata.size = "32";
    const dbMd5 = createHash("md5").update(Buffer.alloc(32, 9)).digest("hex");
    metadata.md5Hash = Buffer.from(Buffer.from(dbMd5, "hex")).toString("base64");
    const report = noReport
      ? undefined
      : {
          results: [
            {
              source: { path: join(workspace, "pnpm-lock.yaml"), type: "lockfile" },
              packages: withFinding ? [{ vulnerabilities: [{ id: "GHSA-1" }] }] : [{}],
            },
            {
              source: { path: join(workspace, "csm-browse/pnpm-lock.yaml"), type: "lockfile" },
              packages: [{}],
            },
          ],
        };
    const outcome = await runAudit({
      fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, metadata }),
      now: () => NOW,
      runProcess: fakeRunProcess({ scanStatus, report }),
      workspaceRoot: workspace,
      scannerSha256: sha256Of(7, 64),
      scannerBytes: 64,
      backoffMs: [1, 1],
    });
    assert.equal(outcome.ok, false, label);
    if (label === "finding" || label === "status0-findings" || label === "status1-clean") {
      assert.equal(outcome.summary.result, "failed");
    }
  }
});

test("runAudit fails on warnings and never retries non-retryable HTTP errors", async (t) => {
  const workspace = await setupWorkspace(t);
  const metadata = validMetadata();
  metadata.size = 32;
  const dbMd5 = createHash("md5").update(Buffer.alloc(32, 9)).digest("hex");
  metadata.md5Hash = Buffer.from(Buffer.from(dbMd5, "hex")).toString("base64");
  const warningOutcome = await runAudit({
    fetch: fakeFetch({ scannerBytes: 64, dbBytes: 32, metadata }),
    now: () => NOW,
    runProcess: async ({ cmd, args }) => {
      const base = fakeRunProcess({
        scanStatus: 0,
        report: {
          results: [
            {
              source: { path: join(workspace, "pnpm-lock.yaml"), type: "lockfile" },
              packages: [{}],
            },
            {
              source: { path: join(workspace, "csm-browse/pnpm-lock.yaml"), type: "lockfile" },
              packages: [{}],
            },
          ],
        },
      });
      const result = await base({ cmd, args });
      if (args[0] === "scan") result.stderr = "Warning: skipped malformed.json\n";
      return result;
    },
    workspaceRoot: workspace,
    scannerSha256: sha256Of(7, 64),
    scannerBytes: 64,
    backoffMs: [1, 1],
  });
  assert.equal(warningOutcome.ok, false);
  assert.match(warningOutcome.verdict.reason, /warnings/i);

  let attempts = 0;
  const outcome = await runAudit({
    fetch: async () => {
      attempts += 1;
      return { ok: false, status: 403, body: null };
    },
    now: () => NOW,
    runProcess: fakeRunProcess(),
    workspaceRoot: workspace,
    backoffMs: [1, 1],
  });
  assert.equal(outcome.ok, false);
  assert.equal(attempts, 1, "non-retryable HTTP status must fail immediately");

  let retryAttempts = 0;
  const retryOutcome = await runAudit({
    fetch: async () => {
      retryAttempts += 1;
      return { ok: false, status: 503, body: null };
    },
    now: () => NOW,
    runProcess: fakeRunProcess(),
    workspaceRoot: workspace,
    backoffMs: [1, 1],
  });
  assert.equal(retryOutcome.ok, false);
  assert.equal(retryAttempts, 3, "retryable HTTP status must exhaust all three attempts");
});
