"use strict";

// T001: reconcile a csm-plan against reality by running each task's declared
// acceptance signal, and write a completion ledger. Signals are parsed into an
// argv (NO shell) so a plan artifact can never inject a command; completeness is
// dependency-aware and distinguishes passes, skips, and dependency blocks.
// Injectable `runSignal` for unit tests; the CLI runs the real commands.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UNSAFE = /[;&|<>$`(){}[\]\n]/;

export function parseSignalCommand(signal) {
  const match = String(signal ?? "").match(/`([^`]+)`/);
  return match ? match[1] : null;
}

export function splitCommand(command) {
  const text = String(command ?? "").trim();
  if (text === "") throw new TypeError("empty signal command");
  if (UNSAFE.test(text)) throw new TypeError(`unsafe signal command: ${text}`);
  const tokens =
    text
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
  const env = {};
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    const eq = tokens[index].indexOf("=");
    env[tokens[index].slice(0, eq)] = tokens[index].slice(eq + 1);
    index += 1;
  }
  const file = tokens[index] === "node" ? process.execPath : tokens[index];
  if (!file) throw new TypeError("empty signal command");
  return { file, args: tokens.slice(index + 1), env };
}

export function classify(result) {
  if (result?.skipped) return "partial";
  return result?.ok ? "complete" : "pending";
}

export function reconcilePlan({ plan, runSignal, sampledAt = new Date().toISOString() }) {
  const ordered = (plan.tasks ?? []).toSorted((a, b) => a.ordinal - b.ordinal);
  const statusById = new Map();
  const tasks = ordered.map((task) => {
    const signal = parseSignalCommand(task.acceptanceSignal);
    let result = { ok: false, code: null };
    if (signal) {
      try {
        result = runSignal(signal) ?? result;
      } catch (error) {
        result = { ok: false, code: null, error: String(error?.message ?? error) };
      }
    }
    let status = classify(result);
    const deps = task.dependsOn ?? [];
    if (status === "complete" && !deps.every((dep) => statusById.get(dep) === "complete"))
      status = "blocked-deps";
    statusById.set(task.taskId, status);
    return {
      taskId: task.taskId,
      title: task.title,
      signal,
      status,
      exitCode: result.code ?? null,
    };
  });
  const count = (s) => tasks.filter((task) => task.status === s).length;
  return {
    planId: plan.planId,
    planDigest: plan.digest ?? null,
    sampledAt,
    total: tasks.length,
    complete: count("complete"),
    partial: count("partial"),
    blockedDeps: count("blocked-deps"),
    pending: count("pending"),
    tasks,
  };
}

export function defaultRunSignal(timeoutMs = 120_000) {
  return (command) => {
    let parsed;
    try {
      parsed = splitCommand(command);
    } catch (error) {
      return { ok: false, code: null, error: String(error.message) };
    }
    const result = spawnSync(parsed.file, parsed.args, {
      cwd: ROOT,
      env: { ...process.env, ...parsed.env },
      encoding: "utf8",
      timeout: timeoutMs,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const skipped = /^# skipped [1-9]/m.test(output);
    return { ok: result.status === 0, code: result.status, skipped };
  };
}

async function main(argv) {
  const planPath = argv[argv.indexOf("--plan") + 1];
  const out = argv[argv.indexOf("--out") + 1];
  if (!argv.includes("--plan") || !argv.includes("--out") || !planPath || !out) {
    process.stderr.write(
      "usage: node scripts/completion/reconcile.mjs --plan <path> --out <path>\n",
    );
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(resolve(ROOT, planPath), "utf8"));
  const ledger = reconcilePlan({ plan, runSignal: defaultRunSignal() });
  writeFileSync(resolve(ROOT, out), `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(
    `ledger: ${ledger.complete} complete, ${ledger.partial} partial, ${ledger.blockedDeps} blocked-deps, ${ledger.pending} pending -> ${out}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main(process.argv);
