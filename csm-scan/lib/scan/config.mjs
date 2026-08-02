import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function detectEslint(repoPath) {
  const flatConfigs = [
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  ];
  for (const f of flatConfigs) {
    if (existsSync(join(repoPath, f))) return { config: f, style: 'flat' };
  }
  const legacyConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml'];
  for (const f of legacyConfigs) {
    if (existsSync(join(repoPath, f))) return { config: f, style: 'legacy' };
  }
  return null;
}

function detectPrettier(repoPath) {
  const configs = [
    '.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.json',
    '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml',
    'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs',
  ];
  for (const f of configs) {
    if (existsSync(join(repoPath, f))) return f;
  }
  const pkg = readJSON(join(repoPath, 'package.json'));
  if (pkg?.prettier) return 'package.json prettier key';
  return null;
}

function detectTsConfig(repoPath) {
  const base = readJSON(join(repoPath, 'tsconfig.json'));
  if (!base) return null;
  const result = { config: 'tsconfig.json', strict: false, target: null, paths: false };
  if (base.compilerOptions) {
    result.strict = base.compilerOptions.strict === true;
    result.target = base.compilerOptions.target || null;
    result.paths = !!base.compilerOptions.paths;
  }
  return result;
}

function detectCI(repoPath) {
  const workflowsDir = join(repoPath, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return null;
  try {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    if (files.length === 0) return null;
    const jobs = new Set();
    for (const f of files) {
      const content = readFileSync(join(workflowsDir, f), 'utf-8');
      const jobMatches = content.matchAll(/^  (\w[\w-]*):\s*$/gm);
      for (const m of jobMatches) {
        if (m[1] !== 'on' && m[1] !== 'jobs' && m[1] !== 'env' && !m[1].startsWith('runs')) {
          jobs.add(m[1]);
        }
      }
      const nameMatches = content.matchAll(/^\s*name:\s*(.+)$/gm);
      for (const m of nameMatches) {
        if (!m[1].includes('CI') && !m[1].includes('Build') && !m[1].includes('Test') && !m[1].includes('Deploy')) {
          continue;
        }
        jobs.add(m[1].trim());
      }
    }
    return { platform: 'GitHub Actions', workflowCount: files.length, jobs: [...jobs].slice(0, 10) };
  } catch {
    return null;
  }
}

function detectDocker(repoPath) {
  const files = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'];
  const found = files.filter((f) => existsSync(join(repoPath, f)));
  return found.length > 0 ? found : null;
}

function detectEnvVars(repoPath) {
  const samples = ['.env.example', '.env.sample', '.env.template', '.env.development', '.env.development.example'];
  const found = [];
  for (const f of samples) {
    if (existsSync(join(repoPath, f))) {
      try {
        const content = readFileSync(join(repoPath, f), 'utf-8');
        const vars = content
          .split('\n')
          .filter((line) => /^[A-Z_]+=/.test(line))
          .map((line) => line.split('=')[0]);
        found.push({ file: f, varCount: vars.length, vars: vars.slice(0, 20) });
      } catch {
        found.push({ file: f, varCount: 0, vars: [] });
      }
    }
  }
  return found.length > 0 ? found : null;
}

export async function scanConfig(repoPath) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const scripts = pkg?.scripts || {};

  const lint = detectEslint(repoPath);
  const format = detectPrettier(repoPath);
  const typescript = detectTsConfig(repoPath);
  const ci = detectCI(repoPath);
  const docker = detectDocker(repoPath);
  const envVars = detectEnvVars(repoPath);

  return {
    lint: lint ? { config: lint.config, style: lint.style } : null,
    format: format || null,
    typescript: typescript || null,
    scripts: Object.keys(scripts).length > 0 ? scripts : null,
    ci,
    docker,
    envVars,
  };
}
