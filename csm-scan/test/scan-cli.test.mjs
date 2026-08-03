import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cleanupFixture, makeFixture } from './harness.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_SCRIPT = join(REPO_ROOT, 'scripts', 'scan.mjs');

test('CLI reports factual cross-observations and detection coverage', async () => {
  const fixture = makeFixture('cli-cross-observation', {
    'package.json': JSON.stringify({ name: 'cli-fixture', type: 'module' }),
    Dockerfile: 'FROM node:22-alpine\n',
    'src/app.js': 'export const value = 1;\n',
    'test/app.test.js': 'export const recognizedTestFile = true;\n',
  });
  const outputDir = mkdtempSync(join(tmpdir(), 'csm-scan-cli-output-'));
  const outputPath = join(outputDir, 'NORMS.md');

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCAN_SCRIPT, '--repos', fixture, '--out', outputPath],
      { cwd: REPO_ROOT },
    );

    assert.equal(stderr, '');
    assert.ok(existsSync(outputPath), 'CLI must create the requested output file');
    assert.match(stdout, /\[CROSS-OBSERVATION\] testing framework reported as "unknown"; test files present/);
    assert.match(stdout, /\[SCAN-NOTE\] security: dockerfiles present; security docker analysis not performed/);
    assert.match(stdout, /\[INFERRED\]/);
    assert.match(stdout, /Detection coverage:/);
    assert.match(stdout, /(?:structure|stack|config|testing|conventions|git|architecture|documentation|security|operations): scanned/);
    assert.doesNotMatch(stdout, /Commit convention:\s*(?:N\/A|unknown|not applicable)/i);
    assert.doesNotMatch(stdout, /\[INFERRED\]\s+git:.*(?:N\/A|unknown|not applicable)/i);

    for (const legacyLabel of [
      '[CONTRADICTION]',
      'Cohesiveness:',
      '(undefined)',
      'weak dimensions',
      'still weak',
      'severity',
      'signal=',
      '[GAP]',
      'confidence:',
      'quality',
    ]) {
      assert.ok(!stdout.includes(legacyLabel), `stdout must not contain ${legacyLabel}`);
    }
    assert.doesNotMatch(stdout, /\b(?:signal|gap|confidence|quality|weak|cohesiveness|contradiction|conflict)\b/i);

    const markdown = readFileSync(outputPath, 'utf8');
    assert.match(markdown, /> Coverage: \d+% of scanner fields reported · basis: /);
    assert.match(markdown, /## Cross-observations[\s\S]*testing framework reported as "unknown"; test files present/);
    assert.doesNotMatch(markdown, /^#{1,6}\s+(?:Contradictions|Conflicts)\b/im);

    const source = readFileSync(SCAN_SCRIPT, 'utf8');
    for (const legacySourceLabel of [
      '[CONTRADICTION]',
      'Cohesiveness:',
      'weak dimensions',
      'still weak',
      '.severity',
    ]) {
      assert.ok(!source.includes(legacySourceLabel), `scan.mjs must not contain ${legacySourceLabel}`);
    }
  } finally {
    cleanupFixture(fixture);
    rmSync(outputDir, { recursive: true, force: true });
  }
});
