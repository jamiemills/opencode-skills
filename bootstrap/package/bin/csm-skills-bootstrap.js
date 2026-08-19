#!/usr/bin/env node
'use strict';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const USAGE = 'usage: csm-skills-bootstrap --version | payload-index | --help';

const isSafePath = value =>
  typeof value === 'string' &&
  value !== '' &&
  !value.startsWith('/') &&
  !value.split('/').some(part => part === '' || part === '.' || part === '..');

const sha256 = data => createHash('sha256').update(data).digest('hex');

async function verifyPayload() {
  const index = JSON.parse(await readFile(join(packageRoot, 'payload-index.json'), 'utf8'));
  const entries = [
    ...index.classes.skills,
    ...index.classes.supportingFiles,
    ...index.classes.helperBins,
    ...index.classes.metadata,
    index.fixedBin
  ];
  const failures = [];
  for (const entry of entries) {
    if (!entry || !isSafePath(entry.path) || typeof entry.sha256 !== 'string' || typeof entry.bytes !== 'number' || typeof entry.mode !== 'string') {
      failures.push({ path: entry && entry.path ? entry.path : null, error: 'INVALID_ENTRY' });
      continue;
    }
    let data;
    try {
      data = await readFile(join(packageRoot, entry.path));
    } catch {
      failures.push({ path: entry.path, error: 'MISSING_FILE' });
      continue;
    }
    if (data.length !== entry.bytes) {
      failures.push({ path: entry.path, error: 'SIZE_MISMATCH' });
      continue;
    }
    if (sha256(data) !== entry.sha256) failures.push({ path: entry.path, error: 'HASH_MISMATCH' });
  }
  return { index, verified: entries.length, failures };
}

const arg = process.argv[2];
if (arg === '--version') {
  process.stdout.write(`${VERSION}\n`);
} else if (arg === 'payload-index') {
  const { index, verified, failures } = await verifyPayload();
  process.stdout.write(`${JSON.stringify({ index, verification: { ok: failures.length === 0, verified, failures } }, null, 2)}\n`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} else if (arg === '--help') {
  process.stdout.write(`${USAGE}\n`);
} else {
  process.stderr.write(`${USAGE}\nunknown argument: ${arg === undefined ? '(none)' : arg}\n`);
  process.exitCode = 1;
}
