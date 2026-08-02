import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function findTestFiles(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' --glob '!coverage' 2>/dev/null | rg '\\.(test|spec)\\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$' || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean);
  const relFiles = files.map((f) => f.startsWith(repoPath) ? relative(repoPath, f) : f);

  const dirs = new Set();
  for (const f of relFiles) {
    const dir = f.includes('/') ? f.split('/').slice(0, -1).join('/') : '.';
    dirs.add(dir);
  }

  const testDirs = [...dirs].filter((d) =>
    d === '.' ||
    d.startsWith('test') ||
    d.startsWith('spec') ||
    d.includes('__tests__') ||
    d.includes('spec') ||
    d.includes('test')
  );
  const srcTestDirs = [...dirs].filter((d) =>
    d.startsWith('src') || d.startsWith('lib') || d.startsWith('app')
  );

  const namingPatterns = new Set();
  for (const f of relFiles) {
    const basename = f.split('/').pop();
    if (basename.includes('.test.')) namingPatterns.add('*.test.*');
    if (basename.includes('.spec.')) namingPatterns.add('*.spec.*');
  }

  return {
    files: relFiles,
    count: files.length,
    testDirs: testDirs.length > 0 ? testDirs : srcTestDirs,
    naming: [...namingPatterns],
  };
}

function detectTestFramework(deps, devDeps) {
  const allDeps = { ...deps, ...devDeps };
  const names = Object.keys(allDeps);

  const frameworks = [];
  if (names.includes('vitest')) frameworks.push('vitest');
  if (names.includes('jest')) frameworks.push('jest');
  if (names.includes('mocha')) frameworks.push('mocha');
  if (names.includes('jasmine')) frameworks.push('jasmine');
  if (names.includes('ava')) frameworks.push('ava');
  if (names.includes('playwright') || names.includes('@playwright/test')) frameworks.push('playwright');
  if (names.includes('cypress')) frameworks.push('cypress');
  if (names.includes('@testing-library/react') || names.includes('@testing-library/dom')) frameworks.push('testing-library');

  return frameworks.length > 0 ? frameworks : ['unknown'];
}

function detectCoverageTool(repoPath, devDeps) {
  const allDeps = Object.keys(devDeps || {});
  const tools = [];

  if (allDeps.includes('nyc') || allDeps.includes('@c8/nyc')) tools.push('nyc');
  if (allDeps.includes('c8')) tools.push('c8');
  if (allDeps.includes('vitest')) tools.push('vitest (built-in)');
  if (allDeps.includes('jest')) tools.push('jest (built-in)');

  if (existsSync(join(repoPath, '.nycrc'))) tools.push('nyc');
  if (existsSync(join(repoPath, 'coverage') || existsSync(join(repoPath, '.coverage')))) {
    if (tools.length === 0) tools.push('unknown (coverage dir present)');
  }

  return tools.length > 0 ? tools : null;
}

function detectTestConfig(repoPath) {
  const configs = [];
  const files = [
    'vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs',
    'jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.json',
    '.mocharc.js', '.mocharc.json', '.mocharc.yml', '.mocharc.yaml',
    'playwright.config.ts', 'playwright.config.js',
    'cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs',
    'karma.conf.js', 'ava.config.js',
  ];
  for (const f of files) {
    if (existsSync(join(repoPath, f))) {
      configs.push(f);
    }
  }
  return configs.length > 0 ? configs : null;
}

export async function scanTesting(repoPath) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const testFiles = findTestFiles(repoPath);
  const deps = pkg?.dependencies || {};
  const devDeps = pkg?.devDependencies || {};

  const framework = detectTestFramework(deps, devDeps);
  const coverage = detectCoverageTool(repoPath, devDeps);
  const configFiles = detectTestConfig(repoPath);
  const testScript = (pkg?.scripts && (pkg.scripts.test || pkg.scripts['test:coverage'] || pkg.scripts['test:e2e'])) || null;

  return {
    framework,
    testDirs: testFiles.testDirs,
    fileCount: testFiles.count,
    naming: testFiles.naming,
    sampleFiles: testFiles.files.slice(0, 15),
    coverage,
    configFiles,
    script: testScript ? (typeof testScript === 'string' ? testScript : JSON.stringify(testScript)) : null,
  };
}
