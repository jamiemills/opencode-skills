// Development Practices dimension — scanner.
//
// T003 owns this module. It enumerates the repository, probes hidden
// practice directories explicitly (`.github`, `.agents`, `.opencode`,
// `.claude`, `.devcontainer` and root dotfiles — `rg` prunes dot entries),
// reads a bounded set of practice artifacts, classifies them per category
// (methodology, enforcement, automation, ritual, quality_gate,
// agent_workflow, style_guide), and builds the deterministic privacy-safe
// practices model. It is exported as a factory-friendly `scan` function for
// tests and the future T224 pipeline cutover; nothing in the current
// pipeline, CLI, enrich, validate, write, or existing-ten renderer
// dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact
// content is read through the bounded T206 reader. Git metadata is obtained
// only via T208 broker command IDs (`git:rev-parse-toplevel`,
// `git:rev-parse-abbrev-head`); no commit history or contributor data is
// requested. Hidden path probes use only canonical read-only `node:fs`
// acquisitions (`existsSync`, `readdirSync`) that are in the closed read
// allowlist.
//
// Per-artifact atomicity: an artifact that is unreadable, malformed, over a
// declared cap, or privacy-violating becomes a diagnostic without erasing the
// results of valid peer artifacts. Content parse failures degrade to an
// `unverified` entry; the scan never crashes on malformed input.
//
// ESM only. Zero npm deps. node: builtins only (read-only `node:fs` probes
// for hidden paths, mirroring `deep/governance/scanner.mjs`).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts } from '../../shared/artifacts.mjs';
import { commandBroker } from '../../shared/command.mjs';
import { enumerate } from '../../shared/enum.mjs';
import {
  PRACTICES_HIDDEN_DIRS,
  PRACTICES_HIDDEN_FILES,
  PRACTICES_LIMITS,
  buildPracticesModel,
  classifyPracticePath,
  extractAgentWorkflow,
  extractAutomation,
  extractEnforcement,
  extractMethodology,
  extractQualityGate,
  extractRitual,
  extractStyleGuide,
  isCandidatePath,
  isRelevantHiddenFile,
} from './model.mjs';

export const PRACTICES_SCANNER_ID = 'DET-practices-scan-v1';

const READ_LIMITS = Object.freeze({
  maxBytes: PRACTICES_LIMITS.maxBytes,
  maxDepth: PRACTICES_LIMITS.maxDepth,
  maxFiles: PRACTICES_LIMITS.maxFiles,
  maxRecords: PRACTICES_LIMITS.maxRecords,
});

const CATEGORY_EXTRACTORS = Object.freeze([
  ['methodology', extractMethodology],
  ['enforcement', extractEnforcement],
  ['automation', extractAutomation],
  ['ritual', extractRitual],
  ['quality_gate', extractQualityGate],
  ['agent_workflow', extractAgentWorkflow],
  ['style_guide', extractStyleGuide],
]);

function walkHiddenDir(repoPath, directory, target, depth) {
  if (depth > PRACTICES_LIMITS.maxDepth) return;
  let entries;
  try {
    entries = readdirSync(join(repoPath, directory), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (target.size >= PRACTICES_LIMITS.maxFiles) return;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      walkHiddenDir(repoPath, relative, target, depth + 1);
    } else if (entry.isFile() && isRelevantHiddenFile(relative)) {
      target.add(relative);
    }
  }
}

function hiddenPracticePaths(repoPath) {
  const paths = new Set();
  for (const relative of PRACTICES_HIDDEN_FILES) {
    if (existsSync(join(repoPath, relative))) paths.add(relative);
  }
  for (const directory of PRACTICES_HIDDEN_DIRS) {
    walkHiddenDir(repoPath, directory, paths, 1);
  }
  let rootEntries;
  try {
    rootEntries = readdirSync(repoPath, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && /^\.quality-gates/.test(entry.name)) paths.add(entry.name);
  }
  return [...paths].sort();
}

function readStatusToDiagnostic(result) {
  const status = result.status === 'unsupported' ? 'unsupported' : 'unverified';
  const reason = result.status === 'unreadable' ? 'UNREADABLE'
    : result.status === 'capped' ? 'CAP'
    : result.status === 'malformed' ? 'MALFORMED'
    : result.status === 'unsupported' ? 'PARSE_UNSUPPORTED'
    : 'UNVERIFIED';
  return { path: result.path, line: null, status, reason };
}

function entryRecord(categoryName, kind, path, record) {
  const entry = {
    category: categoryName,
    matchedKey: `${categoryName}:${kind}:${path}`,
    path,
    status: record.status ?? 'observed',
  };
  if (Number.isSafeInteger(record.count)) entry.count = record.count;
  if (Array.isArray(record.kinds) && record.kinds.length > 0) entry.kinds = record.kinds;
  if (Array.isArray(record.paths) && record.paths.length > 0) entry.paths = record.paths;
  return entry;
}

function classifyResult(result) {
  const entries = [];
  const text = typeof result.value === 'string' ? result.value : '';
  const staticHit = classifyPracticePath(result.path);
  if (staticHit !== null) {
    entries.push(entryRecord(staticHit.category, staticHit.kind, result.path, { status: 'observed' }));
  }
  for (const [categoryName, extractor] of CATEGORY_EXTRACTORS) {
    let records;
    try {
      records = extractor({ path: result.path, text });
    } catch {
      records = [{ kind: 'parse-failure', status: 'unverified' }];
    }
    for (const record of records) {
      entries.push(entryRecord(categoryName, record.kind, result.path, record));
    }
  }
  return entries;
}

function releaseNotesCoupling(entries) {
  const changelog = entries.find((entry) => (
    entry.category === 'ritual' && entry.matchedKey.includes(':changelog-format:')
  ));
  const hasDrafter = entries.some((entry) => (
    entry.category === 'automation' && entry.matchedKey.includes(':release-drafter:')
  ));
  if (changelog === undefined || !hasDrafter) return null;
  return {
    category: 'ritual',
    matchedKey: `ritual:release-notes:${changelog.path}`,
    path: changelog.path,
    status: 'inferred',
  };
}

async function gitFacts(repoPath, broker) {
  const safeGit = async (id) => {
    try {
      const result = await broker.execute(id, { cwd: repoPath });
      return result.ok ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  const isGit = (await safeGit('git:rev-parse-toplevel')) !== null;
  let defaultBranch = null;
  if (isGit) {
    const branch = await safeGit('git:rev-parse-abbrev-head');
    if (branch !== null && branch !== 'HEAD') defaultBranch = branch;
  }
  return { isGit, defaultBranch };
}

/**
 * Scan a repository's development-practice declarations and signals.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} _overview - survey overview (unused; retained for the shared
 *   scanner contract).
 * @param {object} broker - T208 command broker (injectable for tests).
 * @returns {Promise<object>} `{ dimension: 'practices', signal, findings }`
 *   where `findings` is the deep-frozen practices model.
 */
export async function scan(repoPath, _overview = {}, broker = commandBroker) {
  const diagnostics = [];
  const { files } = await enumerate(repoPath);
  const candidates = new Set(files.filter((path) => isCandidatePath(path)));
  for (const path of hiddenPracticePaths(repoPath)) candidates.add(path);
  const sortedCandidates = [...candidates].sort();
  const requestedCandidates = sortedCandidates.slice(0, PRACTICES_LIMITS.maxFiles);
  if (requestedCandidates.length !== sortedCandidates.length) {
    diagnostics.push({ path: 'UNKNOWN', line: null, status: 'unverified', reason: 'CAP' });
  }
  const requests = requestedCandidates.map((path) => ({
    path,
    format: 'text',
    sensitivity: 'internal',
  }));
  const read = await readArtifacts(repoPath, requests, READ_LIMITS);
  const { isGit, defaultBranch } = await gitFacts(repoPath, broker);

  const rawEntries = [];
  for (const result of read.results) {
    if (result.status !== 'read') {
      diagnostics.push(readStatusToDiagnostic(result));
      continue;
    }
    rawEntries.push(...classifyResult(result));
  }
  const coupling = releaseNotesCoupling(rawEntries);
  if (coupling !== null) rawEntries.push(coupling);

  const model = buildPracticesModel({
    entries: rawEntries,
    diagnostics,
    searchSpace: read.searchSpace,
    isGit,
    defaultBranch,
  });

  return {
    dimension: 'practices',
    signal: model.summary.entries > 0 ? 'high' : 'low',
    findings: model,
  };
}
