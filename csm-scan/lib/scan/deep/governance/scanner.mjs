// Governance & Ownership dimension — scanner.
//
// T215 owns this module. It enumerates the repository, reads a bounded set of
// governance artifacts, parses CODEOWNERS / ADR / explicit-link documents, and
// builds the deterministic privacy-safe governance model. It is exported as a
// factory-friendly `scan` function for tests and the future T224 pipeline
// cutover; nothing in the current pipeline, CLI, enrich, validate, write, or
// existing-ten renderer dispatches it yet.
//
// Read-only: enumeration uses the shared `rg --files` broker; artifact content
// is read through the bounded T206 reader. Git metadata is obtained only via
// T208 broker command IDs (`git:rev-parse-toplevel`,
// `git:rev-parse-abbrev-head`); no commit history, author, or contributor data
// is requested and no ownership is ever inferred from commits.
//
// Per-artifact atomicity: an artifact that is unreadable, unsupported,
// malformed, privacy-violating, or over a declared cap becomes a diagnostic
// without erasing the results of valid peer artifacts. Within a CODEOWNERS
// document, malformed lines produce diagnostics while valid rules are kept.
//
// ESM only. Zero npm deps. node: builtins only (read-only `node:fs` probes for
// hidden `.github` governance paths, mirroring `deep/git.mjs`).
//
// Source-policy note (T201): this module uses only canonical read-only
// `node:fs` acquisitions (`existsSync`, `readdirSync`) that are in the closed
// read allowlist; it never touches node:child_process / node:process /
// node:vm / node:module.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readArtifacts } from '../../shared/artifacts.mjs';
import { commandBroker } from '../../shared/command.mjs';
import { enumerate } from '../../shared/enum.mjs';
import { parseCodeowners } from './codeowners.mjs';
import {
  GOVERNANCE_HIDDEN_PATHS,
  GOVERNANCE_ISSUE_TEMPLATE_DIRS,
  GOVERNANCE_LIMITS,
  buildGovernanceModel,
  classifyGovernancePath,
  extractMarkdownLinks,
  parseAdrMetadata,
} from './model.mjs';

export const GOVERNANCE_SCANNER_ID = 'DET-governance-scan-v1';

const READ_LIMITS = Object.freeze({
  maxBytes: GOVERNANCE_LIMITS.maxBytes,
  maxDepth: GOVERNANCE_LIMITS.maxDepth,
  maxFiles: GOVERNANCE_LIMITS.maxFiles,
  maxRecords: GOVERNANCE_LIMITS.maxRecords,
});

function hiddenGovernancePaths(repoPath) {
  const paths = [];
  for (const relative of GOVERNANCE_HIDDEN_PATHS) {
    if (existsSync(join(repoPath, relative))) paths.push(relative);
  }
  for (const directory of GOVERNANCE_ISSUE_TEMPLATE_DIRS) {
    const absolute = join(repoPath, directory);
    if (!existsSync(absolute)) continue;
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:md|txt)$/i.test(entry.name)) continue;
      paths.push(`${directory}/${entry.name}`);
    }
  }
  return paths.toSorted();
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

function simpleArtifact(classification, path) {
  return {
    category: classification.category,
    dialect: classification.dialect,
    path,
    line: null,
    status: 'observed',
    details: { kind: classification.dialect },
  };
}

function adrArtifact(path, text) {
  const metadata = parseAdrMetadata(text, path);
  return {
    category: 'decision',
    dialect: 'adr',
    path,
    line: metadata.line,
    status: 'observed',
    details: { kind: 'adr', id: metadata.id, date: metadata.date, status: metadata.status },
  };
}

function linkArtifacts(path, text) {
  const { links, capped } = extractMarkdownLinks(text, path, GOVERNANCE_LIMITS.maxLinksPerFile);
  const artifacts = links.map((link) => ({
    category: 'reference',
    dialect: 'link',
    path,
    line: link.line,
    status: 'observed',
    details: { kind: 'link', url: link.url },
  }));
  const diagnostics = capped ? [{
    path, line: null, status: 'unverified', reason: 'CAP',
  }] : [];
  return { artifacts, diagnostics };
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
 * Scan a repository's governance and ownership declarations.
 *
 * @param {string} repoPath - absolute repository root.
 * @param {object} _overview - survey overview (unused; retained for the shared
 *   scanner contract).
 * @param {object} broker - T208 command broker (injectable for tests).
 * @returns {Promise<object>} `{ dimension: 'governance', signal, findings }`
 *   where `findings` is the deep-frozen governance model.
 */
export async function scan(repoPath, _overview = {}, broker = commandBroker) {
  const diagnostics = [];
  const { files } = await enumerate(repoPath);
  const governanceFiles = new Set(
    files.filter((path) => classifyGovernancePath(path) !== null),
  );
  for (const path of hiddenGovernancePaths(repoPath)) {
    if (classifyGovernancePath(path) !== null) governanceFiles.add(path);
  }
  const sortedGovernanceFiles = [...governanceFiles].toSorted();
  const requestedGovernanceFiles = sortedGovernanceFiles.slice(0, 4096);
  if (requestedGovernanceFiles.length !== sortedGovernanceFiles.length) {
    diagnostics.push({ path: 'CODEOWNERS', line: null, status: 'unverified', reason: 'CAP' });
  }
  const requests = requestedGovernanceFiles
    .map((path) => ({ path, format: 'text', sensitivity: 'internal' }));
  const read = await readArtifacts(repoPath, requests, READ_LIMITS);
  const { isGit, defaultBranch } = await gitFacts(repoPath, broker);

  const artifacts = [];
  const ownership = [];

  for (const result of read.results) {
    const classification = classifyGovernancePath(result.path);
    if (result.status !== 'read') {
      diagnostics.push(readStatusToDiagnostic(result));
      continue;
    }
    if (classification?.parse === 'codeowners') {
      const parsed = parseCodeowners(result.value, result.path);
      ownership.push({
        path: result.path,
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: parsed.malformedLines,
      });
      continue;
    }
    if (classification?.parse === 'adr') {
      artifacts.push(adrArtifact(result.path, result.value));
      continue;
    }
    if (classification?.parse === 'links') {
      artifacts.push(simpleArtifact(classification, result.path));
      const { artifacts: linked, diagnostics: linkDiagnostics } = linkArtifacts(result.path, result.value);
      artifacts.push(...linked);
      diagnostics.push(...linkDiagnostics);
      continue;
    }
    if (classification !== null) {
      artifacts.push(simpleArtifact(classification, result.path));
    }
  }

  const model = buildGovernanceModel({
    artifacts,
    ownership,
    diagnostics,
    searchSpace: read.searchSpace,
    isGit,
    defaultBranch,
  });

  return {
    dimension: 'governance',
    signal: model.summary.entries > 0 ? 'high' : 'low',
    findings: model,
  };
}
