// T010 / F-032 — direct unit tests for lib/scan/render/git.mjs (the whole
// renderer previously had no direct test import; only the aggregate line floor
// in coverage-gate.mjs covered it transitively).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderGit } from '../lib/scan/render/git.mjs';
import { DEFAULT_RENDER_CONTEXT, createRenderContext } from '../lib/scan/render/base.mjs';

test('renderGit renders nothing for null or missing findings', () => {
  assert.equal(renderGit('repo', null), '');
  assert.equal(renderGit('repo', undefined), '');
});

test('renderGit reports no git repository when isGit is false', () => {
  const markdown = renderGit('repo', { isGit: false });
  assert.ok(markdown.includes('## Git Practices'));
  assert.ok(markdown.includes('_No git repository detected._'));
  assert.ok(!markdown.includes('**Overview**'));
});

test('renderGit renders every git fact bullet with defaults when fields are absent', () => {
  const markdown = renderGit('repo', { isGit: true });
  for (const label of [
    '- **Overview**: N/A',
    '- **Branch pattern**: N/A',
    '- **Default branch**: N/A',
    '- **Commit style**: N/A',
    '- **Remote**: N/A',
    '- **Contributors**: 0',
  ]) {
    assert.ok(markdown.includes(label), `missing ${label}`);
  }
  assert.ok(markdown.includes('- **PR template**: No'));
  assert.ok(markdown.includes('- **Issue templates**: No'));
});

test('renderGit renders the populated git facts and template markers', () => {
  const findings = {
    isGit: true,
    overview: 'Conventional commits and feature branches',
    branchPattern: 'feature/*',
    defaultBranch: 'main',
    commitStyle: 'conventional',
    remote: 'https://github.test/acme/repo.git',
    contributorCount: 7,
    prTemplate: true,
    hasIssueTemplates: true,
  };
  const markdown = renderGit('repo', findings);
  assert.ok(markdown.includes('- **Overview**: Conventional commits and feature branches'));
  assert.ok(markdown.includes('- **Branch pattern**: feature/*'));
  assert.ok(markdown.includes('- **Default branch**: main'));
  assert.ok(markdown.includes('- **Commit style**: conventional'));
  assert.ok(markdown.includes('- **Remote**: https://github.test/acme/repo.git'));
  assert.ok(markdown.includes('- **Contributors**: 7'));
  assert.ok(markdown.includes('- **PR template**: Yes'));
  assert.ok(markdown.includes('- **Issue templates**: Yes'));
  assert.ok(markdown.includes('PR template found (`.github/PULL_REQUEST_TEMPLATE.md`)'));
  assert.ok(markdown.includes('Issue templates found (`.github/ISSUE_TEMPLATE/`)'));
});

test('renderGit escapes repo-controlled fields through the render context', () => {
  const findings = { isGit: true, overview: 'repo | description\n`evil`' };
  const markdown = renderGit('repo', findings, DEFAULT_RENDER_CONTEXT);
  assert.ok(!markdown.includes('repo | description'), 'the pipe must be escaped');
  assert.ok(markdown.includes('repo \\| description'));
  assert.ok(markdown.includes('\\`evil\\`'), 'backticks must be escaped');

  const tracking = [];
  const custom = createRenderContext({
    privacyHook: (value) => {
      tracking.push(value);
      return value;
    },
  });
  renderGit('repo', { isGit: true, overview: 'seen-by-privacy-hook' }, custom);
  assert.ok(tracking.includes('seen-by-privacy-hook'), 'repo-controlled fields pass through the privacy hook');
});
