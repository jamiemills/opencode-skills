import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function safeExec(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

function readFile(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function findFile(repoPath, names) {
  for (const name of names) {
    const p = join(repoPath, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function detectBadges(content) {
  if (!content) return { count: 0, types: [] };
  const types = [];
  const badgeRe = /!\[[^\]]*\]\(https:\/\/img\.shields\.io\/[^)]+\)/g;
  const matches = content.match(badgeRe) || [];
  if (content.includes('codecov')) types.push('coverage');
  if (content.includes('npm') && content.includes('shields')) types.push('npm');
  if (content.includes('ci') || content.includes('build')) types.push('build');
  if (content.includes('license') && content.includes('shields')) types.push('license');
  if (content.includes('version') && content.includes('shields')) types.push('version');
  return { count: matches.length, types };
}

function checkReadmeStructure(content) {
  if (!content) return { hasSetup: false, hasArchitecture: false, hasApi: false, hasContributing: false };
  const lower = content.toLowerCase();
  return {
    hasSetup: /(installation|setup|getting started|quickstart)/i.test(lower),
    hasArchitecture: /\barchitecture\b/i.test(lower),
    hasApi: /\bapi\b/i.test(lower) && (lower.includes('documentation') || lower.includes('reference')),
    hasContributing: /\bcontributing\b/i.test(lower),
    hasLicense: /\blicense\b/i.test(lower),
    sections: (content.match(/^#{1,3}\s+/gm) || []).length,
  };
}

function checkChangelog(repoPath) {
  const clPath = findFile(repoPath, ['CHANGELOG.md', 'Changelog.md', 'CHANGES.md', 'HISTORY.md']);
  if (!clPath) return { present: false, format: 'none' };

  let format = 'free-form';
  try {
    const content = readFileSync(clPath, 'utf-8');
    const kep = /keep a changelog/i.test(content);
    const semver = /\b(added|changed|deprecated|removed|fixed|security)\b/i.test(content);
    const versions = /\d+\.\d+\.\d+/g;
    const verMatches = content.match(versions);
    const hasVersionHeaders = verMatches && verMatches.length >= 2;

    if (kep && semver) format = 'Keep a Changelog';
    else if (hasVersionHeaders && semver) format = 'Semantic versioning with change categories';
    else if (hasVersionHeaders) format = 'Versioned entries';
    else format = 'free-form';
  } catch {}

  return { present: true, format, path: clPath };
}

function detectADRs(repoPath) {
  const patterns = ['docs/adr', 'doc/adr', 'adr', 'decisions', 'docs/decisions', 'doc/architecture/decisions'];
  const dirs = [];
  for (const pat of patterns) {
    const full = join(repoPath, pat);
    if (existsSync(full)) {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        const adrFiles = safeExec(`find . -maxdepth 1 -name '*.md' 2>/dev/null | wc -l`, full, '0');
        dirs.push({ path: pat, count: parseInt(adrFiles, 10) || 0 });
      }
    }
  }
  return dirs;
}

function computeCommentRatio(repoPath, lang) {
  const exts = lang === 'python' ? 'py' :
    lang === 'go' ? 'go' :
    lang === 'rust' ? 'rs' :
    'js,mjs,cjs,jsx,ts,mts,cts,tsx';

  const files = safeExec(
    `rg --files --glob '*.{${exts}}' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null || true`,
    repoPath
  ).split('\n').filter(Boolean);

  if (files.length === 0) return { ratio: 0, commentLines: 0, codeLines: 0 };

  let totalLines = 0;
  let commentLines = 0;

  for (const file of files.slice(0, 200)) {
    try {
      const content = readFileSync(join(repoPath, file), 'utf-8');
      const lines = content.split('\n');
      totalLines += lines.length;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\s*\/\//.test(trimmed) ||
            /^\s*\/\*/.test(trimmed) ||
            /^\s*\*/.test(trimmed) ||
            /^\s*#/.test(trimmed) ||
            /^\s*--/.test(trimmed) ||
            /^\s*<!--/.test(trimmed)) {
          commentLines++;
        }
      }
    } catch {}
  }

  const ratio = totalLines > 0 ? ((commentLines / totalLines) * 100).toFixed(1) : 0;
  return { ratio: parseFloat(ratio), commentLines, codeLines: totalLines - commentLines };
}

function detectLicense(repoPath) {
  const licFiles = [
    'LICENSE', 'LICENSE.md', 'LICENSE.txt',
    'LICENCE', 'LICENCE.md', 'LICENCE.txt',
    'COPYING', 'UNLICENSE',
  ];
  const found = findFile(repoPath, licFiles);
  if (!found) return { present: false, name: 'none' };

  let name = 'unknown';
  try {
    const content = readFileSync(found, 'utf-8').slice(0, 2000).toLowerCase();
    if (content.includes('mit license') || (content.includes('mit') && content.includes('permission'))) name = 'MIT';
    else if (content.includes('apache license') || content.includes('apache 2.0')) name = 'Apache-2.0';
    else if (content.includes('gnu general public license')) name = 'GPL';
    else if (content.includes('gnu lesser general public license')) name = 'LGPL';
    else if (content.includes('bsd')) name = 'BSD';
    else if (content.includes('isc')) name = 'ISC';
    else if (content.includes('unlicense')) name = 'Unlicense';
    else if (content.includes('mozilla public license')) name = 'MPL';
    else if (content.includes('creative commons')) name = 'CC';
    else name = 'Other (see file)';
  } catch {}

  return { present: true, name, path: found };
}

export async function scan(repoPath, overview) {
  const readmePath = findFile(repoPath, ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README']);
  const readmeContent = readmePath ? readFile(readmePath) : null;

  const badges = detectBadges(readmeContent);
  const readmeStructure = checkReadmeStructure(readmeContent);
  const changelog = checkChangelog(repoPath);
  const adrs = detectADRs(repoPath);

  const contributingPath = findFile(repoPath, ['CONTRIBUTING.md', 'Contributing.md', 'contributing.md', '.github/CONTRIBUTING.md']);
  const hasCodeOfConduct = existsSync(join(repoPath, 'CODE_OF_CONDUCT.md')) ||
    existsSync(join(repoPath, '.github/CODE_OF_CONDUCT.md'));

  const languages = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | grep -E '\\.(js|mjs|ts|py|go|rs)$' | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}'`,
    repoPath, ''
  ).trim();
  const langMap = { js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', go: 'go', rs: 'rust' };
  const dominantLang = langMap[languages] || 'javascript';

  const commentRatio = computeCommentRatio(repoPath, dominantLang);
  const license = detectLicense(repoPath);

  const todos = safeExec(
    "rg -il 'TODO|FIXME|HACK|XXX' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | wc -l",
    repoPath, '0'
  ).trim();

  const todoCount = parseInt(todos, 10) || 0;
  const signal = readmePath ? 'high' : 'medium';

  return {
    dimension: 'documentation',
    signal,
    findings: {
      readme: {
        present: !!readmePath,
        path: readmePath || null,
        badges: badges.count,
        badgeTypes: badges.types,
        ...readmeStructure,
      },
      contributing: {
        present: !!contributingPath,
        path: contributingPath || null,
      },
      codeOfConduct: hasCodeOfConduct,
      changelog,
      adrs,
      commentRatio,
      license,
      todoCount,
    },
  };
}
