#!/usr/bin/env node
"use strict";

// Zero-dependency cache-health monitor (plan T002). Reports per-session and
// per-day cache hit ratios and actual DB cost for deepseek-v4-flash sessions.
// The ONLY subprocess is the bundled `opencode` CLI (read-only query against
// the live opencode SQLite DB via `opencode db "<SQL>" --format tsv`). No npm
// dependencies, no DB writes, no DB copies, no log parsing (logs are unusable
// — A2/R1), no pricing tables (cost comes from the DB cost column — A5).
//
// Honors the per-repo/per-directory token-efficiency toggle (A9) BEFORE any DB
// query: when disabled for the working directory it prints the notice and
// exits 0 without touching the DB. The resolver is T001's
// scripts/lib/token-efficiency.mjs (imported, never modified).
//
// Parsing and aggregation are PURE functions (parseSessionRows /
// aggregateReport / renderReport) so hermetic tests run on TSV fixture strings
// with no DB.
//
// time_created is epoch milliseconds; `--days N` filters
// `time_created >= now - N * 86400000`.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isEnabled } from "./lib/token-efficiency.mjs";

const MODEL_FILTER = "%deepseek-v4-flash%";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_COLUMNS = 8;

function toNumberOrNaN(value) {
  const t = value.trim();
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

// Parses `opencode db` TSV output into session rows. Missing token fields are
// coalesced to 0 (a missing cache.read is a 0 cache read); header/garbage
// lines and rows without a usable time_created are skipped.
export function parseSessionRows(tsvText) {
  const rows = [];
  for (const line of String(tsvText).split("\n")) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    if (cells.length < SESSION_COLUMNS) continue;
    const [id, slug, agent, timeRaw, inputRaw, cacheReadRaw, cacheWriteRaw, costRaw] = cells;
    const input = toNumberOrNaN(inputRaw);
    const cacheRead = toNumberOrNaN(cacheReadRaw);
    const cacheWrite = toNumberOrNaN(cacheWriteRaw);
    if (Number.isNaN(input) && Number.isNaN(cacheRead) && Number.isNaN(cacheWrite)) continue;
    const timeCreated = toNumberOrNaN(timeRaw);
    if (Number.isNaN(timeCreated)) continue;
    const cost = toNumberOrNaN(costRaw);
    rows.push({
      id: id.trim(),
      slug: slug.trim(),
      agent: agent.trim(),
      timeCreated,
      input: Number.isNaN(input) ? 0 : input,
      cacheRead: Number.isNaN(cacheRead) ? 0 : cacheRead,
      cacheWrite: Number.isNaN(cacheWrite) ? 0 : cacheWrite,
      cost: Number.isNaN(cost) ? 0 : cost,
    });
  }
  return rows;
}

// Aggregates session rows into per-session hit ratios (null = n/a on a zero
// denominator) plus a per-day UTC summary. Hit % = cache.read /
// (cache.read + input + cache.write); rows with a zero denominator are
// excluded from day hit ratios (flagged as skipped) but their input/cost
// still count toward the day totals.
export function aggregateReport(rows) {
  const sessions = rows
    .map((r) => {
      const denominator = r.cacheRead + r.input + r.cacheWrite;
      const hitRatio = denominator > 0 ? r.cacheRead / denominator : null;
      return { ...r, hitRatio };
    })
    .toSorted((a, b) => b.timeCreated - a.timeCreated);
  const byDay = new Map();
  for (const s of sessions) {
    const date = new Date(s.timeCreated).toISOString().slice(0, 10);
    const day = byDay.get(date) ?? {
      date,
      sessionCount: 0,
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      skipped: 0,
    };
    day.sessionCount += 1;
    day.input += s.input;
    day.cacheRead += s.cacheRead;
    day.cacheWrite += s.cacheWrite;
    day.cost += s.cost;
    if (s.hitRatio === null) day.skipped += 1;
    byDay.set(date, day);
  }
  const days = [...byDay.values()]
    .map((d) => {
      const denominator = d.cacheRead + d.input + d.cacheWrite;
      return { ...d, hitRatio: denominator > 0 ? d.cacheRead / denominator : null };
    })
    .toSorted((a, b) => (a.date < b.date ? 1 : -1));
  const skipped = sessions.filter((s) => s.hitRatio === null).length;
  return { sessions, days, sessionCount: sessions.length, skipped };
}

function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(value) {
  if (value === null) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtCost(n) {
  return n === 0 ? "0" : n.toFixed(8);
}

// Renders the report in the repo's plain check-suite-style text.
export function renderReport(report, { windowLabel = "all sessions" } = {}) {
  const out = [];
  out.push(`cache-health: model=${MODEL_FILTER.slice(1, -1)} cache hit report`);
  out.push(
    `window: ${windowLabel} · sessions: ${report.sessionCount} · zero-denominator skipped: ${report.skipped}`,
  );
  out.push("");
  out.push("per-session (newest first):");
  out.push(
    "  slug                          agent    input    cache.read  cache.write  hit %  cost",
  );
  for (const s of report.sessions) {
    out.push(
      `  ${s.slug.padEnd(30)}${s.agent.padEnd(9)}${fmtInt(s.input).padStart(8)}  ${fmtInt(s.cacheRead).padStart(10)}  ${fmtInt(s.cacheWrite).padStart(10)}  ${fmtPct(s.hitRatio).padStart(5)}  ${fmtCost(s.cost)}`,
    );
  }
  out.push("");
  out.push("per-day summary (UTC):");
  out.push("  date         sessions  input    cache.read  hit %  cost");
  for (const d of report.days) {
    out.push(
      `  ${d.date}  ${String(d.sessionCount).padStart(8)}  ${fmtInt(d.input).padStart(8)}  ${fmtInt(d.cacheRead).padStart(10)}  ${fmtPct(d.hitRatio).padStart(5)}  ${fmtCost(d.cost)}`,
    );
  }
  out.push("");
  return out.join("\n");
}

function parseArgs(argv) {
  const args = { days: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--days") {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--days requires a positive integer");
      args.days = n;
      i += 1;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`cache-health: ${err.message}`);
    process.exit(2);
  }
  if (args.help) {
    console.log("usage: node scripts/cache-health.mjs [--days N]");
    console.log(`model scope: ${MODEL_FILTER.slice(1, -1)} (fixed filter)`);
    process.exit(0);
  }

  const toggle = isEnabled(process.cwd());
  if (toggle.warning !== null) console.error(`note: ${toggle.warning}`);
  if (!toggle.enabled) {
    console.log(`token efficiency disabled for this directory (${toggle.source})`);
    process.exit(0);
  }

  const cutoff = args.days === null ? null : Date.now() - args.days * DAY_MS;
  const windowClause = cutoff === null ? "" : ` and time_created >= ${cutoff}`;
  const sql = [
    "select id, slug, agent, time_created, tokens_input, tokens_cache_read, tokens_cache_write, cost",
    `from session where model LIKE '${MODEL_FILTER}'${windowClause} order by time_created desc`,
  ].join(" ");

  let tsv;
  try {
    tsv = execFileSync("opencode", ["db", sql, "--format", "tsv"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    console.error(
      `cache-health: opencode db query failed: ${err.stderr !== undefined && err.stderr !== "" ? err.stderr : err.message}`,
    );
    process.exit(1);
  }

  const report = aggregateReport(parseSessionRows(tsv));
  const windowLabel =
    args.days === null
      ? "all sessions"
      : `last ${args.days} days (cutoff ${new Date(cutoff).toISOString().slice(0, 10)} UTC)`;
  process.stdout.write(`${renderReport(report, { windowLabel })}\n`);
}

let isMain = false;
if (process.argv[1]) {
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const invoked = fs.realpathSync(path.resolve(process.argv[1]));
    isMain = self === invoked;
  } catch {
    isMain = false;
  }
}
if (isMain) main();
