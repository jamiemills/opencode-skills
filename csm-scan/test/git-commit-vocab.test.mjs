import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeCommitStyle } from '../lib/scan/deep/git.mjs';

test('empty log yields unknown', () => {
  assert.equal(analyzeCommitStyle([]), 'unknown');
});

test('whitespace-only log yields unknown', () => {
  assert.equal(analyzeCommitStyle(['', '\t', '   ']), 'unknown');
});

test('conventional subjects keep their label', () => {
  const subjects = [
    'a1b2c3d feat: add thing',
    'e4f5a6b fix: repair bug',
    'docs: update readme',
    'refactor(api): tidy handler',
    'chore: bump deps',
    'ci: run gate',
  ];
  assert.equal(analyzeCommitStyle(subjects), 'Conventional Commits');
});

test('legacy conventional subjects mentioning task words do not reclassify', () => {
  const subjects = [
    'feat: add plan for T007 work',
    'fix: repair csm-scan path',
    'docs: explain CSM loop',
  ];
  assert.equal(analyzeCommitStyle(subjects), 'Conventional Commits');
});

test('task-identifier prefixes classify as Task-identified', () => {
  const prefixes = ['T005:', 'T005-topic:', 'P2C:', 'CSM:', 'CSM plan:', 'REPAIR:', 'plan:', 'csm-scan:', 'csm-browse:'];
  for (const prefix of prefixes) {
    assert.equal(
      analyzeCommitStyle([`${prefix} work item`]),
      'Task-identified',
      `expected ${prefix} to be task-identified`,
    );
  }
});

test('task-identifier mixed-case prefixes classify as Task-identified', () => {
  assert.equal(analyzeCommitStyle(['Plan: amend dimension', 'Csm-Scan: extend vocab']), 'Task-identified');
});

test('task-prefixed log keeps task label when it dominates', () => {
  const subjects = [
    'T005: extend vocabulary',
    'T007: write unit test',
    'P2C: activate pipeline',
  ];
  assert.equal(analyzeCommitStyle(subjects), 'Task-identified');
});

test('hybrid of conventional and task styles yields a mixed label', () => {
  const subjects = ['feat: a', 'fix: b', 'T005: c', 'T007: d', 'plain-ish', 'free text'];
  assert.equal(analyzeCommitStyle(subjects), 'Mixed — 33% conventional');
});

test('plain subjects keep their label', () => {
  const subjects = ['just a change', 'another plain subject', 'so free-form', 'no colon here'];
  assert.equal(analyzeCommitStyle(subjects), 'Unstructured / free-form');
});

test('emoji subjects keep their label', () => {
  assert.equal(analyzeCommitStyle(['✨ sparkles', '🔥 hot', '✨ more']), 'Emoji-prefixed');
});

test('semantic-like prefixes keep their label', () => {
  const subjects = ['FIX: uppercase type', 'FEAT: mixed case', 'REVERT: uppercase'];
  assert.equal(analyzeCommitStyle(subjects), 'Semantic-like prefixes');
});

test('emitted labels are aggregate-only and never carry raw subjects', () => {
  const subjects = ['T007: implement classifier', 'feat: add thing', 'plan: freeze output'];
  const label = analyzeCommitStyle(subjects);
  for (const subject of subjects) {
    assert.ok(!label.includes(subject), `label must not leak raw subject: ${label}`);
  }
  assert.ok(!label.includes('T007'), 'label must not leak the task identifier');
});
