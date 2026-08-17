import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { survey } from '../../lib/scan/survey.mjs';
import { enrich } from '../../lib/scan/enrich.mjs';
import { validate } from '../../lib/scan/validate.mjs';
import { writeNORMS } from '../../lib/scan/write.mjs';
import * as structure from '../../lib/scan/deep/structure.mjs';
import * as stack from '../../lib/scan/deep/stack.mjs';
import * as config from '../../lib/scan/deep/config.mjs';
import * as testing from '../../lib/scan/deep/testing.mjs';
import * as conventions from '../../lib/scan/deep/conventions.mjs';
import * as git from '../../lib/scan/deep/git.mjs';
import * as architecture from '../../lib/scan/deep/architecture.mjs';
import * as documentation from '../../lib/scan/deep/documentation.mjs';
import * as security from '../../lib/scan/deep/security.mjs';
import * as operations from '../../lib/scan/deep/operations.mjs';
import { MIRROR_GENERATED_DATE } from './pipeline-mirror.mjs';

// Legacy ten-dimension oracle retained for the parity test, without importing
// a .test.mjs module and registering its tests a second time.
export async function runLegacyTenMirror(repoPath) {
  const overview = await survey(repoPath);

  const deepResults = (await Promise.all([
    structure.scan(repoPath, overview),
    stack.scan(repoPath, overview),
    config.scan(repoPath, overview),
    testing.scan(repoPath, overview),
    conventions.scan(repoPath, overview),
    git.scan(repoPath, overview),
    architecture.scan(repoPath, overview),
    documentation.scan(repoPath, overview),
    security.scan(repoPath, overview),
    operations.scan(repoPath, overview),
  ])).filter(Boolean);

  const enriched = await enrich(deepResults, overview);
  const validated = await validate(enriched);

  const out = join(
    tmpdir(),
    `norms-pipeline-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  const markdown = await writeNORMS(
    { generated: MIRROR_GENERATED_DATE, repos: [{ overview, deep: validated.findings }] },
    out,
  );
  const semantic = canonicalize({ overview, deepResults, enriched, validated }, repoPath);
  return {
    markdown,
    semantic,
    semanticSha256: digest(`${JSON.stringify(semantic)}\n`),
    markdownSha256: digest(`${canonicalize(markdown, repoPath)}\n`),
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value, repoPath) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, repoPath));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonicalize(entry, repoPath)]));
  }
  if (typeof value !== 'string') return value;
  const normalizedRoot = repoPath.replaceAll('\\', '/');
  const fixtureName = normalizedRoot.split('/').pop();
  return value
    .replaceAll('\\', '/')
    .replaceAll(normalizedRoot, '<FIXTURE_ROOT>')
    .replaceAll(fixtureName, '<FIXTURE_NAME>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<DATE>')
    .replace(/\b(Python|Node(?:\.js)?|rustc|Deno|Bun)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?/g, '$1 <HOST_VERSION>');
}
