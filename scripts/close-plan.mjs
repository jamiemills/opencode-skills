#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => a !== '--dry-run');
if (positional.length !== 2) {
  console.error('usage: node scripts/close-plan.mjs [--dry-run] <plan.md> <replacement.md>');
  process.exit(1);
}

const planFile = path.resolve(positional[0]);
const replacement = path.resolve(positional[1]);
if (!fs.existsSync(planFile)) {
  console.error(`plan not found: ${planFile}`);
  process.exit(1);
}
if (!fs.existsSync(replacement)) {
  console.error(`replacement not found: ${replacement}`);
  process.exit(1);
}

const planName = path.basename(planFile);
const replName = path.basename(replacement);
const replStem = replName.replace(/\.md$/, '');

function findRoot(dir) {
  let cur = dir;
  for (;;) {
    if (fs.existsSync(path.join(cur, '.agents', 'README.md'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return dir;
    cur = parent;
  }
}

const root = findRoot(path.dirname(planFile));
const readmeFile = path.join(root, '.agents', 'README.md');

function nowStamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function diffLines(aText, bText) {
  const a = aText.split('\n');
  const b = bText.split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+ ${b[j]}`);
    j += 1;
  }
  return out;
}

function controlCycle(lines) {
  let inControl = false;
  for (const l of lines) {
    if (/^## Control\s*$/.test(l)) {
      inControl = true;
      continue;
    }
    if (inControl && /^## \S/.test(l)) inControl = false;
    if (!inControl) continue;
    const m = l.match(/^- Cycle:\s*(\d+)/);
    if (m) return m[1];
  }
  return '0';
}

function rewriteControl(lines, stamp) {
  let inControl = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^## Control\s*$/.test(lines[i])) {
      inControl = true;
      continue;
    }
    if (inControl && /^## \S/.test(lines[i])) inControl = false;
    if (!inControl) continue;
    if (lines[i].startsWith('- Status: ')) {
      lines[i] = '- Status: complete';
    } else if (lines[i].startsWith('- Current CSM state: ')) {
      lines[i] = '- Current CSM state: NOT_STARTED';
    } else if (lines[i].startsWith('- Next transition: ')) {
      lines[i] = '- Next transition: none; closed as superseded — active tasks completed by sibling plan';
    } else if (lines[i].startsWith('- Active tasks: ')) {
      lines[i] = '- Active tasks: none';
    } else if (lines[i].startsWith('- Blockers: ')) {
      lines[i] = '- Blockers: none; closure is intentional and not an implementation result';
    } else if (lines[i].startsWith('- Last checkpoint: ')) {
      lines[i] = `- Last checkpoint: ${stamp} closed as superseded by ${replStem} (see Closure block)`;
    }
  }
}

function taskIdAfter(lines, fromIdx) {
  for (let i = fromIdx + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i]) || /^(\d+)\.\s+\[/.test(lines[i])) break;
    const m = lines[i].match(/^\s*-\s*Task ID:\s*(\S+)/);
    if (m) return m[1];
  }
  return null;
}

function rewriteTasks(lines) {
  const ids = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*\d+\.)\s+\[(pending|in_progress)\]\s*(.*)$/);
    if (!m) continue;
    const id = taskIdAfter(lines, i);
    const label = id || m[3].slice(0, 40);
    ids.push(label);
    lines[i] = `${m[1]} [blocked] ${m[3]} (completed by ${replStem} — superseded)`;
  }
  return ids;
}

function insertClosure(lines, disposition) {
  const goalIdx = lines.findIndex((l) => /^## Goal\s*$/.test(l));
  const block = [
    '## Closure',
    `- Closure status: closed as superseded; active tasks completed by ${replStem}; no acceptance criteria are claimed by this plan.`,
    `- Replacement plan: ${replacement}.`,
    disposition,
    '',
  ];
  lines.splice(goalIdx === -1 ? lines.length : goalIdx, 0, ...block);
}

function appendJournalRow(lines, ids, stamp) {
  const sectionStart = lines.findIndex((l) => /^## Progress Journal\s*$/.test(l));
  if (sectionStart === -1) return;
  let end = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^## \S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  for (let i = end - 1; i > sectionStart; i -= 1) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
  }
  const cycle = controlCycle(lines);
  const row = `| ${stamp} | ${cycle} | SAVED -> closed (superseded by ${replStem}) | ${ids.join(', ')} | closed as superseded — active tasks completed by sibling plan ${replStem}; no acceptance criteria claimed by this plan | closed |`;
  lines.splice(insertAt, 0, row);
}

function planGoal(planContent) {
  const m = planContent.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function updatedReadme(readmeContent, goalText, stamp) {
  const lines = readmeContent === '' ? [] : readmeContent.split('\n');
  const lineRe = new RegExp(`^\\s*- \`${escapeRe(planName)}\``);
  const statusRe = /status: [a-z_]+/;
  const annotation = `status: complete (closed as superseded; superseded-by \`${replName}\`; active tasks completed by sibling plan ${replStem})`;
  let inPlans = false;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^## plans\/\s*$/.test(lines[i])) inPlans = true;
    else if (/^## \S/.test(lines[i])) inPlans = false;
    if (!inPlans || !lineRe.test(lines[i])) continue;
    lines[i] = lines[i].replace(statusRe, annotation);
    changed = true;
  }
  if (!changed) {
    const sectionIdx = lines.findIndex((l) => /^## plans\/\s*$/.test(l));
    const insertAt = sectionIdx === -1 ? lines.length : sectionIdx + 1;
    const newLine = `- \`${planName}\` — ${stamp.slice(0, 10)} — ${goalText || planName} — ${annotation}`;
    lines.splice(insertAt, 0, newLine);
  }
  return lines.join('\n');
}

function runCheckSuite() {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, 'check-suite.mjs'), '--root', root],
    { encoding: 'utf8', timeout: 120000 },
  );
}

function main() {
  const planContent = fs.readFileSync(planFile, 'utf8');
  if (`\n${planContent}`.includes('\n## Closure\n')) {
    console.log(`plan already closed: ${planFile}`);
    process.exit(0);
  }
  const stamp = nowStamp();
  const lines = planContent.split('\n');
  rewriteControl(lines, stamp);
  const ids = rewriteTasks(lines);
  const disposition = `- Task disposition: ${ids.length > 0 ? ids.join(', ') : 'no active tasks'} superseded — active tasks completed by sibling plan ${replStem}; blocked/DEFERRED records retained as blocked.`;
  insertClosure(lines, disposition);
  appendJournalRow(lines, ids, stamp);
  const newPlan = lines.join('\n');

  const readmeExists = fs.existsSync(readmeFile);
  const readmeContent = readmeExists ? fs.readFileSync(readmeFile, 'utf8') : '';
  const newReadme = updatedReadme(readmeContent, planGoal(planContent), stamp);

  console.log(`close-plan: ${dryRun ? 'DRY-RUN (no writes)' : 'APPLY'}`);
  console.log(`  plan:        ${planFile}`);
  console.log(`  replacement: ${replacement}`);
  console.log(`  corpus root: ${root}`);
  console.log(`--- ${planFile}`);
  for (const l of diffLines(planContent, newPlan)) console.log(l);
  console.log(`--- ${readmeFile}`);
  for (const l of (readmeExists ? diffLines(readmeContent, newReadme) : newReadme.split('\n').map((x) => `+ ${x}`))) console.log(l);

  if (dryRun) {
    const gate = runCheckSuite();
    const ok = gate.status === 0;
    console.log(`--- check-suite (dry-run probe, read-only): ${ok ? 'OK' : 'FAILED'} on root ${root}`);
    if (!ok) {
      console.log('    check-suite needs a complete corpus at --root (csm-* skills/, README.md, LICENSE, .agents/{plans,reviews,approaches,research}); the diff above is the closure preview');
      for (const l of (gate.stderr + '\n' + gate.stdout).split('\n').filter(Boolean)) console.log(`    | ${l}`);
    }
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(readmeFile), { recursive: true });
  fs.writeFileSync(planFile, newPlan);
  fs.writeFileSync(readmeFile, newReadme);
  console.log(`written: ${planFile}`);
  console.log(`written: ${readmeFile}`);

  const gate = runCheckSuite();
  const ok = gate.status === 0;
  console.log(`--- check-suite re-run: ${ok ? 'OK' : 'FAILED'} on root ${root}`);
  if (gate.stdout.trim()) console.log(gate.stdout.trim());
  if (gate.stderr.trim()) console.log(gate.stderr.trim());
  if (!ok) console.error('check-suite FAILED after closure — see above');
  process.exit(ok ? 0 : 1);
}

main();
