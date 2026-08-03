// T226 topic fixture — Development Practices (all seven categories + craft).
//
// Positive case for the DIM-practices-v1 dimension: exercises every category
// (methodology, enforcement, automation, ritual, quality_gate,
// agent_workflow, style_guide) including hidden-directory artifacts that
// `rg --files` prunes (`.github`, `.agents`, `.opencode`, `.devcontainer`,
// root `AGENTS.md`/`CLAUDE.md`/`opencode.jsonc`), a `.feature` file, a
// `[tool.mutmut]` section, a hypothesis dependency, `quality/gates.conf`
// with threshold keys, and a ruff config declaring line-length style values.
//
// It also carries the craft-fact source signals consumed by the fixture
// matrix: unused-code markers (a vulture whitelist, a `[tool.vulture]`
// section, a `no-unused-vars` suppression, a `#[allow(dead_code)]`
// attribute) and an internal import edge (src/app.js -> src/lib.js) so the
// architecture graph facts exist for the provider-derived coupling and
// design-pattern claims.

export const files = {
  // methodology
  'features/login.feature': 'Feature: Login\nScenario: a user can log in\n',
  'strategies.py': [
    'from hypothesis import given',
    '@given()',
    'def test_a_strategy():',
    '    return True',
  ].join('\n'),
  'fuzz_corpus/seed.txt': 'seed bytes\n',
  'pyproject.toml': [
    '[project.dependencies]',
    'hypothesis = ">=6.0"',
    'mutmut = ">=2.0"',
    '',
    '[tool.mutmut]',
    'paths = ["src"]',
    '',
    '[tool.vulture]',
    'paths = ["src"]',
    '',
    '[tool.ruff]',
    'line-length = 88',
    'quote-style = "double"',
    '',
    '[tool.black]',
    'line-length = 100',
  ].join('\n'),
  // enforcement
  'commitlint.config.js': 'module.exports = { extends: ["@commitlint/config-conventional"] };\n',
  '.gitlint': '[general]\nignore=title-trailing-punctuation\n',
  'lefthook.yml': [
    'pre-commit:',
    '  commands:',
    '    lint:',
    '      run: pnpm lint',
    '    format:',
    '      run: pnpm format',
  ].join('\n'),
  '.github/workflows/ci.yml': [
    'name: CI',
    'jobs:',
    '  lint:',
    '    steps:',
    '      - uses: wagoid/commitlint-github-action@v5',
    '  mutation:',
    '    steps:',
    '      - run: mutmut run',
    '  publish:',
    '    steps:',
    '      - run: npm publish',
  ].join('\n'),
  // automation
  '.github/release-drafter.yml': 'template: release-drafter.yml\n',
  'dependabot.yml': 'version: 2\nupdates: []\n',
  'renovate.json': '{"extends": ["config:base"]}\n',
  'mkdocs.yml': 'site_name: Demo\n',
  '.devcontainer/devcontainer.json': '{"image": "node:20"}\n',
  // ritual
  'CHANGELOG.md': '## [Unreleased]\n## [1.0.0] - 2024-01-15\n',
  '.github/PULL_REQUEST_TEMPLATE.md': '# PR\n## Summary\n## Checklist\n## Definition of Done\n',
  '.github/ISSUE_TEMPLATE/bug.md': '## Expected Behavior\n## Actual Behavior\n',
  // quality gate
  'quality/gates.conf': 'MIN_COVERAGE=85\nMAX_COMPLEXITY=10\nMAX_LINES=500\n',
  'test/baselines/coverage.json': '{"coverage": 85}\n',
  'ratchet.sh': '#!/bin/sh\nratchet check\n',
  // agent workflow
  'AGENTS.md': '# Agents\nCommands and conventions.\n',
  'CLAUDE.md': '# Claude\n',
  'opencode.jsonc': '{"model": "claude"}\n',
  '.opencode/config.json': '{"skills": []}\n',
  '.agents/plans/feature-csm.md': '# Plan\n## Control\n## Status\n',
  '.agents/docs/guide.md': '# Guide\n',
  'quality/remediation/notes.md': '# Remediation\n',
  // style guide
  'ruff.toml': 'line-length = 100\n',
  '.prettierrc': '{"printWidth": 100, "singleQuote": true}\n',
  'rustfmt.toml': 'max_width = 100\n',
  'docs/principles.md': '# Principles\n\nThe Zen of Python and PEP 20 guide us.\n',
  'package.json': '{"devDependencies": {"eslint-config-airbnb": "^19.0.0"}}\n',
  // craft source signals
  'src/app.js': "import { helper } from './lib.js';\nconsole.log(helper);\n",
  'src/lib.js': 'export function helper() { return 1; }\n',
  'src/dead.js': [
    '// eslint-disable-next-line no-unused-vars',
    'export function unused() { return 1; }',
  ].join('\n'),
  'src/lib.rs': '#[allow(dead_code)]\nfn helper() {}\n',
  'vulture_whitelist.py': '# whitelisted names\n',
};
