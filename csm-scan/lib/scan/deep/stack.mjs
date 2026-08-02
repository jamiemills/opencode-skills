import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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

function detectFramework(deps, devDeps) {
  const allDeps = { ...deps, ...devDeps };
  const names = Object.keys(allDeps);
  if (names.includes('next')) return 'Next.js';
  if (names.includes('react')) return 'React';
  if (names.includes('vue')) return 'Vue';
  if (names.includes('svelte')) return 'Svelte';
  if (names.includes('@angular/core')) return 'Angular';
  if (names.includes('@nestjs/core')) return 'NestJS';
  if (names.includes('express')) return 'Express';
  if (names.includes('fastify')) return 'Fastify';
  if (names.includes('koa')) return 'Koa';
  if (names.includes('hapi')) return 'Hapi';
  if (names.includes('nuxt')) return 'Nuxt';
  if (names.includes('gatsby')) return 'Gatsby';
  if (names.includes('remix')) return 'Remix';
  if (names.includes('astro')) return 'Astro';
  return 'None detected';
}

function detectPackageManager(repoPath) {
  if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(repoPath, 'bun.lockb'))) return 'bun';
  if (existsSync(join(repoPath, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function detectRuntime(pkg, repoPath) {
  if (pkg?.engines?.node) return `Node.js ${pkg.engines.node}`;
  const nodeVersion = safeExec('node --version', repoPath);
  if (nodeVersion) return `Node.js ${nodeVersion.replace(/^v/, '')}`;
  return 'unknown';
}

export async function scan(repoPath, overview) {
  const pkgPath = join(repoPath, 'package.json');
  const pkg = readJSON(pkgPath);

  const language = overview?.languages?.[0] || (existsSync(join(repoPath, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript');
  const packageManager = detectPackageManager(repoPath);
  const runtime = detectRuntime(pkg, repoPath);
  const framework = pkg ? detectFramework(pkg.dependencies || {}, pkg.devDependencies || {}) : 'N/A';

  const keyDeps = pkg?.dependencies ? Object.keys(pkg.dependencies).slice(0, 30) : [];
  const keyDevDeps = pkg?.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 30) : [];

  const scripts = pkg?.scripts || {};

  const hasDocker =
    existsSync(join(repoPath, 'Dockerfile')) ||
    existsSync(join(repoPath, 'docker-compose.yml')) ||
    existsSync(join(repoPath, 'docker-compose.yaml'));

  const hasCI = existsSync(join(repoPath, '.github', 'workflows'));

  const totalDeps = Object.keys(pkg?.dependencies || {}).length +
    Object.keys(pkg?.devDependencies || {}).length;
  let signal = 'low';
  if (pkg && totalDeps > 10) signal = 'high';
  else if (pkg) signal = 'medium';

  return {
    dimension: 'stack',
    signal,
    findings: {
      hasPackageJson: !!pkg,
      name: pkg?.name || null,
      version: pkg?.version || null,
      type: pkg?.type || null,
      main: pkg?.main || null,
      language,
      runtime,
      framework,
      packageManager,
      keyDeps,
      keyDevDeps,
      deps: pkg?.dependencies || {},
      devDeps: pkg?.devDependencies || {},
      scripts,
      docker: hasDocker,
      ci: hasCI,
    },
  };
}
