"use strict";

import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

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
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(redact(value), null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

class AppendOnlyLedger {
  constructor(path, options = {}) {
    this.path = path;
    this.runId = options.runId;
    this.provenance = redact(options.provenance ?? {});
    this.sequence = options.sequence ?? 0;
    this.previousHash = options.previousHash ?? null;
    this.lockPath = `${path}.lock`;
    this.statePath = `${path}.state.json`;
    this.status = "ready";
  }
  async open() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const raw = await readFile(this.path, "utf8");
      const complete = raw.endsWith("\n") ? raw : raw.slice(0, raw.lastIndexOf("\n") + 1);
      if (complete !== raw) {
        await this.quarantine(raw.slice(complete.length), "torn-tail");
        await writeFile(this.path, complete, { mode: 0o600 });
      }
      const lines = complete.split("\n").filter(Boolean);
      const records = [];
      let previous = null;
      for (let index = 0; index < lines.length; index++) {
        let record;
        try {
          record = JSON.parse(lines[index]);
        } catch (error) {
          return this.markCorrupt(records, lines.slice(index).join("\n"), "invalid-record", error);
        }
        try {
          validateLedgerRecord(record, index, this.runId, previous);
        } catch (error) {
          return this.markCorrupt(
            records,
            lines.slice(index).join("\n"),
            corruptionReason(error),
            error,
          );
        }
        records.push(record);
        previous = record.recordHash;
      }
      const recordedProvenance = records[0]?.provenance;
      if (recordedProvenance) {
        for (const key of ["contractHash", "evaluatorHash", "environmentHash", "policyHash"]) {
          if (
            this.provenance[key] !== undefined &&
            recordedProvenance[key] !== this.provenance[key]
          )
            throw new Error(`resume provenance mismatch: ${key}`);
        }
      }
      const state = await this.readState();
      this.status = state?.status ?? "ready";
      this.sequence = records.length;
      this.previousHash = previous;
      return records;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return [];
    }
  }
  async readState() {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async markCorrupt(records, content, reason, error) {
    await this.quarantine(content, "corrupt-ledger");
    await writeFile(
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
    await appendFile(this.path, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    this.sequence++;
    this.previousHash = marker.recordHash;
    records.push(marker);
    return records;
  }
  async quarantine(content, reason) {
    if (!content) return;
    const quarantine = `${this.path}.${reason}.${Date.now()}.quarantine`;
    await writeFile(quarantine, content, { mode: 0o600 });
  }
  async append(event, fields = {}) {
    if (!this.runId) throw new TypeError("runId is required");
    if (this.status === "blocked" && !["intake", "blocked"].includes(event))
      throw new Error("ledger is blocked: corrupt-ledger");
    let handle;
    let failure;
    let result;
    try {
      handle = await open(this.lockPath, "wx");
      const current = await this.open();
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
      await appendFile(this.path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
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
    try {
      await handle?.close();
    } catch (error) {
      if (!failure) failure = error;
    }
    try {
      await unlink(this.lockPath);
    } catch (error) {
      if (error.code !== "ENOENT" && !failure) failure = error;
    }
    if (failure) throw failure;
    return result;
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
  const safe = String(runId).replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    ledger: join(root, `${date}-${safe}-ledger.jsonl`),
    report: join(root, `${date}-${safe}-report.json`),
    manifest: join(root, `${date}-${safe}-manifest.json`),
  };
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
};
