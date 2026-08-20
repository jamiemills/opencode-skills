#!/usr/bin/env node
'use strict';

// Plan acceptance-signal lint (journal-learnings T005 / consolidated J5).
//
// Standalone: `node scripts/check-plan-signals.mjs <dir>` reads every
// `*-csm.md` plan under <dir>, linting the bash acceptance signals of the
// NON-COMPLETE plans (Control Status `ready` or `in_progress`; COMPLETE plans
// encode history and are exempt). For each signal it checks:
//   - `bash -n` syntax (spawned on a temp file — never eval'd),
//   - `<...>` placeholder tokens,
//   - `; test $? -eq N` immediately after a command under `set -e`
//     (the abort-before-test footgun; the allowed form is `cmd ... || test $? -eq N`),
//   - `grep -q "$m"` where `$m` is bound to a dash-leading option token
//     (option-injection; the safe form is `grep -q -e "$m"`).
//
// Also importable by check-suite.mjs (the plans-corpus sub-check wiring) via
// `lintPlanSignals`. Reuses the canonical splitLines/fenceMap/parsePlanControl
// from scripts/lib/plan-validation.mjs rather than reimplementing markdown
// parsing. Kept standalone (no check-suite internals).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FENCE_OPEN_RE, splitLines, fenceMap, parsePlanControl } from './lib/plan-validation.mjs';

// Status values whose acceptance signals encode future work and are therefore
// linted. Everything else (complete, paused, blocked, absent) is exempt.
const LINTABLE_STATUSES = ['ready', 'in_progress'];

// `<...>` placeholder token: an angle-bracketed alphanumeric word. Deliberately
// not matched by bare `<`/`>` (redirections, `2>&1`, `<(cmd)` process
// substitution) — those have no closing `>` after a word.
const PLACEHOLDER_RE = /<[A-Za-z][A-Za-z0-9_-]*>/;

// `set -e` in any combined form (set -e, -eu, -euo pipefail, -xe ...).
const SETE_RE = /\bset\s+-\w*e\w*/;

// `; test $? -eq N` — the forbidden form under set -e. The allowed form
// `|| test $? -eq N` uses `||`, not `;`, so it never matches.
const SEMICOLON_TEST_QEQ_RE = /;\s*test\s+\$[?]\s+-eq\b/;

// `grep ... -q ... "$var"` (no `-e` explicit-pattern flag in the cluster).
const GREP_Q_VAR_RE = /grep\s+(-[A-Za-z]*q[A-Za-z]*\s+)?"\$([A-Za-z_][A-Za-z0-9_]*)"/g;
const ASSIGN_RE = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const FOR_IN_RE = /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s*;\s*do\b/;

function unquote(token) {
  let t = token.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    t = t.slice(1, -1);
  }
  return t;
}

// Splits a `for x in <list>` list into unquoted tokens.
function listTokens(list) {
  const out = [];
  const re = /(?:(["'])(.*?)\1|(\S+))/gs;
  let m;
  while ((m = re.exec(list)) !== null) out.push(m[2] !== undefined ? m[2] : m[3]);
  return out;
}

// Names of variables statically bound to a dash-leading literal (assignment
// `m=--...` or a `for m in ...` list containing a dash-leading element). These
// are the option-injection vectors a `grep -q "$m"` would trip on.
function collectDashBoundVars(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const am = line.match(ASSIGN_RE);
    if (am && unquote(am[2]).startsWith('-')) out.add(am[1]);
    const fm = line.match(FOR_IN_RE);
    if (fm && listTokens(fm[2]).some((t) => t.startsWith('-'))) out.add(fm[1]);
  }
  return out;
}

// Runs `bash -n` over the signal text written to a temp file. Returns the
// first stderr line(s) on a syntax error, or null when the syntax is clean.
function bashSyntaxError(text) {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-signal-'));
    const file = path.join(dir, 'signal.sh');
    fs.writeFileSync(file, `${text}\n`);
    const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    if (r.status === 0) return null;
    const err = (r.stderr || r.stdout || 'bash -n reported an error').trim().split('\n').filter(Boolean).slice(0, 3).join('; ');
    return err;
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Lints one signal string. Returns an array of { kind, message }.
function lintSignalText(text) {
  const issues = [];
  const syntaxErr = bashSyntaxError(text);
  if (syntaxErr !== null) issues.push({ kind: 'syntax', message: `bash -n failed: ${syntaxErr}` });
  const ph = text.match(PLACEHOLDER_RE);
  if (ph) issues.push({ kind: 'placeholder', message: `placeholder token ${ph[0]} (no "<...>" tokens allowed in acceptance signals)` });
  if (SETE_RE.test(text) && SEMICOLON_TEST_QEQ_RE.test(text)) {
    issues.push({ kind: 'semicolon-test', message: '"; test $? -eq N" immediately after a command under set -e (use "cmd ... || test $? -eq N")' });
  }
  const dashVars = collectDashBoundVars(text);
  for (const m of text.matchAll(GREP_Q_VAR_RE)) {
    if (m[1] !== undefined && m[1].includes('e')) continue; // `grep -qe "$m"` is already safe
    if (dashVars.has(m[2])) {
      issues.push({ kind: 'grep-option-injection', message: `grep -q "$${m[2]}" over a dash-leading option token (use "grep -q -e "$${m[2]}"")` });
    }
  }
  return issues;
}

// Extracts the acceptance signals of a plan's content: inline backtick spans on
// `Acceptance signal:` lines plus any fenced block under such a line (fence
// aware). Returns [{ line, text }].
function extractSignals(lines, inFence) {
  const signals = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    // Only the `- Acceptance signal:` attribute bullet — never prose that
    // merely mentions the phrase (e.g. an Actions bullet describing this lint).
    if (!/^\s*-\s+Acceptance signal:/.test(lines[i])) continue;
    for (const m of lines[i].matchAll(/`([^`]+)`/g)) {
      signals.push({ line: i + 1, text: m[1].trim() });
    }
    let j = i + 1;
    while (j < lines.length) {
      if (/^\s*\d+\.\s+\[/.test(lines[j])) break; // next task block
      if (/^#{1,3}\s/.test(lines[j])) break; // next heading
      if (/^\s*-\s+/.test(lines[j])) break; // next attribute bullet
      const om = lines[j].match(FENCE_OPEN_RE);
      if (om && inFence[j] && !inFence[j - 1]) {
        const char = om[1][0];
        const len = om[1].length;
        const body = [];
        let k = j + 1;
        let closed = false;
        while (k < lines.length) {
          const cm = lines[k].match(FENCE_OPEN_RE);
          if (cm && cm[1][0] === char && cm[1].length >= len && cm[2].trim() === '') {
            closed = true;
            break;
          }
          body.push(lines[k]);
          k += 1;
        }
        signals.push({ line: j + 1, text: body.join('\n').trim() });
        j = closed ? k + 1 : lines.length;
        continue;
      }
      j += 1;
    }
  }
  return signals.filter((s) => s.text.length > 0);
}

// Lints one plan file's content. Returns
// { status, signals, issues } where status is the parsed Control Status (or
// null), signals is the number of extracted signals, and issues is an array of
// { line, kind, message, signal } (empty when clean).
export function lintPlanSignals(planFile, content) {
  const control = parsePlanControl(content);
  const status = control !== null ? control.status : null;
  const lines = splitLines(content);
  const inFence = fenceMap(lines);
  const signals = extractSignals(lines, inFence);
  const issues = [];
  for (const sig of signals) {
    for (const iss of lintSignalText(sig.text)) {
      issues.push({ line: sig.line, kind: iss.kind, message: iss.message, signal: sig.text });
    }
  }
  return { status, signals: signals.length, issues };
}

function main() {
  const dirArg = process.argv[2];
  if (!dirArg) {
    console.error('usage: node scripts/check-plan-signals.mjs <dir>');
    process.exit(2);
  }
  const dir = path.resolve(dirArg);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('-csm.md')).toSorted();
  } catch {
    console.error(`cannot read plan dir ${dir}`);
    process.exit(2);
  }
  let pass = 0;
  let fail = 0;
  let exempt = 0;
  let totalSignals = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const { status, signals, issues } = lintPlanSignals(f, content);
    totalSignals += signals;
    if (status === null || !LINTABLE_STATUSES.includes(status)) {
      exempt += 1;
      continue;
    }
    if (issues.length === 0) {
      pass += 1;
      console.log(`PASS ${f} (${signals} signal${signals === 1 ? '' : 's'})`);
    } else {
      fail += 1;
      console.log(`FAIL ${f}:`);
      for (const iss of issues) {
        const preview = iss.signal.length > 72 ? `${iss.signal.slice(0, 72)}...` : iss.signal;
        console.log(`  line ${iss.line}: ${iss.message}  in signal: ${preview}`);
      }
    }
  }
  console.log(`plan-signals: ${pass} passed, ${fail} failed, ${exempt} exempt (COMPLETE/other), ${totalSignals} signals linted`);
  process.exit(fail > 0 ? 1 : 0);
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

export { extractSignals, lintSignalText };
