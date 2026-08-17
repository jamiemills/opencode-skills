#!/usr/bin/env node
'use strict';
// Sync shared SKILL.md boilerplate sections from scripts/lib/boilerplate.mjs.
// --check: report drift, exit 1 when any synced section differs (hook-safe).
// --write: regenerate every synced section in place.
// Heading-bounded whole-section sync — no markers inside SKILL.md.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SYNC_SECTIONS } from './lib/boilerplate.mjs';

function splitLines(content) {
  return content.split(/\r?\n/);
}

// Fence-aware map: true when the line is inside a code fence. Tracks opening
// fence run length (``` or ~~~) and closes only on an equal-or-longer run.
function fenceMap(lines) {
  const inFence = new Array(lines.length).fill(false);
  let openRun = 0;
  let fenceChar = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (openRun > 0) {
      if (m && m[1][0] === fenceChar && m[1].length >= openRun) {
        openRun = 0;
        fenceChar = null;
      } else {
        inFence[i] = true;
      }
    } else if (m) {
      fenceChar = m[1][0];
      openRun = m[1].length;
      // The opening line itself is the boundary; following lines are fenced.
    }
  }
  return inFence;
}

// Locate a heading ("## Title" or "### Title") outside fences. Returns
// { headingLine, level, bodyStart, bodyEnd } where the body runs from the
// line after the heading to the line before the next heading of level <=
// this heading's level (blank line included), or EOF.
function findSection(lines, inFence, title, level) {
  const re = new RegExp(`^#{${level}}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inFence[i] && re.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && h[1].length <= level) { end = i; break; }
  }
  return { headingLine: start, level, bodyStart: start + 1, bodyEnd: end };
}

function extractBody(lines, section) {
  return lines.slice(section.bodyStart, section.bodyEnd).join('\n');
}

// Returns an array of drift records: { skill, section, message }.
export function checkDrift(root = process.cwd()) {
  const drift = [];
  for (const [skill, sections] of Object.entries(SYNC_SECTIONS)) {
    const file = path.join(root, skill, 'SKILL.md');
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      drift.push({ skill, section: '*', message: 'SKILL.md unreadable' });
      continue;
    }
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    for (const [title, def] of Object.entries(sections)) {
      const located = findSection(lines, inFence, title, def.level);
      if (!located) {
        drift.push({ skill, section: title, message: 'section heading not found' });
        continue;
      }
      const current = extractBody(lines, located);
      const expected = def.render();
      if (current !== expected) {
        drift.push({ skill, section: title, message: 'boilerplate drifted from scripts/lib/boilerplate.mjs (run: node scripts/sync-skill-boilerplate.mjs --write)' });
      }
    }
  }
  return drift;
}

function syncWrite(root = process.cwd()) {
  let changed = 0;
  for (const [skill, sections] of Object.entries(SYNC_SECTIONS)) {
    const file = path.join(root, skill, 'SKILL.md');
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = splitLines(content);
    const inFence = fenceMap(lines);
    let mutated = false;
    for (const [title, def] of Object.entries(sections)) {
      const located = findSection(lines, inFence, title, def.level);
      if (!located) continue;
      const expectedLines = splitLines(def.render());
      const current = extractBody(lines, located);
      if (current !== def.render()) {
        lines.splice(located.bodyStart, located.bodyEnd - located.bodyStart, ...expectedLines);
        mutated = true;
        changed += 1;
      }
    }
    if (mutated) fs.writeFileSync(file, lines.join('\n'), 'utf8');
  }
  return changed;
}

let isMain = false;
try {
  isMain = process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
} catch {
  isMain = false;
}

if (isMain) {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[i + 1]);
  }
  const mode = args.includes('--write') ? 'write' : 'check';
  if (mode === 'write') {
    const changed = syncWrite(root);
    console.log(`sync-skill-boilerplate: rewrote ${changed} section(s)`);
    process.exit(0);
  }
  const drift = checkDrift(root);
  if (drift.length === 0) {
    console.log('sync-skill-boilerplate: OK — no drift');
    process.exit(0);
  }
  for (const d of drift) console.log(`DRIFT: ${d.skill}/SKILL.md "${d.section}": ${d.message}`);
  process.exit(1);
}

