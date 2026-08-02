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

function detectDocstrings(repoPath, overview) {
  const languages = overview?.languages || [];
  const result = { patterns: {}, coverage: {}, samples: [] };

  if (languages.includes('JavaScript') || languages.includes('TypeScript')) {
    const jsFiles = safeExec(
      `rg --files --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | rg '\\.(m?js|tsx?|mts|cts)$' | head -30 || true`,
      repoPath,
    ).split('\n').filter(Boolean);

    let exportsTotal = 0;
    let exportsDocumented = 0;
    const jsdocSamples = [];

    for (const filePath of jsFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/^\s*(export\s+(default\s+)?(function|class|const|let|var|type|interface|enum)\s+\w+)/.test(line)) {
            exportsTotal++;
            if (i > 0 && lines[i - 1].trim().startsWith('/**')) {
              exportsDocumented++;
              if (jsdocSamples.length < 3) {
                jsdocSamples.push({
                  file: filePath.replace(repoPath + '/', ''),
                  symbol: line.match(/(function|class|const|let|var|type|interface|enum)\s+(\w+)/)?.[2] || 'unknown',
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (exportsTotal > 0) {
      const pct = ((exportsDocumented / exportsTotal) * 100).toFixed(0);
      result.patterns['JavaScript/TypeScript'] = 'JSDoc (/** ... */)';
      result.coverage['JavaScript/TypeScript'] = `${pct}% (${exportsDocumented}/${exportsTotal} exports documented)`;
      result.samples = result.samples.concat(jsdocSamples.map(s => ({ ...s, language: 'JS/TS' })));
    }
  }

  if (languages.includes('Python')) {
    const pyFiles = safeExec(
      `rg --files --glob '!__pycache__' --glob '!venv' --glob '!.venv' 2>/dev/null | rg '\\.(py|pyi)$' | head -30 || true`,
      repoPath,
    ).split('\n').filter(Boolean);

    let funcsTotal = 0;
    let funcsDocumented = 0;
    const pySamples = [];

    for (const filePath of pyFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*def\s+\w+/.test(lines[i]) || /^\s*class\s+\w+/.test(lines[i])) {
            funcsTotal++;
            if (i > 0 && (lines[i - 1].trim().startsWith('"""') || lines[i - 1].trim().startsWith("'''"))) {
              funcsDocumented++;
              if (pySamples.length < 3) {
                pySamples.push({
                  file: filePath.replace(repoPath + '/', ''),
                  symbol: lines[i].match(/(def|class)\s+(\w+)/)?.[2] || 'unknown',
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (funcsTotal > 0) {
      const pct = ((funcsDocumented / funcsTotal) * 100).toFixed(0);
      result.patterns['Python'] = 'Docstrings (PEP 257)';
      result.coverage['Python'] = `${pct}% (${funcsDocumented}/${funcsTotal} functions documented)`;
      result.samples = result.samples.concat(pySamples.map(s => ({ ...s, language: 'Python' })));
    }
  }

  if (languages.includes('Rust')) {
    const rsFiles = safeExec(
      `rg --files --glob '!target' 2>/dev/null | rg '\\.rs$' | head -30 || true`,
      repoPath,
    ).split('\n').filter(Boolean);

    let itemsTotal = 0;
    let itemsDocumented = 0;
    const rsSamples = [];

    for (const filePath of rsFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*(pub\s+)?(fn|struct|enum|trait|impl)\s+\w+/.test(lines[i])) {
            itemsTotal++;
            if (i > 0 && lines[i - 1].trim().startsWith('///')) {
              itemsDocumented++;
              if (rsSamples.length < 3) {
                rsSamples.push({
                  file: filePath.replace(repoPath + '/', ''),
                  symbol: lines[i].match(/(fn|struct|enum|trait)\s+(\w+)/)?.[2] || 'unknown',
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (itemsTotal > 0) {
      const pct = ((itemsDocumented / itemsTotal) * 100).toFixed(0);
      result.patterns['Rust'] = 'Rustdoc (/// ...)';
      result.coverage['Rust'] = `${pct}% (${itemsDocumented}/${itemsTotal} items documented)`;
      result.samples = result.samples.concat(rsSamples.map(s => ({ ...s, language: 'Rust' })));
    }
  }

  if (languages.includes('Go')) {
    const goFiles = safeExec(
      `rg --files --glob '!vendor' 2>/dev/null | rg '\\.go$' | head -30 || true`,
      repoPath,
    ).split('\n').filter(Boolean);

    let exportsTotal = 0;
    let exportsDocumented = 0;
    const goSamples = [];

    for (const filePath of goFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*(func|type|var|const)\s+[A-Z]\w*/.test(lines[i])) {
            exportsTotal++;
            if (i > 0 && /^\s*\/\/\s+\w+\s/.test(lines[i - 1])) {
              exportsDocumented++;
              if (goSamples.length < 3) {
                goSamples.push({
                  file: filePath.replace(repoPath + '/', ''),
                  symbol: lines[i].match(/(func|type|var|const)\s+(\w+)/)?.[2] || 'unknown',
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (exportsTotal > 0) {
      const pct = ((exportsDocumented / exportsTotal) * 100).toFixed(0);
      result.patterns['Go'] = 'GoDoc (// comment before declaration)';
      result.coverage['Go'] = `${pct}% (${exportsDocumented}/${exportsTotal} exports documented)`;
      result.samples = result.samples.concat(goSamples.map(s => ({ ...s, language: 'Go' })));
    }
  }

  return result;
}

function detectLanguageStandards(overview) {
  const languages = overview?.languages || [];
  const standards = [];
  const inferred = [];

  if (languages.includes('Python')) {
    standards.push('PEP 8 (style guide)');
    standards.push('PEP 257 (docstrings)');
    standards.push('PEP 484 (type hints)');
    if (existsSync(join(overview?.path || '', 'pyproject.toml'))) standards.push('PEP 621 (pyproject.toml)');
    if (existsSync(join(overview?.path || '', '.flake8'))) inferred.push('flake8 config');
    if (existsSync(join(overview?.path || '', '.pylintrc'))) inferred.push('pylint config');
  }

  if (languages.includes('TypeScript')) {
    standards.push('@typescript-eslint (TS ESLint)');
    standards.push('TSDoc');
    if (existsSync(join(overview?.path || '', 'tsconfig.json'))) standards.push('tsconfig.json (strict mode detection)');
  }

  if (languages.includes('JavaScript')) {
    standards.push('ESLint recommended');
    standards.push('JSDoc');
    if (!languages.includes('TypeScript')) standards.push('Prettier (implied by JS ecosystem)');
  }

  if (languages.includes('Rust')) {
    standards.push('rustfmt (formatting)');
    standards.push('clippy (linting)');
    standards.push('rust-analyzer conventions');
    if (existsSync(join(overview?.path || '', 'rustfmt.toml'))) inferred.push('rustfmt.toml present');
    if (existsSync(join(overview?.path || '', 'clippy.toml'))) inferred.push('clippy.toml present');
  }

  if (languages.includes('Go')) {
    standards.push('gofmt (formatting)');
    standards.push('golint (deprecated, replaced by staticcheck)');
    standards.push('Effective Go');
    if (existsSync(join(overview?.path || '', 'go.mod'))) inferred.push('go.mod present');
  }

  if (languages.includes('Java')) {
    standards.push('Checkstyle / Sun/Oracle conventions');
    if (existsSync(join(overview?.path || '', 'checkstyle.xml'))) inferred.push('checkstyle config present');
  }

  return { standards, inferred };
}

export async function scan(repoPath, overview) {
  const importStyle = detectImportStyle(repoPath);
  const fileNaming = detectFileNaming(repoPath);
  const errorHandling = detectErrorHandling(repoPath);
  const moduleSystem = detectModuleSystem(repoPath);
  const largestFiles = findLargestFiles(repoPath);
  const commentDensity = estimateCommentDensity(repoPath);
  const docstrings = detectDocstrings(repoPath, overview);
  const languageStandards = detectLanguageStandards(overview);

  const hasLanguages = (overview?.languages?.length || 0) > 0;
  const hasDocstrings = Object.keys(docstrings.coverage).length > 0;
  let signal = 'low';
  if (hasLanguages && hasDocstrings) signal = 'high';
  else if (hasLanguages) signal = 'medium';

  return {
    dimension: 'conventions',
    signal,
    findings: {
      importStyle,
      fileNaming,
      errorHandling,
      moduleSystem,
      largestFiles,
      commentDensity,
      docstrings,
      languageStandards,
    },
  };
}
