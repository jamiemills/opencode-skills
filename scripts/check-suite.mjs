#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mapping } from "./pack-bootstrap.mjs";
import {
  MANIFEST,
  CONTRACTS,
  UPLOAD_SCRIPT_REF,
  INTERFACES,
  NEVER_INVOKE,
  FORMAT_VERSIONS,
  NORMS_PHRASES,
} from "./lib/contracts.mjs";
import { checkDrift } from "./sync-skill-boilerplate.mjs";
import { checkDrift as checkMatrixDrift } from "./gen-readme-matrix.mjs";
import { lintPlanSignals } from "./check-plan-signals.mjs";
import { checkDependencyPolicy } from "./lib/dependency-policy.mjs";
import {
  FENCE_OPEN_RE,
  splitLines,
  fenceMap,
  parsePlanControl,
  validatePlanControl,
  validatePlanJournal,
  validateJournalControlConsistency,
  validateOrdinalSequencing,
  validateTemplateFormatMarkers,
  validateInterfaceArtifactPatterns,
  validatePlanApplicability,
  validatePlanTaskCompleteness,
} from "./lib/plan-validation.mjs";

const args = process.argv.slice(2);
let root = process.cwd();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--root") {
    const next = args[i + 1];
    if (next) root = path.resolve(next);
  }
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NEVER_CLAUSE_RE =
  /\bnever\b[^.]{0,120}\b(only|beyond|elsewhere|writes?|runs?|invok\w*|starts?|plans?|planning|implement\w*|fix\w*|patch\w*|review\w*|execut\w*|push\w*|targets?)\b/i;
const NORMS_PHRASE_RE = new RegExp(
  NORMS_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
);
const CHAIN_RE = /`([A-Z][A-Z_]*(?:\s*->\s*[A-Z][A-Z_]+)+)`/;
const STATE_HEADING_RE = /^###\s+(\d+)\.\s+(.*)$/;
const STATE_TOKEN_RE = /^[A-Z][A-Z_]*/;
// README path scan (F-052): `csm-<skill>/<path...>` where the path ends in an
// alphanumeric/underscore/hyphen — never a sentence-ending period or slash.
const README_PATH_RE = /csm-[a-z-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]/g;

const failures = [];
let checks = 0;

function check(ok, detail) {
  checks += 1;
  if (!ok) failures.push(detail);
}

function readOrNull(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// F-052: true when `needle` occurs on at least one NON-fenced line. Contract
// declarations must live in prose — a needle that only appears inside a fenced
// code example does not satisfy a producer/consumer contract.
function containsOutsideFences(content, needle) {
  if (content === null) return false;
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  return lines.some((l, i) => !inFence[i] && l.includes(needle));
}

// F-053 (corpus half, D15): returns the set of git-tracked files (repo-relative
// posix paths) when a `.git` entry exists at the corpus root, else null. When
// null (no git), corpus loops validate every file — planted-defect corpora stay
// visible. When non-null, untracked in-progress corpus drafts are ignored so
// they cannot block the gate (the F-053 defect).
function loadTrackedFiles(rootDir) {
  if (!fs.existsSync(path.join(rootDir, ".git"))) return null;
  const r = spawnSync("git", ["ls-files"], { cwd: rootDir, encoding: "utf8" });
  if (r.status !== 0) return null;
  const set = new Set();
  for (const line of r.stdout.split("\n")) {
    const t = line.trim();
    if (t) set.add(t);
  }
  return set;
}

// GitHub-style heading anchor for README TOC correspondence (F-061): lowercase,
// drop punctuation (spaces and hyphens retained), then each whitespace run
// becomes a hyphen (GitHub does NOT collapse — "Development & testing" anchors
// to "development--testing", one hyphen per removed-char space).
function githubAnchor(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s/g, "-");
}

// F-061: every H2 below the README TOC must have a TOC entry (and, dually,
// every TOC entry must resolve to an H2 or H3 below the TOC). The generator
// maintains the Composition matrix section but nothing kept the index in sync.
function checkReadmeToc(readme) {
  const lines = splitLines(readme);
  const inFence = fenceMap(lines);
  const tocIdx = lines.findIndex((l, i) => !inFence[i] && /^##\s+Table of contents/i.test(l));
  if (tocIdx < 0) {
    check(false, 'README.md missing "## Table of contents" (TOC/H2 conformance requires it)');
    return;
  }
  let tocEnd = lines.length;
  for (let i = tocIdx + 1; i < lines.length; i += 1) {
    if (!inFence[i] && /^##\s/.test(lines[i])) {
      tocEnd = i;
      break;
    }
  }
  const tocEntries = [];
  for (let i = tocIdx + 1; i < tocEnd; i += 1) {
    if (inFence[i]) continue;
    const m = lines[i].match(/^\s*-\s+\[(.*?)\]\(#([^)]+)\)/);
    if (m) tocEntries.push({ text: m[1], anchor: m[2] });
  }
  const h2s = [];
  const h3s = [];
  for (let i = tocEnd; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const h2 = lines[i].match(/^##\s+(.*)$/);
    if (h2) {
      h2s.push(h2[1].trim());
      continue;
    }
    const h3 = lines[i].match(/^###\s+(.*)$/);
    if (h3) h3s.push(githubAnchor(h3[1].trim()));
  }
  const tocAnchors = new Set(tocEntries.map((e) => e.anchor));
  const headingAnchors = new Set([...h2s.map(githubAnchor), ...h3s]);
  for (const title of h2s) {
    const a = githubAnchor(title);
    check(
      tocAnchors.has(a),
      `README.md TOC has no entry for "## ${title}" (want "- [${title}](#${a})")`,
    );
  }
  for (const entry of tocEntries) {
    check(
      headingAnchors.has(entry.anchor),
      `README.md TOC entry "[${entry.text}](#${entry.anchor})" has no matching heading below the TOC`,
    );
  }
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function fileSha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadSkillManifest(rootDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(rootDir, "bootstrap", "skill-manifest.json"), "utf8"),
    );
  } catch (err) {
    return { error: `skill manifest unreadable: ${err.message}` };
  }
}

// Parses a leading frontmatter block and returns { kind, version } from a
// `format: <kind>/<version>` line, or null when absent/malformed. Accepts two
// forms: YAML frontmatter delimiters (`---\nformat: ...\n---`) and the bare
// top-of-file marker the producer templates emit (F-050 template contract,
// e.g. the first line inside the Required Plan/Approach Document fences).
function formatMarkerOf(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (m) {
    const fm = m[1].match(/^format:\s*([A-Za-z][A-Za-z0-9-]*)\/(\d+)\s*$/m);
    if (fm) return { kind: fm[1], version: parseInt(fm[2], 10) };
  }
  const bm = content.match(/^format:\s*([A-Za-z][A-Za-z0-9-]*)\/(\d+)\s*(?:\r?\n|$)/);
  if (bm) return { kind: bm[1], version: parseInt(bm[2], 10) };
  return null;
}

// Runs a new plan-validation check through the gate. Passes count one check;
// any finding is a hard failure. The F-050 template-format-marker and ordinal
// checks hard-enforce here (the inert PENDING_DEBT softening was pruned).
function runGatedCheck(skill, checkType, findings, label) {
  if (findings.length === 0) {
    check(true, `${label} OK`);
    return;
  }
  for (const f of findings) check(false, `${label}: ${f}`);
}

function countH1(lines, inFence) {
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inFence[i] && /^#\s/.test(lines[i])) count += 1;
  }
  return count;
}

function h2Titles(lines, inFence) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const m = lines[i].match(/^##\s+(.*)$/);
    if (m) out.push({ title: m[1].trim(), line: i });
  }
  return out;
}

function researchReferenceEntries(lines, inFence, range) {
  const entries = new Map();
  const duplicates = [];
  const start = range ? range[0] : 0;
  const end = range ? range[1] : lines.length;
  for (let i = start; i < end; i += 1) {
    if (inFence[i]) continue;
    const match = lines[i].match(/^\s*(?:-\s*)?(?:\*\*)?\[R(\d+)\](?:\*\*)?(?::\s*|\s+)(.+)$/);
    if (!match) continue;
    const id = `R${match[1]}`;
    if (entries.has(id)) duplicates.push({ id, line: i + 1 });
    else entries.set(id, { text: match[2], line: i + 1 });
  }
  return { entries, duplicates };
}

function researchInlineCitationIds(lines, inFence, referenceLines) {
  const ids = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i] || referenceLines.has(i)) continue;
    const prose = lines[i].replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(/\[R(\d+)\]/g)) ids.add(`R${match[1]}`);
  }
  return ids;
}

function validateResearchReferences(lines, inFence, researchPath, referenceRange, rootDir) {
  const findings = [];
  const { entries: references, duplicates } = researchReferenceEntries(
    lines,
    inFence,
    referenceRange,
  );
  for (const duplicate of duplicates) {
    findings.push(
      `${researchPath}: [${duplicate.id}] duplicate reference entry at line ${duplicate.line}`,
    );
  }
  const firstReferenceLine = [...references.values()]
    .map((entry) => entry.line - 1)
    .toSorted((a, b) => a - b)[0];
  const referenceText = referenceRange
    ? lines.slice(referenceRange[0], firstReferenceLine ?? referenceRange[1]).join("\n")
    : "";
  const sectionRetrieved = /\bretrieved\s+(?:from\s+[^\d\n]+\s+)?\d{4}-\d{2}-\d{2}\b/i.test(
    referenceText,
  );
  const referenceLines = new Set();
  if (referenceRange) {
    for (let i = referenceRange[0]; i < referenceRange[1]; i += 1) referenceLines.add(i);
  }
  for (const id of researchInlineCitationIds(lines, inFence, referenceLines)) {
    if (!references.has(id)) findings.push(`inline citation [${id}] has no reference entry`);
  }
  for (const [id, entry] of references) {
    if (/\b(?:example\.invalid|invalid\.example)\b/i.test(entry.text)) {
      findings.push(`[${id}] line ${entry.line} uses a placeholder URL`);
    }
    const urls = [...entry.text.matchAll(/\b(?:https?|file):\/\/\S+/gi)];
    const localEvidence = urls.length === 0 || /\b(?:repository|local)\s+file\b/i.test(entry.text);
    const localPaths = localEvidence
      ? [...entry.text.matchAll(/`([^`]+)`/g)]
          .map((match) => match[1])
          .filter((candidate) => candidate.startsWith("/") || candidate.startsWith("."))
      : [];
    const absolutePaths = localEvidence
      ? (entry.text.match(/\/(?:home|tmp|workspace|repo)[^\s,;)>]+/g) ?? [])
      : [];
    if (urls.length === 0 && localPaths.length === 0 && absolutePaths.length === 0) {
      findings.push(`[${id}] line ${entry.line} has no URL or local source path`);
    }
    if (
      !sectionRetrieved &&
      !/\bretrieved(?:\s+from[^\d\n]+)?\s+\d{4}-\d{2}-\d{2}\b/i.test(entry.text)
    ) {
      findings.push(`[${id}] line ${entry.line} has no retrieval date`);
    }
    for (const match of entry.text.matchAll(/file:\/\/\S+/gi)) {
      const raw = match[0].replace(/[.,;)>]+$/, "");
      try {
        const localPath = fileURLToPath(new URL(raw));
        if (!fs.existsSync(localPath)) {
          findings.push(`[${id}] line ${entry.line} local source does not exist: ${localPath}`);
        }
      } catch {
        findings.push(`[${id}] line ${entry.line} has invalid local source URL: ${raw}`);
      }
    }
    for (const candidate of [...localPaths, ...absolutePaths]) {
      const localPath = path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
      if (!fs.existsSync(localPath)) {
        findings.push(`[${id}] line ${entry.line} local source does not exist: ${localPath}`);
      }
    }
  }
  return findings.map((finding) => `${researchPath}: ${finding}`);
}

function sectionRange(lines, inFence, title) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inFence[i] && lines[i].trim() === `## ${title}`) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!inFence[i] && /^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function fencedBlockAfter(lines, inFence, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (!inFence[i]) continue;
    const m = lines[i].match(FENCE_OPEN_RE);
    if (!m) continue;
    const char = m[1][0];
    const len = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const cm = lines[j].match(FENCE_OPEN_RE);
      if (cm && cm[1][0] === char && cm[1].length >= len && cm[2].trim() === "") return body;
      body.push(lines[j]);
    }
    return body;
  }
  return null;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const kv = {};
  const errors = [];
  const lines = splitLines(m[1]);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (/^\s/.test(line)) {
      errors.push(`unexpected indented line ${i + 1}: "${line.trim().slice(0, 40)}"`);
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (!pair) {
      errors.push(`unparseable line ${i + 1}: "${line.slice(0, 40)}"`);
      continue;
    }
    const key = pair[1];
    if (Object.prototype.hasOwnProperty.call(kv, key)) {
      errors.push(`duplicate frontmatter key "${key}"`);
      continue;
    }
    let val = (pair[2] === undefined ? "" : pair[2]).trim();
    const block = val.match(/^([|>])[+-]?\s*$/);
    if (block) {
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === "" || /^\s+/.test(lines[j]))) {
        buf.push(lines[j].trim());
        j += 1;
      }
      kv[key] = block[1] === ">" ? buf.filter((x) => x !== "").join(" ") : buf.join("\n");
      i = j - 1;
      continue;
    }
    if (
      val.length >= 2 &&
      ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    kv[key] = val;
  }
  return { kv, errors };
}

function subsequenceGap(actual, required) {
  let i = 0;
  for (const title of required) {
    let found = false;
    while (i < actual.length) {
      if (actual[i] === title) {
        i += 1;
        found = true;
        break;
      }
      i += 1;
    }
    if (!found) return title;
  }
  return null;
}

function extractChain(lines, inFence, start, end) {
  for (let i = start + 1; i < end; i += 1) {
    if (inFence[i]) continue;
    const m = lines[i].match(CHAIN_RE);
    if (m) return { tokens: m[1].split(/\s*->\s*/), line: i };
  }
  return null;
}

function verifyMachine(skill, lines, inFence, machine) {
  const range = sectionRange(lines, inFence, machine.section);
  if (!range) {
    check(false, `${skill}/SKILL.md missing state machine section "## ${machine.section}"`);
    return null;
  }
  const [start, end] = range;
  const chain = extractChain(lines, inFence, start, end);
  if (!chain) {
    check(false, `${skill}/SKILL.md has no backticked state chain in "## ${machine.section}"`);
    return null;
  }
  check(chain.tokens.length >= 2, `${skill}/SKILL.md state chain has fewer than 2 states`);
  check(
    new Set(chain.tokens).size === chain.tokens.length,
    `${skill}/SKILL.md state chain has duplicate states: ${chain.tokens.join(" -> ")}`,
  );

  const heads = [];
  for (let i = start + 1; i < end; i += 1) {
    if (inFence[i]) continue;
    const m = lines[i].match(STATE_HEADING_RE);
    if (!m) continue;
    const tok = m[2].match(STATE_TOKEN_RE);
    heads.push({ num: Number(m[1]), token: tok ? tok[0] : m[2].trim(), line: i });
  }

  const last = chain.tokens[chain.tokens.length - 1];
  const stopHeaded = heads.some((h) => h.token === last);
  const terminalExempt = last === "STOP" && !stopHeaded;
  const requiredTokens = terminalExempt ? chain.tokens.slice(0, -1) : chain.tokens;

  for (const t of requiredTokens) {
    const n = heads.filter((h) => h.token === t).length;
    check(
      n === 1,
      n === 0
        ? `${skill}/SKILL.md state ${t} from the chain has no "### <n>. ${t}" heading`
        : `${skill}/SKILL.md state ${t} has ${n} numbered headings (want exactly 1)`,
    );
  }
  const orphans = heads.filter((h) => !chain.tokens.includes(h.token));
  check(
    orphans.length === 0,
    `${skill}/SKILL.md numbered state headings not in the chain: ${orphans.map((h) => h.token).join(", ")}`,
  );
  check(
    heads.length === requiredTokens.length,
    `${skill}/SKILL.md chain claims ${chain.tokens.length} states but has ${heads.length} numbered state sections (want ${requiredTokens.length})`,
  );
  check(
    heads.length === requiredTokens.length &&
      heads.every((h, idx) => h.token === requiredTokens[idx]),
    `${skill}/SKILL.md state headings out of chain order (chain: ${requiredTokens.join(" -> ")}; headings: ${heads.map((h) => h.token).join(" -> ")})`,
  );
  check(
    heads.every((h, idx) => h.num === idx + 1),
    `${skill}/SKILL.md state headings not consecutively numbered from 1 (got ${heads.map((h) => h.num).join(", ")})`,
  );

  if (machine.entryExit) {
    for (const h of heads) {
      let stop = end;
      for (let i = h.line + 1; i < end; i += 1) {
        if (!inFence[i] && (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i]))) {
          stop = i;
          break;
        }
      }
      const body = [];
      for (let i = h.line + 1; i < stop; i += 1) {
        if (!inFence[i]) body.push(lines[i]);
      }
      check(
        body.some((l) => l.startsWith("Entry:")),
        `${skill}/SKILL.md state ${h.token} section lacks an "Entry:" line`,
      );
      check(
        body.some((l) => l.startsWith("Exit:")),
        `${skill}/SKILL.md state ${h.token} section lacks an "Exit:" line`,
      );
    }
  }
  return { chain, heads, requiredTokens, range };
}

function verifyReviewClaims(skill, lines, inFence, machineResult) {
  const done = sectionRange(lines, inFence, "Done Criteria");
  if (!done) {
    check(false, `${skill}/SKILL.md missing "## Done Criteria" for numeric claims`);
    return;
  }
  const doneText = [];
  for (let i = done[0]; i < done[1]; i += 1) {
    if (!inFence[i]) doneText.push(lines[i]);
  }
  const joined = doneText.join("\n");

  const statesClaim = joined.match(/\bAll\s+(\d+)\s+states\b/);
  check(statesClaim !== null, `${skill}/SKILL.md Done Criteria lacks an "All N states" claim`);
  if (statesClaim && machineResult) {
    check(
      Number(statesClaim[1]) === machineResult.heads.length,
      `${skill}/SKILL.md claims ${statesClaim[1]} states; machine has ${machineResult.heads.length} numbered state sections`,
    );
  }

  const dimsClaim = joined.match(/\b(\d+)\s+dimensions\b/);
  check(dimsClaim !== null, `${skill}/SKILL.md Done Criteria lacks an "N dimensions" claim`);

  const dims = sectionRange(lines, inFence, "Review Dimensions");
  if (!dims) {
    check(false, `${skill}/SKILL.md missing "## Review Dimensions" for dimension-table checks`);
    return;
  }
  const rowNums = [];
  let groupingLine = null;
  for (let i = dims[0]; i < dims[1]; i += 1) {
    if (inFence[i]) continue;
    const row = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (row) rowNums.push(Number(row[1]));
    if (/group for finder assignment/.test(lines[i])) groupingLine = lines[i];
  }
  if (dimsClaim) {
    check(
      rowNums.length === Number(dimsClaim[1]),
      `${skill}/SKILL.md claims ${dimsClaim[1]} dimensions; dimension table has ${rowNums.length} rows`,
    );
  }
  check(
    rowNums.every((n, idx) => n === idx + 1),
    `${skill}/SKILL.md dimension table numbering is not 1..${rowNums.length} (got ${rowNums.join(", ")})`,
  );

  check(
    groupingLine !== null,
    `${skill}/SKILL.md Review Dimensions lacks the finder-assignment grouping line`,
  );
  if (groupingLine !== null) {
    const after = groupingLine.slice(groupingLine.indexOf("group for finder assignment"));
    const covered = [];
    let bad = null;
    for (const gm of after.match(/\(([^)]*)\)/g) || []) {
      for (const item of gm.slice(1, -1).split(",")) {
        const im = item.trim().match(/^(\d+)(?:\s*[–—-]\s*(\d+))?$/);
        if (!im) {
          bad = item.trim();
          continue;
        }
        const a = Number(im[1]);
        const b = im[2] ? Number(im[2]) : a;
        for (let n = a; n <= b; n += 1) covered.push(n);
      }
    }
    check(bad === null, `${skill}/SKILL.md grouping has unparseable range "${bad}"`);
    const sorted = [...covered].toSorted((x, y) => x - y);
    const want = Array.from({ length: rowNums.length }, (_, idx) => idx + 1);
    check(
      sorted.length === want.length && sorted.every((n, idx) => n === want[idx]),
      `${skill}/SKILL.md grouping ranges do not cover 1..${rowNums.length} exactly once (got ${sorted.join(", ")})`,
    );
  }
}

function discoverSkillDirs() {
  const dirs = [];
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    check(false, `cannot read root directory ${root}`);
    return dirs;
  }
  for (const entry of entries) {
    if (!/^csm-[a-z-]+$/.test(entry)) continue;
    const dirPath = path.join(root, entry);
    let isDir = false;
    try {
      isDir = fs.statSync(dirPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir && fs.existsSync(path.join(dirPath, "SKILL.md"))) dirs.push(entry);
  }
  dirs.sort();
  return dirs;
}

// Recursively lists files under `dir`, returning paths relative to `base`
// using forward slashes regardless of platform separator.
function walkRelFiles(dir, base = dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRelFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

// Expands the authoritative pack-bootstrap mapping (single source of truth
// for what ships under bootstrap/package/payload) into dest -> repo-root src.
// Only the payload/skills/** dests are checked; metadata (e.g. LICENSE at the
// package root) is out of scope.
function buildPayloadSrcMap(rootDir) {
  const map = new Map();
  const manifest = loadSkillManifest(rootDir);
  for (const skill of manifest.skills ?? []) {
    map.set(`payload/skills/${skill}/SKILL.md`, `${skill}/SKILL.md`);
  }
  for (const item of mapping.supportingFiles) {
    if (item.srcDir) {
      const destDir = toPosix(item.destDir);
      const srcDir = toPosix(item.srcDir);
      for (const rel of walkRelFiles(path.join(rootDir, srcDir.split("/").join(path.sep)))) {
        map.set(`${destDir}/${rel}`, `${srcDir}/${rel}`);
      }
    } else {
      map.set(toPosix(item.dest), toPosix(item.src));
    }
  }
  return map;
}

function checkCommittedPayloadIndex(rootDir) {
  const issues = [];
  const manifest = loadSkillManifest(rootDir);
  if (manifest.error) return [manifest.error];
  const names = manifest.skills ?? [];
  if (
    manifest.schema !== "csm-skill-manifest/1" ||
    manifest.version !== 1 ||
    manifest.contentDigest !== "sha256" ||
    !manifest.compatibility ||
    !manifest.permissions ||
    !manifest.entrypoints ||
    !manifest.eval ||
    !manifest.trace
  )
    issues.push("skill manifest schema or metadata mismatch");
  if (new Set(names).size !== names.length) issues.push("skill manifest contains duplicate names");

  let index;
  try {
    index = JSON.parse(
      fs.readFileSync(path.join(rootDir, "bootstrap", "payload-index.json"), "utf8"),
    );
  } catch (err) {
    return [`payload index unreadable: ${err.message}`];
  }
  const indexed = [
    ...(index.classes?.skills ?? []),
    ...(index.classes?.supportingFiles ?? []),
    ...(index.classes?.helperBins ?? []),
    ...(index.classes?.metadata ?? []),
    ...(index.fixedBin ? [index.fixedBin] : []),
  ];
  const byPath = new Map(indexed.map((entry) => [entry.path, entry]));
  if (byPath.size !== indexed.length) issues.push("INDEX_DUPLICATE_PATH");
  const packageRoot = path.join(rootDir, "bootstrap", "package");
  const packageFiles = walkRelFiles(packageRoot).filter(
    (file) => file !== "package.json" && file !== "payload-index.json",
  );
  for (const entry of indexed) {
    const file = path.join(packageRoot, entry.path.split("/").join(path.sep));
    if (!fs.existsSync(file)) issues.push(`INDEX-TO-FILES missing ${entry.path}`);
    else if (fileSha256(file) !== entry.sha256)
      issues.push(`INDEX-TO-FILES digest mismatch ${entry.path}`);
  }
  for (const file of packageFiles)
    if (!byPath.has(file)) issues.push(`FILES-TO-INDEX omitted ${file}`);
  const expectedSkills = names.map((name) => `payload/skills/${name}/SKILL.md`).toSorted();
  const actualSkills = (index.classes?.skills ?? []).map((entry) => entry.path).toSorted();
  if (JSON.stringify(expectedSkills) !== JSON.stringify(actualSkills))
    issues.push(
      `manifest/index skill mismatch (manifest ${expectedSkills.length}, index ${actualSkills.length})`,
    );
  return issues;
}

// Payload-drift gate (journal-learnings T001): every file under
// bootstrap/package/payload/skills/** must byte-identical to its repo-root
// source per the pack-bootstrap mapping. Mirrors checkDrift: collects issues
// and reports the comparison dynamically ({compared:N, issues:[]}); any issue
// is a hard failure.
function checkPayloadDrift(rootDir) {
  const payloadRoot = path.join(rootDir, "bootstrap", "package", "payload", "skills");
  const srcMap = buildPayloadSrcMap(rootDir);
  const issues = [];
  let compared = 0;
  let payloadExists = false;
  try {
    payloadExists = fs.statSync(payloadRoot).isDirectory();
  } catch {
    payloadExists = false;
  }
  if (!payloadExists) {
    issues.push("payload/skills tree missing");
  } else {
    for (const rel of walkRelFiles(payloadRoot)) {
      compared += 1;
      const srcRel = srcMap.get(`payload/skills/${rel}`);
      if (srcRel === undefined) {
        issues.push(`UNEXPECTED ${rel} (no pack-bootstrap mapping for this payload file)`);
        continue;
      }
      const srcPath = path.join(rootDir, srcRel.split("/").join(path.sep));
      let srcContent;
      try {
        srcContent = fs.readFileSync(srcPath);
      } catch {
        issues.push(`MISSING-SOURCE ${rel}`);
        continue;
      }
      const payloadContent = fs.readFileSync(path.join(payloadRoot, rel.split("/").join(path.sep)));
      if (
        createHash("sha256").update(payloadContent).digest("hex") !==
        createHash("sha256").update(srcContent).digest("hex")
      ) {
        issues.push(`DIFF ${rel}`);
      }
    }
    // F-008: reverse direction — every mapped source must exist in the
    // payload tree. The forward walk above only visits files that already
    // exist under payload/, so a NEW source file added to a mapped directory
    // without re-running pack-bootstrap would otherwise ship silently
    // missing from the package while all gates stay green.
    for (const [dest, srcRel] of srcMap) {
      const payloadPath = path.join(
        rootDir,
        "bootstrap",
        "package",
        dest.split("/").join(path.sep),
      );
      if (!fs.existsSync(payloadPath)) {
        issues.push(
          `MISSING-IN-PAYLOAD ${dest} (source ${srcRel} not packed — rerun scripts/pack-bootstrap.mjs)`,
        );
      }
    }
  }
  console.log(`payload drift: {compared:${compared}, issues:${JSON.stringify(issues)}}`);
  return issues;
}

// DEFERRED-citation rule (journal-learnings T004): task lines marked
// `[blocked] DEFERRED` must carry a `[DEF:<slug>]` citation matching an ID in
// the deferred ledger (.agents/docs/deferred.md). Non-COMPLETE plans hard-fail
// on a missing citation; COMPLETE plans are grandfathered and warn only, so the
// rule never forces an edit to a completed/closed plan. Returns the set of
// ledger IDs (headings `## DEF-<ID>` / `### DEF-<ID>`) or null when the ledger
// is missing (the rule is then unusable and the gate reports it).
function readDeferredLedgerIds(ledgerPath) {
  const content = readOrNull(ledgerPath);
  if (content === null) return null;
  const ids = new Set();
  for (const line of splitLines(content)) {
    const m = line.match(/^#{2,4}\s+(DEF-[A-Z0-9-]+)\s*$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// Extracts the set of artifact basenames referenced by bullet lines in
// .agents/README.md (lines like "- `2026-08-19-x.md` — ..."). Returns null
// when the index file is absent.
function readAgentsIndexBasenames(indexPath) {
  const content = readOrNull(indexPath);
  if (content === null) return null;
  const names = new Set();
  for (const line of splitLines(content)) {
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const t = m[1];
      if (t.includes("/") || t.startsWith(".")) continue;
      names.add(t);
    }
  }
  return names;
}

// Scans a plan for `[blocked] DEFERRED` task lines and returns
// { isComplete, hasDeferred, issues, warnings }. A DEFERRED task is "cited"
// when its task block (task line through its attribute lines) contains a
// `[DEF:<slug>]` token whose `DEF-<slug>` form matches a ledger ID.
function checkDeferredCitations(planFile, content, ledgerIds) {
  const issues = [];
  const warnings = [];
  const control = parsePlanControl(content);
  const isComplete = control !== null && control.status === "complete";
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  let hasDeferred = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const tm = lines[i].match(/^\s*(\d+)\.\s+\[blocked\]\s+DEFERRED\b/);
    if (!tm) continue;
    hasDeferred = true;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (inFence[j]) continue;
      if (/^\s*\d+\.\s+\[/.test(lines[j])) break;
      if (/^#{1,3}\s/.test(lines[j])) break;
      block.push(lines[j]);
    }
    const text = block.join("\n");
    let cited = null;
    if (ledgerIds !== null) {
      for (const cm of text.matchAll(/\[DEF:([A-Z0-9-]+)\]/g)) {
        if (ledgerIds.has(`DEF-${cm[1]}`)) {
          cited = cm[1];
          break;
        }
      }
    }
    const label = `plan corpus .agents/plans/${planFile}`;
    if (isComplete) {
      warnings.push(
        `${label}: DEFERRED task ${tm[1]} (COMPLETE plan — grandfathered)${cited ? ` cites [DEF:${cited}]` : " lacks a [DEF:<slug>] ledger citation"}`,
      );
    } else if (cited === null) {
      issues.push(
        `${label}: DEFERRED task ${tm[1]} has no ledger citation [DEF:<slug>] (non-COMPLETE plans must cite a deferred.md record)`,
      );
    }
  }
  return { isComplete, hasDeferred, issues, warnings };
}

function main() {
  const skillDirs = discoverSkillDirs();
  const skillManifest = loadSkillManifest(root);
  const plansDir = path.join(root, ".agents", "plans");

  // F-053 (corpus half, D15): when a `.git` exists at the corpus root, the
  // corpus loops below skip untracked files (in-progress drafts cannot block
  // the gate). No git -> null -> no filtering, so planted-defect corpora stay
  // visible to the corpus checks.
  const tracked = loadTrackedFiles(root);

  for (const skill of skillDirs) {
    check(
      Object.prototype.hasOwnProperty.call(MANIFEST, skill),
      `skill dir ${skill} has no MANIFEST entry in scripts/lib/contracts.mjs (new skills must be registered, not silently skipped)`,
    );
  }
  for (const key of Object.keys(MANIFEST)) {
    check(
      skillDirs.includes(key),
      `MANIFEST key "${key}" has no matching skill directory (dead registry key)`,
    );
  }
  if (skillManifest.error) check(false, skillManifest.error);
  else {
    const manifestSkills = [...(skillManifest.skills ?? [])].toSorted();
    check(
      JSON.stringify(manifestSkills) === JSON.stringify([...skillDirs].toSorted()),
      `skill manifest/discovery mismatch (manifest ${manifestSkills.join(",")}; discovery ${skillDirs.join(",")})`,
    );
  }

  for (const skill of skillDirs) {
    const file = path.join(root, skill, "SKILL.md");
    const content = readOrNull(file);
    if (content === null) {
      check(false, `${skill}/SKILL.md unreadable`);
      continue;
    }

    const lines = splitLines(content);
    const inFence = fenceMap(lines);

    check(lines.length < 500, `${skill}/SKILL.md size ${lines.length} lines (>= 500)`);

    const fm = parseFrontmatter(content);
    check(fm !== null, `${skill}/SKILL.md frontmatter does not parse`);
    if (fm === null) continue;
    check(fm.errors.length === 0, `${skill}/SKILL.md frontmatter: ${fm.errors.join("; ")}`);
    const kv = fm.kv;

    const name = typeof kv.name === "string" ? kv.name : "";
    check(name !== "", `${skill}/SKILL.md missing frontmatter name`);
    check(NAME_RE.test(name), `${skill}/SKILL.md name "${name}" not ^[a-z0-9]+(-[a-z0-9]+)*$`);
    check(name === skill, `${skill}/SKILL.md name "${name}" != dir "${skill}"`);

    const desc = typeof kv.description === "string" ? kv.description : "";
    check(desc !== "", `${skill}/SKILL.md missing frontmatter description`);
    check(desc.length <= 1024, `${skill}/SKILL.md description length ${desc.length} (> 1024)`);
    check(
      NEVER_CLAUSE_RE.test(desc),
      `${skill}/SKILL.md description lacks a Never-X clause (e.g. "never plans or implements")`,
    );

    const h1 = countH1(lines, inFence);
    check(h1 === 1, `${skill}/SKILL.md has ${h1} H1 titles outside fences (want exactly 1)`);

    const manifest = MANIFEST[skill];
    if (!manifest) continue;

    const h2 = h2Titles(lines, inFence);
    const h2Set = h2.map((x) => x.title);
    const dupes = h2Set.filter((t, idx) => h2Set.indexOf(t) !== idx);
    check(
      dupes.length === 0,
      `${skill}/SKILL.md duplicate H2 sections: ${[...new Set(dupes)].join(", ")}`,
    );

    for (const sec of manifest.sections) {
      check(
        h2Set.includes(sec),
        `${skill}/SKILL.md missing section "## ${sec}" (as a real heading outside fences)`,
      );
    }

    const interfaceRange = sectionRange(lines, inFence, "Interface");
    check(interfaceRange !== null, `${skill}/SKILL.md missing exact "## Interface" section`);
    if (interfaceRange !== null) {
      const interfaceLines = lines.slice(interfaceRange[0], interfaceRange[1]);
      const labels = ["Consumes", "Produces", "Hands off", "Never invokes"];
      for (const label of labels) {
        const matches = interfaceLines.filter((line) => new RegExp(`^- ${label}: `).test(line));
        check(
          matches.length === 1,
          `${skill}/SKILL.md Interface label "${label}:" occurs ${matches.length} times (want exactly 1)`,
        );
      }
      const labelLines = interfaceLines.filter((line) => /^- [A-Za-z][A-Za-z ]*: /.test(line));
      check(
        labelLines.length === 4,
        `${skill}/SKILL.md Interface has ${labelLines.length} labeled bullets (want exactly 4)`,
      );
      const neverLine = interfaceLines.find((line) => line.startsWith("- Never invokes: "));
      if (neverLine) {
        const names = neverLine
          .slice("- Never invokes: ".length)
          .split(",")
          .map((nm) => nm.trim())
          .filter(Boolean);
        const unknown = names.filter((nm) => !Object.prototype.hasOwnProperty.call(INTERFACES, nm));
        check(
          unknown.length === 0,
          `${skill}/SKILL.md Interface Never invokes has unknown skill names: ${unknown.join(", ")}`,
        );
        const expected = Object.keys(NEVER_INVOKE[skill] || {}).filter(
          (nm) => NEVER_INVOKE[skill][nm],
        );
        check(
          new Set(names).size === names.length &&
            names.length === expected.length &&
            names.every((nm) => expected.includes(nm)),
          `${skill}/SKILL.md Interface Never invokes does not match contracts.mjs row (expected: ${expected.join(", ")})`,
        );
      }
      const artifactFailures = validateInterfaceArtifactPatterns(skill, interfaceLines.join("\n"));
      if (artifactFailures.length === 0) {
        check(true, `${skill}/SKILL.md Interface artifact patterns OK`);
      } else {
        for (const f of artifactFailures) check(false, `${skill}/SKILL.md ${f}`);
      }
    }

    if (manifest.tmux) {
      check(
        h2Set.includes("Tmux Session Bootstrap"),
        `${skill}/SKILL.md missing section "## Tmux Session Bootstrap"`,
      );
    } else {
      check(
        !h2Set.includes("Tmux Session Bootstrap"),
        `${skill}/SKILL.md has "## Tmux Session Bootstrap" (must not)`,
      );
    }

    if (manifest.norms) {
      const phraseHit = lines.some((l, idx) => !inFence[idx] && NORMS_PHRASE_RE.test(l));
      check(
        phraseHit,
        `${skill}/SKILL.md lacks NORMS detection phrase ("Generated by csm-scan" or "## Repository Overview") outside fences`,
      );
    }

    if (manifest.machine) {
      const machineResult = verifyMachine(skill, lines, inFence, manifest.machine);
      if (skill === "csm-review" && machineResult)
        verifyReviewClaims(skill, lines, inFence, machineResult);
    }

    const ordinalFailures = validateOrdinalSequencing(content);
    runGatedCheck(
      skill,
      "ordinal",
      ordinalFailures,
      `${skill}/SKILL.md state-section ordinal sequencing`,
    );
  }

  for (const contract of CONTRACTS) {
    const srcContent = readOrNull(path.join(root, contract.source.skill, "SKILL.md"));
    check(
      containsOutsideFences(srcContent, contract.source.needle),
      `contract ${contract.id}: producer ${contract.source.skill}/SKILL.md lacks "${contract.source.needle}" (outside fences)`,
    );
    for (const consumer of contract.consumers) {
      const consContent = readOrNull(path.join(root, consumer.skill, "SKILL.md"));
      if (contract.rule === "prefix") {
        check(
          contract.source.needle.startsWith(consumer.needle),
          `contract ${contract.id}: consumer needle "${consumer.needle}" is not a prefix of producer needle "${contract.source.needle}"`,
        );
      } else {
        check(
          consumer.needle === contract.source.needle,
          `contract ${contract.id}: consumer needle "${consumer.needle}" != producer needle "${contract.source.needle}"`,
        );
      }
      check(
        containsOutsideFences(consContent, consumer.needle),
        `contract ${contract.id}: consumer ${consumer.skill}/SKILL.md lacks "${consumer.needle}" (outside fences)`,
      );
    }
  }

  // UPLOAD_SCRIPT_REF (F-052): route the reference scan through the canonical
  // splitLines/fenceMap. Existence is fence-independent (a doc pointing users
  // at a missing script is a defect wherever the reference sits); a fenced-only
  // reference is surfaced as a note (F-052 residual — a hard non-fenced
  // presence rule would require a prose reference in csm-upload/SKILL.md).
  const uploadSkillFile = path.join(root, UPLOAD_SCRIPT_REF.skill, "SKILL.md");
  const uploadContent = readOrNull(uploadSkillFile);
  const uploadLines = uploadContent === null ? [] : splitLines(uploadContent);
  const uploadFence = fenceMap(uploadLines);
  const collectScriptRefs = (pred) => {
    const out = new Set();
    for (let i = 0; i < uploadLines.length; i += 1) {
      if (!pred(i)) continue;
      for (const m of uploadLines[i].matchAll(UPLOAD_SCRIPT_REF.pattern)) out.add(m[0]);
    }
    return [...out];
  };
  const allRefs = collectScriptRefs(() => true);
  const proseRefs = collectScriptRefs((i) => !uploadFence[i]);
  check(
    allRefs.length > 0,
    `${UPLOAD_SCRIPT_REF.skill}/SKILL.md references no csm-*/scripts/*.mjs script paths`,
  );
  for (const ref of allRefs) {
    check(
      fs.existsSync(path.join(root, ref)),
      `${UPLOAD_SCRIPT_REF.skill}/SKILL.md references ${ref} which does not exist`,
    );
  }
  if (allRefs.length > 0 && proseRefs.length === 0) {
    console.log(
      `  note: ${UPLOAD_SCRIPT_REF.skill}/SKILL.md references its script path(s) only inside code fences (F-052 residual — no non-fenced declaration)`,
    );
  }

  const planSkill = readOrNull(path.join(root, "csm-plan", "SKILL.md"));
  let planTemplate = [];
  if (planSkill !== null) {
    const pl = splitLines(planSkill);
    const pf = fenceMap(pl);
    const range = sectionRange(pl, pf, "Required Plan Document");
    const body = range ? fencedBlockAfter(pl, pf, range[0]) : null;
    if (body !== null)
      planTemplate = body.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
  }
  check(
    planTemplate.length > 0,
    "could not extract the Required Plan Document template from csm-plan/SKILL.md",
  );

  const grillSkill = readOrNull(path.join(root, "csm-grill", "SKILL.md"));
  let approachTemplate = [];
  if (grillSkill !== null) {
    const gl = splitLines(grillSkill);
    const gf = fenceMap(gl);
    const grange = sectionRange(gl, gf, "Required Approach Document");
    const gbody = grange ? fencedBlockAfter(gl, gf, grange[0]) : null;
    if (gbody !== null)
      approachTemplate = gbody
        .filter((l) => /^##\s/.test(l))
        .map((l) => l.replace(/^##\s+/, "").trim());
  }
  check(
    approachTemplate.length > 0,
    "could not extract the Required Approach Document template from csm-grill/SKILL.md",
  );

  const researchSkill = readOrNull(path.join(root, "csm-deep-research", "SKILL.md"));
  let researchTemplate = [];
  if (researchSkill !== null) {
    const rl = splitLines(researchSkill);
    const rf = fenceMap(rl);
    const range = sectionRange(rl, rf, "Required Research Document");
    const body = range ? fencedBlockAfter(rl, rf, range[0]) : null;
    if (body !== null)
      researchTemplate = body
        .filter((l) => /^##\s/.test(l))
        .map((l) => l.replace(/^##\s+/, "").trim());
  }
  check(
    researchTemplate.length > 0,
    "could not extract the Required Research Document template from csm-deep-research/SKILL.md",
  );

  const reviewSkill = readOrNull(path.join(root, "csm-review", "SKILL.md"));
  let reviewTemplateH2 = [];
  let reviewH1Prefix = null;
  if (reviewSkill !== null) {
    const rl = splitLines(reviewSkill);
    const rf = fenceMap(rl);
    const range = sectionRange(rl, rf, "Report Format");
    const body = range ? fencedBlockAfter(rl, rf, range[0]) : null;
    if (body !== null) {
      const h1Line = body.find((l) => /^#\s/.test(l));
      if (h1Line) reviewH1Prefix = `${h1Line.replace(/^#\s+/, "").split("—")[0].trim()} —`;
      reviewTemplateH2 = body
        .filter((l) => /^##\s/.test(l))
        .map((l) =>
          l
            .replace(/^##\s+/, "")
            .trim()
            .replace(/\s+\(.*$/, ""),
        );
    }
  }
  check(
    reviewTemplateH2.length > 0,
    "could not extract the Report Format template from csm-review/SKILL.md",
  );
  check(
    reviewH1Prefix !== null,
    "Report Format template has no H1 line — review-corpus H1 check would silently skip",
  );

  // Template format-marker validation (F-050): the first line inside each
  // producer template fence must be `format: <skill>/<n>`. Hard-enforced
  // (the old PENDING_DEBT softening was pruned as inert).
  runGatedCheck(
    "csm-plan",
    "template-format-marker",
    validateTemplateFormatMarkers(planSkill ?? "", "csm-plan", "Required Plan Document"),
    "csm-plan/SKILL.md template format marker",
  );
  runGatedCheck(
    "csm-grill",
    "template-format-marker",
    validateTemplateFormatMarkers(grillSkill ?? "", "csm-grill", "Required Approach Document"),
    "csm-grill/SKILL.md template format marker",
  );
  runGatedCheck(
    "csm-review",
    "template-format-marker",
    validateTemplateFormatMarkers(reviewSkill ?? "", "csm-review", "Report Format"),
    "csm-review/SKILL.md template format marker",
  );
  runGatedCheck(
    "csm-deep-research",
    "template-format-marker",
    validateTemplateFormatMarkers(
      researchSkill ?? "",
      "csm-deep-research",
      "Required Research Document",
    ),
    "csm-deep-research/SKILL.md template format marker",
  );

  const deferredLedgerPath = path.join(root, ".agents", "docs", "deferred.md");
  const deferredLedgerIds = readDeferredLedgerIds(deferredLedgerPath);
  check(
    deferredLedgerIds !== null,
    `deferred ledger ${path.join(".agents", "docs", "deferred.md")} not found (DEFERRED-citation rule requires it)`,
  );

  let planFiles = [];
  try {
    planFiles = fs
      .readdirSync(plansDir)
      .filter((f) => f.endsWith("-csm.md"))
      .toSorted();
  } catch {
    planFiles = [];
  }
  check(
    planFiles.length > 0,
    `no *-csm.md plan corpus found under ${path.join(".agents", "plans")}`,
  );
  for (const f of planFiles) {
    if (tracked !== null && !tracked.has(`.agents/plans/${f}`)) continue;
    const content = readOrNull(path.join(plansDir, f));
    if (content === null) {
      check(false, `plan corpus .agents/plans/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(
      marker !== null &&
        marker.kind === "csm-plan" &&
        marker.version >= 1 &&
        marker.version <= (FORMAT_VERSIONS["csm-plan"] ?? 0),
      `plan corpus .agents/plans/${f} missing/unknown format marker (want frontmatter "format: csm-plan/<n>")`,
    );
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, planTemplate);
    check(
      gap === null,
      `plan corpus .agents/plans/${f}: missing/out-of-order required section "## ${gap}"`,
    );

    const controlFailures = validatePlanControl(content);
    if (controlFailures.length === 0) {
      check(true, `plan corpus .agents/plans/${f} Control OK`);
    } else {
      for (const msg of controlFailures) check(false, `plan corpus .agents/plans/${f}: ${msg}`);
    }
    const journalFailures = validatePlanJournal(content);
    if (journalFailures.length === 0) {
      check(true, `plan corpus .agents/plans/${f} journal OK`);
    } else {
      for (const msg of journalFailures) check(false, `plan corpus .agents/plans/${f}: ${msg}`);
    }

    // Journal/Control consistency (review F8-03): paused plans must have both
    // Control PAUSED and a PAUSED last journal row; active plans must not end
    // PAUSED. COMPLETE/terminal plans are grandfathered inside the validator.
    const consistencyFailures = validateJournalControlConsistency(content);
    if (consistencyFailures.length === 0) {
      check(true, `plan corpus .agents/plans/${f} journal/control consistency OK`);
    } else {
      for (const msg of consistencyFailures) {
        check(false, `plan corpus .agents/plans/${f}: ${msg}`);
      }
    }

    const applicabilityFailures = validatePlanApplicability(content, root);
    if (applicabilityFailures.length === 0) {
      check(true, `plan corpus .agents/plans/${f} applicability OK`);
    } else {
      for (const msg of applicabilityFailures) {
        check(false, `plan corpus .agents/plans/${f}: ${msg}`);
      }
    }

    const taskFailures = validatePlanTaskCompleteness(content);
    if (taskFailures.length === 0) {
      check(true, `plan corpus .agents/plans/${f} task identity/acceptance completeness OK`);
    } else {
      for (const msg of taskFailures) check(false, `plan corpus .agents/plans/${f}: ${msg}`);
    }

    const deferred = checkDeferredCitations(f, content, deferredLedgerIds);
    if (deferred.hasDeferred) {
      if (deferred.isComplete) {
        for (const msg of deferred.warnings) console.log(`  note: ${msg}`);
      } else if (deferred.issues.length === 0) {
        check(true, `plan corpus .agents/plans/${f} DEFERRED citations OK`);
      } else {
        for (const msg of deferred.issues) check(false, msg);
      }
    }

    // Plan acceptance-signal lint (journal-learnings T005 / J5): non-COMPLETE
    // plans' bash acceptance signals must be bash -n clean with no `<...>`
    // placeholders, no `; test $? -eq` under set -e, and no `grep -q "$m"`
    // over dash-leading tokens. COMPLETE plans encode history and are exempt.
    const signals = lintPlanSignals(f, content);
    if (signals.status === "ready" || signals.status === "in_progress") {
      if (signals.issues.length === 0) {
        check(true, `plan corpus .agents/plans/${f} acceptance signals OK`);
      } else {
        for (const iss of signals.issues) {
          check(false, `plan corpus .agents/plans/${f} line ${iss.line}: ${iss.message}`);
        }
      }
    }
  }

  // .agents artifact-index rule (review F1-07, journal-lessons F7/J7): every
  // tracked artifact under .agents/ except the index itself must have an index
  // line in .agents/README.md.
  // Same-commit indexing is the gate's teeth: adding an artifact without its
  // index line fails the next run. Untracked drafts never brick the gate.
  {
    const indexed = readAgentsIndexBasenames(path.join(root, ".agents", "README.md"));
    if (indexed === null) {
      console.log("note: .agents/README.md absent — artifact-index check skipped");
    } else if (tracked === null) {
      console.log("note: git unavailable — artifact-index check skipped");
    } else {
      const AGENTS_INDEX_EXEMPT = new Set([".agents/README.md"]);
      const agentsArtifacts = [...tracked].filter(
        (t) => t.startsWith(".agents/") && !AGENTS_INDEX_EXEMPT.has(t),
      );
      const missing = agentsArtifacts.filter((t) => !indexed.has(path.basename(t))).toSorted();
      if (missing.length === 0) {
        check(
          true,
          `.agents artifact index covers all ${agentsArtifacts.length} tracked artifacts`,
        );
      } else {
        for (const t of missing) {
          check(false, `.agents artifact index: ${t} has no index line in .agents/README.md`);
        }
      }
    }
  }

  const reviewsDir = path.join(root, ".agents", "reviews");
  let reviewFiles = [];
  try {
    reviewFiles = fs
      .readdirSync(reviewsDir)
      .filter((f) => f.endsWith("-review.md"))
      .toSorted();
  } catch {
    reviewFiles = [];
  }
  check(
    reviewFiles.length > 0,
    `no *-review.md review corpus found under ${path.join(".agents", "reviews")}`,
  );
  for (const f of reviewFiles) {
    if (tracked !== null && !tracked.has(`.agents/reviews/${f}`)) continue;
    const content = readOrNull(path.join(reviewsDir, f));
    if (content === null) {
      check(false, `review corpus .agents/reviews/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(
      marker !== null &&
        marker.kind === "csm-review" &&
        marker.version >= 1 &&
        marker.version <= (FORMAT_VERSIONS["csm-review"] ?? 0),
      `review corpus .agents/reviews/${f} missing/unknown format marker (want frontmatter "format: csm-review/<n>")`,
    );
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const h1s = lines.filter((l, idx) => !inFence[idx] && /^#\s/.test(l));
    check(
      h1s.length === 1,
      `review corpus .agents/reviews/${f} has ${h1s.length} H1 titles (want 1)`,
    );
    if (reviewH1Prefix !== null && h1s.length === 1) {
      check(
        h1s[0].replace(/^#\s+/, "").startsWith(reviewH1Prefix),
        `review corpus .agents/reviews/${f} H1 does not start with "${reviewH1Prefix}"`,
      );
    }
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, reviewTemplateH2);
    check(
      gap === null,
      `review corpus .agents/reviews/${f}: missing/out-of-order Report Format section "## ${gap}"`,
    );
  }

  const approachesDir = path.join(root, ".agents", "approaches");
  let approachFiles = [];
  try {
    approachFiles = fs
      .readdirSync(approachesDir)
      .filter((f) => f.endsWith("-approach.md"))
      .toSorted();
  } catch {
    approachFiles = [];
  }
  check(
    approachFiles.length > 0,
    `no *-approach.md approach corpus found under ${path.join(".agents", "approaches")}`,
  );
  for (const f of approachFiles) {
    if (tracked !== null && !tracked.has(`.agents/approaches/${f}`)) continue;
    const content = readOrNull(path.join(approachesDir, f));
    if (content === null) {
      check(false, `approach corpus .agents/approaches/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(
      marker !== null &&
        marker.kind === "csm-grill" &&
        marker.version >= 1 &&
        marker.version <= (FORMAT_VERSIONS["csm-grill"] ?? 0),
      `approach corpus .agents/approaches/${f} missing/unknown format marker (want frontmatter "format: csm-grill/<n>")`,
    );
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, approachTemplate);
    check(
      gap === null,
      `approach corpus .agents/approaches/${f}: missing/out-of-order required section "## ${gap}"`,
    );
  }

  const researchDir = path.join(root, ".agents", "research");
  let researchFiles = [];
  try {
    researchFiles = fs
      .readdirSync(researchDir)
      .filter((f) => f.endsWith("-research.md"))
      .toSorted();
  } catch {
    researchFiles = [];
  }
  check(
    researchFiles.length > 0,
    `no *-research.md research corpus found under ${path.join(".agents", "research")}`,
  );
  for (const f of researchFiles) {
    if (tracked !== null && !tracked.has(`.agents/research/${f}`)) continue;
    const content = readOrNull(path.join(researchDir, f));
    if (content === null) {
      check(false, `research corpus .agents/research/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(
      marker !== null &&
        marker.kind === "csm-deep-research" &&
        marker.version >= 1 &&
        marker.version <= (FORMAT_VERSIONS["csm-deep-research"] ?? 0),
      `research corpus .agents/research/${f} missing/unknown format marker (want frontmatter "format: csm-deep-research/<n>")`,
    );
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    check(
      countH1(lines, inFence) === 1,
      `research corpus .agents/research/${f}: requires exactly one H1 outside fenced blocks`,
    );
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    check(
      titles.length === researchTemplate.length &&
        titles.every((title, index) => title === researchTemplate[index]),
      `research corpus .agents/research/${f}: requires exactly the ordered H2 sections ${researchTemplate.map((title) => `## ${title}`).join(", ")}`,
    );
    const referenceRange = sectionRange(lines, inFence, "References");
    for (const finding of validateResearchReferences(
      lines,
      inFence,
      `.agents/research/${f}`,
      referenceRange,
      root,
    ))
      check(false, finding);
    const journal = content.match(
      /^\[\S+\]\s+[A-Z_]+(?:\s*->\s*[A-Z_]+)+\s*::\s*cycle\s+\d+\s*::/m,
    );
    check(
      journal !== null,
      `research corpus .agents/research/${f}: missing embedded Control journal entry (want "[<timestamp>] <From> -> <To> :: cycle <n> ::")`,
    );
  }

  const readmePath = path.join(root, "README.md");
  const readme = readOrNull(readmePath);
  check(readme !== null, `README.md not found at ${readmePath}`);
  if (readme !== null) {
    const skillSet = new Set(skillDirs);
    const readmeLines = splitLines(readme);
    const readmeFence = fenceMap(readmeLines);
    const seen = new Set();
    for (let i = 0; i < readmeLines.length; i += 1) {
      if (readmeFence[i]) continue;
      const line = readmeLines[i];
      let m;
      while ((m = README_PATH_RE.exec(line)) !== null) {
        const full = m[0];
        const seg = full.split("/")[0];
        check(fs.existsSync(path.join(root, full)), `README path not found: ${full}`);
        if (skillSet.has(seg)) seen.add(seg);
      }
    }
    const missingSkills = [...skillSet].filter((s) => !seen.has(s));
    check(
      missingSkills.length === 0,
      `README references ${seen.size}/${skillSet.size} skills; missing ${missingSkills.join(", ")}`,
    );

    const tmuxSkills = Object.keys(MANIFEST).filter((s) => MANIFEST[s].tmux);
    const hasTmuxBullet = readmeLines.some(
      (l, i) => !readmeFence[i] && /tmux/i.test(l) && tmuxSkills.every((s) => l.includes(s)),
    );
    check(
      hasTmuxBullet,
      `README tmux bullet does not list the ${tmuxSkills.length} bootstrap skills (${tmuxSkills.join(", ")})`,
    );

    // F-061: every H2 below the TOC must have a TOC entry (and every TOC entry
    // must resolve to a heading below it). The composition-matrix section is
    // generator-maintained, so the index must not silently drift.
    checkReadmeToc(readme);

    const stack = [];
    for (const line of readme.split(/\r?\n/)) {
      const m = line.match(/^((?:[│ ]{4})*)[├└]──\s+(\S+)/);
      if (!m) continue;
      const name = m[2];
      if (name === ".") continue;
      const depth = m[1].length / 4;
      const clean = name.replace(/\/+$/, "");
      stack[depth] = clean;
      const rel = stack.slice(0, depth + 1).join("/");
      const abs = path.join(root, rel);
      if (name.endsWith("/")) {
        let isDir = false;
        try {
          isDir = fs.statSync(abs).isDirectory();
        } catch {
          isDir = false;
        }
        check(isDir, `README layout tree entry ${rel}/ is not a real directory`);
      } else {
        check(fs.existsSync(abs), `README layout tree entry ${rel} does not exist`);
      }
    }
  }

  let licenseOk = false;
  try {
    licenseOk = fs.statSync(path.join(root, "LICENSE")).isFile();
  } catch {
    licenseOk = false;
  }
  check(licenseOk, "LICENSE file not found at repo root");

  const boilerplateDrift = checkDrift(root);
  for (const d of boilerplateDrift) {
    check(false, `${d.skill}/SKILL.md "${d.section}": ${d.message}`);
  }

  const payloadDriftIssues = checkPayloadDrift(root);
  for (const issue of payloadDriftIssues) {
    check(false, `payload drift: ${issue}`);
  }
  for (const issue of checkCommittedPayloadIndex(root)) check(false, `payload index: ${issue}`);

  // F-004 early-warning gate: the scan tier manifest must cover every
  // test/*.test.mjs on disk, otherwise every `run-tier` invocation dies at
  // its partition assertion before running anything. Text-scanned (no module
  // execution) so the gate stays deterministic and side-effect free.
  {
    const tiersPath = path.join(root, "csm-scan", "test", "scripts", "tiers.mjs");
    const testDir = path.join(root, "csm-scan", "test");
    let manifestOk = false;
    let detail = "unreadable";
    if (!fs.existsSync(tiersPath)) {
      // Conditional gate: contexts without a materialized csm-scan tree
      // (e.g. the pre-commit hook test fixture) skip this check the same
      // way the lint gate skips without oxlint.
      console.log("tier manifest gate skipped — csm-scan/test/scripts/tiers.mjs not present");
      manifestOk = true;
      detail = "skipped — tiers.mjs not present";
    } else
      try {
        const tiersSrc = fs.readFileSync(tiersPath, "utf8");
        const listed = new Set(
          [...tiersSrc.matchAll(/"(test\/[^"]+\.test\.mjs)"/g)].map((m) => m[1]),
        );
        const current = fs
          .readdirSync(testDir)
          .filter((name) => name.endsWith(".test.mjs"))
          .map((name) => `test/${name}`)
          .toSorted();
        const missing = current.filter((f) => !listed.has(f));
        const unknown = [...listed].filter((f) => !fs.existsSync(path.join(root, "csm-scan", f)));
        if (missing.length === 0 && unknown.length === 0) {
          manifestOk = true;
          detail = `${current.length}/${current.length} files tiered`;
        } else {
          detail = `${missing.length} unlisted, ${unknown.length} phantom${
            missing.length ? ` (first: ${missing[0]})` : ""
          }`;
        }
      } catch (err) {
        detail = err.message;
      }
    check(manifestOk, `scan tier manifest incomplete: ${detail}`);
  }

  const matrixDrift = checkMatrixDrift(path.join(root, "README.md"));
  if (matrixDrift !== null) check(false, matrixDrift);

  for (const issue of checkDependencyPolicy(root)) check(false, `dependency policy: ${issue}`);

  // Lint gate — repo-wide oxlint against the committed quality bar
  // (.oxlintrc.json). Conditional: skipped with a notice when oxlint is not
  // installed so the gate stays runnable on fresh clones without node_modules.
  const oxlintBin = path.join(root, "node_modules", ".bin", "oxlint");
  if (fs.existsSync(oxlintBin)) {
    const lint = spawnSync(oxlintBin, ["--deny-warnings", "--no-error-on-unmatched-pattern"], {
      cwd: root,
      encoding: "utf8",
    });
    if (lint.status === null) {
      check(
        false,
        `lint gate: oxlint could not be executed (${lint.error ? lint.error.message : "unknown spawn error"})`,
      );
    } else if (lint.status === 0) {
      check(true, "lint gate: clean");
    } else {
      const findings = (lint.stdout + lint.stderr)
        .split("\n")
        .filter((l) => /warning|error/.test(l));
      const first = findings[0] ? ` (e.g. ${findings[0].trim()})` : "";
      check(false, `lint gate: oxlint reported ${findings.length} finding(s)${first}`);
    }
  } else {
    console.log("lint gate skipped — oxlint not installed (run: pnpm install)");
  }

  if (failures.length === 0) {
    console.log(`check-suite: OK — ${skillDirs.length} skills, ${checks} checks`);
    process.exit(0);
  }
  for (const f of failures) console.log(`FAIL: ${f}`);
  process.exit(1);
}

let isMain = false;
if (process.argv[1]) {
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const invoked = fs.realpathSync(path.resolve(process.argv[1]));
    isMain = self === invoked;
  } catch {
    // Unresolvable argv[1] (e.g. stdin/eval invocation): never run the gate
    // as a side effect of importing this module.
    isMain = false;
  }
}
if (isMain) main();

export {
  fenceMap,
  countH1,
  parseFrontmatter,
  subsequenceGap,
  githubAnchor,
  containsOutsideFences,
  README_PATH_RE,
  checkCommittedPayloadIndex,
  loadSkillManifest,
};
