#!/usr/bin/env node
"use strict";

// Generates the README composition matrix into the marked region from
// scripts/lib/contracts.mjs INTERFACES data. check-suite asserts the region
// matches this generator's output (drift = fail). Re-run after editing
// INTERFACES: node scripts/gen-readme-matrix.mjs --write

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { INTERFACES } from "./lib/contracts.mjs";
import { splitLines, fenceMap } from "./lib/plan-validation.mjs";

const START = "<!-- csm-matrix:start -->";
const END = "<!-- csm-matrix:end -->";

const cell = (v) => {
  const val = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return val.replace(/\|/g, "\\|").replace(/\n/g, " ");
};

function renderMatrix() {
  const lines = [
    "## Composition matrix",
    "",
    "How each skill composes — standalone entry conditions, what it consumes and produces, and how work hands off. Generated from `scripts/lib/contracts.mjs`; regenerate with `node scripts/gen-readme-matrix.mjs --write`.",
    "",
    "| Skill | Standalone entry | Consumes | Produces | Hands off |",
    "|---|---|---|---|---|",
  ];
  for (const [skill, iface] of Object.entries(INTERFACES)) {
    lines.push(
      `| \`${skill}\` | ${cell(iface.entryConditions)} | ${cell(iface.consumes)} | ${cell(iface.produces)} | ${cell(iface.handoff)} |`,
    );
  }
  return lines.join("\n");
}

export function renderRegion() {
  return `${START}\n${renderMatrix()}\n${END}`;
}

// Line-based region location (F-054): the region markers must sit outside any
// code fence — a marker accidentally placed inside a fenced block must not
// count as the real region.
function locateRegion(lines, inFence) {
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    if (lines[i].trim() === START && start === -1) start = i;
    else if (lines[i].trim() === END) {
      end = i;
      break;
    }
  }
  if (start === -1 || end === -1 || end < start) return null;
  return [start, end];
}

// Whitespace-insensitive canonical form: the repo formatter (oxfmt)
// legitimately re-pads Markdown table columns, so cell content is the
// contract — not column alignment.
function canonicalMarkdown(text) {
  return text
    .split("\n")
    .map((l) =>
      l
        .replace(/\s*\|\s*/g, "|")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n");
}

export function checkDrift(readmePath) {
  const content = fs.readFileSync(readmePath, "utf8");
  const lines = splitLines(content);
  const region = locateRegion(lines, fenceMap(lines));
  if (region === null) return "composition-matrix region missing from README";
  const actual = canonicalMarkdown(lines.slice(region[0], region[1] + 1).join("\n"));
  if (actual !== canonicalMarkdown(renderRegion()))
    return "composition-matrix region drifted from contracts.mjs (run: node scripts/gen-readme-matrix.mjs --write)";
  return null;
}

function writeRegion(readmePath) {
  const content = fs.readFileSync(readmePath, "utf8");
  const lines = splitLines(content);
  const region = locateRegion(lines, fenceMap(lines));
  const expected = splitLines(renderRegion());
  if (region === null) {
    // First insertion: after the Skills table section, before Requirements
    const anchorIdx = lines.findIndex((l) => l === "## Requirements");
    if (anchorIdx === -1) throw new Error("README ## Requirements anchor not found");
    return [...lines.slice(0, anchorIdx), ...expected, "", ...lines.slice(anchorIdx)].join("\n");
  }
  return [...lines.slice(0, region[0]), ...expected, ...lines.slice(region[1] + 1)].join("\n");
}

let isMain = false;
try {
  isMain =
    process.argv[1] &&
    fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]));
} catch {
  isMain = false;
}

if (isMain) {
  const readme = path.resolve(process.cwd(), "README.md");
  const mode = process.argv.includes("--write") ? "write" : "check";
  if (mode === "write") {
    fs.writeFileSync(readme, writeRegion(readme), "utf8");
    console.log("gen-readme-matrix: region written");
    process.exit(0);
  }
  const drift = checkDrift(readme);
  if (drift === null) {
    console.log("gen-readme-matrix: OK — region matches contracts");
    process.exit(0);
  }
  console.error(`gen-readme-matrix: ${drift}`);
  process.exit(1);
}
