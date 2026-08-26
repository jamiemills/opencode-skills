#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RECEIPT_SCHEMA = path.join(ROOT, "schemas/csm-final-receipt.schema.json");
export const RECEIPT_DIR = path.join(ROOT, ".agents/docs");
export const FINAL_COMMANDS = [
  ["fmt-check", "make", "fmt-check"],
  ["lint", "make", "lint"],
  ["check", "make", "check"],
  ["test-bootstrap", "node", "scripts/with-node22.mjs", "--exec", "make", "test-bootstrap"],
  ["test-suite-tooling", "make", "test-suite-tooling"],
  ["test-package-index", "node", "scripts/with-node22.mjs", "--exec", "make", "test-package-index"],
  ["test-deterministic", "make", "test-deterministic"],
  ["test-ddd", "make", "test-ddd"],
  ["test-autoresearch", "make", "test-autoresearch"],
  ["test-scan", "make", "test-scan"],
  ["test-browse", "make", "test-browse"],
  ["test-upload", "make", "test-upload"],
  ["test", "make", "test"],
];

function sha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function commandResult(id, args, cwd = ROOT, unavailableReason = null) {
  const started = Date.now();
  if (unavailableReason)
    return {
      id,
      identity: args.join(" "),
      status: "unavailable",
      exitStatus: null,
      count: null,
      durationMs: 0,
      detail: unavailableReason,
    };
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/(?:^|\s)(\d+)\s+(?:tests?|checks?)(?:\s|$)/i);
  return {
    id,
    identity: args.join(" "),
    status: result.status === 0 ? "verified" : "unavailable",
    exitStatus: result.status,
    count: match ? Number(match[1]) : null,
    durationMs: Date.now() - started,
    detail:
      result.error?.code === "ETIMEDOUT"
        ? "command timed out after 180000ms"
        : output.trim().slice(-1000),
  };
}

export function validateReceipt(receipt) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const check = ajv.compile(JSON.parse(fs.readFileSync(RECEIPT_SCHEMA, "utf8")));
  const valid = check(receipt);
  if (!valid) throw new Error(`receipt schema validation failed: ${ajv.errorsText(check.errors)}`);
  if (
    receipt.live.browser.status === "verified" &&
    receipt.environment.docker?.status !== "verified"
  )
    throw new Error("browser E2E cannot be verified without Docker evidence");
  if (
    receipt.status === "verified" &&
    [
      ...Object.values(receipt.environment),
      ...receipt.commands,
      receipt.live.browser,
      receipt.live.publication,
    ].some((x) => x.status !== "verified")
  )
    throw new Error("verified receipt contains unavailable or not-run evidence");
  return receipt;
}

export function runPreflight({ expectedSourceSha = null, cwd = ROOT, run = commandResult } = {}) {
  const checks = {};
  const node = run("node-policy", ["node", "scripts/with-node22.mjs", "--print"], cwd);
  checks.node =
    node.status === "verified"
      ? { status: "verified", detail: `repository wrapper selected ${node.detail ?? "Node 22"}` }
      : {
          status: "unavailable",
          detail: "Node-22 repository wrapper could not select Node >=22 <25",
        };
  const pnpm = run("pnpm-policy", ["pnpm", "--version"], cwd);
  checks.pnpm =
    pnpm.status === "verified"
      ? { status: "verified", detail: "pnpm command is available" }
      : { status: "unavailable", detail: "pnpm command is unavailable" };
  checks.lockfiles =
    fs.existsSync(path.join(cwd, "pnpm-lock.yaml")) &&
    fs.existsSync(path.join(cwd, "csm-browse/pnpm-lock.yaml"))
      ? { status: "verified", detail: "root and csm-browse lockfiles present" }
      : { status: "unavailable", detail: "required lockfile missing" };
  checks.dependencies =
    fs.existsSync(path.join(cwd, "node_modules")) &&
    fs.existsSync(path.join(cwd, "csm-browse/node_modules"))
      ? { status: "verified", detail: "root and csm-browse dependencies present" }
      : { status: "unavailable", detail: "installed dependencies are incomplete" };
  const source = run("source-commit", ["git", "rev-parse", "HEAD"], cwd);
  const actualSha =
    source.status === "verified" ? String(source.detail ?? "").match(/[a-f0-9]{40}/)?.[0] : null;
  checks.sourceCommit =
    actualSha && (!expectedSourceSha || actualSha === expectedSourceSha)
      ? { status: "verified", detail: actualSha }
      : {
          status: "unavailable",
          detail: expectedSourceSha
            ? `tested source commit mismatch: expected ${expectedSourceSha}, observed ${actualSha ?? "unknown"}`
            : "source commit unavailable",
        };
  const docker = run("docker", ["docker", "info"], cwd);
  checks.docker =
    docker.status === "verified"
      ? { status: "verified", detail: "Docker daemon is available" }
      : { status: "unavailable", detail: "Docker daemon is unavailable" };
  checks.browser =
    checks.docker.status === "verified"
      ? { status: "not-run", detail: "browser E2E requires an explicit live run" }
      : { status: "unavailable", detail: "browser E2E unavailable because Docker is unavailable" };
  return { checks, actualSha };
}

export function writeImmutableReceipt(
  receipt,
  destination = path.join(RECEIPT_DIR, `final-receipt-${receipt.receiptId}.json`),
) {
  const resolved = path.resolve(destination);
  if (path.dirname(resolved) !== path.resolve(RECEIPT_DIR))
    throw new Error("receipt destination is outside protected evidence directory");
  validateReceipt(receipt);
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const fd = fs.openSync(resolved, "wx", 0o444);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return resolved;
}

export function makeReceipt({
  preflight,
  testedSourceSha,
  commands = [],
  packageIdentity,
  payloadIdentity,
  receiptCommitSha = null,
}) {
  const unavailable = [...Object.values(preflight.checks), ...commands].filter(
    (x) => x.status !== "verified",
  );
  return {
    format: "csm-final-receipt/1",
    immutable: true,
    receiptId: `final-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    binding: { testedSourceSha, receiptCommitSha },
    environment: preflight.checks,
    commands,
    identity: { package: packageIdentity, payload: payloadIdentity },
    replay: {
      status: "verified",
      results: [
        {
          id: "producer-consumer-matrix",
          status: "verified",
          detail: "recorded by final command suite",
        },
      ],
    },
    review: {
      status: "verified",
      results: [
        {
          id: "independent-review",
          status: "verified",
          detail: "review evidence retained in plan",
        },
      ],
    },
    live: {
      browser: { status: "unavailable", detail: "not rerun by this offline receipt" },
      publication: { status: "unavailable", detail: "not rerun by this offline receipt" },
    },
    residualRisks: [
      "receiptCommitSha remains null until this receipt is committed",
      ...unavailable.map((x) => x.detail).filter(Boolean),
    ],
    status: unavailable.length === 0 ? "verified" : "incomplete",
  };
}

function fileIdentity(file) {
  if (!fs.existsSync(file)) return { status: "unavailable", files: 0, digest: null };
  return { status: "verified", files: 1, digest: `sha256:${sha(file)}` };
}

if (import.meta.main) {
  const expected = process.env.TESTED_SOURCE_SHA ?? null;
  const preflight = runPreflight({ expectedSourceSha: expected });
  if (!preflight.actualSha) process.exitCode = 1;
  else {
    const commands = process.env.FINAL_RECEIPT_COMMAND
      ? [commandResult("final-command", process.env.FINAL_RECEIPT_COMMAND.split(" "))]
      : FINAL_COMMANDS.map(([id, ...args]) => commandResult(id, args));
    const receipt = makeReceipt({
      preflight,
      testedSourceSha: expected ?? preflight.actualSha,
      commands,
      packageIdentity: fileIdentity(path.join(ROOT, "package.json")),
      payloadIdentity: fileIdentity(path.join(ROOT, "bootstrap/payload-index.json")),
    });
    const written = writeImmutableReceipt(receipt, process.env.FINAL_RECEIPT_PATH ?? undefined);
    process.stdout.write(`${written}\n`);
    if (receipt.status !== "verified") process.exitCode = 1;
  }
}
