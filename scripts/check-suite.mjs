#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF, INTERFACES, NEVER_INVOKE, FORMAT_VERSIONS, NORMS_PHRASES } from './lib/contracts.mjs';
import { checkDrift } from './sync-skill-boilerplate.mjs';
import { checkDrift as checkMatrixDrift } from './gen-readme-matrix.mjs';
import {
  FENCE_OPEN_RE,
  splitLines,
  fenceMap,
  validatePlanControl,
  validatePlanJournal,
  validateOrdinalSequencing,
  validateTemplateFormatMarkers,
  validateInterfaceArtifactPatterns,
  pendingTaskInCorpus,
  PENDING_DEBT,
} from './lib/plan-validation.mjs';

const args = process.argv.slice(2);
let root = process.cwd();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--root') {
    const next = args[i + 1];
    if (next) root = path.resolve(next);
  }
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NEVER_CLAUSE_RE = /\bnever\b[^.]{0,120}\b(only|beyond|elsewhere|writes?|runs?|invok\w*|starts?|plans?|planning|implement\w*|fix\w*|patch\w*|review\w*|execut\w*|push\w*|targets?)\b/i;
const NORMS_PHRASE_RE = new RegExp(NORMS_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
const CHAIN_RE = /`([A-Z][A-Z_]*(?:\s*->\s*[A-Z][A-Z_]+)+)`/;
const STATE_HEADING_RE = /^###\s+(\d+)\.\s+(.*)$/;
const STATE_TOKEN_RE = /^[A-Z][A-Z_]*/;

const failures = [];
let checks = 0;

function check(ok, detail) {
  checks += 1;
  if (!ok) failures.push(detail);
}

function readOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Parses a leading frontmatter block and returns { kind, version } from a
// `format: <kind>/<version>` line, or null when absent/malformed.
function formatMarkerOf(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const fm = m[1].match(/^format:\s*([A-Za-z][A-Za-z0-9-]*)\/(\d+)\s*$/m);
  if (!fm) return null;
  return { kind: fm[1], version: parseInt(fm[2], 10) };
}

// Runs a new plan-validation check through the gate. Passes count one check;
// failures on a PENDING_DEBT skill whose owning plan task is still pending are
// reported as expected in-progress findings (still counted, still green) until
// T002/T003/T004 land; anything else is a hard failure.
function runGatedCheck(skill, checkType, findings, label, plansDir) {
  if (findings.length === 0) {
    check(true, `${label} OK`);
    return;
  }
  const debt = PENDING_DEBT.find((d) => d.check === checkType && d.skill === skill);
  if (debt && pendingTaskInCorpus(plansDir, debt.task, skill, debt.plan)) {
    for (const f of findings) {
      check(true, `expected (${debt.task} pending: ${debt.note}): ${f}`);
      console.log(`  note: held (${debt.task} pending): ${f}`);
    }
  } else {
    for (const f of findings) check(false, `${label}: ${f}`);
  }
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
      if (cm && cm[1][0] === char && cm[1].length >= len && cm[2].trim() === '') return body;
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
    if (line.trim() === '') continue;
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
    let val = (pair[2] === undefined ? '' : pair[2]).trim();
    const block = val.match(/^([|>])[+-]?\s*$/);
    if (block) {
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s+/.test(lines[j]))) {
        buf.push(lines[j].trim());
        j += 1;
      }
      kv[key] = block[1] === '>' ? buf.filter((x) => x !== '').join(' ') : buf.join('\n');
      i = j - 1;
      continue;
    }
    if (val.length >= 2 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) {
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
  check(new Set(chain.tokens).size === chain.tokens.length, `${skill}/SKILL.md state chain has duplicate states: ${chain.tokens.join(' -> ')}`);

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
  const terminalExempt = last === 'STOP' && !stopHeaded;
  const requiredTokens = terminalExempt ? chain.tokens.slice(0, -1) : chain.tokens;

  for (const t of requiredTokens) {
    const n = heads.filter((h) => h.token === t).length;
    check(n === 1, n === 0
      ? `${skill}/SKILL.md state ${t} from the chain has no "### <n>. ${t}" heading`
      : `${skill}/SKILL.md state ${t} has ${n} numbered headings (want exactly 1)`);
  }
  const orphans = heads.filter((h) => !chain.tokens.includes(h.token));
  check(orphans.length === 0, `${skill}/SKILL.md numbered state headings not in the chain: ${orphans.map((h) => h.token).join(', ')}`);
  check(heads.length === requiredTokens.length, `${skill}/SKILL.md chain claims ${chain.tokens.length} states but has ${heads.length} numbered state sections (want ${requiredTokens.length})`);
  check(heads.length === requiredTokens.length && heads.every((h, idx) => h.token === requiredTokens[idx]),
    `${skill}/SKILL.md state headings out of chain order (chain: ${requiredTokens.join(' -> ')}; headings: ${heads.map((h) => h.token).join(' -> ')})`);
  check(heads.every((h, idx) => h.num === idx + 1),
    `${skill}/SKILL.md state headings not consecutively numbered from 1 (got ${heads.map((h) => h.num).join(', ')})`);

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
      check(body.some((l) => l.startsWith('Entry:')), `${skill}/SKILL.md state ${h.token} section lacks an "Entry:" line`);
      check(body.some((l) => l.startsWith('Exit:')), `${skill}/SKILL.md state ${h.token} section lacks an "Exit:" line`);
    }
  }
  return { chain, heads, requiredTokens, range };
}

function verifyReviewClaims(skill, lines, inFence, machineResult) {
  const done = sectionRange(lines, inFence, 'Done Criteria');
  if (!done) {
    check(false, `${skill}/SKILL.md missing "## Done Criteria" for numeric claims`);
    return;
  }
  const doneText = [];
  for (let i = done[0]; i < done[1]; i += 1) {
    if (!inFence[i]) doneText.push(lines[i]);
  }
  const joined = doneText.join('\n');

  const statesClaim = joined.match(/\bAll\s+(\d+)\s+states\b/);
  check(statesClaim !== null, `${skill}/SKILL.md Done Criteria lacks an "All N states" claim`);
  if (statesClaim && machineResult) {
    check(Number(statesClaim[1]) === machineResult.heads.length,
      `${skill}/SKILL.md claims ${statesClaim[1]} states; machine has ${machineResult.heads.length} numbered state sections`);
  }

  const dimsClaim = joined.match(/\b(\d+)\s+dimensions\b/);
  check(dimsClaim !== null, `${skill}/SKILL.md Done Criteria lacks an "N dimensions" claim`);

  const dims = sectionRange(lines, inFence, 'Review Dimensions');
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
    check(rowNums.length === Number(dimsClaim[1]),
      `${skill}/SKILL.md claims ${dimsClaim[1]} dimensions; dimension table has ${rowNums.length} rows`);
  }
  check(rowNums.every((n, idx) => n === idx + 1),
    `${skill}/SKILL.md dimension table numbering is not 1..${rowNums.length} (got ${rowNums.join(', ')})`);

  check(groupingLine !== null, `${skill}/SKILL.md Review Dimensions lacks the finder-assignment grouping line`);
  if (groupingLine !== null) {
    const after = groupingLine.slice(groupingLine.indexOf('group for finder assignment'));
    const covered = [];
    let bad = null;
    for (const gm of after.match(/\(([^)]*)\)/g) || []) {
      for (const item of gm.slice(1, -1).split(',')) {
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
    check(sorted.length === want.length && sorted.every((n, idx) => n === want[idx]),
      `${skill}/SKILL.md grouping ranges do not cover 1..${rowNums.length} exactly once (got ${sorted.join(', ')})`);
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
    if (isDir && fs.existsSync(path.join(dirPath, 'SKILL.md'))) dirs.push(entry);
  }
  dirs.sort();
  return dirs;
}

function main() {
  const skillDirs = discoverSkillDirs();
  const plansDir = path.join(root, '.agents', 'plans');

  for (const skill of skillDirs) {
    check(Object.prototype.hasOwnProperty.call(MANIFEST, skill),
      `skill dir ${skill} has no MANIFEST entry in scripts/lib/contracts.mjs (new skills must be registered, not silently skipped)`);
  }
  for (const key of Object.keys(MANIFEST)) {
    check(skillDirs.includes(key), `MANIFEST key "${key}" has no matching skill directory (dead registry key)`);
  }

  for (const skill of skillDirs) {
    const file = path.join(root, skill, 'SKILL.md');
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
    check(fm.errors.length === 0, `${skill}/SKILL.md frontmatter: ${fm.errors.join('; ')}`);
    const kv = fm.kv;

    const name = typeof kv.name === 'string' ? kv.name : '';
    check(name !== '', `${skill}/SKILL.md missing frontmatter name`);
    check(NAME_RE.test(name), `${skill}/SKILL.md name "${name}" not ^[a-z0-9]+(-[a-z0-9]+)*$`);
    check(name === skill, `${skill}/SKILL.md name "${name}" != dir "${skill}"`);

    const desc = typeof kv.description === 'string' ? kv.description : '';
    check(desc !== '', `${skill}/SKILL.md missing frontmatter description`);
    check(desc.length <= 1024, `${skill}/SKILL.md description length ${desc.length} (> 1024)`);
    check(NEVER_CLAUSE_RE.test(desc), `${skill}/SKILL.md description lacks a Never-X clause (e.g. "never plans or implements")`);

    const h1 = countH1(lines, inFence);
    check(h1 === 1, `${skill}/SKILL.md has ${h1} H1 titles outside fences (want exactly 1)`);

    const manifest = MANIFEST[skill];
    if (!manifest) continue;

    const h2 = h2Titles(lines, inFence);
    const h2Set = h2.map((x) => x.title);
    const dupes = h2Set.filter((t, idx) => h2Set.indexOf(t) !== idx);
    check(dupes.length === 0, `${skill}/SKILL.md duplicate H2 sections: ${[...new Set(dupes)].join(', ')}`);

    for (const sec of manifest.sections) {
      check(h2Set.includes(sec), `${skill}/SKILL.md missing section "## ${sec}" (as a real heading outside fences)`);
    }

    const interfaceRange = sectionRange(lines, inFence, 'Interface');
    check(interfaceRange !== null, `${skill}/SKILL.md missing exact "## Interface" section`);
    if (interfaceRange !== null) {
      const interfaceLines = lines.slice(interfaceRange[0], interfaceRange[1]);
      const labels = ['Consumes', 'Produces', 'Hands off', 'Never invokes'];
      for (const label of labels) {
        const matches = interfaceLines.filter((line) => new RegExp(`^- ${label}: `).test(line));
        check(matches.length === 1, `${skill}/SKILL.md Interface label "${label}:" occurs ${matches.length} times (want exactly 1)`);
      }
      const labelLines = interfaceLines.filter((line) => /^- [A-Za-z][A-Za-z ]*: /.test(line));
      check(labelLines.length === 4, `${skill}/SKILL.md Interface has ${labelLines.length} labeled bullets (want exactly 4)`);
      const neverLine = interfaceLines.find((line) => line.startsWith('- Never invokes: '));
      if (neverLine) {
        const names = neverLine.slice('- Never invokes: '.length).split(',').map((nm) => nm.trim()).filter(Boolean);
        const unknown = names.filter((nm) => !Object.prototype.hasOwnProperty.call(INTERFACES, nm));
        check(unknown.length === 0, `${skill}/SKILL.md Interface Never invokes has unknown skill names: ${unknown.join(', ')}`);
        const expected = Object.keys(NEVER_INVOKE[skill] || {}).filter((nm) => NEVER_INVOKE[skill][nm]);
        check(new Set(names).size === names.length && names.length === expected.length && names.every((nm) => expected.includes(nm)),
          `${skill}/SKILL.md Interface Never invokes does not match contracts.mjs row (expected: ${expected.join(', ')})`);
      }
      const artifactFailures = validateInterfaceArtifactPatterns(skill, interfaceLines.join('\n'));
      if (artifactFailures.length === 0) {
        check(true, `${skill}/SKILL.md Interface artifact patterns OK`);
      } else {
        for (const f of artifactFailures) check(false, `${skill}/SKILL.md ${f}`);
      }
    }

    if (manifest.tmux) {
      check(h2Set.includes('Tmux Session Bootstrap'), `${skill}/SKILL.md missing section "## Tmux Session Bootstrap"`);
    } else {
      check(!h2Set.includes('Tmux Session Bootstrap'), `${skill}/SKILL.md has "## Tmux Session Bootstrap" (must not)`);
    }

    if (manifest.norms) {
      const phraseHit = lines.some((l, idx) => !inFence[idx] && NORMS_PHRASE_RE.test(l));
      check(phraseHit, `${skill}/SKILL.md lacks NORMS detection phrase ("Generated by csm-scan" or "## Repository Overview") outside fences`);
    }

    if (manifest.machine) {
      const machineResult = verifyMachine(skill, lines, inFence, manifest.machine);
      if (skill === 'csm-review' && machineResult) verifyReviewClaims(skill, lines, inFence, machineResult);
    }

    const ordinalFailures = validateOrdinalSequencing(content);
    runGatedCheck(skill, 'ordinal', ordinalFailures, `${skill}/SKILL.md state-section ordinal sequencing`, plansDir);
  }

  for (const contract of CONTRACTS) {
    const srcContent = readOrNull(path.join(root, contract.source.skill, 'SKILL.md'));
    check(srcContent !== null && srcContent.includes(contract.source.needle),
      `contract ${contract.id}: producer ${contract.source.skill}/SKILL.md lacks "${contract.source.needle}"`);
    for (const consumer of contract.consumers) {
      const consContent = readOrNull(path.join(root, consumer.skill, 'SKILL.md'));
      if (contract.rule === 'prefix') {
        check(contract.source.needle.startsWith(consumer.needle),
          `contract ${contract.id}: consumer needle "${consumer.needle}" is not a prefix of producer needle "${contract.source.needle}"`);
      } else {
        check(consumer.needle === contract.source.needle,
          `contract ${contract.id}: consumer needle "${consumer.needle}" != producer needle "${contract.source.needle}"`);
      }
      check(consContent !== null && consContent.includes(consumer.needle),
        `contract ${contract.id}: consumer ${consumer.skill}/SKILL.md lacks "${consumer.needle}"`);
    }
  }

  const uploadSkillFile = path.join(root, UPLOAD_SCRIPT_REF.skill, 'SKILL.md');
  const uploadContent = readOrNull(uploadSkillFile);
  const refs = uploadContent === null ? [] : [...new Set(uploadContent.match(UPLOAD_SCRIPT_REF.pattern) || [])];
  check(refs.length > 0, `${UPLOAD_SCRIPT_REF.skill}/SKILL.md references no csm-*/scripts/*.mjs script paths`);
  for (const ref of refs) {
    check(fs.existsSync(path.join(root, ref)), `${UPLOAD_SCRIPT_REF.skill}/SKILL.md references ${ref} which does not exist`);
  }

  const planSkill = readOrNull(path.join(root, 'csm-plan', 'SKILL.md'));
  let planTemplate = [];
  if (planSkill !== null) {
    const pl = splitLines(planSkill);
    const pf = fenceMap(pl);
    const range = sectionRange(pl, pf, 'Required Plan Document');
    const body = range ? fencedBlockAfter(pl, pf, range[0]) : null;
    if (body !== null) planTemplate = body.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());
  }
  check(planTemplate.length > 0, 'could not extract the Required Plan Document template from csm-plan/SKILL.md');

  const grillSkill = readOrNull(path.join(root, 'csm-grill', 'SKILL.md'));
  let approachTemplate = [];
  if (grillSkill !== null) {
    const gl = splitLines(grillSkill);
    const gf = fenceMap(gl);
    const grange = sectionRange(gl, gf, 'Required Approach Document');
    const gbody = grange ? fencedBlockAfter(gl, gf, grange[0]) : null;
    if (gbody !== null) approachTemplate = gbody.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());
  }
  check(approachTemplate.length > 0, 'could not extract the Required Approach Document template from csm-grill/SKILL.md');

  const reviewSkill = readOrNull(path.join(root, 'csm-review', 'SKILL.md'));
  let reviewTemplateH2 = [];
  let reviewH1Prefix = null;
  if (reviewSkill !== null) {
    const rl = splitLines(reviewSkill);
    const rf = fenceMap(rl);
    const range = sectionRange(rl, rf, 'Report Format');
    const body = range ? fencedBlockAfter(rl, rf, range[0]) : null;
    if (body !== null) {
      const h1Line = body.find((l) => /^#\s/.test(l));
      if (h1Line) reviewH1Prefix = `${h1Line.replace(/^#\s+/, '').split('—')[0].trim()} —`;
      reviewTemplateH2 = body.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim().replace(/\s+\(.*$/, ''));
    }
  }
  check(reviewTemplateH2.length > 0, 'could not extract the Report Format template from csm-review/SKILL.md');
  check(reviewH1Prefix !== null, 'Report Format template has no H1 line — review-corpus H1 check would silently skip');

  // Template format-marker validation (F-050): the first line inside each
  // producer template fence must be `format: <skill>/<n>`. Currently held as
  // expected findings by PENDING_DEBT until T002 (csm-plan) and T004
  // (csm-grill/csm-review) add the markers.
  runGatedCheck('csm-plan', 'template-format-marker',
    validateTemplateFormatMarkers(planSkill ?? '', 'csm-plan', 'Required Plan Document'),
    'csm-plan/SKILL.md template format marker', plansDir);
  runGatedCheck('csm-grill', 'template-format-marker',
    validateTemplateFormatMarkers(grillSkill ?? '', 'csm-grill', 'Required Approach Document'),
    'csm-grill/SKILL.md template format marker', plansDir);
  runGatedCheck('csm-review', 'template-format-marker',
    validateTemplateFormatMarkers(reviewSkill ?? '', 'csm-review', 'Report Format'),
    'csm-review/SKILL.md template format marker', plansDir);

  let planFiles = [];
  try {
    planFiles = fs.readdirSync(plansDir).filter((f) => f.endsWith('-csm.md')).toSorted();
  } catch {
    planFiles = [];
  }
  check(planFiles.length > 0, `no *-csm.md plan corpus found under ${path.join('.agents', 'plans')}`);
  for (const f of planFiles) {
    const content = readOrNull(path.join(plansDir, f));
    if (content === null) {
      check(false, `plan corpus .agents/plans/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(marker !== null && marker.kind === 'csm-plan' && marker.version >= 1 && marker.version <= (FORMAT_VERSIONS['csm-plan'] ?? 0),
      `plan corpus .agents/plans/${f} missing/unknown format marker (want frontmatter "format: csm-plan/<n>")`);
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, planTemplate);
    check(gap === null, `plan corpus .agents/plans/${f}: missing/out-of-order required section "## ${gap}"`);

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
  }

  const reviewsDir = path.join(root, '.agents', 'reviews');
  let reviewFiles = [];
  try {
    reviewFiles = fs.readdirSync(reviewsDir).filter((f) => f.endsWith('-review.md')).toSorted();
  } catch {
    reviewFiles = [];
  }
  check(reviewFiles.length > 0, `no *-review.md review corpus found under ${path.join('.agents', 'reviews')}`);
  for (const f of reviewFiles) {
    const content = readOrNull(path.join(reviewsDir, f));
    if (content === null) {
      check(false, `review corpus .agents/reviews/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(marker !== null && marker.kind === 'csm-review' && marker.version >= 1 && marker.version <= (FORMAT_VERSIONS['csm-review'] ?? 0),
      `review corpus .agents/reviews/${f} missing/unknown format marker (want frontmatter "format: csm-review/<n>")`);
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const h1s = lines.filter((l, idx) => !inFence[idx] && /^#\s/.test(l));
    check(h1s.length === 1, `review corpus .agents/reviews/${f} has ${h1s.length} H1 titles (want 1)`);
    if (reviewH1Prefix !== null && h1s.length === 1) {
      check(h1s[0].replace(/^#\s+/, '').startsWith(reviewH1Prefix),
        `review corpus .agents/reviews/${f} H1 does not start with "${reviewH1Prefix}"`);
    }
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, reviewTemplateH2);
    check(gap === null, `review corpus .agents/reviews/${f}: missing/out-of-order Report Format section "## ${gap}"`);
  }

  const approachesDir = path.join(root, '.agents', 'approaches');
  let approachFiles = [];
  try {
    approachFiles = fs.readdirSync(approachesDir).filter((f) => f.endsWith('-approach.md')).toSorted();
  } catch {
    approachFiles = [];
  }
  check(approachFiles.length > 0, `no *-approach.md approach corpus found under ${path.join('.agents', 'approaches')}`);
  for (const f of approachFiles) {
    const content = readOrNull(path.join(approachesDir, f));
    if (content === null) {
      check(false, `approach corpus .agents/approaches/${f} unreadable`);
      continue;
    }
    const marker = formatMarkerOf(content);
    check(marker !== null && marker.kind === 'csm-grill' && marker.version >= 1 && marker.version <= (FORMAT_VERSIONS['csm-grill'] ?? 0),
      `approach corpus .agents/approaches/${f} missing/unknown format marker (want frontmatter "format: csm-grill/<n>")`);
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    const titles = h2Titles(lines, inFence).map((x) => x.title);
    const gap = subsequenceGap(titles, approachTemplate);
    check(gap === null, `approach corpus .agents/approaches/${f}: missing/out-of-order required section "## ${gap}"`);
  }

  const readmePath = path.join(root, 'README.md');
  const readme = readOrNull(readmePath);
  check(readme !== null, `README.md not found at ${readmePath}`);
  if (readme !== null) {
    const skillSet = new Set(skillDirs);
    const seen = new Set();
    for (const line of readme.split(/\r?\n/)) {
      const re = /csm-[a-z-]+\/[A-Za-z0-9_./-]+/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const full = m[0];
        const seg = full.split('/')[0];
        check(fs.existsSync(path.join(root, full)), `README path not found: ${full}`);
        if (skillSet.has(seg)) seen.add(seg);
      }
    }
    const missingSkills = [...skillSet].filter((s) => !seen.has(s));
    check(missingSkills.length === 0, `README references ${seen.size}/${skillSet.size} skills; missing ${missingSkills.join(', ')}`);

    const tmuxSkills = Object.keys(MANIFEST).filter((s) => MANIFEST[s].tmux);
    const hasTmuxBullet = readme.split(/\r?\n/).some((l) => /tmux/i.test(l) && tmuxSkills.every((s) => l.includes(s)));
    check(hasTmuxBullet, `README tmux bullet does not list the ${tmuxSkills.length} bootstrap skills (${tmuxSkills.join(', ')})`);

    const stack = [];
    for (const line of readme.split(/\r?\n/)) {
      const m = line.match(/^((?:[│ ]{4})*)[├└]──\s+(\S+)/);
      if (!m) continue;
      const name = m[2];
      if (name === '.') continue;
      const depth = m[1].length / 4;
      const clean = name.replace(/\/+$/, '');
      stack[depth] = clean;
      const rel = stack.slice(0, depth + 1).join('/');
      const abs = path.join(root, rel);
      if (name.endsWith('/')) {
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
    licenseOk = fs.statSync(path.join(root, 'LICENSE')).isFile();
  } catch {
    licenseOk = false;
  }
  check(licenseOk, 'LICENSE file not found at repo root');

  const boilerplateDrift = checkDrift(root);
  for (const d of boilerplateDrift) {
    check(false, `${d.skill}/SKILL.md "${d.section}": ${d.message}`);
  }

  const matrixDrift = checkMatrixDrift(path.join(root, 'README.md'));
  if (matrixDrift !== null) check(false, matrixDrift);

  // Lint gate — repo-wide oxlint against the committed quality bar
  // (.oxlintrc.json). Conditional: skipped with a notice when oxlint is not
  // installed so the gate stays runnable on fresh clones without node_modules.
  const oxlintBin = path.join(root, 'node_modules', '.bin', 'oxlint');
  if (fs.existsSync(oxlintBin)) {
    const lint = spawnSync(oxlintBin, ['--deny-warnings', '--no-error-on-unmatched-pattern'], { cwd: root, encoding: 'utf8' });
    if (lint.status === null) {
      check(false, `lint gate: oxlint could not be executed (${lint.error ? lint.error.message : 'unknown spawn error'})`);
    } else if (lint.status === 0) {
      check(true, 'lint gate: clean');
    } else {
      const findings = (lint.stdout + lint.stderr).split('\n').filter((l) => /warning|error/.test(l));
      const first = findings[0] ? ` (e.g. ${findings[0].trim()})` : '';
      check(false, `lint gate: oxlint reported ${findings.length} finding(s)${first}`);
    }
  } else {
    console.log('lint gate skipped — oxlint not installed (run: pnpm install)');
  }

  if (failures.length === 0) {
    console.log(`check-suite: OK — ${skillDirs.length} skills, ${checks} checks`);
    process.exit(0);
  }
  for (const f of failures) console.log(`MISSING: ${f}`);
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

export { fenceMap, countH1, parseFrontmatter, subsequenceGap };
