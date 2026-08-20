// Data-driven ecosystem descriptor table.
//
// Single declarative source of truth for the 5 in-scope ecosystems
// (python, javascript, typescript, shell, rust). Deep scanners consult
// this table instead of hardcoding JS-only maps.
//
// ESM only. Zero npm deps. node: builtins only.
// This module is pure DATA plus two tiny helper functions; it performs no
// filesystem or network access.

// ---------------------------------------------------------------------------
// T210 provider contribution point
// ---------------------------------------------------------------------------
// `descriptorObservations` / `descriptorProviderResults` expose the five
// built-in descriptors as inert provider observations. They are ADDITIVE:
// they never change the descriptor tables, `detectEcosystems`, or
// `descriptorFor`, so the focused ecosystem tests stay byte-identical. Results
// are built through the provider foundation and are immutable.

import { deepFreeze } from '../contracts/evidence.mjs';
import { createProviderResult } from '../providers/base.mjs';

function descriptorObservation(category, matchedKey, details, sourceKind) {
  return { category, path: null, matchedKey, details, sourceKind };
}

/**
 * Derive provider observations from a built-in ecosystem descriptor.
 * Pure and deterministic; never throws for a known ecosystem.
 * @param {string} ecosystemId
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen).
 */
export function descriptorObservations(ecosystemId) {
  const descriptor = DESCRIPTORS[ecosystemId];
  if (!descriptor) return [];
  const groups = [];
  groups.push({
    dimensionId: 'DIM-stack-v1',
    observations: [
      descriptorObservation('language', 'language', { id: descriptor.id, label: descriptor.label }, 'repository_metadata'),
      ...(descriptor.runtimes ?? []).map((rt) => descriptorObservation(
        'runtime', `runtime:${rt.name}`, { name: rt.name }, 'repository_metadata',
      )),
      ...(descriptor.packageManagers ?? []).map((name) => descriptorObservation(
        'package_manager', `package-manager:${name}`, { name }, 'repository_metadata',
      )),
    ],
  });
  groups.push({
    dimensionId: 'DIM-config-v1',
    observations: [
      ...(descriptor.linters ?? []).map((spec) => descriptorObservation(
        'lint', `lint:${spec.name}`, { name: spec.name, files: spec.files }, 'config',
      )),
      ...(descriptor.formatters ?? []).map((spec) => descriptorObservation(
        'format', `format:${spec.name}`, { name: spec.name, files: spec.files }, 'config',
      )),
    ],
  });
  groups.push({
    dimensionId: 'DIM-testing-v1',
    observations: Object.entries(descriptor.testFrameworks ?? {}).map(([key, label]) => descriptorObservation(
      'framework', `test-framework:${key}`, { name: label, key }, 'repository_metadata',
    )),
  });
  groups.push({
    dimensionId: 'DIM-assurance-v1',
    observations: [
      ...(descriptor.manifests ?? []).map((name) => descriptorObservation(
        'manifest', `manifest:${name}`, { name }, 'manifest',
      )),
      ...(descriptor.lockfiles ?? []).map((name) => descriptorObservation(
        'lock', `lock:${name}`, { name }, 'lockfile',
      )),
    ],
  });
  return deepFreeze(groups.filter(({ observations }) => observations.length > 0));
}

/**
 * Build immutable provider results from a built-in descriptor. Inert:
 * consumed only by tests and future provider catalogs.
 * @param {string} ecosystemId
 * @returns {object[]} Deep-frozen provider results (empty for unknown ids).
 */
export function descriptorProviderResults(ecosystemId) {
  const provider = `PRV-${ecosystemId}-builtin-v1`;
  return descriptorObservations(ecosystemId).map(({ dimensionId, observations }) => (
    createProviderResult({ providerId: provider, dimensionId, observations })
  ));
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

// Hook config files are ecosystem-agnostic. Defined once and referenced by
// each descriptor so there is exactly one place to edit.
const HOOK_FILES = [
  'lefthook.yml',
  'lefthook.yaml',
  '.pre-commit-config.yaml',
  '.husky',
];

// Maps a Linguist-style language name (lowercased) to an ecosystem id.
// Used by detectEcosystems() when a manifest does not declare ecosystems.
const LANGUAGE_TO_ECOSYSTEM = {
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  shell: 'shell',
  'shell script': 'shell',
  bash: 'shell',
  rust: 'rust',
};

// ---------------------------------------------------------------------------
// Ecosystem descriptors
// ---------------------------------------------------------------------------

const PYTHON = {
  id: 'python',
  label: 'Python',
  manifests: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
  lockfiles: ['uv.lock', 'poetry.lock', 'Pipfile.lock', 'pdm.lock'],
  runtimes: [
    {
      name: 'Python',
      manifestField: 'requiresPython',
      manifestSource: 'pyproject.toml#requires-python',
      versionFiles: ['.python-version'],
      toolVersions: ['python'],
      images: ['python'],
    },
  ],
  packageManagers: ['uv', 'pip', 'poetry', 'pipenv', 'hatch'],
  extensions: ['.py', '.pyi'],
  markers: ['py.typed', 'MANIFEST.in', '.python-version', 'runtime.txt'],
  frameworks: {
    click: 'Click',
    typer: 'Typer',
    fastapi: 'FastAPI',
    django: 'Django',
    flask: 'Flask',
    starlette: 'Starlette',
    sanic: 'Sanic',
    aiohttp: 'AIOHttp',
    tornado: 'Tornado',
    rich: 'Rich',
    httpx: 'HTTPX',
  },
  testFrameworks: {
    pytest: 'pytest',
    unittest: 'unittest (stdlib)',
    hypothesis: 'Hypothesis',
    nox: 'nox',
    tox: 'tox',
    'pytest-asyncio': 'pytest-asyncio',
    'pytest-xdist': 'pytest-xdist',
    'pytest-mock': 'pytest-mock',
    behave: 'Behave',
    robotframework: 'Robot Framework',
  },
  testFileGlobs: ['tests/test_*.py', 'tests/**/test_*.py', 'conftest.py'],
  testConfigFiles: [
    'pytest.ini',
    'tox.ini',
    'noxfile.py',
    'setup.cfg',
    'conftest.py',
    'pyproject.toml:[tool.pytest.ini_options]',
  ],
  linters: [
    { name: 'ruff', files: ['ruff.toml', '.ruff.toml', 'pyproject.toml:[tool.ruff]'] },
    { name: 'flake8', files: ['.flake8', 'setup.cfg:[flake8]', 'tox.ini:[flake8]'] },
    { name: 'pylint', files: ['.pylintrc', 'pylintrc', 'pyproject.toml:[tool.pylint]'] },
    { name: 'bandit', files: ['pyproject.toml:[tool.bandit]', '.bandit'] },
    { name: 'vulture', files: ['pyproject.toml:[tool.vulture]'] },
    { name: 'mypy', files: ['mypy.ini', '.mypy.ini', 'pyproject.toml:[tool.mypy]', 'setup.cfg:[mypy]'] },
    { name: 'pyright', files: ['pyproject.toml:[tool.pyright]', 'pyrightconfig.json'] },
    { name: 'deptry', files: ['pyproject.toml:[tool.deptry]'] },
    { name: 'semgrep', files: ['.semgrep.yml', '.semgrep.yaml', '.semgrep'] },
    { name: 'pydocstyle', files: ['.pydocstyle', 'setup.cfg:[pydocstyle]', 'tox.ini:[pydocstyle]', 'pyproject.toml:[tool.pydocstyle]'] },
    { name: 'prospector', files: ['.prospector.yaml', '.prospector.yml', 'prospector.yaml', '.prospector'] },
    { name: 'dlint', files: ['.dlint.toml', 'pyproject.toml:[tool.dlint]', 'setup.cfg:[dlint]'] },
  ],
  formatters: [
    { name: 'black', files: ['pyproject.toml:[tool.black]'] },
    { name: 'isort', files: ['.isort.cfg', 'pyproject.toml:[tool.isort]', 'setup.cfg:[isort]', 'tox.ini:[isort]'] },
    { name: 'ruff-format', files: ['pyproject.toml:[tool.ruff.format]', 'ruff.toml', '.ruff.toml'] },
    { name: 'autopep8', files: ['pyproject.toml:[tool.autopep8]', 'setup.cfg:[autopep8]'] },
    { name: 'yapf', files: ['.style.yapf', 'setup.cfg:[yapf]', 'pyproject.toml:[tool.yapf]'] },
    { name: 'blue', files: ['pyproject.toml:[tool.blue]'] },
    { name: 'flynt', files: ['pyproject.toml:[tool.flynt]'] },
  ],
  typeCheckers: [
    { name: 'pyright', files: ['pyproject.toml:[tool.pyright]', 'pyrightconfig.json'] },
    { name: 'mypy', files: ['mypy.ini', '.mypy.ini', 'pyproject.toml:[tool.mypy]', 'setup.cfg:[mypy]'] },
    { name: 'pytype', files: ['pyproject.toml:[tool.pytype]', '.pytype'] },
    { name: 'pyre-check', files: ['.pyre_configuration', 'pyre.cfg'] },
    { name: 'pyrefly', files: ['pyproject.toml:[tool.pyrefly]', '.pyreflyconfig'] },
  ],
  coverage: [
    { name: 'coverage.py', files: ['.coveragerc', 'setup.cfg:[coverage:run]', 'pyproject.toml:[tool.coverage.run]'] },
  ],
  hookFiles: HOOK_FILES,
  importSyntax: {
    absolute: /^\s*(?:from\s+(\w[\w.]*)\s+import|import\s+(\w[\w.]*))/m,
    relative: /^\s*from\s+(\.{1,2}[\w.]*)\s+import/m,
  },
  exportsSyntax: {
    def: /^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/m,
    all: /\b__all__\s*=/m,
  },
};

const JAVASCRIPT = {
  id: 'javascript',
  label: 'JavaScript',
  manifests: ['package.json'],
  lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'],
  runtimes: [
    {
      name: 'Node.js',
      manifestField: 'nodeVersion',
      manifestSource: 'package.json#engines.node',
      versionFiles: ['.nvmrc', '.node-version'],
      toolVersions: ['nodejs'],
      images: ['node', 'nodejs'],
    },
    { name: 'Bun', toolVersions: ['bun'], images: ['oven/bun', 'bun'], signals: ['bun.lock', 'bun.lockb', 'bunfig.toml'] },
    { name: 'Deno', toolVersions: ['deno'], images: ['denoland/deno', 'deno'], signals: ['deno.json', 'deno.jsonc', 'deno.lock'] },
  ],
  packageManagers: ['npm', 'yarn', 'pnpm', 'bun'],
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  markers: ['jsconfig.json', 'deno.json', 'deno.jsonc', 'bunfig.toml'],
  frameworks: {
    express: 'Express',
    fastify: 'Fastify',
    koa: 'Koa',
    next: 'Next.js',
    react: 'React',
    vue: 'Vue',
    svelte: 'Svelte',
    '@angular/core': 'Angular',
    '@nestjs/core': 'NestJS',
    nuxt: 'Nuxt',
  },
  testFrameworks: {
    jest: 'Jest',
    vitest: 'Vitest',
    mocha: 'Mocha',
    '@playwright/test': 'Playwright',
    cypress: 'Cypress',
    ava: 'AVA',
    'node:test': 'node:test (Node test runner)',
    tap: 'node-tap (TAP)',
    tape: 'tape',
    uvu: 'uvu',
    jasmine: 'Jasmine',
  },
  testFileGlobs: ['**/*.test.{js,mjs,cjs,jsx}', '**/*.spec.{js,mjs,cjs,jsx}'],
  testConfigFiles: [
    'jest.config.{js,ts,mjs,json}',
    'vitest.config.{ts,js,mjs}',
    '.mocharc.{js,json,yml}',
  ],
  linters: [
    {
      name: 'eslint',
      files: [
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts',
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.eslintrc.yml',
        '.eslintrc.yaml',
        'package.json#eslintConfig',
      ],
    },
    { name: 'biome', files: ['biome.json', 'biome.jsonc'] },
    { name: 'standard', files: ['package.json#standard'] },
    { name: 'jshint', files: ['.jshintrc', '.jshintrc.json', '.jshintrc.js', 'package.json#jshintConfig'] },
    { name: 'oxlint', files: ['.oxlintrc.json', 'oxlintrc.json'] },
  ],
  formatters: [
    {
      name: 'prettier',
      files: [
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.yml',
        '.prettierrc.yaml',
        '.prettierrc.js',
        '.prettierrc.cjs',
        '.prettierrc.toml',
        'prettier.config.js',
        'prettier.config.cjs',
        'prettier.config.mjs',
        'package.json#prettier',
      ],
    },
    { name: 'biome', files: ['biome.json', 'biome.jsonc'] },
    { name: 'dprint', files: ['dprint.json', 'dprint.jsonc'] },
  ],
  typeCheckers: [],
  hookFiles: HOOK_FILES,
  importSyntax: {
    relative: /(?:from|require\()\s*['"](\.{1,2}[^'"]*)['"]/,
  },
  exportsSyntax: {
    export: /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/m,
    moduleExports: /module\.exports\b/,
  },
};

const TYPESCRIPT = {
  id: 'typescript',
  label: 'TypeScript',
  manifests: ['package.json', 'tsconfig.json'],
  lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'],
  runtimes: [...JAVASCRIPT.runtimes],
  packageManagers: ['npm', 'yarn', 'pnpm', 'bun'],
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  markers: ['jsconfig.json', 'deno.json', 'deno.jsonc', 'bunfig.toml'],
  frameworks: { ...JAVASCRIPT.frameworks },
  testFrameworks: {
    ...JAVASCRIPT.testFrameworks,
    'ts-jest': 'ts-jest',
    '@swc/jest': '@swc/jest',
    'ts-node': 'ts-node',
    tsx: 'tsx',
    '@types/jest': '@types/jest',
  },
  testFileGlobs: ['**/*.{test,spec}.{ts,tsx,mts,cts}'],
  testConfigFiles: [
    'jest.config.{js,ts,mjs,json}',
    'vitest.config.{ts,js,mjs}',
    '.mocharc.{js,json,yml}',
    'tsconfig.json',
  ],
  linters: [
    {
      name: 'eslint',
      files: [
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts',
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.eslintrc.yml',
        '.eslintrc.yaml',
        'package.json#eslintConfig',
      ],
    },
    {
      name: '@typescript-eslint',
      files: [
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts',
      ],
    },
    { name: 'biome', files: ['biome.json', 'biome.jsonc'] },
  ],
  formatters: [
    {
      name: 'prettier',
      files: [
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.yml',
        '.prettierrc.yaml',
        '.prettierrc.js',
        '.prettierrc.cjs',
        '.prettierrc.toml',
        'prettier.config.js',
        'prettier.config.cjs',
        'prettier.config.mjs',
        'package.json#prettier',
      ],
    },
    { name: 'biome', files: ['biome.json', 'biome.jsonc'] },
  ],
  typeCheckers: [{ name: 'tsc', files: ['tsconfig.json'] }],
  hookFiles: HOOK_FILES,
  importSyntax: {
    relative: /(?:from|require\()\s*['"](\.{1,2}[^'"]*)['"]/,
  },
  exportsSyntax: {
    export: /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/m,
    moduleExports: /module\.exports\b/,
  },
};

const SHELL = {
  id: 'shell',
  label: 'Shell',
  manifests: [],
  lockfiles: [],
  runtimes: [{ name: 'Shell' }],
  packageManagers: [],
  extensions: ['.sh', '.bash', '.zsh'],
  markers: [],
  frameworks: {},
  testFrameworks: {
    bats: 'bats',
    shellspec: 'ShellSpec',
    shunit2: 'shUnit2',
  },
  testFileGlobs: ['*.bats', 'tests/**/*.bats'],
  testConfigFiles: [],
  linters: [
    { name: 'shellcheck', files: ['.shellcheckrc', 'shellcheckrc'] },
    { name: 'bashate', files: ['.bashaterc', 'tox.ini:[bashate]'] },
  ],
  formatters: [
    { name: 'shfmt', files: ['.editorconfig'], marker: true },
  ],
  typeCheckers: [{ name: 'shellcheck', files: ['.shellcheckrc', 'shellcheckrc'], analysis: true }],
  hookFiles: HOOK_FILES,
  importSyntax: {
    source: /^\s*(?:source|\.)\s+([\w./-]+)/m,
  },
  exportsSyntax: {
    fn: /^(\w+)\s*\(\s*\)\s*\{/m,
  },
};

const RUST = {
  id: 'rust',
  label: 'Rust',
  manifests: ['Cargo.toml'],
  lockfiles: ['Cargo.lock'],
  runtimes: [
    {
      name: 'Rust',
      manifestField: 'rustVersion',
      manifestSource: 'Cargo.toml#rust-version',
      versionFiles: ['rust-toolchain', 'rust-toolchain.toml'],
      toolVersions: ['rust'],
      images: ['rust'],
    },
  ],
  packageManagers: ['cargo'],
  extensions: ['.rs'],
  markers: ['.cargo/config.toml', 'rust-toolchain.toml', 'rust-toolchain', 'build.rs'],
  frameworks: {
    tokio: 'Tokio',
    'actix-web': 'Actix Web',
    axum: 'Axum',
    rocket: 'Rocket',
    serde: 'Serde',
    clap: 'Clap',
  },
  testFrameworks: {
    cargo: 'cargo test',
    '#[test]': 'builtin',
    proptest: 'Proptest',
    quickcheck: 'QuickCheck',
    trybuild: 'trybuild',
    rstest: 'rstest',
    criterion: 'Criterion (bench)',
    mockall: 'Mockall',
    insta: 'Insta',
  },
  testFileGlobs: ['*_test.rs', 'tests/**/*.rs'],
  testConfigFiles: [],
  linters: [
    { name: 'clippy', files: ['Cargo.toml:[lints]', 'clippy.toml', '.clippy.toml'] },
  ],
  formatters: [
    { name: 'rustfmt', files: ['rustfmt.toml', '.rustfmt.toml'] },
  ],
  typeCheckers: [
    { name: 'rustc', files: ['Cargo.toml'] },
  ],
  hookFiles: HOOK_FILES,
  importSyntax: {
    crate: /^\s*use\s+crate::([\w:]+)/m,
    mod: /^\s*mod\s+(\w+)/m,
    self: /^\s*use\s+self::([\w:]+)/m,
    super: /^\s*use\s+super::([\w:]+)/m,
  },
  exportsSyntax: {
    pubFn: /^\s*pub\s+(?:async\s+)?fn\s+(\w+)/m,
    pubStruct: /^\s*pub\s+struct\s+(\w+)/m,
    pubEnum: /^\s*pub\s+enum\s+(\w+)/m,
  },
};

const DESCRIPTORS = {
  python: PYTHON,
  javascript: JAVASCRIPT,
  typescript: TYPESCRIPT,
  shell: SHELL,
  rust: RUST,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ecosystemScore(ecosystem, languageScores) {
  if (!languageScores || typeof languageScores !== 'object') return 0;
  let best = 0;
  for (const [lang, score] of Object.entries(languageScores)) {
    const mapped = LANGUAGE_TO_ECOSYSTEM[String(lang).toLowerCase()];
    if (mapped === ecosystem) {
      const n = Number(score);
      if (Number.isFinite(n) && n > best) best = n;
    }
  }
  return best;
}

/**
 * Determine the ranked set of ecosystems for a repo.
 *
 * @param {object} overview - survey overview (uses `languages`, `languageScores`).
 * @param {object} manifest - normalized manifest (uses `ecosystems`).
 * @returns {{ primary: string|null, all: string[] }}
 *   `primary` is the highest-ranked ecosystem id or null when none detected.
 *   `all` is the ranked list (highest score first). Never throws.
 */
export function detectEcosystems(overview, manifest) {
  const ov = overview || {};
  const mf = manifest || {};
  const scores = ov.languageScores || {};

  let candidates;
  if (Array.isArray(mf.ecosystems) && mf.ecosystems.length > 0) {
    candidates = mf.ecosystems.filter((e) => typeof e === 'string' && e);
  } else {
    candidates = [];
    const langs = Array.isArray(ov.languages) ? ov.languages : [];
    for (const lang of langs) {
      const eco = LANGUAGE_TO_ECOSYSTEM[String(lang).toLowerCase()];
      if (eco && !candidates.includes(eco)) candidates.push(eco);
    }
  }

  const ranked = candidates
    .map((id, idx) => ({ id, score: ecosystemScore(id, scores), idx }))
    .toSorted((a, b) => b.score - a.score || a.idx - b.idx)
    .map((x) => x.id);

  return {
    primary: ranked.length > 0 ? ranked[0] : null,
    all: ranked,
  };
}

/**
 * Look up a descriptor by ecosystem id.
 * @param {string} ecosystemId
 * @returns {object|null} the descriptor object, or null if unknown.
 */
export function descriptorFor(ecosystemId) {
  return DESCRIPTORS[ecosystemId] || null;
}

export { DESCRIPTORS };
