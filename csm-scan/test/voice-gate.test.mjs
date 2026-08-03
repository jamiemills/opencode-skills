import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { enrich } from '../lib/scan/enrich.mjs';
import { survey } from '../lib/scan/survey.mjs';
import { validate } from '../lib/scan/validate.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import * as architecture from '../lib/scan/deep/architecture.mjs';
import * as config from '../lib/scan/deep/config.mjs';
import * as conventions from '../lib/scan/deep/conventions.mjs';
import * as documentation from '../lib/scan/deep/documentation.mjs';
import * as git from '../lib/scan/deep/git.mjs';
import * as operations from '../lib/scan/deep/operations.mjs';
import * as security from '../lib/scan/deep/security.mjs';
import * as stack from '../lib/scan/deep/stack.mjs';
import * as structure from '../lib/scan/deep/structure.mjs';
import * as testing from '../lib/scan/deep/testing.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { withFixture } from './harness.mjs';

// Renderer-authored NORMS prose is descriptive, not prescriptive or evaluative.
// Keep this list explicit so additions receive deliberate review. Matching is
// case-insensitive and uses word boundaries rather than substring matching.
export const BANNED_VOICE = Object.freeze([
  'should',
  'must',
  'ought',
  'shall',
  'poor',
  'good',
  'bad',
  'weak',
  'strong',
  'better',
  'worse',
  'best',
  'worst',
  'recommended',
  'recommendation',
  'ideally',
  'unfortunately',
  'concern',
  'concerning',
  'problem',
  'anti-pattern',
  'smell',
  'suboptimal',
  'inadequate',
  'insufficient',
  'contradiction',
  'contradictions',
  'inconsistent',
  'inconsistency',
  'conflict',
  'conflicts',
  'lacking',
]);

const BANNED_PATTERN = new RegExp(
  `\\b(?:${BANNED_VOICE.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

function mask(value) {
  return value.replace(/[^\n]/g, ' ');
}

// The renderer places repository-originated code and identifiers in these
// Markdown forms. Masking (rather than deleting) preserves source line numbers.
// No judgmental phrase is allowlisted: all remaining prose is checked.
export function stripNonProse(markdown) {
  return markdown
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm, mask)
    .replace(/(`+)[^\n]*?\1/g, mask)
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi, mask)
    .replace(/^[ \t]*\|([^|]*)\|(.*)\|[ \t]*$/gm, (row, firstCell, valueCells, offset, source) => {
      const nextLine = source.slice(offset + row.length).match(/^\r?\n([^\r\n]*)/)?.[1] || '';
      const separator = /^[ \t]*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/.test(nextLine);
      if (separator) return row;
      return `|${firstCell}|${mask(valueCells)}|`;
    })
    .replace(/(?:~\/|\.{0,2}\/|\/)(?:[^\s`<>|()[\]{}]+\/)*[^\s`<>|()[\]{}]*/g, mask)
    .replace(/(?:[\w@+.-]+\/)+[\w@+,=~.-]+/g, mask)
    .replace(/(?<![\w@.-])[\w@+-]*[\w@+-]\.[A-Za-z0-9][\w.-]*/g, mask);
}

export function findVoiceHits(markdown) {
  const prose = stripNonProse(markdown);
  const hits = [];

  for (const [index, line] of prose.split('\n').entries()) {
    BANNED_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(BANNED_PATTERN)) {
      hits.push({ term: match[0].toLowerCase(), line: index + 1, text: line.trim() });
    }
  }

  return hits;
}

// Mirrors scripts/scan.mjs: survey -> 10 deep scanners -> enrich -> validate
// -> writeNORMS. It runs in-process and returns the rendered Markdown.
async function runPipeline(repoPath) {
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
    `norms-voice-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );

  return writeNORMS(
    {
      generated: '2026-01-01',
      repos: [{ overview, deep: validated.findings, crossObservations: validated.contradictions }],
    },
    out,
  );
}

test('T116 voice matcher catches prescriptive and evaluative prose', () => {
  assert.deepEqual(
    findVoiceHits('This repo should use tests\nConfiguration is inadequate'),
    [
      { term: 'should', line: 1, text: 'This repo should use tests' },
      { term: 'inadequate', line: 2, text: 'Configuration is inadequate' },
    ],
  );
});

test('T116 voice matcher ignores repository-originated code, URLs, and paths', () => {
  const markdown = [
    '```text',
    'must strong contradiction',
    '```',
    'Command: `tool --must-use good`',
    'Source: https://example.test/bad/should/best-practices',
    'Config: config/.semgrep-community-best-practices.yml',
  ].join('\n');

  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T126 voice matcher checks every table header cell', () => {
  assert.deepEqual(
    findVoiceHits('| Tool | Recommended configuration |\n|------|---------------------------|'),
    [{
      term: 'recommended',
      line: 1,
      text: '| Tool | Recommended configuration |',
    }],
  );
});

test('T126 voice matcher checks data labels and masks repository values', () => {
  assert.deepEqual(findVoiceHits('| Recommended setup | repo-value |'), [
    { term: 'recommended', line: 1, text: '| Recommended setup |            |' },
  ]);
  assert.deepEqual(
    findVoiceHits('| Tool | Configuration |\n|------|---------------|\n| Command | recommended weak conflict |'),
    [],
  );
  assert.deepEqual(findVoiceHits('| Path | `src/recommended/weak-conflict.mjs` |'), []);
});

test('T116 voice matcher permits factual absence descriptions', () => {
  assert.deepEqual(
    findVoiceHits('No test framework found\nLockfile not present\nNone detected\nStatus unknown'),
    [],
  );
});

const FIXTURES = [
  ['python fixture', pythonFiles],
  ['javascript fixture', javascriptFiles],
  ['typescript fixture', typescriptFiles],
  ['shell fixture', shellFiles],
  ['rust fixture', rustFiles],
];

function assertNeutralNORMS(name, markdown) {
  const hits = findVoiceHits(markdown);
  assert.deepEqual(hits, [], `${name}: judgmental renderer prose:\n${JSON.stringify(hits, null, 2)}`);
  assert.match(markdown, /> Coverage: \d+% of scanner fields reported · basis: (?:observed|inferred|unverified)/);
  assert.ok(!markdown.includes('Cohesion:'), `${name}: old Cohesion label present`);
  assert.ok(!markdown.includes('Signal:'), `${name}: old Signal label present`);

  const relatedHeadings = markdown.match(/^#{1,6}\s+.*(?:cross-observ|contradiction|conflict).*$/gim) || [];
  for (const heading of relatedHeadings) {
    assert.equal(heading, '## Cross-observations', `${name}: non-neutral cross-observation heading`);
  }
}

for (const [name, files] of FIXTURES) {
  test(`T116 ${name}: rendered NORMS uses neutral factual voice`, async () => {
    const markdown = await withFixture(`voice-${name.replace(' fixture', '')}`, files, runPipeline);
    assertNeutralNORMS(name, markdown);
  });
}

test('T116 perplexity-cli: rendered NORMS uses neutral factual voice', async (t) => {
  const repo = '/home/jamiemills/code/projects/perplexity-cli';
  if (!existsSync(repo)) {
    t.skip(`${repo} not present`);
    return;
  }

  assertNeutralNORMS('perplexity-cli', await runPipeline(repo));
});
