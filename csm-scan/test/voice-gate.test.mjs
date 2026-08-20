import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANNED_VOICE, findVoiceHits } from './helpers/voice-gate.mjs';
import { runMirrorPipeline } from './helpers/pipeline-mirror.mjs';
import { resolveRealRepo, FALLBACK_REAL_REPO } from './helpers/real-repo.mjs';
import { files as javascriptFiles } from './fixtures/javascript.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { withFixture } from './harness.mjs';

// T010 (F-037): the banned vocabulary is shared with every voice gate via
// test/helpers/voice-gate.mjs and pinned here in one equality test so
// additions receive deliberate review.
test('T116 the shared banned-voice vocabulary is exactly the reviewed list', () => {
  assert.deepEqual([...BANNED_VOICE], [
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
  assert.equal(Object.isFrozen(BANNED_VOICE), true, 'the shared vocabulary must stay frozen');
});

// T010 (F-026): this suite drives the exported production pipeline
// (runExpandedPipeline) through the shared mirror helper; the retired
// ten-dimension hand-rolled orchestration was removed.

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
    const markdown = await withFixture(`voice-${name.replace(" fixture", "")}`, files, runMirrorPipeline);
    assertNeutralNORMS(name, markdown);
  });
}

// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture — the neutral-voice assertion runs on either.
// A configured-but-missing path falls back to the fixture with a warning
// instead of skipping: this is a named AC20 gate file, and the behavioral
// no-skip gate bans runtime t.skip() here.
const RESOLVED_REAL_REPO = resolveRealRepo();

test('T116 perplexity-cli: rendered NORMS uses neutral factual voice', async () => {
  if (RESOLVED_REAL_REPO.repo === null) {
    console.warn(`[T116] CSM_SCAN_REAL_REPO is set but does not exist (${RESOLVED_REAL_REPO.missing}); running against the pxcli-mini fallback fixture`);
  }
  const repo = RESOLVED_REAL_REPO.repo ?? FALLBACK_REAL_REPO;

  assertNeutralNORMS('perplexity-cli', await runMirrorPipeline(repo));
});
