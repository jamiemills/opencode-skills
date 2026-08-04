// Conventions deep scanner.
//
// Ecosystem-aware detection of import style, file naming, error handling,
// module system, comment density, docstrings, and language standards.
// Detection is driven by the shared ecosystem descriptor table and the
// normalized manifest — never hardcoded to JS/TS.
//
// Comment density uses the shared `comments.mjs` helper (T108) so that this
// scanner and `documentation.mjs` (T111) agree exactly for the same sample.
//
// ESM only. Zero npm deps. node: builtins only.
// Read-only with respect to the scanned repo.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';
import { descriptorFor, detectEcosystems, DESCRIPTORS } from '../shared/ecosystem.mjs';
import { readManifest } from '../shared/manifest.mjs';
import { countComments } from '../shared/comments.mjs';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readContent(absPath) {
  try {
    return readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Enumerate repo files (relative paths). Prefers a pre-enumerated
 * overview.files list; falls back to the T208 broker's fixed `rg:files`
 * command ID. Never shells out directly.
 */
async function listFiles(repoPath, overview, broker) {
  const fromOverview = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? overview.files
    : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute('rg:files', { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : '';
    return raw
      .split('\n')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function filterByExt(files, extensions) {
  const set = new Set(extensions);
  const out = [];
  for (const f of files) {
    const base = f.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) continue; // skip dotfiles and extensionless names
    if (set.has(base.slice(dot).toLowerCase())) out.push(f);
  }
  return out;
}

function pushSample(arr, file, line) {
  if (arr.length >= 5) return;
  const trimmed = String(line).trim();
  if (trimmed.length === 0) return;
  arr.push({ file, line: trimmed.slice(0, 200) });
}

function resolveEcosystems(repoPath, overview) {
  const ov = overview || {};
  if (ov.ecosystems && (ov.ecosystems.primary || (Array.isArray(ov.ecosystems.all) && ov.ecosystems.all.length > 0))) {
    return ov.ecosystems;
  }
  const manifest = ov.manifest || readManifest(repoPath);
  return detectEcosystems(
    { languages: ov.languages || [], languageScores: ov.languageScores || {} },
    manifest,
  );
}

function resolveManifest(repoPath, overview) {
  const ov = overview || {};
  if (ov.manifest) return ov.manifest;
  return readManifest(repoPath);
}

function readCargoEdition(repoPath) {
  try {
    const txt = readFileSync(join(repoPath, 'Cargo.toml'), 'utf-8');
    const m = txt.match(/^\s*edition\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  return '2015'; // Rust default edition when unspecified
}

// Union of all source-file extensions across ecosystem descriptors. Used to
// restrict file-naming sampling to real source files (not .md / configs).
function sourceExtensionSet() {
  const set = new Set();
  for (const desc of Object.values(DESCRIPTORS)) {
    for (const ext of (desc && desc.extensions) || []) set.add(ext.toLowerCase());
  }
  return set;
}

// ---------------------------------------------------------------------------
// Production source universe (A011)
// ---------------------------------------------------------------------------
// Convention counts (async, docstrings, type hints) are measured over the
// "production source universe": the primary package source tree (`src/**` when
// a `src/` directory exists, else the top-level package directory derived from
// the manifest name), excluding tests/fixtures and known test harness files.
// The universe rule is disclosed in every rendered count.

function isTestHarnessPath(relPath) {
  const segments = relPath.split('/');
  const base = segments[segments.length - 1] || '';
  if (segments.some((seg) => seg === 'test' || seg === 'tests' || seg === 'fixtures' || seg === '__pycache__')) {
    return true;
  }
  if (base === 'conftest.py' || base === 'conftest.pyi') return true;
  if (/^(?:test|tests)[_.]/i.test(base) || /[_.]test\./i.test(base)) return true;
  return false;
}

function packageRootPrefix(overview) {
  const manifest = overview && overview.manifest;
  const name = manifest && typeof manifest.name === 'string' ? manifest.name : null;
  if (!name || name.length === 0) return null;
  const segment = name.includes('/') ? name.split('/').pop() : name;
  const dir = segment.replace(/-/g, '_');
  return dir ? `${dir}/` : null;
}

function productionSourceFiles(files, overview) {
  const hasSrc = files.some((f) => f.startsWith('src/'));
  const prefix = hasSrc ? 'src/' : packageRootPrefix(overview);
  return files.filter((f) => {
    if (prefix && !f.startsWith(prefix)) return false;
    return !isTestHarnessPath(f);
  });
}

// ---------------------------------------------------------------------------
// Import style
// ---------------------------------------------------------------------------

function detectImportStyle(repoPath, overview, files) {
  const { all, primary } = resolveEcosystems(repoPath, overview);
  const samples = [];
  const byEcosystem = {};

  let esmCount = 0;
  let cjsCount = 0;
  let typeImportCount = 0;
  let hasDynamic = false;

  for (const eco of all) {
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, 30);
    if (subset.length === 0) continue;

    if (eco === 'python') {
      let absolute = 0;
      let relative = 0;
      for (const f of subset) {
        const content = readContent(join(repoPath, f));
        if (!content) continue;
        for (const line of content.split('\n')) {
          // P0-5: classify relative imports (from . / from ..) BEFORE absolute,
          // otherwise `from .x import y` also matches the absolute pattern and
          // relativeImports is left dead-coded.
          if (/^\s*from\s+[.]{1,2}/.test(line)) {
            relative++;
            pushSample(samples, f, line);
          } else if (
            /^\s*from\s+\S+\s+import/.test(line) ||
            /^\s*import\s+\S+/.test(line)
          ) {
            absolute++;
            pushSample(samples, f, line);
          }
        }
      }
      const type =
        absolute > 0 && relative > 0
          ? 'mixed (absolute + relative) imports (PEP 8)'
          : relative > 0
            ? 'relative imports (PEP 8)'
            : absolute > 0
              ? 'absolute imports (PEP 8)'
              : 'unknown';
      byEcosystem.python = { type, absoluteImports: absolute, relativeImports: relative };
    } else if (eco === 'rust') {
      let useCount = 0;
      for (const f of subset) {
        const content = readContent(join(repoPath, f));
        if (!content) continue;
        for (const line of content.split('\n')) {
          if (/^\s*use\s+/.test(line)) {
            useCount++;
            pushSample(samples, f, line);
          }
        }
      }
      byEcosystem.rust = { type: useCount > 0 ? 'use (Rust)' : 'unknown', useCount };
    } else if (eco === 'shell') {
      let sourceCount = 0;
      for (const f of subset) {
        const content = readContent(join(repoPath, f));
        if (!content) continue;
        for (const line of content.split('\n')) {
          if (/^\s*(?:source|\.)\s+/.test(line)) {
            sourceCount++;
            pushSample(samples, f, line);
          }
        }
      }
      byEcosystem.shell = { type: sourceCount > 0 ? 'source (Shell)' : 'unknown', sourceCount };
    } else if (eco === 'javascript' || eco === 'typescript') {
      for (const f of subset) {
        const content = readContent(join(repoPath, f));
        if (!content) continue;
        for (const line of content.split('\n')) {
          if (/^\s*import\s/.test(line)) {
            esmCount++;
            if (/import\s+type\s/.test(line)) typeImportCount++;
            pushSample(samples, f, line);
          }
          if (/^\s*(?:const|var|let)\s+\w+\s*=\s*require\s*\(/.test(line)) cjsCount++;
          if (/\bimport\s*\(/.test(line)) hasDynamic = true;
        }
      }
    }
  }

  // JS/TS headline
  let jsType = null;
  if (esmCount > 0 || cjsCount > 0) {
    if (esmCount > 0 && cjsCount === 0) jsType = 'ESM (import/export)';
    else if (cjsCount > 0 && esmCount === 0) jsType = 'CJS (require/module.exports)';
    else jsType = 'Mixed (ESM + CJS)';
    if (all.includes('javascript')) byEcosystem.javascript = { type: jsType, esmCount, cjsCount };
    if (all.includes('typescript')) byEcosystem.typescript = { type: jsType, esmCount, cjsCount };
  }

  // Headline type follows the primary ecosystem.
  let type = 'unknown';
  if (primary && byEcosystem[primary] && byEcosystem[primary].type !== 'unknown') {
    type = byEcosystem[primary].type;
  } else if (jsType) {
    type = jsType;
  } else {
    for (const eco of all) {
      if (byEcosystem[eco] && byEcosystem[eco].type !== 'unknown') {
        type = byEcosystem[eco].type;
        break;
      }
    }
  }

  return {
    type,
    esmCount,
    cjsCount,
    hasTypeImports: typeImportCount > 0,
    hasDynamicImports: hasDynamic,
    samples: samples.slice(0, 5),
    byEcosystem,
  };
}

// ---------------------------------------------------------------------------
// File naming (language-agnostic, source files only)
// ---------------------------------------------------------------------------

function detectFileNaming(repoPath, overview, files) {
  // P1: classify SOURCE extensions only (union of ecosystem descriptor
  // extensions) so .md / configs / lockfiles don't skew naming distribution.
  // The FULL enumeration universe is classified (no sampling cap); the
  // universe is disclosed in the rendered line. Checks run snake_case before
  // camelCase so mononyms (lowercase, no underscore, no internal capital) do
  // not fall through to camelCase: a camelCase name must contain an internal
  // uppercase letter.
  const srcExts = sourceExtensionSet();
  const sampled = files
    .filter((f) => {
      const base = f.split('/').pop() || '';
      const dot = base.lastIndexOf('.');
      return dot > 0 && srcExts.has(base.slice(dot).toLowerCase());
    })
    .map((f) => {
      const parts = f.split('/').pop().split('.');
      return parts.length > 1 ? parts.slice(0, -1).join('.') : parts[0];
    });

  const patterns = { camelCase: 0, 'kebab-case': 0, PascalCase: 0, snake_case: 0, other: 0 };
  const samples = { camelCase: [], 'kebab-case': [], PascalCase: [], snake_case: [] };

  for (const name of sampled) {
    if (!name || name.startsWith('.') || name.length === 0) continue;
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) {
      patterns.snake_case++;
      if (samples.snake_case.length < 3) samples.snake_case.push(name);
    } else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) {
      patterns['kebab-case']++;
      if (samples['kebab-case'].length < 3) samples['kebab-case'].push(name);
    } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      patterns.PascalCase++;
      if (samples.PascalCase.length < 3) samples.PascalCase.push(name);
    } else if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(name)) {
      patterns.camelCase++;
      if (samples.camelCase.length < 3) samples.camelCase.push(name);
    } else {
      patterns.other++;
    }
  }

  const total = Object.values(patterns).reduce((a, b) => a + b, 0);
  if (total === 0) return { dominant: 'unknown', patterns: {}, samples: {}, total: 0 };

  const dominant = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0][0];
  return { dominant, patterns, samples, total, universe: 'full source-file enumeration' };
}

// ---------------------------------------------------------------------------
// Symbol-level naming conventions (all ecosystems where applicable)
// ---------------------------------------------------------------------------

// Classify a symbol name into a naming convention. `lowerDefault` is the
// convention a single lowercase word assumes per ecosystem ('snake_case' for
// python/rust, 'camelCase' for js/ts) since such names are inherently
// ambiguous. Leading underscores (dunder / private) are folded into the native
// convention.
function classifySymbolName(name, lowerDefault) {
  if (!name) return 'other';
  const core = name.replace(/^_+/, '');
  if (!core) return 'other';
  if (/^[A-Z][A-Z0-9_]*$/.test(core) && core.includes('_')) return 'UPPER';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(core)) return 'PascalCase';
  if (core.includes('_') && /^[a-z][a-z0-9_]*$/.test(core)) return 'snake_case';
  if (/^[a-z][a-zA-Z0-9]*$/.test(core) && /[A-Z]/.test(core)) return 'camelCase';
  if (/^[a-z][a-z0-9]*$/.test(core)) return lowerDefault;
  return 'other';
}

function detectSymbolNaming(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  const counts = { snake_case: 0, camelCase: 0, PascalCase: 0, UPPER: 0, other: 0 };

  const lowerDefaultFor = (eco) => (eco === 'javascript' || eco === 'typescript' ? 'camelCase' : 'snake_case');

  for (const eco of all) {
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, 40);
    const def = lowerDefaultFor(eco);
    for (const f of subset) {
      const content = readContent(join(repoPath, f));
      if (!content) continue;

      if (eco === 'python') {
        for (const m of content.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(/^\s*([A-Z][A-Z0-9]*_[A-Z0-9_]*)\s*=/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
      } else if (eco === 'javascript' || eco === 'typescript') {
        for (const m of content.matchAll(
          /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
        )) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(
          /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/gm,
        )) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(/^\s*type\s+([A-Za-z_$][\w$]*)/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(/^\s*(?:const|var|let)\s+([A-Z][A-Z0-9]*_[A-Z0-9_]*)\s*=/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
      } else if (eco === 'rust') {
        for (const m of content.matchAll(/^\s*(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(
          /^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/gm,
        )) {
          counts[classifySymbolName(m[1], def)]++;
        }
        for (const m of content.matchAll(/^\s*(?:pub\s+)?const\s+([A-Z][A-Z0-9]*_[A-Z0-9_]*)/gm)) {
          counts[classifySymbolName(m[1], def)]++;
        }
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return { dominant: 'unknown', counts, total: 0 };
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return { dominant, counts, total };
}

// ---------------------------------------------------------------------------
// Error handling (ecosystem-aware matchers)
// ---------------------------------------------------------------------------

function detectErrorHandling(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  const counts = {};
  const bump = (name, n = 1) => {
    counts[name] = (counts[name] || 0) + n;
  };

  for (const eco of all) {
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, 40);
    if (subset.length === 0) continue;

    if (eco === 'python') {
      for (const f of subset) {
        const c = readContent(join(repoPath, f));
        if (!c) continue;
        bump('try', (c.match(/^\s*try\s*:/gm) || []).length);
        bump('except', (c.match(/^\s*except\b/gm) || []).length);
        bump('raise', (c.match(/^\s*raise\b/gm) || []).length);
        bump('custom exceptions', (c.match(/^\s*class\s+\w+\([^)]*Exception[^)]*\)/gm) || []).length);
      }
    } else if (eco === 'javascript' || eco === 'typescript') {
      for (const f of subset) {
        const c = readContent(join(repoPath, f));
        if (!c) continue;
        bump('try/catch', (c.match(/\btry\s*\{/g) || []).length);
        bump('.catch()', (c.match(/\.catch\s*\(/g) || []).length);
        bump('throw', (c.match(/\bthrow\b/g) || []).length);
        bump('assert/expect', (c.match(/\b(?:assert|expect)\s*\(/g) || []).length);
        // P1: custom exception classes (class X extends Error).
        bump('custom exceptions', (c.match(/\bclass\s+\w+\s+extends\s+\w*Error\b/g) || []).length);
      }
    } else if (eco === 'rust') {
      for (const f of subset) {
        const c = readContent(join(repoPath, f));
        if (!c) continue;
        bump('Result', (c.match(/\bResult\b/g) || []).length);
        bump('? operator', (c.match(/[)\w]\?/g) || []).length);
        bump('panic!', (c.match(/\bpanic!/g) || []).length);
        // P1: Rust error-handling vocabulary.
        bump('Option', (c.match(/\bOption\b/g) || []).length);
        bump('unwrap()', (c.match(/\.unwrap\s*\(\s*\)/g) || []).length);
        bump('expect()', (c.match(/\.expect\s*\(/g) || []).length);
        bump('context()', (c.match(/\.context\s*\(/g) || []).length);
      }
    } else if (eco === 'shell') {
      for (const f of subset) {
        const c = readContent(join(repoPath, f));
        if (!c) continue;
        bump('trap', (c.match(/^\s*trap\b/gm) || []).length);
        bump('set -e', (c.match(/\bset\s+-[A-Za-z]*e\b/g) || []).length);
      }
    }
  }

  // Rust error libraries surfaced from the normalized manifest deps.
  const manifest = resolveManifest(repoPath, overview);
  const deps = manifest ? { ...manifest.dependencies, ...manifest.devDependencies } : {};
  if (all.includes('rust')) {
    if (Object.keys(deps).some((d) => /anyhow/.test(d))) counts['anyhow'] = counts['anyhow'] || 'dependency';
    if (Object.keys(deps).some((d) => /thiserror/.test(d))) counts['thiserror'] = counts['thiserror'] || 'dependency';
  }

  const patterns = Object.keys(counts).filter((k) => counts[k] !== 0);
  return { patterns, counts };
}

// ---------------------------------------------------------------------------
// Async/await usage (JS/TS/Python/Rust)
// ---------------------------------------------------------------------------

function detectAsyncUsage(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  const production = productionSourceFiles(files, overview);
  const byEcosystem = {};
  let sourceFiles = 0;

  for (const eco of all) {
    if (eco !== 'python' && eco !== 'javascript' && eco !== 'typescript' && eco !== 'rust') continue;
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(production, desc.extensions);
    if (subset.length === 0) continue;
    sourceFiles += subset.length;

    let asyncCount = 0;
    let awaitCount = 0;
    for (const f of subset) {
      const c = readContent(join(repoPath, f));
      if (!c) continue;
      if (eco === 'python') {
        asyncCount += (c.match(/^\s*async\s+def\s+/gm) || []).length;
        awaitCount += (c.match(/\bawait\b/g) || []).length;
      } else if (eco === 'javascript' || eco === 'typescript') {
        asyncCount += (c.match(/\basync\s+(?:function|\(|\w+\s*=>)/g) || []).length;
        awaitCount += (c.match(/\bawait\b/g) || []).length;
      } else if (eco === 'rust') {
        asyncCount += (c.match(/\basync\s+fn\b/g) || []).length;
        awaitCount += (c.match(/\.await\b/g) || []).length;
      }
    }
    byEcosystem[eco] = { async: asyncCount, await: awaitCount, files: subset.length };
  }

  const asyncCount = Object.values(byEcosystem).reduce((a, e) => a + (e.async || 0), 0);
  const awaitCount = Object.values(byEcosystem).reduce((a, e) => a + (e.await || 0), 0);
  return { async: asyncCount, await: awaitCount, sourceFiles, byEcosystem };
}

// ---------------------------------------------------------------------------
// Rust `unsafe` accounting (P0-10)
// ---------------------------------------------------------------------------

function detectUnsafe(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  if (!all.includes('rust')) return { count: 0, kinds: {} };
  const desc = descriptorFor('rust');
  const subset = filterByExt(files, desc.extensions).slice(0, 60);
  const kinds = { block: 0, fn: 0, impl: 0, trait: 0, extern: 0, other: 0 };
  let count = 0;

  for (const f of subset) {
    const c = readContent(join(repoPath, f));
    if (!c) continue;
    for (const m of c.matchAll(/\bunsafe\b/g)) {
      const tail = c.slice(m.index + 6).match(/^\s*(\{|fn|impl|trait|extern)/);
      count++;
      if (!tail) kinds.other++;
      else if (tail[1] === '{') kinds.block++;
      else kinds[tail[1]] = (kinds[tail[1]] || 0) + 1;
    }
  }

  return { count, kinds };
}

// ---------------------------------------------------------------------------
// Python type-hint posture (P1)
// ---------------------------------------------------------------------------

// Read the declared pyright `typeCheckingMode` from `[tool.pyright]` in
// pyproject.toml or from pyrightconfig.json. Bounded raw-text scan; the value
// is emitted as a token fact (never source text beyond the mode identifier).
function readPyrightMode(repoPath) {
  const pyprojectText = readContent(join(repoPath, 'pyproject.toml'));
  if (pyprojectText != null) {
    const header = pyprojectText.match(/^\s*\[tool\.pyright\]\s*$/m);
    if (header) {
      const body = pyprojectText.slice(header.index + header[0].length).split(/\r?\n/);
      for (const line of body) {
        if (/^\s*\[/.test(line)) break;
        const kv = line.match(/^\s*typeCheckingMode\s*=\s*["']?([A-Za-z0-9_-]+)/);
        if (kv) return kv[1];
      }
    }
  }
  const pyrightConfig = readJSON(join(repoPath, 'pyrightconfig.json'));
  if (pyrightConfig && typeof pyrightConfig.typeCheckingMode === 'string') {
    return pyrightConfig.typeCheckingMode;
  }
  return null;
}

function detectPythonTypeHints(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  if (!all.includes('python')) return null;
  const desc = descriptorFor('python');
  const production = productionSourceFiles(files, overview);
  const subset = filterByExt(production, desc.extensions);

  let totalDefs = 0;
  let annotatedDefs = 0; // defs with a return annotation `-> T`
  let paramAnnotated = 0; // defs with at least one `name: type` parameter
  let futureAnnotations = false;

  for (const f of subset) {
    const c = readContent(join(repoPath, f));
    if (!c) continue;
    if (/^\s*from\s+__future__\s+import\s+[^\n]*annotations/m.test(c)) futureAnnotations = true;
    const defRe = /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*[^:]+)?\s*:/gm;
    let m;
    while ((m = defRe.exec(c)) !== null) {
      totalDefs++;
      if (m[3]) annotatedDefs++;
      if (/\b\w+\s*:\s*\S/.test(m[2])) paramAnnotated++;
    }
  }

  const pyrightTypeCheckingMode = readPyrightMode(repoPath);
  if (totalDefs === 0) {
    return {
      totalDefs,
      annotatedDefs,
      paramAnnotated,
      ratio: 0,
      futureAnnotations,
      sourceFiles: subset.length,
      pyrightTypeCheckingMode,
      pyrightStrict: pyrightTypeCheckingMode === 'strict',
    };
  }
  const ratio = parseFloat(((annotatedDefs / totalDefs) * 100).toFixed(1));
  return {
    totalDefs,
    annotatedDefs,
    paramAnnotated,
    ratio,
    futureAnnotations,
    sourceFiles: subset.length,
    pyrightTypeCheckingMode,
    pyrightStrict: pyrightTypeCheckingMode === 'strict',
  };
}

// ---------------------------------------------------------------------------
// TS annotation density + interface vs type ratio (P2)
// ---------------------------------------------------------------------------

function detectTsAnnotations(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  if (!all.includes('typescript')) return null;
  const subset = filterByExt(files, descriptorFor('typescript').extensions).slice(0, 40);

  let interfaceCount = 0;
  let typeCount = 0;
  let annotationLines = 0;
  let codeLines = 0;

  for (const f of subset) {
    const c = readContent(join(repoPath, f));
    if (!c) continue;
    interfaceCount += (c.match(/^\s*(?:export\s+)?interface\s+\w+/gm) || []).length;
    typeCount += (c.match(/^\s*(?:export\s+)?type\s+\w+\s*=/gm) || []).length;
    for (const line of c.split('\n')) {
      if (line.trim() === '') continue;
      codeLines++;
      if (/:\s*(?:[\w$@'"{[(])/.test(line)) annotationLines++;
    }
  }

  return {
    interfaceCount,
    typeCount,
    interfaceVsTypeRatio: typeCount > 0 ? parseFloat((interfaceCount / typeCount).toFixed(2)) : interfaceCount > 0 ? Infinity : 0,
    annotationDensity: codeLines > 0 ? parseFloat(((annotationLines / codeLines) * 100).toFixed(1)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Shell hygiene (P0-14 module system lives separately; P1/P2 here)
// ---------------------------------------------------------------------------

function detectShellHygiene(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);
  if (!all.includes('shell')) return null;
  const desc = descriptorFor('shell');
  const subset = filterByExt(files, desc.extensions);
  const total = subset.length;

  let filesWithPipefail = 0;
  const shebang = { present: 0, envBased: 0, hardcoded: 0 };
  let shellcheckDirectives = 0;

  for (const f of subset) {
    const c = readContent(join(repoPath, f));
    if (!c) continue;
    if (/\bset\s+-[A-Za-z]*u[A-Za-z]*\b/.test(c) && /\bset\s+-[A-Za-z]*e[A-Za-z]*\b/.test(c) && /pipefail/.test(c)) {
      filesWithPipefail++;
    } else if (/^\s*set\s+-[A-Za-z]*euo\s+pipefail\b/m.test(c)) {
      filesWithPipefail++;
    }
    const first = c.split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
    if (first.startsWith('#!')) {
      shebang.present++;
      if (/^#!\/usr\/bin\/env\s+/.test(first)) shebang.envBased++;
      else shebang.hardcoded++;
    }
    shellcheckDirectives += (c.match(/#\s*shellcheck\s+(?:enable|disable|source)\b/g) || []).length;
  }

  const adoption = total > 0 ? parseFloat(((filesWithPipefail / total) * 100).toFixed(1)) : 0;
  return {
    totalShellFiles: total,
    filesWithPipefail,
    pipefailAdoption: `${adoption}% (${filesWithPipefail}/${total} shell files)`,
    shebang,
    shellcheckDirectives,
  };
}

// ---------------------------------------------------------------------------
// Module system
// ---------------------------------------------------------------------------

function detectModuleSystem(repoPath, overview) {
  const { primary } = resolveEcosystems(repoPath, overview);
  const manifest = resolveManifest(repoPath, overview);

  if (primary === 'python') {
    const bb = manifest && manifest.buildBackend;
    return {
      packageJsonType: null,
      inferred: bb ? `${bb} (PEP 517 build backend)` : 'PEP 517 build backend (pyproject.toml)',
    };
  }

  if (primary === 'rust') {
    return {
      packageJsonType: null,
      inferred: `cargo (${readCargoEdition(repoPath)})`,
    };
  }

  // P0-14: shell repos use sourced scripts — never an "auto" module system.
  if (primary === 'shell') {
    return { packageJsonType: null, inferred: 'n/a (sourced scripts)' };
  }

  // js / ts / fallback
  const pkg = readJSON(join(repoPath, 'package.json'));
  const pkgType = pkg && pkg.type ? pkg.type : null;
  return {
    packageJsonType: pkgType,
    inferred:
      pkgType === 'module'
        ? 'ESM'
        : pkgType === 'commonjs'
          ? 'CJS'
          : 'auto (from file extensions or default)',
  };
}

// ---------------------------------------------------------------------------
// Largest files
// ---------------------------------------------------------------------------

function findLargestFiles(repoPath, overview, files) {
  const sized = [];
  for (const f of files) {
    try {
      const st = statSync(join(repoPath, f));
      if (st.size > 0) sized.push({ path: f, size: st.size });
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

// ---------------------------------------------------------------------------
// Comment density (ecosystem-aware via shared comments.mjs)
// ---------------------------------------------------------------------------

function estimateCommentDensity(repoPath, overview, files) {
  const { all } = resolveEcosystems(repoPath, overview);

  let totalLines = 0;
  let commentLines = 0;

  for (const eco of all) {
    const desc = descriptorFor(eco);
    if (!desc) continue;
    // Only ecosystems the shared helper understands count toward density.
    if (!['python', 'javascript', 'typescript', 'rust', 'shell'].includes(eco)) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, 20);
    for (const f of subset) {
      const content = readContent(join(repoPath, f));
      if (!content) continue;
      const r = countComments(content, eco);
      commentLines += r.commentLines;
      totalLines += r.totalLines;
    }
  }

  if (totalLines === 0) return null;
  const density = ((commentLines / totalLines) * 100).toFixed(1);
  return `${density}% (${commentLines} comment lines / ${totalLines} total lines sampled)`;
}

// ---------------------------------------------------------------------------
// Docstrings (multi-language)
// ---------------------------------------------------------------------------

// P0-4 (Python): a docstring is the FIRST statement of the function/class body,
// i.e. it comes AFTER the declaration. Look FORWARD into the body for the first
// deeper-indented statement (skipping signature continuation lines, blank lines
// and comments) and check whether it is a string literal. Signature
// continuation is tracked via parenthesis depth so multi-line signatures are
// handled like the AST (a docstring after a multi-line signature is counted).
function parenDeltaOf(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === '(' || ch === '[' || ch === '{') delta++;
    else if (ch === ')' || ch === ']' || ch === '}') delta--;
  }
  return delta;
}

function pyHasDocstring(lines, i) {
  const indentOf = (s) => (s.match(/^[ \t]*/) || [''])[0].length;
  const defIndent = indentOf(lines[i]);
  const re = /^[rbuRBUf]{0,2}("""|''')/;
  let depth = parenDeltaOf(lines[i]);
  let awaitingBody = depth <= 0;
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    depth += parenDeltaOf(line);
    if (depth < 0) depth = 0;
    if (depth > 0) {
      awaitingBody = false; // still inside a multi-line signature
      continue;
    }
    if (indent <= defIndent && awaitingBody) return false; // body ended
    if (!awaitingBody) {
      awaitingBody = true; // signature closed on this line
      continue;
    }
    if (/^\s*#/.test(line)) continue; // comments precede the first statement
    return re.test(line.trim());
  }
  return false;
}

// JS/TS: walk back over contiguous comment lines and detect a `/**` JSDoc start.
function jsDocPreceding(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '') break;
    if (/^(\/\/|\/\*|\*|\*\/)/.test(t)) {
      if (t.startsWith('/**')) return true;
      continue;
    }
    break;
  }
  return false;
}

// Rust: contiguous `///` (doc) lines immediately before the item.
function rustDocPreceding(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '') continue;
    if (t.startsWith('///')) return true;
    break;
  }
  return false;
}

function detectDocstrings(repoPath, overview, files) {
  const languages = overview?.languages || [];
  const production = productionSourceFiles(files, overview);
  const result = { patterns: {}, coverage: {}, samples: [] };

  if (languages.includes('JavaScript') || languages.includes('TypeScript')) {
    const jsFiles = filterByExt(production, ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

    let exportsTotal = 0;
    let exportsDocumented = 0;
    const jsdocSamples = [];

    for (const filePath of jsFiles) {
      const content = readContent(join(repoPath, filePath));
      if (!content) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(export\s+(default\s+)?(function|class|const|let|var|type|interface|enum)\s+\w+)/.test(line)) {
          exportsTotal++;
          if (jsDocPreceding(lines, i)) {
            exportsDocumented++;
            if (jsdocSamples.length < 3) {
              jsdocSamples.push({
                file: filePath,
                symbol: line.match(/(function|class|const|let|var|type|interface|enum)\s+(\w+)/)?.[2] || 'unknown',
              });
            }
          }
        }
      }
    }

    if (exportsTotal > 0) {
      const pct = ((exportsDocumented / exportsTotal) * 100).toFixed(0);
      result.patterns['JavaScript/TypeScript'] = 'JSDoc (/** ... */)';
      result.coverage['JavaScript/TypeScript'] =
        `${pct}% (${exportsDocumented}/${exportsTotal} exports documented in production source)`;
      result.samples = result.samples.concat(jsdocSamples.map((s) => ({ ...s, language: 'JS/TS' })));
    }
  }

  if (languages.includes('Python')) {
    const pyFiles = filterByExt(production, ['.py', '.pyi']);

    let funcsTotal = 0;
    let funcsDocumented = 0;
    const pySamples = [];

    for (const filePath of pyFiles) {
      const content = readContent(join(repoPath, filePath));
      if (!content) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(?:async\s+)?def\s+\w+/.test(lines[i]) || /^\s*class\s+\w+/.test(lines[i])) {
          // `__init__` constructors and magic (dunder) methods are deliberately
          // exempt from the docstring requirement (P0-3 conventions).
          const defName = lines[i].match(/(?:def|class)\s+(\w+)/)?.[1] || '';
          if (defName === '__init__' || /^__\w+__$/.test(defName)) continue;
          funcsTotal++;
          if (pyHasDocstring(lines, i)) {
            funcsDocumented++;
            if (pySamples.length < 3) {
              pySamples.push({
                file: filePath,
                symbol: lines[i].match(/(def|class)\s+(\w+)/)?.[2] || 'unknown',
              });
            }
          }
        }
      }
    }

    if (funcsTotal > 0) {
      const pct = ((funcsDocumented / funcsTotal) * 100).toFixed(0);
      result.patterns['Python'] = 'Docstrings (PEP 257)';
      result.coverage['Python'] =
        `${pct}% (${funcsDocumented}/${funcsTotal} functions documented in production source; tests, __init__ and magic methods exempt)`;
      result.samples = result.samples.concat(pySamples.map((s) => ({ ...s, language: 'Python' })));
    }
  }

  if (languages.includes('Rust')) {
    const rsFiles = filterByExt(production, ['.rs']);

    let itemsTotal = 0;
    let itemsDocumented = 0;
    const rsSamples = [];

    for (const filePath of rsFiles) {
      const content = readContent(join(repoPath, filePath));
      if (!content) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(pub\s+)?(fn|struct|enum|trait|impl)\s+\w+/.test(lines[i])) {
          itemsTotal++;
          if (rustDocPreceding(lines, i)) {
            itemsDocumented++;
            if (rsSamples.length < 3) {
              rsSamples.push({
                file: filePath,
                symbol: lines[i].match(/(fn|struct|enum|trait)\s+(\w+)/)?.[2] || 'unknown',
              });
            }
          }
        }
      }
    }

    if (itemsTotal > 0) {
      const pct = ((itemsDocumented / itemsTotal) * 100).toFixed(0);
      result.patterns['Rust'] = 'Rustdoc (/// ...)';
      result.coverage['Rust'] = `${pct}% (${itemsDocumented}/${itemsTotal} items documented in production source)`;
      result.samples = result.samples.concat(rsSamples.map((s) => ({ ...s, language: 'Rust' })));
    }
  }

  if (languages.includes('Go')) {
    const goFiles = filterByExt(production, ['.go']);

    let exportsTotal = 0;
    let exportsDocumented = 0;
    const goSamples = [];

    for (const filePath of goFiles) {
      const content = readContent(join(repoPath, filePath));
      if (!content) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(func|type|var|const)\s+[A-Z]\w*/.test(lines[i])) {
          exportsTotal++;
          if (i > 0 && /^\s*\/\/\s+\w+\s/.test(lines[i - 1])) {
            exportsDocumented++;
            if (goSamples.length < 3) {
              goSamples.push({
                file: filePath,
                symbol: lines[i].match(/(func|type|var|const)\s+(\w+)/)?.[2] || 'unknown',
              });
            }
          }
        }
      }
    }

    if (exportsTotal > 0) {
      const pct = ((exportsDocumented / exportsTotal) * 100).toFixed(0);
      result.patterns['Go'] = 'GoDoc (// comment before declaration)';
      result.coverage['Go'] = `${pct}% (${exportsDocumented}/${exportsTotal} exports documented in production source)`;
      result.samples = result.samples.concat(goSamples.map((s) => ({ ...s, language: 'Go' })));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Language standards (DETECTED, not asserted — P0-21)
// ---------------------------------------------------------------------------

// A tiny file/pattern probe that also understands `pyproject.toml:[tool.x]`
// table references and `package.json#field` keys.
function configProbe(repoPath, entries) {
  for (const entry of entries) {
    if (entry.includes(':[tool.')) {
      // pyproject table probe
      const file = entry.split(':[tool.')[0];
      const key = entry.split(':[tool.')[1].replace(/\]$/, '');
      const p = join(repoPath, file);
      if (!existsSync(p)) continue;
      try {
        const txt = readFileSync(p, 'utf-8');
        if (new RegExp(`^\\s*\\[tool\\.${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\]`, 'm').test(txt)) return true;
      } catch {}
      continue;
    }
    if (entry.includes('#')) {
      // package.json#field
      const [file, field] = entry.split('#');
      const pkg = readJSON(join(repoPath, file));
      if (pkg && pkg[field] != null) return true;
      continue;
    }
    if (entry.includes(':{')) {
      // glob-style like jest.config.{js,ts} — expand naively
      const brace = entry.match(/^(.*)\.\{([^}]+)\}$/);
      if (brace) {
        const opts = brace[2].split(',');
        for (const o of opts) if (existsSync(join(repoPath, `${brace[1]}.${o}`))) return true;
      }
      continue;
    }
    if (existsSync(join(repoPath, entry))) return true;
  }
  return false;
}

function rustAutomationFiles(files) {
  return files.filter((file) => {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file)) return true;
    if (/^(?:Makefile|Justfile)$/.test(file)) return true;
    return /^(?:scripts?|tasks?|config|\.config)\/[^/]+(?:\/[^/]+)*\.(?:sh|bash|zsh|fish|ps1|cmd|bat|py|js|mjs|cjs|ts|mts|cts|toml|ya?ml)$/i.test(file);
  });
}

function maskAutomationCommentsAndQuotes(content, file) {
  const chars = [...content];
  const jsComments = /\.(?:js|mjs|cjs|ts|mts|cts)$/i.test(file);
  let quote = null;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '\n') {
      escaped = false;
      continue;
    }
    if (quote) {
      chars[i] = ' ';
      if (escaped) escaped = false;
      else if (char === '\\' && quote !== "'") escaped = true;
      else if (char === quote) {
        if (quote === "'" && chars[i + 1] === "'") chars[++i] = ' ';
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || (char === '`' && jsComments)) {
      quote = char;
      chars[i] = ' ';
      continue;
    }
    if (char === '#' || (jsComments && char === '/' && chars[i + 1] === '/' && chars[i - 1] !== ':')) {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      i--;
    }
  }

  return chars.join('');
}

function stripYamlComments(content) {
  const chars = [...content];
  let quote = null;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '\n') {
      escaped = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\' && quote === '"') escaped = true;
      else if (char === quote) {
        if (quote === "'" && chars[i + 1] === "'") i++;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '#') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      i--;
    }
  }

  return chars.join('');
}

function unquoteYamlScalar(value) {
  const scalar = value.trim();
  if (scalar.length < 2 || scalar[0] !== scalar.at(-1)) return scalar;
  if (scalar[0] === "'") return scalar.slice(1, -1).replace(/''/g, "'");
  if (scalar[0] !== '"') return scalar;
  try {
    return JSON.parse(scalar);
  } catch {
    return scalar.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
}

function rustInvocations(content, file) {
  const yaml = /\.ya?ml$/i.test(file);
  const masked = yaml ? stripYamlComments(content) : maskAutomationCommentsAndQuotes(content, file);
  const prefix = '(?:^|(?:&&|\\|\\||[;|])\\s*)(?:[-@+]?\\s*)?(?:(?:env|command|exec|sudo)\\s+)*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\\s;&|]+)\\s+)*';
  const patterns = {
    cargoFmt: new RegExp(`${prefix}cargo\\s+fmt\\b`, 'i'),
    rustfmt: new RegExp(`${prefix}rustfmt\\b`, 'i'),
    cargoClippy: new RegExp(`${prefix}cargo\\s+clippy\\b`, 'i'),
    clippyDriver: new RegExp(`${prefix}clippy-driver\\b`, 'i'),
  };
  const found = { cargoFmt: false, rustfmt: false, cargoClippy: false, clippyDriver: false };
  const candidates = [];
  const lines = masked.split('\n');

  if (yaml) {
    let runIndent = null;
    for (const line of lines) {
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (runIndent != null) {
        if (line.trim() === '') continue;
        if (indent > runIndent) candidates.push(line.trim());
        else runIndent = null;
      }
      const run = line.match(/^(\s*)(?:-\s*)?run\s*:\s*(.*)$/i);
      if (!run) continue;
      if (/^[|>][+-]?\s*$/.test(run[2])) runIndent = run[1].length;
      else candidates.push(unquoteYamlScalar(run[2]));
    }
  } else if (file === 'Makefile') {
    for (const line of lines) if (line.startsWith('\t')) candidates.push(line.slice(1));
  } else if (file === 'Justfile') {
    for (const line of lines) if (/^\s+\S/.test(line)) candidates.push(line.trim());
  } else {
    candidates.push(...lines);
  }

  for (const line of candidates) {
    for (const [name, pattern] of Object.entries(patterns)) {
      if (!found[name] && pattern.test(line)) found[name] = true;
    }
  }
  return found;
}

function detectRustStandardEvidence(repoPath, overview, files) {
  const rustfmtConfig = existsSync(join(repoPath, 'rustfmt.toml')) || existsSync(join(repoPath, '.rustfmt.toml'));
  const clippyConfig = existsSync(join(repoPath, 'clippy.toml')) || existsSync(join(repoPath, '.clippy.toml'));
  let rustfmtReference = null;
  let clippyReference = null;

  for (const file of rustAutomationFiles(files)) {
    const content = readContent(join(repoPath, file));
    if (content == null) continue;
    const invocations = rustInvocations(content, file);
    if (!rustfmtReference) {
      if (invocations.cargoFmt) rustfmtReference = 'cargo fmt referenced';
      else if (invocations.rustfmt) rustfmtReference = 'rustfmt referenced';
    }
    if (!clippyReference) {
      if (invocations.cargoClippy) clippyReference = 'cargo clippy referenced';
      else if (invocations.clippyDriver) clippyReference = 'clippy-driver referenced';
    }
    if (rustfmtReference && clippyReference) break;
  }

  return { rustfmtConfig, clippyConfig, rustfmtReference, clippyReference };
}

function detectLanguageStandards(repoPath, overview, files) {
  const languages = overview?.languages || [];
  const { all } = resolveEcosystems(repoPath, overview);
  const standards = [];
  const inferred = [];

  if (all.includes('python') || languages.includes('Python')) {
    const hasFormatter = configProbe(repoPath, [
      'pyproject.toml:[tool.black]', 'pyproject.toml:[tool.isort]',
      'pyproject.toml:[tool.ruff]', 'ruff.toml', '.ruff.toml',
      'pyproject.toml:[tool.ruff.format]', '.flake8', '.pylintrc',
      'setup.cfg:[flake8]', 'tox.ini:[flake8]',
    ]);
    if (hasFormatter || existsSync(join(repoPath, 'pyproject.toml'))) {
      standards.push('PEP 8 (style guide)');
    }
    // PEP 257 docstrings: only if docstrings actually present (coverage detected)
    // or a pydocstyle config exists.
    const hasPydocstyle = configProbe(repoPath, [
      '.pydocstyle', 'setup.cfg:[pydocstyle]', 'tox.ini:[pydocstyle]', 'pyproject.toml:[tool.pydocstyle]',
    ]);
    if (hasPydocstyle) {
      standards.push('PEP 257 (docstrings)');
    }
    // PEP 484 type hints: only if a type checker config / py.typed / future
    // annotations / observed annotations exist.
    const hasTypeChecker = configProbe(repoPath, [
      'mypy.ini', '.mypy.ini', 'pyproject.toml:[tool.mypy]', 'setup.cfg:[mypy]',
      'pyproject.toml:[tool.pyright]', 'pyrightconfig.json',
    ]);
    const hasPyTyped = existsSync(join(repoPath, 'py.typed'));
    if (hasTypeChecker || hasPyTyped) {
      standards.push('PEP 484 (type hints)');
    }
    if (existsSync(join(repoPath, 'pyproject.toml'))) standards.push('PEP 621 (pyproject.toml)');
    if (hasTypeChecker) inferred.push('type checker config present');
    if (hasFormatter) inferred.push('formatter/linter config present');
  }

  if (all.includes('typescript') || languages.includes('TypeScript')) {
    const pkg = readJSON(join(repoPath, 'package.json'));
    const deps = { ...(pkg && pkg.dependencies), ...(pkg && pkg.devDependencies) };
    const hasTsEslint =
      configProbe(repoPath, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json']) &&
      Object.keys(deps).some((d) => /@typescript-eslint|typescript-eslint/.test(d));
    if (hasTsEslint) standards.push('@typescript-eslint (TS ESLint)');
    if (Object.keys(deps).some((d) => /typedoc|tsdoc/.test(d))) standards.push('TSDoc');
    const tsconfig = readJSON(join(repoPath, 'tsconfig.json'));
    if (tsconfig) {
      const strict = tsconfig.compilerOptions && tsconfig.compilerOptions.strict;
      standards.push(strict ? 'tsconfig.json (strict mode)' : 'tsconfig.json');
    }
  }

  if (all.includes('javascript') && !all.includes('typescript')) {
    const hasEslint = configProbe(repoPath, [
      'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json',
      'package.json#eslintConfig',
    ]);
    if (hasEslint) standards.push('ESLint');
    const pkg = readJSON(join(repoPath, 'package.json'));
    const deps = { ...(pkg && pkg.dependencies), ...(pkg && pkg.devDependencies) };
    if (Object.keys(deps).some((d) => /jsdoc/.test(d))) standards.push('JSDoc');
    const hasPrettier = configProbe(repoPath, [
      '.prettierrc', '.prettierrc.json', '.prettierrc.yml', 'prettier.config.js', 'package.json#prettier',
    ]);
    if (hasPrettier) standards.push('Prettier');
  }

  if (all.includes('rust') || languages.includes('Rust')) {
    const evidence = detectRustStandardEvidence(repoPath, overview, files);
    if (evidence.rustfmtConfig || evidence.rustfmtReference) {
      standards.push('rustfmt (formatting)');
    }
    if (evidence.clippyConfig || evidence.clippyReference) {
      standards.push('clippy (linting)');
    }
    if (evidence.rustfmtConfig) inferred.push('rustfmt.toml present');
    if (evidence.rustfmtReference) inferred.push(evidence.rustfmtReference);
    if (evidence.clippyConfig) inferred.push('clippy.toml present');
    if (evidence.clippyReference) inferred.push(evidence.clippyReference);
  }

  if (languages.includes('Go')) {
    if (existsSync(join(repoPath, 'go.mod'))) {
      standards.push('gofmt (formatting)');
      inferred.push('go.mod present');
    }
  }

  if (languages.includes('Java')) {
    if (existsSync(join(repoPath, 'checkstyle.xml'))) {
      standards.push('Checkstyle / Sun/Oracle conventions');
      inferred.push('checkstyle config present');
    }
  }

  return { standards, inferred };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scan(repoPath, overview, broker = commandBroker) {
  const files = await listFiles(repoPath, overview, broker);
  const importStyle = detectImportStyle(repoPath, overview, files);
  const fileNaming = detectFileNaming(repoPath, overview, files);
  const errorHandling = detectErrorHandling(repoPath, overview, files);
  const moduleSystem = detectModuleSystem(repoPath, overview);
  const largestFiles = findLargestFiles(repoPath, overview, files);
  const commentDensity = estimateCommentDensity(repoPath, overview, files);
  const docstrings = detectDocstrings(repoPath, overview, files);
  const languageStandards = detectLanguageStandards(repoPath, overview, files);

  // Richness keys (T108).
  const symbolNaming = detectSymbolNaming(repoPath, overview, files);
  const asyncUsage = detectAsyncUsage(repoPath, overview, files);
  const unsafeCount = detectUnsafe(repoPath, overview, files);
  const shellHygiene = detectShellHygiene(repoPath, overview, files);
  const pythonTypeHints = detectPythonTypeHints(repoPath, overview, files);
  const tsAnnotations = detectTsAnnotations(repoPath, overview, files);

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
      // richness keys
      symbolNaming,
      asyncUsage,
      unsafeCount,
      shellHygiene,
      pythonTypeHints,
      tsAnnotations,
    },
  };
}
