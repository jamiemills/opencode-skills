"use strict";

import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  appendDurableJsonLine,
  atomicWrite,
  readDurableJson,
  readJsonLines,
} from "../../../lib/durable-json/index.mjs";

const HASH = (value) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
function canonical(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function redact(value) {
  if (typeof value === "string")
    return value
      .replace(
        /(?:Bearer\s+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
        "[REDACTED]",
      )
      .replace(/(?:\/home\/|\/Users\/|[A-Za-z]:\\)[^\s"']+/g, "[PATH]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /secret|token|password|credential|authorization/i.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  return value;
}

function evidenceHash(value, name = "hash") {
  if (
    typeof value !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value) ||
    /^sha256:0{64}$/.test(value)
  )
    throw new TypeError(`${name} must be an evidence-bound sha256 hash`);
  return value;
}

function unsignedRecord(record) {
  const unsigned = { ...record };
  delete unsigned.recordHash;
  return unsigned;
}
function recordHash(record) {
  return HASH(unsignedRecord(record));
}

function validateLedgerRecord(record, expectedSequence, runId, previousHash = null) {
  if (
    !record ||
    record.format !== "csm-autoresearch-ledger/1" ||
    typeof record.event !== "string" ||
    !record.timestamp
  )
    throw new Error(`invalid ledger record at sequence ${expectedSequence}`);
  if (record.runId !== runId)
    throw new Error(`ledger run identity mismatch at sequence ${expectedSequence}`);
  if (record.sequence !== expectedSequence)
    throw new Error(`ledger sequence mismatch at sequence ${expectedSequence}`);
  if (record.previousHash !== previousHash || record.recordHash !== recordHash(record))
    throw new Error(`ledger integrity failure at sequence ${expectedSequence}`);
  if (!record.provenance || record.provenance.redacted !== true)
    throw new Error(`ledger provenance missing at sequence ${expectedSequence}`);
  return record;
}

function corruptionReason(error) {
  if (/run identity/.test(error.message)) return "run-identity-mismatch";
  if (/integrity/.test(error.message)) return "hash-integrity-failure";
  if (/sequence mismatch/.test(error.message)) return "sequence-mismatch";
  return "invalid-record";
}

async function atomicJson(path, value) {
  await atomicWrite(path, `${JSON.stringify(redact(value), null, 2)}\n`, { mode: 0o600 });
}

class AppendOnlyLedger {
  constructor(path, options = {}) {
    this.path = path;
    this.runId = options.runId;
    this.provenance = redact(options.provenance ?? {});
    this.sequence = options.sequence ?? 0;
    this.previousHash = options.previousHash ?? null;
    this.lockPath = `${path}.lock`;
    this.leasePath = `${path}.run.lock`;
    this.statePath = `${path}.state.json`;
    this.status = "ready";
  }
  async open() {
    const owner = await this.acquireLock();
    try {
      return await this.openUnlocked();
    } finally {
      await this.releaseLock(owner);
    }
  }
  async openUnlocked() {
    await mkdir(dirname(this.path), { recursive: true });
    const records = [];
    let previous = null;
    let partialTail;
    try {
      await readJsonLines(this.path, {
        identity: (record) => `${record.runId}:${record.sequence}`,
        quarantine: false,
        recoverPartialTail: true,
        onRecord: (record) => records.push(record),
        onPartialTail: (tail) => {
          partialTail = tail;
        },
      });
      if (partialTail) {
        await this.quarantine(partialTail, "torn-tail");
        await atomicWrite(
          this.path,
          records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
          { mode: 0o600 },
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") return [];
      if (error.code === "duplicate-identity")
        return this.markCorrupt(records, error.line ?? "", "sequence-mismatch", error);
      return this.markCorrupt(records, error.line ?? "", "invalid-record", error);
    }
    for (const [index, record] of records.entries()) {
      try {
        validateLedgerRecord(record, index, this.runId, previous);
      } catch (error) {
        return this.markCorrupt(
          records.slice(0, index),
          JSON.stringify(record),
          corruptionReason(error),
          error,
        );
      }
      previous = record.recordHash;
    }
    const recordedProvenance = records[0]?.provenance;
    if (recordedProvenance) {
      for (const key of ["contractHash", "evaluatorHash", "environmentHash", "policyHash"]) {
        if (this.provenance[key] !== undefined && recordedProvenance[key] !== this.provenance[key])
          throw new Error(`resume provenance mismatch: ${key}`);
      }
    }
    const state = await this.readState();
    this.status = state?.status ?? "ready";
    this.sequence = records.length;
    this.previousHash = previous;
    return records;
  }
  async readState() {
    try {
      return await readDurableJson(this.statePath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async markCorrupt(records, content, reason, error) {
    await this.quarantine(content, "corrupt-ledger");
    await atomicWrite(
      this.path,
      records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
      { mode: 0o600 },
    );
    this.status = "blocked";
    this.sequence = records.length;
    this.previousHash = records.at(-1)?.recordHash ?? null;
    await atomicJson(this.statePath, {
      format: "csm-autoresearch-ledger-state/1",
      status: "blocked",
      reason,
      sequence: this.sequence,
      runId: this.runId,
      diagnostics: [error.message],
    });
    const marker = redact({
      format: "csm-autoresearch-ledger/1",
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      event: "blocked",
      decision: "blocked",
      payload: { status: "corrupt-ledger", reason, diagnostics: [error.message], terminal: true },
      previousHash: this.previousHash,
      provenance: { ...this.provenance, redacted: true },
    });
    marker.recordHash = recordHash(marker);
    await appendDurableJsonLine(this.path, marker);
    this.sequence++;
    this.previousHash = marker.recordHash;
    records.push(marker);
    return records;
  }
  async quarantine(content, reason) {
    if (!content) return;
    const quarantine = `${this.path}.${reason}.${Date.now()}.quarantine`;
    await atomicWrite(quarantine, content, { mode: 0o600 });
  }
  async append(event, fields = {}) {
    if (!this.runId) throw new TypeError("runId is required");
    if (this.status === "blocked" && !["intake", "blocked"].includes(event))
      throw new Error("ledger is blocked: corrupt-ledger");
    let failure;
    let result;
    let owner;
    try {
      owner = await this.acquireLock();
      const current = await this.openUnlocked();
      this.sequence = current.length;
      this.previousHash = current.at(-1)?.recordHash ?? null;
      const record = redact({
        format: "csm-autoresearch-ledger/1",
        sequence: this.sequence,
        timestamp: new Date().toISOString(),
        runId: this.runId,
        event,
        ...fields,
        previousHash: this.previousHash,
        provenance: { ...this.provenance, redacted: true },
      });
      record.recordHash = recordHash(record);
      await appendDurableJsonLine(this.path, record);
      this.sequence++;
      this.previousHash = record.recordHash;
      result = record;
    } catch (error) {
      if (error.code === "EEXIST")
        failure = new Error("ledger single-writer guard: another writer is active", {
          cause: error,
        });
      else failure = error;
    }
    if (owner) {
      try {
        await this.releaseLock(owner);
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    if (failure) throw failure;
    return result;
  }
  async acquireLock(path = this.lockPath, kind = "append") {
    await mkdir(dirname(path), { recursive: true });
    const token = randomUUID();
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(
        `${JSON.stringify({ format: "csm-autoresearch-lock/1", kind, token, pid: process.pid, runId: this.runId, createdAt: new Date().toISOString() })}\n`,
      );
      return { path, token, handle };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code === "EEXIST") {
        throw new Error(
          `ledger single-writer guard: ${kind} lock is held; inspect or explicitly recover the stale lock`,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }
  async releaseLock(owner) {
    if (!owner) return;
    await owner.handle?.close();
    const retired = `${owner.path}.release-${owner.token}`;
    try {
      // Hard-link first so an already-installed replacement can never be
      // overwritten by a releasing owner.
      await link(owner.path, retired);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let metadata;
    try {
      metadata = await readDurableJson(retired);
    } catch (error) {
      if (!(await lstat(owner.path).catch(() => null)))
        await rename(retired, owner.path).catch(() => {});
      else await unlink(retired).catch(() => {});
      throw new Error(`refusing to remove ${owner.path}: lock metadata is invalid`, {
        cause: error,
      });
    }
    if (metadata.token !== owner.token) {
      await rename(retired, `${owner.path}.recovered-${randomUUID()}`).catch(() => {});
      throw new Error(`refusing to remove ${owner.path}: lock ownership changed`);
    }
    const current = await lstat(owner.path).catch(() => null);
    const retiredInfo = await lstat(retired).catch(() => null);
    if (
      !current ||
      !retiredInfo ||
      current.dev !== retiredInfo.dev ||
      current.ino !== retiredInfo.ino
    ) {
      await unlink(retired).catch(() => {});
      throw new Error(`refusing to remove ${owner.path}: lock ownership changed`);
    }
    await unlink(owner.path);
    await unlink(retired);
  }
  async recoverStaleLock({
    kind = "append",
    force = false,
    expectedToken,
    reason = "operator-recovery",
  } = {}) {
    if (force !== true) throw new Error("stale-lock recovery requires explicit force: true");
    if (typeof expectedToken !== "string" || expectedToken.length === 0)
      throw new Error("stale-lock recovery requires the observed owner token");
    const path = kind === "run" ? this.leasePath : this.lockPath;
    let metadata;
    try {
      metadata = await readDurableJson(path);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw new Error("stale-lock recovery refused invalid lock metadata", { cause: error });
    }
    if (metadata.token !== expectedToken)
      throw new Error("stale-lock recovery refused: owner token changed");
    const quarantine = `${path}.${Date.now()}.${randomUUID()}.quarantine`;
    const before = await lstat(path);
    await link(path, quarantine);
    const after = await lstat(path);
    const archived = await lstat(quarantine);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      after.dev !== archived.dev ||
      after.ino !== archived.ino
    ) {
      await unlink(quarantine).catch(() => {});
      throw new Error("stale-lock recovery refused: owner changed during archival");
    }
    await unlink(path);
    const moved = await readDurableJson(quarantine);
    if (moved.token !== expectedToken)
      throw new Error("stale-lock recovery refused: owner token changed during recovery");
    await atomicJson(`${quarantine}.json`, {
      format: "csm-autoresearch-stale-lock/1",
      kind,
      reason,
      metadata: redact(moved),
    });
    return true;
  }
  async acquireRunLease() {
    return this.acquireLock(this.leasePath, "run");
  }
  async releaseRunLease(owner) {
    return this.releaseLock(owner);
  }
}

function validateReport(report, runId) {
  if (
    !report ||
    report.format !== "csm-autoresearch-report/1" ||
    report.runId !== runId ||
    !["stopped", "completed", "blocked", "approval_pending", "promoted", "rolled_back"].includes(
      report.status,
    ) ||
    !Array.isArray(report.trials) ||
    !report.baseline ||
    !report.gates
  )
    throw new Error("invalid autoresearch report");
  return report;
}

function artifactPaths(root, runId, date = new Date().toISOString().slice(0, 10)) {
  const safe = canonicalRunId(runId);
  return {
    ledger: join(root, `${date}-${safe}-ledger.jsonl`),
    report: join(root, `${date}-${safe}-report.json`),
    manifest: join(root, `${date}-${safe}-manifest.json`),
  };
}

function canonicalRunId(runId) {
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) ||
    runId === "." ||
    runId === ".."
  )
    throw new TypeError("runId must be a canonical path-safe identifier");
  return runId;
}

export {
  AppendOnlyLedger,
  HASH as hash,
  artifactPaths,
  atomicJson,
  canonical,
  redact,
  evidenceHash,
  validateLedgerRecord,
  validateReport,
  canonicalRunId,
};
