import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const LANG_SIGNALS = {
  JavaScript: { exts: ['.js', '.jsx', '.mjs', '.cjs'], configs: ['package.json'], weight: 3 },
  TypeScript: { exts: ['.ts', '.tsx', '.mts', '.cts'], configs: ['tsconfig.json'], weight: 5 },
  Python: { exts: ['.py', '.pyi', '.pyx'], configs: ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile'], weight: 4 },
  Go: { exts: ['.go'], configs: ['go.mod', 'go.sum'], weight: 4 },
  Rust: { exts: ['.rs'], configs: ['Cargo.toml', 'Cargo.lock'], weight: 4 },
  Java: { exts: ['.java'], configs: ['pom.xml', 'build.gradle', 'build.gradle.kts'], weight: 3 },
  Ruby: { exts: ['.rb'], configs: ['Gemfile', 'Rakefile'], weight: 3 },
  Shell: { exts: ['.sh', '.bash', '.zsh'], configs: [], weight: 1 },
  Markdown: { exts: ['.md', '.mdx'], configs: [], weight: 1 },
};

async function langFromFiles(repoPath) {
  let scores = {};
  try {
    const { stdout } = await execFileAsync('rg', ['--files', '--no-ignore-vcs'], { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
    const files = stdout.trim().split('\n').filter(Boolean);
    
    for (const f of files) {
      const name = f.split('/').pop() || '';
      const ext = name.includes('.') ? '.' + name.split('.').slice(1).join('.') : '';
      const baseExt = name.includes('.') ? '.' + name.split('.').pop() : '';
      
      for (const [lang, sig] of Object.entries(LANG_SIGNALS)) {
        if (sig.exts.includes(ext) || sig.exts.includes(baseExt)) {
          scores[lang] = (scores[lang] || 0) + 1;
        }
        if (sig.configs.includes(name)) {
          scores[lang] = (scores[lang] || 0) + 3;
        }
      }
    }
  } catch {}

  const detected = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter(([, s]) => s > 2)
    .map(([lang]) => lang);

  return { detected, scores };
}

async function repoStats(repoPath) {
  try {
    const { stdout } = await execFileAsync('rg', ['--files'], { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
    const files = stdout.trim().split('\n').filter(Boolean);
    const totalFiles = files.length;
    const totalBytes = files.length * 1000; // rough estimate
    return { totalFiles, totalBytes };
  } catch {
    return { totalFiles: 0, totalBytes: 0 };
  }
}

export async function survey(repoPath) {
  console.log(`  [SURVEY] Scanning ${repoPath}...`);
  const langs = await langFromFiles(repoPath);
  const stats = await repoStats(repoPath);

  let gitRoot = repoPath;
  let isGit = false;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], { timeout: 5000 });
    gitRoot = stdout.trim();
    isGit = true;
  } catch {}

  let name = repoPath.split('/').pop();
  let description = '';
  try {
    const pkg = JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf-8'));
    name = pkg.name || name;
    description = pkg.description || '';
  } catch {}

  let packageManager = 'unknown';
  try {
    await execFileAsync('test', ['-f', join(repoPath, 'package-lock.json')]);
    packageManager = 'npm';
  } catch { try {
    await execFileAsync('test', ['-f', join(repoPath, 'yarn.lock')]);
    packageManager = 'yarn';
  } catch { try {
    await execFileAsync('test', ['-f', join(repoPath, 'pnpm-lock.yaml')]);
    packageManager = 'pnpm';
  } catch {}}}

  return {
    path: repoPath,
    gitRoot,
    isGit,
    name,
    description,
    languages: langs.detected,
    languageScores: langs.scores,
    packageManager,
    totalFiles: stats.totalFiles,
    totalBytes: stats.totalBytes,
  };
}

export async function detectLanguages(repoPath) {
  const { detected } = await langFromFiles(repoPath);
  return detected;
}
