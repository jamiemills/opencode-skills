#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
let root = process.cwd();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--root') {
    const next = args[i + 1];
    if (next) root = path.resolve(next);
  }
}

const REQUIRED_SECTIONS = {
  'csm-grill': [
    '## Activation Boundary',
    '## Core Rules',
    '## Grilling State Machine',
    '## Anti-Patterns',
    '## Done Criteria',
  ],
  'csm-plan': [
    '## Activation Boundary',
    '## Core Rules',
    '## Scale To The Ask',
    '## Planning State Machine',
    '## Repository Norms (NORMS.md)',
  ],
  'csm-bdd-tdd': [
    '## Activation Boundary',
    '## Non-Negotiable Rules',
    '## Pipeline',
    '## Anti-Patterns',
    '## Done Criteria',
    '## Repository Norms',
  ],
  'csm-build': [
    '## Activation Boundary',
    '## Core Rules',
    '## Repository Norms (NORMS.md)',
    '## Execution State Machine',
    '## Completion Gate',
  ],
  'csm-review': [
    '## Activation Boundary',
    '## Core Rules',
    '## Review State Machine',
    '## Review Dimensions',
    '## Finding Record',
    '## Report Format',
    '## Anti-Patterns',
    '## Done Criteria',
    '## NORMS.md',
    '## Tmux Session Bootstrap',
  ],
  'csm-scan': [
    '## Tmux Session Bootstrap',
    '## When to use',
    '## Dimensions',
    '## Constraints (non-negotiable)',
    '## Testing',
  ],
  'csm-browse': ['## When to use this skill', '## Verb reference', '## Isolation note'],
  'csm-upload': ['## Requirements', '## Usage'],
};

const STATE_LINES = {
  'csm-grill': 'SAVED -> STOP',
  'csm-plan': 'SAVED -> STOP',
  'csm-bdd-tdd': 'SAVED -> STOP',
  'csm-review': 'SAVED -> STOP',
  'csm-build': 'RECOVER -> VALIDATE -> SELECT -> DISPATCH -> INTEGRATE -> VERIFY -> REVIEW -> REPAIR -> CHECKPOINT',
};

const TMUX_SKILLS = ['csm-plan', 'csm-build', 'csm-bdd-tdd', 'csm-scan', 'csm-review'];
const NORMS_SKILLS = ['csm-plan', 'csm-build', 'csm-bdd-tdd', 'csm-review'];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

function countH1(content) {
  let count = 0;
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^```/.test(line.trimStart())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^# /.test(line)) count += 1;
  }
  return count;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const kv = {};
  for (const line of m[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) kv[pair[1]] = pair[2];
  }
  return kv;
}

const skillDirs = [];
for (const entry of fs.readdirSync(root)) {
  if (!/^csm-[a-z-]+$/.test(entry)) continue;
  const dirPath = path.join(root, entry);
  let isDir = false;
  try {
    isDir = fs.statSync(dirPath).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir && fs.existsSync(path.join(dirPath, 'SKILL.md'))) skillDirs.push(entry);
}
skillDirs.sort();

for (const skill of skillDirs) {
  const file = path.join(root, skill, 'SKILL.md');
  const content = readOrNull(file);
  if (content === null) {
    check(false, `${skill}/SKILL.md unreadable`);
    continue;
  }

  const lineCount = content.split(/\r?\n/).length;
  check(lineCount < 500, `${skill}/SKILL.md size ${lineCount} lines (>= 500)`);

  const fm = parseFrontmatter(content);
  check(fm !== null, `${skill}/SKILL.md frontmatter does not parse`);
  if (fm === null) continue;

  const name = typeof fm.name === 'string' ? fm.name : '';
  check(name !== '', `${skill}/SKILL.md missing frontmatter name`);
  check(NAME_RE.test(name), `${skill}/SKILL.md name "${name}" not ^[a-z0-9]+(-[a-z0-9]+)*$`);
  check(name === skill, `${skill}/SKILL.md name "${name}" != dir "${skill}"`);

  const desc = typeof fm.description === 'string' ? fm.description : '';
  check(desc !== '', `${skill}/SKILL.md missing frontmatter description`);
  check(desc.length <= 1024, `${skill}/SKILL.md description length ${desc.length} (> 1024)`);
  check(/never/i.test(desc), `${skill}/SKILL.md description lacks "never" (Never-X clause)`);

  const h1 = countH1(content);
  check(h1 === 1, `${skill}/SKILL.md has ${h1} H1 titles (want exactly 1)`);

  const required = REQUIRED_SECTIONS[skill];
  if (required) {
    for (const sec of required) {
      check(content.includes(sec), `${skill}/SKILL.md missing section ${sec}`);
    }
  }

  const stateLine = STATE_LINES[skill];
  if (stateLine) {
    check(content.includes(stateLine), `${skill}/SKILL.md missing state line "${stateLine}"`);
  }

  if (TMUX_SKILLS.includes(skill)) {
    check(content.includes('## Tmux Session Bootstrap'), `${skill}/SKILL.md missing ## Tmux Session Bootstrap`);
  } else {
    check(!content.includes('## Tmux Session Bootstrap'), `${skill}/SKILL.md has ## Tmux Session Bootstrap (must not)`);
  }

  if (NORMS_SKILLS.includes(skill)) {
    check(/Generated by csm-scan|## Repository Overview/.test(content), `${skill}/SKILL.md lacks NORMS detection phrase ("Generated by csm-scan" or "## Repository Overview")`);
  }
}

const readmePath = path.join(root, 'README.md');
const readme = readOrNull(readmePath);
check(readme !== null, `README.md not found at ${readmePath}`);
if (readme !== null) {
  const skillSet = new Set(skillDirs);
  const seen = new Set();
  const re = /csm-[a-z-]+\/[A-Za-z0-9_./-]+/g;
  let m;
  while ((m = re.exec(readme)) !== null) {
    const full = m[0];
    const seg = full.split('/')[0];
    if (!skillSet.has(seg)) continue;
    seen.add(seg);
    check(fs.existsSync(path.join(root, full)), `README path not found: ${full}`);
  }
  const missingSkills = [...skillSet].filter((s) => !seen.has(s));
  check(missingSkills.length === 0, `README references ${seen.size}/${skillSet.size} skills; missing ${missingSkills.join(', ')}`);

  const hasTmuxBullet = readme.split(/\r?\n/).some((l) => /tmux/i.test(l) && l.includes('csm-review'));
  check(hasTmuxBullet, 'README tmux bullet does not list the 5 bootstrap skills (csm-review near tmux)');
}

if (failures.length === 0) {
  console.log(`check-suite: OK — ${skillDirs.length} skills, ${checks} checks`);
  process.exit(0);
}
for (const f of failures) console.log(`MISSING: ${f}`);
process.exit(1);
