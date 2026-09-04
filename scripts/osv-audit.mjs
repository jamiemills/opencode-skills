#!/usr/bin/env node
// Fail-closed dependency audit via checksum-pinned OSV-Scanner and a
// generation-bound OSV npm database. Never calls the npm security audit
// endpoint and never returns success on missing/invalid evidence.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

export const SCANNER_VERSION = "2.3.8";
export const SCANNER_URL =
  "https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_linux_amd64";
export const SCANNER_SHA256 = "bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc";
export const SCANNER_BYTES = 58335394;
export const METADATA_URL =
  "https://storage.googleapis.com/storage/v1/b/osv-vulnerabilities/o/npm%2Fall.zip";
export const LOCKFILES = ["pnpm-lock.yaml", "csm-browse/pnpm-lock.yaml"];
export const MAX_DB_AGE_MS = 48 * 60 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_DB_BYTES = 350 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [2000, 5000];
export const TIMEOUTS = {
  metadataMs: 15_000,
  binaryMs: 60_000,
  databaseMs: 90_000,
  scannerMs: 240_000,
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function validateMetadata(metadata, nowMs) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return { ok: false, reason: "database metadata is not an object" };
  if (metadata.name !== "npm/all.zip")
    return { ok: false, reason: `unexpected database object name: ${metadata.name}` };
  if (typeof metadata.contentType !== "string" || !metadata.contentType.includes("zip"))
    return { ok: false, reason: `unexpected database content type: ${metadata.contentType}` };
  // GCS JSON API reports uint64 fields as decimal strings.
  const size =
    typeof metadata.size === "string" && /^\d+$/.test(metadata.size)
      ? Number(metadata.size)
      : metadata.size;
  if (!Number.isInteger(size) || size <= 0)
    return { ok: false, reason: `invalid database size: ${metadata.size}` };
  if (size > MAX_DB_BYTES)
    return { ok: false, reason: `database size ${size} exceeds cap ${MAX_DB_BYTES}` };
  if (typeof metadata.generation !== "string" || !/^\d+$/.test(metadata.generation))
    return { ok: false, reason: `invalid database generation: ${metadata.generation}` };
  if (typeof metadata.md5Hash !== "string" || metadata.md5Hash.length === 0)
    return { ok: false, reason: "database metadata is missing md5Hash" };
  const updatedMs = Date.parse(metadata.updated);
  if (!Number.isFinite(updatedMs))
    return { ok: false, reason: `invalid updated timestamp: ${metadata.updated}` };
  if (updatedMs - nowMs > MAX_FUTURE_SKEW_MS)
    return {
      ok: false,
      reason: `database updated timestamp is in the future beyond skew: ${metadata.updated}`,
    };
  const age = nowMs - updatedMs;
  if (age > MAX_DB_AGE_MS)
    return {
      ok: false,
      reason: `database is ${Math.round(age / 3_600_000)}h old; policy maximum is ${MAX_DB_AGE_MS / 3_600_000}h`,
    };
  return { ok: true, updatedMs, ageMs: age, size };
}

export function md5HexFromBase64(b64) {
  return Buffer.from(b64, "base64").toString("hex");
}

export function adjudicate({ status, reportText, stderr, expectedSources }) {
  if (status !== 0 && status !== 1)
    return {
      ok: false,
      reason: `scanner exited with status ${status}; only 0 and 1 are adjudicable`,
    };
  const warningLines = String(stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => /^warning:/i.test(line));
  if (warningLines.length > 0)
    return { ok: false, reason: `scanner reported skipped evidence warnings: ${warningLines[0]}` };
  let report;
  try {
    report = JSON.parse(reportText);
  } catch {
    return { ok: false, reason: "scanner report is not valid JSON" };
  }
  if (!report || typeof report !== "object" || !Array.isArray(report.results))
    return { ok: false, reason: "scanner report has no results array" };
  const seen = new Map();
  let vulnCount = 0;
  for (const result of report.results) {
    const source = result?.source;
    if (!source || source.type !== "lockfile" || typeof source.path !== "string")
      return { ok: false, reason: "scanner report contains a non-lockfile or malformed source" };
    const canonical = resolve(source.path);
    if (seen.has(canonical))
      return { ok: false, reason: `duplicate source in report: ${canonical}` };
    if (!Array.isArray(result.packages) || result.packages.length === 0)
      return { ok: false, reason: `source produced no package inventory: ${canonical}` };
    for (const pkg of result.packages) {
      const count = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities.length : 0;
      vulnCount += count;
    }
    seen.set(canonical, result.packages.length);
  }
  for (const expected of expectedSources) {
    if (!seen.has(expected))
      return { ok: false, reason: `expected lockfile source missing from report: ${expected}` };
  }
  if (seen.size !== expectedSources.length) {
    const unexpected = [...seen.keys()].filter((path) => !expectedSources.includes(path));
    return { ok: false, reason: `unexpected sources in report: ${unexpected.join(", ")}` };
  }
  if (status === 0 && vulnCount !== 0)
    return {
      ok: false,
      reason: `scanner exited 0 but report contains ${vulnCount} vulnerabilities`,
    };
  if (status === 1 && vulnCount === 0)
    return { ok: false, reason: "scanner exited 1 but report contains no vulnerabilities" };
  return { ok: true, status, vulnCount, sources: Object.fromEntries(seen) };
}

async function sleep(ms) {
  await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

async function fetchBounded(deps, url, { timeoutMs, attempts, backoff, headers } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await deps.fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers,
      });
      if (response.ok) return response;
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.retryable = RETRYABLE_STATUS.has(response.status);
      if (!error.retryable) {
        await response.body?.cancel?.();
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
  }
  throw lastError ?? new Error(`request failed after ${attempts} attempts: ${url}`);
}

async function downloadToVerifiableFile(
  deps,
  url,
  timeoutMs,
  attempts,
  backoff,
  destPath,
  maxBytes,
) {
  // Body consumption happens inside the attempt loop: a reset or truncated
  // response body after HTTP 200 is the most likely transient failure for
  // large downloads and must be retried like a status-level failure.
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sha256 = createHash("sha256");
    const md5 = createHash("md5");
    let bytes = 0;
    try {
      const response = await deps.fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.retryable = RETRYABLE_STATUS.has(response.status);
        if (!error.retryable) {
          await response.body?.cancel?.();
          throw error;
        }
        throw error;
      }
      const out = createWriteStream(`${destPath}.part`, { flags: "w" });
      const stream = Readable.fromWeb(response.body);
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        sha256.update(chunk);
        md5.update(chunk);
        if (bytes > maxBytes) stream.destroy(new Error(`download exceeded ${maxBytes} bytes`));
      });
      await pipeline(stream, out);
      await rename(`${destPath}.part`, destPath);
      return { bytes, sha256: sha256.digest("hex"), md5: md5.digest("hex") };
    } catch (error) {
      lastError = error;
      if (error.retryable === false) throw error;
    }
    if (attempt < attempts) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
  }
  throw lastError ?? new Error(`download failed after ${attempts} attempts: ${url}`);
}

function defaultRunProcess({ cmd, args, timeoutMs, env }) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({
        status: null,
        signal: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ status: code, signal, stdout, stderr, timedOut });
    });
  });
}

export async function runAudit(deps = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    runProcess = defaultRunProcess,
    env = process.env,
    workspaceRoot = process.cwd(),
    lockfiles = LOCKFILES,
    scannerUrl = SCANNER_URL,
    scannerSha256 = SCANNER_SHA256,
    scannerBytes = SCANNER_BYTES,
    metadataUrl = METADATA_URL,
    backoffMs = BACKOFF_MS,
  } = deps;
  const fetchBoundedDeps = { fetch: fetchImpl };
  const baseTmp = env.OSV_AUDIT_TMP || tmpdir();
  const workRoot = await mkdtemp(join(baseTmp, "osv-audit-"));
  const summary = {
    scannerVersion: SCANNER_VERSION,
    binarySha256: SCANNER_SHA256,
    lockfiles: [...lockfiles],
  };
  const persistEvidence = async ({ reportPath = null, stderr = "" } = {}) => {
    if (!env.OSV_AUDIT_EVIDENCE_DIR) return;
    try {
      await mkdir(env.OSV_AUDIT_EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(env.OSV_AUDIT_EVIDENCE_DIR, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        { encoding: "utf-8" },
      );
      await writeFile(
        join(env.OSV_AUDIT_EVIDENCE_DIR, "stderr.txt"),
        String(stderr).slice(0, 20_000),
        {
          encoding: "utf-8",
        },
      );
      if (reportPath) {
        await copyFile(reportPath, join(env.OSV_AUDIT_EVIDENCE_DIR, "osv-report.json")).catch(
          () => {},
        );
      }
    } catch (error) {
      console.error(`dependency audit evidence could not be written: ${error?.message ?? error}`);
    }
  };
  try {
    const expectedSources = lockfiles.map((relative) => resolve(workspaceRoot, relative));
    for (const lockPath of expectedSources) {
      const info = await lstat(lockPath);
      if (!info.isFile()) throw new Error(`lockfile is not a regular file: ${lockPath}`);
    }

    const scannerPath = join(workRoot, "osv-scanner");
    const scannerDownload = await downloadToVerifiableFile(
      fetchBoundedDeps,
      scannerUrl,
      TIMEOUTS.binaryMs,
      MAX_ATTEMPTS,
      backoffMs,
      `${scannerPath}.part`,
      scannerBytes,
    );
    if (scannerDownload.bytes !== scannerBytes)
      throw new Error(`scanner download size ${scannerDownload.bytes} != expected ${scannerBytes}`);
    if (scannerDownload.sha256 !== scannerSha256)
      throw new Error(`scanner sha256 mismatch: ${scannerDownload.sha256}`);
    await rename(`${scannerPath}.part`, scannerPath);
    await chmod(scannerPath, 0o755);
    const versionRun = await runProcess({
      cmd: scannerPath,
      args: ["--version"],
      timeoutMs: 30_000,
    });
    if (versionRun.status !== 0 || !versionRun.stdout.includes(SCANNER_VERSION))
      throw new Error(`scanner version check failed: ${versionRun.stdout} ${versionRun.stderr}`);
    summary.scannerVerified = true;

    const metadataResponse = await fetchBounded(fetchBoundedDeps, metadataUrl, {
      timeoutMs: TIMEOUTS.metadataMs,
      attempts: MAX_ATTEMPTS,
      backoff: backoffMs,
    });
    const metadata = await metadataResponse.json();
    const metadataCheck = validateMetadata(metadata, now());
    if (!metadataCheck.ok) throw new Error(metadataCheck.reason);
    const expectedMd5 = md5HexFromBase64(metadata.md5Hash);
    summary.database = {
      generation: metadata.generation,
      updated: metadata.updated,
      ageHours: Math.round(metadataCheck.ageMs / 3_600_000),
      size: metadataCheck.size,
    };

    const mediaUrl = `${metadataUrl}?generation=${metadata.generation}&alt=media`;
    const dbPart = join(workRoot, "npm-all.zip.part");
    const dbDownload = await downloadToVerifiableFile(
      fetchBoundedDeps,
      mediaUrl,
      TIMEOUTS.databaseMs,
      MAX_ATTEMPTS,
      backoffMs,
      dbPart,
      MAX_DB_BYTES,
    );
    if (dbDownload.bytes !== metadataCheck.size)
      throw new Error(
        `database download size ${dbDownload.bytes} != metadata size ${metadataCheck.size}`,
      );
    if (dbDownload.md5 !== expectedMd5)
      throw new Error(`database md5 mismatch: ${dbDownload.md5} != ${expectedMd5}`);
    summary.database.sha256 = dbDownload.sha256;

    const zipRun = await runProcess({ cmd: "unzip", args: ["-t", dbPart], timeoutMs: 120_000 });
    if (zipRun.status !== 0 || zipRun.timedOut)
      throw new Error(`database zip integrity check failed: ${zipRun.stderr.slice(0, 400)}`);

    const cacheRoot = env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY || join(workRoot, "osv-db-cache");
    const dbDir = join(cacheRoot, "osv-scanner", "npm");
    await mkdir(dbDir, { recursive: true });
    await rename(dbPart, join(dbDir, "all.zip"));

    const emptyConfig = join(workRoot, "osv-scanner-empty.toml");
    await writeFile(emptyConfig, "", { encoding: "utf-8" });
    const reportPath = join(workRoot, "osv-report.json");
    const scanArgs = [
      "scan",
      "source",
      "--offline",
      "--all-vulns",
      "--all-packages",
      `--config=${emptyConfig}`,
      `--output-file=${reportPath}`,
      "--format=json",
      ...lockfiles.flatMap((relative) => ["--lockfile", resolve(workspaceRoot, relative)]),
    ];
    const scanRun = await runProcess({
      cmd: scannerPath,
      args: scanArgs,
      timeoutMs: TIMEOUTS.scannerMs,
      env: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: cacheRoot },
    });
    if (scanRun.timedOut) throw new Error(`scanner timed out after ${TIMEOUTS.scannerMs}ms`);

    let reportText = "";
    try {
      reportText = await readFile(reportPath, "utf-8");
    } catch {
      throw new Error(`scanner did not write a report (status ${scanRun.status})`);
    }
    const verdict = adjudicate({
      status: scanRun.status,
      reportText,
      stderr: scanRun.stderr,
      expectedSources,
    });
    summary.vulnerabilities = verdict.ok ? verdict.vulnCount : null;
    summary.result = verdict.ok ? "clean" : "failed";
    summary.reason = verdict.ok ? null : verdict.reason;
    if (verdict.ok && verdict.vulnCount > 0) {
      console.error(
        `dependency audit failed: ${verdict.vulnCount} OSV findings; every finding fails this gate`,
      );
      summary.result = "failed";
      await persistEvidence({ reportPath, stderr: scanRun.stderr });
      return {
        ok: false,
        verdict: { ok: false, reason: `${verdict.vulnCount} OSV findings` },
        summary,
        artifacts: { reportPath, workRoot },
      };
    }
    if (!verdict.ok) {
      console.error(`dependency audit failed: ${verdict.reason}`);
    }
    await persistEvidence({ reportPath, stderr: scanRun.stderr });
    return { ok: verdict.ok, verdict, summary, artifacts: { reportPath, workRoot } };
  } catch (error) {
    summary.result = "failed";
    summary.reason = error?.message ?? String(error);
    console.error(`dependency audit failed: ${summary.reason}`);
    await persistEvidence({ stderr: error?.message ?? String(error) });
    return {
      ok: false,
      verdict: { ok: false, reason: error?.message ?? String(error) },
      summary,
      artifacts: { workRoot },
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function main() {
  const outcome = await runAudit();
  process.stdout.write(`${JSON.stringify(outcome.summary)}\n`);
  if (!outcome.ok) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href);
if (isDirectRun) await main();
