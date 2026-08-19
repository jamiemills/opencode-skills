import * as structure from '../deep/structure.mjs';
import * as stack from '../deep/stack.mjs';
import * as config from '../deep/config.mjs';
import * as testing from '../deep/testing.mjs';
import * as conventions from '../deep/conventions.mjs';
import * as git from '../deep/git.mjs';
import * as architecture from '../deep/architecture.mjs';
import * as documentation from '../deep/documentation.mjs';
import * as security from '../deep/security.mjs';
import * as operations from '../deep/operations.mjs';

export const EXISTING_TEN_DIMENSIONS = Object.freeze([
  'structure',
  'stack',
  'config',
  'testing',
  'conventions',
  'git',
  'architecture',
  'documentation',
  'security',
  'operations',
]);

export const EXISTING_TEN_SCANNERS = Object.freeze({
  structure,
  stack,
  config,
  testing,
  conventions,
  git,
  architecture,
  documentation,
  security,
  operations,
});

export function existingTenScanner(dimension) {
  if (!Object.hasOwn(EXISTING_TEN_SCANNERS, dimension)) return null;
  return EXISTING_TEN_SCANNERS[dimension];
}

export async function deepScan(dimension, repoPath, overview, broker = null) {
  const scanner = existingTenScanner(dimension);
  if (!scanner) return null;
  const result = broker === null
    ? await scanner.scan(repoPath, overview)
    : await scanner.scan(repoPath, overview, broker);
  return result && typeof result === 'object' && result.dimension ? result : null;
}
