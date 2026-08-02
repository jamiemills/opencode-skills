import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

function detectImportStyle(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null | rg '\\.(mjs|js|ts|tsx|mts|cts|jsx)$' | head -20 || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean);
  if (files.length === 0) return { type: 'unknown', samples: [] };

  let esmCount = 0;
  let cjsCount = 0;
  let typeImportCount = 0;
  let hasDynamic = false;
  const samples = [];

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (/^\s*import\s/.test(line)) {
          esmCount++;
          if (/import\s+type\s/.test(line)) typeImportCount++;
          if (samples.length < 5) samples.push({ file: filePath.replace(repoPath + '/', ''), line: line.trim() });
        }
        if (/^\s*const\s+\w+\s*=\s*require\s*\(/.test(line) || /^\s*var\s+\w+\s*=\s*require\s*\(/.test(line)) {
          cjsCount++;
        }
        if (/\bimport\s*\(/.test(line)) {
          hasDynamic = true;
        }
      }
    } catch {
      continue;
    }
  }

  let type = 'unknown';
  if (esmCount > 0 && cjsCount === 0) type = 'ESM (import/export)';
  else if (cjsCount > 0 && esmCount === 0) type = 'CJS (require/module.exports)';
  else if (esmCount > 0 && cjsCount > 0) type = 'Mixed (ESM + CJS)';

  return {
    type,
    esmCount,
    cjsCount,
    hasTypeImports: typeImportCount > 0,
    hasDynamicImports: hasDynamic,
    samples: samples.slice(0, 5),
  };
}

function detectFileNaming(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null | rg -v '^\\.[^/]+$' | head -80 || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean).map((f) => {
    const parts = f.split('/').pop().split('.');
    return parts.length > 1 ? parts.slice(0, -1).join('.') : parts[0];
  });

  const patterns = { camelCase: 0, 'kebab-case': 0, PascalCase: 0, snake_case: 0, other: 0 };
  const samples = { camelCase: [], 'kebab-case': [], PascalCase: [], snake_case: [] };

  for (const name of files) {
    if (!name || name.startsWith('.') || name.length === 0) continue;
    if (/^[a-z][a-zA-Z0-9]*$/.test(name)) {
      patterns.camelCase++;
      if (samples.camelCase.length < 3) samples.camelCase.push(name);
    } else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
      patterns['kebab-case']++;
      if (samples['kebab-case'].length < 3) samples['kebab-case'].push(name);
    } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      patterns.PascalCase++;
      if (samples.PascalCase.length < 3) samples.PascalCase.push(name);
    } else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) {
      patterns.snake_case++;
      if (samples.snake_case.length < 3) samples.snake_case.push(name);
    } else {
      patterns.other++;
    }
  }

  const total = Object.values(patterns).reduce((a, b) => a + b, 0);
  if (total === 0) return { dominant: 'unknown', patterns: {}, samples: {} };

  const dominant = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0][0];
  return { dominant, patterns, samples, total };
}

function detectErrorHandling(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null | rg '\\.(mjs|js|ts|tsx|mts|cts|jsx)$' | head -30 || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean);
  if (files.length === 0) return { patterns: [], counts: {} };

  let tryCatchCount = 0;
  let catchChainCount = 0;
  let throwCount = 0;
  let assertCount = 0;

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      tryCatchCount += (content.match(/\btry\s*\{/g) || []).length;
      catchChainCount += (content.match(/\.catch\s*\(/g) || []).length;
      throwCount += (content.match(/\bthrow\s+(?!new\s+Error)/g) || []).length;
      throwCount += (content.match(/\bthrow\s+new\s+\w+/g) || []).length;
      assertCount += (content.match(/\bassert\s*\(/g) || []).length;
      assertCount += (content.match(/\bexpect\s*\(/g) || []).length;
    } catch {
      continue;
    }
  }

  const primary = [];
  if (tryCatchCount > 0) primary.push('try/catch');
  if (catchChainCount > 0) primary.push('.catch() chaining');
  if (throwCount > 0) primary.push(`throw (${throwCount} instances)`);
  if (assertCount > 0) primary.push('assert/expect');

  return {
    patterns: primary.length > 0 ? primary : ['not detected'],
    counts: { tryCatch: tryCatchCount, catchChain: catchChainCount, throw: throwCount, assert: assertCount },
  };
}

function detectModuleSystem(repoPath) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const pkgType = pkg?.type || null;

  return {
    packageJsonType: pkgType,
    inferred: pkgType === 'module' ? 'ESM' : pkgType === 'commonjs' ? 'CJS' : 'auto (from file extensions or default)',
  };
}

function findLargestFiles(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' --glob '!coverage' --glob '!*.lock' --glob '!*.lockb' --glob '!*.png' --glob '!*.jpg' --glob '!*.svg' --glob '!*.ico' --glob '!*.woff*' 2>/dev/null | head -200 || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean);
  if (files.length === 0) return [];

  const sized = [];
  for (const filePath of files) {
    try {
      const stat = statSync(filePath);
      if (stat.size > 0) {
        sized.push({ path: filePath.replace(repoPath + '/', ''), size: stat.size });
      }
    } catch {
      continue;
    }
  }

  sized.sort((a, b) => b.size - a.size);
  return sized.slice(0, 5).map((f) => ({
    path: f.path,
    size: f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`,
    bytes: f.size,
  }));
}

function estimateCommentDensity(repoPath) {
  const output = safeExec(
    `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null | rg '\\.(mjs|js|ts|tsx|mts|cts|jsx)$' | head -20 || true`,
    repoPath,
  );
  const files = output.split('\n').filter(Boolean);
  if (files.length === 0) return null;

  let totalLines = 0;
  let commentLines = 0;

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      totalLines += lines.length;
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('<!--') ||
          trimmed === '*/'
        ) {
          commentLines++;
        }
      }
    } catch {
      continue;
    }
  }

  if (totalLines === 0) return null;
  const density = ((commentLines / totalLines) * 100).toFixed(1);
  return `${density}% (${commentLines} comment lines / ${totalLines} total lines sampled)`;
}

export async function scanConventions(repoPath) {
  const importStyle = detectImportStyle(repoPath);
  const fileNaming = detectFileNaming(repoPath);
  const errorHandling = detectErrorHandling(repoPath);
  const moduleSystem = detectModuleSystem(repoPath);
  const largestFiles = findLargestFiles(repoPath);
  const commentDensity = estimateCommentDensity(repoPath);

  return {
    importStyle,
    fileNaming,
    errorHandling,
    moduleSystem,
    largestFiles,
    commentDensity,
  };
}
