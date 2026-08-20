import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

// F-003 harness: exercises the REAL check-suite gate against complete minimal
// temp corpora (repo copy excluding .git/node_modules), planting one violation
// per rule family and asserting exit codes + specific reported messages. A
// planted corpus must FAIL with its message, never exit 1 alone.
//
// J5 review R3/R8 notes: planted fixtures use top-level (column-0) fences — the
// canonical fenceMap only recognizes fences with <= 3 spaces of indent; and the
// count delta between gates is recorded in the build journal, never asserted as
// a literal here.

import { splitLines, fenceMap } from '../scripts/lib/plan-validation.mjs';
import { containsOutsideFences, githubAnchor, README_PATH_RE } from '../scripts/check-suite.mjs';

const REPO = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_SUITE = path.join(REPO, 'scripts', 'check-suite.mjs');
const SYNC = path.join(REPO, 'scripts', 'sync-skill-boilerplate.mjs');

function excludeRel(rel) {
  if (rel === '.git' || rel === 'node_modules') return false;
  if (rel.startsWith(`.git${path.sep}`) || rel.startsWith(`node_modules${path.sep}`)) return false;
  return true;
}

function trackedRels() {
  const r = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split('\n').filter(Boolean));
}

// Copies the TRACKED file set only (the live gate with a .git ignores
// untracked in-progress corpus drafts via F-053; a .git-less corpus must not
// re-introduce them, or the harness validates files the live gate tolerates).
function cloneInto(src, dest) {
  const tracked = fs.existsSync(path.join(src, '.git')) ? trackedRels() : null;
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      if (!excludeRel(rel)) return false;
      if (rel === '') return true; // keep the root itself
      if (tracked !== null) {
        const relPosix = rel.split(path.sep).join('/');
        if (tracked.has(relPosix)) return true;
        for (const t of tracked) {
          if (t.startsWith(`${relPosix}/`)) return true;
        }
        return false;
      }
      return true;
    },
  });
}

// Builds a fresh temp corpus from the live repo's TRACKED set. The F-003
// corpora are .git-less (D15: no git -> the F-053 untracked filter is off ->
// planted files stay visible; tracked-only copying keeps live untracked drafts
// out — R1). Pass withGit=true only for the F-053 leg that must exercise the
// untracked-ignore.
function buildCorpus({ withGit = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-suite-'));
  cloneInto(REPO, dir);
  if (withGit) {
    const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    const init = git(['init', '-q']);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    const add = git(['add', '-A']);
    assert.equal(add.status, 0, `git add -A failed: ${add.stderr}`);
  }
  return dir;
}

// Builds a temp corpus cloned from the verified-clean pristine corpus.
function clonePristine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-suite-'));
  fs.cpSync(pristine, dir, { recursive: true });
  return dir;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function write(dir, rel, content) {
  fs.writeFileSync(path.join(dir, rel), content, 'utf8');
}

function runGate(dir) {
  return spawnSync(process.execPath, [CHECK_SUITE, '--root', dir], { encoding: 'utf8' });
}

function runSync(dir, mode) {
  return spawnSync(process.execPath, [SYNC, mode, '--root', dir], { encoding: 'utf8' });
}

function combined(r) {
  return `${r.stdout}${r.stderr}`;
}

function assertGateFails(dir, messageRe, label) {
  const r = runGate(dir);
  assert.notEqual(r.status, 0, `${label}: planted violation must exit non-zero\n${combined(r)}`);
  assert.match(combined(r), messageRe, `${label}: specific message expected`);
  return r;
}

let pristine = null;

before(() => {
  pristine = buildCorpus();
  const r = runGate(pristine);
  assert.equal(r.status, 0, `pristine corpus must be gate-clean: ${combined(r)}`);
});

after(() => {
  if (pristine !== null) fs.rmSync(pristine, { recursive: true, force: true });
});

test('clean corpus exits 0 with the "check-suite: OK" banner', () => {
  const dir = clonePristine();
  try {
    const r = runGate(dir);
    assert.equal(r.status, 0, combined(r));
    assert.match(combined(r), /check-suite: OK/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('frontmatter family: missing description exits 1 with the specific message', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'csm-grill/SKILL.md');
    write(dir, 'csm-grill/SKILL.md', content.replace(/^description:.*\n/m, ''));
    assertGateFails(dir, /csm-grill\/SKILL\.md missing frontmatter description/, 'frontmatter');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('machine family: a chain state heading corrupted exits 1 with "not in the chain"', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'csm-plan/SKILL.md');
    write(dir, 'csm-plan/SKILL.md', content.replace('### 1. INTAKE', '### 1. FOO'));
    assertGateFails(dir, /state headings not in the chain: FOO/, 'machine');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corpus family (plan): a marker-less plan exits 1 with the format-marker message', () => {
  const dir = clonePristine();
  try {
    write(dir, '.agents/plans/zz-plant-csm.md', '# Plant Plan\n\n## Control\n- Status: ready\n');
    assertGateFails(dir, /plan corpus \.agents\/plans\/zz-plant-csm\.md missing\/unknown format marker/, 'corpus-plan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corpus family (review): a marker-less review exits 1 with the format-marker message', () => {
  const dir = clonePristine();
  try {
    write(dir, '.agents/reviews/zz-plant-review.md', '# Plant Review\n');
    assertGateFails(dir, /review corpus \.agents\/reviews\/zz-plant-review\.md missing\/unknown format marker/, 'corpus-review');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boilerplate family: a drifted synced section exits 1 with the drift message', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'csm-plan/SKILL.md');
    write(dir, 'csm-plan/SKILL.md', content.replace('1. In tmux (', '1. In tmux OR not ('));
    assertGateFails(dir, /csm-plan\/SKILL\.md "Tmux Session Bootstrap": boilerplate drifted/, 'boilerplate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('README family (F-061): a TOC missing the Composition matrix entry exits 1', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'README.md');
    write(dir, 'README.md', content.replace('- [Composition matrix](#composition-matrix)\n', ''));
    assertGateFails(dir, /README\.md TOC has no entry for "## Composition matrix"/, 'toc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('README family (F-052): a fenced-only skill reference does not satisfy the prose path scan', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'README.md');
    // Strip every prose reference to the skill (table row and any deep-dive
    // cross-links), then append a fenced-only one that must not count.
    const withoutRefs = content.split('\n').filter((l) => !l.includes('csm-upload/SKILL.md')).join('\n');
    write(dir, 'README.md', `${withoutRefs}\n\`\`\`bash\n# fenced-only reference, must not count as a prose declaration\ncsm-upload/SKILL.md\n\`\`\`\n`);
    assertGateFails(dir, /README references 8\/9 skills; missing csm-upload/, 'readme-fence');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contracts family (F-052): a fenced-only needle does not satisfy the CONTRACTS declaration', () => {
  const dir = clonePristine();
  try {
    const lines = splitLines(read(dir, 'csm-build/SKILL.md'));
    const patched = lines.map((l) => l.replaceAll('.agents/plans/', 'plans/'));
    write(dir, 'csm-build/SKILL.md', `${patched.join('\n')}\n\n\`\`\`bash\n# fenced-only needle, must not satisfy the contract\n.agents/plans/\n\`\`\`\n`);
    assertGateFails(dir, /contract plan-save-path: consumer csm-build\/SKILL\.md lacks "\.agents\/plans\/"/, 'contracts');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('payload-drift family: a byte mutation in a payload file exits 1 with "payload drift: DIFF"', () => {
  const dir = clonePristine();
  try {
    const rel = 'bootstrap/package/payload/skills/csm-grill/SKILL.md';
    write(dir, rel, `${read(dir, rel)} `);
    assertGateFails(dir, /payload drift: DIFF csm-grill\/SKILL\.md/, 'payload-drift');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DEFERRED-citation family: a non-COMPLETE plan with an uncited DEFERRED task exits 1', () => {
  const dir = clonePristine();
  try {
    write(dir, '.agents/plans/zz-deferred-csm.md', [
      'format: csm-plan/1',
      '# Plant Plan',
      '',
      '## How To Execute',
      'Start work only through a separate, explicit csm-build invocation.',
      '',
      '## Control',
      '- Status: ready',
      '- Current CSM state: NOT_STARTED',
      '- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER',
      '',
      '## Goal',
      'Plant a DEFERRED-citation violation.',
      '',
      '## Numbered Plan',
      '1. [blocked] DEFERRED deferred task',
      '   - Task ID: P1',
      '   - Depends on: none',
    ].join('\n'));
    assertGateFails(dir, /plan corpus \.agents\/plans\/zz-deferred-csm\.md: DEFERRED task 1 has no ledger citation \[DEF:<slug>\]/, 'deferred-citation');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-signal family: a <...> placeholder in an acceptance signal exits 1', () => {
  const dir = clonePristine();
  try {
    write(dir, '.agents/plans/zz-signal-csm.md', [
      'format: csm-plan/1',
      '# Plant Plan',
      '',
      '## How To Execute',
      'x',
      '',
      '## Control',
      '- Status: ready',
      '- Current CSM state: NOT_STARTED',
      '- Next transition: On a future explicit csm-build invocation, NOT_STARTED -> RECOVER',
      '',
      '## Goal',
      'Plant a plan-signal lint violation.',
      '',
      '## Numbered Plan',
      '1. [pending] lint check',
      '   - Task ID: P1',
      '   - Acceptance signal: `node scripts/foo.mjs <bar>`',
    ].join('\n'));
    assertGateFails(dir, /plan corpus \.agents\/plans\/zz-signal-csm\.md line \d+: placeholder token <bar>/, 'plan-signal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F-050 hard-enforcement: the template-format-marker check fails on a bad marker post-prune', () => {
  const dir = clonePristine();
  try {
    const content = read(dir, 'csm-plan/SKILL.md');
    write(dir, 'csm-plan/SKILL.md', content.replace('format: csm-plan/1', 'not-a-marker'));
    assertGateFails(dir, /csm-plan\/SKILL\.md template format marker: first line inside the "## Required Plan Document" template fence is "not-a-marker" — expected "format: csm-plan\/<n>"/, 'template-format-marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F-053 (D15): with a .git the untracked plant is ignored; without .git it is seen', () => {
  const dir = buildCorpus({ withGit: true });
  try {
    const rel = '.agents/reviews/zz-untracked-review.md';
    write(dir, rel, '# Plant Review\n');
    const withGitRun = runGate(dir);
    assert.equal(withGitRun.status, 0, `untracked plant must be ignored when a .git exists\n${combined(withGitRun)}`);
    assert.doesNotMatch(combined(withGitRun), /zz-untracked-review/, 'untracked review not validated');

    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    const noGitRun = runGate(dir);
    assert.notEqual(noGitRun.status, 0, 'without .git the planted review must be visible and fail the gate');
    assert.match(combined(noGitRun), /review corpus \.agents\/reviews\/zz-untracked-review\.md missing\/unknown format marker/, 'F-053 no-git leg message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F-069-1: sync --write fails loudly when a synced section is missing', () => {
  const dir = clonePristine();
  try {
    const lines = splitLines(read(dir, 'csm-plan/SKILL.md'));
    const idx = lines.findIndex((l) => l.trim() === '## Tmux Session Bootstrap');
    assert.ok(idx >= 0, 'fixture: csm-plan has a Tmux Session Bootstrap heading');
    lines.splice(idx, 1);
    write(dir, 'csm-plan/SKILL.md', lines.join('\n'));

    const r = runSync(dir, '--write');
    assert.notEqual(r.status, 0, '--write must exit non-zero on a missing section');
    assert.match(combined(r), /sync-skill-boilerplate: csm-plan\/SKILL\.md is missing the synced section "## Tmux Session Bootstrap"/, 'F-069-1 loud failure');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F-069-3 regression: the offline grammar carries a real --no- negation, not a bare --no', () => {
  const grammar = JSON.parse(fs.readFileSync(path.join(REPO, 'bootstrap', 'runtime-commands.json'), 'utf8'));
  assert.ok(!grammar.offlineFlags.includes('--no'), 'bare "--no" must not be recorded as a load-bearing flag');
  const negation = grammar.offlineFlags.filter((f) => f.startsWith('--no-') && f !== '--no');
  assert.ok(negation.length >= 1, 'offlineFlags must include a real --no-* negation');
  assert.ok(grammar.argvTemplates.offline.includes(negation[0]), 'argvTemplates.offline must match offlineFlags');
});

const fenceMask = (content) => fenceMap(splitLines(content));

test('F-054: canonical splitLines/fenceMap edge cases (top-level fences required for plants)', () => {
  assert.deepEqual(fenceMask('a\n```\nb\n```\nc'), [false, true, true, true, false]);
  assert.deepEqual(fenceMask('```\na\n```'), [true, true, true], 'opening fence line is inFence');
  assert.deepEqual(fenceMask('    ```\na\n    ```'), [false, false, false], '4-space-indented fence does not open (J5 R3: use top-level fences in plants)');
  assert.deepEqual(fenceMask('   ```\na\n   ```'), [true, true, true], 'up-to-3-space indent opens');
  assert.deepEqual(fenceMask('~~~\na\n~~~'), [true, true, true], 'tilde fences open/close');
  assert.deepEqual(fenceMask('```js `code`\na'), [false, false], 'inline-backtick opener does not open a fence');
  assert.deepEqual(fenceMask('```\na\n````'), [true, true, true], 'an equal-or-longer run closes');
  assert.deepEqual(fenceMask('````\na\n```\nb\n```'), [true, true, true, true, true], 'a shorter run does not close');
  assert.deepEqual(fenceMask('```\na\nb'), [true, true, true], 'unclosed fence marks the rest');
  assert.deepEqual(fenceMask('```\r\na\r\n```'), [true, true, true], 'CRLF content splits and fences identically');
});

const pathMatches = (line) => [...line.matchAll(README_PATH_RE)].map((m) => m[0]);

test('F-052: containsOutsideFences / README path-class boundary / anchor generation', () => {
  assert.equal(containsOutsideFences('prose `.agents/plans/` here', '.agents/plans/'), true);
  assert.equal(containsOutsideFences('```\n.agents/plans/\n```', '.agents/plans/'), false, 'fenced needle is not a declaration');
  assert.equal(containsOutsideFences(null, 'x'), false);
  assert.equal(containsOutsideFences('no needle', 'x'), false);

  assert.deepEqual(pathMatches('see csm-browse/SKILL.md.'), ['csm-browse/SKILL.md'], 'sentence-ending period is not captured');
  assert.deepEqual(pathMatches('csm-upload/SKILL.md and csm-scan/scripts/scan.mjs'), ['csm-upload/SKILL.md', 'csm-scan/scripts/scan.mjs']);
  assert.deepEqual(pathMatches('csm-grill/'), [], 'directory-only token is not a path reference');

  assert.equal(githubAnchor('The CSM workflow'), 'the-csm-workflow');
  assert.equal(githubAnchor('Composition matrix'), 'composition-matrix');
  assert.equal(githubAnchor('Development & testing'), 'development--testing', 'GitHub keeps one hyphen per removed-char space');
  assert.equal(githubAnchor('Repository layout'), 'repository-layout');
});
