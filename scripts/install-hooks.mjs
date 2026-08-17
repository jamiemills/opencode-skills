#!/usr/bin/env node
'use strict';

// Installs the repo's git hooks via core.hooksPath (single tracked copy; no
// per-clone duplication). Uninstall: `git config --unset core.hooksPath`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const hooksDir = path.join(root, 'scripts', 'hooks');

if (!fs.existsSync(path.join(hooksDir, 'pre-commit'))) {
  console.error('install-hooks: scripts/hooks/pre-commit not found');
  process.exit(1);
}

fs.chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { cwd: root });
const active = execFileSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8', cwd: root }).trim();
console.log(`install-hooks: core.hooksPath = ${active}`);
console.log('install-hooks: pre-commit gate active (bypass: git commit --no-verify; uninstall: git config --unset core.hooksPath)');
