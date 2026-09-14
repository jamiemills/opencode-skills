#!/usr/bin/env node
"use strict";

// Lightweight staleness guard for the Anthropic id-mapping block in
// docs/dynamic-worker-runtime.md ("### Version-qualified identifiers").
//
// The mapping is observational and version-dependent: the vendor pages gate
// individual features and state no single minimum Claude Code version, so the
// document must never assert a pinned version number. This check is
// deliberately structural — it asserts that the block still carries a dated
// re-verification status and its version-gate language (and that a known
// unsupported pinned version was not (re)introduced). It does NOT assert, or
// require, any particular version number.
//
// It READS one Markdown file only; it never rewrites docs or code.
//
// Usage:
//   node scripts/check-anthropic-mapping.mjs [--root <repo>] [--max-age-days <n>]
//                                            [--no-max-age] [--quiet]
//
// Exit: 0 when the block is structurally current; 1 on any finding; 2 on a
//       usage/filesystem error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MAPPING_DOC = "docs/dynamic-worker-runtime.md";
export const SECTION_START = "### Version-qualified identifiers";
const STATUS_MARKER = /Re-verification status[.:]/i;
const DATE_LITERAL = /(\d{4}-\d{2}-\d{2})/;
const REVERIFY_PROCEDURE = /re-?verify on claude code updates/i;
const CHECK_REFERENCE = /check-anthropic-mapping\.mjs/;
// Language that keeps the mapping explicitly version-qualified rather than a
// frozen constant. At least two distinct markers must remain present.
const VERSION_GATE_MARKERS = ["version-qualified", "version-gated", "version-dependent"];
export const MIN_VERSION_GATE_MARKERS = 2;
// The block must not pin a Claude Code version. Any semver-shaped literal in
// the version-qualified section fails closed (a previously-cited unsupported
// version must never return); no particular version is asserted or required.
const PINNED_VERSION_LITERAL = /\bv?\d+\.\d+\.\d+\b/g;
export const DEFAULT_MAX_AGE_DAYS = 120;

function sectionOf(source) {
  const start = source.indexOf(SECTION_START);
  if (start === -1) return null;
  const rest = source.slice(start);
  const end = rest.indexOf("\n## ", SECTION_START.length);
  return (end === -1 ? rest : rest.slice(0, end)).trimEnd();
}

function daysBetween(fromIso, now) {
  const then = Date.parse(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

// Pure analysis: returns { ok, available, section, retrievalDate, ageDays,
// gateMarkers, findings }. `maxAgeDays` null disables the age finding.
export function analyzeAnthropicMapping(
  source,
  { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {},
) {
  const findings = [];
  const section = sectionOf(source);
  if (section === null) {
    return {
      ok: false,
      available: false,
      section: null,
      retrievalDate: null,
      ageDays: null,
      gateMarkers: [],
      findings: [`missing section: ${SECTION_START} (in ${MAPPING_DOC})`],
    };
  }

  const lower = section.toLowerCase();
  const gateMarkers = VERSION_GATE_MARKERS.filter((marker) => lower.includes(marker));
  if (gateMarkers.length < MIN_VERSION_GATE_MARKERS) {
    findings.push(
      `version-gate language weakened: found ${gateMarkers.length}/${MIN_VERSION_GATE_MARKERS} of ` +
        `[${VERSION_GATE_MARKERS.join(", ")}]`,
    );
  }

  let retrievalDate = null;
  const statusIndex = section.search(STATUS_MARKER);
  if (statusIndex === -1) {
    findings.push(
      'no "Re-verification status" block: the section must record that it was re-verified',
    );
  } else {
    const statusText = section.slice(statusIndex);
    const paragraphEnd = statusText.search(/\n\s*\n/);
    const statusParagraph = paragraphEnd === -1 ? statusText : statusText.slice(0, paragraphEnd);
    const match = DATE_LITERAL.exec(statusParagraph);
    if (match === null) {
      findings.push(
        "dated re-verification status missing: add e.g. " +
          '"Re-verification status. Re-verified read-only on YYYY-MM-DD ..."',
      );
    } else {
      retrievalDate = match[1];
    }
  }

  if (!REVERIFY_PROCEDURE.test(section)) {
    findings.push('missing "re-verify on Claude Code updates" procedure');
  }
  if (!CHECK_REFERENCE.test(section)) {
    findings.push(
      `procedure must reference ${path.basename(MAPPING_DOC)}'s check: scripts/check-anthropic-mapping.mjs`,
    );
  }

  const pinned = [...section.matchAll(PINNED_VERSION_LITERAL)].map((match) => match[0]);
  if (pinned.length > 0) {
    findings.push(
      `pinned version literal(s) in the version-qualified section: ${[...new Set(pinned)].join(", ")}; ` +
        "keep the mapping version-qualified, not version-pinned",
    );
  }

  let ageDays = null;
  if (retrievalDate !== null) {
    ageDays = daysBetween(retrievalDate, now);
    if (ageDays === null) {
      findings.push(`unparseable retrieval date: ${retrievalDate}`);
    } else if (maxAgeDays !== null && ageDays > maxAgeDays) {
      findings.push(
        `stale mapping: re-verified ${retrievalDate} (${ageDays} days old > ${maxAgeDays}); re-verify per the procedure`,
      );
    }
  }

  return {
    ok: findings.length === 0,
    available: true,
    section,
    retrievalDate,
    ageDays,
    gateMarkers,
    findings,
  };
}

export function formatAnthropicMapping(report) {
  if (!report.available) {
    return [`check-anthropic-mapping: FAIL — ${report.findings[0]}`];
  }
  if (report.ok) {
    return [
      `check-anthropic-mapping: OK — id-mapping re-verified ${report.retrievalDate} ` +
        `(${report.ageDays} days old); ${report.gateMarkers.length}/${VERSION_GATE_MARKERS.length} ` +
        `version gates present; no pinned version literals.`,
    ];
  }
  const lines = [`check-anthropic-mapping: FAIL — ${report.findings.length} finding(s):`];
  for (const finding of report.findings) lines.push(`  - ${finding}`);
  return lines;
}

function parseArgs(argv) {
  const args = { root: process.cwd(), maxAgeDays: DEFAULT_MAX_AGE_DAYS, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") args.root = path.resolve(argv[++i]);
    else if (a === "--max-age-days") args.maxAgeDays = Number.parseInt(argv[++i], 10);
    else if (a === "--no-max-age") args.maxAgeDays = null;
    else if (a === "--quiet") args.quiet = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.maxAgeDays !== null && !Number.isFinite(args.maxAgeDays)) {
    throw new Error("--max-age-days must be a finite integer");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docPath = path.join(args.root, MAPPING_DOC);
  const source = fs.readFileSync(docPath, "utf8");
  const report = analyzeAnthropicMapping(source, { maxAgeDays: args.maxAgeDays });
  if (!args.quiet) for (const line of formatAnthropicMapping(report)) console.log(line);
  if (!report.ok) process.exit(1);
}

let isMain = false;
if (process.argv[1]) {
  try {
    isMain =
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    isMain = false;
  }
}

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
