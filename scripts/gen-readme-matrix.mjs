#!/usr/bin/env node
'use strict';

// Generates the README composition matrix into the marked region from
// scripts/lib/contracts.mjs INTERFACES data. check-suite asserts the region
// matches this generator's output (drift = fail). Re-run after editing
// INTERFACES: node scripts/gen-readme-matrix.mjs --write

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { INTERFACES } from './lib/contracts.mjs';

const START = '<!-- csm-matrix:start -->';
const END = '<!-- csm-matrix:end -->';

const cell = (v) => {
  const val = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return val.replace(/\|/g, '\\|').replace(/\n/g, ' ');
};

function renderMatrix() {
  const lines = [
    '## Composition matrix',
    '',
    'How each skill composes — standalone entry conditions, what it consumes and produces, and how work hands off. Generated from `scripts/lib/contracts.mjs`; regenerate with `node scripts/gen-readme-matrix.mjs --write`.',
    '',
    '| Skill | Standalone entry | Consumes | Produces | Hands off |',
    '|---|---|---|---|---|',
  ];
  for (const [skill, iface] of Object.entries(INTERFACES)) {
    lines.push(`| \`${skill}\` | ${cell(iface.entryConditions)} | ${cell(iface.consumes)} | ${cell(iface.produces)} | ${cell(iface.handoff)} |`);
  }
  return lines.join('\n');
}

export function renderRegion() {
  return `${START}\n${renderMatrix()}\n${END}`;
}

export function checkDrift(readmePath) {
  const content = fs.readFileSync(readmePath, 'utf8');
  const expected = renderRegion();
  const m = content.match(new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)\\n${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (!m) return 'composition-matrix region missing from README';
  if (`${START}\n${m[1]}\n${END}` !== expected) return 'composition-matrix region drifted from contracts.mjs (run: node scripts/gen-readme-matrix.mjs --write)';
  return null;
}

function writeRegion(readmePath) {
  const content = fs.readFileSync(readmePath, 'utf8');
  const re = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n[\\s\\S]*?\\n${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!re.test(content)) {
    // First insertion: after the Skills table section, before Requirements
    const anchor = '## Requirements';
    if (!content.includes(anchor)) throw new Error('README ## Requirements anchor not found');
    return content.replace(anchor, `${renderRegion()}\n\n${anchor}`, 1);
  }
  return content.replace(re, renderRegion());
}

let isMain = false;
try {
  isMain = process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
} catch {
  isMain = false;
}

if (isMain) {
  const readme = path.resolve(process.cwd(), 'README.md');
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  if (mode === 'write') {
    fs.writeFileSync(readme, writeRegion(readme), 'utf8');
    console.log('gen-readme-matrix: region written');
    process.exit(0);
  }
  const drift = checkDrift(readme);
  if (drift === null) {
    console.log('gen-readme-matrix: OK — region matches contracts');
    process.exit(0);
  }
  console.error(`gen-readme-matrix: ${drift}`);
  process.exit(1);
}
